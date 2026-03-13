from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
import sys
import io
import traceback
import logging
from dotenv import load_dotenv
import math
import numpy as np
import asyncio
from concurrent.futures import ThreadPoolExecutor

logging.basicConfig(level=logging.DEBUG)
from datetime import datetime, timedelta, timezone
import jwt
from typing import Dict, List, Optional, Any
from pydantic import BaseModel
import pandas as pd
from utils.export_utils import build_excel, build_pptx
from utils.auth import (
    authenticate_user, create_session, invalidate_session,
    validate_session, get_user_by_id, get_user_permissions, change_password,
    list_users, create_user, update_user, delete_user, reset_user_password,
    list_roles, get_all_role_permissions, set_role_permissions, create_role,
)

# Load environment variables
load_dotenv()

# Note: Will integrate original dashboard.utils.get_data functions later
# sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'dashboard'))

# Import services
from services.länder_service import LänderDataService
from services.faktoren_service import FaktorenService
from services.sektoren_service import SektorenService
from services.user_service import UserService
from services.alternativ_service import AlternativService
from feedback.feedback_db import create_feedback_table, insert_feedback
from utils.database import db_gateway

# ─────────────────────────────────────────────────────────────────────────────
# Utility function to clean NaN/Inf values from responses for JSON serialization
# ─────────────────────────────────────────────────────────────────────────────

def _clean_nan_values(obj: Any) -> Any:
    """
    Recursively convert NaN and Inf values to None throughout a data structure.
    This ensures JSON serialization doesn't fail with "Out of range float values are not JSON compliant".
    """
    if isinstance(obj, dict):
        return {k: _clean_nan_values(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_clean_nan_values(item) for item in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    else:
        return obj

app = FastAPI(
    title="Dashboard API",
    description="FastAPI backend for React Dashboard",
    version="0.0.1"
)

# Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup: warm the Länder data caches in the background ───────────────────
_cache_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cache-warmup")

@app.on_event("startup")
async def startup_warmup():
    """
    Kick off cache warm-up in a background thread so the server starts
    immediately, then becomes fast once warm-up completes (≈ 30-60 s).
    """
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_cache_executor, LänderDataService.warm_caches)
    logging.getLogger(__name__).info(
        "🚀 Server started – cache warm-up running in background"
    )

# Security
security = HTTPBearer()
_auth_logger = logging.getLogger("auth")

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token"""
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = int(payload.get("sub"))
        if user_id is None:
            _auth_logger.error("verify_token: sub claim missing from payload")
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.ExpiredSignatureError:
        _auth_logger.warning("verify_token: TOKEN EXPIRED")
        raise HTTPException(status_code=401, detail="Token abgelaufen – bitte neu anmelden")
    except jwt.InvalidTokenError as exc:
        _auth_logger.error(f"verify_token: InvalidTokenError – {exc}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as exc:
        _auth_logger.error(f"verify_token: unexpected error – {exc}")
        raise HTTPException(status_code=401, detail="Invalid token")

# ═══════════════════════════════════════════════════════════════════════════
# HEALTH & ROOT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health_check():
    """Health check endpoint to verify API is running - PUBLIC ENDPOINT"""
    return {"message": "API is running successfully", "status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/api/cache/status")
async def cache_status():
    """Report the state of the startup warm-up cache - PUBLIC ENDPOINT"""
    return {
        "cache_ready": LänderDataService._cache_ready,
        "cache_warming": LänderDataService._cache_warming,
        "equity_eur": LänderDataService._equity_eur_cache is not None,
        "equity_usd": LänderDataService._equity_usd_cache is not None,
        "fi": LänderDataService._fi_full_cache is not None,
        "macro": LänderDataService._macro_full_cache is not None,
        "equity_eur_rows": len(LänderDataService._equity_eur_cache) if LänderDataService._equity_eur_cache is not None else 0,
        "fi_rows": len(LänderDataService._fi_full_cache) if LänderDataService._fi_full_cache is not None else 0,
        "macro_rows": len(LänderDataService._macro_full_cache) if LänderDataService._macro_full_cache is not None else 0,
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Welcome to Dashboard API"}

# ── Request / Response models ───────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


# ═══════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    """Authenticate against the shared SQL auth database and return a JWT. - PUBLIC ENDPOINT"""
    user, error = authenticate_user(body.username, body.password)
    if error:
        raise HTTPException(status_code=401, detail=error)

    # Also persist a DB session so it can be revoked server-side
    try:
        session_token, expiry = create_session(user["user_id"], body.remember_me)
    except Exception:
        session_token, expiry = None, None

    token_expiry = timedelta(days=30) if body.remember_me else timedelta(hours=24)
    jwt_token = jwt.encode(
        {
            "sub": str(user["user_id"]),
            "username": user["username"],
            "role_id": user["role_id"],
            "role_name": user["role_name"],
            "session_token": session_token,
            "exp": datetime.now(timezone.utc) + token_expiry,
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    permissions = get_user_permissions(user["role_id"])
    return {
        "access_token": jwt_token,
        "token_type": "bearer",
        "user": {
            "user_id":    user["user_id"],
            "username":   user["username"],
            "role_id":    user["role_id"],
            "role_name":  user["role_name"],
            "permissions": permissions,
        },
    }


@app.post("/api/auth/logout")
async def logout(user_id: int = Depends(verify_token), credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Invalidate the current session token."""
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        session_token = payload.get("session_token")
        if session_token:
            invalidate_session(session_token)
    except Exception:
        pass
    return {"message": "Erfolgreich abgemeldet"}


@app.get("/api/auth/me")
async def get_current_user(user_id: int = Depends(verify_token)):
    """Return current user info and permissions."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    permissions = get_user_permissions(user["role_id"])
    return {**user, "permissions": permissions}


@app.get("/api/admin/debug-auth")
async def debug_auth(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Temporary debug endpoint – shows what token the server receives and why it may fail."""
    raw = credentials.credentials
    # Decode without verification to inspect claims
    try:
        import base64, json as _json
        parts = raw.split(".")
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        claims = _json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        claims = "could not decode"
    # Attempt real verification
    try:
        payload = jwt.decode(raw, SECRET_KEY, algorithms=[ALGORITHM])
        return {"status": "token_valid", "claims": claims, "user_id": payload.get("sub")}
    except jwt.ExpiredSignatureError:
        return {"status": "token_EXPIRED", "claims": claims}
    except jwt.InvalidTokenError as exc:
        return {"status": f"invalid_token: {exc}", "claims": claims}
    except Exception as exc:
        return {"status": f"error: {exc}", "claims": claims}


@app.post("/api/auth/change-password")
async def change_user_password(body: ChangePasswordRequest, user_id: int = Depends(verify_token)):
    """Change the current user's password."""
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwörter stimmen nicht überein")
    success, message = change_password(user_id, body.current_password, body.new_password)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}


# ═══════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

# All tab/permission names available in the dashboard
ALL_PERMISSIONS = [
    "countries", "factors", "sectors", "portfolios",
    "data", "anleihen", "duoplus", "extras", "user", "admin",
]


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role_id: int


class UpdateUserRequest(BaseModel):
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    username: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class SetRolePermissionsRequest(BaseModel):
    permissions: List[str]


class CreateRoleRequest(BaseModel):
    role_name: str


