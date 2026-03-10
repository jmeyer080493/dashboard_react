"""
Faktoren (Factors) page data service

Pulls factor analysis data live from SQL:
  - Ticker list:  [ApoAsset_Quant].[dbo].[ticker_master]  (Dashboard Grouping = 'Factor')
  - Price data:   [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField]

The data consists of MSCI equity factor indices (Large, Small, Mid, Value, Growth,
Momentum, Quality, etc.) for various regions (U.S., Europe, Japan, Emerging Markets).

For each of the 6 graphs the service computes cumulative returns indexed to 0 at
the start of the selected window. When a graph has exactly 2 series it also
emits a "Difference" column so the frontend can render a spread sub-chart.
"""

import pandas as pd
import numpy as np
from datetime import date, timedelta
import logging
from typing import Optional
from config.settings import USE_SYNTHETIC_DATA

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Region alias map
# ---------------------------------------------------------------------------
# The GRAPH_DICTIONARY uses "EM" as a short label; the DB stores "Emerging Markets"
REGION_ALIAS = {
    "EM": "Emerging Markets",
}

# ---------------------------------------------------------------------------
# Graph configuration (mirrors reference project factor/layout.py)
# ---------------------------------------------------------------------------

GRAPH_DICTIONARY = {
    "U.S.": {
        "g1": {"regions": ["U.S.", "U.S."],     "factors": ["Large", "Small"]},
        "g2": {"regions": ["U.S.", "U.S."],     "factors": ["Large", "Mid"]},
        "g3": {"regions": ["U.S.", "U.S."],     "factors": ["Large", "Mid", "Small"]},
        "g4": {"regions": ["U.S.", "U.S."],     "factors": ["Value", "Growth"]},
        "g5": {"regions": ["U.S.", "U.S."],     "factors": ["Large Value", "Large Growth"]},
        "g6": {"regions": ["U.S.", "U.S."],     "factors": ["Value", "Growth", "Momentum", "Quality"]},
    },
    "Europe": {
        "g1": {"regions": ["Europe", "Europe"], "factors": ["Large", "Small"]},
        "g2": {"regions": ["Europe", "Europe"], "factors": ["Large", "Mid"]},
        "g3": {"regions": ["Europe", "Europe"], "factors": ["Large", "Mid", "Small"]},
        "g4": {"regions": ["Europe", "Europe"], "factors": ["Value", "Growth"]},
        "g5": {"regions": ["Europe", "Europe"], "factors": ["Large Value", "Large Growth"]},
        "g6": {"regions": ["Europe", "Europe"], "factors": ["Value", "Growth", "Momentum", "Quality"]},
    },
    "U.S. vs. Europe": {
        "g1": {"regions": ["U.S.", "Europe"],   "factors": ["Large"]},
        "g2": {"regions": ["U.S.", "Europe"],   "factors": ["Mid"]},
        "g3": {"regions": ["U.S.", "Europe"],   "factors": ["Small"]},
        "g4": {"regions": ["U.S.", "Europe"],   "factors": ["Value"]},
        "g5": {"regions": ["U.S.", "Europe"],   "factors": ["Growth"]},
        "g6": {"regions": ["U.S.", "Europe"],   "factors": ["Momentum"]},
    },
    "World": {
        "g1": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Large"]},
        "g2": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Mid"]},
        "g3": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Small"]},
        "g4": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Value"]},
        "g5": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Growth"]},
        "g6": {"regions": ["U.S.", "Europe", "Japan", "EM"], "factors": ["Momentum"]},
    },
}

GRAPH_NAMES  = ["g1", "g2", "g3", "g4", "g5", "g6"]
VIEW_OPTIONS = ["U.S.", "Europe", "U.S. vs. Europe", "World"]


# ---------------------------------------------------------------------------
# Database helpers  (same engine pattern as länder_service.py)
# ---------------------------------------------------------------------------

def _get_engine():
    from utils.database import DatabaseGateway
    return DatabaseGateway().get_prod_engine()


