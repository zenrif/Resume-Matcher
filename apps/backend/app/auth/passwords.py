"""Password hashing and verification using Argon2id."""

from __future__ import annotations

import logging
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

logger = logging.getLogger(__name__)

# Argon2id hasher with standard parameters
_hasher = PasswordHasher()

# Pre-computed dummy hash to mitigate timing attacks on unknown email lookup
_DUMMY_HASH = _hasher.hash("dummy_passphrase_for_timing_mitigation_12345")


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2id."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against an Argon2id hash."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False
    except Exception as e:
        logger.warning("Unexpected error during password verification: %s", e)
        return False


def dummy_verify() -> None:
    """Execute a verification against a dummy hash to equalize timing on failed login."""
    try:
        _hasher.verify(_DUMMY_HASH, "wrong_password_for_timing")
    except Exception:
        pass


def needs_rehash(password_hash: str) -> bool:
    """Check if the password hash needs to be upgraded to new parameters."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:
        return True
