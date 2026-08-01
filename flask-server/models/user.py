"""User accounts.

Email/password is the only auth method in this phase; password_hash is nullable
so OAuth-only users (added later) can exist without one. A single reserved
"system" user owns legacy/imported jobs, so job.user_id can be NOT NULL without
dropping pre-account job history.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import db
from models.job import utcnow

# Fixed id for the reserved account that owns legacy/imported jobs. Not a real
# login (no password, is_system=True).
SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"
SYSTEM_USER_EMAIL = "system@bodymaps.local"


class User(db.Model):
    __tablename__ = "user_account"  # "user" is reserved in some DBs; be explicit.

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Stored lower-cased + trimmed; unique so an email maps to one account.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    # Nullable: OAuth-only users (later) have no password.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # The reserved legacy owner; excluded from normal auth.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    sessions: Mapped[list["AuthSession"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )

    def to_public_dict(self) -> dict:
        """Client-safe view — never includes the password hash."""
        return {
            "id": self.id,
            "email": self.email,
            "email_verified": self.email_verified_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<User {self.email}{' (system)' if self.is_system else ''}>"
