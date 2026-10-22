#!/usr/bin/env python3
"""Root-owned, fixed-scope production deployment entry point for Oracle Linux."""

from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


PROJECT = "dirtyduty"
ROOT = Path("/opt/dirtyduty")
COMPOSE_FILE = ROOT / "docker-compose.production.yml"
ENV_FILE = ROOT / ".env.production"
BACKUP_VERIFIER = Path("/usr/local/sbin/dirtyduty-backup-verify")
HISTORY_DIRECTORY = Path("/var/lib/dirtyduty-deploy")
HISTORY_FILE = HISTORY_DIRECTORY / "releases.jsonl"
LOCK_FILE = Path("/run/dirtyduty-deploy.lock")
BACKUP_MAX_AGE_HOURS = 24
BACKEND_REPOSITORY = "ghcr.io/dkfarhan/dirtyduty-backend"
FRONTEND_REPOSITORY = "ghcr.io/dkfarhan/dirtyduty-frontend"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_PATTERN = re.compile(
    r"^(ghcr\.io/dkfarhan/dirtyduty-(?:backend|frontend))@(sha256:[0-9a-f]{64})$"
)
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,39}$")
ENV_KEY_PATTERN = re.compile(r"^\s*(BACKEND_IMAGE|FRONTEND_IMAGE)\s*=")


class DeploymentError(Exception):
    """A production deployment precondition or operation failed."""


def run(
    arguments: list[str],
    *,
    environment: dict[str, str] | None = None,
    input_data: bytes | None = None,
    timeout: int = 60,
) -> str:
    result = subprocess.run(
        arguments,
        check=False,
        input=input_data,
        capture_output=True,
        timeout=timeout,
        env=environment,
    )
    if result.returncode != 0:
        raise DeploymentError(
            f"Command failed: {Path(arguments[0]).name} (exit {result.returncode})."
        )
    try:
        return result.stdout.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise DeploymentError(
            f"Command returned invalid text: {Path(arguments[0]).name}."
        ) from error


def validate_request(request: Any) -> dict[str, str]:
    if not isinstance(request, dict) or set(request) != {
        "release_sha",
        "backend_image",
        "frontend_image",
        "registry_username",
        "registry_token",
    }:
        raise DeploymentError("Deployment request must be a JSON object.")
    release_sha = request.get("release_sha")
    backend_image = request.get("backend_image")
    frontend_image = request.get("frontend_image")
    registry_username = request.get("registry_username")
    registry_token = request.get("registry_token")

    if not isinstance(release_sha, str) or SHA_PATTERN.fullmatch(release_sha) is None:
        raise DeploymentError("Deployment request contains an invalid commit SHA.")
    if (
        not isinstance(backend_image, str)
        or IMAGE_PATTERN.fullmatch(backend_image) is None
        or not backend_image.startswith(f"{BACKEND_REPOSITORY}@")
    ):
        raise DeploymentError("Deployment request contains an invalid backend image.")
    if (
        not isinstance(frontend_image, str)
        or IMAGE_PATTERN.fullmatch(frontend_image) is None
        or not frontend_image.startswith(f"{FRONTEND_REPOSITORY}@")
    ):
        raise DeploymentError("Deployment request contains an invalid frontend image.")
    if (
        not isinstance(registry_username, str)
        or USERNAME_PATTERN.fullmatch(registry_username) is None
    ):
        raise DeploymentError("Deployment request contains an invalid registry username.")
    if (
        not isinstance(registry_token, str)
        or not 20 <= len(registry_token) <= 512
        or any(ord(character) < 33 or ord(character) > 126 for character in registry_token)
    ):
        raise DeploymentError("Deployment request contains an invalid registry token.")

    return {
        "release_sha": release_sha,
        "backend_image": backend_image,
        "frontend_image": frontend_image,
        "registry_username": registry_username,
        "registry_token": registry_token,
    }


