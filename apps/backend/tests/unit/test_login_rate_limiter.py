"""Unit tests for LoginRateLimiter using a fake clock."""

import pytest
from app.auth.rate_limit import LoginRateLimiter


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.current = start

    def __call__(self) -> float:
        return self.current

    def advance(self, seconds: float) -> None:
        self.current += seconds


@pytest.mark.unit
def test_rate_limiter_allows_up_to_max_failures() -> None:
    clock = FakeClock(100.0)
    limiter = LoginRateLimiter(clock=clock, window_seconds=900.0, max_failures_per_ip_email=5)

    ip = "192.168.1.10"
    email = "user@example.com"

    for _ in range(4):
        is_limited, _ = limiter.is_rate_limited(ip, email)
        assert is_limited is False
        limiter.record_failure(ip, email)

    # 4 recorded so far, 5th attempt still allowed
    is_limited, _ = limiter.is_rate_limited(ip, email)
    assert is_limited is False

    # 5th failure recorded
    limiter.record_failure(ip, email)

    # 6th attempt is blocked
    is_limited, retry_after = limiter.is_rate_limited(ip, email)
    assert is_limited is True
    assert retry_after == 900


@pytest.mark.unit
def test_rate_limiter_expires_after_window() -> None:
    clock = FakeClock(100.0)
    limiter = LoginRateLimiter(clock=clock, window_seconds=900.0, max_failures_per_ip_email=3)

    ip = "192.168.1.10"
    email = "user@example.com"

    for _ in range(3):
        limiter.record_failure(ip, email)

    is_limited, retry_after = limiter.is_rate_limited(ip, email)
    assert is_limited is True
    assert retry_after == 900

    # Advance clock by 500s -> still limited, retry_after is 400
    clock.advance(500.0)
    is_limited, retry_after = limiter.is_rate_limited(ip, email)
    assert is_limited is True
    assert retry_after == 400

    # Advance clock past window
    clock.advance(401.0)
    is_limited, _ = limiter.is_rate_limited(ip, email)
    assert is_limited is False


@pytest.mark.unit
def test_rate_limiter_ip_wide_cap() -> None:
    clock = FakeClock(100.0)
    limiter = LoginRateLimiter(
        clock=clock,
        window_seconds=900.0,
        max_failures_per_ip_email=5,
        max_failures_per_ip=10,
    )

    ip = "192.168.1.50"
    # Attack with 10 different emails from the same IP (1 failure each)
    for i in range(10):
        email = f"victim_{i}@example.com"
        is_limited, _ = limiter.is_rate_limited(ip, email)
        assert is_limited is False
        limiter.record_failure(ip, email)

    # 11th attempt with a fresh email is blocked by IP-wide cap
    is_limited, retry_after = limiter.is_rate_limited(ip, "fresh@example.com")
    assert is_limited is True
    assert retry_after == 900


@pytest.mark.unit
def test_rate_limiter_case_and_whitespace_insensitive() -> None:
    clock = FakeClock(100.0)
    limiter = LoginRateLimiter(clock=clock, window_seconds=900.0, max_failures_per_ip_email=2)

    limiter.record_failure("127.0.0.1", "Alice@Example.Com ")
    limiter.record_failure("127.0.0.1", "  alice@example.com")

    is_limited, _ = limiter.is_rate_limited("127.0.0.1", "alice@example.com")
    assert is_limited is True
