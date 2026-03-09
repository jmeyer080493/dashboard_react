"""
Portfolio Performance Tab Data Service

Provides data for the Portfolios → Performance subtab:
  - Performance table: MtD, LM, YtD, 1Y (+ optional custom) periods with
    portfolio return, benchmark return (Bloomberg composite), and relative
  - Performance chart: cumulative returns rebased to 100 from period start

Data sources:
  - KVG:       AMS_ExternalData.dbo.apoAsset_ShareTypes / apoAsset_ShareTypeTransactions
  - Bloomberg: ApoAsset_Quant.dbo.performance  (daily returns)
  - Benchmarks:ApoAsset_Quant.dbo.benchmark_mapping + performance (composite BConst/Bweight)
"""

import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
from typing import Optional, List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

from utils.database import DatabaseGateway
from config.settings import USE_SYNTHETIC_DATA

db = DatabaseGateway()

# ──────────────────────────────────────────────────────────────────────────────
# Fund / team mappings  (mirrors portfolio_service.py + performance_mappings.py)
# ──────────────────────────────────────────────────────────────────────────────

FUND_TEAM_MAPPING: Dict[str, List[str]] = {
    "MA":      ["Forte", "DuoPlus", "GEP", "Vivace", "Piano", "Mezzo"],
    "HC":      ["AMO", "ADH", "AMB", "MBH", "AFH", "AMC", "Stiftung"],
    "Spezial": ["PoolD", "Elbe", "Nordrhein", "RVAB", "AVW", "SAE"],
}

# Display name → list of DB names  (same as portfolio_service.FUND_NAME_MAPPING)
FUND_NAME_MAPPING: Dict[str, List[str]] = {
    "Forte":     ["apo Forte INKA V", "apo Forte INKA R", "apo Forte"],
    "DuoPlus":   ["DuoPlus V", "DuoPlus R"],
    "GEP":       ["Global ETFs Portfolio EUR", "Global ETFs Portfolio R", "Global ETFs Portfolio"],
    "Vivace":    ["apo Vivace INKA V", "apo Vivace INKA R", "apo Vivace Megatrends"],
    "Piano":     ["apo Piano INKA V", "apo Piano INKA R", "apo Piano"],
    "Mezzo":     ["apo Mezzo INKA V", "apo Mezzo INKA R", "apo Mezzo"],
    "AMO":       ["apo Medical Opportunities V", "apo Medical Opportunities R", "apo Medical Opportunities"],
    "ADH":       ["apo Digital Health Aktien Fonds I", "apo Digital Health Aktien Fonds R"],
    "AMB":       ["apo Medical Balance I", "apo Medical Balance R", "apo Medical Balance"],
    "MBH":       ["MEDICAL BioHealth I"],
    "AFH":       ["apo Future Health"],
    "AMC":       ["apo Medical Core"],
    "Stiftung":  ["apo Stiftung & Ertrag"],
    "PoolD":     ["APO POOL D INKA", "APO POOL D UNIVERSAL FONDS", "APO POOL D Fonds"],
    "Elbe":      ["ELBE INKA"],
    "Nordrhein": ["Nordrhein I INKA (Apo)", "LBBW AM-Nord IA"],
    "RVAB":      ["VAB INKA RVAB"],
    "AVW":       ["AVW-UNIVERSAL-FONDS"],
    "SAE":       ["SAEV Masterfonds APO Europäische Aktien"],
}

# Reverse: db_name → display_name
_DB_TO_DISPLAY: Dict[str, str] = {
    db_name: display
    for display, db_names in FUND_NAME_MAPPING.items()
    for db_name in db_names
}

# Bloomberg-to-display mapping (Portname in benchmark_mapping → display name)
BLOOMBERG_TO_DISPLAY: Dict[str, str] = {k: k for k in [
    "AFH", "AMC", "AMO", "AMB", "DuoPlus", "Elbe", "Forte", "GEP",
    "MBH", "Mezzo", "Nordrhein", "Piano", "PoolD", "RVAB", "SAE", "Vivace",
]}

