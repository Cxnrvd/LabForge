"""Token-bucket rate limiter (no external dependency).

Why not slowapi? Slowapi adds a runtime dep, requires Starlette wiring,
and only gives per-IP windows. We have a much smaller surface (5 routes
that need limiting: ``/generate``, ``/cves/search``, ``/cves/{id}``, the
WebSocket subscribe, and ``/labs/{id}/heartbeat`` POST) so a 70-line
token-bucket inline is fine and removes one external moving part.

Each route declares its limit by decorating its FastAPI handler with
``@limit("name", capacity=N, per_seconds=S)``. The limiter keys on the
client IP from ``X-Forwarded-For`` (first hop) falling back to
``request.client.host``.

Per-IP is a coarse proxy for per-user; once we add a real user system
swap this to key on the user id instead.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request, status

_LOGGER = logging.getLogger("labforge.rate_limit")


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


_BUCKETS: dict[tuple[str, str], _Bucket] = {}
_LOCK = asyncio.Lock()


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


async def _consume(name: str, key: str, capacity: int, per_seconds: float) -> bool:
    """Return True if the request is allowed, False if it should be rejected."""
    now = time.monotonic()
    refill_rate = capacity / per_seconds  # tokens / second
    async with _LOCK:
        bucket = _BUCKETS.get((name, key))
        if bucket is None:
            bucket = _Bucket(tokens=capacity, last_refill=now)
            _BUCKETS[(name, key)] = bucket
        elapsed = now - bucket.last_refill
        bucket.tokens = min(capacity, bucket.tokens + elapsed * refill_rate)
        bucket.last_refill = now
        if bucket.tokens < 1:
            return False
        bucket.tokens -= 1
        return True


def limit(name: str, *, capacity: int, per_seconds: float):
    """Decorator factory. Wrap an async FastAPI handler."""

    def wrap(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(fn)
        async def inner(*args: Any, **kwargs: Any) -> Any:
            # FastAPI passes ``Request`` as a kwarg only if the handler
            # declares it. We accept either pattern.
            request: Request | None = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
            key = _client_key(request) if request is not None else "global"
            allowed = await _consume(name, key, capacity, per_seconds)
            if not allowed:
                _LOGGER.info(
                    "rate_limit_block",
                    extra={"limiter": name, "key": key, "capacity": capacity},
                )
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "detail": f"Rate limit exceeded ({name})",
                        "code": "rate_limited",
                        "retry_after_seconds": int(per_seconds),
                    },
                    headers={"Retry-After": str(int(per_seconds))},
                )
            return await fn(*args, **kwargs)

        return inner

    return wrap


def rate_limited(name: str, *, capacity: int, per_seconds: float):
    """FastAPI dependency twin of ``limit`` for handlers that are plain ``def`` (run in the thread
    pool because they shell out to Docker). Use it as ``dependencies=[rate_limited(...)]``."""
    from fastapi import Depends

    async def check(request: Request) -> None:
        key = _client_key(request)
        if not await _consume(name, key, capacity, per_seconds):
            _LOGGER.info("rate_limit_block", extra={"limiter": name, "key": key, "capacity": capacity})
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "detail": f"Rate limit exceeded ({name})",
                    "code": "rate_limited",
                    "retry_after_seconds": int(per_seconds),
                },
                headers={"Retry-After": str(int(per_seconds))},
            )

    return Depends(check)


def reset_for_tests() -> None:
    """Used by the pytest harness to clear bucket state between cases."""
    _BUCKETS.clear()
