/**
 * Equity Metrics Configuration
 *
 * Defines all available metrics grouped by category, with display names
 * and whether they support table display, graph display, or both.
 *
 * Mirrors the COLS_EQ_AGG structure from the reference Dash dashboard
 * (C:\Projekte\dashboard\countries\mapping.py).
 */

export const EQUITY_METRICS_CATEGORIES = [
  {
    key: 'Trend',
    label: 'TREND',
    fields: [
      { key: 'MOM_3',  label: 'Momentum 3M',   tableEnabled: true,  graphEnabled: true  },
      { key: 'MOM_12', label: 'Momentum 12M',  tableEnabled: true,  graphEnabled: true  },
      { key: 'MOM_TS', label: 'TS-Momentum',   tableEnabled: true,  graphEnabled: true  },
    ],
  },
  {
    key: 'Bewertung',
    label: 'BEWERTUNG',
    fields: [
      { key: 'Weighted Valuation', label: 'Bewertung Agg.',    tableEnabled: true, graphEnabled: true },
      { key: 'EARN_YLD',           label: 'Ertragsrendite',    tableEnabled: true, graphEnabled: true },
      { key: 'PX_TO_SALES_RATIO',  label: 'KUV',              tableEnabled: true, graphEnabled: true },
      { key: 'PX_TO_BOOK_RATIO',   label: 'KBV',              tableEnabled: true, graphEnabled: true },
      { key: 'PE_RATIO',           label: 'KGV',              tableEnabled: true, graphEnabled: true },
      { key: 'BEST_PE_RATIO',      label: 'KGV (Fwd.)',       tableEnabled: true, graphEnabled: true },
    ],
  },
  {
    key: 'Technisch',
    label: 'TECHNISCH',
    fields: [
      { key: 'Rolling Volatility', label: 'Volatilität',   tableEnabled: true, graphEnabled: true },
      { key: 'MA_50_Diff',         label: 'MA50 Distanz',  tableEnabled: false, graphEnabled: true },
      { key: 'RSI',                label: 'RSI',           tableEnabled: true, graphEnabled: true },
      { key: 'MACD',               label: 'MACD',          tableEnabled: true, graphEnabled: true },
      { key: 'MACD_Signal',        label: 'MACD Signal',   tableEnabled: true, graphEnabled: true },
      { key: 'MACD_Histogram',     label: 'MACD Histogramm', tableEnabled: true, graphEnabled: true },
    ],
  },
  {
    key: 'Spezial',
    label: 'SPEZIAL',
    graphOnly: true,   // entire category is graph-only → no TABELLE column shown
    fields: [
      { key: 'Performance', label: 'Performance',       tableEnabled: false, graphEnabled: true },
      { key: 'EPS_Growth',  label: 'Gewinnentwicklung', tableEnabled: false, graphEnabled: true },
    ],
  },
]

/** Keys of all metrics that can appear in the table */
export const ALL_TABLE_METRICS = EQUITY_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.tableEnabled).map(f => f.key)
)

/** Keys of all metrics that can appear in graphs */
export const ALL_GRAPH_METRICS = EQUITY_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.graphEnabled).map(f => f.key)
)

/** Standard (factory) defaults – pre-checked when user hits "Load Standard" */
export const STANDARD_DEFAULTS = {
  table: ['MOM_3', 'MOM_12', 'MOM_TS', 'Weighted Valuation', 'PE_RATIO', 'RSI', 'MACD'],
  graph: ['RSI', 'Performance', 'EPS_Growth'],
}

/** Look up a field config by key (across all categories) */
export function getFieldConfig(key) {
  for (const cat of EQUITY_METRICS_CATEGORIES) {
    const field = cat.fields.find(f => f.key === key)
    if (field) return { ...field, category: cat.key, categoryLabel: cat.label }
  }
  return null
}

