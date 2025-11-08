"""Logging helpers built on top of Rich."""

from __future__ import annotations

import logging
from typing import Any

from rich.console import Console
from rich.logging import RichHandler

Logger = logging.Logger


def _configure_root_logger() -> logging.Logger:
    """Configure the process-wide logger once."""

    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            RichHandler(
                console=Console(stderr=True),
                rich_tracebacks=True,
                show_time=True,
                show_level=True,
                show_path=False,
            )
        ],
    )
    return logging.getLogger("dockhand")


_logger: logging.Logger | None = None


def get_logger() -> logging.Logger:
    """Return the application logger, configuring it on first use."""

    global _logger
    if _logger is None:
        _logger = _configure_root_logger()
    return _logger


def log_structured(logger: Logger, event: str, **extra: Any) -> None:
    """Emit a structured log entry with a consistent schema."""

    logger.info("%s", event, extra=extra)


__all__ = ["get_logger", "log_structured", "Logger"]
