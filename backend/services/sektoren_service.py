"""
Sektoren (Sectors) page data service

Reads sector PE ratio data from [ApoAsset_Quant].[dbo].[sector_pe_ratios].

Data structure in DB:
  - Sector:      Sector name (e.g. 'Energy', 'Financials')
  - Value:       PE ratio / Forward PE ratio value
  - Date:        Date of the data point
  - Index Name:  Index identifier (e.g. 'SPX Index', 'EURP600 Index')
  - Field:       'PE Ratio' or 'Forward PE Ratio'
  - Country Name:'US' or 'Europe'

Computes:
  - PE Difference: PE Ratio – Forward PE Ratio (per sector / region)
  - Winsorization: 5 % on each tail per (CountryName, Field, Sector) group
  - Wide-format time-series for 4 graphs across 3 views

Graph dictionary (mirrors C:/Projekte/dashboard/sectors/layout.py):
  g1 → PE Ratio
  g2 → Forward PE Ratio
  g3 → PE Difference  (computed)
  g4 → Both           (PE Ratio + Forward PE Ratio together)
"""

import pandas as pd
import numpy as np
from datetime import date, timedelta
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VIEW_OPTIONS = ["U.S.", "Europe", "U.S. vs. Europe"]

# English → German sector name translation (source: data/mapping.py)
SECTOR_DE = {
    "Communication Services":  "Kommunikation",
    "Consumer Discretionary":  "Zyklische Konsumgüter",
    "Consumer Staples":        "Nicht-zyklische Konsumgüter",
    "Energy":                  "Energie",
    "Financials":              "Finanzen",
    "Health Care":             "Gesundheitswesen",
    "Industrials":             "Industrie",
    "Information Technology":  "Informationstechnologie",
    "Materials":               "Rohstoffe",
    "Real Estate":             "Immobilien",
    "Utilities":               "Versorger",
}
SECTOR_EN = {v: k for k, v in SECTOR_DE.items()}   # reverse lookup

# Fixed color per *English* sector name (consistent across charts)
SECTOR_COLORS = {
    "Communication Services":  "#8b5cf6",
    "Consumer Discretionary":  "#ec4899",
    "Consumer Staples":        "#10b981",
    "Energy":                  "#f59e0b",
    "Financials":              "#3b82f6",
    "Health Care":             "#ef4444",
    "Industrials":             "#14b8a6",
    "Information Technology":  "#6366f1",
    "Materials":               "#84cc16",
    "Real Estate":             "#f43f5e",
    "Utilities":               "#06b6d4",
}

# DB CountryName per view
VIEW_TO_REGIONS = {
    "U.S.":            ["US"],
    "Europe":          ["Europe"],
    "U.S. vs. Europe": ["US", "Europe"],
}

# Graph 4 builds two sub-series per sector:  "Energie KGV"  and  "Energie Erw. KGV"
FIELD_LABEL_SINGLE = {
    "PE Ratio":         "KGV",
    "Forward PE Ratio": "Erw. KGV",
}
REGION_LABEL = {"US": "US", "Europe": "EU"}


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_engine():
    from utils.database import DatabaseGateway
    return DatabaseGateway().get_prod_engine()