def require_root_owned_private_file(
    path: Path, *, secret: bool = False
) -> os.stat_result:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise DeploymentError(f"Required server file is unavailable: {path.name}.") from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
        raise DeploymentError(
            f"Required server file must be a regular root-owned file: {path.name}."
        )
    if metadata.st_mode & 0o022:
        raise DeploymentError(
            f"Required server file is writable by group or others: {path.name}."
        )
    if secret and metadata.st_mode & 0o077:
        raise DeploymentError(f"Required server file is readable by group or others: {path.name}.")
    return metadata


def read_application_environment(path: Path) -> tuple[list[str], dict[str, str]]:
    require_root_owned_private_file(path, secret=True)
    try:
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    except (OSError, UnicodeError) as error:
        raise DeploymentError("Production environment file could not be read.") from error

    found: dict[str, str] = {}
    for line in lines:
        if ENV_KEY_PATTERN.match(line):
            key, separator, value = line.partition("=")
            key = key.strip()
            if not separator or key in found:
                raise DeploymentError("Production image settings are duplicated or malformed.")
            found[key] = value.strip()
    if set(found) != {"BACKEND_IMAGE", "FRONTEND_IMAGE"}:
        raise DeploymentError(
            "Production environment must define both application images exactly once."
        )
    for key, repository in (
        ("BACKEND_IMAGE", BACKEND_REPOSITORY),
        ("FRONTEND_IMAGE", FRONTEND_REPOSITORY),
    ):
        value = found[key]
        if not value.startswith(f"{repository}@") or DIGEST_PATTERN.fullmatch(
            value.removeprefix(f"{repository}@")
        ) is None:
            raise DeploymentError(f"{key} must contain a digest-pinned first-party GHCR image.")
    return lines, found


def image_environment(lines: list[str], images: dict[str, str]) -> str:
    replaced: set[str] = set()
    output: list[str] = []
    for line in lines:
        match = ENV_KEY_PATTERN.match(line)
        if match:
            key = match.group(1)
            output.append(f"{key}={images[key]}\n")
            replaced.add(key)
        else:
            output.append(line)
    if replaced != {"BACKEND_IMAGE", "FRONTEND_IMAGE"}:
        raise DeploymentError("Could not update both application image references.")
    return "".join(output)


