"""Trace exploration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tracking_compose_backend.services.trace_service import TraceService

from .dependencies import trace_service_dep

router = APIRouter(prefix="/api/traces", tags=["traces"])


@router.get("/{trace_id}")
async def get_trace(trace_id: str, trace_service: TraceService = Depends(trace_service_dep)) -> dict[str, object]:
    """Fetch a trace and return a serialized representation."""

    trace = await trace_service.fetch_trace(trace_id)
    return trace


__all__ = ["router"]