/** Get human-readable display label for a metric key */
export function getMetricLabel(key) {
  const config = getFieldConfig(key)
  return config ? config.label : key
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXED INCOME (ANLEIHEN) METRICS CONFIG
// Mirrors COLS_FI from C:\Projekte\dashboard\countries\mapping.py
// ─────────────────────────────────────────────────────────────────────────────

export const FI_METRICS_CATEGORIES = [
  {
    key: 'Zinsen',
    label: 'ZINSEN',
    fields: [
      { key: '2Y Yields',         label: '2J Rendite',          tableEnabled: true,  graphEnabled: true  },
      { key: '5Y Yields',         label: '5J Rendite',          tableEnabled: true,  graphEnabled: true  },
      { key: '10Y Yields',        label: '10J Rendite',         tableEnabled: true,  graphEnabled: true  },
      { key: '20Y Yields',        label: '20J Rendite',         tableEnabled: false, graphEnabled: true  },
      { key: '30Y Yields',        label: '30J Rendite',         tableEnabled: true,  graphEnabled: true  },
      { key: 'Steepness',         label: 'Steilheit (10J-2J)',  tableEnabled: true,  graphEnabled: true  },
      { key: 'Curvature',         label: 'Krümmung',            tableEnabled: false, graphEnabled: true  },
      { key: 'Spreads to Bunds',  label: 'Aufschl. zu Bunds',   tableEnabled: true,  graphEnabled: true  },
    ],
  },
  {
    key: 'Kreditqualität',
    label: 'KREDITQUALITÄT',
    fields: [
      { key: '3 CDS',  label: '3J CDS',  tableEnabled: true,  graphEnabled: true },
      { key: '5 CDS',  label: '5J CDS',  tableEnabled: true,  graphEnabled: true },
      { key: '7 CDS',  label: '7J CDS',  tableEnabled: false, graphEnabled: true },
      { key: '10 CDS', label: '10J CDS', tableEnabled: false, graphEnabled: true },
    ],
  },
  {
    key: 'Inflationserwartungen',
    label: 'INFLATIONSERWARTUNGEN',
    fields: [
      { key: '1Y Inflation Expectations',  label: '1J Infl. Erw.',   tableEnabled: true,  graphEnabled: true },
      { key: '2Y Inflation Expectations',  label: '2J Infl. Erw.',   tableEnabled: false, graphEnabled: true },
      { key: '5Y Inflation Expectations',  label: '5J Infl. Erw.',   tableEnabled: false, graphEnabled: true },
      { key: '10Y Inflation Expectations', label: '10J Infl. Erw.',  tableEnabled: false, graphEnabled: true },
      { key: '10Y Breakevens',             label: '10J Breakevens',  tableEnabled: true,  graphEnabled: true },
    ],
  },
]

/** All FI table-eligible metric keys */
export const ALL_FI_TABLE_METRICS = FI_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.tableEnabled).map(f => f.key)
)

/** All FI graph-eligible metric keys */
export const ALL_FI_GRAPH_METRICS = FI_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.graphEnabled).map(f => f.key)
)

/** Standard (factory) defaults for FI tab */
export const FI_STANDARD_DEFAULTS = {
  table: ['2Y Yields', '10Y Yields', 'Steepness', 'Spreads to Bunds', '5 CDS', '10Y Breakevens'],
  graph: ['2Y Yields', '10Y Yields', 'Steepness', 'Spreads to Bunds', '5 CDS', '10Y Breakevens'],
}

/** Get FI field config by key */
export function getFIFieldConfig(key) {
  for (const cat of FI_METRICS_CATEGORIES) {
    const field = cat.fields.find(f => f.key === key)
    if (field) return { ...field, category: cat.key, categoryLabel: cat.label }
  }
  return null
}

/** Get human-readable display label for an FI metric key */
export function getFIMetricLabel(key) {
  const config = getFIFieldConfig(key)
  return config ? config.label : key
}

// ─────────────────────────────────────────────────────────────────────────────
// MACRO METRICS CONFIGURATION
// Mirrors COLS_MACRO from C:\Projekte\dashboard\countries\mapping.py
// ─────────────────────────────────────────────────────────────────────────────

