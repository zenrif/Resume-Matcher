"""Token generation and cryptographic hashing for sessions and invites."""

from __future__ import annotations

import hashlib
import secrets

COOKIE_NAME = "rm_session"


def generate_token() -> str:
    """Generate a high-entropy cryptographically secure random token."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a token using SHA-256 hex encoding for secure database storage.

    Plaintext tokens are only ever stored in the browser cookie or invite link.
    """
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()
