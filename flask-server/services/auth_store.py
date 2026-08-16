"""Account + session access, backed by the user_account / auth_session tables.

The single seam for authentication: password hashing (argon2), user creation,
credential checks, and opaque session tokens. Endpoints (api/auth_blueprint)
and the request guard (api/auth) go through here; nothing else touches the
auth tables directly.
"""

import hashlib
import secrets
import uuid
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from sqlalchemy import select

from models.auth_session import AuthSession
from models.engine import session_scope
from models.job import utcnow
from models.oauth_identity import OAuthIdentity
from models.user import SYSTEM_USER_EMAIL, SYSTEM_USER_ID, User

_ph = PasswordHasher()

SESSION_TTL_DAYS = 14

# How long a deleted account stays restorable. Until this elapses the row is
# still there and signing in brings the account back; after it, the account is
# treated as gone even before purge_expired_deletions() actually removes it, so
# a purge that hasn't run yet can never let someone back in.
DELETION_GRACE_DAYS = 30


class EmailTakenError(Exception):
    """Raised when registering an email that already has an account."""


class OAuthLinkRefusedError(Exception):
    """Raised when an OAuth login can't be safely linked to an existing account.

    Happens when the provider reports an email that already belongs to a local
    account but hasn't proven the user owns it (email_verified false). Linking
    anyway would let anyone who can set that address at the provider take over
    the existing account, so we refuse and tell them to sign in with a password.
    """


MAX_NAME_LEN = 120


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _clean_name(name: str | None) -> str | None:
    """Trim and bound a display name; empty (or whitespace) clears it to NULL."""
    if name is None:
        return None
    cleaned = " ".join(str(name).split())  # collapse runs of whitespace
    return cleaned[:MAX_NAME_LEN] or None


def _hash_token(raw_token: str) -> str:
    """We store only the SHA-256 of the cookie token, never the token itself."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _grace_expired(user: User) -> bool:
    """True once a deletion request is past the grace window (account is gone)."""
    if user.deletion_requested_at is None:
        return False
    return utcnow() >= user.deletion_requested_at + timedelta(days=DELETION_GRACE_DAYS)


# ---- users ----------------------------------------------------------------

def ensure_system_user() -> str:
    """Create (once) and return the reserved user that owns legacy/imported jobs."""
    with session_scope() as s:
        existing = s.get(User, SYSTEM_USER_ID)
        if existing is None:
            s.add(User(
                id=SYSTEM_USER_ID,
                email=SYSTEM_USER_EMAIL,
                password_hash=None,
                is_system=True,
            ))
        return SYSTEM_USER_ID


def create_user(email: str, password: str, name: str | None = None) -> dict:
    """Register an email/password account. Raises EmailTakenError on duplicate."""
    email = _normalize_email(email)
    if not email or not password:
        raise ValueError("Email and password are required")
    pw_hash = _ph.hash(password)
    with session_scope() as s:
        exists = s.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if exists is not None:
            raise EmailTakenError(email)
        user = User(
            id=str(uuid.uuid4()), email=email, password_hash=pw_hash,
            name=_clean_name(name),
        )
        s.add(user)
        s.flush()
        return user.to_public_dict()


def get_user(user_id: str) -> dict | None:
    with session_scope() as s:
        user = s.get(User, user_id)
        return user.to_public_dict() if user else None


def update_name(user_id: str, name: str | None) -> dict | None:
    """Set the user's display name. Empty string clears it back to the default."""
    with session_scope() as s:
        user = s.get(User, user_id)
        if user is None or user.is_system:
            return None
        user.name = _clean_name(name)
        s.flush()
        return user.to_public_dict()


ACCOUNT_TYPES = ("patient", "clinician", "researcher", "student")


def update_account_type(user_id: str, account_type: str | None) -> dict | None:
    """Set the self-reported account type. None (or empty) clears it back to
    "not set", which is a real answer and not a failure.

    Raises ValueError on anything outside ACCOUNT_TYPES — unlike the display
    name this is a closed set, and analytics grouped by a free-text field would
    be worthless.
    """
    value = (account_type or "").strip().lower() or None
    if value is not None and value not in ACCOUNT_TYPES:
        raise ValueError(f"Unknown account type {account_type!r}")
    with session_scope() as s:
        user = s.get(User, user_id)
        if user is None or user.is_system:
            return None
        user.account_type = value
        s.flush()
        return user.to_public_dict()