# Flat list of all funds in display order
ALL_FUNDS: List[str] = sum(FUND_TEAM_MAPPING.values(), [])

# ──────────────────────────────────────────────────────────────────────────────
# Date range helpers
# ──────────────────────────────────────────────────────────────────────────────

def _get_date_range(period: str, as_of: Optional[date] = None) -> Tuple[date, date]:
    today = as_of or datetime.now().date()
    if period == "MtD":
        return today.replace(day=1), today
    elif period == "1M":
        return today - relativedelta(months=1), today
    elif period == "LM":
        first = today.replace(day=1)
        last_prev = first - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    elif period == "YtD":
        return today.replace(month=1, day=1), today
    elif period == "1Y":
        return today - relativedelta(years=1), today
    else:
        return today - relativedelta(months=1), today


# ──────────────────────────────────────────────────────────────────────────────
# Data loaders
# ──────────────────────────────────────────────────────────────────────────────

def _generate_synthetic_kvg_data() -> pd.DataFrame:
    """
    Generate synthetic KVG share-type NAV transaction data for testing/demo purposes.
    Returns a DataFrame with columns matching the SQL query from _load_kvg_data().
    """
    np.random.seed(42)
    
    # Fund names from FUND_NAME_MAPPING (share types)
    FUNDS = [
        "apo Forte INKA V", "apo Forte INKA R",
        "DuoPlus V", "DuoPlus R",
        "Global ETFs Portfolio EUR", "Global ETFs Portfolio R",
        "apo Vivace INKA V", "apo Vivace INKA R",
        "apo Piano INKA V", "apo Piano INKA R",
        "apo Mezzo INKA V", "apo Mezzo INKA R",
        "apo Medical Opportunities V", "apo Medical Opportunities R",
        "apo Digital Health Aktien Fonds I", "apo Digital Health Aktien Fonds R",
        "apo Medical Balance I", "apo Medical Balance R",
        "MEDICAL BioHealth I",
        "apo Future Health",
        "apo Medical Core",
    ]
    
    rows = []
    today = datetime.today().date()
    
    # Generate 2-3 years of NAV data for each fund
    for share_type_id, fund_name in enumerate(FUNDS, start=1):
        # Starting NAV and date
        start_date = today - relativedelta(years=2)
        nav = np.random.uniform(100, 200)  # Starting NAV between 100-200
        
        # Generate daily NAV values (business days only)
        current_date = start_date
        while current_date <= today:
            # Skip weekends
            if current_date.weekday() < 5:
                # Daily returns: 0.02% mean, 1% volatility
                daily_return = np.random.normal(0.0002, 0.01)
                nav = nav * (1 + daily_return)
                nav = max(nav, 50)  # Ensure NAV stays positive
                
                rows.append({
                    "ShareTypeId": share_type_id,
                    "Name": fund_name,
                    "ShareValue": round(nav, 4),
                    "TransactionDate": current_date,
                    "TransactionShareTypeId": share_type_id,
                })
            
            current_date += timedelta(days=1)
    
    df = pd.DataFrame(rows)
    logger.info("Generated %d synthetic KVG NAV records for %d funds", len(df), len(FUNDS))
    return df


def _load_kvg_data() -> pd.DataFrame:
    """Load KVG share-type NAV transactions from AMS_ExternalData."""
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic KVG data")
        return _generate_synthetic_kvg_data()
    
    engine = db.ams_external_engine
    if engine is None:
        logger.warning("AMS External engine not available")
        return pd.DataFrame()
    try:
        df = pd.read_sql_query(
            """
            SELECT st.ShareTypeId,
                   st.Name,
                   stt.ShareValue,
                   stt.TransactionDate,
                   stt.ShareTypeId AS TransactionShareTypeId
            FROM   [dbo].[apoAsset_ShareTypes] AS st
            LEFT JOIN [dbo].[apoAsset_ShareTypeTransactions] AS stt
                   ON st.ShareTypeId = stt.ShareTypeId
            WHERE  stt.ShareValue IS NOT NULL
            ORDER  BY st.ShareTypeId, stt.TransactionDate
            """,
            engine,
        )
        df["TransactionDate"] = pd.to_datetime(df["TransactionDate"]).dt.date
        return df
    except Exception as exc:
        logger.error("Failed to load KVG data: %s", exc)
        return pd.DataFrame()


