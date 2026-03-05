"""
User tab (Nordrhein) data service.

Mirrors the data retrieval logic from C:/Projekte/dashboard:
  - user/nordrhein.py  (chart, table, alert logic)
  - data/get_data.py   (SQL queries: get_sxrt_benchmark_data,
                        get_stoxx_updates, get_xesc_date,
                        get_stoxx50_performance_data, prepare_stoxx50_chart_data)

All data comes from SQL (AMS, ApoAsset_Common, ApoAsset_Quant).
Factsheet-PDF and signal-file reading are optional and fail gracefully.
"""

import os
import re
import glob
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Suppress verbose pdfminer debug output
logging.getLogger('pdfminer').setLevel(logging.WARNING)

from utils.database import DatabaseGateway

# ---------------------------------------------------------------------------
# Ticker-adjustment helpers  (identical to nordrhein.py)
# ---------------------------------------------------------------------------
_REPLACEMENTS = {
    'RACE US Equity': 'RACE IM Equity',
    'NDA SS Equity':  'NDA FH Equity',
    'STLA US Equity': 'STLAM IM Equity',
}

_RATINGS_RANKED = [
    'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-',
    'BBB+', 'BBB', 'BBB-',       # BBB- is minimum threshold
    'BB+', 'BB', 'BB-', 'B+', 'B', 'B-',
    'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D',
]

_STOXX_ANNOUNCEMENT_THRESHOLD_DAYS = 5
_FACTSHEET_MAX_AGE_DAYS = 70
_BENCHMARK_MAX_AGE_DAYS = 3


def _is_rating(tok: str) -> bool:
    return bool(re.fullmatch(
        r'(AAA|AA\+|AA|AA-|A\+|A|A-|BBB\+|BBB|BBB-|BB\+|BB|BB-|B\+|B|B-|CCC\+|CCC|CCC-|CC|C|D)',
        tok.strip().upper()))


def _is_rating_poor(rating: Optional[str]) -> bool:
    if not rating:
        return False
    r = rating.upper().strip()
    if r not in _RATINGS_RANKED:
        return False
    return _RATINGS_RANKED.index(r) >= _RATINGS_RANKED.index('BBB-')


def _adjust_ticker(ticker: str) -> str:
    """Apply the same ticker-normalisation used in the original nordrhein.py."""
    a = ticker.replace('GR Equity', 'GY Equity').replace('SM Equity', 'SQ Equity')
    return _REPLACEMENTS.get(a, a)


# ---------------------------------------------------------------------------
# Optional: factsheet PDF rating extraction
# ---------------------------------------------------------------------------
def _get_latest_factsheet_pdf(base_path: str):
    """Return (pdf_path, date_str 'DD-MM-YYYY') or raise FileNotFoundError."""
    pattern = os.path.join(base_path, '*Professional_Audience_English*.pdf')
    files = glob.glob(pattern)
    if not files:
        raise FileNotFoundError(f'No factsheet PDFs found in {base_path}')
    dated = []
    for f in files:
        m = re.search(r'Professional_Audience_English_(\d{2}-\d{2}-\d{4})', os.path.basename(f))
        if m:
            try:
                d = datetime.strptime(m.group(1), '%d-%m-%Y')
                dated.append((f, d, m.group(1)))
            except ValueError:
                pass
    if not dated:
        raise FileNotFoundError('No valid factsheet PDFs found')
    latest = max(dated, key=lambda x: x[1])
    return latest[0], latest[2]


def _clean_text(s: str) -> str:
    s = s.replace('\u00ad', '')
    return re.sub(r'[ \t]+', ' ', s).strip()


