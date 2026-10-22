import datetime as dt
import importlib.util
import os
import stat
from unittest import mock
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).parent


def load_script(name: str, module_name: str):
    specification = importlib.util.spec_from_file_location(
        module_name, SCRIPTS / name
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Could not load {name}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


resolver = load_script("resolve-production-release.py", "release_resolver")
deploy = load_script("production-deploy.py", "production_deploy")


class ReleaseManifestTests(unittest.TestCase):
    def temporary_directory(self) -> Path:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        return Path(temporary_directory.name)

    def test_accepts_only_expected_digest_manifest(self):
        release_sha = "a" * 40
        manifest = self.temporary_directory()
        manifest_file = manifest / "deployment-images.txt"
        backend = f"ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'b' * 64}"
        frontend = f"ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'c' * 64}"
        manifest_file.write_text(
            f"source_commit={release_sha}\n"
            f"backend_image={backend}\n"
            f"frontend_image={frontend}\n",
            encoding="utf-8",
        )

        self.assertEqual(
            resolver.parse_manifest(manifest_file, release_sha),
            (backend, frontend),
        )

    def test_rejects_manifest_for_another_commit(self):
        release_sha = "a" * 40
        manifest_file = self.temporary_directory() / "manifest"
        manifest_file.write_text(
            f"source_commit={'d' * 40}\n"
            f"backend_image=ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'b' * 64}\n"
            f"frontend_image=ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'c' * 64}\n",
            encoding="utf-8",
        )

        with self.assertRaises(resolver.ReleaseResolutionError):
            resolver.parse_manifest(manifest_file, release_sha)

    def test_rejects_mutable_or_untrusted_images(self):
        release_sha = "a" * 40
        manifest_file = self.temporary_directory() / "manifest"
        manifest_file.write_text(
            f"source_commit={release_sha}\n"
            "backend_image=ghcr.io/dkfarhan/dirtyduty-backend:latest\n"
            f"frontend_image=ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'c' * 64}\n",
            encoding="utf-8",
        )

        with self.assertRaises(resolver.ReleaseResolutionError):
            resolver.parse_manifest(manifest_file, release_sha)


class DeploymentInputTests(unittest.TestCase):
    def test_accepts_only_the_two_first_party_digest_repositories(self):
        request = {
            "release_sha": "a" * 40,
            "backend_image": f"ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'b' * 64}",
            "frontend_image": f"ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'c' * 64}",
            "registry_username": "deploy-user",
            "registry_token": "x" * 40,
        }

        self.assertEqual(deploy.validate_request(request), request)

    def test_rejects_other_registry_repositories_and_malformed_token(self):
        request = {
            "release_sha": "a" * 40,
            "backend_image": f"ghcr.io/attacker/dirtyduty-backend@sha256:{'b' * 64}",
            "frontend_image": f"ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'c' * 64}",
            "registry_username": "deploy-user",
            "registry_token": "x" * 40,
        }
        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_request(request)

        request["backend_image"] = (
            f"ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'b' * 64}"
        )
        request["registry_token"] = "contains whitespace " + ("x" * 24)
        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_request(request)

    def test_updates_only_the_image_entries_and_preserves_secrets(self):
        lines = [
            "POSTGRES_PASSWORD=not-a-real-password\n",
            f"BACKEND_IMAGE=ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'a' * 64}\n",
            f"FRONTEND_IMAGE=ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'b' * 64}\n",
        ]
        images = {
            "BACKEND_IMAGE": f"ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'c' * 64}",
            "FRONTEND_IMAGE": f"ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'d' * 64}",
        }

        updated = deploy.image_environment(lines, images)

        self.assertIn("POSTGRES_PASSWORD=not-a-real-password\n", updated)
        self.assertIn(f"BACKEND_IMAGE={images['BACKEND_IMAGE']}\n", updated)
        self.assertIn(f"FRONTEND_IMAGE={images['FRONTEND_IMAGE']}\n", updated)
        self.assertEqual(updated.count("BACKEND_IMAGE="), 1)
        self.assertEqual(updated.count("FRONTEND_IMAGE="), 1)


class EnvironmentPermissionTests(unittest.TestCase):
    def test_atomic_image_update_keeps_secret_file_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / ".env.production"
            compose_file = root / "docker-compose.production.yml"
            original_lines = [
                "POSTGRES_PASSWORD=example-placeholder\n",
                f"BACKEND_IMAGE=ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'a' * 64}\n",
                f"FRONTEND_IMAGE=ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'b' * 64}\n",
            ]
            env_file.write_text("".join(original_lines))
            env_file.chmod(0o600)
            compose_file.write_text("services: {}\n")
            compose_file.chmod(0o644)
            replacements = {
                "BACKEND_IMAGE": f"ghcr.io/dkfarhan/dirtyduty-backend@sha256:{'c' * 64}",
                "FRONTEND_IMAGE": f"ghcr.io/dkfarhan/dirtyduty-frontend@sha256:{'d' * 64}",
            }
            # Even if a caller mistakenly passes a public file's metadata,
            # credentials must never become readable outside the owner.
            with mock.patch.object(deploy, "ENV_FILE", env_file):
                deploy.atomic_update_environment(
                    original_lines, replacements, compose_file.stat()
                )
            self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o600)
            self.assertIn("POSTGRES_PASSWORD=example-placeholder", env_file.read_text())


