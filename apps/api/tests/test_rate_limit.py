"""Token-bucket rate limiter unit tests."""

from __future__ import annotations

import asyncio

import pytest

from labforge_core.api.rate_limit import _consume, reset_for_tests


@pytest.mark.asyncio
async def test_allows_under_capacity():
    reset_for_tests()
    for _ in range(5):
        ok = await _consume("test", "1.2.3.4", capacity=5, per_seconds=60)
        assert ok


@pytest.mark.asyncio
async def test_blocks_over_capacity():
    reset_for_tests()
    for _ in range(3):
        await _consume("over", "1.2.3.4", capacity=3, per_seconds=60)
    blocked = await _consume("over", "1.2.3.4", capacity=3, per_seconds=60)
    assert blocked is False


@pytest.mark.asyncio
async def test_different_keys_are_isolated():
    reset_for_tests()
    for _ in range(3):
        await _consume("iso", "1.1.1.1", capacity=3, per_seconds=60)
    # Different IP should still have a full bucket.
    fresh = await _consume("iso", "2.2.2.2", capacity=3, per_seconds=60)
    assert fresh is True


@pytest.mark.asyncio
async def test_refills_over_time():
    reset_for_tests()
    # Tiny window so refill is observable in test time.
    for _ in range(2):
        await _consume("refill", "1.1.1.1", capacity=2, per_seconds=0.2)
    blocked = await _consume("refill", "1.1.1.1", capacity=2, per_seconds=0.2)
    assert blocked is False
    await asyncio.sleep(0.25)
    refilled = await _consume("refill", "1.1.1.1", capacity=2, per_seconds=0.2)
    assert refilled is True
