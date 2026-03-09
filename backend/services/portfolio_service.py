"""
Portfolio Tab Data Service

Provides data for the Portfolios tab:
  - Overview subtab: AUM summary cards, AUM-by-portfolio table, Liquiditätsübersicht
  - Portfolio subtab: holdings table, allocation pie charts, metric cards

All data is sourced from SQL (AMS database) or falls back to empty data gracefully.
"""

import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

from utils.database import DatabaseGateway
from config.settings import USE_SYNTHETIC_DATA

db = DatabaseGateway()

# ──────────────────────────────────────────────────────────────────────────────
# Fund display-name mapping  (mirrors data/mapping.py::fund_name_mapping)
# ──────────────────────────────────────────────────────────────────────────────

FUND_NAME_MAPPING: Dict[str, List[str]] = {
    # MA Team
    "Forte":     ["apo Forte INKA V", "apo Forte INKA R", "apo Forte"],
    "DuoPlus":   ["DuoPlus V", "DuoPlus R"],
    "GEP":       ["Global ETFs Portfolio EUR", "Global ETFs Portfolio R", "Global ETFs Portfolio"],
    "Vivace":    ["apo Vivace INKA V", "apo Vivace INKA R", "apo Vivace Megatrends"],
    "Piano":     ["apo Piano INKA V", "apo Piano INKA R", "apo Piano"],
    "Mezzo":     ["apo Mezzo INKA V", "apo Mezzo INKA R", "apo Mezzo"],
    # HC Team
    "AMO":       ["apo Medical Opportunities V", "apo Medical Opportunities R", "apo Medical Opportunities"],
    "ADH":       ["apo Digital Health Aktien Fonds I", "apo Digital Health Aktien Fonds R"],
    "AMB":       ["apo Medical Balance I", "apo Medical Balance R", "apo Medical Balance"],
    "MBH":       ["MEDICAL BioHealth I"],
    "AFH":       ["apo Future Health"],
    "AMC":       ["apo Medical Core"],
    # Spezial Team
    "PoolD":     ["APO POOL D INKA", "APO POOL D UNIVERSAL FONDS", "APO POOL D Fonds"],
    "Elbe":      ["ELBE INKA"],
    "Nordrhein": ["Nordrhein I INKA (Apo)", "LBBW AM-Nord IA"],
    "RVAB":      ["VAB INKA RVAB"],
    "AVW":       ["AVW-UNIVERSAL-FONDS"],
    "SAE":       ["SAEV Masterfonds APO Europäische Aktien"],
    "Stiftung":  ["apo Stiftung & Ertrag"],
    "TestPortfolio": ["ZZZ AGP-Testportfolio"],
}

# Build reverse lookup: db_name → display_name
_DB_TO_DISPLAY: Dict[str, str] = {}
for _disp, _db_names in FUND_NAME_MAPPING.items():
    for _db in _db_names:
        _DB_TO_DISPLAY[_db] = _disp


def get_fund_display_name(db_name: str) -> str:
    return _DB_TO_DISPLAY.get(db_name, db_name)


# ──────────────────────────────────────────────────────────────────────────────
# Team mapping  (mirrors portfolios/portfolio_mappings.py::TEAM_MAPPING)
# ──────────────────────────────────────────────────────────────────────────────

TEAM_MAPPING: Dict[str, List[str]] = {
    "MA": [
        "Forte", "Mezzo", "Piano", "Vivace", "DuoPlus", "GEP",
        "apo Forte INKA V", "apo Forte INKA R",
        "apo Mezzo INKA V", "apo Mezzo INKA R",
        "apo Piano INKA V", "apo Piano INKA R",
        "apo Vivace INKA V", "apo Vivace INKA R",
        "DuoPlus V", "DuoPlus R",
        "Global ETFs Portfolio EUR", "Global ETFs Portfolio R",
    ],
    "HC": [
        "AFH", "AMB", "AMC", "AMO", "ADH", "MBH", "Stiftung",
        "apo Future Health",
        "apo Medical Balance I", "apo Medical Balance R",
        "apo Medical Core",
        "apo Medical Opportunities V", "apo Medical Opportunities R",
        "apo Digital Health Aktien Fonds I", "apo Digital Health Aktien Fonds R",
        "MEDICAL BioHealth I",
        "apo Stiftung & Ertrag",
    ],
    "Spezial": [
        "PoolD", "Elbe", "Nordrhein", "RVAB", "AVW", "SAE",
        "SAEV Masterfonds APO Europäische Aktien",
        "ELBE INKA",
        "Nordrhein I INKA (Apo)",
        "VAB INKA RVAB",
        "APO POOL D INKA", "APO POOL D UNIVERSAL FONDS",
        "AVW-UNIVERSAL-FONDS",
    ],
}


def get_team_for_portfolio(name: str) -> Optional[str]:
    for team, members in TEAM_MAPPING.items():
        if name in members:
            return team
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Asset-type mapping  (mirrors data/mapping.py::ams_at_mapping)
# ──────────────────────────────────────────────────────────────────────────────

AMS_AT_MAPPING = {
    "Aktie":       "Equity",
    "Rente":       "Fixed Income",
    "Equity":      "Equity",
    "FixedIncome": "Fixed Income",
    "Future":      "Future",
}

# ──────────────────────────────────────────────────────────────────────────────
# Currency values helpers
# ──────────────────────────────────────────────────────────────────────────────

def _format_aum(value) -> str:
    if pd.isna(value) or value == 0:
        return "0"
    return f"{value:,.0f}".replace(",", ".")


def _format_currency(value) -> str:
    if pd.isna(value) or value == 0:
        return "0"
    return f"{value:,.0f}".replace(",", ".")


# ══════════════════════════════════════════════════════════════════════════════
# HOLDINGS DATA
# ══════════════════════════════════════════════════════════════════════════════

def _generate_synthetic_portfolio_names() -> List[str]:
    """
    Generate synthetic portfolio names for testing/demo purposes.
    Returns a list of realistic portfolio names from FUND_NAME_MAPPING.
    """
    # Use the first realname for each fund as synthetic data
    portfolio_names = [names[0] for names in FUND_NAME_MAPPING.values() if names]
    logger.info("Generated %d synthetic portfolio names", len(portfolio_names))
    return portfolio_names


