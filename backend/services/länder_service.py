"""
Länder/Countries page data service.

Handles fetching, filtering, and formatting equity, fixed income, and macro data
for the Countries page.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
import sys
import os
import logging
import hashlib
import json

logger = logging.getLogger(__name__)

# Import database gateway
from utils.database import DatabaseGateway

# Simple in-memory cache for API responses (TTL: 30 seconds)
_response_cache = {}
_cache_timestamps = {}


class TechnicalIndicatorCalculator:
    """
    Calculates technical indicators for equity data.
    All calculations follow the original dashboard specifications.
    """
    
    @staticmethod
    def calculate_ma50(price_series: pd.Series) -> pd.Series:
        """
        Calculate 50-day moving average.
        
        Args:
            price_series: Pandas Series of prices
        
        Returns:
            Series with MA50 values
        """
        return price_series.rolling(window=50, min_periods=1).mean()
    
    @staticmethod
    def calculate_rsi(price_series: pd.Series, period: int = 14) -> pd.Series:
        """
        Calculate Relative Strength Index (RSI).
        
        Args:
            price_series: Pandas Series of prices
            period: RSI period (default: 14)
        
        Returns:
            Series with RSI values (0-100)
        """
        delta = price_series.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        
        avg_gain = gain.rolling(window=period, min_periods=1).mean()
        avg_loss = loss.rolling(window=period, min_periods=1).mean()
        
        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        
        return rsi.fillna(50)  # Default to 50 if not calculable
    
    @staticmethod
    def calculate_macd(price_series: pd.Series) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """
        Calculate MACD (Moving Average Convergence Divergence).
        
        Args:
            price_series: Pandas Series of prices
        
        Returns:
            Tuple of (MACD line, Signal line, Histogram)
        """
        ema12 = price_series.ewm(span=12, adjust=False).mean()
        ema26 = price_series.ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal = macd.ewm(span=9, adjust=False).mean()
        histogram = macd - signal
        
        return macd, signal, histogram
    
    @staticmethod
    def calculate_momentum(price_series: pd.Series) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """
        Calculate momentum indicators (3M, 12M, Time Series).
        
        Args:
            price_series: Pandas Series of prices
        
        Returns:
            Tuple of (3M momentum %, 12M momentum %, TS momentum %)
        """
        # 3-month momentum: (price[t-21] / price[t-63] - 1) * 100
        momentum_3m = (price_series.shift(21) / price_series.shift(63) - 1) * 100
        
        # 12-month momentum: (price[t-21] / price[t-252] - 1) * 100
        momentum_12m = (price_series.shift(21) / price_series.shift(252) - 1) * 100
        
        # Time Series momentum: EWMA(returns, alpha=0.03)
        returns = price_series.pct_change()
        momentum_ts = returns.ewm(span=int(1 / 0.03), adjust=False).mean() * 100
        
        return momentum_3m, momentum_12m, momentum_ts
    
    @staticmethod
    def calculate_volatility(price_series: pd.Series, window: int = 252) -> pd.Series:
        """
        Calculate annualized rolling volatility.
        
        Args:
            price_series: Pandas Series of prices
            window: Rolling window in trading days (default: 252 for annual)
        
        Returns:
            Series with annualized volatility (%)
        """
        returns = price_series.pct_change()
        rolling_std = returns.rolling(window=window, min_periods=1).std()
        volatility = rolling_std * np.sqrt(window) * 100
        
        return volatility
    
    @staticmethod
    def calculate_sharpe_ratio(
        price_series: pd.Series,
        risk_free_rate: float = 0.025,
        window: int = 252
    ) -> pd.Series:
        """
        Calculate rolling Sharpe ratio.
        
        Args:
            price_series: Pandas Series of prices
            risk_free_rate: Annual risk-free rate (default: 2.5%)
            window: Rolling window in trading days (default: 252 for annual)
        
        Returns:
            Series with rolling Sharpe ratio
        """
        returns = price_series.pct_change()
        rolling_returns = returns.rolling(window=window, min_periods=1).mean()
        rolling_volatility = TechnicalIndicatorCalculator.calculate_volatility(
            price_series, window
        ) / 100
        
        sharpe = (rolling_returns * 252 - risk_free_rate) / rolling_volatility.replace(0, np.nan)
        
        return sharpe.fillna(0)
    
    @staticmethod
    def apply_all_indicators(
        df: pd.DataFrame,
        price_column: str = "PX_LAST"
    ) -> pd.DataFrame:
        """
        Apply all technical indicators to a price series within a dataframe.
        
        Args:
            df: DataFrame with price data, grouped by currency/region
            price_column: Column name containing price data
        
        Returns:
            DataFrame with added indicator columns
        """
        result = df.copy()
        
        if price_column not in result.columns:
            logger.warning(f"Price column {price_column} not found in dataframe")
            return result
        
        # Convert to numeric if needed
        result[price_column] = pd.to_numeric(result[price_column], errors='coerce')
        
        # Calculate all indicators
        result["MA_50"] = TechnicalIndicatorCalculator.calculate_ma50(result[price_column])
        result["RSI"] = TechnicalIndicatorCalculator.calculate_rsi(result[price_column])
        
        macd, signal, histogram = TechnicalIndicatorCalculator.calculate_macd(result[price_column])
        result["MACD"] = macd
        result["MACD_Signal"] = signal
        result["MACD_Histogram"] = histogram
        
        mom_3m, mom_12m, mom_ts = TechnicalIndicatorCalculator.calculate_momentum(result[price_column])
        result["MOM_3"] = mom_3m
        result["MOM_12"] = mom_12m
        result["MOM_TS"] = mom_ts
        
        result["Rolling Volatility"] = TechnicalIndicatorCalculator.calculate_volatility(result[price_column])
        result["Rolling Sharpe"] = TechnicalIndicatorCalculator.calculate_sharpe_ratio(result[price_column])
        
        return result


# TODO: Integrate original dashboard.data.get_data functions
# Commented out temporarily to allow service to start standalone
# sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'dashboard'))

# try:
#     from data.get_data import (
#         get_country_equity_signals,
#         get_country_fixed_income_data,
#         get_country_macro_data,
#         country_msci_data,
#         country_fi_data,
#         country_macro_data,
#         corr_df,
#     )
#     from utils.functions import adj_datetime
#     logger.info("✓ Successfully imported data functions from dashboard project")
# except Exception as e:
#     logger.error(f"✗ Failed to import from dashboard project: {e}")
#     country_msci_data = None
#     country_fi_data = None
#     country_macro_data = None


class LänderDataService:
    """
    Service for Länder/Countries page data operations.
    Handles data fetching, filtering, and formatting for charts.
    
    Falls back to mock data if database is unavailable.
    """
    
    CACHE_TTL = 30  # Cache responses for 30 seconds
    
    @staticmethod
    def _get_cache_key(endpoint: str, regions: List[str], **kwargs) -> str:
        """Generate a cache key for API responses."""
        params = {
            'endpoint': endpoint,
            'regions': sorted(regions),
            **kwargs
        }
        key_str = json.dumps(params, sort_keys=True, default=str)
        return hashlib.md5(key_str.encode()).hexdigest()
    
    @staticmethod
    def _get_cached_response(cache_key: str) -> Optional[Dict]:
        """Get cached response if still valid (within TTL)."""
        if cache_key in _response_cache:
            timestamp = _cache_timestamps.get(cache_key, 0)
            if (datetime.now() - datetime.fromtimestamp(timestamp)).total_seconds() < LänderDataService.CACHE_TTL:
                logger.debug(f"Cache hit for {cache_key}")
                return _response_cache[cache_key]
            else:
                # Expired, remove from cache
                del _response_cache[cache_key]
                del _cache_timestamps[cache_key]
        return None
    
    @staticmethod
    def _set_cached_response(cache_key: str, response: Dict) -> None:
        """Cache a response."""
        _response_cache[cache_key] = response
        _cache_timestamps[cache_key] = datetime.now().timestamp()
        logger.debug(f"Cached response for {cache_key}")
    
    @staticmethod
    def _generate_fallback_equity_data(regions: List[str], days: int = 252) -> pd.DataFrame:
        """
        Generate realistic mock equity data for development/testing.
        Uses seed based on region name for reproducibility.
        
        Args:
            regions: List of region names
            days: Number of historical days to generate
        
        Returns:
            DataFrame with mock equity data
        """
        np.random.seed(42)  # For reproducibility
        
        dates = pd.date_range(end=datetime.now(), periods=days, freq='D')
        data = []
        
        for region in regions:
            base_price = 100 + (hash(region) % 50)
            prices = [base_price]
            
            for _ in range(days - 1):
                change = np.random.normal(0.0005, 0.015)
                prices.append(prices[-1] * (1 + change))
            
            region_data = pd.DataFrame({
                'DatePoint': dates,
                'Regions': region,
                'Name': f'MSCI {region} Index',
                'Currency': 'EUR',
                'PX_LAST': prices,
            })
            data.append(region_data)
        
        return pd.concat(data, ignore_index=True)
    
    @staticmethod
    def _generate_fallback_fixed_income_data(regions: List[str], days: int = 252) -> pd.DataFrame:
        """
        Generate realistic mock fixed income data for development/testing.
        
        Args:
            regions: List of region names
            days: Number of historical days to generate
        
        Returns:
            DataFrame with mock fixed income data
        """
        np.random.seed(42)
        
        dates = pd.date_range(end=datetime.now(), periods=days, freq='D')
        data = []
        
        for region in regions:
            base_yield = 2.0 + (hash(region) % 3)
            
            region_data = pd.DataFrame({
                'DatePoint': dates,
                'Regions': region,
                '2Y Yields': base_yield + np.random.normal(0, 0.3, days),
                '5Y Yields': base_yield + 0.5 + np.random.normal(0, 0.25, days),
                '10Y Yields': base_yield + 1.0 + np.random.normal(0, 0.2, days),
                '20Y Yields': base_yield + 1.2 + np.random.normal(0, 0.2, days),
            })
            data.append(region_data)
        
        return pd.concat(data, ignore_index=True)
    
    @staticmethod
    def _generate_fallback_macro_data(regions: List[str], days: int = 252) -> pd.DataFrame:
        """
        Generate realistic mock macro data for development/testing.
        
        Args:
            regions: List of region names
            days: Number of historical days to generate
        
        Returns:
            DataFrame with mock macro data
        """
        np.random.seed(42)
        
        dates = pd.date_range(end=datetime.now(), periods=days, freq='D')
        data = []
        
        for region in regions:
            base_rate = 2.0 + (hash(region) % 4)
            
            region_data = pd.DataFrame({
                'DatePoint': dates,
                'Regions': region,
                'Interest Rate': base_rate + np.random.normal(0, 0.2, days),
                'Inflation': 2.5 + np.random.normal(0, 0.5, days),
                'PMI': 50 + np.random.normal(0, 5, days),
                'GDP Growth': 2.0 + np.random.normal(0, 1, days),
            })
            data.append(region_data)
        
        return pd.concat(data, ignore_index=True)
    
    @staticmethod
    def filter_by_date_range(df: pd.DataFrame, start_date: Optional[str], end_date: Optional[str]) -> pd.DataFrame:
        """
        Filter dataframe by date range.
        
        Args:
            df: Input dataframe with 'DatePoint' column
            start_date: Start date as string (YYYY-MM-DD) or None for all
            end_date: End date as string (YYYY-MM-DD) or None for all
        
        Returns:
            Filtered dataframe
        """
        if start_date is None and end_date is None:
            return df
        
        df = df.copy()
        df['DatePoint'] = pd.to_datetime(df['DatePoint'], errors='coerce')
        
        if start_date:
            df = df[df['DatePoint'] >= pd.to_datetime(start_date)]
        
        if end_date:
            df = df[df['DatePoint'] <= pd.to_datetime(end_date)]
        
        return df
    
    @staticmethod
    def filter_by_regions(df: pd.DataFrame, regions: List[str]) -> pd.DataFrame:
        """
        Filter dataframe by selected regions.
        
        Args:
            df: Input dataframe with 'Regions' column
            regions: List of region names to include
        
        Returns:
            Filtered dataframe
        """
        if not regions:
            return df
        
        return df[df['Regions'].isin(regions)].copy()
    
    @staticmethod
    def filter_by_currency(df: pd.DataFrame, currency: str) -> pd.DataFrame:
        """
        Filter dataframe by currency (for equity data).
        
        Args:
            df: Input dataframe with optional 'Currency' column
            currency: Currency code (EUR, USD, etc.)
        
        Returns:
            Filtered dataframe
        """
        if 'Currency' not in df.columns:
            return df
        
        return df[df['Currency'] == currency].copy()
    
    @staticmethod
    def format_for_recharts(df: pd.DataFrame, group_col: str = 'Regions') -> List[Dict[str, Any]]:
        """
        Format dataframe for Recharts consumption.
        
        When multiple regions exist, pivots data so each region's metrics become separate columns.
        This allows multiple lines per chart for each region.
        
        Args:
            df: Input dataframe with 'DatePoint', 'Regions', and metric columns
            group_col: Column to use as grouping (usually 'Regions')
        
        Returns:
            List of dicts suitable for Recharts (pivoted by region)
        """
        if df.empty:
            return []
        
        df = df.copy()
        df['DatePoint'] = pd.to_datetime(df['DatePoint'])
        df = df.sort_values('DatePoint')
        
        # Check if we have multiple regions
        unique_regions = df.get(group_col, pd.Series()).unique()
        has_multiple_regions = len(unique_regions) > 1
        
        if not has_multiple_regions:
            # Single region: use original format
            records = df.to_dict('records')
            for record in records:
                record['DatePoint'] = record['DatePoint'].strftime('%Y-%m-%d')
                # Remove NaN values to clean up JSON
                for key in list(record.keys()):
                    if pd.isna(record.get(key)):
                        del record[key]
            return records
        
        # Multiple regions: pivot so each region's metrics become separate columns
        # Get all metric columns (everything except DatePoint, Regions, Currency)
        metric_cols = [col for col in df.columns if col not in ['DatePoint', group_col, 'Currency', 'Name', 'Ticker']]
        
        # Pivot: index=DatePoint, columns=Regions, values=metrics
        pivoted_data = []
        for date in df['DatePoint'].unique():
            date_data = df[df['DatePoint'] == date]
            row = {'DatePoint': date.strftime('%Y-%m-%d')}
            
            for region in unique_regions:
                region_data = date_data[date_data[group_col] == region]
                if not region_data.empty:
                    region_record = region_data.iloc[0]
                    
                    # Add region name as column header for PX_LAST (for PerformanceChart compatibility)
                    if 'PX_LAST' in region_record:
                        row[region] = region_record['PX_LAST']
                    
                    # Add region-prefixed columns for all metrics
                    for col in metric_cols:
                        if col in region_record and pd.notna(region_record[col]):
                            row[f'{region}_{col}'] = region_record[col]
            
            pivoted_data.append(row)
        
        return pivoted_data
    
    @staticmethod
    def get_numerical_columns_excluding_avg(data: List[Dict[str, Any]]) -> List[str]:
        """
        Extract unique metric column names from the data, excluding columns with '_avg_' in their name.
        
        Handles both single-region format (col_name) and multi-region format (Region_col_name).
        Returns base metric names without region prefixes or region name columns.
        
        Args:
            data: List of dictionaries containing the data (output from format_for_recharts)
        
        Returns:
            List of unique base column/metric names that are numerical
        """
        if not data or len(data) == 0:
            return []
        
        # Get all keys from first few records to handle sparse data
        all_keys = set()
        for record in data[:min(3, len(data))]:
            all_keys.update(record.keys())
        
        # Exclude standard non-data columns and metadata
        exclude_cols = {'DatePoint', 'Regions', 'Currency', 'Name', 'date', 'date_str', 'Ticker'}
        
        # Separate region-prefixed columns from non-prefixed ones
        region_names = set()
        prefixed_metrics = {}  # {metric_name: set(regions)}
        base_metrics = set()
        
        for col in all_keys:
            # Skip excluded columns
            if col in exclude_cols:
                continue
            
            # Skip columns with '_avg_' in the name
            if '_avg_' in col.lower():
                continue
            
            # Check if this is a region-prefixed column (Region_Metric format)
            if '_' in col:
                parts = col.split('_')
                if len(parts) >= 2:
                    potential_region = parts[0]
                    potential_metric = '_'.join(parts[1:])  # Handle metrics with underscores like "MACD_Signal"
                    
                    # If first part is capitalized and looks like a region name
                    if potential_region and potential_region[0].isupper():
                        # This is likely a region-prefixed column
                        region_names.add(potential_region)
                        metric_key = f'_{potential_metric}'
                        if metric_key not in prefixed_metrics:
                            prefixed_metrics[metric_key] = set()
                        prefixed_metrics[metric_key].add(potential_region)
                        continue
            
            # Non-prefixed columns are base metrics or region names
            base_metrics.add(col)
        
        # Extract final metrics: use region-prefixed metrics (those with underscores) if present,
        # otherwise use base metrics, but exclude pure region names
        final_metrics = set()
        
        # Add region-prefixed metric names (without the underscore prefix we added)
        for metric_key in prefixed_metrics.keys():
            metric_name = metric_key.lstrip('_')
            final_metrics.add(metric_name)
        
        # Add base metrics that aren't region names
        for metric in base_metrics:
            if metric not in region_names:
                final_metrics.add(metric)
        
        # Filter to only numerical columns
        numerical_metrics = []
        for metric in final_metrics:
            try:
                # Get sample values from multiple records
                sample_values = []
                for record in data[:min(10, len(data))]:
                    # Try to find the value in the record
                    val = None
                    
                    # Direct match
                    if metric in record:
                        val = record[metric]
                    else:
                        # Look for region-prefixed version
                        for key in record.keys():
                            if key.endswith(f'_{metric}'):
                                val = record[key]
                                break
                    
                    if val is not None and (isinstance(val, (int, float)) or (isinstance(val, str) and str(val).strip())):
                        sample_values.append(val)
                
                if not sample_values:
                    continue
                
                # Check if majority of sample values are numeric
                numeric_count = 0
                for val in sample_values:
                    if isinstance(val, (int, float)):
                        numeric_count += 1
                    elif isinstance(val, str):
                        try:
                            float(val)
                            numeric_count += 1
                        except (ValueError, TypeError):
                            pass
                
                # If at least 50% are numeric, include this column
                if numeric_count >= len(sample_values) * 0.5:
                    numerical_metrics.append(metric)
            except Exception as e:
                logger.debug(f"Error checking metric {metric}: {e}")
                pass
        
        # Sort alphabetically for consistency
        return sorted(numerical_metrics)
    
    @staticmethod
    def get_equity_data(
        regions: List[str],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        lookback: str = "1Y",
        show_averages: bool = False,
        currency: str = "EUR"
    ) -> Dict[str, Any]:
        """
        Get filtered and formatted equity data for Countries page.
        Fetches from Bloomberg database and calculates technical indicators.
        
        Args:
            regions: List of countries/regions to include
            start_date: Start date (YYYY-MM-DD) or None for all
            end_date: End date (YYYY-MM-DD) or None for all
            lookback: Lookback period for rolling calculations (1Y, 3Y, 5Y, All)
            show_averages: Whether to include rolling average indicators
            currency: Currency filter (EUR, USD)
        
        Returns:
            Dict with formatted chart data ready for Recharts
        """
        # Check cache first
        cache_key = LänderDataService._get_cache_key('equity', regions, lookback=lookback, currency=currency)
        cached = LänderDataService._get_cached_response(cache_key)
        if cached:
            return cached
        
        try:
            # Map regions to MSCI tickers (Bloomberg ticker symbols from ticker_master)
            region_to_ticker = {
                "Germany": "M1DE Index",          # MSCI Germany
                "France": "NDDUFR Index",         # MSCI France
                "Italy": "NDDUIT Index",          # MSCI Italy
                "Spain": "NDDUSP Index",          # MSCI Spain
                "UK": "NDDUUK Index",             # MSCI UK
                # Note: Netherlands, Belgium, Austria, Greece, Portugal not available in Bloomberg
            }
            
            # Get relevant tickers for selected regions
            tickers = [region_to_ticker.get(r, r) for r in regions if r in region_to_ticker]
            
            if not tickers:
                logger.warning(f"No valid MSCI tickers found for regions: {regions}")
                return {
                    "status": "error",
                    "data": [],
                    "metadata": {"error": "No valid regions found"}
                }
            
            # Fetch data from database
            db = DatabaseGateway()
            
            # Parse dates for database query
            db_start_date = None
            db_end_date = None
            
            if start_date:
                db_start_date = pd.to_datetime(start_date)
            if end_date:
                db_end_date = pd.to_datetime(end_date)
            
            # Fetch Bloomberg data
            df = db.fetch_equity_data(
                start_date=db_start_date,
                end_date=db_end_date,
                tickers=tickers
            )
            
            # Fallback to mock data if database fetch failed or returned no data
            if df.empty:
                logger.info(f"Database query returned no data. Using fallback mock data for regions: {regions}")
                df = LänderDataService._generate_fallback_equity_data(regions, days=252)
                use_fallback = True
            else:
                use_fallback = False
            
            # Process the data
            df = df.copy()
            
            # Convert DatePoint to datetime
            df['DatePoint'] = pd.to_datetime(df['DatePoint'])
            
            # Different processing based on data source
            if not use_fallback:
                # Bloomberg data: requires ticker mapping and pivoting
                df.rename(columns={'Ticker': 'Regions'}, inplace=True)
                
                # Map ticker back to region name
                ticker_to_region = {v: k for k, v in region_to_ticker.items()}
                df['Regions'] = df['Regions'].map(ticker_to_region)
                
                # Filter by currency
                if 'Currency' in df.columns:
                    df = df[df['Currency'] == currency]
                
                # Pivot data to have one row per date per region with all fields as columns
                df_pivot = df.pivot_table(
                    index=['DatePoint', 'Regions', 'Currency'],
                    columns='FieldName',
                    values='ValueAsString',
                    aggfunc='first'
                ).reset_index()
                
                # Convert numeric columns (handle comma as decimal separator from database)
                numeric_cols = ['PX_LAST', 'PE_RATIO', 'PX_TO_BOOK_RATIO', 'IS_DIL_EPS_CONT_OPS']
                for col in numeric_cols:
                    if col in df_pivot.columns:
                        # Replace comma with period for numeric conversion (database uses comma as decimal separator)
                        df_pivot[col] = df_pivot[col].astype(str).str.replace(',', '.', regex=False)
                        df_pivot[col] = pd.to_numeric(df_pivot[col], errors='coerce')
            else:
                # Fallback data: already in correct format
                df_pivot = df.copy()
                df_pivot['Currency'] = currency  # Add currency column
                
                # Ensure PX_LAST is numeric
                if 'PX_LAST' in df_pivot.columns:
                    df_pivot['PX_LAST'] = pd.to_numeric(df_pivot['PX_LAST'], errors='coerce')
            
            # Calculate technical indicators for each price series
            for region in df_pivot['Regions'].unique():
                region_mask = df_pivot['Regions'] == region
                region_data = df_pivot[region_mask].copy()
                region_data = region_data.sort_values('DatePoint')
                
                # Calculate indicators
                if 'PX_LAST' in region_data.columns:
                    indicators_df = TechnicalIndicatorCalculator.apply_all_indicators(
                        region_data,
                        price_column='PX_LAST'
                    )
                    df_pivot.loc[region_mask, indicators_df.columns] = indicators_df
            
            # Apply date range filters
            df_pivot = LänderDataService.filter_by_date_range(df_pivot, start_date, end_date)
            
            # Sort by date descending
            df_pivot = df_pivot.sort_values('DatePoint', ascending=False)
            
            # Format for Recharts
            data = LänderDataService.format_for_recharts(df_pivot)
            
            result = {
                "status": "ok",
                "data": data,
                "metadata": {
                    "regions": regions,
                    "currency": currency,
                    "lookback": lookback,
                    "date_range": {"start": start_date, "end": end_date},
                    "record_count": len(data),
                    "source": "Mock Data (Development)" if use_fallback else "Bloomberg"
                }
            }
            
            # Cache the result
            LänderDataService._set_cached_response(cache_key, result)
            return result
        
        except Exception as e:
            logger.error(f"✗ Error fetching equity data: {e}")
            return {
                "status": "error",
                "data": [],
                "metadata": {"error": str(e)}
            }
    
    @staticmethod
    def get_fixed_income_data(
        regions: List[str],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        lookback: str = "1Y",
        show_averages: bool = False
    ) -> Dict[str, Any]:
        """
        Get filtered and formatted fixed income data for Countries page.
        Fetches yield curve and spread data from market_data database.
        
        Args:
            regions: List of countries/regions to include
            start_date: Start date (YYYY-MM-DD) or None for all
            end_date: End date (YYYY-MM-DD) or None for all
            lookback: Lookback period for rolling calculations
            show_averages: Whether to include rolling average indicators
        
        Returns:
            Dict with formatted chart data ready for Recharts
        """
        # Check cache first
        cache_key = LänderDataService._get_cache_key('fixed_income', regions, lookback=lookback)
        cached = LänderDataService._get_cached_response(cache_key)
        if cached:
            return cached
        
        try:
            # Fetch data from database
            db = DatabaseGateway()
            
            # Parse dates for database query
            db_start_date = None
            db_end_date = None
            
            if start_date:
                db_start_date = pd.to_datetime(start_date)
            if end_date:
                db_end_date = pd.to_datetime(end_date)
            
            # Fetch market data - use fallback immediately since database is likely not available
            logger.info(f"Generating fixed income data for regions: {regions}")
            df = LänderDataService._generate_fallback_fixed_income_data(regions, days=252)
            use_fallback = True
            
            # Fallback data: already in correct format
            df_pivot = df.copy()
            
            # Convert numeric columns
            yield_cols = ['3M Yields', '2Y Yields', '5Y Yields', '10Y Yields', '20Y Yields']
            for col in yield_cols:
                if col in df_pivot.columns:
                    df_pivot[col] = pd.to_numeric(df_pivot[col], errors='coerce')
            
            # Calculate yield curve metrics for each region
            for region in df_pivot['Regions'].unique():
                region_mask = df_pivot['Regions'] == region
                region_data = df_pivot[region_mask].copy()
                
                # Calculate Steepness (10Y - 2Y)
                if '10Y Yields' in region_data.columns and '2Y Yields' in region_data.columns:
                    df_pivot.loc[region_mask, 'Steepness'] = (
                        region_data['10Y Yields'] - region_data['2Y Yields']
                    )
                
                # Calculate Curvature: (20Y - 10Y) - (10Y - 5Y)
                if ('20Y Yields' in region_data.columns and '10Y Yields' in region_data.columns 
                    and '5Y Yields' in region_data.columns):
                    df_pivot.loc[region_mask, 'Curvature'] = (
                        (region_data['20Y Yields'] - region_data['10Y Yields']) -
                        (region_data['10Y Yields'] - region_data['5Y Yields'])
                    )
                
                # Calculate Level (average yield)
                if '10Y Yields' in region_data.columns:
                    df_pivot.loc[region_mask, 'Level'] = region_data['10Y Yields']
            
            # Apply date range filters
            df_pivot = LänderDataService.filter_by_date_range(df_pivot, start_date, end_date)
            
            # Sort by date descending
            df_pivot = df_pivot.sort_values('DatePoint', ascending=False)
            
            # Format for Recharts with multi-region pivoting
            data = LänderDataService.format_for_recharts(df_pivot)
            
            result = {
                "status": "ok",
                "data": data,
                "metadata": {
                    "regions": regions,
                    "lookback": lookback,
                    "date_range": {"start": start_date, "end": end_date},
                    "record_count": len(data),
                    "source": "Mock Data (Development)" if use_fallback else "Market Data"
                }
            }
            
            # Cache the result
            LänderDataService._set_cached_response(cache_key, result)
            return result
        
        except Exception as e:
            logger.error(f"✗ Error fetching fixed income data: {e}")
            return {
                "status": "error",
                "data": [],
                "metadata": {"error": str(e)}
            }
    
    @staticmethod
    def get_macro_data(
        regions: List[str],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        lookback: str = "1Y",
        show_averages: bool = False
    ) -> Dict[str, Any]:
        """
        Get filtered and formatted macro data for Countries page.
        Fetches economic indicators (PMI, interest rates, inflation, etc.).
        
        Args:
            regions: List of countries/regions to include
            start_date: Start date (YYYY-MM-DD) or None for all
            end_date: End date (YYYY-MM-DD) or None for all
            lookback: Lookback period for rolling calculations
            show_averages: Whether to include rolling average indicators
        
        Returns:
            Dict with formatted chart data ready for Recharts
        """
        # Check cache first
        cache_key = LänderDataService._get_cache_key('macro', regions, lookback=lookback)
        cached = LänderDataService._get_cached_response(cache_key)
        if cached:
            return cached
        
        try:
            # Generate fallback data immediately since database is likely not available
            logger.info(f"Generating macro data for regions: {regions}")
            df = LänderDataService._generate_fallback_macro_data(regions, days=252)
            use_fallback = True
            
            # Fallback data: already in correct format
            df_pivot = df.copy()
            
            # Apply date range filters
            df_pivot = LänderDataService.filter_by_date_range(df_pivot, start_date, end_date)
            
            # Sort by date descending
            df_pivot = df_pivot.sort_values('DatePoint', ascending=False)
            
            # Format for Recharts with multi-region pivoting
            data = LänderDataService.format_for_recharts(df_pivot)
            
            result = {
                "status": "ok",
                "data": data,
                "metadata": {
                    "regions": regions,
                    "lookback": lookback,
                    "date_range": {"start": start_date, "end": end_date},
                    "record_count": len(data),
                    "source": "Mock Data (Development)" if use_fallback else "Market Data"
                }
            }
            
            # Cache the result
            LänderDataService._set_cached_response(cache_key, result)
            return result
        
        except Exception as e:
            logger.error(f"✗ Error fetching macro data: {e}")
            return {
                "status": "error",
                "data": [],
                "metadata": {"error": str(e)}
            }
