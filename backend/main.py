from fastapi import FastAPI, Depends, HTTPException, status, Query
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

logging.basicConfig(level=logging.DEBUG)
from datetime import datetime, timedelta, timezone
import jwt
from typing import List, Optional, Any
from pydantic import BaseModel
import pandas as pd
from utils.export_utils import build_excel, build_pptx
from utils.auth import (
    authenticate_user, create_session, invalidate_session,
    validate_session, get_user_by_id, get_user_permissions, change_password
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

# Security
security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token"""
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ═══════════════════════════════════════════════════════════════════════════
# HEALTH & ROOT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health_check():
    """Health check endpoint to verify API is running - PUBLIC ENDPOINT"""
    return {"message": "API is running successfully", "status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

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
            "sub": user["user_id"],
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
# EXPORT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class ExportItem(BaseModel):
    id: str
    title: str
    pptx_title: Optional[str] = None   # short title for PPTX slide header
    subheading: str = ""               # unit / date range (PPTX subtitle)
    source: str = ""                   # data source (PPTX footer)
    tab: str = ""
    group: int = 1                     # same group = same sheet / slide
    chartData: list
    regions: List[str] = []
    xKey: str = "DatePoint"

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
