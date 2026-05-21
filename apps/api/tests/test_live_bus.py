"""LiveBus pub/sub tests."""

from __future__ import annotations

import asyncio

import pytest

from labforge_core.services.live_bus import LiveBus


@pytest.mark.asyncio
async def test_publish_fans_out_to_subscribers():
    bus = LiveBus()
    queue = await bus.subscribe(42)
    await bus.publish(42, {"hello": "world"})
    message = await asyncio.wait_for(queue.get(), timeout=0.5)
    assert message == {"hello": "world"}


@pytest.mark.asyncio
async def test_publish_skips_other_labs():
    bus = LiveBus()
    queue = await bus.subscribe(1)
    await bus.publish(2, {"foreign": True})
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue.get(), timeout=0.1)


@pytest.mark.asyncio
async def test_unsubscribe_clears_route():
    bus = LiveBus()
    q = await bus.subscribe(3)
    assert bus.subscriber_count(3) == 1
    await bus.unsubscribe(3, q)
    assert bus.subscriber_count(3) == 0


@pytest.mark.asyncio
async def test_overflow_drops_oldest():
    """If a consumer falls behind we drop, not block."""
    bus = LiveBus()
    queue = await bus.subscribe(5)
    # Queue maxsize=64 — push 70.
    for i in range(70):
        await bus.publish(5, {"i": i})
    drained = []
    while not queue.empty():
        drained.append(await queue.get())
    assert len(drained) == 64
    # The newest items should still be there.
    assert drained[-1]["i"] == 69
