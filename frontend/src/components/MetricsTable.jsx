import { useState, useMemo } from 'react'
import './MetricsTable.css'

// ─── Region flag emoji map ──────────────────────────────────────────────────
const REGION_FLAGS = {
  'U.S.': '🇺🇸', 'USA': '🇺🇸', 'United States': '🇺🇸',
  'Europe': '🇪🇺', 'EU': '🇪🇺',
  'Germany': '🇩🇪', 'Deutschland': '🇩🇪',
  'France': '🇫🇷', 'Frankreich': '🇫🇷',
  'Italy': '🇮🇹', 'Italien': '🇮🇹',
  'UK': '🇬🇧', 'Großbritannien': '🇬🇧',
  'Japan': '🇯🇵',
  'Spain': '🇪🇸', 'Spanien': '🇪🇸',
  'China': '🇨🇳',
  'India': '🇮🇳', 'Indien': '🇮🇳',
  'EM': '🌏', 'Emerging Markets': '🌏',
  'Switzerland': '🇨🇭', 'Schweiz': '🇨🇭',
}

// ─── Region display name map ────────────────────────────────────────────────
const REGION_TRANSLATIONS = {
  'U.S.': 'U.S.',
  'Europe': 'Europa',
  'Germany': 'Deutschland',
  'France': 'Frankreich',
  'Italy': 'Italien',
  'UK': 'UK',
  'Japan': 'Japan',
  'Spain': 'Spanien',
  'China': 'China',
  'India': 'Indien',
  'EM': 'EM',
}

