"""Health dashboard endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tracking_compose_backend.services.health_monitor import HealthMonitor

from .dependencies import health_monitor_dep

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health_snapshot(monitor: HealthMonitor = Depends(health_monitor_dep)) -> dict[str, object]:
    """Return the latest cached health snapshots."""

    snapshots = monitor.latest()
    serialized: dict[str, dict[str, object]] = {}
    for name, snapshot in snapshots.items():
        serialized[name] = {
            "service_name": snapshot.service_name,
            "healthy": snapshot.healthy,
            "latency_ms": snapshot.latency_ms,
            "status_code": snapshot.status_code,
            "url": snapshot.url,
            "taken_at": snapshot.taken_at.isoformat(),
            "details": dict(snapshot.details),
        }
    return serialized


__all__ = ["router"]