def _generate_synthetic_ticker_map() -> dict:
    """
    Generate synthetic ticker map for testing/demo purposes.

    Returns:
        { ticker_str: (db_region, grouping_name) }
    """
    # Collect all unique regions and factors from GRAPH_DICTIONARY
    regions_set = set()
    factors_set = set()
    
    for view_cfg in GRAPH_DICTIONARY.values():
        for graph_cfg in view_cfg.values():
            regions_set.update(graph_cfg["regions"])
            factors_set.update(graph_cfg["factors"])
    
    # Resolve aliases to database region names
    db_regions = {REGION_ALIAS.get(r, r) for r in regions_set}
    
    result = {}
    ticker_counter = 1
    
    for region in sorted(db_regions):
        for factor in sorted(factors_set):
            # Generate synthetic ticker name
            ticker = f"M{ticker_counter}SYN{region[:2].upper()}{factor.replace(' ', '')[:3]} Index"
            result[ticker] = (region, factor)
            ticker_counter += 1
    
    logger.info("Generated %d synthetic tickers from GRAPH_DICTIONARY", len(result))
    return result


def _load_factor_ticker_map() -> dict:
    """
    Query ticker_master for all active factor tickers.

    Returns:
        { ticker_str: (db_region, grouping_name) }
        e.g.  {"M1USLC Index": ("U.S.", "Large"), ...}
    """
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic ticker map")
        return _generate_synthetic_ticker_map()
    
    engine = _get_engine()
    query = """
        SELECT Ticker, Regions, [Dashboard Grouping Name]
        FROM [ApoAsset_Quant].[dbo].[ticker_master]
        WHERE [Dashboard Grouping] = 'Factor'
          AND Active IN (1.0, 2.0)
    """
    df = pd.read_sql_query(query, engine)
    if df.empty:
        raise RuntimeError("ticker_master returned no Factor tickers – check DB connection")
    result = {}
    for _, row in df.iterrows():
        result[row["Ticker"].strip()] = (
            row["Regions"].strip(),
            row["Dashboard Grouping Name"].strip(),
        )
    logger.info("Loaded %d factor tickers from ticker_master", len(result))
    return result


def _fetch_bloomberg_prices(
    tickers: list,
    start_date: str,
    end_date: str,
    currency: str,
) -> pd.DataFrame:
    """
    Query Bloomberg for PX_LAST daily prices for the given tickers.

    Returns a DataFrame: DatePoint (datetime), Ticker (str), Currency (str), Value (float)
    """
    if not tickers:
        return pd.DataFrame(columns=["DatePoint", "Ticker", "Currency", "Value"])

    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic prices")
        return _generate_synthetic_prices(tickers, start_date, end_date, currency)

    engine = _get_engine()
    ticker_list_sql = "', '".join(tickers)

    query = (
        "SELECT d.DatePoint, e.BloombergTicker AS Ticker, d.Currency, d.ValueAsString "
        "FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] AS d "
        "LEFT JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] AS e "
        "    ON d.BloombergTickerId = e.Id "
        f"WHERE e.BloombergTicker IN ('{ticker_list_sql}') "
        "  AND d.Frequency = 'DAILY' "
        "  AND d.FieldName  = 'PX_LAST' "
        f"  AND d.Currency   = '{currency}' "
        f"  AND TRY_CONVERT(DATETIME, d.DatePoint) >= CONVERT(DATETIME, '{start_date}', 120) "
        f"  AND TRY_CONVERT(DATETIME, d.DatePoint) <= CONVERT(DATETIME, '{end_date}', 120) "
        "ORDER BY d.DatePoint, e.BloombergTicker"
    )

    logger.info(
        "Querying Bloomberg for %d tickers  %s – %s  [%s]",
        len(tickers), start_date, end_date, currency,
    )
    df = pd.read_sql_query(query, engine)

    if df.empty:
        logger.warning("Bloomberg returned no rows (currency=%s)", currency)
        return pd.DataFrame(columns=["DatePoint", "Ticker", "Currency", "Value"])

    # Parse value (some rows use comma as decimal separator)
    df["Value"] = pd.to_numeric(
        df["ValueAsString"].astype(str).str.replace(",", ".", regex=False),
        errors="coerce",
    )
    df = df.drop(columns=["ValueAsString"])
    df["DatePoint"] = pd.to_datetime(df["DatePoint"], errors="coerce")
    df = df.dropna(subset=["DatePoint", "Value"])
    df = df.drop_duplicates(subset=["DatePoint", "Ticker"], keep="first")

    logger.info("Bloomberg returned %d clean price rows", len(df))
    return df


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _generate_synthetic_prices(
    tickers: list,
    start_date: str,
    end_date: str,
    currency: str,
) -> pd.DataFrame:
    """
    Generate synthetic price data for testing/demo purposes.

    Returns a DataFrame with realistic-looking price movements.
    """
    from datetime import datetime
    
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    rows = []
    current = start
    ticker_idx = 0
    
    while current <= end:
        # Skip weekends
        if current.weekday() < 5:  # Monday=0, Friday=4
            for ticker in tickers:
                # Generate realistic synthetic price variation
                base_price = 100 + (len(ticker) * 10)
                daily_return = np.random.normal(0.0005, 0.015)  # ~0.05% mean, 1.5% std
                price = base_price * (1 + daily_return)
                
                rows.append({
                    "DatePoint": current,
                    "Ticker": ticker,
                    "Currency": currency,
                    "Value": round(price, 4),
                })
        
        current = current + timedelta(days=1)
    
    if not rows:
        return pd.DataFrame(columns=["DatePoint", "Ticker", "Currency", "Value"])
    
    df = pd.DataFrame(rows)
    logger.info("Generated %d synthetic price rows for %d tickers", len(df), len(tickers))
    return df