def _load_bloomberg_performance() -> pd.DataFrame:
    """Load daily portfolio returns from ApoAsset_Quant.dbo.performance."""
    engine = db.duoplus_engine
    if engine is None:
        logger.warning("Quant engine not available")
        return pd.DataFrame()
    try:
        df = pd.read_sql_query(
            """
            SELECT ID, DATE, Returns, Currency
            FROM   [dbo].[performance]
            ORDER  BY ID, DATE
            """,
            engine,
        )
        df["DATE"] = pd.to_datetime(df["DATE"]).dt.date
        return df
    except Exception as exc:
        logger.error("Failed to load Bloomberg performance data: %s", exc)
        return pd.DataFrame()


def _load_benchmark_mapping() -> pd.DataFrame:
    """Load portfolio-benchmark mapping from ApoAsset_Quant."""
    engine = db.duoplus_engine
    if engine is None:
        return pd.DataFrame()
    try:
        return pd.read_sql_query(
            """
            SELECT Portfolio, Portname,
                   BConst_1, BConst_2, BConst_3, BConst_4, BConst_5,
                   Bweight_1, Bweight_2, Bweight_3, Bweight_4, Bweight_5,
                   Type
            FROM   [dbo].[benchmark_mapping]
            """,
            engine,
        )
    except Exception as exc:
        logger.error("Failed to load benchmark mapping: %s", exc)
        return pd.DataFrame()


# ──────────────────────────────────────────────────────────────────────────────
# Anteilsklasse (share-class) filtering
# ──────────────────────────────────────────────────────────────────────────────

def _get_db_names_for_anteilsklasse(
    display_name: str,
    anteilsklasse: Dict[str, bool],
) -> List[str]:
    """Return database names for a fund filtered by selected share class(es)."""
    names = FUND_NAME_MAPPING.get(display_name)
    if not names:
        return [display_name]
    if not isinstance(names, list):
        names = [names]

    selected: List[str] = []
    for n in names:
        is_v = n.endswith(" V") or " INKA V" in n
        is_r = n.endswith(" R") or " INKA R" in n
        if not is_v and not is_r:
            is_v = True  # default

        if is_v and anteilsklasse.get("V", True):
            selected.append(n)
        elif is_r and anteilsklasse.get("R", False):
            selected.append(n)

    return selected or [names[0]]


# ──────────────────────────────────────────────────────────────────────────────
# Benchmark mapping filtering (All / EQ / FI)
# ──────────────────────────────────────────────────────────────────────────────

def _filter_bm_by_type(
    bm_df: pd.DataFrame,
    portfolio_type: Dict[str, bool],
) -> pd.DataFrame:
    selected = [t for t in ("All", "EQ", "FI") if portfolio_type.get(t, False)]
    if not selected:
        selected = ["All"]
    return bm_df[bm_df["Type"].isin(selected)].copy()


def _suffix_portnames_for_multi_type(
    bm_df: pd.DataFrame,
    portfolio_type: Dict[str, bool],
) -> pd.DataFrame:
    """Add EQ/FI suffix to Portname when multiple types are selected."""
    n_selected = sum(portfolio_type.get(t, False) for t in ("All", "EQ", "FI"))
    if n_selected <= 1:
        return bm_df.copy()

    result = bm_df.copy()
    multi_type_ports = (
        result.groupby("Portname")["Type"]
        .apply(lambda s: len(set(s)) > 1)
    )
    multi_type_ports = multi_type_ports[multi_type_ports].index.tolist()

    for idx, row in result.iterrows():
        if row["Portname"] in multi_type_ports and row["Type"] != "All":
            result.at[idx, "Portname"] = f"{row['Portname']} {row['Type']}"
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Benchmark return calculation (Bloomberg composite)
# ──────────────────────────────────────────────────────────────────────────────

