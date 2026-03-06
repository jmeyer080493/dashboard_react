"""
Portfolio Attribution Tab Data Service

Provides data for the Portfolios → Attribution subtab.

Data source:
  - ApoAsset_JM.dbo.portfolio_attribution  (via jm_engine / apo-sql-dev)

Table columns returned:
  id, parent_id, structure, level, level1, level2, level3,
  name, weightPortfolio, weightBenchmark, weightActive,
  CTRPortfolio, CTRBenchmark, CTRActive,
  returnPortfolio, returnBenchmark, returnActive
"""

from __future__ import annotations

import logging
import re
from typing import Optional, List, Dict, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

from utils.database import DatabaseGateway

db = DatabaseGateway()

# ──────────────────────────────────────────────────────────────────────────────
# Data loader  (loads full table once; no per-request caching needed given size)
# ──────────────────────────────────────────────────────────────────────────────

_attr_df: Optional[pd.DataFrame] = None


def _load_attribution_data() -> pd.DataFrame:
    """Return full attribution DataFrame, loading from DB on first call."""
    global _attr_df
    if _attr_df is not None:
        return _attr_df

    engine = db.jm_engine
    if engine is None:
        logger.warning("jm_engine not available for attribution data")
        return pd.DataFrame()

    try:
        df = pd.read_sql_query("SELECT * FROM portfolio_attribution", engine)
        if "occ" in df.columns:
            df = df.drop(columns=["occ"])
        df["RunDate"] = pd.to_datetime(df["RunDate"], errors="coerce")
        _attr_df = df
        logger.info("Loaded attribution data: %d rows", len(df))
        return df
    except Exception as exc:
        logger.error("Failed to load attribution data: %s", exc)
        return pd.DataFrame()


def invalidate_cache() -> None:
    """Force reload of attribution data on next request."""
    global _attr_df
    _attr_df = None


# ──────────────────────────────────────────────────────────────────────────────
# Row structure classification  (mirrors pa_callbacks.py classify_structure)
# ──────────────────────────────────────────────────────────────────────────────

def _is_empty(val) -> bool:
    return val is None or (isinstance(val, float) and np.isnan(val)) or (isinstance(val, str) and val.strip() == "")


def _classify_structure(l1, l2, l3, l4) -> str:
    """Classify a row's hierarchical structure."""
    # Top-level summary rows
    if l1 == "Overall" and _is_empty(l2) and _is_empty(l3) and _is_empty(l4):
        return "Overarching"
    if l1 in ("Residuals", "Holdings") and str(l2).strip().lower() == "overall" and _is_empty(l3) and _is_empty(l4):
        return "Overarching"

    # Plain securities (no L3/L4 categories)
    if l1 == "Holdings" and str(l2).strip().lower() == "security" and _is_empty(l3) and _is_empty(l4):
        return "OnlySecurity"

    # L2 category summary (L3 == "Overall", L4 empty)
    if (l1 == "Holdings" and not _is_empty(l2)
            and str(l2).strip().lower() != "security"
            and str(l3).strip().lower() == "overall"
            and _is_empty(l4)):
        return "Main"

    # L2 → direct security (no L3 category, L3 == "Security")
    if (l1 == "Holdings" and not _is_empty(l2)
            and str(l2).strip().lower() != "security"
            and str(l3).strip().lower() == "security"
            and _is_empty(l4)):
        return "Main|DirectSecurity"

    # L2 → L3 sub-category summary (L4 == "Overall")
    if (l1 == "Holdings" and not _is_empty(l2) and not _is_empty(l3)
            and str(l3).strip().lower() != "security"
            and str(l4).strip().lower() == "overall"):
        return "Main|Sub"

    # L2 → L3 → security  (L4 == "Security")
    if (l1 == "Holdings" and not _is_empty(l2) and not _is_empty(l3)
            and str(l3).strip().lower() != "security"
            and str(l4).strip().lower() == "security"):
        return "Main|Sub|Security"

    return "Other"


# ──────────────────────────────────────────────────────────────────────────────
# Sorting helpers  (mirrors pa_callbacks.py get_sort_key)
# ──────────────────────────────────────────────────────────────────────────────

_EXCEPTION_NAMES = {"not classified", "other", "others"}
_NUM_PREFIX_RE = re.compile(r"^(\d+)")


def _numeric_prefix_sort(text: str):
    """Return (numeric_key, text) tuple for range-label sorting."""
    if not isinstance(text, str):
        return (float("inf"), str(text).lower())
    m = _NUM_PREFIX_RE.match(text.strip())
    if m:
        return (int(m.group(1)), text.lower())
    return (float("inf"), text.lower())


def _safe_str(val) -> str:
    if _is_empty(val):
        return ""
    return str(val)


