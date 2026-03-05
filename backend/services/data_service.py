"""
Data Freshness Service

Checks freshness of all data sources and reports stale items.
Mirrors the health-check logic from the original Dash data_layout.py.

Database mapping (db_gateway):
  duoplus_engine  → ApoAsset_Quant   (performance, benchmark_, market_data, sector_pe_ratios)
  prod_engine     → Apoasset_Bloomberg (ReferenceDataHistoricalField, BloombergTicker)
  jm_engine       → ApoAsset_JM on apo-sql-dev (erp, alternative_data, ratings,
                                                  earnings_calendar, mm_calendar,
                                                  portfolio_attribution, top_bottom_performers)
"""

import re
import pandas as pd
from datetime import datetime
from utils.database import db_gateway


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _biz_days_old(latest_date: pd.Timestamp) -> int:
    """Return business-days between latest_date and today (approx)."""
    today = pd.Timestamp(datetime.now().date())
    total = (today - latest_date.normalize()).days
    return max(0, total - (total // 7) * 2)


def _fmt(dt) -> str:
    if dt is None or (isinstance(dt, float) and pd.isna(dt)):
        return "N/A"
    try:
        return pd.Timestamp(dt).strftime("%Y-%m-%d")
    except Exception:
        return "N/A"


# ─────────────────────────────────────────────────────────────────────────────
# Performance (portfolios, benchmarks, constituents) + Benchmark Weights
# ─────────────────────────────────────────────────────────────────────────────

def get_performance_freshness() -> dict:
    """
    Returns:
        {
          "header_status": "green"|"red",
          "latest_date": "YYYY-MM-DD",
          "stale_items": [{"id": "...", "latest_date": "...", "days_old": N}],
          "has_stale": bool
        }
    """
    try:
        engine = db_gateway.duoplus_engine
        df_perf = pd.read_sql("""
            SELECT ID, MAX(DATE) as latest_date,
                   DATEDIFF(day, MAX(DATE), CAST(GETDATE() AS DATE)) as days_old
            FROM [ApoAsset_Quant].[dbo].[performance]
            GROUP BY ID
        """, engine)

        df_mapping = pd.read_sql("""
            SELECT Portfolio, Benchmark_BB,
                   BConst_1, BConst_2, BConst_3, BConst_4, BConst_5
            FROM [ApoAsset_Quant].[dbo].[benchmark_mapping]
        """, engine)

        portfolio_ids = set(df_mapping['Portfolio'].dropna().unique())
        benchmark_ids = set(df_mapping['Benchmark_BB'].dropna().unique())
        constituent_ids = set()
        for col in ['BConst_1', 'BConst_2', 'BConst_3', 'BConst_4', 'BConst_5']:
            constituent_ids.update(df_mapping[col].dropna().unique())

        all_relevant = portfolio_ids | benchmark_ids | constituent_ids
        threshold = 1
        stale_items = []

        for _, row in df_perf.iterrows():
            if row['ID'] not in all_relevant:
                continue
            days_old = row['days_old']
            if days_old is None or pd.isna(days_old):
                continue
            if days_old > threshold:
                stale_items.append({
                    "id": row['ID'],
                    "latest_date": _fmt(row['latest_date']),
                    "days_old": int(days_old)
                })

        # Overall latest date across all relevant IDs
        relevant_perf = df_perf[df_perf['ID'].isin(all_relevant)]
        latest_date = "N/A"
        if not relevant_perf.empty:
            max_dt = relevant_perf['latest_date'].max()
            latest_date = _fmt(max_dt)

        has_stale = len(stale_items) > 0
        return {
            "header_status": "red" if has_stale else "green",
            "latest_date": latest_date,
            "stale_items": stale_items,
            "has_stale": has_stale
        }
    except Exception as e:
        return {"header_status": "green", "latest_date": "N/A",
                "stale_items": [], "has_stale": False, "error": str(e)}


def get_benchmark_weights_freshness() -> dict:
    try:
        engine = db_gateway.duoplus_engine
        df = pd.read_sql("""
            SELECT MAX(DATE) as latest_date,
                   DATEDIFF(day, MAX(DATE), CAST(GETDATE() AS DATE)) as days_old
            FROM [ApoAsset_Quant].[dbo].[benchmark_weights]
        """, engine)

        if df.empty or pd.isna(df['latest_date'].iloc[0]):
            return {"status": "red", "latest_date": "N/A", "stale": True}

        days_old = int(df['days_old'].iloc[0]) if pd.notna(df['days_old'].iloc[0]) else 999
        stale = days_old > 1
        return {
            "status": "red" if stale else "green",
            "latest_date": _fmt(df['latest_date'].iloc[0]),
            "stale": stale,
            "days_old": days_old
        }
    except Exception as e:
        return {"status": "green", "latest_date": "N/A", "stale": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Market Data JM
# ─────────────────────────────────────────────────────────────────────────────

# Securities with 40-calendar-day threshold instead of 1 business day
SPECIAL_40_DAY_SECURITIES = {
    'MPMICNCA Index','MPMICNMA Index','MPMICNSA Index',
    'MPMIDECA Index','MPMIDEMA Index','MPMIDESA Index',
    'MPMIESMA Index','MPMIESESA Index',
    'MPMIEUCA Index','MPMIEUMA Index','MPMIEUSA Index',
    'MPMIFRCA Index','MPMIFRMA Index','MPMIFRSA Index',
    'MPMIGBCA Index','MPMIGBMA Index','MPMIGBSA Index',
    'MPMINCA Index',
    'MPMITCA Index','MPMITMA Index','MPMITSA Index',
    'MPMUPCA Index','MPMUPMA Index','MPMUPSA Index',
    'MPMISCA Index','MPMISMA Index','MPMISSA Index',
    'MPMIESCA Index','MPMIEESA Index',
    'MPMIESSA Index','MPMIINCA Index','MPMIINMA Index','MPMIINSA Index',
    'MPMIITCA Index','MPMIITMA Index','MPMIITSA Index',
    'MPMIJPCA Index','MPMIJPMA Index','MPMIJPSA Index',
    'MPMIUSCA Index','MPMIUSMA Index','MPMIUSSA Index'
}


def get_market_data_jm_freshness() -> dict:
    try:
        engine = db_gateway.duoplus_engine
        df = pd.read_sql("""
            SELECT md.ID,
                   MAX(md.DatePoint) as latest_date,
                   DATEDIFF(day, MAX(md.DatePoint), CAST(GETDATE() AS DATE)) as calendar_days_old,
                   DATEDIFF(day, MAX(md.DatePoint), CAST(GETDATE() AS DATE)) -
                       (DATEDIFF(week, MAX(md.DatePoint), CAST(GETDATE() AS DATE)) * 2) as business_days_old
            FROM [ApoAsset_Quant].[dbo].[market_data] md
            INNER JOIN [ApoAsset_Quant].[dbo].[ticker_master] tm ON md.ID = tm.Ticker
            WHERE tm.Active = 1
            GROUP BY md.ID
        """, engine)

        stale_items = []
        for _, row in df.iterrows():
            id_val = row['ID']
            biz = row['business_days_old']
            cal = row['calendar_days_old']
            if pd.isna(biz):
                continue
            if id_val in SPECIAL_40_DAY_SECURITIES:
                if cal > 40:
                    stale_items.append({"id": id_val, "latest_date": _fmt(row['latest_date']),
                                        "days_old": int(cal), "threshold_type": "calendar_40days"})
            else:
                if biz > 1:
                    stale_items.append({"id": id_val, "latest_date": _fmt(row['latest_date']),
                                        "days_old": int(biz), "threshold_type": "business_1day"})

        # Overall latest date
        latest_date = "N/A"
        if not df.empty:
            max_dt = df['latest_date'].max()
            latest_date = _fmt(max_dt)

        has_stale = len(stale_items) > 0
        return {
            "header_status": "red" if has_stale else "green",
            "latest_date": latest_date,
            "stale_items": sorted(stale_items, key=lambda x: x['id']),
            "has_stale": has_stale
        }
    except Exception as e:
        return {"header_status": "green", "latest_date": "N/A",
                "stale_items": [], "has_stale": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Bloomberg Data
# ─────────────────────────────────────────────────────────────────────────────

BLOOMBERG_DISREGARD = {
    'NNDX Index','SPTR500N Index','GTDEM10Y Govt','GTDEM2Y Govt',
    'GTFRF10Y Govt','GTFRF2Y Govt','GTESP10Y Govt','GTESP2Y Govt',
    'GTJPY10Y Govt','GTJPY2Y Govt','GTITL10Y Govt','GTITL2Y Govt'
}

# Ticker → threshold in calendar days (subset; build from original mapping)
BLOOMBERG_SPECIAL_THRESHOLDS = {
    # 10 days
    **{k: 10 for k in [
        'AAIIBULL Index','CNDX LN Equity','EURGBP Curncy','EURJPY Curncy',
        'GUKG10 Index','GUKG2 Index','MSRYCH Index','MSRYDE Index','MSRYES Index',
        'MSRYEU Index','MSRYFR Index','MSRYIT Index','MSRYJP Index','MSRYUK Index',
        'MSRYUS Index','SPGGBE10 Index','SXRT GY Equity','XAG BGN Curncy','XAU BGN Curncy',
        'XDW0 GY Equity','XDWC GY Equity','XDWF GY Equity','XDWH GY Equity',
        'XDWI GY Equity','XDWM GY Equity','XDWS GY Equity','XDWT GY Equity',
        'XDWU GY Equity','XWTS GY Equity',
    ]},
    # 60 days (monthly)
    **{k: 60 for k in [
        'ECCPEST Index','OEUSLCAB Index','OEESLCAB Index','OEJPLCAB Index',
        'OEDELCAB Index','OEFRLCAB Index','OEITLCAB Index','OEGBLCAB Index',
        'EUCCEMU Index','OUTFGAF Index','RCHSINDX Index','CONSSENT Index',
        'SAARTOTL Index','EMPRGBCI Index','INJCJC Index','ITCPNICY Index',
        'GRCP2HYY Index','FRCPEECY Index','SPIPCYOY Index','BOJDTR Index',
        'EUORDEPO Index','FDTR Index','UKBRBASE Index','EPUCCEUM Index',
        'GRUEPR Index','NFP TCH Index','NFP PCH Index','USMMMNCH Index','USURTOT Index',
    ]},
    # 150 days (quarterly)
    **{k: 150 for k in [
        'ECOYMUSS Index','ECOYMESN Index','ECOYMJPN Index','ECOYMDEN Index',
        'ECOYMFRS Index','ECOYMITN Index','ECOYMUKS Index','ECOYMEUN Index',
        'EUIPEMUY Index','EHBBGB Index','EHBBEU Index','EHBBUS Index',
        'EHBBDE Index','EHBBES Index','EHBBIT Index','EHBBIN Index','EHBBFR Index',
        'EUGNEMUQ Index','GDP CYOY Index',
    ]},
    # 380 days (yearly)
    **{k: 380 for k in [
        'IDHREURO Index','IDH%FRA Index','IDH%DEU Index','IDH%ITA Index',
        'IDH%GBR Index','IDH%JPN Index','IDH%ESP Index','IDH%USA Index',
        'IGS%CHN Index','IGS%IND Index',
    ]},
}

FUTURES_PATTERN = re.compile(r'^(US0ANM|EZ0BNM|GB0BNM|JP0BNM)\s+\w+\d{4}\s+Index$')


def get_bloomberg_data_freshness() -> dict:
    try:
        engine = db_gateway.prod_engine
        df = pd.read_sql("""
            SELECT b.Id, b.BloombergTicker, r.FieldName,
                   MAX(r.DatePoint) as latest_date,
                   DATEDIFF(day, MAX(r.DatePoint), CAST(GETDATE() AS DATE)) as calendar_days_old,
                   DATEDIFF(day, MAX(r.DatePoint), CAST(GETDATE() AS DATE)) -
                       (DATEDIFF(week, MAX(r.DatePoint), CAST(GETDATE() AS DATE)) * 2) as business_days_old
            FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] r
            INNER JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] b ON r.BloombergTickerId = b.Id
            GROUP BY b.Id, b.BloombergTicker, r.FieldName
        """, engine)

        stale_items = []
        for _, row in df.iterrows():
            ticker = row['BloombergTicker']
            biz = row['business_days_old']
            cal = row['calendar_days_old']
            if pd.isna(biz):
                continue
            if ticker in BLOOMBERG_DISREGARD:
                continue
            if FUTURES_PATTERN.match(ticker):
                continue
            if ticker in BLOOMBERG_SPECIAL_THRESHOLDS:
                threshold = BLOOMBERG_SPECIAL_THRESHOLDS[ticker]
                if cal > threshold:
                    stale_items.append({
                        "ticker": ticker,
                        "field": row['FieldName'],
                        "latest_date": _fmt(row['latest_date']),
                        "days_old": int(cal),
                        "threshold_type": f"calendar_{threshold}days"
                    })
            else:
                if biz > 1:
                    stale_items.append({
                        "ticker": ticker,
                        "field": row['FieldName'],
                        "latest_date": _fmt(row['latest_date']),
                        "days_old": int(biz),
                        "threshold_type": "business_1day"
                    })

        latest_date = "N/A"
        if not df.empty:
            max_dt = df['latest_date'].max()
            latest_date = _fmt(max_dt)

        has_stale = len(stale_items) > 0
        return {
            "header_status": "red" if has_stale else "green",
            "latest_date": latest_date,
            "stale_items": sorted(stale_items, key=lambda x: (x['ticker'], x['field'])),
            "has_stale": has_stale
        }
    except Exception as e:
        return {"header_status": "green", "latest_date": "N/A",
                "stale_items": [], "has_stale": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Data Pipe (ERP, Alternative Data, Ratings, Earnings Calendar, MM Calendar)
# ─────────────────────────────────────────────────────────────────────────────

def _jm_single_date_check(query: str, threshold_biz_days: int, name: str) -> dict:
    """Helper: run a MAX(date) query on jm_engine, flag if older than threshold."""
    try:
        engine = db_gateway.jm_engine
        df = pd.read_sql(query, engine)
        if df.empty or pd.isna(df.iloc[0, 0]):
            return {"name": name, "status": "red", "latest_date": "N/A", "days_old": 999}
        latest = pd.Timestamp(df.iloc[0, 0])
        biz = _biz_days_old(latest)
        stale = biz > threshold_biz_days
        return {"name": name, "status": "red" if stale else "green",
                "latest_date": _fmt(latest), "days_old": biz}
    except Exception as e:
        return {"name": name, "status": "green", "latest_date": "N/A",
                "days_old": 0, "error": str(e)}


def get_data_pipe_freshness() -> dict:
    """
    Combines: ERP, Alternative Data (per source), Ratings, Earnings Calendar, MM Calendar.
    Returns a dict with all items and a summary status.
    """
    items = []

    # ERP
    erp = _jm_single_date_check(
        "SELECT MAX(CONVERT(DATE, Date, 1)) as latest_date FROM [ApoAsset_JM].[dbo].[erp]",
        0, "ERP"
    )
    items.append(erp)

    # Alternative Data
    try:
        engine = db_gateway.jm_engine
        df_alt = pd.read_sql("""
            SELECT source, frequency, MAX(date) as latest_date
            FROM [ApoAsset_JM].[dbo].[alternative_data]
            GROUP BY source, frequency
        """, engine)

        threshold_map = {
            'daily':     {'days': 5, 'biz': True},
            'weekly':    {'days': 15, 'biz': False},
            'monthly':   {'days': 50, 'biz': False},
            'quarterly': {'days': 140, 'biz': False},
            'yearly':    {'days': 380, 'biz': False},
        }
        today = pd.Timestamp(datetime.now().date())
        for _, row in df_alt.iterrows():
            source = row['source']
            freq = str(row['frequency']).lower().strip() if pd.notna(row['frequency']) else 'unknown'
            latest = pd.Timestamp(row['latest_date'])
            if pd.isna(latest):
                continue
            tinfo = threshold_map.get(freq, {'days': 999, 'biz': False})
            if tinfo['biz']:
                days_old = _biz_days_old(latest)
            else:
                days_old = (today - latest.normalize()).days
            stale = days_old > tinfo['days']
            if stale:
                items.append({
                    "name": f"{source} ({freq})",
                    "status": "red",
                    "latest_date": _fmt(latest),
                    "days_old": days_old
                })
    except Exception:
        pass

    # Ratings
    items.append(_jm_single_date_check(
        "SELECT MAX(CAST(DatePoint AS DATE)) as latest_date FROM [ApoAsset_JM].[dbo].[ratings]",
        0, "Ratings"
    ))

    # Earnings Calendar
    items.append(_jm_single_date_check(
        "SELECT MAX(insertdate) as latest_date FROM [ApoAsset_JM].[dbo].[earnings_calendar]",
        0, "Earnings Calendar"
    ))

    # MM Calendar
    items.append(_jm_single_date_check(
        "SELECT MAX(insert_date) as latest_date FROM [ApoAsset_JM].[dbo].[mm_calendar]",
        0, "MM Calendar"
    ))

    # Summary
    all_dates = [i['latest_date'] for i in items if i['latest_date'] != "N/A"]
    latest_date = max(all_dates) if all_dates else "N/A"
    has_stale = any(i['status'] == 'red' for i in items)
    stale_items = [i for i in items if i['status'] == 'red']

    return {
        "header_status": "red" if has_stale else "green",
        "latest_date": latest_date,
        "all_items": items,
        "stale_items": stale_items,
        "has_stale": has_stale
    }


# ─────────────────────────────────────────────────────────────────────────────
# Sector PE Ratios
# ─────────────────────────────────────────────────────────────────────────────

def get_sector_pe_ratios_freshness() -> dict:
    try:
        engine = db_gateway.duoplus_engine
        df = pd.read_sql("""
            SELECT [Index Name], MAX(CAST([Date] AS DATE)) as latest_date,
                   DATEDIFF(day, MAX(CAST([Date] AS DATE)), CAST(GETDATE() AS DATE)) as days_old
            FROM [ApoAsset_Quant].[dbo].[sector_pe_ratios]
            GROUP BY [Index Name]
        """, engine)

        stale_items = []
        for _, row in df.iterrows():
            days_old = row['days_old']
            if pd.isna(days_old):
                continue
            if days_old > 0:
                stale_items.append({
                    "index_name": row['Index Name'],
                    "latest_date": _fmt(row['latest_date']),
                    "days_old": int(days_old)
                })

        latest_date = "N/A"
        if not df.empty:
            max_dt = df['latest_date'].max()
            latest_date = _fmt(max_dt)

        has_stale = len(stale_items) > 0
        return {
            "header_status": "red" if has_stale else "green",
            "latest_date": latest_date,
            "stale_items": sorted(stale_items, key=lambda x: x['index_name']),
            "has_stale": has_stale
        }
    except Exception as e:
        return {"header_status": "green", "latest_date": "N/A",
                "stale_items": [], "has_stale": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Port (Portfolio Attribution + Top Bottom Performers)
# ─────────────────────────────────────────────────────────────────────────────

def get_port_freshness() -> dict:
    items = []

    # Portfolio Attribution
    try:
        engine = db_gateway.jm_engine
        df_port = pd.read_sql("""
            SELECT portfolio_name, MAX(RunDate) as latest_rundate
            FROM [ApoAsset_JM].[dbo].[portfolio_attribution]
            GROUP BY portfolio_name
            ORDER BY portfolio_name
        """, engine)

        today = pd.Timestamp(datetime.now().date())
        for _, row in df_port.iterrows():
            latest = pd.Timestamp(row['latest_rundate'])
            if pd.isna(latest):
                continue
            biz = _biz_days_old(latest)
            if biz > 1:
                items.append({
                    "name": f"Portfolio Attribution – {row['portfolio_name']}",
                    "status": "red",
                    "latest_date": _fmt(latest),
                    "days_old": biz
                })
    except Exception:
        pass

    # Top Bottom Performers
    tbp = _jm_single_date_check(
        "SELECT MAX(CAST(DatePoint AS DATE)) as latest_date FROM [ApoAsset_JM].[dbo].[top_bottom_performers]",
        1, "Top Bottom Performers"
    )
    if tbp['status'] == 'red':
        items.append(tbp)

    # Top Bottom Performers Email
    tbpe = _jm_single_date_check(
        "SELECT MAX(CAST(insert_date AS DATE)) as latest_date FROM [ApoAsset_JM].[dbo].[top_bottom_performers_email]",
        1, "Top Bottom Performers Email"
    )
    if tbpe['status'] == 'red':
        items.append(tbpe)

    all_dates = [i['latest_date'] for i in [tbp, tbpe] if i['latest_date'] != "N/A"]
    latest_date = max(all_dates) if all_dates else "N/A"
    has_stale = len(items) > 0

    return {
        "header_status": "red" if has_stale else "green",
        "latest_date": latest_date,
        "stale_items": items,
        "has_stale": has_stale
    }


# ─────────────────────────────────────────────────────────────────────────────
# Top-level aggregator
# ─────────────────────────────────────────────────────────────────────────────

def get_all_freshness() -> dict:
    """
    Run all freshness checks and return a single response dict.
    The response is sorted: sections with red status first.
    """
    performance = get_performance_freshness()
    bw = get_benchmark_weights_freshness()
    market_data = get_market_data_jm_freshness()
    bloomberg = get_bloomberg_data_freshness()
    data_pipe = get_data_pipe_freshness()
    sector_pe = get_sector_pe_ratios_freshness()
    port = get_port_freshness()

    any_alerts = any([
        performance.get('has_stale', False),
        bw.get('stale', False),
        market_data.get('has_stale', False),
        bloomberg.get('has_stale', False),
        data_pipe.get('has_stale', False),
        sector_pe.get('has_stale', False),
        port.get('has_stale', False),
    ])

    return {
        "has_any_alerts": any_alerts,
        "last_checked": datetime.now().isoformat(),
        "performance": performance,
        "benchmark_weights": bw,
        "market_data_jm": market_data,
        "bloomberg": bloomberg,
        "data_pipe": data_pipe,
        "sector_pe_ratios": sector_pe,
        "port": port,
    }
