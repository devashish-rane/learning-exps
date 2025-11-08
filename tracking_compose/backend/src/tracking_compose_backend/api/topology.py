"""Topology and discovery endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from tracking_compose_backend.services.compose_manager import ComposeServiceManager

from .dependencies import compose_manager_dep

router = APIRouter(prefix="/api", tags=["topology"])


@router.get("/deps")
async def dependency_graph(manager: ComposeServiceManager = Depends(compose_manager_dep)) -> dict[str, object]:
    """Expose the Compose dependency graph including reverse edges."""

    return await manager.dependency_graph()


@router.get("/urls")
async def url_index(manager: ComposeServiceManager = Depends(compose_manager_dep)) -> list[dict[str, str | None]]:
    """Return the best guess URLs (base, health, docs) for each service."""

    return await manager.url_index()


__all__ = ["router"]