def _extract_average_rating(pdf_path: str) -> Optional[str]:
    """Extract fund Average Rating from PDF; return None on any failure."""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ''
                t = _clean_text(text)
                if 'average rating' not in t.lower():
                    continue
                lines = [_clean_text(ln) for ln in text.split('\n') if _clean_text(ln)]
                for ln in lines:
                    if 'average rating' in ln.lower():
                        ln2 = re.sub(r'\baverage rating\b', '', ln, flags=re.IGNORECASE)
                        ln2 = re.sub(r'\baverage rating\s*\d+\b', '', ln2, flags=re.IGNORECASE)
                        ln2 = ln2.replace('–', '-').replace('—', '-')
                        tokens = [x for x in re.split(r'[\s,;/|]+', ln2) if x]
                        ratings = [tok.upper() for tok in tokens if _is_rating(tok)]
                        if len(ratings) >= 2:
                            return ratings[0]
                # Fallback window search
                t2 = t.replace('–', '-').replace('—', '-')
                m = re.search(r'average rating(?:\s*\d+)?\s+(.{0,80})', t2, flags=re.IGNORECASE)
                if m:
                    tokens = [x for x in re.split(r'[\s,;/|]+', m.group(1)) if x]
                    ratings = [tok.upper() for tok in tokens if _is_rating(tok)]
                    if len(ratings) >= 2:
                        return ratings[0]
    except Exception as e:
        logger.warning(f'PDF rating extraction failed: {e}')
    return None


# ---------------------------------------------------------------------------
# Optional: Top Picks signal file
# ---------------------------------------------------------------------------
def _get_top_picks_tickers(
    signal_base_path: str = r'M:\Multi Asset Mgmt\Quant\Scoring_New\Signal',
) -> List[str]:
    """Return list of adjusted Top Picks tickers, or [] on any failure."""
    try:
        pattern = os.path.join(signal_base_path, '5_Faktoren_Signal_neu_*.xlsx')
        files = glob.glob(pattern)
        if not files:
            return []
        latest = max(files, key=os.path.getmtime)
        df = pd.read_excel(latest, sheet_name='Top Picks', header=4)
        if 'Ticker' not in df.columns:
            return []
        raw = df['Ticker'].dropna().astype(str).str.strip().tolist()
        return [_adjust_ticker(t) for t in raw]
    except Exception as e:
        logger.warning(f'Top Picks signal file reading failed: {e}')
        return []


# ---------------------------------------------------------------------------
# Period → start-date helper
# ---------------------------------------------------------------------------
def _period_start(period: str) -> Optional[pd.Timestamp]:
    today = pd.Timestamp.now()
    if period == 'MtD':
        return today.replace(day=1)
    elif period == 'YtD':
        return today.replace(month=1, day=1)
    elif period == '1Y':
        return today - pd.Timedelta(days=365)
    elif period == 'All':
        return None
    return today - pd.Timedelta(days=365)


