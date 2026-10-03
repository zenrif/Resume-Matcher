"""CLI script to bootstrap or reactivate an admin account and generate an invite link."""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.auth.sessions import generate_token, hash_token
from app.config import settings
from app.database import db
from app.db_engine import init_models_sync, make_sync_engine


async def create_or_reactivate_admin(email: str, display_name: str | None = None) -> str:
    """Create or reactivate an admin user and return their invite URL."""
    # Ensure database tables exist
    init_models_sync(make_sync_engine(settings.sqlite_path))

    normalized_email = email.strip().lower()
    name = display_name.strip() if display_name else normalized_email.split("@")[0].capitalize()

    user = await db.get_user_by_email(normalized_email)
    if user:
        user_id = user["id"]
        await db.update_user(
            user_id,
            role="admin",
            is_active=True,
            display_name=name if display_name else user["display_name"],
        )
        # Revoke existing sessions when resetting an admin via CLI
        await db.delete_user_sessions(user_id)
        purpose = "reset" if user.get("password_hash") else "invite"
    else:
        user_id = str(uuid4())
        await db.create_user(
            id=user_id,
            email=normalized_email,
            display_name=name,
            password_hash=None,
            role="admin",
            is_active=True,
            content_language="id",
            daily_ai_limit=None,
        )
        purpose = "invite"

    token = generate_token()
    token_hash = hash_token(token)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days)
    ).isoformat()

    await db.create_invite(
        token_hash=token_hash,
        user_id=user_id,
        purpose=purpose,
        expires_at=expires_at,
    )
    await db.assign_orphan_rows(user_id)

    base_url = settings.effective_public_base_url
    return f"{base_url}/invite/{token}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or reactivate an admin account and print an invite URL."
    )
    parser.add_argument(
        "--email",
        required=True,
        help="Email address for the admin account.",
    )
    parser.add_argument(
        "--name",
        required=False,
        default=None,
        help="Display name for the admin (defaults to email username).",
    )

    args = parser.parse_args()
    invite_url = asyncio.run(create_or_reactivate_admin(args.email, args.name))
    print(f"Admin invite link: {invite_url}")


if __name__ == "__main__":
    main()