def _get_benchmark_composite_returns(
    portname: str,
    bm_df: pd.DataFrame,
    daily_ret_df: pd.DataFrame,
) -> Optional[pd.DataFrame]:
    """
    Build composite daily returns for a portfolio's benchmark using
    BConst_1..5 and Bweight_1..5 columns.
    Returns DataFrame with columns DATE, Returns (daily).
    """
    # Strip type suffix to find the right row (e.g. "Nord EQ" → look for Portname==Nord EQ)
    row_mask = bm_df["Portname"] == portname
    if not row_mask.any():
        return None
    row = bm_df[row_mask].iloc[0]

    components = []
    for i in range(1, 6):
        cid = row.get(f"BConst_{i}")
        wgt = row.get(f"Bweight_{i}")
        if pd.notna(cid) and pd.notna(wgt):
            components.append({"id": cid, "weight": float(wgt) / 100.0})

    if not components:
        return None

    all_ids = [c["id"] for c in components]
    filtered = daily_ret_df[daily_ret_df["ID"].isin(all_ids)].copy()
    if filtered.empty:
        return None

    min_d = filtered["DATE"].min()
    max_d = filtered["DATE"].max()
    biz_days = pd.bdate_range(start=min_d, end=max_d)
    merged = pd.DataFrame({"DATE": [d.date() for d in biz_days]})

    for comp in components:
        comp_df = filtered[filtered["ID"] == comp["id"]][["DATE", "Returns"]] \
            .rename(columns={"Returns": comp["id"]})
        merged = merged.merge(comp_df, on="DATE", how="left")

    # Forward-fill gaps
    for comp in components:
        if comp["id"] in merged.columns:
            merged[comp["id"]] = merged[comp["id"]].ffill()

    merged["Returns"] = sum(
        merged[c["id"]].fillna(0) * c["weight"]
        for c in components
        if c["id"] in merged.columns
    )
    return merged[["DATE", "Returns"]]


def _calc_benchmark_period_return(
    portname: str,
    start: date,
    end: date,
    bm_df: pd.DataFrame,
    daily_ret_df: pd.DataFrame,
) -> Optional[float]:
    comp = _get_benchmark_composite_returns(portname, bm_df, daily_ret_df)
    if comp is None:
        return None
    period = comp[(comp["DATE"] >= start) & (comp["DATE"] <= end)].sort_values("DATE")
    if period.empty:
        return None
    cum = float((1 + period["Returns"].fillna(0)).prod() - 1) * 100
    return round(cum, 2)


# ──────────────────────────────────────────────────────────────────────────────
# Portfolio return calculations
# ──────────────────────────────────────────────────────────────────────────────

def _calc_kvg_period_return(
    fund_df: pd.DataFrame,
    start: date,
    end: date,
) -> Optional[float]:
    """Calculate return from KVG share values over a period."""
    period = fund_df[
        (fund_df["TransactionDate"] >= start) & (fund_df["TransactionDate"] <= end)
    ].sort_values("TransactionDate")
    if len(period) < 2:
        return None
    s = period.iloc[0]["ShareValue"]
    e = period.iloc[-1]["ShareValue"]
    if s > 0:
        return round(((e / s) - 1) * 100, 2)
    return None


def _calc_bloomberg_period_return(
    portfolio_index_id: str,
    start: date,
    end: date,
    daily_ret_df: pd.DataFrame,
) -> Optional[float]:
    """Calculate return from Bloomberg daily returns over a period."""
    port_data = daily_ret_df[daily_ret_df["ID"] == portfolio_index_id]
    period = port_data[
        (port_data["DATE"] >= start) & (port_data["DATE"] <= end)
    ].sort_values("DATE")
    if period.empty:
        return None
    cum = float((1 + period["Returns"].fillna(0)).prod() - 1) * 100
    return round(cum, 2)


