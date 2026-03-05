"""
Anleihen (Bonds) page data service.

Three public functions:
  get_issuance_table()  – loads new_issuance_bonds.xlsx (no SQL)
  get_checks_table()    – single SELECT from renten_checks
  get_chart_data(bond)  – CDS curve + ASW spreads, only called on row click
"""

import os
import re
import math
import logging
import pandas as pd
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

from utils.database import DatabaseGateway

db = DatabaseGateway()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_BASE_DIR = os.path.dirname(os.path.dirname(__file__))   # backend/
_BONDS_XLSX = os.path.join(_BASE_DIR, "manual_data", "new_issuance_bonds.xlsx")

# ---------------------------------------------------------------------------
# Rating helpers (ported from bonds_helpers.py)
# ---------------------------------------------------------------------------

RATING_HIERARCHY = [
    'C', 'D', 'CC', 'CCC', 'B-', 'B', 'B+', 'BB-', 'BB', 'BB+',
    'BBB-', 'BBB', 'BBB+', 'A-', 'A', 'A+', 'AA-', 'AA', 'AA+', 'AAA'
]

MOODY_TO_SP = {
    'AAA': 'AAA', 'AA1': 'AA+', 'AA2': 'AA', 'AA3': 'AA-',
    'A1': 'A+', 'A2': 'A', 'A3': 'A-',
    'BAA1': 'BBB+', 'BAA2': 'BBB', 'BAA3': 'BBB-',
    'BA1': 'BB+', 'BA2': 'BB', 'BA3': 'BB-',
    'B1': 'B+', 'B2': 'B', 'B3': 'B-',
    'CAA': 'CCC', 'CA': 'CC', 'C': 'C', 'D': 'D',
}


def _standardize_rating(raw: str) -> str:
    """Convert Moody's to S&P format; Fitch/S&P returned as-is."""
    if not raw:
        return ''
    r = str(raw).strip().upper()
    return MOODY_TO_SP.get(r, r)


def _get_ratings_from_bond(bond_row: pd.Series) -> List[str]:
    """Extract all available ratings and standardise to S&P format."""
    ratings = []
    pairs = [('Moodys', 'Moody_LT'), ('Fitch', 'Fitch_LT'), ('S&P', 'S&P_LT')]
    for short_col, long_col in pairs:
        val = None
        if short_col in bond_row.index and pd.notna(bond_row.get(short_col)):
            val = str(bond_row[short_col]).strip()
        elif long_col in bond_row.index and pd.notna(bond_row.get(long_col)):
            val = str(bond_row[long_col]).strip()
        if val and val.lower() not in ('n.a.', 'nan', 'none', 'nr', 'wr'):
            std = _standardize_rating(val)
            if std and std not in ratings:
                ratings.append(std)
    return ratings


def _get_best_rating(bond_row: pd.Series) -> Optional[str]:
    """Return highest-ranked available rating."""
    ratings = _get_ratings_from_bond(bond_row)
    best, best_idx = None, -1
    for r in ratings:
        try:
            idx = RATING_HIERARCHY.index(r)
            if idx > best_idx:
                best_idx = idx
                best = r
        except ValueError:
            pass
    return best


def _extract_category(rating: str) -> str:
    """Strip +/- modifiers from a rating string."""
    return str(rating).upper().strip().rstrip('+-')


# ---------------------------------------------------------------------------
# Excel loader – new_issuance_bonds.xlsx
# ---------------------------------------------------------------------------

def _merge_rating_values(row: pd.Series, short_col: str, long_col: str) -> str:
    short_val = str(row[short_col]).strip() if pd.notna(row[short_col]) else 'N.A.'
    long_val  = str(row[long_col]).strip()  if pd.notna(row[long_col])  else 'N.A.'
    for attr in ('short_val', 'long_val'):
        v = locals()[attr]
        if v in ('nan', 'None'):
            if attr == 'short_val':
                short_val = 'N.A.'
            else:
                long_val = 'N.A.'
    if short_val == 'N.A.':
        return long_val
    elif long_val == 'N.A.':
        return short_val
    elif short_val != long_val:
        return f"{short_val} / {long_val}"
    else:
        return short_val


