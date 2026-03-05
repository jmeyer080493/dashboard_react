"""
Alternativ (Konsum USA / Consumer Activity) page data service

Pulls US consumer/entertainment activity data from SQL:
  Table:  [ApoAsset_JM].[dbo].[alternative_data]  on  apo-sql-dev

Six graphs (mirrors the "Alternativ" tab in the reference Dash project):
  g1 – TSA Reisende                       (tsa, 12-month rolling sum)
  g2 – Kinokartenverkäufe USA             (movies, 365-day rolling sum)
  g3 – Tägliche Restaurantreservierungen  (open_table daily, 365-day rolling mean → United States)
  g4 – Monatliche Restaurantreservierungen(open_table monthly, 12-month rolling mean → United States)
  g5 – Broadway Bruttoverkäufe            (broadway Gross, 52-week rolling sum → Total Gross)
  g6 – Broadway Besucherzahlen            (broadway Capacity, 52-week rolling mean → Capacity)

Return format (identical to FaktorenService):
  {
    "status": "ok",
    "graphs": {
      "g1": {
        "title": "...",
        "data":  [{"DatePoint": "YYYY-MM-DD", "<series>": <float>}, ...],
        "series": ["<series>"],
        "has_difference": false,
        "latest_date": "YYYY-MM-DD",
        "yaxis": "...",
        "source": "...",
      },
      ...
    }
  }
"""

import pandas as pd
import numpy as np
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Graph metadata
# ---------------------------------------------------------------------------
GRAPH_META = {
    "g1": {
        "title":    "TSA Reisende (12 Monate rollierend)",
        "title_pp": "TSA Reisende",
        "yaxis":    "Total",
        "source":   "U.S. Transportation Security Administration",
    },
    "g2": {
        "title":    "Kinokartenverkäufe USA (12 Monate rollierend)",
        "title_pp": "Kinokartenverkäufe USA",
        "yaxis":    "Total",
        "source":   "https://www.boxofficemojo.com",
    },
    "g3": {
        "title":    "Tägliche Restaurantreservierungen (12 Monate rollierend)",
        "title_pp": "Restaurantreservierungen täglich",
        "yaxis":    "Prozent",
        "source":   "https://www.opentable.com",
    },
    "g4": {
        "title":    "Monatliche Restaurantreservierungen (12 Monate rollierend)",
        "title_pp": "Restaurantreservierungen monatlich",
        "yaxis":    "Prozent",
        "source":   "https://www.opentable.com",
    },
    "g5": {
        "title":    "Broadway Bruttoverkäufe (12 Monate rollierend)",
        "title_pp": "Broadway Bruttoverkäufe",
        "yaxis":    "Total",
        "source":   "https://www.ibdb.com",
    },
    "g6": {
        "title":    "Broadway Besucherzahlen (12 Monate rollierend)",
        "title_pp": "Broadway Besucherzahlen",
        "yaxis":    "Prozent",
        "source":   "https://www.ibdb.com",
    },
}


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------
def _compute_lookback_dates(lookback: str) -> tuple[str, str]:
    today = datetime.today()
    end = today.strftime("%Y-%m-%d")
    if lookback == "MtD":
        start = today.replace(day=1).strftime("%Y-%m-%d")
    elif lookback == "YtD":
        start = f"{today.year - 1}-12-31"
    elif lookback.endswith("Y"):
        years = int(lookback[:-1])
        start = (today - timedelta(days=years * 365)).strftime("%Y-%m-%d")
    else:
        start = "1900-01-01"
    return start, end