def _get_all_portfolio_names() -> List[str]:
    """Fetch all active portfolio names from AMS database."""
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic portfolio names")
        return _generate_synthetic_portfolio_names()
    
    engine = db.ams_holdings_engine
    if engine is None:
        logger.warning("AMS engine not available, returning empty portfolio list")
        return []
    try:
        df = pd.read_sql_query(
            """
            SELECT DISTINCT Name
            FROM [dbo].[Portfolios]
            WHERE ValidTo IS NULL
              AND IsDeleted = 0
              AND LiquidationDate IS NULL
              AND Name NOT LIKE '%Testportfolio%'
            ORDER BY Name
            """,
            engine,
        )
        return df["Name"].tolist()
    except Exception as exc:
        logger.error("Failed to fetch portfolio names: %s", exc)
        return []


def _generate_synthetic_holdings_data(portfolio_names: List[str]) -> pd.DataFrame:
    """
    Generate synthetic holdings data for testing/demo purposes.
    Returns a DataFrame with columns matching the SQL query from _get_current_holdings().
    """
    if not portfolio_names:
        return pd.DataFrame()
    
    # Define realistic holdings universe
    equities = [
        ("Apple Inc", "AAPL US Equity", "US", "Information Technology"),
        ("Microsoft Corp", "MSFT US Equity", "US", "Information Technology"),
        ("Nestle AG", "NSRGY US Equity", "CH", "Consumer Staples"),
        ("Siemens AG", "SIE GY Equity", "DE", "Industrials"),
        ("LVMH Moet Hennessy", "MC FP Equity", "FR", "Consumer Discretionary"),
        ("Roche Holdings", "RHHBY US Equity", "CH", "Healthcare"),
        ("SAP SE", "SAP GY Equity", "DE", "Information Technology"),
        ("Unilever PLC", "UL US Equity", "GB", "Consumer Staples"),
    ]
    
    bonds = [
        ("German Bund 2031", "DE0001135275 Corp", "DE"),
        ("US Treasury 10Y", "USGG10YR Corp", "US"),
        ("French OAT 2030", "FR0000570046 Govt", "FR"),
        ("Corporate Bond AAA", "CORP1000 Corp", "US"),
        ("EM Bond 2028", "EMBOND001 Corp", "MX"),
    ]
    
    countries = ["US", "DE", "FR", "CH", "GB", "IT", "ES", "NL"]
    
    rows = []
    today = datetime.today().date()
    
    for portfolio in portfolio_names:
        # Generate deterministic seed from portfolio name hash, independent of list order
        # This ensures same portfolio always gets same seed even when called with different lists
        portfolio_seed = 42 + (hash(portfolio) % 1000)
        np.random.seed(portfolio_seed)
        
        # 8-15 equity holdings per portfolio
        num_equities = np.random.randint(8, 16)
        equity_indices = np.random.choice(len(equities), min(num_equities, len(equities)), replace=False)
        
        for idx in equity_indices:
            name, bb_code, country, sector = equities[idx]
            quantity = np.random.uniform(100, 5000)
            price = np.random.uniform(20, 300)
            
            rows.append({
                "portfolio": portfolio,
                "name": name,
                "Asset Type": "Equity",
                "bb_code": bb_code,
                "last_bb_date": today - timedelta(days=np.random.randint(0, 2)),
                "kvg_qty": quantity,
                "qty": quantity,
                "curr": "EUR",
                "Country": country,
                "Sector": sector,
                "unit": 1,
                "ams_price": price,
                "fx_rate": 1.0,
                "Maturity": None,
                "Security Type": "Equity",
            })
        
        # 3-8 fixed income holdings per portfolio
        num_bonds = np.random.randint(3, 9)
        bond_indices = np.random.choice(len(bonds), min(num_bonds, len(bonds)), replace=False)
        
        for idx in bond_indices:
            name, bb_code, bond_country = bonds[idx]
            quantity = np.random.uniform(10000, 100000)
            price = np.random.uniform(95, 105)  # Bond price as % of par
            
            sec_type = "Government" if "Govt" in bb_code else "Corporate"
            maturity_offset = np.random.randint(180, 1825)  # 6 months to 5 years
            maturity_date = today + timedelta(days=maturity_offset)
            
            rows.append({
                "portfolio": portfolio,
                "name": name,
                "Asset Type": "Fixed Income",
                "bb_code": bb_code,
                "last_bb_date": today - timedelta(days=np.random.randint(0, 2)),
                "kvg_qty": quantity,
                "qty": quantity,
                "curr": np.random.choice(["EUR", "USD", "GBP"]),
                "Country": bond_country,
                "Sector": None,
                "unit": 100,  # Bond face value
                "ams_price": price / 100,  # Convert to decimal
                "fx_rate": np.random.uniform(0.95, 1.05),
                "Maturity": maturity_date,
                "Security Type": sec_type,
            })
        
        # 1-2 cash positions per portfolio
        num_cash = np.random.randint(1, 3)
        for i in range(num_cash):
            amount = np.random.uniform(100000, 2000000)
            
            rows.append({
                "portfolio": portfolio,
                "name": "EUR Currency" if i == 0 else "USD Currency",
                "Asset Type": "Cash and Other",
                "bb_code": None,
                "last_bb_date": today,
                "kvg_qty": amount,
                "qty": amount,
                "curr": "EUR" if i == 0 else "USD",
                "Country": None,
                "Sector": None,
                "unit": 1,
                "ams_price": 1.0,
                "fx_rate": 1.0 if i == 0 else np.random.uniform(0.85, 1.10),
                "Maturity": None,
                "Security Type": "Cash and Other",
            })
    
    df = pd.DataFrame(rows)
    
    # Calculate ams_value (market value) and weights per portfolio
    df["ams_value"] = df["qty"] * df["ams_price"] * df["fx_rate"]
    
    for port in df["portfolio"].unique():
        mask = df["portfolio"] == port
        total = df.loc[mask, "ams_value"].sum()
        if total and total != 0:
            df.loc[mask, "Weight"] = df.loc[mask, "ams_value"] / total
        else:
            df.loc[mask, "Weight"] = 0.0
    
    logger.info("Generated %d synthetic holdings rows for %d portfolios", len(df), len(portfolio_names))
    return df


