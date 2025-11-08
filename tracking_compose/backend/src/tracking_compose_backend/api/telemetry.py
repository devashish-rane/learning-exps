"""Telemetry endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tracking_compose_backend.services.telemetry_aggregator import TelemetryAggregator

from .dependencies import telemetry_dep

router = APIRouter(prefix="/api/metrics", tags=["telemetry"])


@router.get("/http")
async def http_metrics(telemetry: TelemetryAggregator = Depends(telemetry_dep)) -> dict[str, object]:
    """Return cached HTTP endpoint percentiles."""

    metrics = telemetry.latest()
    serialized: dict[str, list[dict[str, object]]] = {}
    for service, datapoints in metrics.items():
        serialized[service] = [data.__dict__ for data in datapoints]
    return serialized


__all__ = ["router"]
