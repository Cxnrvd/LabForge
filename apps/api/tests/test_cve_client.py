"""Tests for the NVD CVE client — cache, retry, error handling."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from labforge_core.services import cve_client


_FAKE_CVE = {
    "vulnerabilities": [
        {
            "cve": {
                "id": "CVE-2099-0001",
                "descriptions": [{"lang": "en", "value": "Fake CVE for tests."}],
                "metrics": {
                    "cvssMetricV31": [
                        {
                            "cvssData": {
                                "baseScore": 9.8,
                                "baseSeverity": "CRITICAL",
                            },
                        }
                    ]
                },
                "configurations": [],
                "references": [{"url": "https://example.invalid/"}],
            }
        }
    ]
}


@pytest.mark.asyncio
async def test_search_caches_repeat_query():
    """Two back-to-back searches with the same query should only hit NVD once."""
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        route = mock.get("/rest/json/cves/2.0").mock(
            return_value=httpx.Response(200, json=_FAKE_CVE)
        )
        out1 = await cve_client.search_cves("log4shell")
        out2 = await cve_client.search_cves("log4shell")
    assert out1[0].id == "CVE-2099-0001"
    assert out2[0].id == "CVE-2099-0001"
    assert route.call_count == 1, "cache should have served the second call"


@pytest.mark.asyncio
async def test_search_retries_on_429():
    """429 must trigger backoff + retry, not immediate failure."""
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        route = mock.get("/rest/json/cves/2.0").mock(
            side_effect=[
                httpx.Response(429, json={"message": "slow down"}),
                httpx.Response(200, json=_FAKE_CVE),
            ]
        )
        out = await cve_client.search_cves("anything")
    assert out[0].id == "CVE-2099-0001"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_search_404_returns_empty():
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        mock.get("/rest/json/cves/2.0").mock(return_value=httpx.Response(404))
        out = await cve_client.search_cves("missing")
    assert out == []


@pytest.mark.asyncio
async def test_get_cve_not_found_raises():
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        mock.get("/rest/json/cves/2.0").mock(
            return_value=httpx.Response(200, json={"vulnerabilities": []})
        )
        with pytest.raises(cve_client.CVENotFound):
            await cve_client.get_cve("CVE-1999-9999")


@pytest.mark.asyncio
async def test_search_stale_while_revalidate():
    """If the cache has a stale entry and NVD errors, we serve the stale value."""
    # Seed the cache with a known good response, then expire it manually.
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        mock.get("/rest/json/cves/2.0").mock(
            return_value=httpx.Response(200, json=_FAKE_CVE)
        )
        await cve_client.search_cves("seed")
    # Force expiry
    from labforge_core.services.nvd_cache import search_cache
    for key, entry in list(search_cache._store.items()):  # noqa: SLF001
        entry.expires_at = 0
    # Now NVD only returns 500s — the stale entry should still come back.
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        mock.get("/rest/json/cves/2.0").mock(
            return_value=httpx.Response(500, json={"error": "down"})
        )
        out = await cve_client.search_cves("seed")
    assert out[0].id == "CVE-2099-0001"


@pytest.mark.asyncio
async def test_cve_id_query_uses_cveId_param():
    with respx.mock(base_url="https://services.nvd.nist.gov") as mock:
        route = mock.get("/rest/json/cves/2.0").mock(
            return_value=httpx.Response(200, json=_FAKE_CVE)
        )
        await cve_client.search_cves("CVE-2021-44228")
    request = route.calls[0].request
    assert "cveId=CVE-2021-44228" in str(request.url)