def _row_sort_key(structure: str, l1: str, l2: str, l3: str, name: str):
    l2s = _safe_str(l2)
    l3s = _safe_str(l3)
    ns  = _safe_str(name).lower()

    if structure == "Overarching":
        order = {"Overall": 0, "Residuals": 1}.get(l1, 2)
        return (0, order, 0, "", 0, 0, 0, "", "")

    if structure == "Main":
        exc = int(l2s.lower() in _EXCEPTION_NAMES)
        n, s = _numeric_prefix_sort(l2s)
        return (1, exc, n, s, 0, 0, 0, "", "")

    if structure == "Main|Sub":
        exc2 = int(l2s.lower() in _EXCEPTION_NAMES)
        exc3 = int(l3s.lower() in _EXCEPTION_NAMES)
        n2, s2 = _numeric_prefix_sort(l2s)
        n3, s3 = _numeric_prefix_sort(l3s)
        return (1, exc2, n2, s2, 1, exc3, n3, s3, "")

    if structure == "Main|Sub|Security":
        exc2 = int(l2s.lower() in _EXCEPTION_NAMES)
        exc3 = int(l3s.lower() in _EXCEPTION_NAMES)
        n2, s2 = _numeric_prefix_sort(l2s)
        n3, s3 = _numeric_prefix_sort(l3s)
        return (1, exc2, n2, s2, 1, exc3, n3, s3, ns)

    if structure == "Main|DirectSecurity":
        exc2 = int(l2s.lower() in _EXCEPTION_NAMES)
        n2, s2 = _numeric_prefix_sort(l2s)
        return (1, exc2, n2, s2, 2, 0, float("inf"), "", ns)

    if structure == "OnlySecurity":
        return (2, 0, 0, "", 0, 0, float("inf"), "", ns)

    return (99, 0, 0, "", 0, 0, float("inf"), "", ns)


# ──────────────────────────────────────────────────────────────────────────────
# Numeric helpers
# ──────────────────────────────────────────────────────────────────────────────

_NUM_COLS = [
    "weightPortfolio", "weightBenchmark", "weightActive",
    "CTRPortfolio",    "CTRBenchmark",    "CTRActive",
    "returnPortfolio", "returnBenchmark", "returnActive",
]


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return None if np.isnan(f) or np.isinf(f) else round(f, 4)
    except (ValueError, TypeError):
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Public API: meta
# ──────────────────────────────────────────────────────────────────────────────