# ──────────────────────────────────────────────────────────────────────────────
# Public: performance table
# ──────────────────────────────────────────────────────────────────────────────

def get_performance_meta() -> dict:
    """Return fund list and team structure for the frontend dropdowns."""
    fund_options = []
    for team, funds in FUND_TEAM_MAPPING.items():
        for f in funds:
            fund_options.append({"label": f, "value": f, "team": team})
    return {"status": "ok", "funds": fund_options, "teams": FUND_TEAM_MAPPING}


def get_performance_table(
    portfolios: List[str],           # display names selected by user
    source: str = "kvg",             # "kvg" or "bloomberg"
    anteilsklasse: Optional[Dict[str, bool]] = None,   # {"V": True, "R": False}
    portfolio_type: Optional[Dict[str, bool]] = None,  # {"All": True, "EQ": False, "FI": False}
    as_of_date: Optional[str] = None,
    custom_start: Optional[str] = None,
    custom_end: Optional[str] = None,
) -> dict:
    """
    Return performance table rows for selected portfolios.
    Columns: Portfolio, MtD, MtD Bench, MtD Rel, LM, LM Bench, LM Rel,
             YtD, YtD Bench, YtD Rel, 1Y, 1Y Bench, 1Y Rel,
             [Custom, Custom Bench, Custom Rel if dates provided]
    Benchmarks are always Bloomberg composite (from benchmark_mapping).
    """
    if anteilsklasse is None:
        anteilsklasse = {"V": True, "R": False}
    if portfolio_type is None:
        portfolio_type = {"All": True, "EQ": False, "FI": False}
    if not portfolios:
        return {"status": "ok", "rows": [], "has_custom": False}

    try:
        as_of = datetime.strptime(as_of_date, "%Y-%m-%d").date() if as_of_date else datetime.now().date()
    except Exception:
        as_of = datetime.now().date()

    PERIODS = {
        "MtD": _get_date_range("MtD", as_of),
        "LM":  _get_date_range("LM",  as_of),
        "YtD": _get_date_range("YtD", as_of),
        "1Y":  _get_date_range("1Y",  as_of),
    }

    # ── Load data ────────────────────────────────────────────────────
    kvg_df      = _load_kvg_data()
    bb_daily    = _load_bloomberg_performance()
    bm_raw      = _load_benchmark_mapping()

    if bm_raw.empty:
        return {"status": "error", "error": "Benchmark mapping not available", "rows": []}

    # Apply type filter + optional suffix
    bm_filtered = _filter_bm_by_type(bm_raw, portfolio_type)
    bm_filtered = _suffix_portnames_for_multi_type(bm_filtered, portfolio_type)

    rows: List[Dict] = []

    for display_name in portfolios:
        # ─── Determine DB names respecting anteilsklasse ───────────
        db_names = _get_db_names_for_anteilsklasse(display_name, anteilsklasse)

        # ─── Find all portname variants in bm_filtered ─────────────
        # (e.g. "Forte", or "Nord" + "Nord EQ" + "Nord FI")
        portname_rows = bm_filtered[bm_filtered["Portname"].str.startswith(display_name, na=False)]
        if portname_rows.empty:
            # Fallback: try the plain display name
            portname_variants = [display_name]
        else:
            portname_variants = portname_rows["Portname"].unique().tolist()

        for portname in portname_variants:
            row: Dict[str, Any] = {"Portfolio": portname}

            # ── For each standard period ──────────────────────────
            for period_name, (p_start, p_end) in PERIODS.items():
                port_ret = None
                bench_ret = None

                if source == "bloomberg" and not bb_daily.empty:
                    # Get portfolio index from bm_filtered for this portname variant
                    bm_row_mask = bm_filtered["Portname"] == portname
                    if bm_row_mask.any():
                        port_index = bm_filtered[bm_row_mask].iloc[0]["Portfolio"]
                        if pd.notna(port_index):
                            port_ret = _calc_bloomberg_period_return(
                                port_index, p_start, p_end, bb_daily
                            )

                if port_ret is None and not kvg_df.empty:
                    # Fall back or primary KVG: aggregate across selected share classes
                    for db_name in db_names:
                        fund_df = kvg_df[kvg_df["Name"] == db_name]
                        r = _calc_kvg_period_return(fund_df, p_start, p_end)
                        if r is not None:
                            port_ret = r
                            break  # Use first matching share class

                # Benchmark: always Bloomberg composite
                if not bb_daily.empty and not bm_filtered.empty:
                    bench_ret = _calc_benchmark_period_return(
                        portname, p_start, p_end, bm_filtered, bb_daily
                    )

                rel = None
                if port_ret is not None and bench_ret is not None:
                    rel = round(port_ret - bench_ret, 2)

                row[f"{period_name} (%)"]       = port_ret
                row[f"{period_name} Bench (%)"] = bench_ret
                row[f"{period_name} Rel (%)"]   = rel

            # ── Custom period ────────────────────────────────────
            row["Custom (%)"]       = None
            row["Custom Bench (%)"] = None
            row["Custom Rel (%)"]   = None

            if custom_start and custom_end:
                try:
                    c_start = datetime.strptime(custom_start, "%Y-%m-%d").date()
                    c_end   = datetime.strptime(custom_end,   "%Y-%m-%d").date()

                    c_port_ret = None
                    if source == "bloomberg" and not bb_daily.empty:
                        bm_row_mask = bm_filtered["Portname"] == portname
                        if bm_row_mask.any():
                            port_index = bm_filtered[bm_row_mask].iloc[0]["Portfolio"]
                            if pd.notna(port_index):
                                c_port_ret = _calc_bloomberg_period_return(
                                    port_index, c_start, c_end, bb_daily
                                )
                    if c_port_ret is None and not kvg_df.empty:
                        for db_name in db_names:
                            fund_df = kvg_df[kvg_df["Name"] == db_name]
                            r = _calc_kvg_period_return(fund_df, c_start, c_end)
                            if r is not None:
                                c_port_ret = r
                                break

                    c_bench_ret = None
                    if not bb_daily.empty and not bm_filtered.empty:
                        c_bench_ret = _calc_benchmark_period_return(
                            portname, c_start, c_end, bm_filtered, bb_daily
                        )

                    c_rel = None
                    if c_port_ret is not None and c_bench_ret is not None:
                        c_rel = round(c_port_ret - c_bench_ret, 2)

                    row["Custom (%)"]       = c_port_ret
                    row["Custom Bench (%)"] = c_bench_ret
                    row["Custom Rel (%)"]   = c_rel
                except Exception as exc:
                    logger.warning("Custom period error: %s", exc)

            rows.append(row)

    has_custom = bool(custom_start and custom_end)
    return {"status": "ok", "rows": rows, "has_custom": has_custom,
            "custom_start": custom_start, "custom_end": custom_end}