def _get_current_holdings(portfolio_names: List[str]) -> pd.DataFrame:
    """
    Retrieve current holdings for the given portfolios from AMS.
    Mirrors data/get_data.py::get_current_holdings().
    """
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic holdings data")
        return _generate_synthetic_holdings_data(portfolio_names)
    
    engine = db.ams_holdings_engine
    if engine is None or not portfolio_names:
        return pd.DataFrame()

    # Build the IN-clause safely
    placeholders = ", ".join(f"'{p.replace(chr(39), chr(39)*2)}'" for p in portfolio_names)

    try:
        holdings = pd.read_sql_query(
            f"""
            SET NOCOUNT ON;
            IF OBJECT_ID('tempdb..#Prices') IS NOT NULL
                DROP TABLE #Prices;
            SELECT *, ROW_NUMBER() OVER (PARTITION BY ParentId ORDER BY ValidFrom DESC) AS row
            INTO #Prices
            FROM [dbo].[Prices]
            WHERE ValidFrom >= DATEADD(DAY, -5, GETDATE())
              AND ParentId IS NOT NULL;

            SELECT
                g.Name                                 AS portfolio,
                SecurityName                           AS name,
                BloombergAssetType                     AS [Asset Type],
                BloombergCode                          AS bb_code,
                LastReferenceDataUpdateBloomberg       AS last_bb_date,
                KvgQuantity                            AS kvg_qty,
                Quantity                               AS qty,
                h.Name                                 AS curr,
                i.ISO                                  AS Country,
                j.Level1                               AS Sector,
                Denomination                           AS unit,
                (CASE WHEN BloombergAssetType = 'FixedIncome'
                      THEN PxLast / 100 ELSE PxLast END)  AS ams_price,
                LocalPriceWithCentFactor               AS fx_rate,
                Maturity
            FROM SegmentTradableAssets AS d
            LEFT JOIN [dbo].[TradableAssets]  AS e ON d.TradableAssetId = e.Id
            LEFT JOIN Segments                       AS f ON d.SegmentId = f.Id
            LEFT JOIN Portfolios                     AS g ON f.PortfolioId = g.Id
            LEFT JOIN Currencies                     AS h ON e.CurrencyId = h.Id
            LEFT JOIN Countries                      AS i ON e.CountryId = i.Id
            LEFT JOIN ClassificationElements         AS j ON e.GicsId = j.Id
            LEFT JOIN (SELECT * FROM #Prices WHERE row = 1) AS k ON PriceId = k.ParentId
            WHERE g.Name IN ({placeholders})
              AND KvgQuantityDate = (
                    SELECT MIN(KvgQuantityDate)
                    FROM (
                        SELECT MAX(KvgQuantityDate) AS KvgQuantityDate, SegmentId
                        FROM SegmentTradableAssets
                        WHERE SegmentId IN (
                            SELECT Id FROM Segments
                            WHERE PortfolioId IN (
                                SELECT Id FROM Portfolios
                                WHERE Name IN ({placeholders})
                                  AND ParentId IS NULL
                            )
                            AND ParentId IS NULL
                        )
                        GROUP BY SegmentId
                    ) AS subquery
              );
            """,
            engine,
        )

        # Cash positions
        cash = pd.read_sql_query(
            f"""
            SELECT
                SUM((ISNULL(d.KvgReportedAccountBalance, 0)
                     + ISNULL(d.KvgReportedAccountReceivables, 0)
                     - ISNULL(d.KvgReportedAccountPayables, 0))
                    / e.TargetPriceWithCentFactor) AS kvg_qty,
                g.Name AS portfolio
            FROM [dbo].[Accounts] AS d
            LEFT JOIN Currencies  AS e ON d.CurrencyId = e.Id
            LEFT JOIN Segments    AS f ON d.SegmentId = f.Id
            LEFT JOIN Portfolios  AS g ON f.PortfolioId = g.Id
            WHERE d.ValidTo IS NULL
              AND d.IsDeleted = 0
              AND g.Name IN ({placeholders})
            GROUP BY g.Name
            """,
            engine,
        )
        cash["name"]      = "EUR Currency"
        cash["curr"]      = "EUR"
        cash["unit"]      = 1
        cash["ams_price"] = 1
        cash["fx_rate"]   = 1
        cash["qty"]       = cash["kvg_qty"]

        df = pd.concat([holdings, cash]).reset_index(drop=True)
        df["ams_value"] = df["qty"] * df["ams_price"] * df["fx_rate"]

        # Map asset types (FixedIncome → Fixed Income, etc.)
        df["Asset Type"] = df["Asset Type"].apply(lambda x: AMS_AT_MAPPING.get(str(x), "Cash and Other"))

        # Derive security type from Bloomberg code suffix
        def _sec_type(bb_code):
            try:
                suffix = str(bb_code).split()[-1].upper()
                return {"CORP": "Corporate", "GOVT": "Government",
                        "EQUITY": "Equity", "CURNCY": "Future"}.get(suffix, "Cash and Other")
            except Exception:
                return "Cash and Other"

        df["Security Type"] = df["bb_code"].apply(_sec_type)

        # Calculate weight per portfolio
        for port in df["portfolio"].unique():
            mask = df["portfolio"] == port
            total = df.loc[mask, "ams_value"].sum()
            if total and total != 0:
                df.loc[mask, "Weight"] = df.loc[mask, "ams_value"] / total
            else:
                df.loc[mask, "Weight"] = 0.0

        return df

    except Exception as exc:
        logger.error("Failed to get current holdings: %s", exc)
        return pd.DataFrame()


