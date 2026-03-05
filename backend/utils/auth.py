"""
Authentication utilities for Dashboard V3.
Connects to the existing auth database (apo-sql-dev / ApoAsset_JM) that was set up
for the original Dash dashboard, so all users/roles/sessions are shared.
"""
import hashlib
import secrets
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import pandas as pd
from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

# ── Engine pointing at the auth database ────────────────────────────────────
# Reads from env-var if present so it can be overridden in .env;
# falls back to the same server/DB the original dashboard used.
_AUTH_DB_CONN = os.getenv(
    "AUTH_DB_CONNECTION",
    "mssql+pyodbc://@apo-sql-dev/ApoAsset_JM?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes",
)

try:
    auth_engine = create_engine(_AUTH_DB_CONN)
    logger.info("✓ Connected to auth database (ApoAsset_JM)")
except Exception as exc:
    auth_engine = None
    logger.warning(f"⚠ Auth database connection failed: {exc}")


# ── Password helpers ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a password with SHA-256 + random salt.
    Format: <hex-salt>$<hex-digest>
    """
    salt = secrets.token_hex(16)
    digest = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}${digest}"


def verify_password(password: str, hashed: str) -> bool:
    """Return True if *password* matches the stored *hashed* value."""
    try:
        salt, digest = hashed.split("$", 1)
        return hashlib.sha256((password + salt).encode()).hexdigest() == digest
    except Exception:
        return False


# ── Session management ───────────────────────────────────────────────────────

def create_session(user_id: int, remember_me: bool = False) -> Tuple[str, datetime]:
    """Persist a new session token and return (token, expiry)."""
    if auth_engine is None:
        raise RuntimeError("Auth database not available")

    token = secrets.token_urlsafe(32)
    expiry = datetime.now() + timedelta(days=30 if remember_me else 1)

    row = pd.DataFrame([{
        "user_id": user_id,
        "session_token": token,
        "created_at": datetime.now(),
        "expires_at": expiry,
        "is_active": True,
    }])
    row.to_sql("user_sessions", auth_engine, if_exists="append", index=False)
    return token, expiry


def validate_session(session_token: str) -> Optional[dict]:
    """Return user info dict if the token is valid and not expired, else None."""
    if not session_token or auth_engine is None:
        return None

    sql = text("""
        SELECT s.user_id, s.expires_at,
               u.username, u.role_id, r.role_name
        FROM   user_sessions s
        JOIN   users  u ON s.user_id  = u.user_id
        JOIN   roles  r ON u.role_id  = r.role_id
        WHERE  s.session_token = :token
          AND  s.is_active     = 1
          AND  s.expires_at   > GETDATE()
    """)
    try:
        result = pd.read_sql(sql, auth_engine, params={"token": session_token})
        if len(result) > 0:
            return result.iloc[0].to_dict()
        return None
    except Exception as exc:
        logger.error(f"Session validation error: {exc}")
        return None


def invalidate_session(session_token: str) -> None:
    """Mark a session as inactive (logout)."""
    if not session_token or auth_engine is None:
        return
    sql = text("UPDATE user_sessions SET is_active = 0 WHERE session_token = :token")
    try:
        with auth_engine.connect() as conn:
            conn.execute(sql, {"token": session_token})
            conn.commit()
    except Exception as exc:
        logger.error(f"Session invalidation error: {exc}")


# ── User authentication ──────────────────────────────────────────────────────

def authenticate_user(username: str, password: str) -> Tuple[Optional[dict], Optional[str]]:
    """Verify credentials.
    Returns (user_dict, None) on success or (None, error_message) on failure.
    """
    if auth_engine is None:
        return None, "Authentication service unavailable"

    sql = text("""
        SELECT u.user_id, u.username, u.password_hash, u.role_id, r.role_name
        FROM   users u
        JOIN   roles r ON u.role_id = r.role_id
        WHERE  u.username  = :username
          AND  u.is_active = 1
    """)
    try:
        result = pd.read_sql(sql, auth_engine, params={"username": username})
        if len(result) == 0:
            return None, "Benutzername oder Passwort ungültig"

        user = result.iloc[0]
        if verify_password(password, user["password_hash"]):
            return {
                "user_id":   int(user["user_id"]),
                "username":  user["username"],
                "role_id":   int(user["role_id"]),
                "role_name": user["role_name"],
            }, None
        return None, "Benutzername oder Passwort ungültig"
    except Exception as exc:
        logger.error(f"Authentication error: {exc}")
        return None, "Authentifizierung fehlgeschlagen"


def get_user_permissions(role_id: int) -> list:
    """Return list of permission_name strings for the given role."""
    if auth_engine is None:
        return []
    sql = text("""
        SELECT permission_name
        FROM   role_permissions
        WHERE  role_id = :role_id
    """)
    try:
        result = pd.read_sql(sql, auth_engine, params={"role_id": role_id})
        return result["permission_name"].tolist()
    except Exception as exc:
        logger.error(f"Get permissions error: {exc}")
        return []


def change_password(user_id: int, old_password: str, new_password: str) -> Tuple[bool, str]:
    """Change a user's password after verifying the old one."""
    if len(new_password) < 8:
        return False, "Passwort muss mindestens 8 Zeichen lang sein"

    if auth_engine is None:
        return False, "Authentifizierungsservice nicht verfügbar"

    try:
        row = pd.read_sql(
            text("SELECT password_hash FROM users WHERE user_id = :uid"),
            auth_engine,
            params={"uid": user_id},
        )
        if len(row) == 0:
            return False, "Benutzer nicht gefunden"

        if not verify_password(old_password, row.iloc[0]["password_hash"]):
            return False, "Aktuelles Passwort ist falsch"

        new_hash = hash_password(new_password)
        with auth_engine.connect() as conn:
            conn.execute(
                text("UPDATE users SET password_hash = :h, updated_at = GETDATE() WHERE user_id = :uid"),
                {"h": new_hash, "uid": user_id},
            )
            conn.commit()
        return True, "Passwort erfolgreich geändert"
    except Exception as exc:
        logger.error(f"Change password error: {exc}")
        return False, "Passwortänderung fehlgeschlagen"


def get_user_by_id(user_id: int) -> Optional[dict]:
    """Fetch a user record by ID (for /api/auth/me)."""
    if auth_engine is None:
        return None
    sql = text("""
        SELECT u.user_id, u.username, u.role_id, r.role_name, u.is_active
        FROM   users u
        JOIN   roles r ON u.role_id = r.role_id
        WHERE  u.user_id = :uid
    """)
    try:
        result = pd.read_sql(sql, auth_engine, params={"uid": user_id})
        if len(result) > 0:
            row = result.iloc[0]
            return {
                "user_id":   int(row["user_id"]),
                "username":  row["username"],
                "role_id":   int(row["role_id"]),
                "role_name": row["role_name"],
            }
        return None
    except Exception as exc:
        logger.error(f"get_user_by_id error: {exc}")
        return None
