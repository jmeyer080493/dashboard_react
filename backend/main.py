from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
import sys
from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
import jwt
from typing import List, Optional

# Load environment variables
load_dotenv()

# Note: Will integrate original dashboard.utils.get_data functions later
# sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'dashboard'))

# Import services
from services.länder_service import LänderDataService

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

# ═══════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/login")
async def login(username: str = Query(...), password: str = Query(...)):
    """Login endpoint - returns JWT token - PUBLIC ENDPOINT"""
    # TODO: Implement actual authentication against SQL database
    # For now, return a mock token for any user
    token = jwt.encode(
        {"sub": 1, "username": username, "exp": datetime.now(timezone.utc) + timedelta(hours=24)},
        SECRET_KEY,
        algorithm=ALGORITHM
    )
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/auth/me")
async def get_current_user(user_id: int = Depends(verify_token)):
    """Get current user info"""
    # TODO: Fetch user from database
    return {"user_id": user_id, "username": "test_user"}

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
        
        return result
    except Exception as e:
        return {"error": str(e), "status": "error"}

@app.get("/api/countries/equity/columns")
async def get_equity_columns(
    regions: str = Query("Germany", description="Comma-separated list of regions"),
    lookback: str = Query("1Y", description="Lookback period (1Y, 3Y, 5Y, All)")
):
    """Get available numerical columns for equity data (excluding '_avg_' columns) - PUBLIC ENDPOINT"""
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
        # Parse regions from comma-separated string
        region_list = [r.strip() for r in regions.split(",")]
        
        # Get data from service
        result = LänderDataService.get_fixed_income_data(
            regions=region_list,
            start_date=start_date,
            end_date=end_date,
            lookback=lookback,
            show_averages=show_averages
        )
        
        return result
    except Exception as e:
        return {"error": str(e), "status": "error"}

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
        # Parse regions from comma-separated string
        region_list = [r.strip() for r in regions.split(",")]
        
        # Get data from service
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