def require_admin(user_id: int = Depends(verify_token)):
    """Dependency: raises 403 if the current user does not have 'admin' permission."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Benutzer nicht gefunden")
    perms = get_user_permissions(user["role_id"])
    if "admin" not in perms:
        raise HTTPException(status_code=403, detail="Administratorrechte erforderlich")
    return user_id


# ── Users ──────────────────────────────────────────────────────────────────

@app.get("/api/admin/users")
async def admin_list_users(_: int = Depends(require_admin)):
    """List all users (admin only)."""
    return list_users()


@app.post("/api/admin/users", status_code=201)
async def admin_create_user(body: CreateUserRequest, _: int = Depends(require_admin)):
    """Create a new user (admin only)."""
    user, error = create_user(body.username, body.password, body.role_id)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return user


@app.put("/api/admin/users/{target_user_id}")
async def admin_update_user(
    target_user_id: int,
    body: UpdateUserRequest,
    admin_id: int = Depends(require_admin),
):
    """Update a user's role or active status (admin only)."""
    success, message = update_user(
        target_user_id,
        role_id=body.role_id,
        is_active=body.is_active,
        username=body.username,
    )
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}


@app.delete("/api/admin/users/{target_user_id}")
async def admin_delete_user(target_user_id: int, admin_id: int = Depends(require_admin)):
    """Deactivate a user (soft-delete, admin only)."""
    if target_user_id == admin_id:
        raise HTTPException(status_code=400, detail="Eigener Account kann nicht deaktiviert werden")
    success, message = delete_user(target_user_id)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}


@app.post("/api/admin/users/{target_user_id}/reset-password")
async def admin_reset_password(
    target_user_id: int,
    body: ResetPasswordRequest,
    _: int = Depends(require_admin),
):
    """Reset a user's password (admin only)."""
    success, message = reset_user_password(target_user_id, body.new_password)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}


# ── Roles & permissions ────────────────────────────────────────────────────

@app.get("/api/admin/roles")
async def admin_list_roles(_: int = Depends(require_admin)):
    """List all roles (admin only)."""
    return list_roles()


@app.post("/api/admin/roles", status_code=201)
async def admin_create_role(body: CreateRoleRequest, _: int = Depends(require_admin)):
    """Create a new role (admin only)."""
    role, error = create_role(body.role_name)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return role


@app.get("/api/admin/permissions/available")
async def admin_available_permissions(_: int = Depends(require_admin)):
    """Return the list of all defined permission keys (admin only)."""
    return {"permissions": ALL_PERMISSIONS}


@app.get("/api/admin/roles/permissions")
async def admin_all_role_permissions(_: int = Depends(require_admin)):
    """Return a mapping {role_id: [permission, ...]} for all roles (admin only)."""
    return get_all_role_permissions()


@app.put("/api/admin/roles/{role_id}/permissions")
async def admin_set_role_permissions(
    role_id: int,
    body: SetRolePermissionsRequest,
    _: int = Depends(require_admin),
):
    """Set the full permissions list for a role (admin only)."""
    invalid = [p for p in body.permissions if p not in ALL_PERMISSIONS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unbekannte Berechtigungen: {invalid}")
    success, message = set_role_permissions(role_id, body.permissions)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}

# ═══════════════════════════════════════════════════════════════════════════
# LÄNDER/COUNTRIES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/countries/equity")
async def get_equity_data(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    lookback: str = Query("1Y", description="Lookback period (1Y, 3Y, 5Y, All)"),
    show_averages: bool = Query(False, description="Include rolling averages"),
    currency: str = Query("EUR", description="Currency (EUR, USD)")
):
    """Get equity data for countries page - PUBLIC ENDPOINT"""
    try:
        # Parse regions from comma-separated string
        region_list = [r.strip() for r in regions.split(",")]
        
        # Get data from service
        result = LänderDataService.get_equity_data(
            regions=region_list,
            start_date=start_date,
            end_date=end_date,
            lookback=lookback,
            show_averages=show_averages,
            currency=currency
        )
        
        # Clean NaN/Inf values before JSON serialization
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        return {"error": str(e), "status": "error"}

@app.get("/api/countries/equity/columns")
async def get_equity_columns(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    lookback: str = Query("1Y", description="Lookback period (1Y, 3Y, 5Y, All)")
):
    """Get available numerical columns for equity data (excluding '_avg_' columns) - PUBLIC ENDPOINT
    
    NOTE: This endpoint returns columns for the SPECIFIC region selection.
    Use /api/countries/equity/columns-master for a consistent list across all regions.
    """
    try:
        # Parse regions from comma-separated string
        region_list = [r.strip() for r in regions.split(",")]
        
        # Get equity data first to determine available columns
        result = LänderDataService.get_equity_data(
            regions=region_list,
            lookback=lookback
        )
        
        if result.get("status") == "error":
            return {"error": result.get("metadata", {}).get("error"), "status": "error", "columns": []}
        
        # Extract numerical columns
        columns = LänderDataService.get_numerical_columns_excluding_avg(result.get("data", []))
        
        return {
            "status": "ok",
            "columns": columns,
            "count": len(columns)
        }
    except Exception as e:
        return {"error": str(e), "status": "error", "columns": []}

@app.get("/api/countries/equity/columns-master")
async def get_equity_columns_master():
    """Get MASTER list of all possible equity columns - CONSISTENT for metric filter checkboxes
    
    This endpoints returns the same column list regardless of region selection.
    Use this for the metric filter modal so checkboxes don't change when switching regions.
    """
    try:
        # Return all possible metrics across all countries
        # These are all the technical indicators and metrics that could be calculated
        master_columns = LänderDataService.get_master_equity_columns()
        
        return {
            "status": "ok",
            "columns": master_columns,
            "count": len(master_columns)
        }
    except Exception as e:
        return {"error": str(e), "status": "error", "columns": []}

@app.get("/api/countries/fixed-income")
async def get_fixed_income_data(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    lookback: str = Query("1Y", description="Lookback period (1Y, 3Y, 5Y, All)"),
    show_averages: bool = Query(False, description="Include rolling averages")
):
    """Get fixed income data for countries page - PUBLIC ENDPOINT"""
    try:
        region_list = [r.strip() for r in regions.split(",")]
        result = LänderDataService.get_fixed_income_data(
            regions=region_list,
            start_date=start_date,
            end_date=end_date,
            lookback=lookback,
            show_averages=show_averages
        )
        # Clean NaN/Inf values before JSON serialization
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        return {"error": str(e), "status": "error"}

@app.get("/api/countries/fixed-income/columns")
async def get_fi_columns(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    lookback: str = Query("1Y", description="Lookback period")
):
    """Get available FI metric columns for the selected regions - PUBLIC ENDPOINT"""
    try:
        region_list = [r.strip() for r in regions.split(",")]
        result = LänderDataService.get_fixed_income_data(
            regions=region_list,
            lookback=lookback
        )
        if result.get("status") == "error":
            return {"status": "error", "columns": [], "error": result.get("metadata", {}).get("error")}
        columns = result.get("metadata", {}).get("columns", [])
        return {"status": "ok", "columns": columns, "count": len(columns)}
    except Exception as e:
        return {"status": "error", "columns": [], "error": str(e)}

@app.get("/api/countries/fixed-income/columns-master")
async def get_fi_columns_master():
    """Get MASTER list of all possible FI metric columns - PUBLIC ENDPOINT"""
    try:
        columns = LänderDataService.get_master_fi_columns()
        return {"status": "ok", "columns": columns, "count": len(columns)}
    except Exception as e:
        return {"status": "error", "columns": [], "error": str(e)}

@app.get("/api/countries/fixed-income/ratings")
async def get_fi_ratings():
    """Get latest S&P credit ratings for all countries - PUBLIC ENDPOINT"""
    try:
        result = LänderDataService.get_ratings()
        return result
    except Exception as e:
        return {"status": "error", "data": [], "error": str(e)}

