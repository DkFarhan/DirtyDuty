#!/usr/bin/env python3
"""Resolve an approved commit to digests from its successful publisher artifact."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


RELEASE_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
BACKEND_PATTERN = re.compile(
    r"^ghcr\.io/dkfarhan/dirtyduty-backend@sha256:([0-9a-f]{64})$"
)
FRONTEND_PATTERN = re.compile(
    r"^ghcr\.io/dkfarhan/dirtyduty-frontend@sha256:([0-9a-f]{64})$"
)


class ReleaseResolutionError(Exception):
    """A release did not meet the repository's deployment policy."""


def gh_api(endpoint: str, *, paginate: bool = False) -> dict[str, Any] | list[Any]:
    arguments = ["gh", "api"]
    if paginate:
        arguments.extend(["--paginate", "--slurp"])
    arguments.append(endpoint)
    result = subprocess.run(
        arguments,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise ReleaseResolutionError("GitHub Actions API request failed.")
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ReleaseResolutionError("GitHub Actions API returned invalid JSON.") from error
    if not isinstance(response, (dict, list)):
        raise ReleaseResolutionError("GitHub Actions API returned an unexpected response.")
    return response


def response_items(response: dict[str, Any] | list[Any], key: str) -> list[Any]:
    pages = response if isinstance(response, list) else [response]
    items: list[Any] = []
    for page in pages:
        if isinstance(page, dict) and isinstance(page.get(key), list):
            items.extend(page[key])
    return items


def successful_ci_run(repository: str, release_sha: str) -> None:
    endpoint = (
        f"repos/{repository}/actions/workflows/ci.yml/runs"
        f"?head_sha={release_sha}&branch=main&event=push"
        "&status=success&per_page=100"
    )
    response = gh_api(endpoint, paginate=True)
    runs = response_items(response, "workflow_runs")

    for run in runs:
        if (
            isinstance(run, dict)
            and run.get("head_sha") == release_sha
            and run.get("head_branch") == "main"
            and run.get("event") == "push"
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
        ):
            return
    raise ReleaseResolutionError(
        "No successful push-triggered CI run for this exact main-branch commit was found."
    )


def matching_artifact(repository: str, artifact_name: str) -> tuple[int, int]:
    workflow = gh_api(f"repos/{repository}/actions/workflows/publish-images.yml")
    workflow_id = workflow.get("id")
    if not isinstance(workflow_id, int):
        raise ReleaseResolutionError("Image publication workflow could not be identified.")
    response = gh_api(
        f"repos/{repository}/actions/artifacts?name={artifact_name}&per_page=100",
        paginate=True,
    )
    artifacts = response_items(response, "artifacts")
    for artifact in artifacts:
        if (
            not isinstance(artifact, dict)
            or artifact.get("name") != artifact_name
            or artifact.get("expired") is not False
            or not isinstance(artifact.get("id"), int)
            or not isinstance(artifact.get("size_in_bytes"), int)
            or not 0 < artifact["size_in_bytes"] <= 65536
        ):
            continue
        workflow_run = artifact.get("workflow_run")
        if not isinstance(workflow_run, dict) or not isinstance(
            workflow_run.get("id"), int
        ):
            continue
        run_id = workflow_run["id"]
        run = gh_api(f"repos/{repository}/actions/runs/{run_id}")
        if not isinstance(run, dict):
            continue
        if (
            run.get("head_branch") == "main"
            and run.get("event") == "workflow_run"
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and run.get("workflow_id") == workflow_id
        ):
            return run_id, artifact["id"]
    raise ReleaseResolutionError(
        "No unexpired image manifest artifact for this release was found "
        "in a successful image-publication run."
    )


def download_manifest(run_id: int, artifact_name: str, destination: Path) -> Path:
    result = subprocess.run(
        [
            "gh",
            "run",
            "download",
            str(run_id),
            "--name",
            artifact_name,
            "--dir",
            str(destination),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise ReleaseResolutionError("Could not download the published image manifest.")
    manifest = destination / "deployment-images.txt"
    if (
        not manifest.is_file()
        or manifest.is_symlink()
        or manifest.stat().st_size > 4096
    ):
        raise ReleaseResolutionError("The published image manifest was missing.")
    return manifest


def parse_manifest(path: Path, release_sha: str) -> tuple[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ReleaseResolutionError("The published image manifest could not be read.") from error

    expected = [
        f"source_commit={release_sha}",
        None,
        None,
    ]
    if len(lines) != len(expected) or lines[0] != expected[0]:
        raise ReleaseResolutionError(
            "The published image manifest does not match the selected commit."
        )

    backend_match = BACKEND_PATTERN.fullmatch(lines[1].removeprefix("backend_image="))
    frontend_match = FRONTEND_PATTERN.fullmatch(lines[2].removeprefix("frontend_image="))
    if (
        not lines[1].startswith("backend_image=")
        or not lines[2].startswith("frontend_image=")
        or backend_match is None
        or frontend_match is None
    ):
        raise ReleaseResolutionError(
            "The published image manifest contains an invalid image reference."
        )

    return lines[1].removeprefix("backend_image="), lines[2].removeprefix(
        "frontend_image="
    )


def main() -> int:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    release_sha = os.environ.get("RELEASE_SHA", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ReleaseResolutionError("Repository identity was invalid.")
    if RELEASE_SHA_PATTERN.fullmatch(release_sha) is None:
        raise ReleaseResolutionError(
            "release_sha must be a full lowercase 40-character commit SHA."
        )
    if not os.environ.get("GH_TOKEN"):
        raise ReleaseResolutionError("A job-scoped GitHub token is required.")

    successful_ci_run(repository, release_sha)

    artifact_name = f"deployment-images-{release_sha}"
    publisher_run_id, _ = matching_artifact(repository, artifact_name)
    with tempfile.TemporaryDirectory(prefix="dirtyduty-release-") as temporary_directory:
        manifest_path = download_manifest(
            publisher_run_id, artifact_name, Path(temporary_directory)
        )
        backend_image, frontend_image = parse_manifest(manifest_path, release_sha)

    output_path = Path(os.environ["GITHUB_OUTPUT"])
    with output_path.open("a", encoding="utf-8") as output:
        output.write(f"backend_image={backend_image}\n")
        output.write(f"frontend_image={frontend_image}\n")

    print(
        f"Resolved successful publication run {publisher_run_id} "
        f"for commit {release_sha}; both immutable image references validated."
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ReleaseResolutionError, OSError, subprocess.TimeoutExpired) as error:
        message = (
            str(error)
            if isinstance(error, ReleaseResolutionError)
            else "Release resolution failed."
        )
        print(f"::error::{message}", file=sys.stderr)
        sys.exit(1)