class NamedVolumeTests(unittest.TestCase):
    def test_service_mount_resolves_to_actual_engine_volume_name(self):
        config = {
            "volumes": {
                "dirtyduty_postgres_data": {
                    "name": "dirtyduty_dirtyduty_postgres_data"
                }
            }
        }
        service = {
            "volumes": [
                {
                    "type": "volume",
                    "source": "dirtyduty_postgres_data",
                    "target": "/var/lib/postgresql/data",
                }
            ]
        }
        self.assertEqual(
            deploy.resolved_named_volume(
                config, service, "/var/lib/postgresql/data"
            ),
            "dirtyduty_dirtyduty_postgres_data",
        )

    def test_missing_resolved_volume_fails_closed(self):
        config = {"volumes": {}}
        service = {"volumes": [{"source": "db", "target": "/data"}]}
        with self.assertRaises(deploy.DeploymentError):
            deploy.resolved_named_volume(config, service, "/data")


class BackupEvidenceTests(unittest.TestCase):
    def test_accepts_recent_backup_with_recent_offsite_restore_verification(self):
        now = dt.datetime(2026, 10, 22, 12, tzinfo=dt.timezone.utc)
        payload = {
            "backup_id": "backup-2026-10-22",
            "offsite_copy_id": "object-version-42",
            "restore_test_id": "isolated-restore-42",
            "backup_created_at": "2026-10-22T11:00:00Z",
            "offsite_restore_verified_at": "2026-10-22T11:30:00Z",
        }

        evidence = deploy.validate_backup_evidence(payload, now)

        self.assertEqual(evidence["backup_id"], "backup-2026-10-22")

    def test_rejects_stale_or_pre_backup_offsite_verification(self):
        now = dt.datetime(2026, 10, 22, 12, tzinfo=dt.timezone.utc)
        stale = {
            "backup_id": "backup-old",
            "offsite_copy_id": "object-version-old",
            "restore_test_id": "isolated-restore-old",
            "backup_created_at": "2026-10-20T11:00:00Z",
            "offsite_restore_verified_at": "2026-10-20T12:00:00Z",
        }
        pre_backup_verification = {
            "backup_id": "backup-new",
            "offsite_copy_id": "object-version-new",
            "restore_test_id": "isolated-restore-new",
            "backup_created_at": "2026-10-22T11:00:00Z",
            "offsite_restore_verified_at": "2026-10-22T10:00:00Z",
        }

        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_backup_evidence(stale, now)
        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_backup_evidence(pre_backup_verification, now)


if __name__ == "__main__":
    unittest.main()