# ══════════════════════════════════════════════════════════════════════════════
# AUM CALCULATIONS
# ══════════════════════════════════════════════════════════════════════════════

def _get_aum_by_portfolio(holdings: pd.DataFrame) -> pd.DataFrame:
    """
    Build a DataFrame with columns: Portfolio, Team, AUM_EUR, plus one column
    per security type (%) mirroring portfolio_data.py::get_aum_by_portfolio().
    """
    if holdings is None or holdings.empty:
        return pd.DataFrame(columns=["Portfolio", "Team", "AUM_EUR"])

    df = holdings[holdings["Security Type"] != "Future"].copy()

    aum = (
        df.groupby("portfolio")["ams_value"]
        .sum()
        .reset_index()
        .rename(columns={"portfolio": "portfolio_name", "ams_value": "AUM_EUR"})
    )
    aum["Portfolio"] = aum["portfolio_name"].apply(get_fund_display_name)
    aum["Team"]      = aum["Portfolio"].apply(get_team_for_portfolio)
    aum["AUM_EUR"]   = aum["AUM_EUR"].round(0).fillna(0)

    # Security type weights
    st_weights = (
        df.groupby(["portfolio", "Security Type"])["ams_value"]
        .sum()
        .reset_index()
    )
    st_weights["weight_pct"] = st_weights.groupby("portfolio")["ams_value"].transform(
        lambda x: (x / x.sum() * 100).round(1)
    )
    pivot = st_weights.pivot_table(index="portfolio", columns="Security Type",
                                   values="weight_pct", fill_value=0).reset_index()
    pivot.columns.name = None

    result = aum.merge(pivot, left_on="portfolio_name", right_on="portfolio", how="left")
    result = result.drop(columns=["portfolio_name", "portfolio"], errors="ignore")

    # Merge Corporate + Government → Anleihen
    if "Corporate" in result.columns and "Government" in result.columns:
        result["Anleihen"] = result["Corporate"] + result["Government"]
        result = result.drop(columns=["Corporate", "Government"])
    elif "Corporate" in result.columns:
        result = result.rename(columns={"Corporate": "Anleihen"})
    elif "Government" in result.columns:
        result = result.rename(columns={"Government": "Anleihen"})

    rename_map = {"Equity": "Aktien", "Cash and Other": "Kasse & Andere", "FixedIncome": "Anleihen"}
    result = result.rename(columns=rename_map)

    standard = ["Portfolio", "Team", "AUM_EUR"]
    sec_cols = sorted([c for c in result.columns if c not in standard])
    result = result[standard + sec_cols].sort_values("Portfolio").reset_index(drop=True)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# LIQUIDITY DATA
# ══════════════════════════════════════════════════════════════════════════════

def _generate_synthetic_cash_data() -> pd.DataFrame:
    """
    Generate synthetic cash position data for testing/demo purposes.
    Returns a DataFrame with columns: kvg_qty, ISO, PortName
    """
    # Get synthetic portfolio names
    portfolios = _generate_synthetic_portfolio_names()
    
    # Realistic currencies and amounts
    currencies = ["EUR", "USD", "GBP", "CHF"]
    
    # Generate base amounts per portfolio (seeded for consistency)
    np.random.seed(42)
    rows = []
    
    for portfolio in portfolios:
        for curr in currencies:
            # Generate realistic cash amounts (mostly EUR, less of other currencies)
            if curr == "EUR":
                # EUR is main currency - larger amounts
                amount = np.random.uniform(500000, 5000000)
            else:
                # Other currencies - smaller amounts with 60% probability
                if np.random.random() < 0.6:
                    amount = np.random.uniform(100000, 1000000)
                else:
                    continue  # Skip this currency
            
            rows.append({
                "kvg_qty": round(amount, 2),
                "ISO": curr,
                "PortName": portfolio,
            })
    
    if not rows:
        return pd.DataFrame(columns=["kvg_qty", "ISO", "PortName"])
    
    df = pd.DataFrame(rows)
    logger.info("Generated %d synthetic cash position rows for %d portfolios", len(df), len(portfolios))
    return df


def _load_cash_data() -> pd.DataFrame:
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic cash data")
        return _generate_synthetic_cash_data()
    
    engine = db.ams_holdings_engine
    if engine is None:
        return pd.DataFrame()
    try:
        return pd.read_sql_query(
            """
            SELECT
                SUM((ISNULL(d.KvgReportedAccountBalance, 0)
                     + ISNULL(d.KvgReportedAccountReceivables, 0)
                     - ISNULL(d.KvgReportedAccountPayables, 0))
                    / d.TargetPriceWithCentFactor) AS kvg_qty,
                d.ISO,
                d.PortName
            FROM (
                SELECT e.ISO, e.TargetPriceWithCentFactor, d.*, g.Name AS PortName
                FROM [dbo].[Accounts] AS d
                LEFT JOIN [dbo].[Currencies] AS e ON d.CurrencyId = e.Id
                LEFT JOIN Segments           AS f ON d.SegmentId = f.Id
                LEFT JOIN Portfolios         AS g ON f.PortfolioId = g.Id
                WHERE d.ValidTo IS NULL
                  AND d.IsDeleted = 0
            ) AS d
            WHERE d.PortName <> 'ZZZ AGP-Testportfolio'
            GROUP BY d.ISO, d.PortName
            """,
            engine,
        )
    except Exception as exc:
        logger.error("Failed to load cash data: %s", exc)
        return pd.DataFrame()


