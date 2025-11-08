"""Utilities for surfacing actionable diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class DiagnosticError(RuntimeError):
    """Error raised when we want to surface a friendly message to the UI."""

    code: str
    message: str
    detail: str | None = None

    def __str__(self) -> str:
        return f"{self.code}: {self.message}" if not self.detail else f"{self.code}: {self.message} ({self.detail})"

    def to_extra(self) -> dict[str, Any]:
        """Return a dict suitable for log enrichment."""

        data = {"code": self.code, "message": self.message}
        if self.detail:
            data["detail"] = self.detail
        return data


__all__ = ["DiagnosticError"]
