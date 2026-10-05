"""Pydantic schemas for authentication and user management."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    """User login request body."""

    email: str = Field(..., description="User's email address")
    password: str = Field(..., description="Plaintext password")

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> str:
        """Strip and lowercase the email address."""
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Email must not be empty.")
        return v.strip().lower()


class UserResponse(BaseModel):
    """User representation returned by public and admin endpoints."""

    id: str
    email: str
    display_name: str
    role: Literal["admin", "user"]
    is_active: bool
    content_language: str
    daily_ai_limit: int | None = None
    created_at: str
    last_login_at: str | None = None


class UserMeResponse(BaseModel):
    """Current authenticated user profile for /api/v1/auth/me."""

    id: str
    email: str
    display_name: str
    role: Literal["admin", "user"]
    content_language: str
    daily_ai_limit: int | None = None
    ai_used_today: int = 0


class LoginResponse(BaseModel):
    """Successful login response."""

    user: UserResponse


class ChangePasswordRequest(BaseModel):
    """Self-service password change request."""

    current_password: str = Field(..., description="Current password")
    new_password: str = Field(..., description="New password")


class UpdateProfileRequest(BaseModel):
    """Self-service profile update request body."""

    display_name: str = Field(..., description="User's display name")

    @field_validator("display_name", mode="before")
    @classmethod
    def validate_display_name(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Display name must not be empty.")
        trimmed = v.strip()
        if len(trimmed) > 100:
            raise ValueError("Display name must not exceed 100 characters.")
        return trimmed


class InviteValidateResponse(BaseModel):
    """Validation response for invite or reset token."""

    email: str
    display_name: str
    purpose: Literal["invite", "reset"]


class AcceptInviteRequest(BaseModel):
    """Accept an invite and set the user's password."""

    password: str = Field(..., description="New password")


class AdminCreateUserRequest(BaseModel):
    """Admin request to create a new user and generate an invite link."""

    email: str = Field(..., description="User email address")
    display_name: str = Field(..., description="Display name")
    role: Literal["admin", "user"] = "user"
    daily_ai_limit: int | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> str:
        """Strip and lowercase the email address."""
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Email must not be empty.")
        return v.strip().lower()

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_name(cls, v: Any) -> str:
        """Ensure display name is non-empty."""
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Display name must not be empty.")
        return v.strip()


class AdminCreateUserResponse(BaseModel):
    """Response containing the created user and invite URL path."""

    user: UserResponse
    invite_path: str


class AdminResetLinkResponse(BaseModel):
    """Response containing the reset URL path."""

    invite_path: str


class AdminPatchUserRequest(BaseModel):
    """Admin update of user attributes."""

    display_name: str | None = None
    is_active: bool | None = None
    daily_ai_limit: int | None = None

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_name(cls, v: Any) -> str | None:
        """Strip display name if provided."""
        if v is None:
            return None
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Display name cannot be empty.")
        return v.strip()
