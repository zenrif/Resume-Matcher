"""Unit tests for Argon2id password hashing and verification."""

import pytest
from app.auth.passwords import dummy_verify, hash_password, needs_rehash, verify_password


@pytest.mark.unit
def test_hash_and_verify_success() -> None:
    password = "CorrectHorseBatteryStaple123!"
    p_hash = hash_password(password)
    assert p_hash.startswith("$argon2id$")
    assert verify_password(password, p_hash) is True


@pytest.mark.unit
def test_verify_wrong_password_returns_false() -> None:
    p_hash = hash_password("secret_passphrase_123")
    assert verify_password("wrong_passphrase", p_hash) is False


@pytest.mark.unit
def test_verify_malformed_hash_returns_false() -> None:
    assert verify_password("secret", "not-an-argon-hash") is False
    assert verify_password("secret", "") is False


@pytest.mark.unit
def test_dummy_verify_runs_safely() -> None:
    # Must not raise an exception
    dummy_verify()


@pytest.mark.unit
def test_needs_rehash_returns_boolean() -> None:
    p_hash = hash_password("valid_password")
    assert isinstance(needs_rehash(p_hash), bool)
    assert needs_rehash("garbage") is True