def _merge_amount_columns(row: pd.Series, cols: List[str]):
    values = []
    for col in cols:
        val = row[col]
        if pd.notna(val):
            s = str(val).strip()
            if s and s not in ('N.A.', 'nan'):
                try:
                    values.append(float(val))
                except (ValueError, TypeError):
                    pass
    return max(values) if values else None


def _format_amount_eu(value) -> str:
    """Format number with European separators (1.234.567,89)."""
    if value is None or value == 'N.A.' or (isinstance(value, float) and math.isnan(value)):
        return 'N.A.'
    try:
        num = float(value)
        formatted = f"{num:,.2f}"
        integer_part, decimal_part = formatted.rsplit('.', 1)
        integer_part = integer_part.replace(',', '.')
        return f"{integer_part},{decimal_part}"
    except (ValueError, TypeError):
        return str(value)


def _extract_cds_spread(bond_row: pd.Series) -> Optional[float]:
    """Extract numeric CDS spread from Final Initial Guidance / Initial Guidance / IPT."""
    for col in ('Final Initial Guidance', 'Initial Guidance', 'IPT'):
        if col not in bond_row.index:
            continue
        val = bond_row[col]
        if pd.isna(val):
            continue
        val_str = str(val).strip()
        if '%' in val_str:
            continue
        m = re.search(r'[+\-]?\s*(\d+(?:\.\d+)?)', val_str)
        if m:
            try:
                return float(m.group(1))
            except (ValueError, TypeError):
                continue
    return None


# ---------------------------------------------------------------------------
# ASW spread helpers (ported from bonds_helpers.py)
# ---------------------------------------------------------------------------

def _match_asw_tickers_by_rating(bond_row: pd.Series, asw_df: pd.DataFrame) -> pd.DataFrame:
    """Find ASW tickers that match the bond's rating."""
    if asw_df.empty:
        return pd.DataFrame()

    bond_ratings = _get_ratings_from_bond(bond_row)
    if not bond_ratings:
        return pd.DataFrame()

    matching = pd.DataFrame()
    for rating in bond_ratings:
        category = _extract_category(rating)
        if category == 'BBB':
            mask = asw_df['Name'].str.contains(r'\bBBB\s+Composite\b', case=False, regex=True, na=False)
            matching = pd.concat([matching, asw_df[mask]], ignore_index=True)
        elif category == 'AA':
            pattern = rf'\b{re.escape(rating)}\s+Composite\b'
            mask = asw_df['Name'].str.contains(pattern, case=False, regex=True, na=False)
            matches = asw_df[mask]
            if not matches.empty:
                matching = pd.concat([matching, matches], ignore_index=True)
        else:
            pattern = rf'\b{re.escape(rating)}\s+Composite\b'
            mask = asw_df['Name'].str.contains(pattern, case=False, regex=True, na=False)
            matching = pd.concat([matching, asw_df[mask]], ignore_index=True)

    if not matching.empty:
        matching = matching.drop_duplicates(subset=['Ticker'], keep='first')
    return matching


