"""
DuoPlus Service

Loads and ranks equity data from ApoAsset_Quant.[dbo].[duoplus_data].
Provides ranked DataFrames (US, EU, Custom universes) and data-quality stats
for the four DuoPlus sub-tabs: US · Europe · Custom · Data Management.

Ranking logic faithfully ported from the original Dash project
(dashboard/duoplus/duoplus_ranking.py and dashboard/data/get_data.py).
"""

from __future__ import annotations

import logging
import traceback
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Column rename map  (Bloomberg DB → readable names)
# Source: dashboard/duoplus/mapping.py
# ─────────────────────────────────────────────────────────────────────────────
COLUMN_RENAME_MAP: dict[str, str] = {
    "ID":                               "ID",
    "PX_LAST":                          "Price",
    "px_to_book_ratio":                 "P2B",
    "TOT_DEBT_TO_TOT_EQY":              "D2E",
    "IS_DIL_EPS_CONT_OPS":              "EPS",
    "RETURN_COM_EQY":                   "RoE",
    "PX_TO_SALES_RATIO":                "P2S",
    "BOOK_VAL_PER_SH":                  "BVPS",
    "SHORT_AND_LONG_TERM_DEBT":         "ST&LT Debt",
    "NET_INCOME":                       "Net Income",
    "TOT_COMMON_EQY":                   "Common Equity",
    "PE_RATIO":                         "PE",
    "TOTAL_EQUITY":                     "Total Equity",
    "AVG_MKT_CAP_3M":                   "Mcap 3M",
    "Sales_Growth_YoY":                 "SG YoY",
    "Sales_Growth_QoQ":                 "SG QoQ",
    "EPS_STD_YOY":                      "EPS StD",
    "EPS_GROWTH_LAST_YOY":              "EG YoY",
    "EPS_GROWTH_LAST_QOQ":              "EG QoQ",
    "EBK_UNGC_OECD_VIOLATIONS":         "UNGC",
    "EBK_CONTRVERSL_WEAPONS_INVOLVMNT": "Weapons",
    "MOMENTUM_AVG_3M_6M":               "Momentum",
}

# Ranking direction: True = ascending (lower is better), False = descending (higher is better)
RANK_CONFIG: dict[str, bool] = {
    "Mcap 3M":  False,
    "Momentum": False,
    "P2B":      True,
    "PE":       True,
    "P2S":      True,
    "SG YoY":   False,
    "EG YoY":   False,
    "SG QoQ":   False,
    "EG QoQ":   False,
    "RoE":      False,
    "EPS StD":  True,
    "D2E":      True,
}

UNIVERSE_MAP = {
    "us": "B500T Index",
    "eu": "EURP600 Index",
}

# ─────────────────────────────────────────────────────────────────────────────
# Rank calculations
# ─────────────────────────────────────────────────────────────────────────────

def _calculate_individual_ranks(df: pd.DataFrame) -> pd.DataFrame:
    """Add {col}_Rank columns for every metric in RANK_CONFIG that exists in df."""
    for col, ascending in RANK_CONFIG.items():
        if col not in df.columns:
            continue
        df[f"{col}_Rank"] = (
            df[col]
            .rank(method="average", ascending=ascending, na_option="keep")
            .fillna(201)
            .round()
            .astype("Int64")
        )
    return df


