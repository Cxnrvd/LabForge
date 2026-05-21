"""LabForge FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from labforge_core.api.routers import cves, generate, labs, templates, topologies
from labforge_core.logging_setup import configure_logging
from labforge_core.models import create_db_and_tables, get_session
from labforge_core.provisioners.role_registry import load_plugins as _load_role_plugins
from labforge_core.services.build_runner import reconcile_orphan_builds
from labforge_core.settings import get_settings

configure_logging()
_LOGGER = logging.getLogger("labforge.api")

# Eagerly load any role-installer plugins so the generator sees them on
# the first request, not the second.
_load_role_plugins()


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_db_and_tables()
    settings = get_settings()
    if not settings.agent_token:
        _LOGGER.warning(
            "auth_disabled",
            extra={
                "msg_detail": (
                    "LABFORGE_AGENT_TOKEN is unset — write endpoints are open. "
                    "Set this env var in any non-development deployment."
                )
            },
        )
    # Reconcile any builds whose host process died between API restarts.
    # Without this, a lab can sit in `building` forever after a crash.
    try:
        session_gen = get_session()
        session = next(session_gen)
        try:
            reconcile_orphan_builds(session)
        finally:
            try:
                next(session_gen)
            except StopIteration:
                pass
    except Exception as exc:  # noqa: BLE001 — startup must never block
        _LOGGER.warning("reconcile_failed", extra={"error": str(exc)})
    yield


app = FastAPI(
    title="LabForge API",
    version="0.1.0",
    description="Backend for the LabForge virtual-lab builder.",
    lifespan=_lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc.errors()), "code": "validation_error"},
    )


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {"service": "labforge-api", "version": "0.1.0"}


def _health_payload() -> dict[str, object]:
    return {
        "status": "ok",
        "version": "0.1.0",
        "auth_required": bool(settings.agent_token),
        "nvd_key_set": bool(settings.nvd_api_key),
    }


@app.get("/health", tags=["meta"])
def health() -> dict[str, object]:
    return _health_payload()


API_PREFIX = "/api/v1"


@app.get(f"{API_PREFIX}/health", tags=["meta"])
def health_v1() -> dict[str, object]:
    """Same as /health, but reachable through the Next.js /api/v1 proxy."""
    return _health_payload()



app.include_router(topologies.router, prefix=API_PREFIX)
app.include_router(templates.router, prefix=API_PREFIX)
app.include_router(generate.router, prefix=API_PREFIX)
app.include_router(cves.router, prefix=API_PREFIX)
app.include_router(labs.router, prefix=API_PREFIX)