def _generate_synthetic_orders_data() -> pd.DataFrame:
    """
    Generate synthetic order data for testing/demo purposes.
    Returns a DataFrame with columns matching the SQL query from _load_orders_data().
    """
    np.random.seed(42)
    portfolios = _generate_synthetic_portfolio_names()
    
    asset_types = ["Equity", "FixedIncome"]
    currencies = ["EUR", "USD", "GBP", "CHF"]
    statuses = ["Executed", "Settled", "Partial"]
    execution_statuses = ["FullyExecuted", "PartiallyExecuted"]
    order_types = ["Market", "Limit", "Stop"]
    
    rows = []
    today = datetime.today().date()
    
    # Generate 3-5 orders per portfolio
    for portfolio in portfolios:
        num_orders = np.random.randint(3, 6)
        for i in range(num_orders):
            # Trade date within last 7 days
            trade_offset = np.random.randint(0, 7)
            trade_date = today - timedelta(days=trade_offset)
            
            # For weekends, shift to Friday
            while trade_date.weekday() > 4:
                trade_date -= timedelta(days=1)
            
            asset_type = np.random.choice(asset_types)
            currency = np.random.choice(currencies)
            
            # Realistic quantities and prices
            if asset_type == "Equity":
                quantity = np.random.uniform(100, 1000)
                price = np.random.uniform(50, 500)
            else:  # FixedIncome
                quantity = np.random.uniform(10000, 100000)  # Bonds in face value
                price = np.random.uniform(95, 105)  # Percentage of par
            
            executed_qty = quantity * np.random.uniform(0.7, 1.0)  # 70-100% executed
            price_in_eur = price * (1 + np.random.uniform(-0.05, 0.05))  # FX adjustment
            
            order_valid_until = today + timedelta(days=np.random.randint(1, 5))
            valid_from = trade_date
            
            rows.append({
                "Name": portfolio,
                "TradableAssetName": f"Asset_{i}_{portfolio[:3].upper()}",
                "AssetTypeName": asset_type,
                "TradableAssetCurrencyIso": currency,
                "BeforeOrderQuantity": quantity * np.random.uniform(0.9, 1.1),
                "Quantity": quantity,
                "ExecutedQuantity": executed_qty,
                "OrderValidUntil": order_valid_until,
                "ValidFrom": valid_from,
                "ValidTo": None,
                "TradeDate": trade_date,
                "Settlement": np.random.choice([2, 3]),  # 2-3 days settlement
                "PriceAtOrderTime": price,
                "PriceAtOrderTimeInEuro": price_in_eur,
                "TradingStatus": np.random.choice(statuses),
                "ExecutionStatus": np.random.choice(execution_statuses),
                "OrderValidType": np.random.choice(order_types),
                "Comment": "Synthetic order for testing" if i % 3 == 0 else None,
            })
    
    df = pd.DataFrame(rows)
    logger.info("Generated %d synthetic order rows for %d portfolios", len(df), len(portfolios))
    return df


def _load_orders_data() -> pd.DataFrame:
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic orders data")
        return _generate_synthetic_orders_data()
    
    engine = db.ams_holdings_engine
    if engine is None:
        return pd.DataFrame()
    try:
        return pd.read_sql_query(
            """
            SELECT
                f.Name,
                d.TradableAssetName,
                d.AssetTypeName,
                d.TradableAssetCurrencyIso,
                d.BeforeOrderQuantity,
                d.Quantity,
                d.ExecutedQuantity,
                d.OrderValidUntil,
                d.ValidFrom,
                d.ValidTo,
                d.TradeDate,
                SaleValuta AS Settlement,
                d.PriceAtOrderTime,
                d.PriceAtOrderTimeInEuro,
                d.TradingStatus,
                d.ExecutionStatus,
                d.OrderValidType,
                d.Comment
            FROM [dbo].[OrderAssets] AS d
            LEFT JOIN [dbo].[Segments]    AS e ON d.SegmentId = e.Id
            LEFT JOIN [dbo].[Portfolios]  AS f ON e.PortfolioId = f.Id
            LEFT JOIN [dbo].[TradableAssets] AS g ON d.TradableAssetId = g.Id
            WHERE e.ValidTo IS NULL
              AND d.ValidFrom >= DATEADD(DAY, -7, CAST(GETDATE() AS date))
              AND d.ExecutedQuantity IS NOT NULL
            ORDER BY d.OrderValidUntil
            """,
            engine,
        )
    except Exception as exc:
        logger.error("Failed to load orders data: %s", exc)
        return pd.DataFrame()


def _generate_synthetic_maturities_data() -> pd.DataFrame:
    """
    Generate synthetic maturity data for testing/demo purposes.
    Returns a DataFrame with columns matching the SQL query from _load_maturities_data().
    Simulates upcoming fixed income instrument maturities within next 10 days.
    """
    np.random.seed(42)
    portfolios = _generate_synthetic_portfolio_names()
    
    bond_names = [
        "German Bund 2026", "US Treasury 2026", "Italian BTP 2026",
        "French OAT 2026", "Spanish Bonos 2026", "Corporate Bond AAA",
        "Corporate Bond AA", "Emerging Market Bond", "Swiss Bond 2026",
        "UK Gilt 2026", "Belgian Bond 2026", "Austrian Bond 2026",
    ]
    
    currencies = ["EUR", "USD", "GBP", "CHF"]
    
    rows = []
    today = datetime.today().date()
    
    # Generate 1-3 maturity events per portfolio within next 10 days
    for portfolio in portfolios:
        num_maturities = np.random.randint(1, 4)
        for i in range(num_maturities):
            # Maturity date within next 10 days
            maturity_offset = np.random.randint(1, 11)
            maturity_date = today + timedelta(days=maturity_offset)
            
            # Skip weekends
            while maturity_date.weekday() > 4:
                maturity_date += timedelta(days=1)
            
            bond_name = np.random.choice(bond_names)
            currency = np.random.choice(currencies)
            
            # Realistic quantity (face value in thousands)
            quantity = np.random.uniform(500, 5000)
            
            # Generate Bloomberg code for bonds
            isin_prefix = np.random.choice(["DE", "US", "IT", "FR", "ES", "GB", "CH"])
            isin = f"{isin_prefix}{np.random.randint(100000000, 999999999)}"
            bb_code = f"{isin} Corp" if "Corporate" in bond_name else f"{isin} Govt"
            
            rows.append({
                "PortfolioName": portfolio,
                "TradableAssetsName": bond_name,
                "BloombergCode": bb_code,
                "TradableAssetsMaturity": maturity_date,
                "KvgQuantity": round(quantity, 2),
                "CurrenciesName": currency,
            })
    
    if not rows:
        return pd.DataFrame(columns=["PortfolioName", "TradableAssetsName", "BloombergCode", 
                                      "TradableAssetsMaturity", "KvgQuantity", "CurrenciesName"])
    
    df = pd.DataFrame(rows)
    df = df.sort_values(["TradableAssetsMaturity", "PortfolioName"]).reset_index(drop=True)
    logger.info("Generated %d synthetic maturity rows for %d portfolios", len(df), len(portfolios))
    return df