def _filter_by_date(df: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    """Filter a DataFrame whose index is date strings by the provided range."""
    try:
        idx_dt = pd.to_datetime(df.index, errors="coerce")
        sd = pd.to_datetime(start_date)
        ed = pd.to_datetime(end_date)
        mask = (idx_dt >= sd) & (idx_dt <= ed)
        return df[mask]
    except Exception as e:
        logger.warning(f"Date filter failed: {e}")
        return df


def _df_to_rows(df: pd.DataFrame) -> list[dict]:
    """Convert a filtered DataFrame (date-indexed) to wide-format row dicts."""
    rows = []
    for date_str, row in df.iterrows():
        entry: dict = {"DatePoint": str(date_str)[:10]}
        for col in df.columns:
            val = row[col]
            if pd.isna(val):
                entry[col] = None
            else:
                try:
                    entry[col] = round(float(val), 4)
                except (TypeError, ValueError):
                    entry[col] = None
        rows.append(entry)
    return rows


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def _get_engine():
    """Return the JM database engine (ApoAsset_JM on apo-sql-dev)."""
    from utils.database import DatabaseGateway
    return DatabaseGateway().get_jm_engine()


def _fetch_alternative_data() -> pd.DataFrame:
    """
    Fetch all non-footprint rows from the alternative_data table.
    Mirrors:  SELECT * FROM alternative_data WHERE source != 'footprint'
    """
    engine = _get_engine()
    query = "SELECT * FROM alternative_data WHERE source != 'footprint'"
    df = pd.read_sql_query(query, engine)
    logger.info(f"✓ Fetched {len(df)} rows from alternative_data")
    return df


# ---------------------------------------------------------------------------
# Per-graph processing helpers
# ---------------------------------------------------------------------------

def _clean_numeric(series: pd.Series) -> pd.Series:
    """Strip currency symbols / commas / percent signs and return float series."""
    try:
        return pd.to_numeric(
            series.astype(str)
                  .str.replace(r"[$,%]", "", regex=True)
                  .str.replace(",", "", regex=False),
            errors="coerce",
        )
    except Exception:
        return pd.to_numeric(series, errors="coerce")


def _build_tsa(alt: pd.DataFrame, sd: str, ed: str) -> dict:
    """g1 – TSA Reisende (monthly, 12-month rolling sum)."""
    sub = alt[(alt["source"] == "tsa") & (alt["data_field"] == "tsa_travellers")].copy()
    if sub.empty:
        return _empty_graph("g1")

    sub = sub.set_index("date").sort_index()
    sub["data_value"] = _clean_numeric(sub["data_value"])
    df = sub[["data_value"]].rolling(12).sum().dropna()
    df.columns = ["TSA Reisende"]
    df = _filter_by_date(df, sd, ed)

    return _build_result("g1", df, ["TSA Reisende"])


def _build_movies(alt: pd.DataFrame, sd: str, ed: str) -> dict:
    """g2 – Kinokartenverkäufe USA (daily, 365-day rolling sum)."""
    sub = alt[(alt["source"] == "movies") & (alt["data_field"] == "Total_Gross")].copy()
    if sub.empty:
        return _empty_graph("g2")

    sub = sub.set_index("date").sort_index()
    sub["data_value"] = _clean_numeric(sub["data_value"])
    df = sub[["data_value"]].rolling(365).sum().dropna()
    df.columns = ["Kinokartenverkäufe"]
    df = _filter_by_date(df, sd, ed)

    return _build_result("g2", df, ["Kinokartenverkäufe"])


def _build_opentable(alt: pd.DataFrame, sd: str, ed: str, freq: str, graph_key: str) -> dict:
    """g3/g4 – OpenTable restaurant reservations (daily or monthly)."""
    sub = alt[
        (alt["source"] == "open_table") &
        (alt["data_field"] == "dinner_reservations") &
        (alt["frequency"] == freq) &
        (alt["country_region"] == "United States")
    ].copy()
    if sub.empty:
        return _empty_graph(graph_key)

    sub = sub.reset_index(drop=True)
    sub = sub.pivot(index="date", columns="country_region", values="data_value")
    sub = sub.sort_index()
    for col in sub.columns:
        sub[col] = _clean_numeric(sub[col])

    window = 365 if freq == "daily" else 12
    df = sub.rolling(window).mean().dropna()
    df = _filter_by_date(df, sd, ed)

    series = list(df.columns)
    return _build_result(graph_key, df, series)


def _build_broadway_gross(alt: pd.DataFrame, sd: str, ed: str) -> dict:
    """g5 – Broadway Bruttoverkäufe (weekly, 52-week rolling sum)."""
    sub = alt[(alt["source"] == "broadway") & (alt["data_field"] == "Gross")].copy()
    if sub.empty:
        return _empty_graph("g5")

    sub = sub.set_index("date").sort_index()
    sub["Total Gross"] = _clean_numeric(sub["data_value"])
    df = sub[["Total Gross"]].rolling(52).sum().dropna()
    df = _filter_by_date(df, sd, ed)

    return _build_result("g5", df, ["Total Gross"])


def _build_broadway_attendance(alt: pd.DataFrame, sd: str, ed: str) -> dict:
    """g6 – Broadway Besucherzahlen (weekly, 52-week rolling mean)."""
    sub = alt[(alt["source"] == "broadway") & (alt["data_field"] == "Capacity")].copy()
    if sub.empty:
        return _empty_graph("g6")

    sub = sub.set_index("date").sort_index()
    sub["Capacity"] = _clean_numeric(sub["data_value"])
    df = sub[["Capacity"]].rolling(52).mean().dropna()
    df = _filter_by_date(df, sd, ed)

    return _build_result("g6", df, ["Capacity"])


# ---------------------------------------------------------------------------
# Result builders
# ---------------------------------------------------------------------------

def _build_result(graph_key: str, df: pd.DataFrame, series: list[str]) -> dict:
    """Pack a processed DataFrame into the standard graph result dict."""
    meta = GRAPH_META[graph_key]
    rows = _df_to_rows(df)
    latest = str(df.index[-1])[:10] if len(df) > 0 else "N/A"
    return {
        "title":          meta["title"],
        "title_pp":       meta["title_pp"],
        "yaxis":          meta["yaxis"],
        "source":         meta["source"],
        "data":           rows,
        "series":         series,
        "has_difference": False,
        "latest_date":    latest,
    }


def _empty_graph(graph_key: str) -> dict:
    """Return an empty graph placeholder when data is unavailable."""
    meta = GRAPH_META[graph_key]
    return {
        "title":          meta["title"],
        "title_pp":       meta["title_pp"],
        "yaxis":          meta["yaxis"],
        "source":         meta["source"],
        "data":           [],
        "series":         [],
        "has_difference": False,
        "latest_date":    "N/A",
    }


# ---------------------------------------------------------------------------
# Public service class
# ---------------------------------------------------------------------------

class AlternativService:
    """Service layer for the Alternativ (Konsum USA) page."""

    @staticmethod
    def get_graphs_data(
        lookback: str = "1Y",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> dict:
        """
        Return data for all 6 consumer-activity graphs.

        Returns:
            {
              "status":     "ok" | "error",
              "start_date": str,
              "end_date":   str,
              "graphs": { "g1": {...}, …, "g6": {...} }
            }
        """
        try:
            # Resolve date range
            if start_date and end_date:
                sd, ed = start_date, end_date
            else:
                sd, ed = _compute_lookback_dates(lookback)

            # Fetch raw data once
            alt = _fetch_alternative_data()

            # Normalise date column
            alt["date"] = pd.to_datetime(alt["date"], errors="coerce").dt.strftime("%Y-%m-%d")
            alt = alt.dropna(subset=["date"])

            # Build all 6 graphs
            graphs = {
                "g1": _build_tsa(alt, sd, ed),
                "g2": _build_movies(alt, sd, ed),
                "g3": _build_opentable(alt, sd, ed, freq="daily",   graph_key="g3"),
                "g4": _build_opentable(alt, sd, ed, freq="monthly",  graph_key="g4"),
                "g5": _build_broadway_gross(alt, sd, ed),
                "g6": _build_broadway_attendance(alt, sd, ed),
            }

            return {
                "status":     "ok",
                "start_date": sd,
                "end_date":   ed,
                "graphs":     graphs,
            }

        except Exception as e:
            logger.exception("AlternativService.get_graphs_data failed")
            return {"status": "error", "error": str(e)}
