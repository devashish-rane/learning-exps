"""Docker Compose orchestration helpers."""

from __future__ import annotations

import asyncio
import json
import shlex
import shutil
from asyncio import Lock
from dataclasses import dataclass
from time import monotonic
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from docker import DockerClient
from docker.errors import DockerException

from tracking_compose_backend.config import DockerSettings
from tracking_compose_backend.services.models import ServiceMetadata
from tracking_compose_backend.utils.diagnostics import DiagnosticError
from tracking_compose_backend.utils.logging import Logger

_DEFAULT_INTERNAL_PORT = 8080
_DEFAULT_HEALTH_PATH = "/actuator/health"


class ComposeServiceManager:
    """High-level façade around Docker Engine + Compose interactions.

    The manager keeps Docker SDK usage isolated behind asynchronous wrappers so FastAPI request handlers can await
    operations without blocking the event loop. For Compose graph resolution we still rely on shelling out to the
    Docker CLI because it faithfully applies overrides and profiles just like developers expect. Outputs are cached
    briefly so polling loops (health, metrics) avoid expensive config recomputation while still picking up edits
    quickly.
    """

    def __init__(self, settings: DockerSettings, logger: Logger) -> None:
        self._settings = settings
        self._logger = logger
        self._docker: DockerClient | None = None
        self._compose_cache: dict[Path, _ComposeCacheEntry] = {}
        self._cache_lock = Lock()

    async def aclose(self) -> None:
        """Release docker resources."""

        if self._docker:
            self._docker.close()
            self._docker = None

    async def _client(self) -> DockerClient:
        """Return a cached Docker client, constructing one on demand."""

        if self._docker is None:
            try:
                self._docker = DockerClient.from_env()
                await asyncio.to_thread(self._docker.ping)
            except DockerException as exc:  # pragma: no cover - requires Docker daemon
                raise DiagnosticError(
                    "DockerUnavailable",
                    "Failed to connect to the Docker Engine. Ensure Docker Desktop or dockerd is running.",
                    detail=str(exc),
                ) from exc
        return self._docker

    async def list_services(self) -> Sequence[ServiceMetadata]:
        """Return Compose services enriched with live container status."""

        return await self.discovered_services(include_status=True)

    async def discovered_services(self, include_status: bool = False) -> Sequence[ServiceMetadata]:
        """Return metadata for discovered services.

        Args:
            include_status: When ``True`` the manager queries Docker for container status. We keep this optional so
                background pollers can reuse the discovery graph without triggering heavy Docker lookups.
        """

        if not self._settings.discovery_roots:
            raise DiagnosticError(
                "ComposeDiscoveryRootsMissing",
                "No discovery roots configured; set DOCKHAND_DOCKER_DISCOVERY_ROOTS.",
            )

        compose_cmd = shlex.split(self._settings.compose_binary)
        if shutil.which(compose_cmd[0]) is None:
            raise DiagnosticError(
                "ComposeBinaryMissing",
                f"Compose binary '{compose_cmd[0]}' not found. Install Docker Compose v2 or adjust DOCKHAND_DOCKER_COMPOSE_BINARY.",
            )

        services: list[ServiceMetadata] = []
        for root in self._settings.discovery_roots:
            project_root = Path(root)
            if not project_root.exists():
                continue

            config = await self._load_compose_config(project_root, compose_cmd)
            project_name = config.get("name")
            for service_name, payload in config.get("services", {}).items():
                metadata = self._build_metadata(service_name, payload, project_name)
                if include_status:
                    metadata = await self.service_status(metadata)
                services.append(metadata)

        return services

    async def service_status(self, service: ServiceMetadata) -> ServiceMetadata:
        """Enrich the provided service metadata with live container status."""

        client = await self._client()
        containers = await asyncio.to_thread(
            client.containers.list,
            filters={"label": f"com.docker.compose.service={service.name}"},
        )
        if not containers:
            service.mark_status("stopped")
            return service

        status_counts: dict[str, int] = {}
        for container in containers:
            status = container.status
            status_counts[status] = status_counts.get(status, 0) + 1

        dominant_status = max(status_counts, key=status_counts.get)
        service.mark_status(dominant_status)
        return service

    async def dependency_graph(self) -> dict[str, Any]:
        """Return adjacency lists capturing depends_on relationships and their reverse mapping."""

        services = await self.discovered_services(include_status=False)
        nodes: dict[str, dict[str, Any]] = {}
        reverse: dict[str, set[str]] = {}
        edges: list[dict[str, str]] = []
        for service in services:
            nodes[service.name] = {
                "depends_on": list(service.depends_on),
                "profiles": list(service.profiles),
                "status": service.status,
            }
            for dependency in service.depends_on:
                edges.append({"from": service.name, "to": dependency})
                reverse.setdefault(dependency, set()).add(service.name)
        reverse_serialized = {name: sorted(targets) for name, targets in reverse.items()}
        return {"nodes": nodes, "edges": edges, "reverse": reverse_serialized}

    async def url_index(self) -> list[dict[str, str | None]]:
        """Return the best-guess base, docs, and health URLs for each service."""

        services = await self.discovered_services(include_status=False)
        index: list[dict[str, str | None]] = []
        for service in services:
            index.append(
                {
                    "service": service.name,
                    "baseUrl": service.base_urls[0] if service.base_urls else None,
                    "healthUrl": service.health_urls[0] if service.health_urls else None,
                    "docsUrl": service.docs_urls[0] if service.docs_urls else None,
                }
            )
        return index

    async def logs_for_trace(self, trace_id: str, tail_lines: int) -> list[str]:
        """Return log lines across services that contain the provided ``trace_id`` value."""

        client = await self._client()
        services = await self.discovered_services(include_status=False)
        matches: list[str] = []
        for service in services:
            containers = await asyncio.to_thread(
                client.containers.list,
                filters={"label": f"com.docker.compose.service={service.name}"},
                all=True,
            )
            for container in containers:
                raw = await asyncio.to_thread(container.logs, tail=tail_lines)
                for line in raw.decode(errors="replace").splitlines():
                    if trace_id in line:
                        matches.append(f"{service.name}|{container.short_id}: {line.strip()}")
        return matches

    async def start_services(self, services: Sequence[str]) -> None:
        """Start the requested Compose services respecting dependency order."""

        await self._run_compose_command("up", "--detach", *services)

    async def stop_services(self, services: Sequence[str]) -> None:
        """Stop the requested Compose services."""

        await self._run_compose_command("stop", *services)

    async def restart_services(self, services: Sequence[str]) -> None:
        """Restart the requested services."""

        await self._run_compose_command("restart", *services)

    async def _run_compose_command(self, *args: str) -> None:
        compose_cmd = shlex.split(self._settings.compose_binary)
        if shutil.which(compose_cmd[0]) is None:
            raise DiagnosticError(
                "ComposeBinaryMissing",
                f"Compose binary '{compose_cmd[0]}' not found. Install Docker Compose v2 or adjust DOCKHAND_DOCKER_COMPOSE_BINARY.",
            )

        if not self._settings.discovery_roots:
            raise DiagnosticError(
                "ComposeDiscoveryRootsMissing",
                "No discovery roots configured; set DOCKHAND_DOCKER_DISCOVERY_ROOTS.",
            )

        process = await asyncio.create_subprocess_exec(
            *compose_cmd,
            *args,
            cwd=str(self._settings.discovery_roots[0]),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            self._logger.error(
                "compose_command_failed",
                extra={"args": args, "stderr": stderr.decode(), "stdout": stdout.decode()},
            )
            raise DiagnosticError(
                "ComposeCommandFailed",
                "Compose command failed. Review stdout/stderr for diagnostics.",
                detail=stderr.decode(),
            )

    async def _load_compose_config(self, root: Path, compose_cmd: list[str]) -> dict[str, Any]:
        """Return the cached Compose config for ``root`` or resolve it if stale."""

        async with self._cache_lock:
            cached = self._compose_cache.get(root)
            if cached and monotonic() - cached.timestamp < self._settings.config_cache_ttl_seconds:
                return cached.config

        process = await asyncio.create_subprocess_exec(
            *compose_cmd,
            "config",
            "--format",
            "json",
            cwd=str(root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            self._logger.error(
                "compose_config_failed",
                extra={"cwd": str(root), "stderr": stderr.decode()},
            )
            raise DiagnosticError(
                "ComposeConfigFailed",
                f"Compose failed to resolve in {root}. Inspect stderr for hints.",
                detail=stderr.decode(),
            )

        config: dict[str, Any] = json.loads(stdout.decode())
        entry = _ComposeCacheEntry(timestamp=monotonic(), config=config)
        async with self._cache_lock:
            self._compose_cache[root] = entry
        return config

    def _build_metadata(
        self, service_name: str, payload: dict[str, Any], project_name: str | None
    ) -> ServiceMetadata:
        """Construct :class:`ServiceMetadata` including derived URLs and dependency data."""

        published_ports, container_ports = _parse_ports(payload.get("ports", []))
        x_dev = payload.get("x-dev", {}) or {}
        depends_on = tuple(sorted(_coerce_depends_on(payload.get("depends_on", {}))))
        profiles = tuple(sorted(payload.get("profiles", [])))
        base_urls = _derive_base_urls(service_name, published_ports, container_ports, x_dev)
        health_urls = _derive_health_urls(base_urls, service_name, container_ports, x_dev)
        docs_urls = _derive_docs_urls(base_urls, x_dev)
        metrics_urls = _derive_metrics_urls(base_urls, service_name, container_ports, x_dev)

        return ServiceMetadata(
            name=service_name,
            status="unknown",
            compose_project=project_name,
            ports=published_ports,
            tags=tuple(x_dev.get("tags", [])),
            depends_on=depends_on,
            profiles=profiles,
            base_urls=base_urls,
            health_urls=health_urls,
            docs_urls=docs_urls,
            metrics_urls=metrics_urls,
        )


@dataclass(slots=True)
class _ComposeCacheEntry:
    """Internal cache entry used to avoid thrashing `docker compose config`."""

    timestamp: float
    config: dict[str, Any]


def _parse_ports(entries: Iterable[Any]) -> tuple[dict[int, int], list[int]]:
    """Return a mapping of published→container ports and a list of container ports encountered."""

    published: dict[int, int] = {}
    container_ports: list[int] = []
    for entry in entries:
        host_port: int | None = None
        container_port: int | None = None
        if isinstance(entry, str):
            parts = entry.split(":")
            if len(parts) == 1:
                container_port = _safe_int(parts[0])
            else:
                host_port = _safe_int(parts[-2])
                container_port = _safe_int(parts[-1])
        elif isinstance(entry, dict):
            host_port = _safe_int(entry.get("published") or entry.get("host"))
            container_port = _safe_int(entry.get("target") or entry.get("container"))
        if container_port is None:
            continue
        container_ports.append(container_port)
        if host_port is not None:
            published[host_port] = container_port
    return published, container_ports


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_depends_on(raw: Any) -> Iterable[str]:
    if isinstance(raw, dict):
        return raw.keys()
    if isinstance(raw, (list, tuple, set)):
        return raw
    return []


def _derive_base_urls(
    service_name: str,
    published_ports: Mapping[int, int],
    container_ports: Sequence[int],
    x_dev: dict[str, Any],
) -> tuple[str, ...]:
    base_urls: list[str] = []
    for host_port in sorted(published_ports):
        base_urls.append(f"http://localhost:{host_port}")
    preferred_container_port = _safe_int(x_dev.get("port"))
    if preferred_container_port is None and container_ports:
        preferred_container_port = container_ports[0]
    if preferred_container_port is None:
        preferred_container_port = _DEFAULT_INTERNAL_PORT
    base_urls.append(f"http://{service_name}:{preferred_container_port}")
    seen: set[str] = set()
    deduped: list[str] = []
    for url in base_urls:
        if url not in seen:
            deduped.append(url)
            seen.add(url)
    return tuple(deduped)


def _derive_health_urls(
    base_urls: Sequence[str],
    service_name: str,
    container_ports: Sequence[int],
    x_dev: dict[str, Any],
) -> tuple[str, ...]:
    health_path = str(x_dev.get("health") or _DEFAULT_HEALTH_PATH)
    urls = [urljoin(base_url + "/", health_path.lstrip("/")) for base_url in base_urls]
    if not base_urls:
        port = _safe_int(x_dev.get("port")) or (container_ports[0] if container_ports else _DEFAULT_INTERNAL_PORT)
        urls.append(f"http://{service_name}:{port}{health_path}")
    return tuple(dict.fromkeys(urls))


def _derive_docs_urls(base_urls: Sequence[str], x_dev: dict[str, Any]) -> tuple[str, ...]:
    docs_path = x_dev.get("docs")
    if not docs_path:
        return tuple()
    urls = [urljoin(base + "/", str(docs_path).lstrip("/")) for base in base_urls]
    return tuple(dict.fromkeys(urls))


def _derive_metrics_urls(
    base_urls: Sequence[str],
    service_name: str,
    container_ports: Sequence[int],
    x_dev: dict[str, Any],
) -> tuple[str, ...]:
    urls = [urljoin(base + "/", "actuator/metrics/http.server.requests") for base in base_urls]
    if urls:
        return tuple(dict.fromkeys(urls))
    port = _safe_int(x_dev.get("port")) or (container_ports[0] if container_ports else _DEFAULT_INTERNAL_PORT)
    return (f"http://{service_name}:{port}/actuator/metrics/http.server.requests",)


__all__ = ["ComposeServiceManager"]