def _load_maturities_data() -> pd.DataFrame:
    # Use synthetic data if flag is set
    if USE_SYNTHETIC_DATA:
        logger.info("USE_SYNTHETIC_DATA is True – generating synthetic maturities data")
        return _generate_synthetic_maturities_data()
    
    engine = db.ams_holdings_engine
    if engine is None:
        return pd.DataFrame()
    try:
        return pd.read_sql_query(
            """
            SELECT
                PortfolioName,
                TradableAssetsName,
                BloombergCode,
                TradableAssetsMaturity,
                KvgQuantity,
                CurrenciesName
            FROM [dbo].[vwPortfolioAssets]
            WHERE TradableAssetsMaturity BETWEEN GETDATE() AND DATEADD(DAY, 10, GETDATE())
            ORDER BY TradableAssetsMaturity, PortfolioName
            """,
            engine,
        )
    except Exception as exc:
        logger.error("Failed to load maturities data: %s", exc)
        return pd.DataFrame()


def _build_liquidity_rows(cash_df: pd.DataFrame, orders_df: pd.DataFrame,
                           maturities_df: pd.DataFrame) -> dict:
    """
    Build {portfolio_name: {displayName, today, <date_key>: value, ...}} dict.
    Returns (card_data, forecast_dates) equivalent to the Dash project.
    """
    if cash_df.empty:
        return {}, []

    today_date = datetime.today().date()
    days_out = 4
    all_dates = [today_date + timedelta(days=i) for i in range(days_out + 1)]

    # Forecast dates = next 4 business days
    forecast_dates = []
    cur = today_date
    while len(forecast_dates) < 4:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            forecast_dates.append(cur)

    portfolio_ids = sorted(cash_df["PortName"].unique())
    currencies    = sorted(cash_df["ISO"].unique())

    # base[date][currency][portfolio] = value
    base = {d: {c: {p: 0.0 for p in portfolio_ids} for c in currencies} for d in all_dates}

    for _, row in cash_df.iterrows():
        base[today_date][row["ISO"]][row["PortName"]] = float(row["kvg_qty"] or 0)

    if not orders_df.empty:
        for _, row in orders_df.iterrows():
            if str(row.get("AssetTypeName", "")).lower() == "future":
                continue
            try:
                trade_date      = pd.to_datetime(row["TradeDate"]).date()
                settlement_days = int(row["Settlement"]) if pd.notna(row.get("Settlement")) else 0
            except Exception:
                continue
            settlement_date = trade_date + timedelta(days=settlement_days)
            if settlement_date < today_date:
                continue
            currency  = row["TradableAssetCurrencyIso"]
            portfolio = row["Name"]
            if currency not in currencies or portfolio not in portfolio_ids:
                continue
            qty       = float(row.get("ExecutedQuantity") or 0)
            price_eur = float(row.get("PriceAtOrderTimeInEuro") or 0)
            impact    = abs(qty * price_eur) * (1 if qty < 0 else -1)
            if settlement_date in base:
                base[settlement_date][currency][portfolio] += impact

    if not maturities_df.empty:
        for _, row in maturities_df.iterrows():
            mat_date  = pd.to_datetime(row["TradableAssetsMaturity"]).date()
            portfolio = row.get("PortfolioName")
            currency  = row.get("CurrenciesName")
            qty       = float(row.get("KvgQuantity") or 0)
            if portfolio not in portfolio_ids or currency not in currencies:
                continue
            if mat_date in base:
                base[mat_date][currency][portfolio] += qty

    card_data = {}
    for portfolio in portfolio_ids:
        currency_data = {}
        for currency in currencies:
            currency_data[currency] = {"today": round(base[today_date][currency][portfolio], 0)}
            for d in forecast_dates:
                val = base[today_date][currency][portfolio]
                for dd in all_dates:
                    if dd > today_date and dd <= d:
                        val += base[dd][currency][portfolio]
                currency_data[currency][d.strftime("%Y-%m-%d")] = round(val, 0)

        # Group maturities by date
        maturities_by_date: Dict[str, list] = {}
        upcoming_count = 0
        if not maturities_df.empty:
            port_mats = maturities_df[maturities_df["PortfolioName"] == portfolio]
            upcoming_count = len(port_mats)
            for _, mrow in port_mats.iterrows():
                mat_date = pd.to_datetime(mrow["TradableAssetsMaturity"]).date()
                dk = mat_date.strftime("%Y-%m-%d")
                if dk not in maturities_by_date:
                    maturities_by_date[dk] = []
                maturities_by_date[dk].append({
                    "asset":    mrow.get("TradableAssetsName", "Unknown"),
                    "quantity": float(mrow.get("KvgQuantity") or 0),
                    "currency": mrow.get("CurrenciesName", ""),
                })

        card_data[portfolio] = {
            "displayName":            get_fund_display_name(portfolio),
            "currency_data":          currency_data,
            "upcoming_maturities_count": upcoming_count,
            "maturities_by_date":     maturities_by_date,
        }

    return card_data, forecast_dates


# ══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO DETAIL (allocation data for pie charts)
# ══════════════════════════════════════════════════════════════════════════════

def _df_to_slices(df: pd.DataFrame, label_col: str) -> list:
    """Convert a 2-column DataFrame (label, Value) to [{name, value}] list."""
    if df is None or df.empty:
        return []
    return [
        {"name": str(row[label_col]), "value": round(float(row["Value"]), 2)}
        for _, row in df.iterrows()
        if pd.notna(row["Value"]) and float(row["Value"]) > 0
    ]