/** Convert lookback string like "1Y","3Y","5Y","All" to milliseconds */
function lookbackToMs(lookback) {
  const map = { '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '3Y': 1095, '5Y': 1825, '10Y': 3650, 'All': Infinity }
  const days = map[lookback]
  if (!days || days === Infinity) return Infinity
  return days * 86400 * 1000
}

/**
 * Compute the percentile rank of `value` within the historical values for a
 * given region + metric, filtered to the lookback period.
 * Returns null if insufficient data (< 2 points).
 */
function computePercentile(histRecords, region, metricKey, value, lookback) {
  if (value === null || value === undefined || isNaN(value)) return null

  const cutoffMs = lookbackToMs(lookback)
  const now = Date.now()

  const vals = []
  for (const r of histRecords) {
    if (r.Regions !== region) continue
    const v = r[metricKey]
    if (v === null || v === undefined || isNaN(v)) continue
    // Date filter
    if (cutoffMs !== Infinity) {
      const t = new Date(r.DatePoint).getTime()
      if (now - t > cutoffMs) continue
    }
    vals.push(v)
  }

  if (vals.length < 2) return null

  vals.sort((a, b) => a - b)
  let rank = 0
  for (const v of vals) {
    if (v <= value) rank++
  }
  return (rank / vals.length) * 100
}

/**
 * Build red/green gradient style based on a 0-100 percentile,
 * respecting higherBetter direction.
 * higherBetter=true  → 100th pct = green
 * higherBetter=false → 100th pct = red
 * higherBetter=null  → no colouring
 */
function getPercentileStyle(percentile, higherBetter) {
  if (percentile === null || higherBetter === null || higherBetter === undefined) return {}
  let norm = percentile / 100
  if (!higherBetter) norm = 1 - norm
  const red = Math.round(255 * (1 - norm))
  const green = Math.round(255 * norm)
  return {
    background: `linear-gradient(to right, rgba(${red},${green},0,0.28), rgba(${red},${green},0,0.48))`,
  }
}

/** Export table data as CSV and trigger download */
function exportTableAsCSV(regions, metricsInfo, latestValues, tabLabel = 'Tabelle') {
  const regionHeaders = regions.map(r => REGION_TRANSLATIONS[r] || r)
  const header = ['Metrik', ...regionHeaders].join(';')
  const rows = metricsInfo.map(({ key, label, unit }) => {
    const cells = regions.map(region => {
      const v = latestValues[region]?.[key]
      if (v === null || v === undefined) return ''
      if (typeof v === 'number') return v.toFixed(2)
      return String(v)
    })
    return [label, ...cells].join(';')
  })
  const csv = [header, ...rows].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toLocaleDateString('de-DE').replace(/\./g, '-')
  a.download = `${tabLabel}_${ts}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * MetricsTable Component
 *
 * Features migrated from the reference Dash dashboard:
 * - Two-row grouped header (category → metric name)
 * - Percentile-based red/green cell colouring
 * - Toggle between "Istwerte" (latest values) and "Perzentile" (% rank) display
 * - Excel/CSV export
 * - Stale-data indicator (dashed border when latest data > 5 days old)
 * - Region flag emojis
 *
 * Props:
 *   data          {Array}  – all records in the current lookback window
 *                            [{DatePoint, Regions, metric1, metric2, ...}]
 *   regions       {Array}  – selected region keys
 *   columns       {Array}  – metric keys to display
 *   categories    {Array}  – category config from metricsConfig (optional)
 *                            [{key, label, fields:[{key,label,higherBetter,unit}]}]
 *   lookback      {string} – active lookback string, e.g. "3Y"
 *   tabLabel      {string} – label for the CSV filename
 *   formatValue   {fn}     – optional custom formatter (value, metricKey) => string
 */
export function MetricsTable({
  data,
  regions,
  columns = null,
  categories = null,
  lookback = '3Y',
  tabLabel = 'Tabelle',
  formatValue = null,
}) {
  const [displayMode, setDisplayMode] = useState('latest') // 'latest' | 'percentile'

  // ── Latest value per region ──────────────────────────────────────────────
  const latestDataPerRegion = useMemo(() => {
    if (!data || data.length === 0 || !regions) return {}
    const map = {}
    for (const record of data) {
      const r = record.Regions
      if (!r || !regions.includes(r)) continue
      if (!map[r] || record.DatePoint > map[r].DatePoint) map[r] = record
    }
    return map
  }, [data, regions])

  // ── Determine which metrics to show ─────────────────────────────────────
  const metricsToDisplay = useMemo(() => {
    if (!data || data.length === 0) return []
    if (columns && columns.length > 0) return columns
    const sample = data[0]
    const excluded = new Set(['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name'])
    return Object.keys(sample).filter(k => !excluded.has(k)).sort()
  }, [data, columns])

  // ── Build meta lookup: metricKey → {label, higherBetter, unit, categoryLabel} ─
  const metricMeta = useMemo(() => {
    const map = {}
    if (categories) {
      for (const cat of categories) {
        for (const f of cat.fields) {
          map[f.key] = {
            label: f.label,
            higherBetter: f.higherBetter ?? null,
            unit: f.unit ?? '',
            category: cat.key,
            categoryLabel: cat.label,
          }
        }
      }
    }
    return map
  }, [categories])

  // ── Build column group spans for the 2-row header ────────────────────────
  const columnGroups = useMemo(() => {
    if (!categories || metricsToDisplay.length === 0) return null
    const groups = []
    let i = 0
    while (i < metricsToDisplay.length) {
      const key = metricsToDisplay[i]
      const meta = metricMeta[key]
      if (!meta) { groups.push({ label: '', span: 1 }); i++; continue }
      const catLabel = meta.categoryLabel
      let span = 1
      while (
        i + span < metricsToDisplay.length &&
        metricMeta[metricsToDisplay[i + span]]?.categoryLabel === catLabel
      ) span++
      groups.push({ label: catLabel, span })
      i += span
    }
    return groups
  }, [categories, metricsToDisplay, metricMeta])

  // ── Pre-compute all percentiles ──────────────────────────────────────────
  const percentiles = useMemo(() => {
    if (!data || data.length === 0) return {}
    const result = {}
    for (const metric of metricsToDisplay) {
      for (const region of regions) {
        const latest = latestDataPerRegion[region]?.[metric]
        result[`${region}::${metric}`] = computePercentile(data, region, metric, latest, lookback)
      }
    }
    return result
  }, [data, regions, metricsToDisplay, latestDataPerRegion, lookback])

  // ── Stale-data detection ─────────────────────────────────────────────────
  const staleRegions = useMemo(() => {
    const stale = {}
    const now = Date.now()
    const THRESHOLD_MS = 5 * 86400 * 1000
    for (const region of regions) {
      const latest = latestDataPerRegion[region]
      if (!latest?.DatePoint) { stale[region] = false; continue }
      stale[region] = now - new Date(latest.DatePoint).getTime() > THRESHOLD_MS
    }
    return stale
  }, [latestDataPerRegion, regions])

  // ── Flat metrics info for CSV export ─────────────────────────────────────
  const metricsInfo = useMemo(() => metricsToDisplay.map(key => ({
    key,
    label: metricMeta[key]?.label || key,
    unit: metricMeta[key]?.unit || '',
  })), [metricsToDisplay, metricMeta])

  // ─────────────────────────────────────────────────────────────────────────
  // Guard clauses AFTER all hooks
  // ─────────────────────────────────────────────────────────────────────────
  if (!data || data.length === 0) {
    return <div className="metrics-table-empty">Keine Daten verfügbar</div>
  }

  if (metricsToDisplay.length === 0) {
    return <div className="metrics-table-empty">Keine Metriken verfügbar</div>
  }

  // ── Value getter ─────────────────────────────────────────────────────────
  const getValue = (region, metric) => {
    const v = latestDataPerRegion[region]?.[metric]
    return v !== undefined ? v : null
  }

  // ── Default formatter ────────────────────────────────────────────────────
  const defaultFormatter = (value, metricKey) => {
    if (value === null || value === undefined) return '–'
    if (typeof value === 'number') {
      const unit = metricMeta[metricKey]?.unit || ''
      return `${value.toFixed(2)}${unit ? '\u00a0' + unit : ''}`
    }
    return String(value)
  }
  const fmt = formatValue || defaultFormatter

  // ── Cell content + style ─────────────────────────────────────────────────
  const getCellContent = (region, metric) => {
    const value = getValue(region, metric)
    const pct = percentiles[`${region}::${metric}`]
    const higherBetter = metricMeta[metric]?.higherBetter ?? null

    if (displayMode === 'percentile') {
      if (pct === null) return { text: '–', style: {} }
      const style = getPercentileStyle(pct, higherBetter)
      return { text: `${pct.toFixed(0)}%`, style }
    }

    // latest mode
    const text = fmt(value, metric)
    const style = getPercentileStyle(pct, higherBetter)
    return { text, style }
  }

  return (
    <div className="metrics-table-container">
      {/* Toolbar */}
      <div className="metrics-table-toolbar">
        <div className="metrics-table-mode-toggle">
          <button
            className={`mode-btn ${displayMode === 'latest' ? 'active' : ''}`}
            onClick={() => setDisplayMode('latest')}
            title="Aktuelle Werte"
          >
            Istwerte
          </button>
          <button
            className={`mode-btn ${displayMode === 'percentile' ? 'active' : ''}`}
            onClick={() => setDisplayMode('percentile')}
            title={`Historisches Perzentil (${lookback})`}
          >
            Perzentile
          </button>
        </div>
        <button
          className="metrics-table-export-btn"
          onClick={() => exportTableAsCSV(regions, metricsInfo, latestDataPerRegion, tabLabel)}
          title="Tabelle als CSV exportieren"
        >
          ⬇ Excel / CSV
        </button>
      </div>

      <div className="metrics-table-scroll">
        <table className="metrics-table">
          <thead>
            {/* ── Row 1: category group headers ── */}
            {columnGroups && (
              <tr className="metrics-table-group-row">
                <th className="metrics-table-corner" rowSpan={2}>Region</th>
                {columnGroups.map((grp, i) => (
                  <th
                    key={i}
                    colSpan={grp.span}
                    className={`metrics-table-group-header cat-${grp.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                  >
                    {grp.label}
                  </th>
                ))}
              </tr>
            )}
            {/* ── Row 2: metric name headers ── */}
            <tr>
              {!columnGroups && <th className="metrics-table-region-label">Region</th>}
              {metricsToDisplay.map(metric => (
                <th key={metric} className="metrics-table-metric-header">
                  {metricMeta[metric]?.label || metric}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regions.map(region => {
              const flag = REGION_FLAGS[region] || ''
              const displayName = REGION_TRANSLATIONS[region] || region
              const isStale = staleRegions[region]
              return (
                <tr key={region} className="metric-row">
                  <td className={`metrics-table-region-cell ${isStale ? 'stale-region' : ''}`}>
                    <span className="region-flag">{flag}</span>
                    <span className="region-name">{displayName}</span>
                    {isStale && <span className="stale-badge" title="Daten älter als 5 Tage">⚠</span>}
                  </td>
                  {metricsToDisplay.map(metric => {
                    const { text, style } = getCellContent(region, metric)
                    return (
                      <td
                        key={`${region}-${metric}`}
                        className="metric-value"
                        style={style}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {displayMode === 'percentile' && (
        <div className="metrics-table-legend">
          <span className="legend-label">Farbskala ({lookback}) –</span>
          <span className="legend-low">0. (tief)</span>
          <span className="legend-bar"></span>
          <span className="legend-high">100. (hoch)</span>
          <span className="legend-note">· Grün = günstig · Rot = ungünstig · Weiß/Grau = keine Richtung</span>
        </div>
      )}
    </div>
  )
}
