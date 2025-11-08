"""Domain models shared across service managers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping


@dataclass(slots=True)
class ServiceMetadata:
    """Captured metadata for a Docker Compose service."""

    name: str
    status: str
    last_state_change: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    compose_project: str | None = None
    ports: Mapping[int, int] = field(default_factory=dict)
    tags: tuple[str, ...] = field(default_factory=tuple)
    depends_on: tuple[str, ...] = field(default_factory=tuple)
    profiles: tuple[str, ...] = field(default_factory=tuple)
    base_urls: tuple[str, ...] = field(default_factory=tuple)
    health_urls: tuple[str, ...] = field(default_factory=tuple)
    docs_urls: tuple[str, ...] = field(default_factory=tuple)
    metrics_urls: tuple[str, ...] = field(default_factory=tuple)

    def mark_status(self, status: str) -> None:
        """Update the service status and timestamp.

        Keeping this helper centralizes the state-change bookkeeping so we can extend it later with additional
        instrumentation (e.g. structured log events).
        """

        self.status = status
        self.last_state_change = datetime.now(timezone.utc)


@dataclass(slots=True)
class HealthSnapshot:
    """Immutable representation of a service health probe."""

    service_name: str
    healthy: bool
    latency_ms: float
    status_code: int | None
    url: str | None
    taken_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    details: Mapping[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EndpointMetrics:
    """Aggregated HTTP metrics for a service endpoint."""

    service_name: str
    method: str
    path: str
    p50_ms: float | None
    p90_ms: float | None
    p99_ms: float | None
    rps: float | None
    error_rate: float | None
    downstream_share: float | None
    self_share: float | None
    sample_size: int | None = None


@dataclass(slots=True)
class TraceSpan:
    """Normalized span payload returned by the tracing adapter."""

    service: str
    operation: str
    duration_ms: float
    start_time_ms: int
    tags: Mapping[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TraceSummary:
    """Represents a trace retrieved from Jaeger/Tempo."""

    trace_id: str
    duration_ms: float
    critical_path_services: tuple[str, ...]
    spans: list[TraceSpan]


@dataclass(slots=True)
class TraceLogCorrelation:
    """Fallback payload when a trace backend is unavailable and we correlate logs instead."""

    trace_id: str
    lines: tuple[str, ...]


__all__ = [
    "ServiceMetadata",
    "HealthSnapshot",
    "EndpointMetrics",
    "TraceSpan",
    "TraceSummary",
    "TraceLogCorrelation",
]
