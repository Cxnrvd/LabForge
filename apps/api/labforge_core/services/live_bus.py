"""In-process pub/sub for live lab telemetry.

The agent POSTs heartbeats to ``/api/v1/labs/{id}/heartbeat``. Dashboards
subscribe to ``/api/v1/labs/{id}/ws`` to receive them in real time. This
module is the broker that connects the two without a network hop.

Constraints:
- Single-process (uvicorn worker). For multi-worker scale-out, swap this
  for Redis pub/sub — the call sites don't change.
- No persistence: only subscribers attached at broadcast time receive
  the message. Late joiners poll ``/labs/{id}/heartbeat`` once on
  connect to seed their UI, then live-stream from here onwards.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

_LOGGER = logging.getLogger("labforge.live_bus")


class LiveBus:
    """Per-lab fan-out. Use the module-level singleton ``bus``."""

    def __init__(self) -> None:
        self._subs: dict[int, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, lab_id: int) -> asyncio.Queue[dict[str, Any]]:
        # Bounded queue so a slow consumer doesn't OOM the process; on
        # overflow the oldest entries are dropped (live telemetry is
        # cheaper to lose than to back-pressure).
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        async with self._lock:
            self._subs.setdefault(lab_id, set()).add(queue)
        return queue

    async def unsubscribe(self, lab_id: int, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            subs = self._subs.get(lab_id)
            if subs is None:
                return
            subs.discard(queue)
            if not subs:
                self._subs.pop(lab_id, None)

    async def publish(self, lab_id: int, message: dict[str, Any]) -> int:
        """Deliver ``message`` to every subscriber. Returns the fan-out size."""
        async with self._lock:
            subs = list(self._subs.get(lab_id, set()))
        delivered = 0
        for queue in subs:
            try:
                queue.put_nowait(message)
                delivered += 1
            except asyncio.QueueFull:
                # Drop oldest, push new — keep things alive.
                try:
                    queue.get_nowait()
                    queue.put_nowait(message)
                    delivered += 1
                except Exception:  # noqa: BLE001
                    _LOGGER.debug("dropped overflow message for lab %s", lab_id)
        return delivered

    def subscriber_count(self, lab_id: int) -> int:
        return len(self._subs.get(lab_id, set()))


bus = LiveBus()