@app.get("/api/countries/macro")
async def get_macro_data(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    lookback: str = Query("1Y", description="Lookback period (1Y, 3Y, 5Y, All)"),
    show_averages: bool = Query(False, description="Include rolling averages")
):
    """Get macro data for countries page - PUBLIC ENDPOINT"""
    try:
        region_list = [r.strip() for r in regions.split(",")]
        result = LänderDataService.get_macro_data(
            regions=region_list,
            start_date=start_date,
            end_date=end_date,
            lookback=lookback,
            show_averages=show_averages
        )
        return result
    except Exception as e:
        return {"error": str(e), "status": "error"}

@app.get("/api/countries/macro/columns-master")
async def get_macro_columns_master():
    """Get master list of all possible Macro metric column names."""
    try:
        columns = LänderDataService.get_master_macro_columns()
        return {"status": "ok", "columns": columns, "count": len(columns)}
    except Exception as e:
        return {"status": "error", "columns": [], "error": str(e)}

# ═══════════════════════════════════════════════════════════════════════════
# FAKTOREN / FACTORS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/faktoren/data")
async def get_faktoren_data(
    view: str = Query("U.S.", description="View selection: U.S., Europe, U.S. vs. Europe, World"),
    currency: str = Query("USD", description="Currency (EUR, USD)"),
    lookback: str = Query("1Y", description="Lookback period (MtD, YtD, 1Y, 3Y, 7Y, All)"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
):
    """Get factor analysis data for all 6 graphs - PUBLIC ENDPOINT"""
    try:
        result = FaktorenService.get_graphs_data(
            view=view,
            currency=currency,
            lookback=lookback,
            start_date=start_date,
            end_date=end_date,
        )
        # Clean NaN/Inf values before JSON serialization
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/faktoren/views")
async def get_faktoren_views():
    """Get available view options for the Faktoren tab - PUBLIC ENDPOINT"""
    return {"status": "ok", "views": FaktorenService.get_available_views()}


# ═══════════════════════════════════════════════════════════════════════════
# SEKTOREN / SECTORS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/sektoren/data")
async def get_sektoren_data(
    view: str = Query("U.S.", description="View: U.S., Europe, U.S. vs. Europe"),
    lookback: str = Query("1Y", description="Lookback: MtD, YtD, 1Y, 3Y, 7Y, All"),
    start_date: Optional[str] = Query(None, description="Custom start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Custom end date YYYY-MM-DD"),
    sectors: Optional[str] = Query(None, description="Comma-separated English sector names"),
):
    """Get sector PE ratio data for all 4 graphs - PUBLIC ENDPOINT"""
    try:
        sector_list = [s.strip() for s in sectors.split(",")] if sectors else None
        result = SektorenService.get_graphs_data(
            view=view,
            lookback=lookback,
            start_date=start_date,
            end_date=end_date,
            sectors=sector_list,
        )
        # Clean NaN/Inf values before JSON serialization
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/sektoren/sectors")
async def get_sektoren_sectors():
    """Get available sectors and translations - PUBLIC ENDPOINT"""
    return {
        "status": "ok",
        "sectors": SektorenService.get_all_sectors(),
        "translations": SektorenService.get_sector_translations(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# ALTERNATIV / CONSUMER ACTIVITY ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/alternativ/data")
async def get_alternativ_data(
    lookback: str = Query("1Y", description="Lookback period (MtD, YtD, 1Y, 3Y, 7Y, All)"),
    start_date: Optional[str] = Query(None, description="Custom start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Custom end date YYYY-MM-DD"),
):
    """Get US consumer activity data for all 6 Alternativ charts - PUBLIC ENDPOINT"""
    try:
        result = AlternativService.get_graphs_data(
            lookback=lookback,
            start_date=start_date,
            end_date=end_date,
        )
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# EXPORT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class ExportItem(BaseModel):
    id: str
    title: str
    pptx_title: Optional[str] = None   # short title for PPTX slide header
    subheading: str = ""               # unit / date range (PPTX subtitle)
    yAxisLabel: str = ""               # y-axis label / unit for PPTX & Excel
    source: str = ""                   # data source (PPTX footer)
    tab: str = ""
    group: int = 1                     # same group = same sheet / slide
    chartData: list
    regions: List[str] = []
    xKey: str = "DatePoint"
    chartType: Optional[str] = None    # 'Line' | 'Bar' – drives Balken vs. line export
    balkenData: Optional[list] = None  # pre-computed range-bar items for Balken charts

class ExportRequest(BaseModel):
    items: List[ExportItem]


@app.post("/api/export/excel")
async def export_excel(payload: ExportRequest):
    """
    Generate an Excel workbook from queued chart items.
    Items with the same group value share a sheet, placed side-by-side.
    PUBLIC ENDPOINT
    """
    try:
        result = build_excel([item.model_dump() for item in payload.items])
        filename = f"Dashboard_Export_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
        return StreamingResponse(
            io.BytesIO(result),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Excel export error:\n%s", tb)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}\n\n{tb}")


@app.post("/api/export/pptx")
async def export_pptx(payload: ExportRequest):
    """
    Generate a PowerPoint presentation from queued chart items using pptx_template.pptx.
    Items with the same group value share a slide.
    PUBLIC ENDPOINT
    """
    try:
        result = build_pptx([item.model_dump() for item in payload.items])
        filename = f"Dashboard_Export_{datetime.now().strftime('%Y-%m-%d')}.pptx"
        return StreamingResponse(
            io.BytesIO(result),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("PPTX export error:\n%s", tb)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}\n\n{tb}")

# ═══════════════════════════════════════════════════════════════════════════
# FEEDBACK ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class FeedbackRequest(BaseModel):
    page: str
    feedback_type: str
    feedback_text: str


@app.post("/api/feedback/submit")
async def submit_feedback(body: FeedbackRequest, user_id: int = Depends(verify_token)):
    """Submit user feedback and store it in the database."""
    # Resolve the username from the token
    try:
        user = get_user_by_id(user_id)
        username = user.get("username", "Unknown") if user else "Unknown"
    except Exception:
        username = "Unknown"

    try:
        engine = db_gateway.dev_engine
        if engine is None:
            raise HTTPException(status_code=503, detail="Database not available")

        # Ensure table exists (no-op if already there)
        create_feedback_table(engine)

        success = insert_feedback(
            engine=engine,
            username=username,
            page=body.page,
            feedback_type=body.feedback_type,
            feedback_text=body.feedback_text.strip(),
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to save feedback")

        return {"status": "ok", "message": "Feedback erfolgreich gespeichert"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Feedback submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# USER / NORDRHEIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/user/data")
async def get_user_main_data():
    """
    Load all Nordrhein tab data: holdings vs benchmark table,
    STOXX announcements, cards, and alert flags.
    PUBLIC ENDPOINT
    """
    try:
        result = UserService.get_main_data()
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("User data error:\n%s", tb)
        return {"status": "error", "error": str(e)}


@app.get("/api/user/performance")
async def get_user_performance(
    period: str = Query("1Y", description="Time period: MtD, YtD, 1Y, All")
):
    """
    Return cumulative-return chart data for portfolio vs STOXX 50 benchmark.
    PUBLIC ENDPOINT
    """
    try:
        result = UserService.get_performance_data(period=period)
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        logging.error("User performance error: %s", e)
        return {"status": "error", "error": str(e)}


@app.get("/api/user/alerts")
async def get_user_alerts():
    """
    Lightweight endpoint returning only alert flag summary.
    Used by the sidebar to highlight the User tab.
    PUBLIC ENDPOINT
    """
    try:
        return UserService.get_alerts()
    except Exception as e:
        logging.error("User alerts error: %s", e)
        return {"status": "error", "error": str(e), "has_alerts": False}


# ═══════════════════════════════════════════════════════════════════════════
# GENERIC TABLE EXPORT ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════

class TableExportRequest(BaseModel):
    rows: list              # list of row dicts
    columns: List[str]      # ordered column names
    sheet_name: str = "Tabelle"
    filename: str = "Export"


@app.post("/api/export/table")
async def export_table(payload: TableExportRequest):
    """
    Generate a single-sheet Excel file from arbitrary table data.
    Unlike the chart export, this preserves all column types (strings included).
    PUBLIC ENDPOINT
    """
    try:
        df = pd.DataFrame(payload.rows, columns=payload.columns)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
            df.to_excel(writer, sheet_name=payload.sheet_name[:31], index=False)
        buf.seek(0)
        fname = f"{payload.filename}_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Table export error:\n%s", tb)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# DATA TAB ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/data/freshness")
async def get_data_freshness():
    """
    Run all data freshness checks and return structured results.
    Sections: performance, benchmark_weights, market_data_jm, bloomberg,
              data_pipe, sector_pe_ratios, port.
    """
    try:
        from services.data_service import get_all_freshness
        result = get_all_freshness()
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        logging.error("Data freshness error: %s", e)
        return {"status": "error", "error": str(e), "has_any_alerts": False}


@app.get("/api/data/job-checks")
async def get_data_job_checks():
    """
    Return status of daily job checks (Morning Mail, Masterpräsentationen,
    Top Bottom Daily, Top Bottom Monthly).
    """
    try:
        from utils.job_checks import get_daily_job_checks
        checks = get_daily_job_checks()
        return {"checks": checks}
    except Exception as e:
        logging.error("Job checks error: %s", e)
        return {"checks": [], "error": str(e)}


@app.get("/api/data/alerts")
async def get_data_alerts():
    """
    Lightweight endpoint: returns only whether the Data tab has active alerts.
    Used by the sidebar to highlight the Data tab red.
    """
    try:
        from services.data_service import get_all_freshness
        from utils.job_checks import get_daily_job_checks, has_failed_checks
        freshness = get_all_freshness()
        job_checks = get_daily_job_checks()
        has_alerts = freshness.get("has_any_alerts", False) or has_failed_checks(job_checks)
        return {"has_alerts": has_alerts}
    except Exception as e:
        logging.error("Data alerts error: %s", e)
        return {"has_alerts": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# ANLEIHEN / BONDS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

from services.anleihen_service import get_issuance_table, get_checks_table, get_chart_data as get_bond_chart_data


@app.get("/api/anleihen/issuance-table")
async def get_anleihen_issuance_table():
    """
    Return the full bond issuance table from new_issuance_bonds.xlsx.
    Includes merged ratings/amounts, ranking by CDS-ASW spread difference.
    PUBLIC ENDPOINT
    """
    try:
        result = get_issuance_table()
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Anleihen issuance table error:\n%s", tb)
        return {"status": "error", "error": str(e), "columns": [], "rows": []}


@app.get("/api/anleihen/checks-table")
async def get_anleihen_checks_table():
    """
    Return the renten_checks table combined with live cash percentages.
    Filtered for Renten funds only (excludes Kini).
    PUBLIC ENDPOINT
    """
    try:
        result = get_checks_table()
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Anleihen checks table error:\n%s", tb)
        return {"status": "error", "error": str(e), "columns": [], "rows": []}


class BondChartRequest(BaseModel):
    bond: dict   # the full bond row from the issuance table


@app.post("/api/anleihen/chart-data")
async def get_anleihen_chart_data(body: BondChartRequest):
    """
    Given a selected bond row, return CDS curve + ASW spread curves + bond point.
    Used to render the chart below the issuance table.
    PUBLIC ENDPOINT
    """
    try:
        result = get_bond_chart_data(body.bond)
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Anleihen chart data error:\n%s", tb)
        return {"status": "error", "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# DUOPLUS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

from services.duoplus_service import (
    get_region_data,
    get_custom_data,
    get_distinct_universes,
    build_factor_table,
    build_summary_table,
    get_data_quality_stats,
    get_overview_data,
    lookup_ticker_for_summary,
    save_trades_to_db,
    generate_bloomberg_csv_file,
)

# Factor column groups (same as original Dash project)
_US_VALUE_COLS    = ["P2B", "PE", "P2S"]
_US_GROWTH_COLS   = ["SG YoY", "EG YoY", "SG QoQ", "EG QoQ"]
_US_QUALITY_COLS  = ["RoE", "EPS StD", "D2E"]
_EU_VALUE_COLS    = ["P2B", "PE", "P2S"]
_EU_GROWTH_COLS   = ["SG YoY", "EG YoY"]
_EU_QUALITY_COLS  = ["RoE", "EPS StD", "D2E"]
_CUSTOM_VALUE_COLS   = ["P2B", "PE", "P2S"]
_CUSTOM_GROWTH_COLS  = ["SG YoY", "EG YoY"]
_CUSTOM_QUALITY_COLS = ["RoE", "EPS StD", "D2E"]


def _build_region_response(df, value_cols, growth_cols, quality_cols,
                            ticker: Optional[str] = None,
                            rank_limit: Optional[int] = None,
                            max_factor_rows: int = 30):
    """Shared helper: filter by ticker, build all four table payloads."""
    if ticker and ticker.strip():
        mask = df["ID"].str.upper().str.contains(ticker.strip().upper(), na=False)
        df = df[mask]

    factor_rows = rank_limit if rank_limit else max_factor_rows
    value_tbl   = build_factor_table(df, "Value",   value_cols,  rank_norm_limit=rank_limit, max_rows=factor_rows)
    growth_tbl  = build_factor_table(df, "Growth",  growth_cols, rank_norm_limit=rank_limit, max_rows=factor_rows)
    quality_tbl = build_factor_table(df, "Quality", quality_cols, rank_norm_limit=rank_limit, max_rows=factor_rows)
    summary_tbl = build_summary_table(df)

    return {
        "value":   value_tbl,
        "growth":  growth_tbl,
        "quality": quality_tbl,
        "summary": summary_tbl,
        "row_count": len(df),
    }


@app.get("/api/duoplus/us")
async def get_duoplus_us(ticker: Optional[str] = Query(default=None)):
    """
    Return fully ranked US DuoPlus data split into four tables:
    value, growth, quality (factor rank tables) and summary (metrics table).
    Optional ?ticker= for filtering by ticker substring.
    PUBLIC ENDPOINT
    """
    try:
        df = get_region_data("us")
        if df.empty:
            return {"status": "error", "error": "No US data available",
                    "value": {"columns": [], "rows": []},
                    "growth": {"columns": [], "rows": []},
                    "quality": {"columns": [], "rows": []},
                    "summary": {"columns": [], "rows": []}}
        result = _build_region_response(df, _US_VALUE_COLS, _US_GROWTH_COLS, _US_QUALITY_COLS, ticker=ticker)
        return _clean_nan_values(result)
    except Exception as e:
        logging.error("DuoPlus US error:\n%s", traceback.format_exc())
        return {"status": "error", "error": str(e)}


@app.get("/api/duoplus/europe")
async def get_duoplus_europe(ticker: Optional[str] = Query(default=None)):
    """
    Return fully ranked Europe DuoPlus data.
    Optional ?ticker= for filtering.
    PUBLIC ENDPOINT
    """
    try:
        df = get_region_data("eu")
        if df.empty:
            return {"status": "error", "error": "No Europe data available",
                    "value": {"columns": [], "rows": []},
                    "growth": {"columns": [], "rows": []},
                    "quality": {"columns": [], "rows": []},
                    "summary": {"columns": [], "rows": []}}
        result = _build_region_response(df, _EU_VALUE_COLS, _EU_GROWTH_COLS, _EU_QUALITY_COLS, ticker=ticker)
        return _clean_nan_values(result)
    except Exception as e:
        logging.error("DuoPlus Europe error:\n%s", traceback.format_exc())
        return {"status": "error", "error": str(e)}


@app.get("/api/duoplus/universes")
async def get_duoplus_universes():
    """
    Return the sorted list of distinct Universe values from the database.
    Used to populate the Custom tab universe dropdown.
    PUBLIC ENDPOINT
    """
    try:
        universes = get_distinct_universes()
        return {"universes": universes}
    except Exception as e:
        logging.error("DuoPlus universes error:\n%s", traceback.format_exc())
        return {"universes": [], "error": str(e)}


@app.get("/api/duoplus/custom")
async def get_duoplus_custom(
    universe: str = Query(...),
    rank_limit: int = Query(default=100, ge=1, le=500),
    ticker: Optional[str] = Query(default=None),
):
    """
    Return ranked data for a custom universe.
    ?universe=<name>  (required)
    ?rank_limit=100   (optional, default 100)
    ?ticker=<sub>     (optional ticker filter)
    PUBLIC ENDPOINT
    """
    try:
        df = get_custom_data(universe)
        if df.empty:
            return {"status": "error", "error": f"No data for universe: {universe}",
                    "value": {"columns": [], "rows": []},
                    "growth": {"columns": [], "rows": []},
                    "quality": {"columns": [], "rows": []},
                    "summary": {"columns": [], "rows": []}}
        result = _build_region_response(
            df, _CUSTOM_VALUE_COLS, _CUSTOM_GROWTH_COLS, _CUSTOM_QUALITY_COLS,
            ticker=ticker, rank_limit=rank_limit, max_factor_rows=rank_limit
        )
        return _clean_nan_values(result)
    except Exception as e:
        logging.error("DuoPlus Custom error:\n%s", traceback.format_exc())
        return {"status": "error", "error": str(e)}


@app.get("/api/duoplus/data-quality")
async def get_duoplus_data_quality():
    """
    Return data-quality statistics for US and EU regions:
    total stocks, missing data counts, latest data date, outlier list, missing-data list.
    PUBLIC ENDPOINT
    """
    try:
        stats = get_data_quality_stats()
        return _clean_nan_values(stats)
    except Exception as e:
        logging.error("DuoPlus data quality error:\n%s", traceback.format_exc())
        return {"us": {"error": str(e)}, "eu": {"error": str(e)}}


@app.get("/api/duoplus/overview")
async def get_duoplus_overview(
    factor_order: str = "VGQ",
    draft: bool = False,
    momentum: bool = False,
    highest_rank: bool = False,
):
    """
    Return all Overview tab data: T0 top-5, T-1/T-2 historical with highlights,
    and the base summary table rows. Recalculates when controls change.
    PUBLIC ENDPOINT
    """
    try:
        data = get_overview_data(
            factor_order=factor_order,
            draft_mode=draft,
            momentum_filter=momentum,
            highest_rank=highest_rank,
        )
        return _clean_nan_values(data)
    except Exception as e:
        logging.error("DuoPlus overview error:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/duoplus/overview/ticker")
async def duoplus_ticker_lookup(ticker: str):
    """
    Find a ticker in US or EU ranked data and return a summary row for manual add.
    PUBLIC ENDPOINT
    """
    try:
        row = lookup_ticker_for_summary(ticker)
        if row is None:
            return {"found": False, "row": None}
        return {"found": True, "row": _clean_nan_values(row)}
    except Exception as e:
        return {"found": False, "row": None, "error": str(e)}


@app.post("/api/duoplus/trades")
async def duoplus_save_trades(body: dict):
    """
    Save Hold/Buy trades from the summary table to [Duoplus_Trades].
    Validates exactly 5 tickers per factor per region.
    PUBLIC ENDPOINT
    """
    summary  = body.get("trades", [])
    username = body.get("username", "")
    success, msg = save_trades_to_db(summary, username)
    return {"success": success, "message": msg}


@app.post("/api/duoplus/bloomberg-csv")
async def duoplus_bloomberg_csv(body: dict):
    """
    Write Bloomberg upload CSV to the shared network path.
    PUBLIC ENDPOINT
    """
    decision_data = body.get("trades", [])
    success, msg = generate_bloomberg_csv_file(decision_data)
    return {"success": success, "message": msg}


# ═══════════════════════════════════════════════════════════════════════════
# PORTFOLIOS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

from services.portfolio_service import (
    get_overview_data as _portfolios_overview,
    get_portfolio_list as _portfolios_list,
    get_portfolio_detail as _portfolios_detail,
)


@app.get("/api/portfolios/overview")
async def portfolios_overview():
    """
    Return all data for the Portfolios → Overview subtab:
      - AUM summary cards (total, MA, HC, Spezial)
      - AUM by portfolio table
      - Liquiditätsübersicht table rows (with expandable currency sub-rows)
    PUBLIC ENDPOINT
    """
    try:
        result = _portfolios_overview()
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Portfolios overview error:\n%s", tb)
        return {"status": "error", "error": str(e)}


@app.get("/api/portfolios/holdings")
async def portfolios_holdings_list():
    """
    Return the sorted list of portfolios for the dropdown in the Portfolio subtab.
    PUBLIC ENDPOINT
    """
    try:
        return _portfolios_list()
    except Exception as e:
        logging.error("Portfolios list error: %s", e)
        return {"status": "error", "error": str(e), "portfolios": []}


@app.get("/api/portfolios/holdings/{portfolio_name}")
async def portfolios_holdings_detail(portfolio_name: str):
    """
    Return holdings, allocation slices, and metric cards for one portfolio.
    PUBLIC ENDPOINT
    """
    try:
        result = _portfolios_detail(portfolio_name)
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Portfolios detail error:\n%s", tb)
        return {"status": "error", "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# PORTFOLIOS → PERFORMANCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

from services.performance_service import (
    get_performance_meta  as _perf_meta,
    get_performance_table as _perf_table,
    get_performance_chart as _perf_chart,
)
from pydantic import BaseModel as _PydanticBase


class _PerfTableRequest(_PydanticBase):
    portfolios:     List[str]                   = []
    source:         str                         = "kvg"
    anteilsklasse:  Dict[str, bool]             = {"V": True, "R": False}
    portfolio_type: Dict[str, bool]             = {"All": True, "EQ": False, "FI": False}
    as_of_date:     Optional[str]               = None
    custom_start:   Optional[str]               = None
    custom_end:     Optional[str]               = None


class _PerfChartRequest(_PydanticBase):
    portfolios:      List[str]        = []
    source:          str              = "bloomberg"
    portfolio_type:  Dict[str, bool]  = {"All": True, "EQ": False, "FI": False}
    anteilsklasse:   Dict[str, bool]  = {"V": True, "R": False}
    start_date:      Optional[str]    = None
    end_date:        Optional[str]    = None
    show_benchmarks: bool             = False


@app.get("/api/portfolios/performance/meta")
async def performance_meta():
    """Return fund list and team structure for Performance tab dropdowns."""
    try:
        return _perf_meta()
    except Exception as e:
        logging.error("Performance meta error: %s", e)
        return {"status": "error", "error": str(e), "funds": [], "teams": {}}


@app.post("/api/portfolios/performance/table")
async def performance_table(req: _PerfTableRequest):
    """
    Return multi-period performance table rows.
    Periods: MtD, LM, YtD, 1Y (+ optional custom range).
    Each row has portfolio return, benchmark return (Bloomberg composite), and relative.
    """
    try:
        result = _perf_table(
            portfolios=req.portfolios,
            source=req.source,
            anteilsklasse=req.anteilsklasse,
            portfolio_type=req.portfolio_type,
            as_of_date=req.as_of_date,
            custom_start=req.custom_start,
            custom_end=req.custom_end,
        )
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Performance table error:\n%s", tb)
        return {"status": "error", "error": str(e), "rows": []}


@app.post("/api/portfolios/performance/chart")
async def performance_chart(req: _PerfChartRequest):
    """
    Return cumulative return series (rebased to 0% at start) for the chart.
    Includes optional benchmark series as dashed lines.
    """
    try:
        result = _perf_chart(
            portfolios=req.portfolios,
            source=req.source,
            portfolio_type=req.portfolio_type,
            anteilsklasse=req.anteilsklasse,
            start_date=req.start_date,
            end_date=req.end_date,
            show_benchmarks=req.show_benchmarks,
        )
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Performance chart error:\n%s", tb)
        return {"status": "error", "error": str(e), "series": []}


# ═══════════════════════════════════════════════════════════════════════════
# PORTFOLIOS → ATTRIBUTION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

from services.attribution_service import (
    get_attribution_meta  as _attr_meta,
    get_attribution_table as _attr_table,
)


class _AttrTableRequest(_PydanticBase):
    portfolio_name: str
    scope:          str
    period:         str
    run_date:       Optional[str] = None   # "YYYY-MM-DD"; latest if omitted


@app.get("/api/portfolios/attribution/meta")
async def attribution_meta():
    """
    Return all distinct filter values for Attribution tab dropdowns:
    portfolios, scopes per portfolio, periods and run dates.
    """
    try:
        return _attr_meta()
    except Exception as e:
        logging.error("Attribution meta error: %s", e)
        return {"status": "error", "error": str(e), "portfolios": []}


@app.post("/api/portfolios/attribution/table")
async def attribution_table(req: _AttrTableRequest):
    """
    Return hierarchical attribution rows for a portfolio/scope/period/date.
    Each row carries: id, parent_id, structure, level, name,
    weightPortfolio/Benchmark/Active, CTRPortfolio/Benchmark/Active,
    returnPortfolio/Benchmark/Active.
    """
    try:
        result = _attr_table(
            portfolio_name=req.portfolio_name,
            scope=req.scope,
            period=req.period,
            run_date=req.run_date,
        )
        result = _clean_nan_values(result)
        return result
    except Exception as e:
        tb = traceback.format_exc()
        logging.error("Attribution table error:\n%s", tb)
        return {"status": "error", "error": str(e), "rows": []}


# ─────────────────────────────────────────────────────────────────────────────
# Länder Metrics Documentation Export
# ─────────────────────────────────────────────────────────────────────────────

def _build_metrics_documentation_excel() -> bytes:
    """
    Build an Excel workbook documenting all Länder tab metrics.
    Queries ticker_master live for region/ticker/frequency data.
    Returns raw bytes of the .xlsx file.
    """
    import io
    import xlsxwriter
    from utils.database import DatabaseGateway

    db = DatabaseGateway()
    engine = db.get_duoplus_engine()

    # ── 1.  Load all Countries tickers from DB ────────────────────────────
    fi_df = pd.read_sql_query(
        """
        SELECT Ticker, Regions,
               [Dashboard Grouping Name] AS GroupingName,
               Period, Frequency
        FROM [ApoAsset_Quant].[dbo].[ticker_master]
        WHERE [Dashboard Page] = 'Countries'
          AND [Dashboard Grouping] = 'Fixed Income'
          AND Active = 1
        """,
        engine,
    )

    macro_df = pd.read_sql_query(
        """
        SELECT Ticker, Regions,
               [Dashboard Grouping Name] AS GroupingName,
               Period, Frequency
        FROM [ApoAsset_Quant].[dbo].[ticker_master]
        WHERE [Dashboard Page] = 'Countries'
          AND [Dashboard Grouping] = 'Macro'
          AND Active = 1
        """,
        engine,
    )

    eq_df = pd.read_sql_query(
        """
        SELECT Ticker, Regions, Frequency
        FROM [ApoAsset_Quant].[dbo].[ticker_master]
        WHERE [Dashboard Page] = 'Countries'
          AND Active IN (1.0, 2.0)
          AND (Ticker LIKE 'M1%' OR Ticker LIKE 'NDDU%')
        """,
        engine,
    )

    # ── 2. Helper: build {region: [ticker, …]} from a filtered DF ─────────
    def tickers_by_region(df: pd.DataFrame) -> dict:
        result: dict = {}
        for _, row in df.iterrows():
            r = str(row["Regions"]).strip()
            t = str(row["Ticker"]).strip()
            result.setdefault(r, []).append(t)
        return result

    def freq_from_df(df: pd.DataFrame, default: str = "Täglich") -> str:
        if df.empty or "Frequency" not in df.columns:
            return default
        val = df["Frequency"].dropna().iloc[0] if not df["Frequency"].dropna().empty else default
        freq_map = {
            "Daily": "Täglich", "Monthly": "Monatlich",
            "Quarterly": "Quartalsmäßig", "Yearly": "Jährlich",
            "Weekly": "Wöchentlich",
        }
        return freq_map.get(str(val).strip(), str(val).strip())

    def fmt_tickers(by_region: dict) -> str:
        de_names = {
            "U.S.": "U.S.", "Europe": "Europa", "Germany": "Deutschland",
            "France": "Frankreich", "Italy": "Italien", "UK": "UK",
            "Japan": "Japan", "Spain": "Spanien", "China": "China",
            "India": "Indien", "EM": "EM", "Australia": "Australien",
            "Belgium": "Belgien", "Latvia": "Lettland", "Lithuania": "Litauen",
            "Mexico": "Mexiko", "Netherlands": "Niederlande",
            "New Zealand": "Neuseeland", "Norway": "Norwegen",
            "Poland": "Polen", "Portugal": "Portugal", "Sweden": "Schweden",
        }
        parts = []
        for r, tickers in sorted(by_region.items()):
            label = de_names.get(r, r)
            parts.append(f"{label}: {', '.join(tickers)}")
        return "; ".join(parts)

    def fmt_regions(by_region: dict) -> str:
        de_names = {
            "U.S.": "U.S.", "Europe": "Europa", "Germany": "Deutschland",
            "France": "Frankreich", "Italy": "Italien", "UK": "UK",
            "Japan": "Japan", "Spain": "Spanien", "China": "China",
            "India": "Indien", "EM": "EM", "Australia": "Australien",
            "Belgium": "Belgien", "Latvia": "Lettland", "Lithuania": "Litauen",
            "Mexico": "Mexiko", "Netherlands": "Niederlande",
            "New Zealand": "Neuseeland", "Norway": "Norwegen",
            "Poland": "Polen", "Portugal": "Portugal", "Sweden": "Schweden",
        }
        return ", ".join(sorted(de_names.get(r, r) for r in by_region))

    # ── 3. FI helper: filter by GroupingName + Period ─────────────────────
    def fi_metric(grouping: str, period: str | None = None):
        mask = fi_df["GroupingName"] == grouping
        if period is not None:
            mask &= fi_df["Period"].astype(str) == str(period)
        sub = fi_df[mask]
        return tickers_by_region(sub), freq_from_df(sub)

    # Equity base tickers
    eq_by_region = tickers_by_region(eq_df)
    eq_freq = freq_from_df(eq_df, "Täglich")

    # Macro helper
    def macro_metric(grouping: str):
        sub = macro_df[macro_df["GroupingName"] == grouping]
        return tickers_by_region(sub), freq_from_df(sub)

    # Government Debt from Macro (used in both Macro and FI tabs)
    gov_debt_by_region, gov_debt_freq = macro_metric("Government Debt")

    # ── 4. Metric definitions ─────────────────────────────────────────────
    #  Each entry: (Kategorie, Metrik, Perzentil-Berechnung, Bed. Formatierung,
    #               {region: [ticker]}, Frequenz)
    COMPUTED_EQ = (
        "Eigenberechnung (abgeleitet aus MSCI-Indexkursen; Basisindizes je Region)"
    )
    CROSS_REGION_PCT = (
        "Regionsübergreifendes Perzentil: Der aktuelle Wert dieser Region wird "
        "anhand der letzten verfügbaren Werte aller Regionen in eine Rangliste "
        "eingeordnet (0 % = Minimum über alle Regionen, 100 % = Maximum)."
    )
    TIMESERIES_PCT = (
        "Zeitreihen-Perzentil: Der aktuelle Wert wird im Vergleich zur historischen "
        "Verteilung dieser Region über den gewählten Betrachtungszeitraum "
        "eingestuft (0 % = historisches Tief dieser Region, 100 % = historisches Hoch)."
    )
    NO_PCT = "Kein Perzentil: Die Kennzahl wird als absoluter Wert dargestellt."

    FMT_GREEN_HIGH = (
        "Rot-Grün-Farbskala (regionsübergreifend): "
        "Grüne Zelle = hoher Wert im Vergleich zu anderen Regionen (positiv); "
        "rote Zelle = niedriger Wert (negativ)."
    )
    FMT_GREEN_LOW = (
        "Rot-Grün-Farbskala (regionsübergreifend): "
        "Grüne Zelle = niedriger Wert im Vergleich zu anderen Regionen (positiv); "
        "rote Zelle = hoher Wert (negativ)."
    )
    FMT_TIMESERIES = (
        "Blau-Amber-Farbskala (Zeitreihe): "
        "Blaue Zelle = historisch niedriger Wert; "
        "amber/orangefarbene Zelle = historisch hoher Wert. "
        "Richtungsunabhängig – kein Gut/Schlecht-Urteil."
    )
    FMT_SP = (
        "Rot-Grün-Farbskala nach Kreditqualität: "
        "AAA (bestes Rating) = grün; D (schlechtestes Rating) = rot."
    )
    FMT_NONE = "Keine Farbkodierung."

    # Precompute FI groups
    fi_yields_by = {}
    for period_key in ["2Y", "5Y", "10Y", "20Y", "30Y"]:
        fi_yields_by[period_key] = fi_metric("Yields", period_key)

    fi_infl_by = {}
    for p in ["1Y", "2Y", "5Y", "10Y"]:
        fi_infl_by[p] = fi_metric("Inflation Expectations", p)

    fi_cds_3, fi_cds_3_freq = fi_metric("CDS", "3")
    fi_cds_5, fi_cds_5_freq = fi_metric("CDS", "5")
    fi_cds_7, fi_cds_7_freq = fi_metric("CDS", "7")
    fi_cds_10, fi_cds_10_freq = fi_metric("CDS", "10")
    fi_be_by, fi_be_freq = fi_metric("Breakevens", "10Y")

    # Steepness/Curvature/Spreads to Bunds: same regions as 10Y Yields
    yields_10y_by, yields_freq = fi_yields_by["10Y"]
    derived_fi_note = (
        "Eigenberechnung (aus Renditedaten der einzelnen Laufzeiten abgeleitet)"
    )

    metrics: list[tuple] = [
        # ── AKTIEN ───────────────────────────────────────────────────────────
        ("Aktien", "Momentum 3M",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "Momentum 12M",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "TS-Momentum",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "Wachstumsrate",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "Bewertung Aggregiert",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         "Eigenberechnung (gewichteter Durchschnitt aus KGV, KBV, KUV und Ertragsrendite)"),
        ("Aktien", "Risikoprämie",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         "Eigenberechnung (Ertragsrendite minus risikoloser Zins)"),
        ("Aktien", "Dividendenrendite",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "Ertragsrendite",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "KUV",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "KBV",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "KGV",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "KGV (Fwd.)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         COMPUTED_EQ),
        ("Aktien", "KGV - KGV (Fwd.)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         "Eigenberechnung (KGV minus Forward-KGV: PE_RATIO − BEST_PE_RATIO)"),
        ("Aktien", "Volatilität (6M Roll.)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         eq_by_region, eq_freq,
         "Eigenberechnung (rollierende 6-Monats-Standardabweichung der Tagesrenditen)"),
        ("Aktien", "RSI",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         "Eigenberechnung (Relative Strength Index, 14 Tage)"),
        ("Aktien", "MACD",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         eq_by_region, eq_freq,
         "Eigenberechnung (MACD = EMA 12 minus EMA 26)"),

        # ── ANLEIHEN ─────────────────────────────────────────────────────────
        ("Anleihen", "S&P Rating",
         NO_PCT, FMT_SP,
         {}, "Statisch",
         "S&P-Länderratings (Quelle: Bloomberg / S&P Global)"),
        ("Anleihen", "Verschuldung (FI)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         gov_debt_by_region, gov_debt_freq,
         "Bloomberg (Staatsverschuldung in % des BIP)"),
        ("Anleihen", "3J CDS",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_cds_3, fi_cds_3_freq,
         "Quant-Datenbank (Markit CDX/iTraxx CDS-Spreads)"),
        ("Anleihen", "5J CDS",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_cds_5, fi_cds_5_freq,
         "Quant-Datenbank (Markit CDX/iTraxx CDS-Spreads)"),
        ("Anleihen", "7J CDS",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_cds_7, fi_cds_7_freq,
         "Quant-Datenbank (Markit CDX/iTraxx CDS-Spreads)"),
        ("Anleihen", "10J CDS",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_cds_10, fi_cds_10_freq,
         "Quant-Datenbank (Markit CDX/iTraxx CDS-Spreads)"),
        ("Anleihen", "2J Rendite",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_yields_by["2Y"][0], fi_yields_by["2Y"][1],
         "Quant-Datenbank (Benchmark-Staatsanleihenrenditen, BVLI-Kurve)"),
        ("Anleihen", "5J Rendite",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_yields_by["5Y"][0], fi_yields_by["5Y"][1],
         "Quant-Datenbank (Benchmark-Staatsanleihenrenditen, BVLI-Kurve)"),
        ("Anleihen", "10J Rendite",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_yields_by["10Y"][0], fi_yields_by["10Y"][1],
         "Quant-Datenbank (Benchmark-Staatsanleihenrenditen, BVLI-Kurve)"),
        ("Anleihen", "20J Rendite",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_yields_by["20Y"][0], fi_yields_by["20Y"][1],
         "Quant-Datenbank (Benchmark-Staatsanleihenrenditen, BVLI-Kurve)"),
        ("Anleihen", "30J Rendite",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_yields_by["30Y"][0], fi_yields_by["30Y"][1],
         "Quant-Datenbank (Benchmark-Staatsanleihenrenditen, BVLI-Kurve)"),
        ("Anleihen", "Steilheit (10J-2J)",
         TIMESERIES_PCT, FMT_TIMESERIES,
         yields_10y_by, yields_freq,
         derived_fi_note + " – Differenz 10J-Rendite minus 2J-Rendite"),
        ("Anleihen", "Krümmung",
         TIMESERIES_PCT, FMT_TIMESERIES,
         yields_10y_by, yields_freq,
         derived_fi_note + " – Krümmung der Zinskurve (2 × 5J − 2J − 10J)"),
        ("Anleihen", "Aufschläge zu Bunds",
         TIMESERIES_PCT, FMT_TIMESERIES,
         yields_10y_by, yields_freq,
         derived_fi_note + " – 10J-Rendite der Region minus 10J-Bund-Rendite"),
        ("Anleihen", "1J Infl. Erw.",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_infl_by["1Y"][0], fi_infl_by["1Y"][1],
         "Bloomberg (Inflation-Swap-Sätze)"),
        ("Anleihen", "2J Infl. Erw.",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_infl_by["2Y"][0], fi_infl_by["2Y"][1],
         "Bloomberg (Inflation-Swap-Sätze)"),
        ("Anleihen", "5J Infl. Erw.",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_infl_by["5Y"][0], fi_infl_by["5Y"][1],
         "Bloomberg (Inflation-Swap-Sätze)"),
        ("Anleihen", "10J Infl. Erw.",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_infl_by["10Y"][0], fi_infl_by["10Y"][1],
         "Bloomberg (Inflation-Swap-Sätze)"),
        ("Anleihen", "10J Breakevens",
         TIMESERIES_PCT, FMT_TIMESERIES,
         fi_be_by, fi_be_freq,
         "Bloomberg (Break-even-Inflationsraten aus inflationsgeschützten Anleihen)"),

        # ── MAKRO ─────────────────────────────────────────────────────────────
        ("Makro", "BIP",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("GDP"),
         "Bloomberg (BIP-Wachstum YoY, %)"),
        ("Makro", "Überraschungsindex",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Economic Surprise"),
         "Bloomberg (Citi Economic Surprise Index)"),
        ("Makro", "Industrie",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Industrial Production"),
         "Bloomberg (Industrieproduktion YoY, %)"),
        ("Makro", "Einzelhandel",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Retail Sales"),
         "Bloomberg (Einzelhandelsumsätze YoY, %)"),
        ("Makro", "Inflation",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Inflation"),
         "Bloomberg (Verbraucherpreisindex YoY, %)"),
        ("Makro", "Arbeitslosigkeit",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Unemployment"),
         "Bloomberg (Arbeitslosenquote, %)"),
        ("Makro", "Inflation + Arbeitslosigkeit",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Inflation"),
         "Eigenberechnung (Misery Index = Inflation + Arbeitslosigkeit)"),
        ("Makro", "PMI Gesamt",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Composite PMI"),
         "Quant-Datenbank (S&P Global Composite PMI)"),
        ("Makro", "PMI Industrie",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Manufacturing PMI"),
         "Quant-Datenbank (S&P Global Manufacturing PMI)"),
        ("Makro", "PMI Dienstleistungen",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Services PMI"),
         "Quant-Datenbank (S&P Global Services PMI)"),
        ("Makro", "Verbrauchervertrauen",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Consumer Confidence"),
         "Bloomberg (Verbrauchervertrauensindex)"),
        ("Makro", "Exporte (YoY %)",
         CROSS_REGION_PCT, FMT_GREEN_HIGH,
         *macro_metric("Exports"),
         "Bloomberg (Exporte YoY, %)"),
        ("Makro", "Importe (YoY %)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Imports"),
         "Bloomberg (Importe YoY, %)"),
        ("Makro", "Verschuldung (Makro)",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Government Debt"),
         "Bloomberg (Staatsverschuldung in % des BIP)"),
        ("Makro", "Leitzins",
         CROSS_REGION_PCT, FMT_GREEN_LOW,
         *macro_metric("Interest Rate"),
         "Bloomberg (Zentralbank-Leitzins, %)"),
    ]

    # ── 5. Build Excel ────────────────────────────────────────────────────
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("Metriken-Dokumentation")

    # Formats
    hdr_fmt = workbook.add_format({
        "bold": True, "bg_color": "#1F3864", "font_color": "#FFFFFF",
        "border": 1, "text_wrap": True, "valign": "vcenter", "align": "center",
        "font_size": 10,
    })
    cat_equity_fmt = workbook.add_format({
        "bold": True, "bg_color": "#D6E4F7", "border": 1,
        "text_wrap": True, "valign": "top", "font_size": 9,
    })
    cat_fi_fmt = workbook.add_format({
        "bold": True, "bg_color": "#E2EFDA", "border": 1,
        "text_wrap": True, "valign": "top", "font_size": 9,
    })
    cat_macro_fmt = workbook.add_format({
        "bold": True, "bg_color": "#FFF2CC", "border": 1,
        "text_wrap": True, "valign": "top", "font_size": 9,
    })
    cell_fmt = workbook.add_format({
        "border": 1, "text_wrap": True, "valign": "top", "font_size": 9,
    })

    COL_HEADERS = [
        "Metrik",
        "Perzentil-Berechnung",
        "Bedingte Formatierung",
        "Verfügbare Regionen",
        "Bloomberg-Ticker (Region: Ticker)",
        "Datenfrequenz",
    ]
    COL_WIDTHS = [22, 60, 60, 40, 80, 16]

    for col, (header, width) in enumerate(zip(COL_HEADERS, COL_WIDTHS)):
        ws.write(0, col, header, hdr_fmt)
        ws.set_column(col, col, width)

    ws.set_row(0, 30)

    for row_idx, entry in enumerate(metrics, start=1):
        cat, label, pct_desc, fmt_desc, by_region, freq, ticker_note = entry

        if cat == "Aktien":
            label_fmt = cat_equity_fmt
        elif cat == "Anleihen":
            label_fmt = cat_fi_fmt
        else:
            label_fmt = cat_macro_fmt

        regions_str = fmt_regions(by_region) if by_region else "–"
        tickers_str = fmt_tickers(by_region) if by_region else ticker_note

        ws.write(row_idx, 0, f"[{cat}] {label}", label_fmt)
        ws.write(row_idx, 1, pct_desc, cell_fmt)
        ws.write(row_idx, 2, fmt_desc, cell_fmt)
        ws.write(row_idx, 3, regions_str, cell_fmt)
        ws.write(row_idx, 4, tickers_str, cell_fmt)
        ws.write(row_idx, 5, freq, cell_fmt)
        ws.set_row(row_idx, 60)

    workbook.close()
    output.seek(0)
    return output.read()


@app.get("/api/countries/metrics-documentation/excel")
async def download_metrics_documentation():
    """
    Download an Excel file documenting all Länder tab metrics:
    label, percentile method, conditional formatting logic,
    available regions, Bloomberg tickers, data frequency.
    Data is sourced live from the ticker_master database table.
    """
    try:
        xlsx_bytes = await asyncio.get_event_loop().run_in_executor(
            None, _build_metrics_documentation_excel
        )
        ts = datetime.now().strftime("%Y-%m-%d")
        filename = f"Metriken_Dokumentation_{ts}.xlsx"
        return StreamingResponse(
            io.BytesIO(xlsx_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        logging.error("Metrics documentation export failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