def authenticate(email: str, password: str) -> dict | None:
    """Return the user's public dict if the password matches, else None.

    Always runs a hash verification (even for unknown emails, against a dummy)
    so timing doesn't reveal whether an email is registered.

    Signing in successfully during the deletion grace window cancels the pending
    deletion — that's the documented way to change your mind. Past the window
    the account is treated as gone and this returns None.
    """
    email = _normalize_email(email)
    with session_scope() as s:
        user = s.execute(select(User).where(User.email == email)).scalar_one_or_none()
        stored = user.password_hash if (user and user.password_hash) else _DUMMY_HASH
        try:
            _ph.verify(stored, password or "")
        except (VerifyMismatchError, VerificationError):
            return None
        if user is None or user.password_hash is None or user.is_system:
            return None
        if _grace_expired(user):
            return None
        user.deletion_requested_at = None  # signing in undoes a pending deletion
        # Transparently upgrade the hash if argon2's parameters changed.
        if _ph.check_needs_rehash(user.password_hash):
            user.password_hash = _ph.hash(password)
        return user.to_public_dict()


# A precomputed hash of a random string, used so authenticate() spends the same
# time on unknown emails as on real ones (mitigates user-enumeration timing).
_DUMMY_HASH = _ph.hash("bodymaps-dummy-password-for-timing")


# ---- OAuth identities -----------------------------------------------------

def upsert_oauth_user(provider: str, provider_user_id: str, email: str,
                      email_verified: bool) -> dict:
    """Resolve an OAuth login to a user, creating or linking as needed.

    Lookup order matters for security:
      1. By (provider, provider_user_id) — the provider's stable subject id. If
         we've seen this identity before, that's the account, full stop. Email
         is never used to identify a returning user (it can change upstream).
      2. Else by email, to link a first-time OAuth login to an existing local
         account — but ONLY when the provider says the email is verified.
         Unverified + existing account => refuse (OAuthLinkRefusedError), since
         an attacker could otherwise claim an account by setting its address as
         an unverified email at the provider.
      3. Else create a brand-new account (no password; OAuth-only).
    """
    email = _normalize_email(email)
    provider_user_id = str(provider_user_id or "").strip()
    if not provider or not provider_user_id:
        raise ValueError("provider and provider_user_id are required")

    with session_scope() as s:
        # 1. Known identity -> that user.
        identity = s.execute(
            select(OAuthIdentity).where(
                OAuthIdentity.provider == provider,
                OAuthIdentity.provider_user_id == provider_user_id,
            )
        ).scalar_one_or_none()
        if identity is not None:
            user = s.get(User, identity.user_id)
            if user is not None and not user.is_system and not _grace_expired(user):
                user.deletion_requested_at = None  # signing in undoes a pending deletion
                s.flush()
                return user.to_public_dict()

        # 2. Existing local account with this email -> link only if verified.
        existing = None
        if email:
            existing = s.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None:
            if existing.is_system:
                raise OAuthLinkRefusedError("That email can't be used for sign-in.")
            if _grace_expired(existing):
                # Row still present only because the purge hasn't run. Refuse
                # rather than link — and don't fall through to "create new",
                # which would collide on the unique email.
                raise OAuthLinkRefusedError(
                    "That account was deleted and can no longer be restored."
                )
            if not email_verified:
                raise OAuthLinkRefusedError(
                    "An account with that email already exists. Sign in with your "
                    "password first, then link this provider."
                )
            s.add(OAuthIdentity(
                id=str(uuid.uuid4()), user_id=existing.id, provider=provider,
                provider_user_id=provider_user_id, email=email or existing.email,
            ))
            # The provider vouched for the address, so mark it verified locally.
            if existing.email_verified_at is None:
                existing.email_verified_at = utcnow()
            existing.deletion_requested_at = None  # signing in undoes a pending deletion
            s.flush()
            return existing.to_public_dict()

        # 3. New OAuth-only account (no password hash).
        if not email:
            raise OAuthLinkRefusedError(
                "Your provider didn't share an email address, which we need to "
                "create an account."
            )
        user = User(
            id=str(uuid.uuid4()), email=email, password_hash=None,
            email_verified_at=utcnow() if email_verified else None,
        )
        s.add(user)
        s.flush()
        s.add(OAuthIdentity(
            id=str(uuid.uuid4()), user_id=user.id, provider=provider,
            provider_user_id=provider_user_id, email=email,
        ))
        s.flush()
        return user.to_public_dict()