def atomic_update_environment(
    old_lines: list[str], images: dict[str, str], original_stat: os.stat_result
) -> None:
    content = image_environment(old_lines, images)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=ENV_FILE.parent,
            prefix=".env.production.",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            # Production credentials must never be made group/world-readable.
            os.fchmod(temporary_file.fileno(), 0o600)
            os.fchown(temporary_file.fileno(), original_stat.st_uid, original_stat.st_gid)
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, ENV_FILE)
        directory_descriptor = os.open(ENV_FILE.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_timestamp(value: Any, field: str) -> dt.datetime:
    if not isinstance(value, str):
        raise DeploymentError(f"Backup verifier did not provide {field}.")
    try:
        timestamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise DeploymentError(f"Backup verifier returned an invalid {field}.") from error
    if timestamp.tzinfo is None:
        raise DeploymentError(f"Backup verifier returned a timezone-free {field}.")
    return timestamp.astimezone(dt.timezone.utc)


def validate_backup_evidence(payload: Any, now: dt.datetime) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise DeploymentError("Backup verifier returned invalid evidence.")
    for field in ("backup_id", "offsite_copy_id", "restore_test_id"):
        value = payload.get(field)
        if not isinstance(value, str) or not value or len(value) > 256:
            raise DeploymentError(f"Backup verifier did not provide {field}.")
    backup_time = parse_timestamp(payload.get("backup_created_at"), "backup_created_at")
    verification_time = parse_timestamp(
        payload.get("offsite_restore_verified_at"), "offsite_restore_verified_at"
    )
    oldest_allowed = now - dt.timedelta(hours=BACKUP_MAX_AGE_HOURS)
    if (
        backup_time < oldest_allowed
        or verification_time < oldest_allowed
        or backup_time > now + dt.timedelta(minutes=5)
        or verification_time > now + dt.timedelta(minutes=5)
    ):
        raise DeploymentError(
            "The verified database backup or off-host recovery copy is not recent."
        )
    if verification_time < backup_time:
        raise DeploymentError("The off-host recovery verification predates the selected backup.")
    return {
        "backup_id": payload["backup_id"],
        "offsite_copy_id": payload["offsite_copy_id"],
        "restore_test_id": payload["restore_test_id"],
        "backup_created_at": backup_time.isoformat(),
        "offsite_restore_verified_at": verification_time.isoformat(),
    }


def verify_backup() -> dict[str, str]:
    require_root_owned_private_file(BACKUP_VERIFIER)
    if not os.access(BACKUP_VERIFIER, os.X_OK):
        raise DeploymentError("Required off-host backup verifier is not executable.")
    try:
        result = subprocess.run(
            [
                str(BACKUP_VERIFIER),
                "--json",
                "--max-age-hours",
                str(BACKUP_MAX_AGE_HOURS),
                "--require-offsite-restore-verification",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=240,
        )
    except subprocess.TimeoutExpired as error:
        raise DeploymentError("Off-host backup verification timed out.") from error
    if result.returncode != 0:
        raise DeploymentError("Off-host PostgreSQL backup verification failed; deployment stopped.")
    try:
        evidence = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise DeploymentError("Off-host backup verifier returned invalid evidence.") from error
    return validate_backup_evidence(evidence, utc_now())


def inspect_containers(service: str, environment: dict[str, str]) -> list[dict[str, Any]]:
    ids = run(
        [
            "docker",
            "ps",
            "--quiet",
            "--filter",
            f"label=com.docker.compose.project={PROJECT}",
            "--filter",
            f"label=com.docker.compose.service={service}",
        ],
        environment=environment,
    ).splitlines()
    if not ids:
        return []
    result = run(["docker", "inspect", *ids], environment=environment)
    try:
        containers = json.loads(result)
    except json.JSONDecodeError as error:
        raise DeploymentError("Docker returned invalid container metadata.") from error
    if not isinstance(containers, list) or len(containers) != len(ids):
        raise DeploymentError("Docker container inventory was incomplete.")
    return containers


def service_container_id(
    containers: list[dict[str, Any]], service: str
) -> str:
    if len(containers) != 1:
        raise DeploymentError(
            f"Expected exactly one running {service} container in project {PROJECT}."
        )
    container_id = containers[0].get("Id")
    if not isinstance(container_id, str) or not container_id:
        raise DeploymentError(f"Could not identify the running {service} container.")
    return container_id


def compose_volume_source(service: dict[str, Any], target: str) -> str:
    mounts = service.get("volumes")
    if not isinstance(mounts, list):
        raise DeploymentError("Production Compose volume configuration is missing.")
    for mount in mounts:
        if isinstance(mount, dict) and mount.get("target") == target:
            source = mount.get("source")
            if isinstance(source, str) and source:
                return source
    raise DeploymentError(f"Production Compose does not define the required mount {target}.")


def resolved_named_volume(
    compose_config: dict[str, Any], service: dict[str, Any], target: str
) -> str:
    # A service mount's source is the logical Compose volume key, while Docker
    # container Mounts[].Name is the actual (project-prefixed) engine name.
    source = compose_volume_source(service, target)
    volumes = compose_config.get("volumes")
    volume = volumes.get(source) if isinstance(volumes, dict) else None
    name = volume.get("name") if isinstance(volume, dict) else None
    if not isinstance(name, str) or not name:
        raise DeploymentError(f"Production Compose volume {source} has no resolved name.")
    return name


def container_mount(container: dict[str, Any], destination: str) -> dict[str, Any]:
    mounts = container.get("Mounts")
    if isinstance(mounts, list):
        for mount in mounts:
            if isinstance(mount, dict) and mount.get("Destination") == destination:
                return mount
    raise DeploymentError(f"Running production container is missing mount {destination}.")


def validate_live_project(
    compose_config: dict[str, Any], environment: dict[str, str]
) -> dict[str, str]:
    if compose_config.get("name") != PROJECT:
        raise DeploymentError("Production Compose resolved to an unexpected project name.")
    services = compose_config.get("services")
    if not isinstance(services, dict) or set(services) != {
        "backend",
        "frontend",
        "postgres",
        "caddy",
    }:
        raise DeploymentError(
            "Production Compose services differ from the reviewed four-service project."
        )

    expected_volumes = {
        "postgres": (
            "/var/lib/postgresql/data",
            resolved_named_volume(
                compose_config, services["postgres"], "/var/lib/postgresql/data"
            ),
        ),
        "caddy": (
            "/data",
            resolved_named_volume(compose_config, services["caddy"], "/data"),
        ),
    }
    caddy_config_volume = resolved_named_volume(
        compose_config, services["caddy"], "/config"
    )
    baseline: dict[str, str] = {}
    for service in ("postgres", "caddy", "backend", "frontend"):
        containers = inspect_containers(service, environment)
        baseline[service] = service_container_id(containers, service)
        container = containers[0]
        labels = container.get("Config", {}).get("Labels", {})
        if (
            not isinstance(labels, dict)
            or labels.get("com.docker.compose.project") != PROJECT
            or labels.get("com.docker.compose.service") != service
        ):
            raise DeploymentError(f"Running {service} container has unexpected Compose labels.")
        if container.get("State", {}).get("Status") != "running":
            raise DeploymentError(f"Running {service} container is not active.")

    postgres_mount = container_mount(
        inspect_single(baseline["postgres"], environment),
        expected_volumes["postgres"][0],
    )
    if (
        postgres_mount.get("Type") != "volume"
        or postgres_mount.get("Name") != expected_volumes["postgres"][1]
    ):
        raise DeploymentError("Live PostgreSQL data volume does not match production Compose.")

    caddy_container = inspect_single(baseline["caddy"], environment)
    caddy_data = container_mount(caddy_container, "/data")
    caddy_config = container_mount(caddy_container, "/config")
    if (
        caddy_data.get("Type") != "volume"
        or caddy_data.get("Name") != expected_volumes["caddy"][1]
        or caddy_config.get("Type") != "volume"
        or caddy_config.get("Name") != caddy_config_volume
    ):
        raise DeploymentError(
            "Live Caddy certificate/configuration volumes do not match production Compose."
        )

    postgres = inspect_single(baseline["postgres"], environment)
    if postgres.get("State", {}).get("Health", {}).get("Status") != "healthy":
        raise DeploymentError("PostgreSQL must be healthy before an application deployment.")
    return baseline


def inspect_single(container_id: str, environment: dict[str, str]) -> dict[str, Any]:
    result = run(["docker", "inspect", container_id], environment=environment)
    try:
        containers = json.loads(result)
    except json.JSONDecodeError as error:
        raise DeploymentError("Docker returned invalid container metadata.") from error
    if not isinstance(containers, list) or len(containers) != 1:
        raise DeploymentError("Docker container inspection was incomplete.")
    return containers[0]


def compose_environment(path: Path) -> dict[str, str]:
    return {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME": "/root",
        "LANG": "C.UTF-8",
        "COMPOSE_DISABLE_ENV_FILE": "1",
        "DOCKER_CONFIG": str(path),
    }


def health_status(container_id: str, environment: dict[str, str]) -> str:
    container = inspect_single(container_id, environment)
    return str(container.get("State", {}).get("Health", {}).get("Status", ""))


def wait_for_container_health(
    service: str, environment: dict[str, str], *, timeout: int = 180
) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        containers = inspect_containers(service, environment)
        container_id = service_container_id(containers, service)
        status = health_status(container_id, environment)
        if status == "healthy":
            return container_id
        if status == "unhealthy":
            raise DeploymentError(f"Production {service} container is unhealthy.")
        time.sleep(5)
    raise DeploymentError(
        f"Timed out waiting for production {service} health."
    )


def verify_backend_endpoint(container_id: str, environment: dict[str, str]) -> None:
    response = run(
        [
            "docker",
            "exec",
            container_id,
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "10",
            "http://localhost:8080/actuator/health",
        ],
        environment=environment,
        timeout=20,
    )
    try:
        health = json.loads(response)
    except json.JSONDecodeError as error:
        raise DeploymentError("Spring Boot health endpoint returned invalid JSON.") from error
    if not isinstance(health, dict) or health.get("status") != "UP":
        raise DeploymentError("Spring Boot health endpoint did not report UP.")


def public_probe(url: str, environment: dict[str, str]) -> tuple[int, str]:
    response = run(
        [
            "curl",
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\t%{redirect_url}",
            "--max-time",
            "15",
            url,
        ],
        environment=environment,
        timeout=20,
    )
    status, _, redirect = response.partition("\t")
    try:
        return int(status), redirect
    except ValueError as error:
        raise DeploymentError("Public HTTPS health probe returned an invalid status.") from error


def verify_public_routes(environment: dict[str, str], *, timeout: int = 90) -> None:
    deadline = time.monotonic() + timeout
    last_error = "Public HTTPS checks did not pass."
    while time.monotonic() < deadline:
        try:
            primary_status, _ = public_probe("https://dirtyduty.app/", environment)
            redirect_status, redirect_url = public_probe(
                "https://www.dirtyduty.app/", environment
            )
            if (
                200 <= primary_status < 300
                and redirect_status == 308
                and redirect_url == "https://dirtyduty.app/"
            ):
                return
            last_error = "Primary HTTPS or www redirect returned an unexpected result."
        except DeploymentError as error:
            last_error = str(error)
        time.sleep(5)
    raise DeploymentError(last_error)


def append_history(record: dict[str, Any]) -> None:
    HISTORY_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(
        HISTORY_FILE,
        os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW,
        0o600,
    )
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
            raise DeploymentError("Deployment history must be a regular root-owned file.")
        os.fchmod(descriptor, 0o600)
        data = (json.dumps(record, sort_keys=True) + "\n").encode("utf-8")
        while data:
            written = os.write(descriptor, data)
            data = data[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def previous_release() -> dict[str, Any]:
    latest: dict[str, Any] = {}
    try:
        lines = HISTORY_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return latest
    except OSError as error:
        raise DeploymentError("Deployment history could not be read.") from error
    for line in reversed(lines):
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise DeploymentError("Deployment history contains invalid JSON.") from error
        if isinstance(record, dict) and record.get("status") == "success":
            return record
    return latest


def ensure_directory_permissions(path: Path, mode: int) -> None:
    path.mkdir(mode=mode, parents=True, exist_ok=True)
    metadata = path.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != 0
        or stat.S_IMODE(metadata.st_mode) & ~mode
    ):
        raise DeploymentError(
            f"Required server directory is not a private root-owned directory: {path}."
        )


def write_candidate_environment(
    temporary_directory: Path,
    lines: list[str],
    images: dict[str, str],
) -> Path:
    candidate = temporary_directory / "compose.env"
    candidate.write_text(image_environment(lines, images), encoding="utf-8")
    os.chmod(candidate, 0o600)
    return candidate


def validate_release_compose(
    compose_config: dict[str, Any], request: dict[str, str]
) -> None:
    services = compose_config.get("services")
    if not isinstance(services, dict):
        raise DeploymentError("Production Compose services are invalid.")
    for service in ("backend", "frontend"):
        config = services.get(service)
        if (
            not isinstance(config, dict)
            or config.get("image") != request[f"{service.upper()}_IMAGE"]
            or config.get("platform") != "linux/arm64"
        ):
            raise DeploymentError(
                f"Production Compose {service} image/platform does not match the selected release."
            )
    backend_deploy = services.get("backend", {}).get("deploy")
    replicas = backend_deploy.get("replicas", 1) if isinstance(backend_deploy, dict) else 1
    if replicas != 1:
        raise DeploymentError("Production backend must remain a single instance.")


def validate_pulled_image(
    service: str, image_reference: str, release_sha: str, environment: dict[str, str]
) -> None:
    result = run(
        ["docker", "image", "inspect", image_reference],
        environment=environment,
        timeout=60,
    )
    try:
        images = json.loads(result)
    except json.JSONDecodeError as error:
        raise DeploymentError(f"Docker returned invalid {service} image metadata.") from error
    if not isinstance(images, list) or len(images) != 1:
        raise DeploymentError(f"Docker did not find exactly one pulled {service} image.")
    image = images[0]
    if not isinstance(image, dict):
        raise DeploymentError(f"Docker returned invalid {service} image metadata.")
    config = image.get("Config")
    labels = config.get("Labels") if isinstance(config, dict) else None
    repo_digests = image.get("RepoDigests")
    if (
        image.get("Os") != "linux"
        or image.get("Architecture") != "arm64"
        or not isinstance(repo_digests, list)
        or image_reference not in repo_digests
        or not isinstance(labels, dict)
        or labels.get("org.opencontainers.image.revision") != release_sha
        or labels.get("org.opencontainers.image.source")
        != "https://github.com/DkFarhan/DirtyDuty"
    ):
        raise DeploymentError(
            f"Pulled {service} image platform, digest, or source revision "
            "did not match the release."
        )


def execute_deployment(request: dict[str, str]) -> dict[str, Any]:
    if os.geteuid() != 0:
        raise DeploymentError("Production deployment entry point must run as root.")
    ensure_directory_permissions(Path("/opt"), 0o755)
    ensure_directory_permissions(Path("/var"), 0o755)
    ensure_directory_permissions(Path("/var/lib"), 0o755)
    ensure_directory_permissions(ROOT, 0o755)
    ensure_directory_permissions(HISTORY_DIRECTORY, 0o700)
    ensure_directory_permissions(LOCK_FILE.parent, 0o755)
    previous = {
        "commit": None,
        "backend_image": None,
        "frontend_image": None,
    }
    record: dict[str, Any] = {
        "release_sha": request["release_sha"],
        "backend_image": request["backend_image"],
        "frontend_image": request["frontend_image"],
        "requested_at": utc_now().isoformat(),
        "status": "failure",
        "previous_release": previous,
        "backup": None,
        "completed_at": None,
        "failure": None,
    }
    lock_descriptor = os.open(
        LOCK_FILE,
        os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
        0o600,
    )
    try:
        lock_metadata = os.fstat(lock_descriptor)
        if not stat.S_ISREG(lock_metadata.st_mode) or lock_metadata.st_uid != 0:
            raise DeploymentError("Production deployment lock must be a root-owned regular file.")
        os.fchmod(lock_descriptor, 0o600)
        fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(lock_descriptor)
        raise DeploymentError("Another production deployment is already running.") from error
    except (DeploymentError, OSError):
        os.close(lock_descriptor)
        raise

    try:
        require_root_owned_private_file(COMPOSE_FILE)
        environment_metadata = require_root_owned_private_file(ENV_FILE, secret=True)
        lines, current_images = read_application_environment(ENV_FILE)
        history = previous_release()
        previous = {
            "commit": history.get("release_sha"),
            "backend_image": history.get(
                "backend_image", current_images["BACKEND_IMAGE"]
            ),
            "frontend_image": history.get(
                "frontend_image", current_images["FRONTEND_IMAGE"]
            ),
        }
        record["previous_release"] = previous

        for directory in (ROOT, ROOT / "caddy"):
            metadata = directory.lstat()
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or metadata.st_uid != 0
                or metadata.st_mode & 0o022
            ):
                raise DeploymentError(
                    "Production Compose directory must be protected and root-owned."
                )

        verifier_metadata = require_root_owned_private_file(BACKUP_VERIFIER)
        if verifier_metadata.st_mode & 0o022 or not os.access(BACKUP_VERIFIER, os.X_OK):
            raise DeploymentError(
                "Off-host backup verifier must be executable and root-owned."
            )
        backup = verify_backup()
        record["backup"] = backup

        images = {
            "BACKEND_IMAGE": request["backend_image"],
            "FRONTEND_IMAGE": request["frontend_image"],
        }
        with tempfile.TemporaryDirectory(
            prefix="dirtyduty-deploy-", dir="/run"
        ) as temporary_directory_name:
            temporary_directory = Path(temporary_directory_name)
            os.chmod(temporary_directory, 0o700)
            docker_config = temporary_directory / "docker"
            docker_config.mkdir(mode=0o700)
            docker_environment = compose_environment(docker_config)
            run(
                [
                    "docker",
                    "login",
                    "ghcr.io",
                    "--username",
                    request["registry_username"],
                    "--password-stdin",
                ],
                environment=docker_environment,
                input_data=(request["registry_token"] + "\n").encode("ascii"),
                timeout=30,
            )
            candidate_env = write_candidate_environment(
                temporary_directory, lines, images
            )
            # Compose uses the protected candidate file instead of mutating or printing secrets.
            config_output = run(
                [
                    "docker",
                    "compose",
                    "--project-name",
                    PROJECT,
                    "--project-directory",
                    str(ROOT),
                    "--file",
                    str(COMPOSE_FILE),
                    "--env-file",
                    str(candidate_env),
                    "config",
                    "--format",
                    "json",
                ],
                environment=docker_environment,
                timeout=60,
            )
            try:
                compose_config = json.loads(config_output)
            except json.JSONDecodeError as error:
                raise DeploymentError(
                    "Production Compose returned invalid configuration JSON."
                ) from error
            if not isinstance(compose_config, dict):
                raise DeploymentError("Production Compose configuration was invalid.")
            validate_release_compose(compose_config, request)
            baseline = validate_live_project(compose_config, docker_environment)

            for service, image in (
                ("backend", request["backend_image"]),
                ("frontend", request["frontend_image"]),
            ):
                run(
                    [
                        "docker",
                        "pull",
                        image,
                    ],
                    environment=docker_environment,
                    timeout=900,
                )
                validate_pulled_image(
                    service, image, request["release_sha"], docker_environment
                )

            atomic_update_environment(lines, images, environment_metadata)
            run(
                [
                    "docker",
                    "compose",
                    "--project-name",
                    PROJECT,
                    "--project-directory",
                    str(ROOT),
                    "--file",
                    str(COMPOSE_FILE),
                    "--env-file",
                    str(ENV_FILE),
                    "up",
                    "--detach",
                    "--no-build",
                    "--no-deps",
                    "backend",
                    "frontend",
                ],
                environment=docker_environment,
                timeout=600,
            )

            backend_id = wait_for_container_health("backend", docker_environment)
            frontend_id = wait_for_container_health("frontend", docker_environment)
            for service, container_id, expected_image in (
                ("backend", backend_id, request["backend_image"]),
                ("frontend", frontend_id, request["frontend_image"]),
            ):
                container = inspect_single(container_id, docker_environment)
                if container.get("Config", {}).get("Image") != expected_image:
                    raise DeploymentError(
                        f"Production {service} is not running the requested immutable image."
                    )
            verify_backend_endpoint(backend_id, docker_environment)
            verify_public_routes(docker_environment)

            for service in ("postgres", "caddy"):
                containers = inspect_containers(service, docker_environment)
                if service_container_id(containers, service) != baseline[service]:
                    raise DeploymentError(f"Production {service} was unexpectedly recreated.")

        record["status"] = "success"
        record["completed_at"] = utc_now().isoformat()
        append_history(record)
        print(
            json.dumps(
                {
                    "status": "success",
                    "release_sha": request["release_sha"],
                    "backend_image": request["backend_image"],
                    "frontend_image": request["frontend_image"],
                    "completed_at": record["completed_at"],
                    "previous_release": previous,
                },
                sort_keys=True,
            )
        )
        return record
    except (DeploymentError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        record["failure"] = (
            str(error)
            if isinstance(error, DeploymentError)
            else f"Deployment operation failed ({type(error).__name__})."
        )
        record["completed_at"] = utc_now().isoformat()
        append_history(record)
        raise DeploymentError(record["failure"]) from error
    finally:
        os.close(lock_descriptor)


def main() -> int:
    try:
        request_bytes = sys.stdin.buffer.read(8193)
        if len(request_bytes) > 8192:
            raise DeploymentError("Deployment request exceeded the allowed size.")
        request = validate_request(json.loads(request_bytes))
        execute_deployment(request)
        return 0
    except (DeploymentError, OSError, json.JSONDecodeError) as error:
        message = (
            str(error)
            if isinstance(error, DeploymentError)
            else "Production deployment failed."
        )
        print(f"Production deployment failed: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