def _get_allocation_asset_type(h: pd.DataFrame) -> list:
    non_fut = h[h["Asset Type"] != "Future"]
    alloc   = non_fut.groupby("Asset Type")["ams_value"].sum().reset_index()
    alloc.columns = ["Asset Type", "Value"]
    total = alloc["Value"].sum()
    alloc["Value"] = (alloc["Value"] / total * 100).round(2) if total else 0
    return _df_to_slices(alloc.sort_values("Value", ascending=False), "Asset Type")


def _get_allocation_security_type(h: pd.DataFrame) -> list:
    non_fut = h[h["Asset Type"] != "Future"]
    alloc   = non_fut.groupby("Security Type")["ams_value"].sum().reset_index()
    alloc.columns = ["Security Type", "Value"]
    total = alloc["Value"].sum()
    alloc["Value"] = (alloc["Value"] / total * 100).round(2) if total else 0
    return _df_to_slices(alloc.sort_values("Value", ascending=False), "Security Type")


def _get_allocation_country(h: pd.DataFrame, asset_type_filter: Optional[str] = None) -> list:
    df = h[h["Asset Type"] != "Future"]
    if asset_type_filter:
        df = df[df["Asset Type"] == asset_type_filter]
    df = df[df["Country"].notna()]
    if df.empty:
        return []
    alloc = df.groupby("Country")["ams_value"].sum().reset_index()
    alloc.columns = ["Country", "Value"]
    total = alloc["Value"].sum()
    alloc["Value"] = (alloc["Value"] / total * 100).round(2) if total else 0
    return _df_to_slices(alloc.sort_values("Value", ascending=False), "Country")


def _get_allocation_sector_equity(h: pd.DataFrame) -> list:
    df = h[(h["Asset Type"] == "Equity") & h["Sector"].notna()]
    if df.empty:
        return []
    alloc = df.groupby("Sector")["ams_value"].sum().reset_index()
    alloc.columns = ["Sector", "Value"]
    total = alloc["Value"].sum()
    alloc["Value"] = (alloc["Value"] / total * 100).round(2) if total else 0
    return _df_to_slices(alloc.sort_values("Value", ascending=False), "Sector")


def _get_allocation_bond_split(h: pd.DataFrame) -> list:
    fi = h[h["Asset Type"] == "Fixed Income"].copy()
    if fi.empty:
        return []
    fi["BondType"] = fi["Security Type"].map({"Corporate": "Corporate", "Government": "Government"}).fillna("Other")
    fi = fi[fi["BondType"].isin(["Corporate", "Government"])]
    if fi.empty:
        return []
    alloc = fi.groupby("BondType")["ams_value"].sum().reset_index()
    alloc.columns = ["Bond Type", "Value"]
    total = alloc["Value"].sum()
    alloc["Value"] = (alloc["Value"] / total * 100).round(2) if total else 0
    return _df_to_slices(alloc.sort_values("Value", ascending=False), "Bond Type")


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════

def get_overview_data() -> dict:
    """
    Returns all data needed for the Overview subtab:
      - aum_cards: {total, MA, HC, Spezial}        (formatted strings)
      - aum_table: [{Portfolio, Team, AUM_EUR, ...sec_type_cols...}]
      - aum_table_columns: [col_name, ...]
      - liquidity_rows: [{portfolio, displayName, today, <date>:..., maturities, currencies}]
      - liquidity_dates: ["Mon 02.01", ...]   (D+1…D+4 formatted labels)
    """
    try:
        all_ports = _get_all_portfolio_names()
        holdings  = _get_current_holdings(all_ports) if all_ports else pd.DataFrame()

        aum_df     = _get_aum_by_portfolio(holdings)

        # AUM cards
        total_aum  = aum_df["AUM_EUR"].sum() if not aum_df.empty else 0
        team_totals = {}
        if not aum_df.empty:
            for team, tot in aum_df.groupby("Team")["AUM_EUR"].sum().items():
                team_totals[team] = tot

        aum_cards = {
            "total":   _format_aum(total_aum),
            "MA":      _format_aum(team_totals.get("MA", 0)),
            "HC":      _format_aum(team_totals.get("HC", 0)),
            "Spezial": _format_aum(team_totals.get("Spezial", 0)),
        }

        # AUM table
        aum_table_rows = []
        aum_table_cols = []
        if not aum_df.empty:
            display_df = aum_df.copy()
            display_df["AUM_EUR_Display"] = display_df["AUM_EUR"].apply(_format_aum)
            sec_cols = [c for c in display_df.columns if c not in {"Portfolio", "Team", "AUM_EUR", "AUM_EUR_Display"}]
            aum_table_cols = ["Portfolio", "Team", "AUM (EUR)"] + [f"{c} (%)" for c in sorted(sec_cols)]
            for _, row in display_df.iterrows():
                r = {
                    "Portfolio": row["Portfolio"],
                    "Team":      row.get("Team") or "",
                    "AUM (EUR)": row["AUM_EUR_Display"],
                }
                for c in sorted(sec_cols):
                    v = row.get(c, 0)
                    r[f"{c} (%)"] = f"{v:.1f}" if v else "–"
                aum_table_rows.append(r)

        # Liquidity data
        cash_df      = _load_cash_data()
        orders_df    = _load_orders_data()
        matur_df     = _load_maturities_data()
        card_data, forecast_dates = _build_liquidity_rows(cash_df, orders_df, matur_df)

        liquidity_rows = []
        today_date = datetime.today().date()
        for pname in sorted(card_data.keys()):
            data = card_data[pname]
            currencies_data = data["currency_data"]

            # Summary totals per date
            today_total = sum(v.get("today", 0) for v in currencies_data.values())
            date_totals = {}
            for fd in forecast_dates:
                dk = fd.strftime("%Y-%m-%d")
                date_totals[dk] = sum(v.get(dk, 0) for v in currencies_data.values())

            # Build currency sub-rows for expand
            currency_rows = []
            for curr, vals in sorted(currencies_data.items()):
                today_val = vals.get("today", 0)
                if today_val == 0 and all(vals.get(fd.strftime("%Y-%m-%d"), 0) == 0 for fd in forecast_dates):
                    continue
                crow = {"currency": curr, "today": today_val}
                for fd in forecast_dates:
                    dk = fd.strftime("%Y-%m-%d")
                    crow[dk] = vals.get(dk, 0)
                currency_rows.append(crow)

            # Check for negative forecasts
            has_negative = any(v < 0 for v in date_totals.values())

            # All maturity dates
            all_maturity_date_keys = set(data["maturities_by_date"].keys())

            row = {
                "portfolio":    pname,
                "displayName":  data["displayName"],
                "today":        today_total,
                "has_negative": has_negative,
                "maturities":   data["upcoming_maturities_count"],
                "maturities_by_date":  data["maturities_by_date"],
                "all_maturity_date_keys": list(all_maturity_date_keys),
                "currency_rows": currency_rows,
            }
            for fd in forecast_dates:
                dk = fd.strftime("%Y-%m-%d")
                row[dk] = date_totals.get(dk, 0)
            liquidity_rows.append(row)

        liquidity_date_labels = [fd.strftime("%a %d.%m") for fd in forecast_dates]
        liquidity_date_keys   = [fd.strftime("%Y-%m-%d") for fd in forecast_dates]

        return {
            "status":               "ok",
            "aum_cards":            aum_cards,
            "aum_table_rows":       aum_table_rows,
            "aum_table_cols":       aum_table_cols,
            "liquidity_rows":       liquidity_rows,
            "liquidity_date_labels": liquidity_date_labels,
            "liquidity_date_keys":  liquidity_date_keys,
        }
    except Exception as exc:
        logger.error("get_overview_data error: %s", exc)
        import traceback; traceback.print_exc()
        return {"status": "error", "error": str(exc)}


