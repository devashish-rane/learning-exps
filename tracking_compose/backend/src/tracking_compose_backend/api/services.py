"""Service lifecycle endpoints."""

from __future__ import annotations

from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, status

from tracking_compose_backend.services.compose_manager import ComposeServiceManager
from tracking_compose_backend.services.models import ServiceMetadata
from tracking_compose_backend.utils.diagnostics import DiagnosticError

from .dependencies import compose_manager_dep

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("")
async def list_services(manager: ComposeServiceManager = Depends(compose_manager_dep)) -> list[dict[str, object]]:
    """Return Compose services along with their current container state."""

    services = await manager.list_services()
    enriched = [await manager.service_status(service) for service in services]
    return [_serialize_service(service) for service in enriched]


def _serialize_service(service: ServiceMetadata) -> dict[str, object]:
    return {
        "name": service.name,
        "status": service.status,
        "last_state_change": service.last_state_change.isoformat(),
        "compose_project": service.compose_project,
        "ports": {str(host): container for host, container in service.ports.items()},
        "tags": list(service.tags),
        "depends_on": list(service.depends_on),
        "profiles": list(service.profiles),
        "base_urls": list(service.base_urls),
        "health_urls": list(service.health_urls),
        "docs_urls": list(service.docs_urls),
        "metrics_urls": list(service.metrics_urls),
    }



def _services_from_payload(payload: dict[str, Sequence[str]]) -> Sequence[str]:
    services = payload.get("services", [])
    if not services:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one service is required",
        )
    return services


@router.post("/actions/start", status_code=status.HTTP_202_ACCEPTED)
async def start_services(
    payload: dict[str, Sequence[str]],
    manager: ComposeServiceManager = Depends(compose_manager_dep),
) -> dict[str, str]:
    services = _services_from_payload(payload)
    try:
        await manager.start_services(services)
    except DiagnosticError as diagnostic:
        raise HTTPException(status_code=502, detail=diagnostic.message) from diagnostic
    return {"status": "starting", "services": list(services)}


@router.post("/actions/stop", status_code=status.HTTP_202_ACCEPTED)
async def stop_services(
    payload: dict[str, Sequence[str]],
    manager: ComposeServiceManager = Depends(compose_manager_dep),
) -> dict[str, str]:
    services = _services_from_payload(payload)
    try:
        await manager.stop_services(services)
    except DiagnosticError as diagnostic:
        raise HTTPException(status_code=502, detail=diagnostic.message) from diagnostic
    return {"status": "stopping", "services": list(services)}


@router.post("/actions/restart", status_code=status.HTTP_202_ACCEPTED)
async def restart_services(
    payload: dict[str, Sequence[str]],
    manager: ComposeServiceManager = Depends(compose_manager_dep),
) -> dict[str, str]:
    services = _services_from_payload(payload)
    try:
        await manager.restart_services(services)
    except DiagnosticError as diagnostic:
        raise HTTPException(status_code=502, detail=diagnostic.message) from diagnostic
    return {"status": "restarting", "services": list(services)}


__all__ = ["router"]
