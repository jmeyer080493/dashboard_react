"""
Laender/Countries page data service - V2

Rewritten to follow the reference project (C:/Projekte/dashboard) architecture:
1. Query Bloomberg in LONG format  
2. Merge with region mapping
3. Calculate technical indicators per region per currency
4. Return as wide-format DataFrames (one row per Date+Region with all metrics as columns)
5. NO mock/fallback data - all real Bloomberg data or error
6. Extensive debugging for migration tracking
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# Import database gateway
from utils.database import DatabaseGateway
from config.settings import USE_SYNTHETIC_DATA


def _generate_synthetic_equity_data(
    tickers: List[str],
    start_date: datetime,
    end_date: datetime
) -> pd.DataFrame:
    """
    Generate synthetic equity price data for testing/demo purposes.

    Returns a DataFrame with columns: DatePoint, Value, FieldName, Ticker, Currency
    """
    rows = []
    current = start_date.date() if isinstance(start_date, datetime) else start_date
    end = end_date.date() if isinstance(end_date, datetime) else end_date
    
    # Generate base prices per ticker (seeded for consistency)
    np.random.seed(42)
    base_prices = {}
    for ticker in tickers:
        base_prices[ticker] = np.random.uniform(80, 150)
    
    while current <= end:
        # Skip weekends
        if current.weekday() < 5:  # Monday=0, Friday=4
            for ticker in tickers:
                # Generate PX_LAST with realistic drift
                base = base_prices[ticker]
                daily_return = np.random.normal(0.0003, 0.015)  # ~0.03% mean, 1.5% std
                price = base * (1 + daily_return)
                
                rows.append({
                    "DatePoint": current,
                    "Value": round(price, 4),
                    "FieldName": "PX_LAST",
                    "Ticker": ticker,
                    "Currency": "EUR",  # Default to EUR for synthetic data
                })
        
        current = current + timedelta(days=1)
    
    if not rows:
        return pd.DataFrame(columns=["DatePoint", "Value", "FieldName", "Ticker", "Currency"])
    
    df = pd.DataFrame(rows)
    df["DatePoint"] = pd.to_datetime(df["DatePoint"])
    logger.info("Generated %d synthetic equity price rows for %d tickers", len(df), len(tickers))
    return df


class EquityIndicatorCalculator:
    """Calculate technical indicators for equity data following reference project specifications."""
    
    @staticmethod
    def calculate_from_px_last(
        df: pd.DataFrame,
        ticker_name: str,
        currency: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculate all technical indicators from PX_LAST price series.
        
        Args:
            df: DataFrame with DatePoint and PX_LAST columns, sorted by DatePoint ascending
            ticker_name: Name of the ticker (for reference)
            currency: Currency code (for reference)
        
        Returns:
            Dictionary with calculated indicators {indicator_name: Series}
        """
        if 'PX_LAST' not in df.columns:
            logger.warning(f"  ⚠ No PX_LAST column for {ticker_name} {currency or 'N/A'}")
            return {}
        
        prices = df['PX_LAST'].dropna()
        if len(prices) < 50:
            logger.debug(f"  ⚠ Insufficient price data ({len(prices)} points) for {ticker_name}")
            return {}
        
        indicators = {}
        
        try:
            # Moving averages
            indicators['MA_50'] = prices.rolling(window=50, min_periods=1).mean()
            
            # MACD
            ema12 = prices.ewm(span=12, adjust=False).mean()
            ema26 = prices.ewm(span=26, adjust=False).mean()
            indicators['MACD'] = ema12 - ema26
            
            # RSI (14-period)
            delta = prices.diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            avg_gain = gain.rolling(window=14, min_periods=1).mean()
            avg_loss = loss.rolling(window=14, min_periods=1).mean()
            rs = avg_gain / avg_loss.replace(0, np.nan)
            indicators['RSI'] = 100 - (100 / (1 + rs))
            indicators['RSI'] = indicators['RSI'].fillna(50)  # Default to 50 if not calculable
            
            # rolling lookback = 126 trading days (DATA_LOOKBACK_SHORT), mirroring original dashboard
            ROLLING_LOOKBACK = 126

            # Momentum indicators
            # 3-month: (price[t-21] / price[t-63] - 1) * 100
            indicators['MOM_3'] = (prices.shift(21) / prices.shift(63) - 1) * 100
            
            # 12-month: (price[t-21] / price[t-ROLLING_LOOKBACK] - 1) * 100
            # Original: DATA_LOOKBACK_SHORT = 126 trading days (~6 months)
            indicators['MOM_12'] = (prices.shift(21) / prices.shift(ROLLING_LOOKBACK) - 1) * 100
            
            # Time Series momentum: EWMA of ROLLING_LOOKBACK-period price change, alpha=0.03 (1-0.97)
            # Mirrors original: mom_ts = s.pct_change(rolling_lookback); ewm(alpha=1-0.97)
            price_change_lb = prices.pct_change(ROLLING_LOOKBACK)
            indicators['MOM_TS'] = price_change_lb.ewm(alpha=0.03, adjust=False).mean() * 100
            
            # Volatility: rolling(ROLLING_LOOKBACK).std() * sqrt(ROLLING_LOOKBACK)
            # Mirrors original: rolling(window=rolling_lookback).std() * (rolling_lookback ** 0.5) * 100
            returns = prices.pct_change()
            rolling_std = returns.rolling(window=ROLLING_LOOKBACK, min_periods=1).std()
            indicators['Rolling Volatility'] = rolling_std * np.sqrt(ROLLING_LOOKBACK) * 100
            
            # Sharpe ratio (rolling, risk-free rate = 2.5%)
            rolling_returns = returns.rolling(window=252, min_periods=1).mean()
            indicators['Rolling Sharpe'] = (rolling_returns * 252 - 0.025) / (indicators['Rolling Volatility'] / 100).replace(0, np.nan)
            indicators['Rolling Sharpe'] = indicators['Rolling Sharpe'].fillna(0)
            
            # Rolling returns (252-day window)
            indicators['Rolling Returns'] = (prices.pct_change(periods=252) * 100).fillna(0)

            # MA50 Distance: (price - MA50) / MA50 * 100
            if 'MA_50' in indicators:
                indicators['MA_50_Diff'] = ((prices - indicators['MA_50']) / indicators['MA_50'].replace(0, np.nan) * 100)

            # Performance: cumulative return since first available price (basis 0, in %)
            first_valid_price = prices.dropna().iloc[0] if len(prices.dropna()) > 0 else np.nan
            if not np.isnan(first_valid_price) and first_valid_price != 0:
                indicators['Performance'] = ((prices / first_valid_price) - 1) * 100

            logger.debug(f"  ✓ Calculated {len(indicators)} indicators for {ticker_name}")
            
        except Exception as e:
            logger.error(f"  ✗ Error calculating indicators for {ticker_name}: {e}")
            return {}
        
        return indicators


