"""Unit tests for session and token generation/hashing."""

import pytest
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token


@pytest.mark.unit
def test_cookie_name() -> None:
    assert COOKIE_NAME == "rm_session"


@pytest.mark.unit
def test_generate_token_properties() -> None:
    t1 = generate_token()
    t2 = generate_token()
    assert isinstance(t1, str)
    assert len(t1) >= 32
    assert t1 != t2


@pytest.mark.unit
def test_hash_token_sha256() -> None:
    token = "test_token_abc_123"
    h1 = hash_token(token)
    h2 = hash_token(token)
    assert h1 == h2
    assert len(h1) == 64
    # All hex characters
    int(h1, 16)


@pytest.mark.unit
def test_hash_token_differs() -> None:
    assert hash_token("token_a") != hash_token("token_b")