def get_attribution_meta() -> dict:
    """
    Return distinct filter values for the Attribution tab dropdowns:
      - portfolios: sorted list of portfolio_name values
      - scopes_by_portfolio: {portfolio_name: [scope, ...]}
      - periods_by_portfolio_scope: {portfolio_name: {scope: [period, ...]}}
      - dates_by_portfolio_scope_period: {portfolio_name: {scope: {period: [date, ...]}}}
    """
    df = _load_attribution_data()
    if df.empty:
        return {"status": "error", "error": "No attribution data available",
                "portfolios": [], "scopes_by_portfolio": {},
                "periods_by_portfolio_scope": {}, "dates_by_portfolio_scope_period": {}}

    portfolios = sorted(df["portfolio_name"].dropna().unique().tolist())

    scopes_by_portfolio: Dict[str, List[str]] = {}
    periods_by_portfolio_scope: Dict[str, Dict[str, List[str]]] = {}
    dates_by_portfolio_scope_period: Dict[str, Dict[str, Dict[str, List[str]]]] = {}

    for pname in portfolios:
        p_df = df[df["portfolio_name"] == pname]
        scopes = sorted(p_df["portfolio_scope"].dropna().unique().tolist())
        scopes_by_portfolio[pname] = scopes

        periods_by_portfolio_scope[pname] = {}
        dates_by_portfolio_scope_period[pname] = {}

        for scope in scopes:
            sp_df = p_df[p_df["portfolio_scope"] == scope]
            periods = sorted(sp_df["period_code"].dropna().unique().tolist())
            periods_by_portfolio_scope[pname][scope] = periods

            dates_by_portfolio_scope_period[pname][scope] = {}
            for period in periods:
                per_df = sp_df[sp_df["period_code"] == period]
                run_dates = per_df["RunDate"].dropna()
                date_strs = sorted(
                    run_dates.dt.strftime("%Y-%m-%d").unique().tolist(),
                    reverse=True,
                )
                dates_by_portfolio_scope_period[pname][scope][period] = date_strs

    return {
        "status": "ok",
        "portfolios": portfolios,
        "scopes_by_portfolio": scopes_by_portfolio,
        "periods_by_portfolio_scope": periods_by_portfolio_scope,
        "dates_by_portfolio_scope_period": dates_by_portfolio_scope_period,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Public API: table
# ──────────────────────────────────────────────────────────────────────────────

def get_attribution_table(
    portfolio_name: str,
    scope: str,
    period: str,
    run_date: Optional[str] = None,   # "YYYY-MM-DD"; if None → latest
) -> dict:
    """
    Return structured attribution rows for the selected portfolio/scope/period/date.

    Each row:
      id, parent_id, structure, level, level1, level2, level3,
      name, weightPortfolio…returnActive
    """
    df_full = _load_attribution_data()
    if df_full.empty:
        return {"status": "error", "error": "No attribution data", "rows": []}

    # ── Slice ──────────────────────────────────────────────────────────────
    mask = (
        (df_full["portfolio_name"].astype(str) == portfolio_name) &
        (df_full["portfolio_scope"].astype(str) == scope) &
        (df_full["period_code"].astype(str) == period)
    )
    df_sel = df_full[mask].copy()

    if df_sel.empty:
        return {"status": "ok", "rows": [], "message": "No data for selection"}

    # ── Filter to run date ─────────────────────────────────────────────────
    if run_date:
        date_mask = df_sel["RunDate"].dt.strftime("%Y-%m-%d") == run_date
        df_date = df_sel[date_mask].copy()
        if df_date.empty:
            # Fall back to latest date
            latest = df_sel["RunDate"].max()
            df_date = df_sel[df_sel["RunDate"] == latest].copy()
    else:
        latest = df_sel["RunDate"].max()
        df_date = df_sel[df_sel["RunDate"] == latest].copy()

    if df_date.empty:
        return {"status": "ok", "rows": [], "message": "No data for date"}

    # ── Classify structure ─────────────────────────────────────────────────
    def classify(row):
        return _classify_structure(
            row.get("Level1"), row.get("Level2"),
            row.get("Level3"), row.get("Level4"),
        )

    df_date["_structure"] = df_date.apply(classify, axis=1)

    # ── Sort ────────────────────────────────────────────────────────────────
    def sort_key(row):
        return _row_sort_key(
            row["_structure"],
            _safe_str(row.get("Level1")),
            _safe_str(row.get("Level2")),
            _safe_str(row.get("Level3")),
            _safe_str(row.get("Name")),
        )

    df_date["_sort_key"] = df_date.apply(sort_key, axis=1)
    df_date = df_date.sort_values("_sort_key").reset_index(drop=True)

    # ── Build row IDs ───────────────────────────────────────────────────────
    # Assign sequential IDs; maintain L2→L3→security parent chains
    id_map: Dict[int, str] = {}
    for i in df_date.index:
        id_map[i] = f"row-{i}"

    # Build parent map
    parent_map: Dict[int, Optional[int]] = {}
    for i, row in df_date.iterrows():
        st   = row["_structure"]
        l2   = _safe_str(row.get("Level2"))
        l3   = _safe_str(row.get("Level3"))

        if st in ("Overarching", "Main", "OnlySecurity", "Other"):
            parent_map[i] = None

        elif st == "Main|Sub":
            # Parent = Main row with same L2
            candidates = df_date[(df_date["_structure"] == "Main") & (df_date["Level2"].astype(str) == l2)].index
            parent_map[i] = candidates[0] if len(candidates) else None

        elif st == "Main|DirectSecurity":
            candidates = df_date[(df_date["_structure"] == "Main") & (df_date["Level2"].astype(str) == l2)].index
            parent_map[i] = candidates[0] if len(candidates) else None

        elif st == "Main|Sub|Security":
            candidates = df_date[
                (df_date["_structure"] == "Main|Sub") &
                (df_date["Level2"].astype(str) == l2) &
                (df_date["Level3"].astype(str) == l3)
            ].index
            parent_map[i] = candidates[0] if len(candidates) else None

        else:
            parent_map[i] = None

    # Depth/level for indentation
    _LEVEL_MAP = {
        "Overarching":           0,
        "Main":                  1,
        "OnlySecurity":          1,
        "Main|Sub":              2,
        "Main|DirectSecurity":   2,
        "Main|Sub|Security":     3,
        "Other":                 1,
    }

    # ── Build output rows ───────────────────────────────────────────────────
    rows: List[Dict[str, Any]] = []
    for i, row in df_date.iterrows():
        st  = row["_structure"]
        pid = parent_map.get(i)

        out: Dict[str, Any] = {
            "id":        id_map[i],
            "parent_id": id_map[pid] if pid is not None else None,
            "structure": st,
            "level":     _LEVEL_MAP.get(st, 1),
            "level1":    _safe_str(row.get("Level1")),
            "level2":    _safe_str(row.get("Level2")),
            "level3":    _safe_str(row.get("Level3")),
            "name":      _safe_str(row.get("Name")),
        }

        for col in _NUM_COLS:
            out[col] = _safe_float(row.get(col))

        rows.append(out)

    return {
        "status":     "ok",
        "rows":       rows,
        "run_date":   df_date.iloc[0]["RunDate"].strftime("%Y-%m-%d") if not df_date.empty else None,
        "portfolio":  portfolio_name,
        "scope":      scope,
        "period":     period,
        "row_count":  len(rows),
    }