def _load_raw(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Pull all non-null sector PE ratio rows for the requested date window.
    Returns columns: Date (datetime), Sector (str), Field (str), CountryName (str), Value (float)
    """
    engine = _get_engine()
    query = f"""
        SELECT
            Sector,
            Value,
            [Date]                  AS Date,
            [Field]                 AS Field,
            [Country Name]          AS CountryName
        FROM [ApoAsset_Quant].[dbo].[sector_pe_ratios]
        WHERE
            Sector IS NOT NULL
            AND [Date] >= CONVERT(DATE, '{start_date}', 120)
            AND [Date] <= CONVERT(DATE, '{end_date}', 120)
        ORDER BY [Date], Sector, Field, [Country Name]
    """
    logger.info("Querying sector_pe_ratios  %s – %s", start_date, end_date)
    df = pd.read_sql_query(query, engine)
    if df.empty:
        logger.warning("sector_pe_ratios returned no rows for %s – %s", start_date, end_date)
        return df
    df["Date"]  = pd.to_datetime(df["Date"], errors="coerce")
    df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
    df = df.dropna(subset=["Date", "Value"])
    df = df[df["Sector"].notna() & (df["Sector"].str.strip() != "")]
    df["Sector"]      = df["Sector"].str.strip()
    df["CountryName"] = df["CountryName"].str.strip()
    df["Field"]       = df["Field"].str.strip()
    logger.info("Raw rows after cleaning: %d", len(df))
    return df


# ---------------------------------------------------------------------------
# Winsorization
# ---------------------------------------------------------------------------

def _winsorize(df: pd.DataFrame, iqr_multiplier: float = 3.0) -> pd.DataFrame:
    """
    Clip values using IQR-based fences per (CountryName, Field, Sector) group.

    Fence = [Q1 - multiplier*IQR, Q3 + multiplier*IQR]

    IQR-based clipping is preferred over percentile-based because it correctly
    handles short-lived extreme spikes (e.g. a sector PE jumping from 25 to 1000
    for two weeks): percentile trimming at 5% would keep such spikes if they
    comprise less than 5% of the data, whereas IQR fences catch them regardless
    of frequency.
    """
    df = df.copy()
    for (country, field, sector), grp in df.groupby(["CountryName", "Field", "Sector"]):
        vals = grp["Value"].dropna()
        if len(vals) < 4:
            continue
        q1 = np.percentile(vals, 25)
        q3 = np.percentile(vals, 75)
        iqr = q3 - q1
        if iqr <= 0:
            continue
        lo = q1 - iqr_multiplier * iqr
        hi = q3 + iqr_multiplier * iqr
        df.loc[grp.index, "Value"] = df.loc[grp.index, "Value"].clip(lo, hi)
    return df


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _compute_dates(lookback: str) -> tuple:
    today = date.today()
    if lookback == "MtD":
        start = today.replace(day=1)
    elif lookback == "YtD":
        start = date(today.year - 1, 12, 31)
    elif lookback == "1Y":
        start = today - timedelta(days=365)
    elif lookback == "3Y":
        start = today - timedelta(days=3 * 365)
    elif lookback == "7Y":
        start = today - timedelta(days=7 * 365)
    else:   # "All"
        start = date(1990, 1, 1)
    return start.isoformat(), today.isoformat()


# ---------------------------------------------------------------------------
# Wide-format pivot helpers
# ---------------------------------------------------------------------------

def _pivot_series(df: pd.DataFrame, date_col: str, series_names: dict) -> pd.DataFrame:
    """
    Pivot a DataFrame with (Date, label) pairs into wide format.
    series_names: {label_key: column_name_in_result}
    Returns: DataFrame with DatePoint column + one column per series.
    """
    if df.empty:
        return pd.DataFrame(columns=["DatePoint"])
    pivoted = df.pivot_table(
        index=date_col, columns="__series__", values="Value", aggfunc="first"
    ).reset_index()
    pivoted = pivoted.rename(columns={date_col: "DatePoint"})
    pivoted["DatePoint"] = pivoted["DatePoint"].astype(str).str[:10]
    return pivoted


def _build_wide(date_series_pairs: list) -> pd.DataFrame:
    """
    Build a wide DataFrame from a list of (series_name, date_index_or_array, values_array).
    Returns DataFrame with DatePoint column + one column per series.
    Dates aligned to union of all dates (no fill).
    """
    if not date_series_pairs:
        return pd.DataFrame(columns=["DatePoint"])

    # Build one Series per entry, index = date string
    all_series = {}
    for name, dates, values in date_series_pairs:
        s = pd.Series(
            data=list(values) if not isinstance(values, list) else values,
            index=[str(d)[:10] for d in dates],
            name=name,
            dtype=float,
        )
        # If the same name appears twice (shouldn't), combine
        if name in all_series:
            all_series[name] = all_series[name].combine_first(s)
        else:
            all_series[name] = s

    df = pd.DataFrame(all_series)
    df.index.name = "DatePoint"
    df = df.reset_index().sort_values("DatePoint")
    # Forward-fill small gaps (handles mismatched trading days between regions)
    # Limit=5 so only short holes are patched; long absences remain NaN.
    df = df.ffill(limit=5)
    # Replace NaN with None for JSON serialisation
    df = df.where(pd.notna(df), other=None)
    return df


# ---------------------------------------------------------------------------
# Per-series winsorization (for computed/derived series)
# ---------------------------------------------------------------------------

def _winsorize_series(s: pd.Series, iqr_multiplier: float = 3.0) -> pd.Series:
    """
    Winsorize a single computed Series (e.g. PE Difference, cross-region diff)
    using IQR-based fences.  Only applied when >= 4 valid points.
    """
    vals = s.dropna()
    if len(vals) < 4:
        return s
    q1 = np.percentile(vals, 25)
    q3 = np.percentile(vals, 75)
    iqr = q3 - q1
    if iqr <= 0:
        return s
    lo = q1 - iqr_multiplier * iqr
    hi = q3 + iqr_multiplier * iqr
    return s.clip(lo, hi)


# ---------------------------------------------------------------------------
# Per-graph builders
# ---------------------------------------------------------------------------

def _get_single_region_field(df_win: pd.DataFrame, region: str, field: str,
                              sectors: list) -> list:
    """Return [(german_name, dates, values), ...] for one region + one field."""
    sub = df_win[
        (df_win["CountryName"] == region) &
        (df_win["Field"] == field) &
        (df_win["Sector"].isin(sectors))
    ].copy()
    traces = []
    for sector in sorted(sub["Sector"].unique()):
        s = sub[sub["Sector"] == sector].sort_values("Date")
        s = s.drop_duplicates("Date", keep="first")
        s = s.dropna(subset=["Value"])
        if s.empty:
            continue
        name_de = SECTOR_DE.get(sector, sector)
        traces.append((name_de, s["Date"].values, s["Value"].values))
    return traces


def _get_pe_difference(df_win: pd.DataFrame, region: str, sectors: list) -> list:
    """Return [(german_name, dates, diff_values), ...] for PE - Forward PE of one region."""
    pe_df  = df_win[(df_win["CountryName"] == region) & (df_win["Field"] == "PE Ratio")]
    fpe_df = df_win[(df_win["CountryName"] == region) & (df_win["Field"] == "Forward PE Ratio")]
    traces = []
    for sector in sorted(sectors):
        pe  = pe_df[pe_df["Sector"] == sector].drop_duplicates("Date").sort_values("Date").set_index("Date")["Value"].dropna()
        fpe = fpe_df[fpe_df["Sector"] == sector].drop_duplicates("Date").sort_values("Date").set_index("Date")["Value"].dropna()
        if pe.empty or fpe.empty:
            continue
        idx = pe.index.union(fpe.index)
        pe  = pe.reindex(idx).ffill()
        fpe = fpe.reindex(idx).ffill()
        diff = (pe - fpe).dropna()
        if diff.empty:
            continue
        diff = _winsorize_series(diff)
        traces.append((SECTOR_DE.get(sector, sector), diff.index, diff.values))
    return traces


def _get_both(df_win: pd.DataFrame, region: str, sectors: list, region_label: str = "") -> list:
    """Return [(trace_name, dates, values), ...] with both PE and Forward PE per sector."""
    traces = []
    suffix = f" {region_label}" if region_label else ""
    for sector in sorted(sectors):
        name_de = SECTOR_DE.get(sector, sector)
        for field_key, field_label in FIELD_LABEL_SINGLE.items():
            sub = df_win[
                (df_win["CountryName"] == region) &
                (df_win["Field"] == field_key) &
                (df_win["Sector"] == sector)
            ].drop_duplicates("Date").sort_values("Date").dropna(subset=["Value"])
            if sub.empty:
                continue
            traces.append((f"{name_de} {field_label}{suffix}", sub["Date"].values, sub["Value"].values))
    return traces


def _build_graph_traces(df_win: pd.DataFrame, view: str, graph: str, sectors: list) -> list:
    """
    Return list of (series_name, dates, values) tuples for one graph.
    """
    regions = VIEW_TO_REGIONS[view]

    if view in ("U.S.", "Europe"):
        region = regions[0]
        if graph == "g1":
            return _get_single_region_field(df_win, region, "PE Ratio", sectors)
        elif graph == "g2":
            return _get_single_region_field(df_win, region, "Forward PE Ratio", sectors)
        elif graph == "g3":
            return _get_pe_difference(df_win, region, sectors)
        elif graph == "g4":
            return _get_both(df_win, region, sectors)

    else:   # "U.S. vs. Europe" – return both regions' series for comparison bar chart
        # Series are named "<Sektor> US" / "<Sektor> EU" so the frontend can pair them.
        # g4 is excluded at the frontend level (Bar-only view).
        rl_us = REGION_LABEL["US"]      # "US"
        rl_eu = REGION_LABEL["Europe"]  # "EU"

        if graph == "g1":
            raw_us = [(f"{n} {rl_us}", d, v) for n, d, v in
                      _get_single_region_field(df_win, "US", "PE Ratio", sectors)]
            raw_eu = [(f"{n} {rl_eu}", d, v) for n, d, v in
                      _get_single_region_field(df_win, "Europe", "PE Ratio", sectors)]
        elif graph == "g2":
            raw_us = [(f"{n} {rl_us}", d, v) for n, d, v in
                      _get_single_region_field(df_win, "US", "Forward PE Ratio", sectors)]
            raw_eu = [(f"{n} {rl_eu}", d, v) for n, d, v in
                      _get_single_region_field(df_win, "Europe", "Forward PE Ratio", sectors)]
        elif graph == "g3":
            # Each region's own PE – Forward PE difference (not cross-region diff)
            raw_us = [(f"{n} {rl_us}", d, v) for n, d, v in
                      _get_pe_difference(df_win, "US", sectors)]
            raw_eu = [(f"{n} {rl_eu}", d, v) for n, d, v in
                      _get_pe_difference(df_win, "Europe", sectors)]
        else:
            return []  # g4 not shown for comparison view

        # Interleave US/EU by base sector name so the frontend receives a predictable order
        us_by_base = {t[0][:-len(f" {rl_us}")]: t for t in raw_us}
        eu_by_base = {t[0][:-len(f" {rl_eu}")]: t for t in raw_eu}
        result = []
        for base in sorted(set(us_by_base) | set(eu_by_base)):
            if base in us_by_base:
                result.append(us_by_base[base])
            if base in eu_by_base:
                result.append(eu_by_base[base])
        return result

    return []


def _diff_traces(traces_a: dict, traces_b: dict) -> list:
    """Compute difference (a – b) for each sector name present in both dicts."""
    result = []
    for sector_name in sorted(set(traces_a) & set(traces_b)):
        d_a, v_a = traces_a[sector_name]
        d_b, v_b = traces_b[sector_name]
        sa = pd.Series(
            data=v_a if not hasattr(v_a, 'values') else v_a,
            index=[str(x)[:10] for x in d_a],
            dtype=float,
        ).drop_duplicates()
        sb = pd.Series(
            data=v_b if not hasattr(v_b, 'values') else v_b,
            index=[str(x)[:10] for x in d_b],
            dtype=float,
        ).drop_duplicates()
        idx = sa.index.union(sb.index)
        sa = sa.reindex(idx).ffill()
        sb = sb.reindex(idx).ffill()
        diff = (sa - sb).dropna()
        if not diff.empty:
            diff = _winsorize_series(diff)
            result.append((sector_name, diff.index, diff.values))
    return result


# ---------------------------------------------------------------------------
# Colour / series metadata
# ---------------------------------------------------------------------------

def _series_colors_for(traces: list) -> dict:
    """
    Return {series_name: hex_color} for a list of trace tuples.
    Sector name is the first token (before " KGV", " Erw.", etc.)  ->
    mapped back through SECTOR_EN to get the DB sector name.
    Falls back to a cycling palette when not found.
    """
    FALLBACK = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981",
                "#f59e0b", "#ef4444", "#14b8a6", "#6366f1",
                "#84cc16", "#f43f5e", "#06b6d4"]
    mapping = {}
    idx = 0
    for name, *_ in traces:
        # Strip comparison-view region suffixes (" US", " EU") to get the clean sector name
        base = name
        for sfx in (" US", " EU"):
            if name.endswith(sfx):
                base = name[: -len(sfx)].strip()
                break
        # Try full German sector name first (handles multi-word names like "Nicht-zyklische Konsumgüter"),
        # then fall back to first word (handles g4 names like "Energie KGV")
        en = SECTOR_EN.get(base) or SECTOR_EN.get(base.split(" ", 1)[0])
        color = SECTOR_COLORS.get(en, FALLBACK[idx % len(FALLBACK)])
        mapping[name] = color
        idx += 1
    return mapping


# ---------------------------------------------------------------------------
# Graph titles
# ---------------------------------------------------------------------------

GRAPH_TITLES = {
    "g1": "KGV",
    "g2": "Erwartetes KGV",
    "g3": "KGV - Erwartetes KGV",
    "g4": "KGV vs. Erwartetes KGV",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class SektorenService:

    @staticmethod
    def get_available_views() -> list:
        return VIEW_OPTIONS

    @staticmethod
    def get_all_sectors() -> list:
        """Return the canonical sector list (English names, sorted)."""
        return sorted(SECTOR_DE.keys())

    @staticmethod
    def get_sector_translations() -> dict:
        """Return {english: german} mapping."""
        return SECTOR_DE

    @staticmethod
    def get_graphs_data(
        view: str = "U.S.",
        lookback: str = "1Y",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        sectors: Optional[list] = None,
    ) -> dict:
        """
        Build graph data for all 4 sector PE ratio graphs.

        Parameters
        ----------
        view         : "U.S." | "Europe" | "U.S. vs. Europe"
        lookback     : "MtD" | "YtD" | "1Y" | "3Y" | "7Y" | "All"  (used when dates not provided)
        start_date   : ISO date string (overrides lookback)
        end_date     : ISO date string (overrides lookback)
        sectors      : list of English sector names to include (None = all)

        Returns
        -------
        {status, view, start_date, end_date, graphs: {g1..g4}, sector_colors}
        """
        # Resolve dates
        if not start_date or not end_date:
            start_date, end_date = _compute_dates(lookback)

        # Sector filter
        all_sectors = SektorenService.get_all_sectors()
        if not sectors:
            sectors = all_sectors
        else:
            sectors = [s for s in sectors if s in all_sectors]
            if not sectors:
                sectors = all_sectors

        try:
            raw = _load_raw(start_date, end_date)
            if raw.empty:
                return {
                    "status": "ok",
                    "view": view,
                    "start_date": start_date,
                    "end_date": end_date,
                    "graphs": {f"g{i}": {"title": GRAPH_TITLES[f"g{i}"], "data": [], "series": [], "colors": {}} for i in range(1, 5)},
                    "sector_colors": SECTOR_COLORS,
                }

            # Winsorize once for all graphs
            df_win = _winsorize(raw)

            graphs = {}
            for gname in ["g1", "g2", "g3", "g4"]:
                traces = _build_graph_traces(df_win, view, gname, sectors)

                # Sort by latest absolute value (descending) — mirrors reference project
                def _last(vals):
                    try:
                        arr = list(vals)
                        return abs(float(arr[-1]))
                    except Exception:
                        return 0.0
                traces.sort(key=lambda t: _last(t[2]), reverse=True)

                wide = _build_wide(traces)
                series_names = [t[0] for t in traces]
                colors = _series_colors_for(traces)

                graphs[gname] = {
                    "title":   GRAPH_TITLES[gname],
                    "data":    wide.to_dict(orient="records"),
                    "series":  series_names,
                    "colors":  colors,
                }

            logger.info(
                "SektorenService.get_graphs_data view=%s sectors=%d start=%s end=%s",
                view, len(sectors), start_date, end_date,
            )
            return {
                "status":     "ok",
                "view":       view,
                "start_date": start_date,
                "end_date":   end_date,
                "graphs":     graphs,
                "sector_colors": SECTOR_COLORS,
            }

        except Exception as exc:
            logger.exception("SektorenService error: %s", exc)
            return {"status": "error", "error": str(exc)}