class LänderDataService:
    """
    Service for Länder/Countries page data operations - V2.
    Follows reference project architecture: Bloomberg query → Region mapping → Indicators → Wide format.
    
    Dynamically discovers ticker-to-region mappings from the [ApoAsset_Quant].[dbo].[ticker_master] table
    for MSCI indices (M1*, NDDU* tickers) used in the Countries dashboard.
    """
    
    # Cache for dynamically discovered region mappings
    _ticker_to_region_cache = None
    _cache_initialized = False

    # Cache for FI ticker mapping
    _fi_ticker_mapping_cache: Optional[pd.DataFrame] = None
    _fi_cache_initialized: bool = False
    
    # Region name aliases - normalize incoming region names to database names
    REGION_ALIASES = {
        "US": "U.S.",
        "USA": "U.S.",
        "United States": "U.S.",
        "America": "U.S.",
        "UK": "UK",
        "United Kingdom": "UK",
        "GB": "UK",
        "Great Britain": "UK",
    }
    
    @classmethod
    def _get_ticker_to_region_mapping(cls) -> Dict[str, str]:
        """
        Dynamically load ticker-to-region mapping from ticker_master table.
        
        Caches the result for performance. Queries the [ApoAsset_Quant].[dbo].[ticker_master] table
        for MSCI equity indices (M1*, NDDU*) configured for the Countries dashboard.
        
        Returns:
            Dictionary mapping Bloomberg ticker symbols to region names
        """
        # Return cached mapping if already loaded
        if cls._cache_initialized and cls._ticker_to_region_cache is not None:
            return cls._ticker_to_region_cache
        
        try:
            from utils.database import DatabaseGateway
            
            db = DatabaseGateway()
            engine = db.get_prod_engine()
            
            # Query ticker_master for MSCI indices in Countries dashboard
            query = """
            SELECT Ticker, Regions
            FROM [ApoAsset_Quant].[dbo].[ticker_master]
            WHERE [Dashboard Page] = 'Countries'
              AND Active IN (1.0, 2.0)
              AND (Ticker LIKE 'M1%' OR Ticker LIKE 'NDDU%')
            ORDER BY Regions, Ticker
            """
            
            df = pd.read_sql_query(query, engine)
            
            if df.empty:
                logger.warning("⚠ No MSCI tickers found in ticker_master table - using fallback")
                # Fallback to hardcoded mapping if table query fails
                cls._ticker_to_region_cache = {
                    "M1DE Index": "Germany",
                    "NDDUFR Index": "France",
                    "NDDUIT Index": "Italy",
                    "NDDUSP Index": "Spain",
                    "NDDUUK Index": "UK",
                    "NDDUUS Index": "U.S.",
                    "NDDUE15 Index": "Europe",
                    "M1JP Index": "Japan",
                    "M1CN Index": "China",
                    "M1IN Index": "India",
                    "M1EF Index": "EM",
                }
            else:
                # Build mapping from query results
                cls._ticker_to_region_cache = dict(zip(df['Ticker'], df['Regions']))
                logger.info(f"✓ Loaded {len(cls._ticker_to_region_cache)} MSCI ticker mappings from database")
                logger.debug(f"  Regions: {sorted(set(cls._ticker_to_region_cache.values()))}")
            
            cls._cache_initialized = True
            return cls._ticker_to_region_cache
            
        except Exception as e:
            logger.error(f"✗ Error loading ticker mappings from database: {e}")
            # Fallback to hardcoded mapping
            cls._ticker_to_region_cache = {
                "M1DE Index": "Germany",
                "NDDUFR Index": "France",
                "NDDUIT Index": "Italy",
                "NDDUSP Index": "Spain",
                "NDDUUK Index": "UK",
                "NDDUUS Index": "U.S.",
                "NDDUE15 Index": "Europe",
                "M1JP Index": "Japan",
                "M1CN Index": "China",
                "M1IN Index": "India",
                "M1EF Index": "EM",
            }
            cls._cache_initialized = True
            return cls._ticker_to_region_cache
    
    @classmethod
    def get_available_regions(cls) -> List[str]:
        """
        Get list of available regions from the dynamic ticker mapping.
        
        Returns:
            Sorted list of region names available in the system
        """
        mapping = cls._get_ticker_to_region_mapping()
        return sorted(list(set(mapping.values())))
    
    @staticmethod
    def _normalize_region_name(region: str) -> str:
        """
        Normalize region name to match database naming conventions.
        
        Args:
            region: Region name (e.g., "US", "U.S.", "USA")
        
        Returns:
            Normalized region name (e.g., "U.S.")
        """
        # First check if it's already in our loaded mapping values
        mapping = LänderDataService._get_ticker_to_region_mapping()
        if region in mapping.values():
            return region
        
        # Check aliases
        if region in LänderDataService.REGION_ALIASES:
            return LänderDataService.REGION_ALIASES[region]
        
        # Return as-is (case-sensitive)
        return region
    
    @staticmethod
    def _get_bloomberg_equity_data(
        tickers: List[str],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.DataFrame:
        """
        Query Bloomberg database for equity data in LONG format.
        
        Args:
            tickers: List of Bloomberg ticker symbols (e.g., "M1DE Index")
            start_date: Start date (default: 4 years ago)
            end_date: End date (default: today)
        
        Returns:
            DataFrame with columns: DatePoint, Value, FieldName, Ticker, Currency
        """
        if not tickers:
            logger.warning("No tickers provided to _get_bloomberg_equity_data")
            return pd.DataFrame()
        
        if start_date is None:
            start_date = datetime.now() - timedelta(days=1460)  # 4 years
        if end_date is None:
            end_date = datetime.now()
        
        # Use synthetic data if flag is set
        if USE_SYNTHETIC_DATA:
            logger.info("USE_SYNTHETIC_DATA is True – generating synthetic equity data")
            return _generate_synthetic_equity_data(tickers, start_date, end_date)
        
        try:
            db = DatabaseGateway()
            engine = db.get_prod_engine()
            
            # Build ticker list for SQL
            ticker_list = "', '".join(tickers)
            
            query = f"""
            SELECT 
                d.DatePoint,
                d.ValueAsString as Value_Raw,
                d.FieldName,
                e.BloombergTicker as Ticker,
                d.Currency
            FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] as d
            LEFT JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] as e
                ON d.BloombergTickerId = e.Id
            WHERE e.BloombergTicker IN ('{ticker_list}')
                AND d.Frequency = 'DAILY'
                AND TRY_CONVERT(DATETIME, d.DatePoint) >= DATEADD(DAY, -{(end_date - start_date).days}, CAST(GETDATE() AS DATE))
            ORDER BY d.DatePoint DESC, e.BloombergTicker, d.FieldName
            """
            
            logger.info(f"📊 Querying Bloomberg for {len(tickers)} tickers...")
            df = pd.read_sql_query(query, engine)
            
            if df.empty:
                logger.error("✗ Bloomberg query returned no data")
                return pd.DataFrame()
            
            logger.info(f"✓ Retrieved {len(df)} rows from Bloomberg")
            logger.debug(f"  Tickers: {df['Ticker'].nunique()} unique")
            logger.debug(f"  Fields: {df['FieldName'].nunique()} unique - {sorted(df['FieldName'].unique())}")
            logger.debug(f"  DateRange: {df['DatePoint'].min()} to {df['DatePoint'].max()}")
            logger.debug(f"  Currencies: {sorted(df['Currency'].dropna().unique())}")
            
            # Clean field names (strip whitespace)
            df['FieldName'] = df['FieldName'].str.strip()
            
            # Convert Value from string with comma decimal separator to float
            df['Value'] = df['Value_Raw'].astype(str).str.replace(',', '.', regex=False)
            df['Value'] = pd.to_numeric(df['Value'], errors='coerce')
            df = df.drop(columns=['Value_Raw'])
            
            # Handle duplicates: preserve ALL rows that have a non-NULL Currency
            # (both EUR and USD rows must survive so the currency filter in get_equity_data
            # can return data regardless of which currency the user selects).
            # Only deduplicate rows where Currency IS NULL (rare / metadata rows).
            if 'Currency' in df.columns:
                non_null_mask = df['Currency'].notna()
                data_with_currency = df[non_null_mask]
                data_without_currency = df[~non_null_mask]

                # For null-currency rows, keep one per (DatePoint, Ticker, FieldName)
                if not data_without_currency.empty:
                    data_without_currency = data_without_currency.drop_duplicates(
                        subset=['DatePoint', 'Ticker', 'FieldName'], keep='first'
                    )

                # Combine: all rows with an explicit currency + cleaned null-currency rows
                df = pd.concat([data_with_currency, data_without_currency], ignore_index=True)
                logger.info(f"  Kept {len(data_with_currency)} rows with explicit currency, "
                            f"{len(data_without_currency)} null-currency rows (after dedup)")

            logger.info(f"✓ Cleaned {len(df)} Bloomberg rows")
            return df
            
        except Exception as e:
            logger.error(f"✗ Error querying Bloomberg: {e}", exc_info=True)
            raise
    
    @staticmethod
    def _merge_with_region_mapping(df: pd.DataFrame) -> pd.DataFrame:
        """
        Merge DataFrame with region mapping and filter to mapped regions.
        
        Args:
            df: DataFrame with Ticker column
        
        Returns:
            DataFrame with added Regions column
        """
        if df.empty:
            logger.warning("Cannot merge with region mapping - empty DataFrame")
            return df
        
        logger.info("🗺️  Mapping tickers to regions...")
        
        df = df.copy()
        ticker_mapping = LänderDataService._get_ticker_to_region_mapping()
        df['Regions'] = df['Ticker'].map(ticker_mapping)
        
        missing = df[df['Regions'].isna()]['Ticker'].unique()
        if len(missing) > 0:
            logger.warning(f"⚠ {len(missing)} tickers have no region mapping: {missing}")
        
        # Filter to only mapped regions
        df = df[df['Regions'].notna()]
        
        logger.info(f"✓ Mapped data to {df['Regions'].nunique()} regions")
        logger.debug(f"  Regions: {sorted(df['Regions'].unique())}")
        
        return df
    
    @staticmethod
    def _calculate_all_indicators(df: pd.DataFrame, requested_currency: str = "EUR") -> pd.DataFrame:
        """
        Calculate technical indicators for all ticker+currency combinations.
        
        Args:
            df: Long-format DataFrame with PX_LAST and other metrics
            requested_currency: The primary currency requested (used to align currency-independent fields)
        
        Returns:
            Wide-format DataFrame with one row per (DatePoint, Regions, Name) with all metrics as columns
        """
        logger.info("⚡ Calculating technical indicators...")
        
        if df.empty:
            logger.warning("Cannot calculate indicators - empty DataFrame")
            return df
        
        # Define currency-independent fields (metrics that don't depend on currency)
        CURRENCY_INDEPENDENT_FIELDS = {
            'PE_RATIO', 'PX_TO_BOOK_RATIO', 'PX_TO_SALES_RATIO', 
            'EARN_YLD', 'BEST_PE_RATIO', 'IS_DIL_EPS_CONT_OPS',
            'DIV_YLD', 'EQY_DVD_YLD_IND',   # Dividend Yield Bloomberg fields
            'BEST_EPS_GROWTH',                # Earnings growth rate Bloomberg field
        }
        
        # Normalize currency for currency-independent fields to match the requested currency
        # These fields typically only exist in USD but should be treated as if they're in the requested currency
        df = df.copy()
        mask = df['FieldName'].isin(CURRENCY_INDEPENDENT_FIELDS)
        if mask.any():
            df.loc[mask, 'Currency'] = requested_currency
            logger.info(f"✓ Normalized currency for {mask.sum()} currency-independent field rows to {requested_currency}")
        
        # Separate PX_LAST for indicator calculation
        px_data = df[df['FieldName'] == 'PX_LAST'].copy()
        if px_data.empty:
            logger.error("✗ No PX_LAST data found for indicator calculation")
            return df
        
        # Rename Value to PX_LAST for clarity
        px_data = px_data.rename(columns={'Value': 'PX_LAST'})
        
        # Build list of (Ticker, Currency) combinations that have price data
        ticker_currency_pairs = px_data[['Ticker', 'Regions', 'Currency']].drop_duplicates().dropna()
        logger.info(f"  Processing {len(ticker_currency_pairs)} ticker+currency combinations...")
        
        # Calculate indicators for each ticker+currency combination
        indicator_rows = []
        
        for _, row in ticker_currency_pairs.iterrows():
            ticker = row['Ticker']
            region = row['Regions']
            currency = row['Currency']
            
            # Get price series for this ticker+currency
            mask = (px_data['Ticker'] == ticker) & (px_data['Currency'] == currency)
            price_df = px_data[mask][['DatePoint', 'PX_LAST']].copy()
            price_df['DatePoint'] = pd.to_datetime(price_df['DatePoint'])
            price_df = price_df.sort_values('DatePoint').reset_index(drop=True)
            
            if price_df.empty or len(price_df) < 50:
                logger.debug(f"  ⚠ Skipping {region} {currency}: insufficient data ({len(price_df)} points)")
                continue
            
            # Calculate all indicators
            indicators = EquityIndicatorCalculator.calculate_from_px_last(
                price_df, f"{ticker}", currency
            )
            
            if not indicators:
                continue
            
            # Create a row for each date with calculated indicators
            for idx, date in enumerate(price_df['DatePoint']):
                ind_row = {
                    'DatePoint': date,
                    'Ticker': ticker,
                    'Regions': region,
                    'Currency': currency,
                }
                
                # Add indicator values at this index
                for ind_name, ind_series in indicators.items():
                    if idx < len(ind_series):
                        ind_row[ind_name] = ind_series.iloc[idx]
                    else:
                        ind_row[ind_name] = np.nan
                
                indicator_rows.append(ind_row)
        
        if not indicator_rows:
            logger.error("✗ No indicators could be calculated")
            return df
        
        indicator_df = pd.DataFrame(indicator_rows)
        logger.info(f"✓ Calculated indicators for {len(indicator_df)} date+ticker+currency combinations")
        
        # Now pivot the original metrics data to wide format
        # Remove PX_LAST since we added it from indicators
        other_fields = df[df['FieldName'] != 'PX_LAST'].copy()
        
        wide_df = other_fields.pivot_table(
            index=['DatePoint', 'Ticker', 'Regions', 'Currency'],
            columns='FieldName',
            values='Value',
            aggfunc='first'
        ).reset_index()
        
        # Convert DatePoint to datetime
        wide_df['DatePoint'] = pd.to_datetime(wide_df['DatePoint'])
        
        # Add back PX_LAST from price data (already renamed to PX_LAST column)
        px_wide = px_data.pivot_table(
            index=['DatePoint', 'Ticker', 'Regions', 'Currency'],
            values='PX_LAST',
            aggfunc='first'
        ).reset_index()
        
        # Ensure all DatePoints are datetime type
        px_wide['DatePoint'] = pd.to_datetime(px_wide['DatePoint'])
        
        # Merge metrics with PX_LAST
        wide_df = pd.merge(wide_df, px_wide, on=['DatePoint', 'Ticker', 'Regions', 'Currency'], how='outer')
        
        # Merge with calculated indicators (which already has datetime DatePoint)
        final_df = pd.merge(
            wide_df,
            indicator_df,
            on=['DatePoint', 'Ticker', 'Regions', 'Currency'],
            how='left'
        )
        
        # Add a Name column (human-readable ticker name)
        ticker_mapping = LänderDataService._get_ticker_to_region_mapping()
        final_df['Name'] = final_df['Ticker'].map(lambda x: f"MSCI {ticker_mapping.get(x, x)}")
        
        # Sort and clean
        final_df = final_df.sort_values('DatePoint')

        # --- Derived / computed metrics post-merge ---

        # Weighted Valuation: mean(PE_RATIO, PX_TO_BOOK_RATIO, PX_TO_SALES_RATIO)
        val_cols = [c for c in ['PE_RATIO', 'PX_TO_BOOK_RATIO', 'PX_TO_SALES_RATIO'] if c in final_df.columns]
        if len(val_cols) >= 2:
            final_df['Weighted Valuation'] = final_df[val_cols].mean(axis=1)
            logger.info(f"  ✓ Computed Weighted Valuation from {val_cols}")

        # EPS Growth: cumulative growth of IS_DIL_EPS_CONT_OPS per region+currency
        if 'IS_DIL_EPS_CONT_OPS' in final_df.columns:
            def _cumulative_growth(series):
                first_valid = series.dropna().iloc[0] if len(series.dropna()) > 0 else np.nan
                if pd.isna(first_valid) or first_valid == 0:
                    return series * np.nan
                return ((series / first_valid) - 1) * 100
            final_df['EPS_Growth'] = final_df.groupby(
                ['Regions', 'Currency'], group_keys=False
            )['IS_DIL_EPS_CONT_OPS'].transform(_cumulative_growth)
            logger.info("  ✓ Computed EPS_Growth from IS_DIL_EPS_CONT_OPS")

        logger.info(f"✓ Final wide-format DataFrame: {final_df.shape}")
        logger.debug(f"  Columns: {sorted(final_df.columns)}")
        
        return final_df
    
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
        Get equity data for specified regions following reference architecture.
        
        Args:
            regions: List of region names (e.g., ["Germany", "France", "US"])
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            lookback: Lookback period (1Y, 3Y, 5Y, All)
            show_averages: Include rolling averages (currently returns all available data)
            currency: Currency filter (EUR, USD)
        
        Returns:
            Dict with status, data, and metadata
        """
        logger.info("=" * 80)
        logger.info(f"🔍 get_equity_data() called: regions={regions}, currency={currency}")
        logger.info("=" * 80)
        
        try:
            # Normalize region names (e.g., "US" -> "U.S.")
            normalized_regions = [LänderDataService._normalize_region_name(r) for r in regions]
            logger.info(f"Normalized regions: {normalized_regions}")
            
            # Map region names back to tickers
            ticker_mapping = LänderDataService._get_ticker_to_region_mapping()
            region_to_ticker = {v: k for k, v in ticker_mapping.items()}
            tickers = [region_to_ticker[r] for r in normalized_regions if r in region_to_ticker]
            
            if not tickers:
                logger.error(f"✗ No valid tickers found for regions: {normalized_regions}")
                raise ValueError(f"No valid regions: {normalized_regions}")
            
            logger.info(f"📍 Requesting tickers: {tickers}")
            
            # Query Bloomberg
            df_bloomberg = LänderDataService._get_bloomberg_equity_data(tickers)
            
            if df_bloomberg.empty:
                logger.error("✗ No Bloomberg data retrieved")
                raise ValueError("No data from Bloomberg")
            
            # Map to regions
            df_mapped = LänderDataService._merge_with_region_mapping(df_bloomberg)
            
            if df_mapped.empty:
                logger.error("✗ No data after region mapping")
                raise ValueError("No data after region mapping")
            
            # Filter to requested regions
            df_filtered = df_mapped[df_mapped['Regions'].isin(normalized_regions)].copy()
            
            if df_filtered.empty:
                logger.error(f"✗ No data for selected regions: {normalized_regions}")
                raise ValueError(f"No data for regions: {normalized_regions}")
            
            logger.info(f"✓ Filtered to {df_filtered['Regions'].nunique()} regions with {len(df_filtered)} data points")
            
            # Filter to currency - handle currency-independent fields
            # NOTE: Valuation metrics (PE_RATIO, EARN_YLD, etc.) are "currency-independent" metrics
            # and only exist in USD in the Bloomberg database. We include them from USD even when
            # EUR is requested since they represent the same economic value regardless of currency.
            if currency and 'Currency' in df_filtered.columns:
                CURRENCY_INDEPENDENT_FIELDS = {
                    'PE_RATIO', 'PX_TO_BOOK_RATIO', 'PX_TO_SALES_RATIO', 
                    'EARN_YLD', 'BEST_PE_RATIO', 'IS_DIL_EPS_CONT_OPS'
                }
                
                # Split data into currency-dependent and currency-independent
                currency_dependent = df_filtered[~df_filtered['FieldName'].isin(CURRENCY_INDEPENDENT_FIELDS)].copy()
                currency_independent = df_filtered[df_filtered['FieldName'].isin(CURRENCY_INDEPENDENT_FIELDS)].copy()
                
                # Filter currency-dependent fields to requested currency
                currency_dependent = currency_dependent[currency_dependent['Currency'] == currency].copy()
                # Keep all currency-independent fields (don't filter by currency, they only exist in USD in Bloomberg)
                
                # Recombine
                df_filtered = pd.concat([currency_dependent, currency_independent], ignore_index=True)
                
                logger.info(f"✓ Filtered to {currency} currency for price data: {len(currency_dependent)} price rows + {len(currency_independent)} ratio rows = {len(df_filtered)} total")
            
            if df_filtered.empty:
                logger.error(f"✗ No data after currency filtering")
                raise ValueError(f"No usable data remaining after currency filter")
            
            # Calculate indicators and create wide-format output
            df_final = LänderDataService._calculate_all_indicators(df_filtered, requested_currency=currency)
            
            if df_final.empty:
                logger.error("✗ Final dataframe is empty")
                raise ValueError("No data in final output")
            
            # ── ERP merge: adds Div_Yld, Grwth_Rate, Div_Pay_Ratio, Mkt_Return, RF_Rate, Premium ──
            # Mirrors original: erp = pd.read_sql_query('SELECT * FROM erp', dev_engine)
            # Merged on ['DatePoint', 'Regions'] with forward-fill so Bloomberg trading days
            # that have no exact ERP date still receive the most recent ERP values.
            try:
                erp_engine = DatabaseGateway().jm_engine
                if erp_engine is not None:
                    erp_df = pd.read_sql_query("SELECT * FROM erp", erp_engine)
                    erp_df["Date"] = pd.to_datetime(erp_df["Date"], format="%m/%d/%y", errors="coerce")
                    erp_df = erp_df.rename(columns={"Date": "DatePoint", "Country": "Regions"})
                    erp_df["DatePoint"] = pd.to_datetime(erp_df["DatePoint"])
                    erp_cols = [c for c in erp_df.columns if c not in ["DatePoint", "Regions"]]

                    # Sort both sides by date so ffill propagates correctly
                    df_final = df_final.sort_values(["Regions", "DatePoint"]).reset_index(drop=True)
                    df_final = pd.merge(df_final, erp_df, how="left", on=["DatePoint", "Regions"])

                    # Forward-fill within each region: Bloomberg trading days that have no
                    # exact ERP entry get the most recent available ERP values
                    df_final[erp_cols] = df_final.groupby("Regions", sort=False)[erp_cols].ffill()

                    filled = df_final[erp_cols[0]].notna().sum()
                    logger.info(f"✓ ERP merge added {erp_cols} columns ({filled}/{len(df_final)} rows filled after ffill)")
                else:
                    logger.warning("⚠ jm_engine not available – skipping ERP merge (Div_Yld, Grwth_Rate, Premium will be missing)")
            except Exception as erp_exc:
                logger.warning(f"⚠ ERP merge failed (non-fatal): {erp_exc}")

            # ── Rebase Performance to 0% using last-known price before start_date ──
            #
            # Finance convention for period-return charts:
            #   base_price[region] = last available price ON OR BEFORE start_date
            #
            # This means:
            # • YtD (start = Dec 31): each region anchors to its last 2025 close
            #   even if that region's exchange was closed on Dec 31 (e.g. some
            #   European markets). We look back through the full pre-filter data.
            # • 1Y / 3Y / etc.: same logic – last price on or before the anchor.
            # • All series then share the same first DISPLAY date (the common
            #   first trading day after start_date), so the chart left-edge is
            #   visually aligned.
            if 'Performance' in df_final.columns and 'PX_LAST' in df_final.columns:
                df_final = df_final.sort_values(['Regions', 'DatePoint']).reset_index(drop=True)

                # Collect base prices BEFORE trimming the date window.
                # df_final still contains the full Bloomberg history at this point.
                base_prices: dict = {}
                if start_date:
                    start_ts = pd.Timestamp(start_date)
                    for region_name, grp in df_final.groupby('Regions'):
                        pre = grp[grp['DatePoint'] <= start_ts].dropna(subset=['PX_LAST'])
                        if not pre.empty:
                            base_prices[region_name] = float(pre['PX_LAST'].iloc[-1])
                        else:
                            # No price before anchor – will fall back to first price in window
                            pass

                # Apply the user-requested date window
                if start_date:
                    df_final = df_final[df_final['DatePoint'] >= pd.Timestamp(start_date)].copy()
                if end_date:
                    df_final = df_final[df_final['DatePoint'] <= pd.Timestamp(end_date)].copy()

                df_final = df_final.sort_values(['Regions', 'DatePoint']).reset_index(drop=True)

                # Find common display start: latest first-valid-price date across regions
                # so every line begins on the exact same calendar date.
                first_dates = []
                for _, grp in df_final.groupby('Regions'):
                    valid = grp.dropna(subset=['PX_LAST'])
                    if not valid.empty:
                        first_dates.append(valid['DatePoint'].min())
                if first_dates:
                    common_display_start = max(first_dates)
                    df_final = df_final[df_final['DatePoint'] >= common_display_start].copy()
                    df_final = df_final.sort_values(['Regions', 'DatePoint']).reset_index(drop=True)
                    logger.info("✓ Common display start: %s", common_display_start)

                def _rebase_performance(group):
                    region_name = group['Regions'].iloc[0]
                    prices = group['PX_LAST'].copy()
                    # Use pre-window anchor price when available; otherwise fall back
                    # to the first price inside the window.
                    base_price = base_prices.get(region_name)
                    if base_price is None:
                        valid = prices.dropna()
                        if valid.empty:
                            group = group.copy()
                            group['Performance'] = np.nan
                            return group
                        base_price = float(valid.iloc[0])
                    if base_price == 0:
                        group = group.copy()
                        group['Performance'] = np.nan
                        return group
                    group = group.copy()
                    group['Performance'] = (prices / base_price - 1) * 100
                    return group

                df_final = df_final.groupby('Regions', group_keys=False).apply(_rebase_performance)
                logger.info("✓ Performance rebased to last-known price before start_date")

            else:
                # No Performance column or no PX_LAST – apply date filter directly
                if start_date:
                    df_final = df_final[df_final["DatePoint"] >= pd.Timestamp(start_date)]
                if end_date:
                    df_final = df_final[df_final["DatePoint"] <= pd.Timestamp(end_date)]

            if df_final.empty:
                logger.warning(f"⚠ No data after date filtering: start_date={start_date}, end_date={end_date}")
                raise ValueError("No data within the specified date range")
            
            # Convert to records for JSON serialization
            records = df_final.to_dict('records')
            
            # Convert datetime to string and NaN to None in records
            import math
            for record in records:
                if 'DatePoint' in record and hasattr(record['DatePoint'], 'isoformat'):
                    record['DatePoint'] = record['DatePoint'].isoformat()
                
                # Replace NaN values with None for JSON serialization
                for key, value in record.items():
                    if isinstance(value, float) and math.isnan(value):
                        record[key] = None
            
            result = {
                "status": "ok",
                "data": records,
                "metadata": {
                    "regions": regions,
                    "currency": currency,
                    "lookback": lookback,
                    "record_count": len(records),
                    "source": "Bloomberg",
                    "debug": {
                        "initial_rows": len(df_bloomberg),
                        "after_mapping": len(df_mapped),
                        "after_filtering": len(df_filtered),
                        "final_rows": len(df_final),
                        "columns": sorted(df_final.columns.tolist())
                    }
                }
            }
            
            logger.info(f"\n✅ SUCCESS: Returned {len(records)} records from {result['metadata']['debug']['final_rows']} processed rows")
            logger.info("=" * 80)
            
            return result
            
        except Exception as e:
            logger.error(f"\n❌ FAILED: {e}")
            logger.error("=" * 80, exc_info=True)
            
            return {
                "status": "error",
                "data": [],
                "metadata": {
                    "error": str(e),
                    "source": "Bloomberg"
                }
            }
    
    @staticmethod
    def get_numerical_columns_excluding_avg(data: List[Dict[str, Any]]) -> List[str]:
        """
        Get list of numerical columns from equity data, excluding rolling average columns.
        
        Args:
            data: List of data records (dictionaries)
        
        Returns:
            List of numerical column names excluding '_avg_' columns
        """
        if not data:
            return []
        
        # Get all keys from first record
        all_keys = set(data[0].keys())
        
        # Exclude non-numerical columns and rolling averages
        excluded_patterns = ['DatePoint', 'Region', 'Currency', 'Index', 'IndexName']
        
        numerical_cols = [
            col for col in sorted(all_keys)
            if not any(pattern in col for pattern in excluded_patterns) and '_avg_' not in col
        ]
        
        return numerical_cols    
    @staticmethod
    def get_master_equity_columns() -> List[str]:
        """
        Get MASTER list of all possible equity columns (technical indicators and metrics).
        
        This returns a consistent list regardless of region selection, to be used in the
        metric filter modal so checkboxes don't change when switching regions.
        
        Returns:
            List of all possible column names that could appear in equity data
        """
        # All possible columns: Bloomberg fields + ERP fields + computed indicators
        # Mirrors COLS_EQ_AGG from C:\Projekte\dashboard\countries\mapping.py
        return [
            # Trend
            'MOM_3',              # 3-Month Momentum  (price[t-21]/price[t-63]-1)*100
            'MOM_12',             # 6-Month Momentum  (price[t-21]/price[t-126]-1)*100 (name is legacy)
            'MOM_TS',             # TS-Momentum       pct_change(126).ewm(alpha=0.03)*100
            'Grwth_Rate',         # Wachstumsrate     from ERP table
            # Bewertung (Valuation)
            'Weighted Valuation', # Bewertung Agg.    mean(PE, PB, PS)
            'Premium',            # Risikoprämie      from ERP table
            'Div_Yld',            # Dividendenrendite from ERP table
            'EARN_YLD',           # Ertragsrendite    Bloomberg
            'PX_TO_SALES_RATIO',  # KUV               Bloomberg
            'PX_TO_BOOK_RATIO',   # KBV               Bloomberg
            'PE_RATIO',           # KGV               Bloomberg
            'BEST_PE_RATIO',      # KGV Fwd.          Bloomberg (graph-only, not in table)
            # Technisch (Technical)
            'Rolling Volatility', # Volatilität       rolling(126).std()*sqrt(126)*100
            'MA_50_Diff',         # MA50 Distanz      (price-MA50)/MA50*100 (graph-only)
            'RSI',                # RSI               14-period
            'MACD',               # MACD              EMA(12)-EMA(26)
            # Spezial (Special / Graph-only)
            'Performance',        # Wertentwicklung   cumulative return
            'EPS_Growth',         # Gewinnentwicklung cumulative EPS
            # Extra price / supporting columns
            'PX_LAST',            # Price
            'MA_50',              # 50-day Moving Average
            'Rolling Sharpe',     # Rolling Sharpe Ratio
            'Rolling Returns',    # Rolling Returns
        ]

    # ═══════════════════════════════════════════════════════════════════════
    # FIXED INCOME DATA METHODS
    # ═══════════════════════════════════════════════════════════════════════

    @classmethod
    def _load_fi_ticker_mapping(cls) -> pd.DataFrame:
        """Load FI ticker mapping from ticker_master table (no persistent cache so
        newly-added tickers/regions are always picked up without a server restart)."""
        try:
            db = DatabaseGateway()
            engine = db.get_duoplus_engine()
            df = pd.read_sql_query(
                """
                SELECT Ticker, Regions,
                       [Dashboard Grouping Name] AS GroupingName,
                       Period, Frequency, Fields,
                       [Database] AS DBSource
                FROM [ApoAsset_Quant].[dbo].[ticker_master]
                WHERE [Dashboard Page] = 'Countries'
                  AND [Dashboard Grouping] = 'Fixed Income'
                  AND Active = 1
                """,
                engine,
            )
            logger.info(f"✓ Loaded {len(df)} FI ticker mappings from ticker_master "
                        f"(regions: {sorted(df['Regions'].dropna().unique().tolist())})")
            return df
        except Exception as e:
            logger.error(f"✗ Failed to load FI ticker mapping: {e}", exc_info=True)
            return pd.DataFrame()

    @staticmethod
    def _generate_synthetic_fi_data(
        tickers: List[str],
        days_back: int = 1460,
    ) -> pd.DataFrame:
        """
        Generate synthetic fixed income data for testing/demo purposes.

        Returns a DataFrame with columns: DatePoint, Value, FieldName, Ticker, Currency
        """
        rows = []
        end_date = datetime.now().date()
        start_date = (datetime.now() - timedelta(days=days_back)).date()
        
        # Generate base values per ticker (seeded for consistency)
        np.random.seed(42)
        base_values = {}
        for ticker in tickers:
            # Realistic FI ranges
            if 'Yields' in ticker or 'YLD' in ticker:
                base_values[ticker] = np.random.uniform(0.5, 5.0)  # 0.5-5% yields
            elif 'CDS' in ticker:
                base_values[ticker] = np.random.uniform(20, 200)  # 20-200 bps CDS spreads
            elif 'Breakeven' in ticker or 'Inflation' in ticker:
                base_values[ticker] = np.random.uniform(1.0, 3.0)  # 1-3% inflation expectations
            else:
                base_values[ticker] = np.random.uniform(0, 100)
        
        current = start_date
        
        while current <= end_date:
            # Generate daily data for FI
            if current.weekday() < 5:  # Only trading days
                for ticker in tickers:
                    base = base_values[ticker]
                    # Daily volatility for FI (less volatile than equities)
                    daily_change = np.random.normal(0, 0.3)  # ~0.3% daily std dev
                    value = base * (1 + daily_change / 100)
                    
                    # Keep values realistic
                    if 'Yields' in ticker or 'YLD' in ticker:
                        value = max(0.1, min(8.0, value))
                    elif 'CDS' in ticker:
                        value = max(10, min(500, value))
                    elif 'Breakeven' in ticker or 'Inflation' in ticker:
                        value = max(0.5, min(5.0, value))
                    
                    rows.append({
                        "DatePoint": current,
                        "Value": round(value, 4),
                        "FieldName": "PX_LAST",
                        "Ticker": ticker,
                        "Currency": "EUR",
                    })
            
            current = current + timedelta(days=1)
        
        if not rows:
            return pd.DataFrame(columns=["DatePoint", "Value", "FieldName", "Ticker", "Currency"])
        
        df = pd.DataFrame(rows)
        df["DatePoint"] = pd.to_datetime(df["DatePoint"])
        logger.info("Generated %d synthetic FI data rows for %d tickers", len(df), len(tickers))
        return df

    @staticmethod
    def _get_bloomberg_fi_data(tickers: List[str], days_back: int = 1460) -> pd.DataFrame:
        """Query Bloomberg ReferenceDataHistoricalField for FI tickers."""
        if not tickers:
            return pd.DataFrame()
        
        # Use synthetic data if flag is set
        if USE_SYNTHETIC_DATA:
            logger.info("USE_SYNTHETIC_DATA is True – generating synthetic FI data")
            return LänderDataService._generate_synthetic_fi_data(tickers, days_back)
        
        try:
            db = DatabaseGateway()
            engine = db.get_prod_engine()
            ticker_list = "', '".join(tickers)
            query = f"""
            SELECT
                d.DatePoint,
                d.ValueAsString AS Value_Raw,
                d.FieldName,
                e.BloombergTicker AS Ticker,
                d.Currency
            FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] AS d
            LEFT JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] AS e
                ON d.BloombergTickerId = e.Id
            WHERE e.BloombergTicker IN ('{ticker_list}')
              AND d.Frequency = 'DAILY'
              AND TRY_CONVERT(DATETIME, d.DatePoint) >= DATEADD(DAY, -{days_back}, CAST(GETDATE() AS DATE))
            ORDER BY d.DatePoint DESC, e.BloombergTicker
            """
            df = pd.read_sql_query(query, engine)
            if df.empty:
                logger.warning("Bloomberg FI query returned no rows")
                return pd.DataFrame()
            df["Value"] = df["Value_Raw"].astype(str).str.replace(",", ".", regex=False)
            df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
            df = df.drop(columns=["Value_Raw"])
            df = df.sort_values("Currency", na_position="last")
            df = df.drop_duplicates(subset=["DatePoint", "Ticker", "FieldName"], keep="first")
            logger.info(f"✓ Bloomberg FI: {len(df)} rows for {df['Ticker'].nunique()} tickers")
            return df
        except Exception as e:
            logger.error(f"✗ Bloomberg FI query failed: {e}", exc_info=True)
            return pd.DataFrame()

    @staticmethod
    def _get_quant_fi_data(tickers: List[str], days_back: int = 1460) -> pd.DataFrame:
        """Query Quant market_data table for Quant-sourced FI tickers."""
        if not tickers:
            return pd.DataFrame()
        try:
            db = DatabaseGateway()
            engine = db.get_duoplus_engine()
            ticker_list = "', '".join(tickers)
            query = f"""
            SELECT
                ID AS Ticker,
                Value,
                Field AS FieldName,
                Frequency,
                DatePoint,
                CURRENCY AS Currency
            FROM [ApoAsset_Quant].[dbo].[market_data]
            WHERE ID IN ('{ticker_list}')
              AND TRY_CONVERT(DATETIME, DatePoint) >= DATEADD(DAY, -{days_back}, CAST(GETDATE() AS DATE))
            ORDER BY DatePoint DESC, ID
            """
            df = pd.read_sql_query(query, engine)
            if df.empty:
                logger.warning("Quant FI market_data query returned no rows")
                return pd.DataFrame()
            df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
            # Treat all quant data as PX_LAST for consistency
            df["FieldName"] = "PX_LAST"
            df = df.drop_duplicates(subset=["DatePoint", "Ticker"], keep="first")
            logger.info(f"✓ Quant FI: {len(df)} rows for {df['Ticker'].nunique()} tickers")
            return df
        except Exception as e:
            logger.error(f"✗ Quant FI query failed: {e}", exc_info=True)
            return pd.DataFrame()

    @staticmethod
    def _process_fi_raw_data(
        raw_df: pd.DataFrame,
        ticker_mapping: pd.DataFrame,
        regions: List[str],
    ) -> pd.DataFrame:
        """
        Merge raw FI data with ticker_mapping, pivot to wide format, and derive signals.

        Resulting column names follow the convention: "{Period} {GroupingName}"
        e.g. "10Y Yields", "5Y CDS", "10Y Breakevens", "1Y Inflation Expectations"
        """
        if raw_df.empty or ticker_mapping.empty:
            logger.error("Cannot process FI data: raw_df or ticker_mapping is empty")
            return pd.DataFrame()

        # Keep only PX_LAST rows
        raw_df = raw_df[raw_df["FieldName"] == "PX_LAST"].copy()

        # Merge with ticker mapping to get Region, GroupingName, Period
        mapped = raw_df.merge(
            ticker_mapping[["Ticker", "Regions", "GroupingName", "Period"]],
            on="Ticker",
            how="left",
        )

        # Filter to requested regions (drop rows where Regions is NaN or not in list)
        mapped = mapped.dropna(subset=["Regions"])

        # Always include Germany rows so "Spreads to Bunds" can be computed even
        # when the user has not selected Germany.  Germany rows are removed from
        # the final output afterwards if they were not originally requested.
        regions_with_germany = list(regions)
        if "Germany" not in regions_with_germany:
            regions_with_germany.append("Germany")

        mapped = mapped[mapped["Regions"].isin(regions_with_germany)].copy()

        if mapped.empty:
            logger.error(f"No FI data for regions {regions} after mapping")
            return pd.DataFrame()

        # Build metric column name
        mapped["MetricCol"] = (
            mapped["Period"].astype(str).str.strip()
            + " "
            + mapped["GroupingName"].astype(str).str.strip()
        )

        # Convert DatePoint
        mapped["DatePoint"] = pd.to_datetime(mapped["DatePoint"])

        # Pivot: one row per (DatePoint, Regions), columns = MetricCol
        pivot_df = mapped.pivot_table(
            index=["DatePoint", "Regions"],
            columns="MetricCol",
            values="Value",
            aggfunc="first",
        ).reset_index()
        pivot_df.columns.name = None

        # Forward fill (and back fill) sparse data within each region
        numeric_cols = [c for c in pivot_df.columns if c not in ("DatePoint", "Regions")]
        for col in numeric_cols:
            pivot_df[col] = pivot_df.groupby("Regions")[col].transform(
                lambda x: x.ffill().bfill()
            )

        # ── Derived signals ────────────────────────────────────────────────
        # Steepness: 10Y - 2Y
        if "10Y Yields" in pivot_df.columns and "2Y Yields" in pivot_df.columns:
            pivot_df["Steepness"] = pivot_df["10Y Yields"] - pivot_df["2Y Yields"]
            logger.info("  ✓ Computed Steepness (10Y - 2Y)")

        # Curvature: (20Y - 10Y) - (10Y - 5Y)
        if all(c in pivot_df.columns for c in ["20Y Yields", "10Y Yields", "5Y Yields"]):
            pivot_df["Curvature"] = (
                (pivot_df["20Y Yields"] - pivot_df["10Y Yields"])
                - (pivot_df["10Y Yields"] - pivot_df["5Y Yields"])
            )
            logger.info("  ✓ Computed Curvature")

        # Spreads to Bunds: 10Y yield minus Germany's 10Y yield at same date
        if "10Y Yields" in pivot_df.columns:
            germany_10y = (
                pivot_df.loc[pivot_df["Regions"] == "Germany", ["DatePoint", "10Y Yields"]]
                .rename(columns={"10Y Yields": "_bund_10y"})
                .drop_duplicates("DatePoint")
            )
            if not germany_10y.empty:
                pivot_df = pivot_df.merge(germany_10y, on="DatePoint", how="left")
                pivot_df["Spreads to Bunds"] = pivot_df["10Y Yields"] - pivot_df["_bund_10y"]
                pivot_df = pivot_df.drop(columns=["_bund_10y"], errors="ignore")
                logger.info("  ✓ Computed Spreads to Bunds")
            else:
                logger.warning("  ⚠ Germany 10Y Yield not available – Spreads to Bunds not computed")

        # Drop Germany rows from the final result if it was added only for the
        # Bunds spread calculation and was not in the originally requested regions
        if "Germany" not in regions:
            pivot_df = pivot_df[pivot_df["Regions"] != "Germany"].copy()
            logger.info("  ✓ Removed Germany rows (not in requested regions)")

        logger.info(
            f"✓ FI wide-format: {pivot_df.shape}, columns: {sorted(pivot_df.columns.tolist())}"
        )
        return pivot_df.sort_values(["Regions", "DatePoint"]).reset_index(drop=True)

    @staticmethod
    def get_fixed_income_data(
        regions: List[str],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        lookback: str = "1Y",
        show_averages: bool = False,
    ) -> Dict[str, Any]:
        """
        Get fixed income data for specified regions.

        Queries Bloomberg and Quant market_data tables for yields, CDS spreads,
        inflation expectations, and breakevens. Adds derived signals (Steepness,
        Curvature, Spreads to Bunds).

        Returns:
            Dict with status, data records, and metadata
        """
        logger.info("=" * 80)
        logger.info(f"🔍 get_fixed_income_data(): regions={regions}, lookback={lookback}")
        logger.info("=" * 80)

        try:
            import math

            lookback_days = {"1Y": 365, "3Y": 1095, "5Y": 1825, "All": 3650}.get(
                lookback, 1460
            )

            # Normalize region names
            normalized_regions = [
                LänderDataService._normalize_region_name(r) for r in regions
            ]
            logger.info(f"Normalized regions: {normalized_regions}")

            # Load FI ticker mapping
            fi_mapping = LänderDataService._load_fi_ticker_mapping()
            if fi_mapping.empty:
                raise ValueError("Could not load FI ticker mapping from ticker_master")

            # Focus on core groups (skip Interest Rate Expectations - complex futures)
            focus_groups = {
                "Yields",
                "CDS",
                "Breakevens",
                "Inflation Expectations",
            }
            fi_map = fi_mapping[
                fi_mapping["GroupingName"].isin(focus_groups)
            ].copy()

            if fi_map.empty:
                raise ValueError("No FI tickers found for core groups in ticker_master")

            bloomberg_tickers = fi_map[fi_map["DBSource"] == "Bloomberg"]["Ticker"].tolist()
            quant_tickers = fi_map[fi_map["DBSource"] == "Quant"]["Ticker"].tolist()
            logger.info(
                f"  Bloomberg tickers: {len(bloomberg_tickers)}, "
                f"Quant tickers: {len(quant_tickers)}"
            )

            # Query both data sources
            df_bloomberg = LänderDataService._get_bloomberg_fi_data(
                bloomberg_tickers, days_back=lookback_days
            )
            df_quant = LänderDataService._get_quant_fi_data(
                quant_tickers, days_back=lookback_days
            )

            # Combine
            frames = []
            if not df_bloomberg.empty:
                frames.append(df_bloomberg[df_bloomberg["FieldName"] == "PX_LAST"].copy())
            if not df_quant.empty:
                frames.append(df_quant)

            if not frames:
                raise ValueError("No FI data retrieved from Bloomberg or Quant")

            raw_df = pd.concat(frames, ignore_index=True, sort=False)
            logger.info(f"  Combined raw FI rows: {len(raw_df)}")

            # Process into wide format with derived signals
            df_final = LänderDataService._process_fi_raw_data(
                raw_df, fi_map, normalized_regions
            )
            if df_final.empty:
                raise ValueError("No FI data after processing/pivoting")

            # Optional date range filter
            if start_date:
                df_final = df_final[df_final["DatePoint"] >= pd.Timestamp(start_date)]
            if end_date:
                df_final = df_final[df_final["DatePoint"] <= pd.Timestamp(end_date)]

            # Serialize to JSON-safe records
            records = df_final.to_dict("records")
            for record in records:
                if "DatePoint" in record and hasattr(record["DatePoint"], "isoformat"):
                    record["DatePoint"] = record["DatePoint"].isoformat()
                for key, value in record.items():
                    if isinstance(value, float) and math.isnan(value):
                        record[key] = None

            metric_cols = sorted(
                [c for c in df_final.columns if c not in ("DatePoint", "Regions")]
            )
            result = {
                "status": "ok",
                "data": records,
                "metadata": {
                    "regions": regions,
                    "lookback": lookback,
                    "record_count": len(records),
                    "source": "Bloomberg/Quant",
                    "columns": metric_cols,
                },
            }
            logger.info(f"✅ FI SUCCESS: {len(records)} records, {len(metric_cols)} metrics")
            logger.info("=" * 80)
            return result

        except Exception as e:
            logger.error(f"❌ get_fixed_income_data FAILED: {e}", exc_info=True)
            logger.info("=" * 80)
            return {
                "status": "error",
                "data": [],
                "metadata": {"error": str(e)},
            }

    @staticmethod
    def get_master_fi_columns() -> List[str]:
        """
        Return the master list of all possible Fixed Income metric column names.
        Used by the MetricsFilterModal to keep checkboxes stable.
        """
        return [
            # Zinsen (Yields)
            "2Y Yields",
            "5Y Yields",
            "10Y Yields",
            "20Y Yields",
            "30Y Yields",
            # Zinskurven-Ableitungen
            "Steepness",
            "Curvature",
            "Spreads to Bunds",
            # Kreditqualität (CDS)
            "3 CDS",
            "5 CDS",
            "7 CDS",
            "10 CDS",
            # Inflationserwartungen
            "1Y Inflation Expectations",
            "2Y Inflation Expectations",
            "5Y Inflation Expectations",
            "10Y Breakevens",
            "10Y Inflation Expectations",
            # Spezial / special chart types (graph-only)
            "SP",     # S&P credit rating bar chart
            "Kurve",  # Yield curve cross-sectional chart
        ]

    @staticmethod
    def get_ratings() -> Dict[str, Any]:
        """
        Return the latest S&P credit ratings from the ratings table.
        Returns: {status, data: [{Regions, SP}]}
        """
        try:
            db_gw = DatabaseGateway()
            engine = db_gw.get_jm_engine()
            if engine is None:
                raise ValueError("JM (ApoAsset_JM) database not available")

            query = """
                SELECT *
                FROM ratings
                WHERE TRY_CONVERT(DATETIME, DatePoint) = (
                    SELECT MAX(TRY_CONVERT(DATETIME, DatePoint))
                    FROM ratings
                    WHERE TRY_CONVERT(DATETIME, DatePoint) >= DATEADD(day, -14, GETDATE())
                )
            """
            df = pd.read_sql_query(query, engine)
            logger.info(f"ratings table columns: {df.columns.tolist()}")
            logger.info(f"ratings table rows: {len(df)}")

            if df.empty:
                logger.warning("ratings table returned no rows")
                return {"status": "ok", "data": []}

            # Standardise region column name
            if "Countries" in df.columns:
                df = df.rename(columns={"Countries": "Regions"})

            logger.info(f"ratings sample regions: {df['Regions'].unique()[:10].tolist() if 'Regions' in df.columns else 'NO REGIONS COLUMN'}")
            logger.info(f"ratings sample SP: {df['SP'].unique()[:10].tolist() if 'SP' in df.columns else 'NO SP COLUMN'}")

            if "Regions" not in df.columns:
                raise ValueError(f"No 'Countries'/'Regions' column found. Got: {df.columns.tolist()}")
            if "SP" not in df.columns:
                raise ValueError(f"No 'SP' column found. Got: {df.columns.tolist()}")

            # Normalize region names to match the FI data (e.g. "United States" → "U.S.")
            df["Regions"] = df["Regions"].apply(
                lambda r: LänderDataService._normalize_region_name(str(r)) if pd.notna(r) else r
            )

            df = df[["Regions", "SP"]].dropna(subset=["Regions"])

            records = df.to_dict("records")
            logger.info(f"✅ get_ratings: {len(records)} country ratings returned: {[(r['Regions'], r['SP']) for r in records[:5]]}")
            return {"status": "ok", "data": records}

        except Exception as e:
            logger.error(f"❌ get_ratings FAILED: {e}", exc_info=True)
            return {"status": "error", "data": [], "metadata": {"error": str(e)}}

    # ═══════════════════════════════════════════════════════════════════════
    # MACRO DATA METHODS
    # ═══════════════════════════════════════════════════════════════════════

    # Class-level caches for macro ticker mapping
    _macro_ticker_mapping_cache: Optional[pd.DataFrame] = None
    _macro_cache_initialized: bool = False

    @classmethod
    def _load_macro_ticker_mapping(cls) -> pd.DataFrame:
        """Load Macro ticker mapping from ticker_master table, cached."""
        if cls._macro_cache_initialized and cls._macro_ticker_mapping_cache is not None:
            return cls._macro_ticker_mapping_cache

        try:
            db = DatabaseGateway()
            engine = db.get_duoplus_engine()
            from sqlalchemy import text
            with engine.connect() as conn:
                df = pd.read_sql_query(
                    text("""
                        SELECT Ticker, Regions,
                               [Dashboard Grouping Name] AS GroupingName,
                               Period, [Database] AS DBSource,
                               [Adjust Pct] AS AdjustPct
                        FROM [ApoAsset_Quant].[dbo].[ticker_master]
                        WHERE [Dashboard Page] = 'Countries'
                          AND [Dashboard Grouping] = 'Macro'
                          AND Active = 1
                    """),
                    conn,
                )
            cls._macro_ticker_mapping_cache = df
            cls._macro_cache_initialized = True
            logger.info(f"✓ Loaded {len(df)} Macro ticker mappings from ticker_master")
            return df
        except Exception as e:
            logger.error(f"✗ Failed to load Macro ticker mapping: {e}", exc_info=True)
            cls._macro_cache_initialized = True
            cls._macro_ticker_mapping_cache = pd.DataFrame()
            return pd.DataFrame()

    @staticmethod
    def _generate_synthetic_macro_data(
        tickers: List[str],
        days_back: int = 1460,
    ) -> pd.DataFrame:
        """
        Generate synthetic macro economic data for testing/demo purposes.

        Returns a DataFrame with columns: DatePoint, Value, FieldName, Ticker, Currency
        """
        rows = []
        end_date = datetime.now().date()
        start_date = (datetime.now() - timedelta(days=days_back)).date()
        
        # Generate base values per ticker (seeded for consistency)
        np.random.seed(42)
        base_values = {}
        for ticker in tickers:
            # Realistic macro ranges
            if 'GDP' in ticker or 'GROWTH' in ticker:
                base_values[ticker] = np.random.uniform(1.5, 3.5)  # 1.5-3.5% growth
            elif 'INFLATION' in ticker or 'CPI' in ticker:
                base_values[ticker] = np.random.uniform(1.0, 4.0)  # 1-4% inflation
            elif 'UNEMPLOYMENT' in ticker:
                base_values[ticker] = np.random.uniform(3.0, 8.0)  # 3-8% unemployment
            elif 'PMI' in ticker:
                base_values[ticker] = np.random.uniform(45, 55)  # 45-55 PMI
            else:
                base_values[ticker] = np.random.uniform(0, 100)
        
        current = start_date
        ticker_idx = 0
        
        while current <= end_date:
            # Generate monthly data (more realistic for macro)
            for ticker in tickers:
                # Monthly frequency for most macro data
                if current.day == 1 or ticker_idx % 22 == 0:  # Approximate monthly
                    base = base_values[ticker]
                    # Realistic monthly volatility
                    monthly_change = np.random.normal(0, 0.5)  # ~0.5% monthly std dev
                    value = base * (1 + monthly_change / 100)
                    # Keep values realistic
                    if 'GDP' in ticker or 'GROWTH' in ticker:
                        value = max(0.5, min(5.0, value))
                    elif 'UNEMPLOYMENT' in ticker:
                        value = max(2.0, min(15.0, value))
                    elif 'PMI' in ticker:
                        value = max(30, min(70, value))
                    
                    rows.append({
                        "DatePoint": current,
                        "Value": round(value, 2),
                        "FieldName": "PX_LAST",
                        "Ticker": ticker,
                        "Currency": "EUR",
                    })
            
            current = current + timedelta(days=1)
        
        if not rows:
            return pd.DataFrame(columns=["DatePoint", "Value", "FieldName", "Ticker", "Currency"])
        
        df = pd.DataFrame(rows)
        df["DatePoint"] = pd.to_datetime(df["DatePoint"])
        logger.info("Generated %d synthetic macro data rows for %d tickers", len(df), len(tickers))
        return df

    @staticmethod
    def _get_bloomberg_macro_data(tickers: List[str], days_back: int = 1460) -> pd.DataFrame:
        """Query Bloomberg ReferenceDataHistoricalField for Macro Bloomberg tickers.
        
        Macro data can be in DAILY, MONTHLY, QUARTERLY, or YEARLY frequencies,
        so we accept all four.
        """
        if not tickers:
            return pd.DataFrame()
        
        # Use synthetic data if flag is set
        if USE_SYNTHETIC_DATA:
            logger.info("USE_SYNTHETIC_DATA is True – generating synthetic macro data")
            return LänderDataService._generate_synthetic_macro_data(tickers, days_back)
        
        try:
            db = DatabaseGateway()
            engine = db.get_prod_engine()
            ticker_list = "', '".join(tickers)
            query = f"""
            SELECT
                d.DatePoint,
                d.ValueAsString AS Value_Raw,
                d.FieldName,
                e.BloombergTicker AS Ticker,
                d.Currency
            FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] AS d
            LEFT JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] AS e
                ON d.BloombergTickerId = e.Id
            WHERE e.BloombergTicker IN ('{ticker_list}')
              AND d.Frequency IN ('DAILY', 'MONTHLY', 'QUARTERLY', 'YEARLY')
              AND TRY_CONVERT(DATETIME, d.DatePoint) >= DATEADD(DAY, -{days_back}, CAST(GETDATE() AS DATE))
            ORDER BY d.DatePoint DESC, e.BloombergTicker
            """
            df = pd.read_sql_query(query, engine)
            if df.empty:
                logger.warning("Bloomberg Macro query returned no rows")
                return pd.DataFrame()
            df["Value"] = df["Value_Raw"].astype(str).str.replace(",", ".", regex=False)
            df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
            df = df.drop(columns=["Value_Raw"])
            df = df.sort_values("Currency", na_position="last")
            df = df.drop_duplicates(subset=["DatePoint", "Ticker", "FieldName"], keep="first")
            logger.info(f"✓ Bloomberg Macro: {len(df)} rows for {df['Ticker'].nunique()} tickers (DAILY/MONTHLY/QUARTERLY/YEARLY)")
            return df
        except Exception as e:
            logger.error(f"✗ Bloomberg Macro query failed: {e}", exc_info=True)
            return pd.DataFrame()

    @staticmethod
    def _get_quant_macro_data(tickers: List[str], days_back: int = 1460) -> pd.DataFrame:
        """Query Quant market_data table for PMI and other Quant-sourced Macro tickers."""
        if not tickers:
            return pd.DataFrame()
        try:
            db = DatabaseGateway()
            engine = db.get_duoplus_engine()
            ticker_list = "', '".join(tickers)
            query = f"""
            SELECT
                ID AS Ticker,
                Value,
                Field AS FieldName,
                Frequency,
                DatePoint,
                CURRENCY AS Currency
            FROM [ApoAsset_Quant].[dbo].[market_data]
            WHERE ID IN ('{ticker_list}')
              AND TRY_CONVERT(DATETIME, DatePoint) >= DATEADD(DAY, -{days_back}, CAST(GETDATE() AS DATE))
            ORDER BY DatePoint DESC, ID
            """
            df = pd.read_sql_query(query, engine)
            if df.empty:
                logger.warning("Quant Macro market_data query returned no rows")
                return pd.DataFrame()
            df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
            df["FieldName"] = "PX_LAST"
            df = df.drop_duplicates(subset=["DatePoint", "Ticker"], keep="first")
            logger.info(f"✓ Quant Macro: {len(df)} rows for {df['Ticker'].nunique()} tickers")
            return df
        except Exception as e:
            logger.error(f"✗ Quant Macro query failed: {e}", exc_info=True)
            return pd.DataFrame()

    @staticmethod
    def _process_macro_raw_data(
        raw_df: pd.DataFrame,
        ticker_mapping: pd.DataFrame,
        regions: List[str],
    ) -> pd.DataFrame:
        """
        Merge raw Macro data with ticker_mapping, apply YoY adjustments,
        and pivot to wide format.

        Column names = GroupingName directly (e.g. 'GDP', 'Inflation', 'Composite PMI').
        Tickers with AdjustPct='X' get YoY % change applied before pivoting.
        """
        if raw_df.empty or ticker_mapping.empty:
            logger.error("Cannot process Macro data: raw_df or ticker_mapping is empty")
            return pd.DataFrame()

        # Keep only PX_LAST rows
        raw_df = raw_df[raw_df["FieldName"] == "PX_LAST"].copy()

        # Merge with ticker mapping – include Period so we can pick the right pct_change lag
        merge_cols = ["Ticker", "Regions", "GroupingName", "AdjustPct"]
        if "Period" in ticker_mapping.columns:
            merge_cols.append("Period")
        mapped = raw_df.merge(
            ticker_mapping[merge_cols],
            on="Ticker",
            how="left",
        )

        # Filter to requested regions
        mapped = mapped.dropna(subset=["Regions"])
        mapped = mapped[mapped["Regions"].isin(regions)].copy()

        if mapped.empty:
            logger.error(f"No Macro data for regions {regions} after mapping")
            return pd.DataFrame()

        # Column name = GroupingName directly (no Period prefix for macro)
        mapped["MetricCol"] = mapped["GroupingName"].astype(str).str.strip()

        # Convert DatePoint
        mapped["DatePoint"] = pd.to_datetime(mapped["DatePoint"])
        mapped = mapped.sort_values(["MetricCol", "Regions", "DatePoint"])

        # ── Apply YoY % change for level-data tickers ──
        # Metrics flagged AdjustPct='X' in the DB, plus a hard-coded fallback list
        # for trade metrics that must always be converted from levels to YoY %.
        ALWAYS_YOY_METRICS = {"Trade Balance", "Exports", "Imports", "New Orders"}

        adjust_metrics = set(mapped[mapped["AdjustPct"] == "X"]["MetricCol"].unique())
        # Add fallback metrics that appear in the data even if the DB flag is missing
        adjust_metrics |= ALWAYS_YOY_METRICS & set(mapped["MetricCol"].unique())

        # Map Period code → number of observations per year (for pct_change lag)
        PERIOD_TO_LAG = {"M": 12, "Q": 4, "A": 1, "Y": 1, "D": 252}

        if adjust_metrics:
            logger.info(f"  Applying YoY pct_change for: {sorted(adjust_metrics)}")
            for metric in sorted(adjust_metrics):
                mask = mapped["MetricCol"] == metric
                for region in mapped.loc[mask, "Regions"].unique():
                    sub_mask = mask & (mapped["Regions"] == region)
                    vals = mapped.loc[sub_mask, "Value"]

                    # Determine YoY lag from Period column; fall back to inferring
                    # it from median date spacing so annual/quarterly data is handled
                    # correctly regardless of what the DB flag says.
                    lag = 12  # default: monthly
                    if "Period" in mapped.columns:
                        period_codes = mapped.loc[sub_mask, "Period"].dropna().unique()
                        if len(period_codes) == 1:
                            lag = PERIOD_TO_LAG.get(str(period_codes[0]).strip().upper(), 12)
                        else:
                            # Infer from median gap between observations
                            dates = mapped.loc[sub_mask, "DatePoint"].dropna().sort_values()
                            if len(dates) >= 2:
                                median_days = dates.diff().dt.days.median()
                                if median_days >= 300:
                                    lag = 1   # annual
                                elif median_days >= 80:
                                    lag = 4   # quarterly
                                else:
                                    lag = 12  # monthly
                    else:
                        # No Period column – infer from date spacing
                        dates = mapped.loc[sub_mask, "DatePoint"].dropna().sort_values()
                        if len(dates) >= 2:
                            median_days = dates.diff().dt.days.median()
                            if median_days >= 300:
                                lag = 1
                            elif median_days >= 80:
                                lag = 4

                    min_required = lag + 1
                    if len(vals) >= min_required:
                        mapped.loc[sub_mask, "Value"] = vals.pct_change(periods=lag) * 100
                    else:
                        logger.warning(
                            f"  ⚠ Not enough data for YoY ({len(vals)} pts, need {min_required}) "
                            f"– metric={metric}, region={region}, lag={lag}"
                        )
                    # NaN rows produced by pct_change are dropped below
            mapped = mapped.dropna(subset=["Value"])

        # Remove duplicates before pivot
        mapped = mapped.drop_duplicates(subset=["DatePoint", "Regions", "MetricCol"], keep="first")

        # Pivot: one row per (DatePoint, Regions), columns = MetricCol
        pivot_df = mapped.pivot_table(
            index=["DatePoint", "Regions"],
            columns="MetricCol",
            values="Value",
            aggfunc="first",
        ).reset_index()
        pivot_df.columns.name = None

        # Forward-fill (and back-fill) sparse data within each region
        numeric_cols = [c for c in pivot_df.columns if c not in ("DatePoint", "Regions")]
        for col in numeric_cols:
            pivot_df[col] = pivot_df.groupby("Regions")[col].transform(
                lambda x: x.ffill().bfill()
            )

        # Calculate Misery Index = Inflation + Unemployment (if both exist)
        if "Inflation" in pivot_df.columns and "Unemployment" in pivot_df.columns:
            pivot_df["Misery"] = pivot_df["Inflation"] + pivot_df["Unemployment"]
            logger.info("✓ Calculated Misery Index = Inflation + Unemployment")

        logger.info(
            f"✓ Macro wide-format: {pivot_df.shape}, "
            f"columns: {sorted(pivot_df.columns.tolist())}"
        )
        return pivot_df.sort_values(["Regions", "DatePoint"]).reset_index(drop=True)

    @staticmethod
    def get_macro_data(
        regions: List[str],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        lookback: str = "1Y",
        show_averages: bool = False,
    ) -> Dict[str, Any]:
        """
        Get macro-economic data for specified regions.

        Queries Bloomberg and Quant market_data for GDP, PMI, inflation,
        unemployment, trade data, interest rates, etc.

        Returns:
            Dict with status, data records, and metadata
        """
        logger.info("=" * 80)
        logger.info(f"🔍 get_macro_data(): regions={regions}, lookback={lookback}")
        logger.info("=" * 80)

        try:
            import math

            lookback_days = {"1Y": 365, "3Y": 1095, "5Y": 1825, "All": 3650}.get(
                lookback, 1460
            )

            # Always query extra 2 years of data so that annual-frequency metrics
            # (Trade Balance, Exports, Imports, New Orders) have enough data points
            # for the YoY pct_change computation regardless of the selected lookback.
            # The result is trimmed back to the actual lookback window after processing.
            query_days_back = lookback_days + 730 if lookback != "All" else 3650

            # Normalize region names
            normalized_regions = [
                LänderDataService._normalize_region_name(r) for r in regions
            ]
            logger.info(f"Normalized regions: {normalized_regions}")

            # Load Macro ticker mapping
            macro_mapping = LänderDataService._load_macro_ticker_mapping()
            if macro_mapping.empty:
                raise ValueError("Could not load Macro ticker mapping from ticker_master")

            bloomberg_tickers = macro_mapping[macro_mapping["DBSource"] == "Bloomberg"]["Ticker"].tolist()
            quant_tickers = macro_mapping[macro_mapping["DBSource"] == "Quant"]["Ticker"].tolist()
            logger.info(
                f"  Bloomberg tickers: {len(bloomberg_tickers)}, "
                f"Quant tickers: {len(quant_tickers)}"
            )

            # Query both data sources using the extended buffer window
            df_bloomberg = LänderDataService._get_bloomberg_macro_data(
                bloomberg_tickers, days_back=query_days_back
            )
            df_quant = LänderDataService._get_quant_macro_data(
                quant_tickers, days_back=query_days_back
            )

            # Combine
            frames = []
            if not df_bloomberg.empty:
                frames.append(df_bloomberg[df_bloomberg["FieldName"] == "PX_LAST"].copy())
            if not df_quant.empty:
                frames.append(df_quant)

            if not frames:
                raise ValueError("No Macro data retrieved from Bloomberg or Quant")

            raw_df = pd.concat(frames, ignore_index=True, sort=False)
            logger.info(f"  Combined raw Macro rows: {len(raw_df)}")

            # Process into wide format
            df_final = LänderDataService._process_macro_raw_data(
                raw_df, macro_mapping, normalized_regions
            )
            if df_final.empty:
                raise ValueError("No Macro data after processing/pivoting")

            # Trim back to the actually requested lookback window after YoY computation.
            # The extra buffer data was needed only so pct_change could produce valid values.
            if lookback != "All":
                lookback_cutoff = pd.Timestamp.now(tz=None).normalize() - pd.Timedelta(days=lookback_days)
                df_final = df_final[df_final["DatePoint"] >= lookback_cutoff].copy()
                logger.info(f"  Trimmed to lookback window: {len(df_final)} rows remain after {lookback} cutoff")

            # Optional date range filter
            if start_date:
                df_final = df_final[df_final["DatePoint"] >= pd.Timestamp(start_date)]
            if end_date:
                df_final = df_final[df_final["DatePoint"] <= pd.Timestamp(end_date)]

            # Build reverse mapping: normalized name -> original name from request
            reverse_region_map = {}
            for original, normalized in zip(regions, normalized_regions):
                reverse_region_map[normalized] = original
            
            # Serialize to JSON-safe records and apply de-normalization
            records = df_final.to_dict("records")
            for record in records:
                # De-normalize the region name back to what the frontend sent
                if "Regions" in record and record["Regions"] in reverse_region_map:
                    record["Regions"] = reverse_region_map[record["Regions"]]
                if "DatePoint" in record and hasattr(record["DatePoint"], "isoformat"):
                    record["DatePoint"] = record["DatePoint"].isoformat()
                for key, value in record.items():
                    if isinstance(value, float) and math.isnan(value):
                        record[key] = None

            metric_cols = sorted(
                [c for c in df_final.columns if c not in ("DatePoint", "Regions")]
            )
            result = {
                "status": "ok",
                "data": records,
                "metadata": {
                    "regions": regions,
                    "lookback": lookback,
                    "record_count": len(records),
                    "source": "Bloomberg/Quant",
                    "columns": metric_cols,
                },
            }
            logger.info(f"✅ Macro SUCCESS: {len(records)} records, {len(metric_cols)} metrics")
            logger.info("=" * 80)
            return result

        except Exception as e:
            logger.error(f"❌ get_macro_data FAILED: {e}", exc_info=True)
            logger.info("=" * 80)
            return {
                "status": "error",
                "data": [],
                "metadata": {"error": str(e)},
            }

    @staticmethod
    def get_master_macro_columns() -> List[str]:
        """
        Return the master list of all possible Macro metric column names.
        Used by the MetricsFilterModal to keep checkboxes stable.
        """
        return [
            # Konjunktur (Growth & Business Cycle)
            "GDP",
            "Economic Surprise",
            "Industrial Production",
            "Retail Sales",
            "Trade Policy Uncertainty",
            "New Orders",
            # Fundamental (Labor Market & Prices)
            "Inflation",
            "Unemployment",
            "Misery",
            # Geschäftsklima (Business Sentiment)
            "Composite PMI",
            "Manufacturing PMI",
            "Services PMI",
            "Consumer Confidence",
            # Außenhandel (External Trade)
            "Trade Balance",
            "Current Account",
            "Exports",
            "Imports",
            # Fiskal (Fiscal)
            "Government Debt",
            "Budget Balance",
            # Andere (Other)
            "Interest Rate",
        ]