# ---------------------------------------------------------------------------
# Main service class
# ---------------------------------------------------------------------------
class UserService:
    """
    Provides all data needed by the User (Nordrhein) tab.
    """

    # ── Internal SQL helpers ────────────────────────────────────────────────

    @staticmethod
    def _get_holdings(db: DatabaseGateway) -> pd.DataFrame:
        """
        Load current holdings for 'LBBW AM-Nord IA' from the AMS database.
        Uses a CTE instead of temp tables for compatibility with pd.read_sql_query.
        Returns columns: name, Asset Type, bb_code, Weight.
        """
        query = """
            WITH LatestPrices AS (
                SELECT
                    ParentId,
                    PxLast,
                    ValidFrom,
                    ROW_NUMBER() OVER (PARTITION BY ParentId ORDER BY ValidFrom DESC) AS rn
                FROM [dbo].[Prices]
                WHERE ValidFrom >= DATEADD(DAY, -5, GETDATE())
                  AND ParentId IS NOT NULL
            ),
            LatestKvgDate AS (
                SELECT MIN(MaxDate) AS KvgDate
                FROM (
                    SELECT sta.SegmentId, MAX(sta.KvgQuantityDate) AS MaxDate
                    FROM [dbo].[SegmentTradableAssets] AS sta
                    JOIN [dbo].[Segments]   AS s ON sta.SegmentId = s.Id
                    JOIN [dbo].[Portfolios] AS p ON s.PortfolioId = p.Id
                    WHERE p.Name = 'LBBW AM-Nord IA'
                      AND p.ParentId IS NULL
                      AND s.ParentId IS NULL
                    GROUP BY sta.SegmentId
                ) sub
            )
            SELECT
                g.Name                                                         AS portfolio,
                e.SecurityName                                                 AS name,
                e.BloombergAssetType                                           AS [Asset Type],
                e.BloombergCode                                                AS bb_code,
                d.KvgQuantity                                                  AS kvg_qty,
                d.Quantity                                                     AS qty,
                h.Name                                                         AS curr,
                i.ISO                                                          AS Country,
                j.Level1                                                       AS Sector,
                e.Denomination                                                 AS unit,
                CASE WHEN e.BloombergAssetType = 'FixedIncome'
                     THEN lp.PxLast / 100
                     ELSE lp.PxLast END                                        AS ams_price,
                NULL                                                           AS fx_rate
            FROM [dbo].[SegmentTradableAssets] AS d
            JOIN [dbo].[TradableAssets]         AS e  ON d.TradableAssetId = e.Id
            JOIN [dbo].[Segments]               AS f  ON d.SegmentId       = f.Id
            JOIN [dbo].[Portfolios]             AS g  ON f.PortfolioId     = g.Id
            LEFT JOIN [dbo].[Currencies]        AS h  ON e.CurrencyId      = h.Id
            LEFT JOIN [dbo].[Countries]         AS i  ON e.CountryId       = i.Id
            LEFT JOIN [dbo].[ClassificationElements] AS j ON e.GicsId      = j.Id
            LEFT JOIN LatestPrices                    AS lp ON lp.ParentId = e.PriceId
                                                           AND lp.rn = 1
            CROSS JOIN LatestKvgDate lkd
            WHERE g.Name = 'LBBW AM-Nord IA'
              AND d.KvgQuantityDate = lkd.KvgDate
        """
        try:
            df = pd.read_sql_query(query, db.get_ams_holdings_engine())
            return df
        except Exception as e:
            logger.error(f'Holdings query failed: {e}')
            return pd.DataFrame(columns=['portfolio', 'name', 'Asset Type', 'bb_code',
                                         'kvg_qty', 'qty', 'curr', 'Country',
                                         'Sector', 'unit', 'ams_price', 'fx_rate'])

    @staticmethod
    def _get_sxrt_benchmark(db: DatabaseGateway) -> pd.DataFrame:
        """
        Get latest SXRT GY Equity benchmark weights from ApoAsset_Quant.
        """
        query = """
            SELECT
                ID,
                WEIGHTS AS Weight,
                benchmark AS [Index]
            FROM benchmark_weights
            WHERE benchmark = 'SXRT GY Equity'
              AND DATE = (
                    SELECT MAX(DATE)
                    FROM benchmark_weights
                    WHERE benchmark = 'SXRT GY Equity'
                  )
        """
        try:
            return pd.read_sql_query(query, db.get_duoplus_engine())
        except Exception as e:
            logger.error(f'SXRT benchmark query failed: {e}')
            return pd.DataFrame(columns=['ID', 'Weight', 'Index'])

    @staticmethod
    def _get_stoxx_announcements(db: DatabaseGateway) -> pd.DataFrame:
        """Get STOXX announcements from ApoAsset_Common."""
        query = "SELECT * FROM stoxx_announcements ORDER BY Date DESC"
        try:
            return pd.read_sql_query(query, db.get_jm_engine())
        except Exception as e:
            logger.error(f'STOXX announcements query failed: {e}')
            return pd.DataFrame()

    @staticmethod
    def _get_xesc_date(db: DatabaseGateway) -> str:
        """Get latest XESC GY Equity benchmark date from ApoAsset_JM."""
        query = """
            SELECT MAX(Date) AS [Date]
            FROM benchmark_weights
            WHERE [Index] = 'XESC GY Equity'
        """
        try:
            df = pd.read_sql_query(query, db.get_jm_engine())
            v = df['Date'].values[0] if not df.empty else None
            return str(v)[:10] if v is not None else 'N/A'
        except Exception as e:
            logger.error(f'XESC date query failed: {e}')
            return 'N/A'

    @staticmethod
    def _get_latest_benchmark_date(db: DatabaseGateway) -> str:
        """Get date of most recent SXRT benchmark data."""
        query = """
            SELECT MAX(DATE) AS LatestDate
            FROM benchmark_weights
            WHERE benchmark = 'SXRT GY Equity'
        """
        try:
            df = pd.read_sql_query(query, db.get_duoplus_engine())
            v = df['LatestDate'].iloc[0] if not df.empty else None
            return str(v)[:10] if v is not None else 'N/A'
        except Exception as e:
            logger.error(f'Latest benchmark date query failed: {e}')
            return 'N/A'

    @staticmethod
    def _get_performance_data(db: DatabaseGateway) -> pd.DataFrame:
        """
        Get daily returns for .SCORINGEU Index (portfolio) and SX5T Index (benchmark)
        from ApoAsset_Quant.dbo.performance.
        """
        query = """
            SELECT ID, DATE, Returns
            FROM performance
            WHERE ID IN ('.SCORINGEU Index', 'SX5T Index')
              AND Currency = 'EUR'
            ORDER BY DATE ASC
        """
        try:
            df = pd.read_sql_query(query, db.get_duoplus_engine())
            df['DATE'] = pd.to_datetime(df['DATE'])
            return df
        except Exception as e:
            logger.error(f'Performance data query failed: {e}')
            return pd.DataFrame(columns=['ID', 'DATE', 'Returns'])

    # ── Data preparation helpers ────────────────────────────────────────────

    @staticmethod
    def _prepare_portfolio_comparison(
        holdings_df: pd.DataFrame,
        benchmark_df: pd.DataFrame,
        top_picks: List[str],
    ) -> pd.DataFrame:
        """
        Build the portfolio vs benchmark comparison table (merged).
        Mirrors the logic in nordrhein.py that produces `merged`.
        """
        if holdings_df.empty:
            return pd.DataFrame(columns=['Name', 'ID', 'Port', 'Bench', 'Diff', 'Bool'])

        # --- Compute AMS value and weights ---
        holdings_df = holdings_df.copy()
        holdings_df['ams_price'] = pd.to_numeric(holdings_df['ams_price'], errors='coerce').fillna(0)
        holdings_df['fx_rate']   = pd.to_numeric(holdings_df['fx_rate'],   errors='coerce').fillna(1)
        holdings_df['qty']       = pd.to_numeric(holdings_df['qty'],       errors='coerce').fillna(0)
        holdings_df['ams_value'] = holdings_df['qty'] * holdings_df['ams_price'] * holdings_df['fx_rate']

        # Filter equity non-fund holdings
        # BloombergAssetType 'Equity' = direct equity; 'Fund' = fund (excluded here)
        eq = holdings_df[
            holdings_df['Asset Type'].str.strip() == 'Equity'
        ].copy()

        if eq.empty:
            return pd.DataFrame(columns=['Name', 'ID', 'Port', 'Bench', 'Diff', 'Bool'])

        # Normalise bb_code capitalisation
        eq['bb_code'] = eq['bb_code'].str.replace('EQUITY', 'Equity', case=False)

        total_val = eq['ams_value'].sum() or 1.0
        eq['Weight'] = eq['ams_value'] / total_val

        nord50 = eq[['name', 'bb_code', 'Weight']].rename(
            columns={'bb_code': 'ID', 'Weight': 'Port', 'name': 'Name'}
        ).copy()
        nord50['Port'] = nord50['Port'] / nord50['Port'].sum()

        # --- Benchmark ---
        if benchmark_df.empty:
            stoxx50 = pd.DataFrame(columns=['ID', 'Bench'])
        else:
            stoxx50 = benchmark_df[['ID', 'Weight']].rename(columns={'Weight': 'Bench'}).copy()
            bench_total = stoxx50['Bench'].sum() or 1.0
            stoxx50['Bench'] = stoxx50['Bench'] / bench_total
            stoxx50['ID'] = stoxx50['ID'].apply(_adjust_ticker)

        # --- Merge ---
        merged = pd.merge(nord50, stoxx50, how='outer', on='ID')
        merged['Bench'] = merged['Bench'].fillna(0)
        merged['Port']  = merged['Port'].fillna(0)
        merged['Name']  = merged['Name'].fillna('')
        merged['Diff']  = merged['Port'] - merged['Bench']

        # Top Picks flag
        merged['Bool'] = merged['ID'].isin(top_picks).astype(int)

        # Scale to percentages
        for col in ('Port', 'Bench', 'Diff'):
            merged[col] = (merged[col] * 100).round(2)

        merged = merged.sort_values('Diff', ascending=False)
        merged = merged[(merged['Port'] != 0) | (merged['Bench'] != 0)]

        return merged[['Name', 'ID', 'Port', 'Bench', 'Diff', 'Bool']].reset_index(drop=True)

    @staticmethod
    def _prepare_performance_chart(
        perf_df: pd.DataFrame,
        period: str = '1Y',
    ) -> List[Dict]:
        """
        Calculate cumulative returns and difference for the performance chart.
        Returns list of dicts: {DATE, Portfolio_Return_Pct, Benchmark_Return_Pct, Difference_Pct}.
        """
        if perf_df.empty:
            return []

        start = _period_start(period)
        df = perf_df.copy()
        if start is not None:
            df = df[df['DATE'] >= start]

        portfolio_df = df[df['ID'] == '.SCORINGEU Index'].dropna(subset=['Returns']).copy()
        benchmark_df = df[df['ID'] == 'SX5T Index'].dropna(subset=['Returns']).copy()

        if portfolio_df.empty or benchmark_df.empty:
            return []

        portfolio_df['Cumulative_Return'] = (1 + portfolio_df['Returns']).cumprod() - 1
        benchmark_df['Cumulative_Return'] = (1 + benchmark_df['Returns']).cumprod() - 1

        merged = pd.merge(
            portfolio_df[['DATE', 'Cumulative_Return']].rename(columns={'Cumulative_Return': 'Portfolio_Return'}),
            benchmark_df[['DATE', 'Cumulative_Return']].rename(columns={'Cumulative_Return': 'Benchmark_Return'}),
            on='DATE',
            how='outer',
        ).sort_values('DATE')

        merged['Portfolio_Return'] = merged['Portfolio_Return'].ffill()
        merged['Benchmark_Return'] = merged['Benchmark_Return'].ffill()
        merged['Difference']       = merged['Portfolio_Return'] - merged['Benchmark_Return']
        merged = merged.dropna()

        merged['Portfolio_Return_Pct'] = (merged['Portfolio_Return'] * 100).round(3)
        merged['Benchmark_Return_Pct'] = (merged['Benchmark_Return'] * 100).round(3)
        merged['Difference_Pct']       = (merged['Difference']       * 100).round(3)
        merged['DATE']                 = merged['DATE'].dt.strftime('%Y-%m-%d')

        return merged[['DATE', 'Portfolio_Return_Pct', 'Benchmark_Return_Pct', 'Difference_Pct']].to_dict('records')

    # ── Public API ──────────────────────────────────────────────────────────

    @staticmethod
    def get_main_data() -> Dict[str, Any]:
        """
        Load all data needed for the Nordrhein tab: cards, alerts,
        portfolio comparison table, and STOXX announcements table.
        Expensive – should be called once per session / on tab focus.
        """
        db = DatabaseGateway()

        # ------------------------------------------------------------------
        # 1. Portfolio holdings & benchmark weights
        # ------------------------------------------------------------------
        holdings_df   = UserService._get_holdings(db)
        benchmark_df  = UserService._get_sxrt_benchmark(db)
        top_picks     = _get_top_picks_tickers()

        portfolio_comparison = UserService._prepare_portfolio_comparison(
            holdings_df, benchmark_df, top_picks
        )

        # ------------------------------------------------------------------
        # 2. STOXX announcements
        # ------------------------------------------------------------------
        stoxx_raw = UserService._get_stoxx_announcements(db)

        if not stoxx_raw.empty:
            if 'Date' in stoxx_raw.columns:
                stoxx_raw['Date'] = pd.to_datetime(stoxx_raw['Date'], errors='coerce')
                stoxx_raw = stoxx_raw.sort_values('Date', ascending=False)
                stoxx_raw['Date'] = stoxx_raw['Date'].dt.strftime('%Y-%m-%d')
            # Fill missing link column
            if 'Links' in stoxx_raw.columns:
                stoxx_raw['Links'] = stoxx_raw['Links'].fillna('')
            # Filter to Blue Chip / Size Indices
            if 'Title' in stoxx_raw.columns:
                stoxx_raw = stoxx_raw[
                    stoxx_raw['Title'].str.contains(
                        'STOXX Blue Chip|STOXX Size Indices', case=False, na=False
                    )
                ]
            # German column names
            translations = {
                'Date': 'Datum', 'Title': 'Titel', 'Ticker': 'Ticker',
                'Links': 'Links', 'Action': 'Aktion', 'Index': 'Index',
                'Company': 'Unternehmen', 'Details': 'Details',
                'InsertedTime': 'Erfasst',
            }
            stoxx_raw = stoxx_raw.rename(columns={
                c: translations[c] for c in stoxx_raw.columns if c in translations
            })

        stoxx_latest_update = 'N/A'
        if not stoxx_raw.empty and 'Erfasst' in stoxx_raw.columns:
            stoxx_latest_update = str(stoxx_raw['Erfasst'].values[0])[:10]
        elif not stoxx_raw.empty and 'Datum' in stoxx_raw.columns:
            stoxx_latest_update = stoxx_raw['Datum'].values[0]

        # ------------------------------------------------------------------
        # 3. Dates & cards
        # ------------------------------------------------------------------
        xesc_date            = UserService._get_xesc_date(db)
        latest_benchmark_str = UserService._get_latest_benchmark_date(db)

        # Overlap: sum of min(Port, Bench) for common holdings
        overlap_weight = 0.0
        if not portfolio_comparison.empty:
            overlap_weight = round(
                portfolio_comparison[['Port', 'Bench']].min(axis=1).sum(), 2
            )

        # ------------------------------------------------------------------
        # 4. Summary stats
        # ------------------------------------------------------------------
        total_holdings   = len(portfolio_comparison)
        portfolio_only   = int((portfolio_comparison['Bench'] == 0).sum()) if not portfolio_comparison.empty else 0
        benchmark_only   = int((portfolio_comparison['Port']  == 0).sum()) if not portfolio_comparison.empty else 0
        overlapping      = int(((portfolio_comparison['Port'] > 0) & (portfolio_comparison['Bench'] > 0)).sum()) if not portfolio_comparison.empty else 0

        # ------------------------------------------------------------------
        # 5. Factsheet PDF (optional)
        # ------------------------------------------------------------------
        factsheet_base_path = r'M:\Multi Asset Mgmt\0200_PM\0260_Quant_Output\07_Sonstige\MAN'
        factsheet_pdf_date  = None
        average_rating      = None
        factsheet_is_old    = False
        rating_is_poor      = False

        try:
            pdf_path, date_str = _get_latest_factsheet_pdf(factsheet_base_path)
            average_rating     = _extract_average_rating(pdf_path)
            factsheet_pdf_date = date_str
            rating_is_poor     = _is_rating_poor(average_rating)
            file_date          = datetime.strptime(date_str, '%d-%m-%Y')
            factsheet_is_old   = (datetime.now() - file_date).days > _FACTSHEET_MAX_AGE_DAYS
        except FileNotFoundError:
            logger.info('Factsheet PDF not found – skipping (expected in some environments)')
        except Exception as e:
            logger.warning(f'Factsheet processing failed: {e}')

        # ------------------------------------------------------------------
        # 6. Alert flags
        # ------------------------------------------------------------------
        # STOXX announcement within threshold?
        stoxx_announcement_active = False
        if not stoxx_raw.empty and 'Datum' in stoxx_raw.columns:
            today = datetime.now()
            for date_str_val in stoxx_raw['Datum'].dropna():
                try:
                    ann_date = datetime.strptime(str(date_str_val), '%Y-%m-%d')
                    if abs((today - ann_date).days) <= _STOXX_ANNOUNCEMENT_THRESHOLD_DAYS:
                        stoxx_announcement_active = True
                        break
                except (ValueError, TypeError):
                    pass

        # Benchmark data stale?
        benchmark_is_outdated = False
        if latest_benchmark_str != 'N/A':
            try:
                bm_date  = datetime.strptime(latest_benchmark_str, '%Y-%m-%d').date()
                days_old = (datetime.now().date() - bm_date).days
                benchmark_is_outdated = days_old > _BENCHMARK_MAX_AGE_DAYS
            except ValueError:
                pass

        alerts = {
            'rating_is_poor':            rating_is_poor,
            'factsheet_is_old':          factsheet_is_old,
            'stoxx_announcement_active': stoxx_announcement_active,
            'benchmark_is_outdated':     benchmark_is_outdated,
        }
        has_alerts = any(alerts.values())

        # ------------------------------------------------------------------
        # 7. Build response
        # ------------------------------------------------------------------
        return {
            'status': 'ok',
            'cards': {
                'average_rating':    average_rating or 'N/A',
                'factsheet_date':    factsheet_pdf_date or 'N/A',
                'overlap':           overlap_weight,
                'benchmark_date':    latest_benchmark_str,
                'xesc_date':         xesc_date,
                'total_holdings':    total_holdings,
                'portfolio_only':    portfolio_only,
                'benchmark_only':    benchmark_only,
                'overlapping':       overlapping,
                'stoxx_latest_update': stoxx_latest_update,
            },
            'card_alerts': {
                'rating_is_poor':         rating_is_poor,
                'factsheet_is_old':       factsheet_is_old,
                'benchmark_is_outdated':  benchmark_is_outdated,
            },
            'alerts': alerts,
            'has_alerts': has_alerts,
            'portfolio_comparison': portfolio_comparison.to_dict('records'),
            'stoxx_announcements':  stoxx_raw.to_dict('records') if not stoxx_raw.empty else [],
            'alert_details': UserService._build_alert_details(
                average_rating, factsheet_is_old, stoxx_announcement_active,
                benchmark_is_outdated, rating_is_poor, latest_benchmark_str,
            ),
        }

    @staticmethod
    def get_performance_data(period: str = '1Y') -> Dict[str, Any]:
        """
        Return cumulative-return chart data for the given time period.
        period: 'MtD' | 'YtD' | '1Y' | 'All'
        """
        db     = DatabaseGateway()
        raw_df = UserService._get_performance_data(db)

        latest_date = 'N/A'
        if not raw_df.empty:
            latest_date = str(raw_df['DATE'].max())[:10]

        chart_data = UserService._prepare_performance_chart(raw_df, period)

        return {
            'status':      'ok',
            'period':      period,
            'data':        chart_data,
            'latest_date': latest_date,
        }

    @staticmethod
    def get_alerts() -> Dict[str, Any]:
        """
        Lightweight endpoint – returns only alert flags (no heavy data loading).
        Used to highlight the sidebar item.
        """
        db = DatabaseGateway()

        # --- Stoxx announcements ---
        stoxx_announcement_active = False
        try:
            stoxx_raw = UserService._get_stoxx_announcements(db)
            if not stoxx_raw.empty and 'Date' in stoxx_raw.columns:
                today = datetime.now()
                for d in pd.to_datetime(stoxx_raw['Date'], errors='coerce').dropna():
                    if abs((today - d.to_pydatetime()).days) <= _STOXX_ANNOUNCEMENT_THRESHOLD_DAYS:
                        stoxx_announcement_active = True
                        break
        except Exception as e:
            logger.warning(f'Alert check – stoxx: {e}')

        # --- Benchmark recency ---
        benchmark_is_outdated = False
        try:
            latest_bm = UserService._get_latest_benchmark_date(db)
            if latest_bm != 'N/A':
                bm_date  = datetime.strptime(latest_bm, '%Y-%m-%d').date()
                benchmark_is_outdated = (datetime.now().date() - bm_date).days > _BENCHMARK_MAX_AGE_DAYS
        except Exception as e:
            logger.warning(f'Alert check – benchmark: {e}')

        # --- Factsheet / rating (optional) ---
        factsheet_is_old = False
        rating_is_poor   = False
        try:
            factsheet_base_path = r'M:\Multi Asset Mgmt\0200_PM\0260_Quant_Output\07_Sonstige\MAN'
            pdf_path, date_str  = _get_latest_factsheet_pdf(factsheet_base_path)
            rating              = _extract_average_rating(pdf_path)
            rating_is_poor      = _is_rating_poor(rating)
            file_date           = datetime.strptime(date_str, '%d-%m-%Y')
            factsheet_is_old    = (datetime.now() - file_date).days > _FACTSHEET_MAX_AGE_DAYS
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f'Alert check – factsheet: {e}')

        alerts = {
            'rating_is_poor':            rating_is_poor,
            'factsheet_is_old':          factsheet_is_old,
            'stoxx_announcement_active': stoxx_announcement_active,
            'benchmark_is_outdated':     benchmark_is_outdated,
        }
        return {
            'status':     'ok',
            'alerts':     alerts,
            'has_alerts': any(alerts.values()),
        }

    # ── Alert detail builder ────────────────────────────────────────────────

    @staticmethod
    def _build_alert_details(
        average_rating, factsheet_is_old, stoxx_announcement_active,
        benchmark_is_outdated, rating_is_poor, latest_benchmark_str,
    ) -> List[Dict]:
        details = []

        if rating_is_poor:
            details.append({
                'type':      'Credit Rating Below Threshold',
                'rating':    average_rating or 'N/A',
                'threshold': 'BBB- (minimum)',
                'source':    'Factsheet PDF – Average Rating',
                'fix':       'Monitor portfolio and consider rebalancing to improve credit quality',
            })

        if factsheet_is_old:
            details.append({
                'type':      'Factsheet Outdated',
                'threshold': f'> {_FACTSHEET_MAX_AGE_DAYS} days old',
                'source':    'Factsheet PDF file',
                'path':      'M:\\Multi Asset Mgmt\\0200_PM\\0260_Quant_Output\\07_Sonstige\\MAN',
                'fix':       'Download latest factsheet from MAN Global Emerging Markets Bond Documents',
                'url':       'https://www.man.com/products/man-global-emerging-markets-bond#_product-documents',
            })

        if stoxx_announcement_active:
            details.append({
                'type':      'STOXX Announcement Alert',
                'threshold': f'Announcement within {_STOXX_ANNOUNCEMENT_THRESHOLD_DAYS} days',
                'source':    'STOXX Ankündigungen "Datum" column',
                'status':    'Rebalance Date Coming Up',
            })

        if benchmark_is_outdated:
            details.append({
                'type':      'Benchmark Data Outdated',
                'threshold': f'> {_BENCHMARK_MAX_AGE_DAYS} days old',
                'source':    '[ApoAsset_Quant].[dbo].[benchmark_weights] (SXRT GY Equity)',
                'latest':    latest_benchmark_str,
                'fix':       'Update database through Bloomberg GUI – Benchmark Weights Tab – Load SXRT GY Equity',
            })

        return details