def get_portfolio_list() -> dict:
    """Return sorted list of portfolio {label, value} pairs for the dropdown."""
    try:
        all_ports = _get_all_portfolio_names()
        items = sorted(
            [{"label": get_fund_display_name(p), "value": p} for p in all_ports],
            key=lambda x: x["label"],
        )
        return {"status": "ok", "portfolios": items}
    except Exception as exc:
        logger.error("get_portfolio_list error: %s", exc)
        return {"status": "error", "error": str(exc), "portfolios": []}


def get_portfolio_detail(portfolio_name: str) -> dict:
    """
    Returns detail data for the Portfolio subtab:
      - metrics: {total_value, total_holdings, top_holding_weight, equity_pct, fi_pct, cash_pct}
      - holdings: [{Name, Assetklasse, Wertpapiertyp, Land, Sektor, Menge, Währung, Wert (EUR), Gewicht (%)}]
      - allocation: {asset_type, security_type, country, country_equity, country_fi, sector_equity, bond_split}
      - latest_date: str
    """
    try:
        h = _get_current_holdings([portfolio_name])
        if h.empty:
            return {"status": "ok", "metrics": {}, "holdings": [], "allocation": {}, "latest_date": None}

        total_value     = float(h["ams_value"].sum())
        total_holdings  = len(h)
        top_hold_weight = float(h["Weight"].max() * 100) if not h["Weight"].isna().all() else 0.0

        def _pct(at):
            return float(h[h["Asset Type"] == at]["ams_value"].sum() / total_value * 100) if total_value else 0.0

        metrics = {
            "total_value":       total_value,
            "total_holdings":    total_holdings,
            "top_holding_weight": round(top_hold_weight, 2),
            "equity_pct":        round(_pct("Equity"), 1),
            "fi_pct":            round(_pct("Fixed Income"), 1),
            "cash_pct":          round(_pct("Cash and Other"), 1),
        }

        # Holdings table rows
        table_df = h[[
            "name", "Asset Type", "Security Type", "Country", "Sector",
            "qty", "curr", "ams_value", "Weight",
        ]].rename(columns={
            "name":        "Name",
            "Asset Type":  "Assetklasse",
            "Security Type": "Wertpapiertyp",
            "Country":     "Land",
            "Sector":      "Sektor",
            "qty":         "Menge",
            "curr":        "Währung",
            "ams_value":   "Wert (EUR)",
            "Weight":      "Gewicht (%)",
        }).copy()
        table_df = table_df.sort_values("Gewicht (%)", ascending=False, na_position="last")
        table_df["Wert (EUR)"]   = table_df["Wert (EUR)"].apply(lambda x: f"{x:,.0f}".replace(",", ".") if pd.notna(x) else "")
        table_df["Gewicht (%)"]  = table_df["Gewicht (%)"].apply(lambda x: f"{x:.2%}" if pd.notna(x) else "")
        table_df["Menge"]        = table_df["Menge"].apply(lambda x: f"{x:,.0f}".replace(",", ".") if pd.notna(x) else "")
        table_df = table_df.fillna("")
        holdings_rows = table_df.to_dict("records")

        # Latest date
        latest_date = None
        if "last_bb_date" in h.columns:
            dates = h["last_bb_date"].dropna()
            if not dates.empty:
                try:
                    max_d = dates.max()
                    if isinstance(max_d, pd.Timestamp):
                        latest_date = max_d.strftime("%Y-%m-%d")
                    else:
                        latest_date = pd.to_datetime(int(max_d), unit="ms").strftime("%Y-%m-%d")
                except Exception:
                    pass

        allocation = {
            "asset_type":    _get_allocation_asset_type(h),
            "security_type": _get_allocation_security_type(h),
            "country":       _get_allocation_country(h),
            "country_equity":_get_allocation_country(h, "Equity"),
            "country_fi":    _get_allocation_country(h, "Fixed Income"),
            "sector_equity": _get_allocation_sector_equity(h),
            "bond_split":    _get_allocation_bond_split(h),
        }

        return {
            "status":      "ok",
            "metrics":     metrics,
            "holdings":    holdings_rows,
            "allocation":  allocation,
            "latest_date": latest_date,
        }
    except Exception as exc:
        logger.error("get_portfolio_detail error for %s: %s", portfolio_name, exc)
        import traceback; traceback.print_exc()
        return {"status": "error", "error": str(exc)}