def _compute_lookback_dates(lookback: str) -> tuple:
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
    else:  # "All"
        start = date(1990, 1, 1)
    return start.isoformat(), today.isoformat()


# ---------------------------------------------------------------------------
# Cumulative return calculation
# ---------------------------------------------------------------------------

def _compute_cumulative_return(series: pd.Series) -> pd.Series:
    """Cumulative return indexed to 0 at the first valid point (in %).

    Uses direct price normalisation (price[i] / price[0] - 1) so that the
    first data point is always included and always equals 0 %.  The old
    pct_change() approach created a NaN at row-0 that was dropped, causing
    each series to silently skip its first date and land on different
    starting dates in the chart.
    """
    series = series.dropna()
    if series.empty:
        return series
    base = series.iloc[0]
    if base == 0:
        return pd.Series(dtype=float)
    return (series / base - 1) * 100


# ---------------------------------------------------------------------------
# Per-graph data builder
# ---------------------------------------------------------------------------

def _build_graph_data(
    prices_df: pd.DataFrame,
    ticker_map: dict,
    view: str,
    graph_number: str,
    display_start_date: Optional[str] = None,
) -> dict:
    """
    Build wide-format chart data for one graph.

    Returns:
        {
            "title":          str,
            "data":           [{"DatePoint": "YYYY-MM-DD", series_name: float, ...}],
            "series":         [str],
            "has_difference": bool,
            "latest_date":    str,
        }
    """
    cfg        = GRAPH_DICTIONARY[view][graph_number]
    raw_regions = cfg["regions"]
    factors    = cfg["factors"]

    # Resolve short aliases ("EM") to DB region names ("Emerging Markets")
    db_regions = [REGION_ALIAS.get(r, r) for r in raw_regions]

    # Deduplicate while preserving order
    seen = set()
    unique_db_regions = []
    for r in db_regions:
        if r not in seen:
            seen.add(r)
            unique_db_regions.append(r)

    if prices_df.empty:
        title = ""
        if len(unique_db_regions) == 1:
            title = unique_db_regions[0] + " " + " – ".join(factors)
        else:
            title = f"{view} {factors[0]}"
        return {"title": title, "data": [], "series": [], "has_difference": False, "latest_date": "N/A"}

    # Annotate prices with region and factor name from the ticker map
    df = prices_df.copy()
    df["Regions"]    = df["Ticker"].map(lambda t: ticker_map.get(t, (None, None))[0])
    df["FactorName"] = df["Ticker"].map(lambda t: ticker_map.get(t, (None, None))[1])
    df = df.dropna(subset=["Regions", "FactorName"])

    traces = []   # list of (label, {date_str: cumulative_value})
    latest_date = None

    # ── Step 1: collect raw per-series DataFrames ──────────────────────────
    series_data_list = []   # list of (label, sub_df)

    if len(unique_db_regions) == 1:
        # Single region – one series per factor
        region = unique_db_regions[0]
        for factor in factors:
            sub = df[(df["Regions"] == region) & (df["FactorName"] == factor)].sort_values("DatePoint")
            if sub.empty:
                continue
            series_data_list.append((factor, sub))
            if latest_date is None or sub["DatePoint"].max() > latest_date:
                latest_date = sub["DatePoint"].max()
    else:
        # Multiple regions – one series per region, single factor
        factor = factors[0]
        for region in unique_db_regions:
            sub = df[(df["Regions"] == region) & (df["FactorName"] == factor)].sort_values("DatePoint")
            if sub.empty:
                continue
            # Use the original short alias as the series label when available
            label = next((k for k, v in REGION_ALIAS.items() if v == region), region)
            series_data_list.append((label, sub))
            if latest_date is None or sub["DatePoint"].max() > latest_date:
                latest_date = sub["DatePoint"].max()

    # ── Step 2: resolve base prices and the common display-start date ───────
    #
    # For each series we want:
    #   base_price = last available price ON OR BEFORE display_start_date
    #
    # This mirrors the standard finance convention for period-return charts:
    # YtD uses the last price of the previous year (Dec 31 or earlier if that
    # day has no data), 1Y uses the last price from exactly one year ago, etc.
    # All series are then expressed as % change from that anchor, so they are
    # correctly comparable even when markets have different holiday calendars.
    #
    # The common display-start date is the LATEST of each series' first
    # available date >= display_start_date, so all lines begin on the same
    # calendar date on the left edge of the chart.

    display_start_ts = pd.Timestamp(display_start_date) if display_start_date else None

    base_price_map: dict = {}   # label -> base price (float)
    first_display_dates = []

    for label, sub_df in series_data_list:
        valid = sub_df.dropna(subset=["Value"])
        if valid.empty:
            continue
        if display_start_ts is not None:
            # Last price on or before the anchor date
            pre = valid[valid["DatePoint"] <= display_start_ts]
            if pre.empty:
                # No price before anchor – fall back to the very first available price
                pre = valid
            base_price_map[label] = float(pre["Value"].iloc[-1])
            # First date that will actually be displayed
            post = sub_df[sub_df["DatePoint"] > display_start_ts]
            if post.empty:
                post = sub_df[sub_df["DatePoint"] >= display_start_ts]
            if not post.empty:
                first_display_dates.append(post["DatePoint"].min())
        else:
            base_price_map[label] = float(valid["Value"].iloc[0])
            first_display_dates.append(sub_df["DatePoint"].min())

    # Common start: the latest "first display date" so every series has data
    common_display_start = max(first_display_dates) if first_display_dates else display_start_ts

    # ── Step 3: compute cumulative returns ──────────────────────────────────
    for label, sub_df in series_data_list:
        base_price = base_price_map.get(label)
        if base_price is None or base_price == 0:
            continue
        # Only show dates from the common display start onward
        if common_display_start is not None:
            display_sub = sub_df[sub_df["DatePoint"] >= common_display_start].copy()
        else:
            display_sub = sub_df.copy()
        if display_sub.empty:
            continue
        display_sub = display_sub.sort_values("DatePoint").reset_index(drop=True)
        ret_series = (display_sub["Value"] / base_price - 1) * 100
        d = {
            dt.strftime("%Y-%m-%d"): round(float(v), 4)
            for dt, v in zip(display_sub["DatePoint"], ret_series)
            if not (isinstance(v, float) and np.isnan(v))
        }
        traces.append((label, d))

    # Build title
    if len(unique_db_regions) == 1:
        title = unique_db_regions[0] + " " + " – ".join(factors)
    else:
        title = f"{view} {factors[0]}"

    if not traces:
        return {"title": title, "data": [], "series": [], "has_difference": False, "latest_date": "N/A"}

    has_difference = len(traces) == 2

    # Merge into sorted wide-format rows
    all_dates: set = set()
    for _, d in traces:
        all_dates |= d.keys()

    rows = []
    for dt in sorted(all_dates):
        row = {"DatePoint": dt}
        for name, d in traces:
            row[name] = d.get(dt)
        rows.append(row)

    # Add Difference column when exactly 2 series
    if has_difference:
        _, d0 = traces[0]
        _, d1 = traces[1]
        for row in rows:
            v0 = d0.get(row["DatePoint"])
            v1 = d1.get(row["DatePoint"])
            row["Difference"] = round(v0 - v1, 4) if (v0 is not None and v1 is not None) else None

    series_names = [name for name, _ in traces] + (["Difference"] if has_difference else [])

    return {
        "title":          title,
        "data":           rows,
        "series":         series_names,
        "has_difference": has_difference,
        "latest_date":    latest_date.strftime("%Y-%m-%d") if latest_date else "N/A",
    }