export const MACRO_METRICS_CATEGORIES = [
  {
    key: 'Konjunktur',
    label: 'KONJUNKTUR',
    fields: [
      { key: 'GDP',                      label: 'BIP',                   tableEnabled: true,  graphEnabled: true  },
      { key: 'Economic Surprise',        label: 'Überraschungsindex',    tableEnabled: true,  graphEnabled: true  },
      { key: 'Industrial Production',    label: 'Industrieproduktion',   tableEnabled: true,  graphEnabled: true  },
      { key: 'Retail Sales',             label: 'Einzelhandelsumsätze',  tableEnabled: true,  graphEnabled: true  },
      { key: 'Trade Policy Uncertainty', label: 'Handelspol. Unsich.',   tableEnabled: false, graphEnabled: true  },
      { key: 'New Orders',               label: 'Auftragseingang',       tableEnabled: false, graphEnabled: true  },
    ],
  },
  {
    key: 'Fundamental',
    label: 'FUNDAMENTAL',
    fields: [
      { key: 'Inflation',   label: 'Inflation',     tableEnabled: true, graphEnabled: true },
      { key: 'Unemployment', label: 'Arbeitslosigk.', tableEnabled: true, graphEnabled: true },
      { key: 'Misery',      label: 'Misery-Index',  tableEnabled: true, graphEnabled: true },
    ],
  },
  {
    key: 'Geschäftsklima',
    label: 'GESCHÄFTSKLIMA',
    fields: [
      { key: 'Composite PMI',      label: 'PMI Gesamt',          tableEnabled: true,  graphEnabled: true },
      { key: 'Manufacturing PMI',  label: 'PMI Industrie',       tableEnabled: true,  graphEnabled: true },
      { key: 'Services PMI',       label: 'PMI Dienstleistungen', tableEnabled: false, graphEnabled: true },
      { key: 'Consumer Confidence', label: 'Verbrauchervertrauen', tableEnabled: false, graphEnabled: true },
    ],
  },
  {
    key: 'Außenhandel',
    label: 'AUSSENHANDEL',
    fields: [
      { key: 'Trade Balance',  label: 'Handelsbilanz',   tableEnabled: true,  graphEnabled: true },
      { key: 'Current Account', label: 'Leistungsbilanz', tableEnabled: true,  graphEnabled: true },
      { key: 'Exports',        label: 'Exporte (YoY %)', tableEnabled: false, graphEnabled: true },
      { key: 'Imports',        label: 'Importe (YoY %)', tableEnabled: false, graphEnabled: true },
    ],
  },
  {
    key: 'Fiskal',
    label: 'FISKAL',
    fields: [
      { key: 'Government Debt', label: 'Staatsverschuldung', tableEnabled: true,  graphEnabled: true },
      { key: 'Budget Balance',  label: 'Haushaltssaldo',     tableEnabled: false, graphEnabled: true },
    ],
  },
  {
    key: 'Andere',
    label: 'ANDERE',
    fields: [
      { key: 'Interest Rate', label: 'Leitzins', tableEnabled: true, graphEnabled: true },
    ],
  },
]

/** All Macro table-eligible metric keys */
export const ALL_MACRO_TABLE_METRICS = MACRO_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.tableEnabled).map(f => f.key)
)

/** All Macro graph-eligible metric keys */
export const ALL_MACRO_GRAPH_METRICS = MACRO_METRICS_CATEGORIES.flatMap(cat =>
  cat.fields.filter(f => f.graphEnabled).map(f => f.key)
)

/** Standard (factory) defaults for Macro tab */
export const MACRO_STANDARD_DEFAULTS = {
  table: ['GDP', 'Inflation', 'Unemployment', 'Composite PMI', 'Trade Balance', 'Government Debt', 'Interest Rate'],
  graph: ['GDP', 'Inflation', 'Unemployment', 'Composite PMI', 'Manufacturing PMI', 'Trade Balance', 'Interest Rate'],
}

/** Get Macro field config by key */
export function getMacroFieldConfig(key) {
  for (const cat of MACRO_METRICS_CATEGORIES) {
    const field = cat.fields.find(f => f.key === key)
    if (field) return { ...field, category: cat.key, categoryLabel: cat.label }
  }
  return null
}

/** Get human-readable display label for a Macro metric key */
export function getMacroMetricLabel(key) {
  const config = getMacroFieldConfig(key)
  return config ? config.label : key
}