# ──────────────────────────────────────────────────────────────────────────────
# Public: performance chart
# ──────────────────────────────────────────────────────────────────────────────

def get_performance_chart(
    portfolios: List[str],
    source: str = "bloomberg",
    portfolio_type: Optional[Dict[str, bool]] = None,
    anteilsklasse: Optional[Dict[str, bool]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    show_benchmarks: bool = False,
) -> dict:
    """
    Return cumulative-return time series (rebased to 0% at start) for the chart.
    Each series: {name, type ("portfolio"|"benchmark"), dates: [...], values: [...]}
    """
    if portfolio_type is None:
        portfolio_type = {"All": True, "EQ": False, "FI": False}
    if anteilsklasse is None:
        anteilsklasse = {"V": True, "R": False}
    if not portfolios:
        return {"status": "ok", "series": []}

    # ── Parse dates ────────────────────────────────────────────────
    today = datetime.now().date()
    try:
        p_start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else today - relativedelta(months=1)
        p_end   = datetime.strptime(end_date,   "%Y-%m-%d").date() if end_date   else today
    except Exception:
        p_start, p_end = today - relativedelta(months=1), today

    # ── Load data ────────────────────────────────────────────────
    kvg_df   = _load_kvg_data()
    bb_daily = _load_bloomberg_performance()
    bm_raw   = _load_benchmark_mapping()

    bm_filtered = _filter_bm_by_type(bm_raw, portfolio_type) if not bm_raw.empty else pd.DataFrame()
    bm_filtered = _suffix_portnames_for_multi_type(bm_filtered, portfolio_type) if not bm_filtered.empty else bm_filtered

    series: List[Dict] = []

    for display_name in portfolios:
        portname_rows = bm_filtered[bm_filtered["Portname"].str.startswith(display_name, na=False)] \
            if not bm_filtered.empty else pd.DataFrame()

        portname_variants = portname_rows["Portname"].unique().tolist() \
            if not portname_rows.empty else [display_name]

        for portname in portname_variants:
            port_series: Optional[pd.DataFrame] = None

            # Bloomberg source: use portfolio index from benchmark_mapping
            if source == "bloomberg" and not bb_daily.empty and not bm_filtered.empty:
                bm_row_mask = bm_filtered["Portname"] == portname
                if bm_row_mask.any():
                    port_index = bm_filtered[bm_row_mask].iloc[0]["Portfolio"]
                    if pd.notna(port_index):
                        ps = bb_daily[bb_daily["ID"] == port_index].copy()
                        ps = ps[(ps["DATE"] >= p_start) & (ps["DATE"] <= p_end)] \
                            .sort_values("DATE")
                        if not ps.empty:
                            ps["CumRet"] = ((1 + ps["Returns"].fillna(0)).cumprod() - 1) * 100
                            port_series = ps[["DATE", "CumRet"]].rename(
                                columns={"DATE": "date", "CumRet": "value"}
                            )

            # KVG fallback / primary
            if port_series is None and not kvg_df.empty:
                db_names = _get_db_names_for_anteilsklasse(display_name, anteilsklasse)
                for db_name in db_names:
                    fund_df = kvg_df[kvg_df["Name"] == db_name].copy()
                    period_df = fund_df[
                        (fund_df["TransactionDate"] >= p_start) &
                        (fund_df["TransactionDate"] <= p_end)
                    ].sort_values("TransactionDate")
                    if len(period_df) >= 2:
                        base = period_df.iloc[0]["ShareValue"]
                        if base > 0:
                            period_df["value"] = ((period_df["ShareValue"] / base) - 1) * 100
                            port_series = period_df[["TransactionDate", "value"]].rename(
                                columns={"TransactionDate": "date"}
                            )
                            break

            if port_series is not None and not port_series.empty:
                series.append({
                    "name":         portname,
                    "type":         "portfolio",
                    "displayName":  display_name,
                    "dates":   [str(d) for d in port_series["date"].tolist()],
                    "values":  [round(float(v), 4) if not pd.isna(v) else None
                                for v in port_series["value"].tolist()],
                })

            # Benchmark series
            if show_benchmarks and not bb_daily.empty and not bm_filtered.empty:
                comp = _get_benchmark_composite_returns(portname, bm_filtered, bb_daily)
                if comp is not None:
                    comp_period = comp[
                        (comp["DATE"] >= p_start) & (comp["DATE"] <= p_end)
                    ].sort_values("DATE")
                    if not comp_period.empty:
                        comp_period = comp_period.copy()
                        comp_period["value"] = (
                            (1 + comp_period["Returns"].fillna(0)).cumprod() - 1
                        ) * 100
                        series.append({
                            "name":        f"{portname} Benchmark",
                            "type":        "benchmark",
                            "displayName": display_name,
                            "dates":  [str(d) for d in comp_period["DATE"].tolist()],
                            "values": [round(float(v), 4) if not pd.isna(v) else None
                                       for v in comp_period["value"].tolist()],
                        })

    return {
        "status": "ok",
        "series": series,
        "start_date": str(p_start),
        "end_date": str(p_end),
    }
