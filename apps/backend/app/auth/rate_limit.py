"""In-memory rate limiter for login attempts with injectable clock."""

from __future__ import annotations

import threading
import time
from typing import Callable


class LoginRateLimiter:
    """Tracks failed login attempts to prevent credential brute-forcing."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        window_seconds: float = 900.0,  # 15 minutes
        max_failures_per_ip_email: int = 5,
        max_failures_per_ip: int = 20,
    ) -> None:
        self._clock = clock
        self._window_seconds = window_seconds
        self._max_failures_per_ip_email = max_failures_per_ip_email
        self._max_failures_per_ip = max_failures_per_ip

        self._failures_by_ip_email: dict[tuple[str, str], list[float]] = {}
        self._failures_by_ip: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune_expired(self, timestamps: list[float], now: float) -> list[float]:
        threshold = now - self._window_seconds
        return [t for t in timestamps if t > threshold]

    def is_rate_limited(self, ip: str, email: str) -> tuple[bool, int]:
        """Check if login should be blocked for (ip, email) or ip.

        Returns (is_limited, retry_after_seconds).
        """
        now = self._clock()
        normalized_email = email.strip().lower()
        key_ip_email = (ip, normalized_email)

        with self._lock:
            # Check IP-wide limit first
            ip_history = self._prune_expired(self._failures_by_ip.get(ip, []), now)
            self._failures_by_ip[ip] = ip_history
            if len(ip_history) >= self._max_failures_per_ip:
                oldest = ip_history[0]
                retry_after = max(1, int(oldest + self._window_seconds - now))
                return True, retry_after

            # Check (IP, Email) limit
            combo_history = self._prune_expired(
                self._failures_by_ip_email.get(key_ip_email, []), now
            )
            self._failures_by_ip_email[key_ip_email] = combo_history
            if len(combo_history) >= self._max_failures_per_ip_email:
                oldest = combo_history[0]
                retry_after = max(1, int(oldest + self._window_seconds - now))
                return True, retry_after

        return False, 0

    def record_failure(self, ip: str, email: str) -> None:
        """Record a failed login attempt."""
        now = self._clock()
        normalized_email = email.strip().lower()
        key_ip_email = (ip, normalized_email)

        with self._lock:
            ip_history = self._prune_expired(self._failures_by_ip.get(ip, []), now)
            ip_history.append(now)
            self._failures_by_ip[ip] = ip_history

            combo_history = self._prune_expired(
                self._failures_by_ip_email.get(key_ip_email, []), now
            )
            combo_history.append(now)
            self._failures_by_ip_email[key_ip_email] = combo_history

    def clear(self) -> None:
        """Clear all rate limit state (useful in tests)."""
        with self._lock:
            self._failures_by_ip_email.clear()
            self._failures_by_ip.clear()


login_rate_limiter = LoginRateLimiter()
