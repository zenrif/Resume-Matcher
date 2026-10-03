"""Short-lived print tokens granting headless browser print page fetches access to a specific resume."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import time
from typing import Callable
from uuid import uuid4


@dataclass(frozen=True)
class PrintGrant:
    """Bounded grant authorizing a print page to fetch a specific resume."""

    user_id: str
    resume_id: str


class PrintTokenStore:
    """In-memory store of short-lived tickets for print page rendering."""

    def __init__(
        self,
        ttl_seconds: float = 120.0,
        max_entries: int = 64,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._clock = clock
        self._items: OrderedDict[str, tuple[float, PrintGrant]] = OrderedDict()

    def _evict(self) -> None:
        now = self._clock()
        expired = [token for token, (exp, _) in self._items.items() if exp <= now]
        for token in expired:
            del self._items[token]
        while len(self._items) > self._max:
            self._items.popitem(last=False)

    def put(self, *, user_id: str, resume_id: str) -> str:
        """Issue a new print grant token for (user_id, resume_id)."""
        token = uuid4().hex
        self._items[token] = (self._clock() + self._ttl, PrintGrant(user_id=user_id, resume_id=resume_id))
        self._evict()
        return token

    def get(self, token: str) -> PrintGrant | None:
        """Lookup an unexpired print grant, or None if expired/not found."""
        self._evict()
        item = self._items.get(token)
        return item[1] if item else None

    def discard(self, token: str) -> None:
        """Remove a token immediately after use."""
        self._items.pop(token, None)


print_tokens = PrintTokenStore()