def _calculate_factor_ranks(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute composite Value / Growth / Quality factor ranks + Final_Rank.
    Only stocks with *complete* data for all factor metrics receive a real rank;
    the rest are assigned 201 (unranked).
    """
    factor_cfg = {
        "Value":   {
            "metrics":    ["P2B", "PE", "P2S"],
            "rank_cols":  ["P2B_Rank", "PE_Rank", "P2S_Rank"],
        },
        "Growth":  {
            "metrics":    ["SG YoY", "EG YoY"],
            "rank_cols":  ["SG YoY_Rank", "EG YoY_Rank"],
        },
        "Quality": {
            "metrics":    ["RoE", "EPS StD", "D2E"],
            "rank_cols":  ["RoE_Rank", "EPS StD_Rank", "D2E_Rank"],
        },
    }

    for factor, cfg in factor_cfg.items():
        norm_col  = f"{factor}_Rank_Norm"
        dummy_col = f"{factor}_Top200"
        final_col = f"{factor}_Final_Rank"

        # Initialise to 201 (unranked)
        df[norm_col] = pd.array([201] * len(df), dtype="Int64")

        avail_metrics    = [c for c in cfg["metrics"]    if c in df.columns]
        avail_rank_cols  = [c for c in cfg["rank_cols"]  if c in df.columns]

        if avail_rank_cols:
            has_complete = ~df[avail_metrics].isna().any(axis=1)
            if has_complete.any():
                df_sub = df[has_complete].copy()
                df_sub["_sum"] = df_sub[avail_rank_cols].sum(axis=1, skipna=False)
                df_sub["_sum"] = df_sub["_sum"].replace([np.inf, -np.inf], 201)
                ranks = df_sub["_sum"].rank(method="average", na_option="keep").fillna(201)
                df.loc[has_complete, norm_col] = pd.array(
                    ranks.round().astype("int64"), dtype="Int64"
                )

        # Assign dummy=1 to top-200 names
        top200_mask = (df[norm_col].rank(method="first") <= 200) & (df[norm_col] != 201)
        df[dummy_col] = 0
        df.loc[top200_mask, dummy_col] = 1

        # Within top-200 sort by Mcap 3M descending → Final_Rank
        df[final_col] = pd.array([201] * len(df), dtype="Int64")
        top200_df = df[top200_mask].copy()
        if not top200_df.empty and "Mcap 3M" in top200_df.columns:
            top200_df = top200_df.sort_values("Mcap 3M", ascending=False)
            df.loc[top200_df.index, final_col] = pd.array(
                range(1, len(top200_df) + 1), dtype="Int64"
            )

    return df


def _add_momentum_category(df: pd.DataFrame) -> pd.DataFrame:
    """Categorise Momentum as MU (≥p75) / MN (p25–p75) / MD (<p25)."""
    if "Momentum" not in df.columns:
        return df
    vals = df["Momentum"].dropna()
    p75 = vals.quantile(0.75) if len(vals) > 0 else 0.0
    p25 = vals.quantile(0.25) if len(vals) > 0 else 0.0

    def _cat(v):
        if pd.isna(v):
            return "—"
        return "MU" if v >= p75 else ("MN" if v >= p25 else "MD")

    df["Momentum_Cat"] = df["Momentum"].apply(_cat)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Core loading function
# ─────────────────────────────────────────────────────────────────────────────

def _get_engine():
    from utils.database import DatabaseGateway
    return DatabaseGateway().duoplus_engine


def load_and_rank(universe_name: str) -> pd.DataFrame:
    """
    Query [ApoAsset_Quant].[dbo].[duoplus_data] for a given universe,
    rename columns, calculate all ranks, and return a ready-to-display DataFrame.
    """
    engine = _get_engine()
    if engine is None:
        logger.error("DuoPlus engine not available")
        return pd.DataFrame()

    try:
        query = """
            SELECT *
            FROM [ApoAsset_Quant].[dbo].[duoplus_data]
            WHERE Universe = ?
              AND DatePoint = (
                SELECT MAX(DatePoint)
                FROM [ApoAsset_Quant].[dbo].[duoplus_data]
                WHERE Universe = ?
              )
            ORDER BY ID
        """
        df = pd.read_sql_query(query, engine, params=(universe_name, universe_name))

        if df.empty:
            logger.warning("No DuoPlus data found for universe: %s", universe_name)
            return pd.DataFrame()

        df = df.drop(columns=["Universe", "DatePoint"], errors="ignore")
        df = df.rename(columns=COLUMN_RENAME_MAP)
        df = _calculate_individual_ranks(df)
        df = _calculate_factor_ranks(df)
        df = _add_momentum_category(df)
        return df

    except Exception:
        logger.error("Failed to load DuoPlus data for '%s':\n%s", universe_name, traceback.format_exc())
        return pd.DataFrame()


def get_region_data(region: str) -> pd.DataFrame:
    """Return fully ranked data for 'us' or 'eu'."""
    universe = UNIVERSE_MAP.get(region.lower())
    if not universe:
        raise ValueError(f"Unknown region: {region!r}")
    return load_and_rank(universe)


def get_custom_data(universe: str) -> pd.DataFrame:
    """Return fully ranked data for an arbitrary universe name."""
    return load_and_rank(universe)


def get_distinct_universes() -> list[str]:
    """Return sorted list of distinct Universe values from the latest DatePoint."""
    engine = _get_engine()
    if engine is None:
        return []
    try:
        query = """
            SELECT DISTINCT Universe
            FROM [ApoAsset_Quant].[dbo].[duoplus_data]
            WHERE DatePoint = (SELECT MAX(DatePoint) FROM [ApoAsset_Quant].[dbo].[duoplus_data])
            ORDER BY Universe
        """
        df = pd.read_sql_query(query, engine)
        return sorted(df["Universe"].dropna().tolist())
    except Exception:
        logger.error("Failed to fetch universes:\n%s", traceback.format_exc())
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Data serialisation helpers
# ─────────────────────────────────────────────────────────────────────────────

RANK_COLUMN_MAP = {
    "P2B":    "P2B_Rank",
    "PE":     "PE_Rank",
    "P2S":    "P2S_Rank",
    "SG YoY": "SG YoY_Rank",
    "EG YoY": "EG YoY_Rank",
    "SG QoQ": "SG QoQ_Rank",
    "EG QoQ": "EG QoQ_Rank",
    "RoE":    "RoE_Rank",
    "EPS StD":"EPS StD_Rank",
    "D2E":    "D2E_Rank",
}


def _safe_val(v):
    """Convert pandas / numpy scalars to JSON-safe Python types."""
    if v is None:
        return None
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if np.isnan(v) or np.isinf(v) else float(v)
    if pd.isna(v):
        return None
    return v


def _df_to_table(df: pd.DataFrame, columns: list[str]) -> dict:
    """Serialise a subset of df columns into {columns, rows} format."""
    avail = [c for c in columns if c in df.columns]
    rows = [
        {c: _safe_val(row[c]) for c in avail}
        for _, row in df[avail].iterrows()
    ]
    return {"columns": avail, "rows": rows}


def build_factor_table(
    df: pd.DataFrame,
    factor_name: str,
    metric_cols: list[str],
    rank_norm_limit: Optional[int] = None,
    max_rows: int = 30,
) -> dict:
    """
    Build a factor ranking table dict.  Shows rank columns (not raw values).
    Sorted by Rank_Norm ascending; optionally filtered by rank_norm_limit.
    """
    norm_col  = f"{factor_name}_Rank_Norm"
    final_col = f"{factor_name}_Final_Rank"

    df_view = df.copy()

    if rank_norm_limit is not None and norm_col in df_view.columns:
        df_view = df_view[
            (df_view[norm_col] <= rank_norm_limit) & df_view[norm_col].notna()
        ]

    if norm_col in df_view.columns:
        df_view = df_view.sort_values(norm_col, ascending=True)

    display_cols = ["ID"]
    for m in metric_cols:
        rc = RANK_COLUMN_MAP.get(m)
        if rc and rc in df_view.columns:
            display_cols.append(rc)
    if norm_col in df_view.columns:
        display_cols.append(norm_col)
    if final_col in df_view.columns:
        display_cols.append(final_col)

    return _df_to_table(df_view.head(max_rows), display_cols)


def build_summary_table(df: pd.DataFrame) -> dict:
    """
    Build the combined Summary Metrics table.
    Sorted by Mcap 3M descending; includes Mcap Rank as first rank column.
    """
    combined = df.copy()

    # Convert Mcap to billions
    if "Mcap 3M" in combined.columns:
        combined["Mcap 3M"] = combined["Mcap 3M"].apply(
            lambda v: v / 1_000_000_000 if isinstance(v, (int, float)) and not np.isnan(v) else v
        )
        combined = combined.sort_values("Mcap 3M", ascending=False, na_position="last")
        mcap_rank = combined["Mcap 3M"].rank(method="dense", ascending=False, na_option="bottom")
        combined["Mcap Rank"] = mcap_rank.fillna(0).astype(int).astype(str).replace("0", "—")

    # Boolean columns
    for col in ("UNGC", "Weapons"):
        if col in combined.columns:
            combined[col] = combined[col].apply(
                lambda x: "True" if x == 1 else ("False" if x == 0 else "—")
            )

    columns = [
        "ID", "Mcap Rank", "Mcap 3M", "Momentum_Cat", "Momentum", "UNGC", "Weapons",
        "P2B", "PE", "P2S", "SG YoY", "EG YoY", "SG QoQ", "EG QoQ", "RoE", "EPS StD", "D2E",
    ]
    return _df_to_table(combined, columns)


# ─────────────────────────────────────────────────────────────────────────────
# Data Management / quality stats
# ─────────────────────────────────────────────────────────────────────────────

def _get_data_date(universe_name: str) -> str | None:
    """Return the latest DatePoint for a universe as a string, or None."""
    engine = _get_engine()
    if engine is None:
        return None
    try:
        q = """
            SELECT MAX(DatePoint) as latest
            FROM [ApoAsset_Quant].[dbo].[duoplus_data]
            WHERE Universe = ?
        """
        result = pd.read_sql_query(q, engine, params=(universe_name,))
        val = result["latest"].iloc[0] if not result.empty else None
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return None
        return str(val)[:10]  # YYYY-MM-DD
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Overview: unique top-5 selection algorithm (ported from get_data.py)
# ─────────────────────────────────────────────────────────────────────────────

def _short_ticker(id_str: str) -> str:
    """Extract bare ticker from full ID string, e.g. 'JPM US Equity' → 'JPM'."""
    return str(id_str).split()[0] if id_str else ""


def get_unique_top5_stocks(
    df: pd.DataFrame,
    factor_order: str = "VGQ",
    draft_mode: bool = False,
    exclude_momentum_down: bool = False,
    highest_rank: bool = False,
) -> dict[str, list[str]]:
    """
    Select unique top-5 tickers across Value / Growth / Quality.
    Returns dict {factor: [short_tickers]}.
    Faithfully ported from dashboard/data/get_data.py `get_unique_top5_stocks`.
    """
    result: dict[str, list[str]] = {"Value": [], "Growth": [], "Quality": []}
    if df.empty:
        return result

    work = df.copy()
    if exclude_momentum_down and "Momentum_Cat" in work.columns:
        work = work[work["Momentum_Cat"] != "MD"].copy()

    if highest_rank:
        if "Mcap 3M_Rank" not in work.columns:
            return result
        candidates = (
            work[work["Mcap 3M_Rank"].notna() & (work["Mcap 3M_Rank"] <= 30)]
            .sort_values("Mcap 3M_Rank")
        )
        assignments: dict[str, list[str]] = {"Value": [], "Growth": [], "Quality": []}
        selected: set = set()
        for _, row in candidates.iterrows():
            if all(len(assignments[f]) >= 5 for f in assignments):
                break
            stock_id = row["ID"]
            options: dict[str, float] = {}
            for factor in ["Value", "Growth", "Quality"]:
                if len(assignments[factor]) >= 5:
                    continue
                final_rank = row.get(f"{factor}_Final_Rank")
                if pd.isna(final_rank) or int(final_rank) > 200:
                    continue
                norm_rank = row.get(f"{factor}_Rank_Norm", float("inf"))
                options[factor] = float(norm_rank) if not pd.isna(norm_rank) else float("inf")
            if options:
                best = min(options, key=lambda f: options[f])
                assignments[best].append(_short_ticker(stock_id))
                selected.add(stock_id)
        # gap fill
        for factor in ["Value", "Growth", "Quality"]:
            gap = 5 - len(assignments[factor])
            if gap > 0:
                rank_col = f"{factor}_Final_Rank"
                if rank_col not in work.columns:
                    continue
                remaining = work[
                    work[rank_col].notna()
                    & (work[rank_col] <= 200)
                    & ~work["ID"].isin(selected)
                ].sort_values(rank_col)
                for _, row in remaining.head(gap).iterrows():
                    assignments[factor].append(_short_ticker(row["ID"]))
                    selected.add(row["ID"])
        return assignments

    else:
        factor_char_map = {"V": "Value", "G": "Growth", "Q": "Quality"}
        try:
            factors = [factor_char_map[c] for c in factor_order.upper() if c in factor_char_map]
        except Exception:
            factors = ["Value", "Growth", "Quality"]
        if not factors:
            factors = ["Value", "Growth", "Quality"]

        selected2: set = set()
        per_factor: dict[str, list[str]] = {"Value": [], "Growth": [], "Quality": []}

        if draft_mode:
            for _ in range(5):
                for factor in factors:
                    rank_col = f"{factor}_Final_Rank"
                    if rank_col not in work.columns:
                        continue
                    avail = work[
                        work[rank_col].notna()
                        & (work[rank_col] <= 200)
                        & ~work["ID"].isin(selected2)
                    ].sort_values(rank_col)
                    if not avail.empty:
                        best = avail.iloc[0]
                        selected2.add(best["ID"])
                        per_factor[factor].append(_short_ticker(best["ID"]))
        else:
            for factor in factors:
                rank_col = f"{factor}_Final_Rank"
                if rank_col not in work.columns:
                    continue
                avail = work[
                    work[rank_col].notna()
                    & (work[rank_col] <= 200)
                    & ~work["ID"].isin(selected2)
                ].sort_values(rank_col).head(5)
                for _, row in avail.iterrows():
                    selected2.add(row["ID"])
                    per_factor[factor].append(_short_ticker(row["ID"]))
        return per_factor


# ─────────────────────────────────────────────────────────────────────────────
# Overview: historical trades from Duoplus_Trades table
# ─────────────────────────────────────────────────────────────────────────────

def _load_historical_trades_raw(region: str) -> dict[str, dict[str, list[str]]]:
    """
    Load T-1 and T-2 data from [ApoAsset_Quant].[dbo].[Duoplus_Trades].
    Returns {"T-1": {factor: [tickers]}, "T-2": {factor: [tickers]}}.
    """
    engine = _get_engine()
    empty: dict = {
        "T-1": {"Value": [], "Growth": [], "Quality": []},
        "T-2": {"Value": [], "Growth": [], "Quality": []},
    }
    if engine is None:
        return empty

    sql_region = "USA" if region.lower() == "us" else "Europa"
    try:
        periods_df = pd.read_sql_query(
            "SELECT TOP 2 Periode FROM (SELECT DISTINCT Periode FROM [ApoAsset_Quant].[dbo].[Duoplus_Trades] WHERE Region = ?) AS p ORDER BY Periode DESC",
            engine,
            params=(sql_region,),
        )
        if len(periods_df) < 2:
            return empty

        p_t1 = int(periods_df.iloc[0]["Periode"])
        p_t2 = int(periods_df.iloc[1]["Periode"])
        result: dict = {}
        for periode, label in [(p_t1, "T-1"), (p_t2, "T-2")]:
            df = pd.read_sql_query(
                "SELECT DISTINCT Titel, Faktor FROM [ApoAsset_Quant].[dbo].[Duoplus_Trades] WHERE Periode = ? AND Region = ? AND Decision IN ('Hold', 'Buy') ORDER BY Faktor, Titel",
                engine,
                params=(periode, sql_region),
            )
            factor_data: dict[str, list[str]] = {}
            for factor in ["Value", "Growth", "Quality"]:
                tickers = df[df["Faktor"] == factor]["Titel"].str.split().str[0].tolist()[:5]
                factor_data[factor] = tickers
            result[label] = factor_data
        return result
    except Exception:
        logger.error("Failed to load historical trades for %s:\n%s", region, traceback.format_exc())
        return empty


# ─────────────────────────────────────────────────────────────────────────────
# Overview: summary table row builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_overview_summary(
    ranked_dfs: dict[str, pd.DataFrame],
    historical: dict[str, dict],
    t0_data: dict[str, dict[str, list[str]]],
) -> list[dict]:
    """
    Build base summary table rows for the Overview tab from T0 + T-1 historical.
    Decision logic is ported faithfully from dashboard/duoplus/duoplus_ranking.py.
    """
    all_rows: list[dict] = []

    for region in ["us", "eu"]:
        df = ranked_dfs.get(region, pd.DataFrame())
        if df.empty:
            continue

        t0   = t0_data.get(region, {})
        t1   = historical.get(region, {}).get("T-1", {})
        t2   = historical.get(region, {}).get("T-2", {})

        t0_factor: dict[str, str] = {}
        for f, tickers in t0.items():
            for tk in tickers:
                t0_factor[tk] = f

        t1_factor: dict[str, str] = {}
        t1_tickers: set[str] = set()
        for f, tickers in t1.items():
            for tk in tickers:
                t1_factor[tk] = f
                t1_tickers.add(tk)

        t2_tickers: set[str] = set()
        for tickers in t2.values():
            t2_tickers.update(tickers)

        all_tickers = set(t0_factor.keys()) | t1_tickers

        for ticker in sorted(all_tickers):
            in_t0 = ticker in t0_factor
            in_t1 = ticker in t1_tickers
            in_t2 = ticker in t2_tickers

            factor = t0_factor.get(ticker) or t1_factor.get(ticker, "-")

            # Look up ranked data row
            ticker_rows = df[df["ID"].str.split().str[0] == ticker]
            momentum      = "-"
            best_rank     = 201
            other_factors = "-"

            if not ticker_rows.empty:
                row = ticker_rows.iloc[0]
                mc = row.get("Momentum_Cat", None)
                if mc and not pd.isna(mc) and str(mc) not in ("—", ""):
                    momentum = str(mc)
                for fact in ["Value", "Growth", "Quality"]:
                    rc = row.get(f"{fact}_Final_Rank", 201)
                    if not pd.isna(rc):
                        v = int(rc)
                        if v < best_rank:
                            best_rank = v
                sec = [
                    f for f in ["Value", "Growth", "Quality"]
                    if f != factor
                    and not pd.isna(row.get(f"{f}_Final_Rank", 201))
                    and int(row.get(f"{f}_Final_Rank", 201)) <= 200
                ]
                other_factors = " / ".join(sec) if sec else "-"

            best_rank_display = str(best_rank) if best_rank < 201 else "-"
            recently_bought   = 1 if (in_t1 and not in_t2) else 0

            # Decision logic (ported from create_overview_summary_table)
            decision = "-"
            if in_t0 and in_t1:
                decision = "Hold"
            elif in_t1 and not in_t0:
                if in_t2:
                    decision = "Hold"
                else:
                    if best_rank <= 10:
                        decision = "Hold"
                    elif best_rank <= 200:
                        decision = "Hold" if momentum == "MU" else "Sell"
                    else:
                        decision = "Sell"
            elif not in_t1 and in_t0:
                decision = "DNB" if momentum == "MD" else "Buy"

            all_rows.append({
                "Ticker":          ticker,
                "Region":          region.upper(),
                "Factor":          factor,
                "Other Factors":   other_factors,
                "Momentum":        momentum,
                "Best Rank":       best_rank_display,
                "Recently Bought": recently_bought,
                "Decision":        decision,
            })

    return all_rows


# ─────────────────────────────────────────────────────────────────────────────
# Overview: main data assembly function
# ─────────────────────────────────────────────────────────────────────────────

def get_overview_data(
    factor_order: str = "VGQ",
    draft_mode: bool = False,
    momentum_filter: bool = False,
    highest_rank: bool = False,
) -> dict:
    """
    Assemble all Overview tab data:
      - {region}_t0: T0 top-5 per factor {Value:[...], Growth:[...], Quality:[...]}
      - {region}_t1_highlighted: T-1 per factor [{ticker, highlight}, ...]
      - {region}_t2_highlighted: T-2 per factor [{ticker, highlight}, ...]
      - summary: base summary rows
    """
    out: dict = {}
    ranked_dfs: dict[str, pd.DataFrame] = {}
    historical: dict[str, dict] = {}

    for region in ["us", "eu"]:
        universe = UNIVERSE_MAP[region]
        df = load_and_rank(universe)
        ranked_dfs[region] = df

        t0 = get_unique_top5_stocks(df, factor_order, draft_mode, momentum_filter, highest_rank)
        out[f"{region}_t0"] = t0

        hist = _load_historical_trades_raw(region)
        historical[region] = hist
        t1 = hist.get("T-1", {"Value": [], "Growth": [], "Quality": []})
        t2 = hist.get("T-2", {"Value": [], "Growth": [], "Quality": []})

        # T-2 flat maps for T-1 highlighting
        t2_flat: set[str] = set()
        t2_factor_map: dict[str, str] = {}
        for f, tks in t2.items():
            for tk in tks:
                t2_flat.add(tk)
                t2_factor_map[tk] = f

        t1_hl: dict[str, list] = {}
        for f in ["Value", "Growth", "Quality"]:
            t1_hl[f] = []
            for tk in t1.get(f, []):
                if tk not in t2_flat:
                    hl = "green"
                elif t2_factor_map.get(tk) != f:
                    hl = "blue"
                else:
                    hl = None
                t1_hl[f].append({"ticker": tk, "highlight": hl})
        out[f"{region}_t1_highlighted"] = t1_hl

        # T-1 flat maps for T-2 highlighting
        t1_flat: set[str] = set()
        t1_factor_map: dict[str, str] = {}
        for f, tks in t1.items():
            for tk in tks:
                t1_flat.add(tk)
                t1_factor_map[tk] = f

        t2_hl: dict[str, list] = {}
        for f in ["Value", "Growth", "Quality"]:
            t2_hl[f] = []
            for tk in t2.get(f, []):
                if tk not in t1_flat:
                    hl = "red"
                elif t1_factor_map.get(tk) != f:
                    hl = "blue"
                else:
                    hl = None
                t2_hl[f].append({"ticker": tk, "highlight": hl})
        out[f"{region}_t2_highlighted"] = t2_hl

    out["summary"] = _build_overview_summary(
        ranked_dfs, historical, {r: out[f"{r}_t0"] for r in ["us", "eu"]}
    )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Overview: ticker lookup for manual add
# ─────────────────────────────────────────────────────────────────────────────

def lookup_ticker_for_summary(ticker_input: str) -> Optional[dict]:
    """
    Search US then EU ranked data for a ticker.
    Returns a summary row dict or None if not found.
    """
    ticker_clean = ticker_input.strip().upper().split()[0]
    for region in ["us", "eu"]:
        df = load_and_rank(UNIVERSE_MAP[region])
        if df.empty:
            continue
        rows = df[df["ID"].str.split().str[0].str.upper() == ticker_clean]
        if rows.empty:
            continue
        row = rows.iloc[0]

        # Best factor (lowest Rank_Norm)
        best_factor = "-"
        best_norm   = float("inf")
        for factor in ["Value", "Growth", "Quality"]:
            nc = row.get(f"{factor}_Rank_Norm", 201)
            if not pd.isna(nc):
                v = float(nc)
                if v < best_norm:
                    best_norm   = v
                    best_factor = factor

        sec = [
            f for f in ["Value", "Growth", "Quality"]
            if f != best_factor
            and not pd.isna(row.get(f"{f}_Final_Rank", 201))
            and int(row.get(f"{f}_Final_Rank", 201)) <= 200
        ]
        other_factors = " / ".join(sec) if sec else "-"

        mc = row.get("Momentum_Cat", None)
        momentum = str(mc) if mc and not pd.isna(mc) and str(mc) not in ("—", "") else "-"

        best_rank = 201
        for factor in ["Value", "Growth", "Quality"]:
            v = row.get(f"{factor}_Final_Rank", 201)
            if not pd.isna(v) and int(v) < best_rank:
                best_rank = int(v)
        best_rank_display = str(best_rank) if best_rank < 201 else "-"

        return {
            "Ticker":          ticker_clean,
            "Region":          region.upper(),
            "Factor":          best_factor,
            "Other Factors":   other_factors,
            "Momentum":        momentum,
            "Best Rank":       best_rank_display,
            "Recently Bought": 0,
            "Decision":        "Buy",
        }
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Overview: save trades to database
# ─────────────────────────────────────────────────────────────────────────────

def save_trades_to_db(summary_data: list[dict], username: str) -> tuple[bool, str]:
    """
    Save Hold/Buy-filtered trades to [ApoAsset_Quant].[dbo].[Duoplus_Trades].
    Validates exactly 5 per factor per region before writing.
    """
    if not summary_data:
        return False, "No trades data to save"
    if not username:
        return False, "Username is required"

    engine = _get_engine()
    if engine is None:
        return False, "Database unavailable"

    df = pd.DataFrame(summary_data)
    df = df[df["Decision"].isin(["Hold", "Buy"])].copy()

    errors = []
    for region_code, sql_region in [("US", "USA"), ("EU", "Europa")]:
        rdf = df[df["Region"] == region_code]
        for factor in ["Value", "Growth", "Quality"]:
            cnt = len(rdf[rdf["Factor"] == factor])
            if cnt != 5:
                errors.append(f"{sql_region} – {factor}: Expected 5, found {cnt}")
    if errors:
        return False, "Cannot save:\n" + "\n".join(errors)

    try:
        max_df = pd.read_sql_query(
            "SELECT MAX(Periode) as MaxPeriode FROM [ApoAsset_Quant].[dbo].[Duoplus_Trades]",
            engine,
        )
        max_p  = max_df.iloc[0]["MaxPeriode"]
        next_p = 1 if pd.isna(max_p) else int(max_p) + 1
        today  = pd.Timestamp.now().strftime("%Y%m%d")

        rows = []
        for _, row in df.iterrows():
            rc = str(row.get("Region", "")).upper().strip()
            sql_reg = "USA" if rc == "US" else "Europa"
            rb_raw  = row.get("Recently Bought", 0)
            rb      = 1.0 if str(rb_raw).strip().lower() in ("yes", "1", "true", "1.0") else 0.0
            rows.append({
                "User":                username,
                "Periode":             next_p,
                "Datum_Inserted":      int(today),
                "Titel":               row.get("Ticker"),
                "Faktor":              row.get("Factor"),
                "Region":              sql_reg,
                "Range":               None,
                "Momentum":            row.get("Momentum"),
                "Rec":                 None,
                "Recently_Bought_Sold": rb,
                "Decision":            row.get("Decision"),
            })

        insert_df = pd.DataFrame(rows)
        insert_df.to_sql(
            "Duoplus_Trades",
            con=engine,
            schema="dbo",
            if_exists="append",
            index=False,
            method="multi",
        )
        return True, f"Successfully saved {len(rows)} trades (Periode {next_p})"
    except Exception:
        msg = traceback.format_exc()
        logger.error("Failed to save trades:\n%s", msg)
        return False, f"Database error: {msg[:300]}"


# ─────────────────────────────────────────────────────────────────────────────
# Overview: Bloomberg CSV export
# ─────────────────────────────────────────────────────────────────────────────

def generate_bloomberg_csv_file(decision_data: list[dict]) -> tuple[bool, str]:
    """
    Write Bloomberg upload CSV to X:\\Applikationen\\Bloomberg\\CustomDataFieldsUpload.
    Format per row (no header): UD_MA_FACTOR,DX194,Ticker,YYYYMMDD,CHAR,Factor
    """
    from pathlib import Path

    try:
        today  = pd.Timestamp.now().strftime("%Y%m%d")
        output_dir = Path(r"X:\Applikationen\Bloomberg\CustomDataFieldsUpload")
        output_dir.mkdir(parents=True, exist_ok=True)
        filepath = output_dir / f"bbupload_{today}.csv"

        lines = []
        for item in decision_data:
            ticker = item.get("Ticker", "")
            factor = item.get("Factor", "")
            if ticker and factor:
                lines.append(f"UD_MA_FACTOR,DX194,{ticker},{today},CHAR,{factor}")

        if not lines:
            return False, "No tickers with Buy or Hold decisions to export"

        filepath.write_text("\n".join(lines) + "\n")
        return True, f"Bloomberg CSV created: {filepath.name} ({len(lines)} rows)"
    except Exception as e:
        return False, f"Error creating Bloomberg CSV: {str(e)}"


# ─────────────────────────────────────────────────────────────────────────────
# Data Management / quality stats
# ─────────────────────────────────────────────────────────────────────────────

def get_data_quality_stats() -> dict:
    """
    Return data-quality statistics for US and EU regions.
    Includes total stocks, missing data counts, last DB date, and outlier/missing lists.
    """
    results = {}
    for region, universe in UNIVERSE_MAP.items():
        try:
            df = load_and_rank(universe)
            date_str = _get_data_date(universe)

            # Identify metric columns only (no rank cols, no ID/bool)
            excluded = {"ID", "UNGC", "Weapons", "Price", "Momentum_Cat"}
            metric_cols = [
                c for c in df.columns
                if c not in excluded
                and not c.endswith("_Rank")
                and not c.endswith("_Rank_Norm")
                and not c.endswith("_Final_Rank")
                and not c.endswith("_Top200")
                and df[c].dtype in ("float64", "int64")
            ]

            total = len(df)
            missing_count = int(df[metric_cols].isna().sum().sum()) if metric_cols else 0

            # Outlier detection (Z-score > 3) for top-30 by Mcap
            outliers = []
            if "Mcap 3M" in df.columns:
                top30 = df.nlargest(30, "Mcap 3M")
            else:
                top30 = df.head(30)

            check_cols = [c for c in metric_cols if c not in {"Mcap 3M", "Momentum"}]
            for idx, row in top30.iterrows():
                ticker = str(row.get("ID", idx)).split()[0]
                out_metrics, out_vals = [], {}
                for col in check_cols:
                    try:
                        val = row[col]
                        if pd.isna(val):
                            continue
                        col_data = df[col].dropna()
                        if len(col_data) < 3:
                            continue
                        mu, sigma = col_data.mean(), col_data.std()
                        if sigma > 0 and abs((val - mu) / sigma) > 3:
                            out_metrics.append(col)
                            out_vals[col] = float(val)
                    except Exception:
                        pass
                if out_metrics:
                    outliers.append({"ticker": ticker, "metrics": out_metrics, "values": out_vals})

            # Missing-data stocks
            missing_stocks = []
            for _, row in df.iterrows():
                ticker = str(row.get("ID", "")).split()[0]
                missing = [c for c in check_cols if pd.isna(row.get(c))]
                if missing:
                    missing_stocks.append({"ticker": ticker, "missing_metrics": missing})

            results[region] = {
                "universe": universe,
                "data_date": date_str,
                "total_stocks": total,
                "missing_data_points": missing_count,
                "outliers": outliers[:20],           # cap for response size
                "missing_stocks": missing_stocks[:50],
            }
        except Exception:
            results[region] = {
                "universe": UNIVERSE_MAP.get(region, ""),
                "data_date": None,
                "total_stocks": 0,
                "missing_data_points": 0,
                "outliers": [],
                "missing_stocks": [],
                "error": traceback.format_exc(),
            }

    return results
