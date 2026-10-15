"""Structured logging setup for the LabForge API.

Emits one JSON object per line on stderr. This is the format every modern
log aggregator (Datadog, Loki, CloudWatch, vector.dev, otel-collector,
etc.) wants — keys are flat, values are scalars or strings, the record's
``extra`` payload is merged in.

Stdlib only; no extra runtime dep. If you want OpenTelemetry traces later,
swap ``_JSONFormatter`` for the OTel logging handler — the call sites
don't change.
"""

from __future__ import annotations

import json
import logging
import logging.config
import os
import sys
import time
from typing import Any

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


class _JSONFormatter(logging.Formatter):
    """Render LogRecord -> single-line JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = _safe(value)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), default=str)


def _safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def configure_logging() -> None:
    """Idempotent: safe to call multiple times under uvicorn --reload."""
    level = os.environ.get("LABFORGE_LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(stream=sys.stderr)
    handler.setFormatter(_JSONFormatter())
    root = logging.getLogger()
    # Replace any existing handlers we previously installed; leave any
    # that uvicorn put in place alone.
    for existing in list(root.handlers):
        if getattr(existing, "_labforge", False):
            root.removeHandler(existing)
    handler._labforge = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
    # Quiet noisy upstreams.
    logging.getLogger("uvicorn.access").setLevel(level)
    logging.getLogger("httpx").setLevel("WARNING")
