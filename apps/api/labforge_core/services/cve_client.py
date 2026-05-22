"""Async client for the NVD CVE API v2.

Hardened with:
  * Per-process TTL cache (15 min search, 1 h single-lookup) — see
    ``services.nvd_cache``.
  * Exponential backoff with jitter on 429 / 5xx (up to 3 retries).
  * Stale-while-revalidate so the UI keeps working through transient
    NVD outages.
  * Honours the ``LABFORGE_NVD_API_KEY`` env var if set, which lifts the
    NVD rate limit from 5 to 50 requests / 30 s.

The blocking httpx.AsyncClient is created per call to avoid sharing it
across event loops. For higher RPS a long-lived client pool can be wired
in later.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

import httpx
from labforge_schema import CVEEntry, Severity

from labforge_core.services.nvd_cache import lookup_cache, search_cache
from labforge_core.settings import get_settings

_LOGGER = logging.getLogger("labforge.cve_client")

# Retry tuning. We don't retry on 4xx (other than 429) because those won't
# succeed on a second try — they're caller errors.
_MAX_ATTEMPTS = 3
_BASE_BACKOFF = 0.6  # seconds
_MAX_BACKOFF = 4.0


class CVEClientError(Exception):
    pass


class CVENotFound(CVEClientError):
    def __init__(self, cve_id: str) -> None:
        super().__init__(f"CVE not found: {cve_id}")
        self.cve_id = cve_id


async def _sleep_backoff(attempt: int) -> None:
    delay = min(_BASE_BACKOFF * (2 ** (attempt - 1)), _MAX_BACKOFF)
    # Full jitter to avoid retry stampedes.
    await asyncio.sleep(random.uniform(0, delay))


def _pick_severity(metrics: dict[str, Any]) -> tuple[Severity, float | None]:
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key) or []
        if not entries:
            continue
        primary = entries[0]
        data = primary.get("cvssData") or {}
        score = data.get("baseScore")
        sev = data.get("baseSeverity") or primary.get("baseSeverity")
        if sev:
            try:
                return Severity(sev.upper()), float(score) if score is not None else None
            except ValueError:
                continue
    return Severity.NONE, None


def _pick_english_description(descriptions: list[dict[str, Any]]) -> str:
    for entry in descriptions:
        if entry.get("lang") == "en":
            return entry.get("value", "")
    return descriptions[0].get("value", "") if descriptions else ""


def _affected_products(cve: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for config in cve.get("configurations", []) or []:
        for node in config.get("nodes", []) or []:
            for match in node.get("cpeMatch", []) or []:
                criteria = match.get("criteria")
                if criteria and criteria not in out:
                    out.append(criteria)
    return out[:20]


def _references(cve: dict[str, Any]) -> list[str]:
    return [ref.get("url", "") for ref in (cve.get("references") or []) if ref.get("url")][:20]


def _to_entry(cve: dict[str, Any]) -> CVEEntry:
    severity, score = _pick_severity(cve.get("metrics", {}) or {})
    return CVEEntry(
        id=cve["id"],
        description=_pick_english_description(cve.get("descriptions") or []),
        severity=severity,
        cvss_score=score,
        published=cve.get("published"),
        affected_products=_affected_products(cve),
        references=_references(cve),
    )


async def _fetch_nvd(params: dict[str, Any]) -> dict[str, Any]:
    """Single-flight HTTP GET with backoff on 429 / 5xx / network errors."""
    settings = get_settings()
    headers: dict[str, str] = {}
    if settings.nvd_api_key:
        headers["apiKey"] = settings.nvd_api_key

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=settings.nvd_timeout_seconds) as client:
                response = await client.get(
                    settings.nvd_api_base, params=params, headers=headers
                )
            if response.status_code == 404:
                return {"vulnerabilities": []}
            if response.status_code == 429 or 500 <= response.status_code < 600:
                _LOGGER.warning(
                    "nvd_retry",
                    extra={
                        "attempt": attempt,
                        "status": response.status_code,
                        "params": params,
                    },
                )
                last_exc = CVEClientError(
                    f"NVD returned HTTP {response.status_code}"
                )
                if attempt < _MAX_ATTEMPTS:
                    await _sleep_backoff(attempt)
                    continue
                raise last_exc
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise CVEClientError(
                f"NVD returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            last_exc = CVEClientError(f"NVD request failed: {exc}")
            _LOGGER.warning(
                "nvd_network_retry",
                extra={"attempt": attempt, "error": str(exc)},
            )
            if attempt < _MAX_ATTEMPTS:
                await _sleep_backoff(attempt)
                continue
            raise last_exc from exc

    # Unreachable, but keeps mypy honest.
    raise last_exc or CVEClientError("NVD request failed (no attempts succeeded)")


async def search_cves(query: str, *, limit: int = 10) -> list[CVEEntry]:
    """Search the NVD by CVE-ID or keyword.

    If ``query`` matches the CVE-ID pattern, the API is called with
    ``cveId=``. Otherwise we fall back to ``keywordSearch=``. Results are
    cached for 15 minutes per (query, limit) pair.
    """
    bounded_limit = min(max(limit, 1), 50)
    is_cve_id = query.upper().startswith("CVE-")
    cache_key = (query.lower(), bounded_limit)

    async def fetcher() -> list[CVEEntry]:
        params: dict[str, Any] = {"resultsPerPage": bounded_limit}
        if is_cve_id:
            params["cveId"] = query.upper()
        else:
            params["keywordSearch"] = query
        payload = await _fetch_nvd(params)
        vulns = payload.get("vulnerabilities") or []
        return [_to_entry(v["cve"]) for v in vulns if "cve" in v]

    return await search_cache.get_or_fetch(cache_key, fetcher)


async def get_cve(cve_id: str) -> CVEEntry:
    normalized = cve_id.upper()

    async def fetcher() -> CVEEntry:
        results = await search_cves(normalized, limit=1)
        if not results:
            raise CVENotFound(normalized)
        return results[0]

    return await lookup_cache.get_or_fetch(normalized, fetcher)
