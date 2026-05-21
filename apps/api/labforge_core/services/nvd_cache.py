"""In-memory TTL cache for NVD lookups.

The NVD public API is rate-limited (5 req / 30 s without an API key, 50 with
one). Without a cache, every keystroke in the CVE search panel hammers it
and the UI goes blank on 429. This wrapper layers a tiny LRU-by-key cache
in front of ``services.cve_client.search_cves`` and ``get_cve``.

Design choices:
- Pure-stdlib (no Redis dep). Process-local cache; good enough for one
  uvicorn worker. Add a Redis backend later if the API runs replicated.
- TTL is short (15 minutes) so newly published CVEs surface promptly but
  the common path during a single canvas-design session is a cache hit.
- Stale-while-revalidate: if a fetch errors after the TTL expires, we
  serve the stale value (if any) for one more window so the UI never
  flatlines mid-session.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, Hashable, TypeVar

T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    expires_at: float
    fetched_at: float


class TTLCache(Generic[T]):
    """Tiny async-safe LRU + TTL cache.

    Stale-while-revalidate: ``get_or_fetch`` returns a stale entry if the
    fetcher throws, as long as the entry isn't past ``max_stale_seconds``
    beyond its TTL.
    """

    def __init__(
        self,
        *,
        max_entries: int = 256,
        ttl_seconds: float = 15 * 60,
        max_stale_seconds: float = 15 * 60,
    ) -> None:
        self._max_entries = max_entries
        self._ttl = ttl_seconds
        self._max_stale = max_stale_seconds
        self._store: OrderedDict[Hashable, _CacheEntry[T]] = OrderedDict()
        self._lock = asyncio.Lock()

    def _put(self, key: Hashable, value: T) -> None:
        now = time.monotonic()
        self._store[key] = _CacheEntry(
            value=value,
            expires_at=now + self._ttl,
            fetched_at=now,
        )
        self._store.move_to_end(key)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)

    async def get_or_fetch(
        self,
        key: Hashable,
        fetcher: Callable[[], Awaitable[T]],
    ) -> T:
        async with self._lock:
            entry = self._store.get(key)
            now = time.monotonic()
            if entry is not None and now < entry.expires_at:
                self._store.move_to_end(key)
                return entry.value

        # Out-of-lock fetch so concurrent callers for different keys don't
        # block each other.
        try:
            value = await fetcher()
        except Exception:
            async with self._lock:
                stale = self._store.get(key)
                if stale is not None and (
                    time.monotonic() - stale.expires_at <= self._max_stale
                ):
                    return stale.value
            raise

        async with self._lock:
            self._put(key, value)
        return value

    def invalidate(self, key: Hashable) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def stats(self) -> dict[str, int]:
        return {
            "size": len(self._store),
            "max_entries": self._max_entries,
        }


# Process-wide singletons for the NVD client.
search_cache: TTLCache = TTLCache(max_entries=512, ttl_seconds=15 * 60)
lookup_cache: TTLCache = TTLCache(max_entries=2048, ttl_seconds=60 * 60)