def get_asw_spreads_for_bond(bond_row: pd.Series) -> pd.DataFrame:
    """
    Retrieve ASW spreads for tenors matching the bond's rating.
    Returns DataFrame with: Tenor, ASW_Spread, Label, Rating_Value
    """
    try:
        engine = db.get_duoplus_engine()
        asw_tickers_df = pd.read_sql_query(
            """
            SELECT Ticker, Name, Period
            FROM [ApoAsset_Quant].[dbo].[ticker_master]
            WHERE [Dashboard Grouping Name] = 'ASW'
              AND Regions = 'Europe'
            """,
            engine
        )
        if asw_tickers_df.empty:
            return pd.DataFrame()

        matching = _match_asw_tickers_by_rating(bond_row, asw_tickers_df)
        if matching.empty:
            return pd.DataFrame()

        ticker_list = "', '".join(matching['Ticker'].tolist())
        asw_data = pd.read_sql_query(
            f"""
            SELECT
                t.Ticker,
                t.Name,
                t.Period AS Tenor,
                m.DatePoint,
                m.Value AS ASW_Spread
            FROM [ApoAsset_Quant].[dbo].[ticker_master] t
            INNER JOIN [ApoAsset_Quant].[dbo].[market_data] m ON t.Ticker = m.ID
            WHERE t.Ticker IN ('{ticker_list}')
              AND m.DatePoint = (
                  SELECT MAX(DatePoint)
                  FROM [ApoAsset_Quant].[dbo].[market_data]
                  WHERE ID IN ('{ticker_list}')
              )
            ORDER BY t.Period
            """,
            engine
        )
        if asw_data.empty:
            return pd.DataFrame()

        asw_data['Rating_Value'] = asw_data['Name'].apply(
            lambda x: x.split()[1] if len(x.split()) > 1 else ''
        )
        return asw_data[['Tenor', 'ASW_Spread', 'Name', 'Rating_Value']].rename(
            columns={'Name': 'Label'}
        )
    except Exception as e:
        logger.error(f"Error retrieving ASW spreads: {e}")
        return pd.DataFrame()


# ---------------------------------------------------------------------------
# CDS data (ported from bonds_helpers.py)
# ---------------------------------------------------------------------------

def get_cds_data_for_currency(currency: str) -> pd.DataFrame:
    """
    Return CDS curve data for EUR (iTraxx Europe) or USD (CDX IG) bonds.
    Reads from [ApoAsset_Quant].[dbo].[market_data] via ticker_master.
    """
    currency_to_region = {'EUR': 'Europe', 'USD': 'U.S.'}
    region = currency_to_region.get(currency.upper())
    if not region:
        return pd.DataFrame()

    try:
        engine = db.get_duoplus_engine()
        cds_tickers_df = pd.read_sql_query(
            f"""
            SELECT Ticker, Name
            FROM [ApoAsset_Quant].[dbo].[ticker_master]
            WHERE [Dashboard Grouping Name] = 'CDS'
              AND Regions = '{region}'
            """,
            engine
        )
        if cds_tickers_df.empty:
            return pd.DataFrame()

        ticker_list = "', '".join(cds_tickers_df['Ticker'].tolist())
        # Fetch only the single most-recent date – avoids loading years of history
        market_data = pd.read_sql_query(
            f"""
            SELECT m.ID AS Ticker, t.Name, m.DatePoint, m.Value
            FROM [ApoAsset_Quant].[dbo].[market_data] m
            JOIN [ApoAsset_Quant].[dbo].[ticker_master] t ON m.ID = t.Ticker
            WHERE m.ID IN ('{ticker_list}')
              AND m.DatePoint = (
                  SELECT MAX(DatePoint)
                  FROM [ApoAsset_Quant].[dbo].[market_data]
                  WHERE ID IN ('{ticker_list}')
              )
            """,
            engine,
        )
        if market_data.empty:
            return pd.DataFrame()

        market_data['DatePoint'] = pd.to_datetime(market_data['DatePoint'], errors='coerce')
        market_data['Value'] = pd.to_numeric(market_data['Value'], errors='coerce')

        # Pivot so each CDS maturity is its own column
        # Name patterns like "3 CDS", "5 CDS", "7 CDS", "10 CDS"
        pivot = market_data.pivot_table(
            index='DatePoint', columns='Name', values='Value', aggfunc='first'
        ).reset_index()
        pivot.columns.name = None
        pivot['Regions'] = region
        return pivot
    except Exception as e:
        logger.error(f"Error loading CDS data: {e}")
        return pd.DataFrame()


# ---------------------------------------------------------------------------
# Ranking calculation
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Public API: bond issuance table
# ---------------------------------------------------------------------------