# ---- sessions -------------------------------------------------------------

def create_session(user_id: str, ttl_days: int = SESSION_TTL_DAYS) -> str:
    """Create a session for a user and return the RAW token (set it as a cookie).
    Only the token's hash is stored."""
    raw = secrets.token_urlsafe(32)
    now = utcnow()
    with session_scope() as s:
        s.add(AuthSession(
            id=str(uuid.uuid4()),
            user_id=user_id,
            token_hash=_hash_token(raw),
            created_at=now,
            expires_at=now + timedelta(days=ttl_days),
        ))
    return raw


def resolve_session(raw_token: str | None) -> dict | None:
    """Return the owning user's public dict for a valid, active token, else None."""
    if not raw_token:
        return None
    now = utcnow()
    with session_scope() as s:
        sess = s.execute(
            select(AuthSession).where(AuthSession.token_hash == _hash_token(raw_token))
        ).scalar_one_or_none()
        if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
            return None
        user = s.get(User, sess.user_id)
        if user is None or user.is_system:
            return None
        # Requesting deletion revokes every session, so this is belt-and-braces:
        # a pending-deletion account is not a usable one.
        if user.deletion_requested_at is not None:
            return None
        return user.to_public_dict()


def revoke_session(raw_token: str | None) -> bool:
    """Revoke the session for a token (logout). Returns True if one was revoked."""
    if not raw_token:
        return False
    with session_scope() as s:
        sess = s.execute(
            select(AuthSession).where(AuthSession.token_hash == _hash_token(raw_token))
        ).scalar_one_or_none()
        if sess is None or sess.revoked_at is not None:
            return False
        sess.revoked_at = utcnow()
        return True


def revoke_all_sessions(user_id: str) -> int:
    """Revoke every live session for a user (every browser). Returns the count."""
    now = utcnow()
    with session_scope() as s:
        live = s.execute(
            select(AuthSession).where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
        ).scalars().all()
        for sess in live:
            sess.revoked_at = now
        return len(live)


# ---- account deletion -----------------------------------------------------

def request_deletion(user_id: str) -> dict | None:
    """Schedule an account for deletion and sign it out everywhere.

    Reversible: the row and the user's data survive for DELETION_GRACE_DAYS, and
    signing back in during that window clears the flag. Returns a summary with
    the deadline, or None for an unknown/system user.
    """
    with session_scope() as s:
        user = s.get(User, user_id)
        if user is None or user.is_system:
            return None
        if user.deletion_requested_at is None:
            user.deletion_requested_at = utcnow()
        requested_at = user.deletion_requested_at
        s.flush()

    revoke_all_sessions(user_id)
    return {
        "deletion_requested_at": requested_at.isoformat(),
        "restore_by": (requested_at + timedelta(days=DELETION_GRACE_DAYS)).isoformat(),
        "grace_days": DELETION_GRACE_DAYS,
    }


def list_users_pending_purge() -> list[str]:
    """Ids of accounts whose grace period has elapsed and which are due for
    irreversible removal."""
    cutoff = utcnow() - timedelta(days=DELETION_GRACE_DAYS)
    with session_scope() as s:
        return list(s.execute(
            select(User.id).where(
                User.deletion_requested_at.is_not(None),
                User.deletion_requested_at <= cutoff,
                User.is_system.is_(False),
            )
        ).scalars())


def purge_expired_deletions() -> int:
    """Irreversibly remove accounts whose grace period has elapsed.

    Returns the number of accounts removed. Sessions and OAuth identities go with
    the user via ON DELETE CASCADE, but ``job.user_id`` is NOT NULL with no
    cascade, so each user's jobs (and their files on disk) are cleared first —
    done here rather than left to the caller, so the FK can't blow up on someone
    who calls this on its own.
    """
    # Imported lazily: job_store pulls in the job model and its own session
    # plumbing, and only this one function needs it.
    from services import job_store

    removed = 0
    for user_id in list_users_pending_purge():
        job_store.delete_jobs_for_user(user_id)
        with session_scope() as s:
            user = s.get(User, user_id)
            if user is None:
                continue
            s.delete(user)
        removed += 1
    return removed
