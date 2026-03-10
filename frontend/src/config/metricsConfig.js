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
    key: 'Spezial',
    label: 'SPEZIAL',
    graphOnly: true,   // entire category is graph-only → no TABELLE column shown
    fields: [
      { key: 'Performance', label: 'Wertentwicklung',   tableEnabled: false, graphEnabled: true, higherBetter: true, unit: '%', yAxisLabel: '%', currencyAffected: true  },
      { key: 'EPS_Growth',  label: 'Gewinnentwicklung', tableEnabled: false, graphEnabled: true, higherBetter: true, unit: '%', yAxisLabel: '%', currencyAffected: true  },
    ],
  },
  {
    key: 'Trend',
    label: 'TREND',
    fields: [
      { key: 'MOM_3',      label: 'Momentum 3M',   tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: true  },
      { key: 'MOM_12',     label: 'Momentum 12M',  tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: true  },
      { key: 'MOM_TS',     label: 'TS-Momentum',   tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: true  },
      { key: 'Grwth_Rate', label: 'Wachstumsrate', tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: true  },
    ],
  },
  {
    key: 'Bewertung',
    label: 'BEWERTUNG',
    fields: [
      { key: 'Weighted Valuation', label: 'Bewertung Aggregiert',      tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '',  yAxisLabel: 'Wert',  currencyAffected: false },
      { key: 'Premium',            label: 'Risikoprämie',        tableEnabled: true, graphEnabled: true, higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: false },
      { key: 'Div_Yld',            label: 'Dividendenrendite',   tableEnabled: true, graphEnabled: true, higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: false },
      { key: 'EARN_YLD',           label: 'Ertragsrendite',      tableEnabled: true, graphEnabled: true, higherBetter: true,  unit: '%', yAxisLabel: '%',     currencyAffected: false },
      { key: 'PX_TO_SALES_RATIO',  label: 'KUV',                 tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '',  yAxisLabel: 'Wert',  currencyAffected: false },
      { key: 'PX_TO_BOOK_RATIO',   label: 'KBV',                 tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '',  yAxisLabel: 'Wert',  currencyAffected: false },
      { key: 'PE_RATIO',           label: 'KGV',                 tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '',  yAxisLabel: 'Wert',  currencyAffected: false },
      { key: 'BEST_PE_RATIO',      label: 'KGV (Fwd.)',          tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '', yAxisLabel: 'Wert',  currencyAffected: false },
    ],
  },
  {
    key: 'Technisch',
    label: 'TECHNISCH',
    fields: [
      { key: 'Rolling Volatility', label: 'Volatilität (6M Roll.)',  tableEnabled: true,  graphEnabled: true, higherBetter: false, unit: '%', yAxisLabel: '%',     currencyAffected: false },
      { key: 'MA_50_Diff',         label: 'MA50 Distanz', tableEnabled: false, graphEnabled: true, higherBetter: false, unit: '%', yAxisLabel: '%',     currencyAffected: false },
      { key: 'RSI',                label: 'RSI',          tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '',  yAxisLabel: 'Index', currencyAffected: false },
      { key: 'MACD',               label: 'MACD',         tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '',  yAxisLabel: 'Wert',  currencyAffected: false },
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

/** Standard (factory) defaults – pre-checked when user hits "Load Standard"
 *  Mirrors the original dashboard column set (image 2):
 *  Trend: MOM_3, MOM_12, MOM_TS, Grwth_Rate
 *  Bewertung: Weighted Valuation, Premium, Div_Yld, EARN_YLD, PX_TO_SALES_RATIO, PX_TO_BOOK_RATIO, PE_RATIO
 *  Technisch: Rolling Volatility, RSI, MACD
 */
export const STANDARD_DEFAULTS = {
  table: [
    'MOM_3', 
    'MOM_12', 
    'MOM_TS', 
    'Grwth_Rate',
    'Weighted Valuation', 
    'Premium', 
    'Div_Yld', 
    'EARN_YLD',
    // 'PX_TO_SALES_RATIO',
    // 'PX_TO_BOOK_RATIO',
    // 'PE_RATIO',
    'BEST_PE_RATIO',
    'Rolling Volatility', 
    'RSI', 
    'MACD',
  ],
  graph: ['Performance', 'Weighted Valuation', 'Rolling Volatility', 'MA_50_Diff'],
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

/** Get y-axis label (%, Wert, Index) for an equity metric key */
export function getYAxisLabel(key) {
  const config = getFieldConfig(key)
  return config?.yAxisLabel ?? ''
}

/** Returns true if the equity metric value changes with EUR/USD currency selection */
export function isEquityMetricCurrencyAffected(key) {
  const config = getFieldConfig(key)
  return config?.currencyAffected ?? false
}

/** Get unit for an equity metric key (e.g., '%', '', etc.) */
export function getEquityMetricUnit(key) {
  const config = getFieldConfig(key)
  return config?.unit ?? ''
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
      { key: '2Y Yields',         label: '2J Rendite',          tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: '5Y Yields',         label: '5J Rendite',          tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: '10Y Yields',        label: '10J Rendite',         tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: '20Y Yields',        label: '20J Rendite',         tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: '30Y Yields',        label: '30J Rendite',         tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: 'Steepness',         label: 'Steilheit (10J-2J)',  tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: 'Curvature',         label: 'Krümmung',            tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
      { key: 'Spreads to Bunds',  label: 'Aufschläge zu Bunds', tableEnabled: true,  graphEnabled: true,  higherBetter: null, unit: '%',  yAxisLabel: '%'    },
    ],
  },
  {
    key: 'Kreditqualität',
    label: 'KREDITQUALITÄT',
    fields: [
      { key: '3 CDS',  label: '3J CDS',  tableEnabled: true,  graphEnabled: true, higherBetter: null, unit: 'bp', yAxisLabel: 'Basispunkte' },
      { key: '5 CDS',  label: '5J CDS',  tableEnabled: true,  graphEnabled: true, higherBetter: null, unit: 'bp', yAxisLabel: 'Basispunkte' },
      { key: '7 CDS',  label: '7J CDS',  tableEnabled: true,  graphEnabled: true, higherBetter: null, unit: 'bp', yAxisLabel: 'Basispunkte' },
      { key: '10 CDS', label: '10J CDS', tableEnabled: true,  graphEnabled: true, higherBetter: null, unit: 'bp', yAxisLabel: 'Basispunkte' },
    ],
  },
  {
    key: 'Inflationserwartungen',
    label: 'INFLATIONSERWARTUNGEN',
    fields: [
      { key: '1Y Inflation Expectations',  label: '1J Infl. Erw.',  tableEnabled: true, graphEnabled: true, higherBetter: null, unit: '%', yAxisLabel: '%' },
      { key: '2Y Inflation Expectations',  label: '2J Infl. Erw.',  tableEnabled: true, graphEnabled: true, higherBetter: null, unit: '%', yAxisLabel: '%' },
      { key: '5Y Inflation Expectations',  label: '5J Infl. Erw.',  tableEnabled: true, graphEnabled: true, higherBetter: null, unit: '%', yAxisLabel: '%' },
      { key: '10Y Inflation Expectations', label: '10J Infl. Erw.', tableEnabled: true, graphEnabled: true, higherBetter: null, unit: '%', yAxisLabel: '%' },
      { key: '10Y Breakevens',             label: '10J Breakevens', tableEnabled: true, graphEnabled: true, higherBetter: null, unit: '%', yAxisLabel: '%' },
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

/** Get y-axis label (%, Wert, Index) for an FI metric key */
export function getFIYAxisLabel(key) {
  const config = getFIFieldConfig(key)
  return config?.yAxisLabel ?? ''
}

/** Get unit for an FI metric key (e.g., '%', 'bp', '') */
export function getFIMetricUnit(key) {
  const config = getFIFieldConfig(key)
  return config?.unit ?? ''
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
      { key: 'GDP',                      label: 'BIP',                   tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%'     },
      { key: 'Economic Surprise',        label: 'Überraschungsindex',    tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '',  yAxisLabel: 'Index' },
      { key: 'Industrial Production',    label: 'Industrie',   tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%'     },
      { key: 'Retail Sales',             label: 'Einzelhandel',  tableEnabled: true,  graphEnabled: true,  higherBetter: true,  unit: '%', yAxisLabel: '%'     },
    ],
  },
  {
    key: 'Fundamental',
    label: 'FUNDAMENTAL',
    fields: [
      { key: 'Inflation',    label: 'Inflation',       tableEnabled: true, graphEnabled: true, higherBetter: false,  unit: '%', yAxisLabel: '%'     },
      { key: 'Unemployment', label: 'Arbeitslosigkeit',  tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '%', yAxisLabel: '%'     },
      { key: 'Misery',       label: 'Misery',    tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '%',  yAxisLabel: '%' },
    ],
  },
  {
    key: 'Geschäftsklima',
    label: 'GESCHÄFTSKLIMA',
    fields: [
      { key: 'Composite PMI',       label: 'PMI Gesamt',           tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '', yAxisLabel: 'Index' },
      { key: 'Manufacturing PMI',   label: 'PMI Industrie',        tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '', yAxisLabel: 'Index' },
      { key: 'Services PMI',        label: 'PMI Dienstleistungen', tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '', yAxisLabel: 'Index' },
      { key: 'Consumer Confidence', label: 'Verbrauchervertrauen', tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '', yAxisLabel: 'Index' },
    ],
  },
  {
    key: 'Außenhandel',
    label: 'AUSSENHANDEL',
    fields: [
      { key: 'Exports',         label: 'Exporte (YoY %)', tableEnabled: true,  graphEnabled: true, higherBetter: true,  unit: '%', yAxisLabel: '%' },
      { key: 'Imports',         label: 'Importe (YoY %)', tableEnabled: true,  graphEnabled: true, higherBetter: false,  unit: '%', yAxisLabel: '%' },
    ],
  },
  {
    key: 'Fiskal',
    label: 'FISKAL',
    fields: [
      { key: 'Government Debt', label: 'Verschuldung', tableEnabled: true,  graphEnabled: true, higherBetter: false, unit: '%', yAxisLabel: '%' },
    ],
  },
  {
    key: 'Andere',
    label: 'ANDERE',
    fields: [
      { key: 'Interest Rate', label: 'Leitzins', tableEnabled: true, graphEnabled: true, higherBetter: false, unit: '%', yAxisLabel: '%' },
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
  table: ['GDP', 'Economic Surprise', 'Industrial Production', 'Retail Sales', 'Inflation', 'Unemployment', 'Composite PMI', 'Services PMI', 'Consumer Confidence', 'Government Debt', 'Interest Rate'],
  graph: ['GDP', 'Economic Surprise', 'Misery', 'Composite PMI'],
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

/** Get y-axis label (%, Wert, Index) for a Macro metric key */
export function getMacroYAxisLabel(key) {
  const config = getMacroFieldConfig(key)
  return config?.yAxisLabel ?? ''
}

/** Get unit for a Macro metric key (e.g., '%', '') */
export function getMacroMetricUnit(key) {
  const config = getMacroFieldConfig(key)
  return config?.unit ?? ''
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE FORMATTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyzes chart data and returns smart date formatting configuration.
 * Returns a Recharts integer `interval` (show every nth data point as a tick)
 * so the number of visible labels is always capped at 12.
 *
 * Label formats by time span:
 *   < 13 months  → "Dez"   (abbreviated month name)
 *   >= 13 months → "3.25"  (month.YY)
 *
 * @param {Array}  chartData - Array of chart rows
 * @param {string} dateKey   - Key for the date field (default: 'DatePoint')
 * @returns {{ formatter: Function, interval: number }}
 */
export function getSmartDateFormat(chartData, dateKey = 'DatePoint') {
  const fallback = (isoStr) => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    return isNaN(d) ? isoStr.slice(0, 10) : d.toLocaleDateString('de-DE', { month: 'short' })
  }

  if (!chartData || chartData.length < 2) {
    return { formatter: fallback, interval: 0 }
  }

  const dates = chartData
    .map(r => r[dateKey])
    .filter(d => d && !isNaN(new Date(d)))
    .sort()

  if (dates.length < 2) {
    return { formatter: fallback, interval: 0 }
  }

  const n = dates.length
  const firstDate  = new Date(dates[0])
  const lastDate   = new Date(dates[n - 1])
  const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
                     (lastDate.getMonth() - firstDate.getMonth())

  if (monthsDiff < 13) {
    // Ensure at least 1 full month between ticks so the same month name
    // never repeats. approxPointsPerMonth gives the step size needed.
    const approxPointsPerMonth = monthsDiff > 0 ? n / monthsDiff : n
    const interval = Math.max(1, Math.ceil(approxPointsPerMonth))
    return {
      formatter: (isoStr) => {
        if (!isoStr) return ''
        const d = new Date(isoStr)
        return isNaN(d) ? isoStr.slice(0, 10) : d.toLocaleDateString('de-DE', { month: 'short' })
      },
      interval,
    }
  }

  // For longer periods cap at 12 labels
  const interval = Math.max(1, Math.ceil(n / 12))
  return {
    formatter: (isoStr) => {
      if (!isoStr) return ''
      const d = new Date(isoStr)
      if (isNaN(d)) return isoStr.slice(0, 10)
      return `${d.getMonth() + 1}.${d.getFullYear().toString().slice(-2)}`
    },
    interval,
  }
}