def get_issuance_table() -> Dict[str, Any]:
    """
    Load new_issuance_bonds.xlsx, merge columns, calculate ranks.

    Returns:
        dict with keys: rows (list of dicts), columns (list of str), status
    """
    try:
        df = pd.read_excel(_BONDS_XLSX)

        # ── Merge amount columns ──────────────────────────────────────────
        amount_cols_to_merge = [
            'Amount Issued (Local)', 'Amount Outstanding',
            'Offering Amount', 'Amount Sold', 'Most Recent Amount Sold'
        ]
        existing_amount_cols = [c for c in amount_cols_to_merge if c in df.columns]
        if existing_amount_cols:
            df['Amount Local'] = df[existing_amount_cols].apply(
                lambda row: _merge_amount_columns(row, existing_amount_cols), axis=1
            )
            df = df.drop(columns=existing_amount_cols)

        # ── Merge rating columns ──────────────────────────────────────────
        rating_pairs = [
            ('Moody', 'Moody_LT', 'Moodys'),
            ('Fitch', 'Fitch_LT', 'Fitch'),
            ('S&P',   'S&P_LT',   'S&P'),
        ]
        for short_col, long_col, merged_name in rating_pairs:
            short_exists = short_col in df.columns
            long_exists  = long_col  in df.columns
            if short_exists and long_exists:
                df[merged_name] = df.apply(
                    lambda row: _merge_rating_values(row, short_col, long_col), axis=1
                )
                df = df.drop(columns=[c for c in [short_col, long_col] if c in df.columns])
            elif short_exists:
                df.rename(columns={short_col: merged_name}, inplace=True)
            elif long_exists:
                df.rename(columns={long_col: merged_name}, inplace=True)

        # ── Filter bonds with no ratings ────────────────────────────────
        rating_cols = [c for c in ('Moodys', 'Fitch', 'S&P') if c in df.columns]
        if rating_cols:
            all_na = df[rating_cols].apply(
                lambda row: all(str(v).strip() in ('N.A.', 'nan', 'None', '') for v in row),
                axis=1
            )
            df = df[~all_na]

        # ── Format datetime columns ────────────────────────────────────
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime('%Y-%m-%d')

        # ── Format Amount Local ────────────────────────────────────────
        if 'Amount Local' in df.columns:
            df['Amount Local'] = df['Amount Local'].apply(_format_amount_eu)

        # ── Replace NaN with None for JSON ────────────────────────────
        df = df.where(pd.notnull(df), None)

        return {
            'status': 'ok',
            'columns': list(df.columns),
            'rows': df.to_dict('records'),
        }
    except Exception as e:
        logger.error(f"Error loading issuance table: {e}", exc_info=True)
        return {'status': 'error', 'error': str(e), 'columns': [], 'rows': []}


# ---------------------------------------------------------------------------
# Public API: bond checks / renten_checks table
# ---------------------------------------------------------------------------

def get_checks_table() -> Dict[str, Any]:
    """Single SQL query against renten_checks – no AMS queries."""
    try:
        engine = db.get_duoplus_engine()
        df = pd.read_sql_query(
            """
            SELECT
                Fonds,
                Investmentansatz,
                [Länder / Universum],
                Währung,
                [Min. Rating],
                [Rating-logik],
                [max. FX-Exposure],
                [max. Corporates]
            FROM [ApoAsset_Quant].[dbo].[renten_checks]
            ORDER BY Fonds
            """,
            engine,
        )
        if 'Investmentansatz' in df.columns:
            df = df[df['Investmentansatz'].str.contains('Renten', case=False, na=False)]
            df.drop(columns=['Investmentansatz'], inplace=True)
        if 'Fonds' in df.columns:
            df = df[df['Fonds'] != 'Kini']

        col_order = [
            'Fonds', 'Länder / Universum', 'Währung',
            'Min. Rating', 'Rating-logik', 'max. FX-Exposure', 'max. Corporates',
        ]
        df = df[[c for c in col_order if c in df.columns]]
        df = df.where(pd.notnull(df), None)
        return {'status': 'ok', 'columns': list(df.columns), 'rows': df.to_dict('records')}
    except Exception as e:
        logger.error(f"checks table error: {e}", exc_info=True)
        return {'status': 'error', 'error': str(e), 'columns': [], 'rows': []}


# ---------------------------------------------------------------------------
# Public API: chart data for a selected bond
# ---------------------------------------------------------------------------