# ---------------------------------------------------------------------------
# Public service class
# ---------------------------------------------------------------------------

class FaktorenService:
    """Service layer for the Faktoren (Factor Analysis) page."""

    @staticmethod
    def get_graphs_data(
        view: str = "U.S.",
        currency: str = "USD",
        lookback: str = "1Y",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> dict:
        """
        Return data for all 6 factor graphs for a given view / time window.

        Returns a dict with keys:
            status, view, currency, start_date, end_date, graphs
        where graphs maps g1..g6 to chart-data dicts.
        """
        try:
            if view not in VIEW_OPTIONS:
                return {
                    "status": "error",
                    "error": f"Unknown view '{view}'. Valid options: {VIEW_OPTIONS}",
                }

            # Resolve dates
            if start_date and end_date:
                sd, ed = start_date, end_date
            else:
                sd, ed = _compute_lookback_dates(lookback)

            # 1. Ticker master: ticker -> (db_region, factor_name)
            ticker_map = _load_factor_ticker_map()

            # 2. Determine which DB regions are needed for this view
            cfg_raw_regions: set = set()
            for gn in GRAPH_NAMES:
                for r in GRAPH_DICTIONARY[view][gn]["regions"]:
                    cfg_raw_regions.add(r)

            cfg_db_regions = {REGION_ALIAS.get(r, r) for r in cfg_raw_regions}

            # Keep only the tickers whose region is relevant
            needed_tickers = [
                t for t, (reg, _) in ticker_map.items() if reg in cfg_db_regions
            ]
            logger.info(
                "View=%s  regions=%s  tickers=%d",
                view, cfg_db_regions, len(needed_tickers),
            )

            # 3. Fetch prices from Bloomberg.
            # Fetch up to 14 calendar days BEFORE sd so that each series can
            # find its last available price on or before the anchor date (sd)
            # even when sd itself is a holiday or weekend.
            from datetime import date as _date_cls, timedelta as _td
            sd_date   = _date_cls.fromisoformat(sd)
            sd_buffer = (sd_date - _td(days=14)).isoformat()

            prices_df = _fetch_bloomberg_prices(needed_tickers, sd_buffer, ed, currency)

            # Fallback to USD when no EUR data is available
            if prices_df.empty and currency != "USD":
                logger.warning(
                    "No data returned for currency=%s; retrying with USD", currency
                )
                prices_df = _fetch_bloomberg_prices(needed_tickers, sd_buffer, ed, "USD")

            # 4. Build all 6 graphs, passing the original sd as display anchor
            graphs = {}
            for gn in GRAPH_NAMES:
                graphs[gn] = _build_graph_data(
                    prices_df, ticker_map, view, gn, display_start_date=sd
                )

            return {
                "status":     "ok",
                "view":       view,
                "currency":   currency,
                "start_date": sd,
                "end_date":   ed,
                "graphs":     graphs,
            }

        except Exception as e:
            logger.exception("FaktorenService.get_graphs_data failed")
            return {"status": "error", "error": str(e)}

    @staticmethod
    def get_available_views() -> list:
        return VIEW_OPTIONS
