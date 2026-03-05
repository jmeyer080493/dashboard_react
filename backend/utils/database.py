"""
Database configuration and connections for the dashboard backend.
Consolidates connections to multiple SQL Server databases used by the original Dash app.
"""

import os
from sqlalchemy import create_engine, Engine, text
from typing import Optional
import logging
import pandas as pd
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class DatabaseGateway:
    """
    Single point of access for all database queries.
    Routes to the correct database based on data type needed.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DatabaseGateway, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.prod_engine: Optional[Engine] = None
        self.dev_engine: Optional[Engine] = None
        self.ams_engine: Optional[Engine] = None
        self.duoplus_engine: Optional[Engine] = None
        self.ams_holdings_engine: Optional[Engine] = None
        self.jm_engine: Optional[Engine] = None
        self.jm_engine: Optional[Engine] = None
        
        self._initialize_connections()
        self._initialized = True
    
    def _initialize_connections(self):
        """Initialize all database connections"""
        try:
            # Bloomberg database (equity data - MSCI indices, valuations, etc.)
            bloomberg_connection_string = os.getenv(
                "BLOOMBERG_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-prod/Apoasset_Bloomberg?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.prod_engine = create_engine(bloomberg_connection_string)
            logger.info("✓ Connected to Bloomberg database")
        except Exception as e:
            logger.warning(f"⚠ Bloomberg database connection failed: {e}")
        
        try:
            # Common database (reference data, settings)
            common_connection_string = os.getenv(
                "COMMON_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-prod/Apoasset_Common?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.dev_engine = create_engine(common_connection_string)
            logger.info("✓ Connected to Common database")
        except Exception as e:
            logger.warning(f"⚠ Common database connection failed: {e}")
        
        try:
            # AMS database (portfolio data, holdings)
            ams_connection_string = os.getenv(
                "AMS_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-prod/AMS_WMDaten?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.ams_engine = create_engine(ams_connection_string)
            logger.info("✓ Connected to AMS database")
        except Exception as e:
            logger.warning(f"⚠ AMS database connection failed: {e}")
        
        try:
            # Quant database (market data - yields, macro indicators, etc.)
            quant_connection_string = os.getenv(
                "QUANT_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-prod/ApoAsset_Quant?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.duoplus_engine = create_engine(quant_connection_string)
            logger.info("✓ Connected to Quant (market data) database")
        except Exception as e:
            logger.warning(f"⚠ Quant database connection failed: {e}")

        try:
            # JM database (alternative/consumer data – apo-sql-dev / ApoAsset_JM)
            jm_connection_string = os.getenv(
                "JM_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-dev/ApoAsset_JM?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.jm_engine = create_engine(jm_connection_string)
            logger.info("✓ Connected to JM (alternative consumer data) database")
        except Exception as e:
            logger.warning(f"⚠ JM database connection failed: {e}")

        try:
            # AMS holdings database (portfolio holdings, prices)
            ams_holdings_connection_string = os.getenv(
                "AMS_HOLDINGS_DB_CONNECTION",
                r"mssql+pyodbc://@apo-sql-ams\AMS/AMS?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.ams_holdings_engine = create_engine(ams_holdings_connection_string)
            logger.info("✓ Connected to AMS holdings database")
        except Exception as e:
            logger.warning(f"⚠ AMS holdings database connection failed: {e}")

        try:
            # ApoAsset_JM database (STOXX announcements, benchmark dates)
            jm_connection_string = os.getenv(
                "JM_DB_CONNECTION",
                "mssql+pyodbc://@apo-sql-dev/ApoAsset_JM?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes"
            )
            self.jm_engine = create_engine(jm_connection_string)
            logger.info("✓ Connected to ApoAsset_JM database")
        except Exception as e:
            logger.warning(f"⚠ ApoAsset_JM database connection failed: {e}")

    def get_prod_engine(self) -> Engine:
        """Get production database engine"""
        if self.prod_engine is None:
            raise RuntimeError("Production database not initialized")
        return self.prod_engine
    
    def get_dev_engine(self) -> Engine:
        """Get development database engine"""
        if self.dev_engine is None:
            raise RuntimeError("Development database not initialized")
        return self.dev_engine
    
    def get_ams_engine(self) -> Engine:
        """Get AMS database engine"""
        if self.ams_engine is None:
            raise RuntimeError("AMS database not initialized")
        return self.ams_engine
    
    def get_duoplus_engine(self) -> Engine:
        """Get DuoPlus database engine"""
        if self.duoplus_engine is None:
            raise RuntimeError("DuoPlus database not initialized")
        return self.duoplus_engine

    def get_jm_engine(self) -> Engine:
        """Get JM (ApoAsset_JM) database engine for alternative/consumer data"""
        if self.jm_engine is None:
            raise RuntimeError("JM database not initialized")
        return self.jm_engine

    def get_ams_holdings_engine(self) -> Engine:
        """Get AMS holdings engine (apo-sql-ams/AMS)"""
        if self.ams_holdings_engine is None:
            raise RuntimeError("AMS holdings database not initialized")
        return self.ams_holdings_engine

    def get_jm_engine(self) -> Engine:
        """Get ApoAsset_JM engine (apo-sql-dev) for STOXX / XESC data"""
        if self.jm_engine is None:
            raise RuntimeError("ApoAsset_JM database not initialized")
        return self.jm_engine

    def check_connectivity(self) -> dict:
        """Check connectivity to all configured databases"""
        status = {}
        
        for db_name, engine in [
            ("prod", self.prod_engine),
            ("dev", self.dev_engine),
            ("ams", self.ams_engine),
            ("duoplus", self.duoplus_engine),
            ("jm", self.jm_engine),
        ]:
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                status[db_name] = {"connected": True}
            except Exception as e:
                status[db_name] = {"connected": False, "error": str(e)}
        
        return status
    
    def fetch_equity_data(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        tickers: Optional[list] = None
    ) -> pd.DataFrame:
        """
        Fetch equity data from Bloomberg database.
        
        Args:
            start_date: Start date for data retrieval (default: 4 years ago)
            end_date: End date for data retrieval (default: today)
            tickers: List of Bloomberg tickers to fetch (e.g., "MSCI Germany Index")
        
        Returns:
            DataFrame with DatePoint, FieldName, BloombergTicker, Currency, ValueAsString
        """
        if start_date is None:
            start_date = datetime.now() - timedelta(days=1460)  # 4 years
        if end_date is None:
            end_date = datetime.now()
        
        try:
            engine = self.get_prod_engine()
            
            # Build the WHERE clause for tickers
            ticker_where = ""
            if tickers:
                ticker_list = "', '".join(tickers)
                ticker_where = f" AND e.BloombergTicker IN ('{ticker_list}')"
            
            query = f"""
            SELECT 
                d.DatePoint,
                d.ValueAsString,
                d.FieldName,
                e.BloombergTicker as Ticker,
                d.Currency
            FROM [Apoasset_Bloomberg].[dbo].[ReferenceDataHistoricalField] as d
            LEFT JOIN [Apoasset_Bloomberg].[dbo].[BloombergTicker] as e
                ON d.BloombergTickerId = e.Id
            WHERE TRY_CONVERT(DATETIME, d.DatePoint) >= :start_date
                AND TRY_CONVERT(DATETIME, d.DatePoint) <= :end_date
                AND d.Frequency = 'DAILY'
                {ticker_where}
            ORDER BY d.DatePoint DESC, e.BloombergTicker
            """
            
            with engine.connect() as conn:
                df = pd.read_sql_query(
                    text(query),
                    con=conn,
                    params={"start_date": start_date, "end_date": end_date}
                )
            
            logger.info(f"✓ Fetched {len(df)} equity data rows from Bloomberg database")
            return df
        
        except Exception as e:
            logger.error(f"✗ Failed to fetch equity data: {e}")
            return pd.DataFrame()
    
    def fetch_fixed_income_data(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.DataFrame:
        """
        Fetch fixed income data from market_data database.
        
        Args:
            start_date: Start date for data retrieval (default: 4 years ago)
            end_date: End date for data retrieval (default: today)
        
        Returns:
            DataFrame with ID, Value, Field, Frequency, DatePoint, Currency
        """
        if start_date is None:
            start_date = datetime.now() - timedelta(days=1460)  # 4 years
        if end_date is None:
            end_date = datetime.now()
        
        try:
            engine = self.get_duoplus_engine()
            
            query = """
            SELECT 
                ID as Ticker,
                Value,
                Field as FieldName,
                Frequency,
                DatePoint,
                CURRENCY
            FROM [ApoAsset_Quant].[dbo].[market_data]
            WHERE TRY_CONVERT(DATETIME, DatePoint) >= :start_date
                AND TRY_CONVERT(DATETIME, DatePoint) <= :end_date
            ORDER BY DatePoint DESC, ID
            """
            
            with engine.connect() as conn:
                df = pd.read_sql_query(
                    text(query),
                    con=conn,
                    params={"start_date": start_date, "end_date": end_date}
                )
            
            logger.info(f"✓ Fetched {len(df)} fixed income data rows from market_data database")
            return df
        
        except Exception as e:
            logger.error(f"✗ Failed to fetch fixed income data: {e}")
            return pd.DataFrame()
    
    def fetch_macro_data(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.DataFrame:
        """
        Fetch macro economic data from market_data database.
        
        Args:
            start_date: Start date for data retrieval (default: 4 years ago)
            end_date: End date for data retrieval (default: today)
        
        Returns:
            DataFrame with macro economic indicators
        """
        # Macro data uses same market_data table, so delegates to fetch_fixed_income_data
        # Filter by macro-specific fields
        return self.fetch_fixed_income_data(start_date, end_date)


# Singleton instance
db_gateway = DatabaseGateway()