def get_chart_data(bond_dict: Dict) -> Dict[str, Any]:
    """
    Given a bond row (dict from the issuance table), return:
    - cds_curve:  list of {tenor, value} for the CDS curve
    - asw_curves: dict {rating: list of {tenor, value}}
    - bond_point: {tenor_label, cds_spread, years_to_maturity}
    - metadata:   {bond_name, currency, maturity}
    """
    try:
        bond_row = pd.Series(bond_dict)
        currency = str(bond_row.get('Currency', '')).upper()
        bond_name = bond_row.get('Name', 'Unknown')
        bond_maturity = bond_row.get('Maturity', 'N/A')

        result: Dict[str, Any] = {
            'status': 'ok',
            'metadata': {
                'bond_name': bond_name,
                'currency': currency,
                'maturity': str(bond_maturity),
                'supported': currency in ('EUR', 'USD'),
            },
            'cds_curve': [],
            'asw_curves': {},
            'bond_point': None,
        }

        if currency not in ('EUR', 'USD'):
            result['metadata']['message'] = (
                f"CDS data only available for EUR/USD bonds. Selected: {currency}"
            )
            return result

        # ── CDS curve ─────────────────────────────────────────────────────
        cds_df = get_cds_data_for_currency(currency)
        tenor_order = ['1Y', '3Y', '5Y', '7Y', '10Y']
        maturity_map = {'3 CDS': 3, '5 CDS': 5, '7 CDS': 7, '10 CDS': 10}

        if not cds_df.empty:
            cds_cols = [c for c in cds_df.columns
                        if 'CDS' in c and c not in ('Regions',)
                        and not any(c.endswith(s) for s in ('_avg_1y', '_avg_3y', '_avg_5y', '_avg_all'))]
            valid_cds = cds_df.dropna(subset=cds_cols, how='all') if cds_cols else cds_df
            if not valid_cds.empty:
                latest = valid_cds.sort_values('DatePoint').iloc[-1]
                cds_points = []
                for col in sorted(cds_cols):
                    val = latest[col]
                    mat = maturity_map.get(col)
                    if pd.notna(val) and mat is not None:
                        cds_points.append({'tenor': f"{mat}Y", 'value': float(val)})
                cds_points.sort(key=lambda p: tenor_order.index(p['tenor']) if p['tenor'] in tenor_order else 99)
                result['cds_curve'] = cds_points

                # ── Bond point ───────────────────────────────────────────
                cds_spread = _extract_cds_spread(bond_row)
                if cds_spread is not None:
                    try:
                        mat_dt = pd.to_datetime(bond_maturity)
                        ref_dt = pd.to_datetime(latest['DatePoint'])
                        years = (mat_dt - ref_dt).days / 365.25
                        tenor_values = [1, 3, 5, 7, 10]
                        closest_idx = min(range(len(tenor_values)), key=lambda i: abs(tenor_values[i] - years))
                        result['bond_point'] = {
                            'tenor_label': tenor_order[closest_idx],
                            'cds_spread': float(cds_spread),
                            'years_to_maturity': round(years, 2),
                        }
                    except Exception:
                        pass

        # ── ASW curves ────────────────────────────────────────────────────
        asw_df = get_asw_spreads_for_bond(bond_row)
        if not asw_df.empty:
            for rating in sorted(asw_df['Rating_Value'].unique()):
                sub = asw_df[asw_df['Rating_Value'] == rating].copy()
                sub['Tenor_Label'] = sub['Tenor'].astype(str) + 'Y'
                sub['_ord'] = sub['Tenor_Label'].apply(
                    lambda x: tenor_order.index(x) if x in tenor_order else 99
                )
                sub = sub.sort_values('_ord')
                result['asw_curves'][str(rating)] = [
                    {'tenor': row['Tenor_Label'], 'value': float(row['ASW_Spread']), 'label': str(row['Label'])}
                    for _, row in sub.iterrows()
                ]

        return result
    except Exception as e:
        logger.error(f"Error generating chart data: {e}", exc_info=True)
        return {'status': 'error', 'error': str(e)}
