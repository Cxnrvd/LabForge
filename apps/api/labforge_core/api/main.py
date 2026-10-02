"""LabForge FastAPI application."""

from __future__ import annotations

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from labforge_core.api.routers import cves, generate, host, labs, templates, topologies
from labforge_core.logging_setup import configure_logging
from labforge_core.models import create_db_and_tables, get_session
from labforge_core.provisioners.role_registry import load_plugins as _load_role_plugins
from labforge_core.services.build_runner import reattach_daemons, reconcile_orphan_builds
from labforge_core.settings import get_settings

configure_logging()
_LOGGER = logging.getLogger("labforge.api")

# Eagerly load any role-installer plugins so the generator sees them on
# the first request, not the second.
_load_role_plugins()


_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}  # 0.0.0.0 is handled separately


def _detected_bind_host() -> str:
    """Inspect argv for the uvicorn ``--host`` flag.

    Uvicorn binds before our lifespan runs, so this is the only signal
    we have. Returns the default (``127.0.0.1``) when no flag is set.
    """
    args = sys.argv
    for i, arg in enumerate(args):
        if arg == "--host" and i + 1 < len(args):
            return args[i + 1].strip()
        if arg.startswith("--host="):
            return arg.split("=", 1)[1].strip()
    return "127.0.0.1"


def _is_safe_dev_bind(host: str) -> bool:
    """Loopback addresses are safe to expose with auth disabled.

    ``0.0.0.0`` listens on every interface — that is explicitly unsafe
    when LABFORGE_AGENT_TOKEN is unset, so we treat it as non-loopback.
    """
    return host in {"127.0.0.1", "localhost", "::1"}


def _enforce_auth_or_loopback() -> None:
    """Refuse to bind on non-loopback interfaces without an agent token.

    Without LABFORGE_AGENT_TOKEN every write endpoint is open. Reachable
    from the network that is an unauthenticated remote-code-execution
    surface (POST /labs/build runs arbitrary topologies through
    `vagrant up`), so we fail closed rather than just warning.
    """
    settings = get_settings()
    if settings.agent_token:
        return
    host = _detected_bind_host()
    if _is_safe_dev_bind(host):
        _LOGGER.critical(
            "auth_disabled",
            extra={
                "msg_detail": (
                    f"LABFORGE_AGENT_TOKEN is unset and the API is bound to {host} — "
                    "write endpoints are open. Set this env var before exposing the "
                    "API to anything beyond loopback."
                )
            },
        )
        return
    msg = (
        f"Refusing to start: bound to {host!r} but LABFORGE_AGENT_TOKEN is "
        "unset. Either set the token or bind to 127.0.0.1."
    )
    _LOGGER.critical("auth_required_for_non_loopback", extra={"msg_detail": msg})
    raise SystemExit(msg)


_enforce_auth_or_loopback()


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_db_and_tables()
    # Reconcile any builds whose host process died between API restarts.
    # Without this, a lab can sit in `building` forever after a crash.
    try:
        session_gen = get_session()
        session = next(session_gen)
        try:
            reconcile_orphan_builds(session)
            reattach_daemons(session)
        finally:
            with suppress(StopIteration):
                next(session_gen)
    except Exception as exc:
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
    # Explicit allowlist instead of "*" — every browser-driven verb the
    # web app actually issues. Add new verbs here when new endpoints
    # require them; "*" interacts badly with allow_credentials=True
    # under spec, and surfaces accidentally-exposed methods.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin"],
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
app.include_router(host.router, prefix=API_PREFIX)
