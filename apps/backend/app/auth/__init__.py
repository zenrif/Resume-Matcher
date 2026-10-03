"""Authentication and user management package."""

from app.auth.context import NoUserContextError, current_user_id, require_user_id
from app.auth.deps import get_client_ip, get_current_user, require_admin, require_user
from app.auth.passwords import dummy_verify, hash_password, needs_rehash, verify_password
from app.auth.rate_limit import LoginRateLimiter, login_rate_limiter
from app.auth.sessions import COOKIE_NAME, generate_token, hash_token

__all__ = [
    "current_user_id",
    "require_user_id",
    "NoUserContextError",
    "COOKIE_NAME",
    "hash_password",
    "verify_password",
    "dummy_verify",
    "needs_rehash",
    "generate_token",
    "hash_token",
    "LoginRateLimiter",
    "login_rate_limiter",
    "get_current_user",
    "require_user",
    "require_admin",
    "get_client_ip",
]
