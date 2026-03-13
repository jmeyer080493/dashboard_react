import { useState, useEffect, useMemo } from 'react'
import { ExcelIcon, MetricsDocIcon } from '../icons/MicrosoftIcons'
import './MetricsTable.css'

/** Download the metrics documentation Excel from the backend */
async function downloadMetricsDocumentation() {
  const response = await fetch('/api/countries/metrics-documentation/excel')
  if (!response.ok) throw new Error(`Server-Fehler ${response.status}`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cd = response.headers.get('content-disposition') || ''
  const match = cd.match(/filename="([^"]+)"/)
  a.download = match ? match[1] : 'Metriken_Dokumentation.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

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
  // FI-only countries (Anleihen subtab)
  'Australia': '🇦🇺', 'Australien': '🇦🇺',
  'Belgium': '🇧🇪', 'Belgien': '🇧🇪',
  'Latvia': '🇱🇻', 'Lettland': '🇱🇻',
  'Lithuania': '🇱🇹', 'Litauen': '🇱🇹',
  'Mexico': '🇲🇽', 'Mexiko': '🇲🇽',
  'Netherlands': '🇳🇱', 'Niederlande': '🇳🇱',
  'New Zealand': '🇳🇿', 'Neuseeland': '🇳🇿',
  'Norway': '🇳🇴', 'Norwegen': '🇳🇴',
  'Poland': '🇵🇱', 'Polen': '🇵🇱',
  'Portugal': '🇵🇹',
  'Sweden': '🇸🇪', 'Schweden': '🇸🇪',
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
  // FI-only countries (Anleihen subtab)
  'Australia': 'Australien',
  'Belgium': 'Belgien',
  'Latvia': 'Lettland',
  'Lithuania': 'Litauen',
  'Mexico': 'Mexiko',
  'Netherlands': 'Niederlande',
  'New Zealand': 'Neuseeland',
  'Norway': 'Norwegen',
  'Poland': 'Polen',
  'Portugal': 'Portugal',
  'Sweden': 'Schweden',
}

/**
 * Cross-region percentile: where does this region's latest value rank
 * against ALL other regions' latest values for the same metric?
 * `latestValues` is a map of { region: record } for ALL regions in the
 * dataset (not just the currently selected ones), so the colour scale is
 * stable regardless of which regions the user has filtered to.
 * Returns 0-100 or null if fewer than 2 regions have data.
 */
function computeCrossRegionPercentile(latestValues, metricKey, value) {
  if (value === null || value === undefined || isNaN(value)) return null

  const vals = []
  for (const regionRecord of Object.values(latestValues)) {
    const v = regionRecord?.[metricKey]
    if (v !== null && v !== undefined && !isNaN(v)) vals.push(v)
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

/**
 * Time-series percentile coloring (neutral – no good/bad direction).
 * Low percentile (historically low value)  → blue tint
 * High percentile (historically high value) → amber/orange tint
 * Mid (near 50th pct)                       → near transparent
 */
function getTimeseriesStyle(percentile) {
  if (percentile === null || percentile === undefined) return {}
  const norm = percentile / 100
  const midDist = Math.abs(norm - 0.5) * 2  // 0 at median, 1 at extremes
  const opacity = 0.12 + midDist * 0.38
  if (norm < 0.5) {
    // Blue tint – value is low relative to its own history
    return {
      background: `linear-gradient(to right, rgba(59,130,246,${(opacity * 0.8).toFixed(2)}), rgba(59,130,246,${opacity.toFixed(2)}))`,
    }
  } else {
    // Amber/orange tint – value is high relative to its own history
    return {
      background: `linear-gradient(to right, rgba(245,158,11,${(opacity * 0.8).toFixed(2)}), rgba(245,158,11,${opacity.toFixed(2)}))`,
    }
  }
}

// ── S&P rating ordinal map ──────────────────────────────────────────────────
// Higher rank number = better credit quality → gets a green tint.
const SP_RATING_RANKS = {
  'AAA': 21, 'AA+': 20, 'AA': 19, 'AA-': 18,
  'A+': 17, 'A': 16, 'A-': 15,
  'BBB+': 14, 'BBB': 13, 'BBB-': 12,
  'BB+': 11, 'BB': 10, 'BB-': 9,
  'B+': 8, 'B': 7, 'B-': 6,
  'CCC+': 5, 'CCC': 4, 'CCC-': 3,
  'CC': 2, 'C': 1, 'D': 0,
}
const SP_MAX_RANK = 21

/**
 * Red-to-green gradient for S&P credit ratings.
 * AAA (best) → green, D (worst) → red, unknown → no colour.
 */
function getSPRatingStyle(ratingValue) {
  if (!ratingValue || typeof ratingValue !== 'string') return {}
  const rank = SP_RATING_RANKS[ratingValue.trim().toUpperCase()]
  if (rank === undefined) return {}
  const norm = rank / SP_MAX_RANK  // 0..1, 1 = best
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
      if (typeof v === 'number') return v.toFixed(1)
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
const [displayMode, setDisplayMode] = useState(() => {
  try { return localStorage.getItem(`metricsTable_displayMode_${tabLabel}`) || 'latest' } catch { return 'latest' }
})

// Persist displayMode whenever it changes
useEffect(() => {
  try { localStorage.setItem(`metricsTable_displayMode_${tabLabel}`, displayMode) } catch {}
}, [displayMode, tabLabel])

const [colorFormatting, setColorFormattingRaw] = useState(() => {
  try { return localStorage.getItem(`metricsTable_colorFormatting_${tabLabel}`) !== 'false' } catch { return true }
})

// Persist colorFormatting whenever it changes
useEffect(() => {
  try { localStorage.setItem(`metricsTable_colorFormatting_${tabLabel}`, colorFormatting ? 'true' : 'false') } catch {}
}, [colorFormatting, tabLabel])

const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  // ── Latest value per region (only selected regions, for display) ──────────
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

  // ── Latest value per region for ALL regions in the dataset ───────────────
  // Used for cross-region percentile ranking so that filtering the visible
  // regions never changes the colour scale.
  const latestDataAllRegions = useMemo(() => {
    if (!data || data.length === 0) return {}
    const map = {}
    for (const record of data) {
      const r = record.Regions
      if (!r) continue
      if (!map[r] || record.DatePoint > map[r].DatePoint) map[r] = record
    }
    return map
  }, [data])

  // ── Determine which metrics to show ─────────────────────────────────────
  const metricsToDisplay = useMemo(() => {
    if (!data || data.length === 0) return []
    let cols = (columns && columns.length > 0)
      ? columns
      : (() => {
          const sample = data[0]
          const excluded = new Set(['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name'])
          return Object.keys(sample).filter(k => !excluded.has(k)).sort()
        })()

    // Re-sort by category order so that fields from the same category are always
    // adjacent → avoids duplicate group header cells in the two-row thead.
    if (categories && categories.length > 0) {
      const orderMap = {}
      let ci = 0
      for (const cat of categories) {
        let fi = 0
        for (const field of cat.fields) {
          orderMap[field.key] = ci * 1000 + fi
          fi++
        }
        ci++
      }
      cols = [...cols].sort((a, b) => {
        const oa = orderMap[a] ?? 999999
        const ob = orderMap[b] ?? 999999
        return oa - ob
      })
    }
    return cols
  }, [data, columns, categories])

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
            colorMode: f.colorMode ?? null,
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

  // ── Sort handler ────────────────────────────────────────────────────────
  function handleSortClick(metricKey) {
    setSortConfig(prev =>
      prev.key === metricKey
        ? { key: metricKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key: metricKey, direction: 'asc' }
    )
  }

  // ── Pre-compute all percentiles (cross-region ranking) ─────────────────────
  // Each cell is coloured by how that region's latest value ranks against ALL
  // other regions' latest values for the same metric.
  // `latestDataAllRegions` (all regions, not just the selected ones) is used
  // so that the colour scale remains stable regardless of the region filter.
  const percentiles = useMemo(() => {
    if (!data || data.length === 0) return {}
    const result = {}
    for (const metric of metricsToDisplay) {
      for (const region of regions) {
        const value = latestDataPerRegion[region]?.[metric]
        result[`${region}::${metric}`] = computeCrossRegionPercentile(latestDataAllRegions, metric, value)
      }
    }
    return result
  }, [data, regions, metricsToDisplay, latestDataPerRegion, latestDataAllRegions])

  // ── Pre-compute time-series percentiles ───────────────────────────────────
  // For metrics with colorMode='timeseries': where does the latest value sit
  // in the metric's own historical distribution for that region?
  const timeseriesPercentiles = useMemo(() => {
    if (!data || data.length === 0) return {}
    const result = {}
    for (const metric of metricsToDisplay) {
      if (metricMeta[metric]?.colorMode !== 'timeseries') continue
      for (const region of regions) {
        const currentValue = latestDataPerRegion[region]?.[metric]
        if (currentValue === null || currentValue === undefined || isNaN(currentValue)) {
          result[`${region}::${metric}`] = null
          continue
        }
        // Collect all historical values for this region × metric
        const vals = []
        for (const record of data) {
          if (record.Regions !== region) continue
          const v = record[metric]
          if (v !== null && v !== undefined && !isNaN(v)) vals.push(v)
        }
        if (vals.length < 2) { result[`${region}::${metric}`] = null; continue }
        vals.sort((a, b) => a - b)
        let rank = 0
        for (const v of vals) { if (v <= currentValue) rank++ }
        result[`${region}::${metric}`] = (rank / vals.length) * 100
      }
    }
    return result
  }, [data, regions, metricsToDisplay, metricMeta, latestDataPerRegion])

  // ── Check if any displayed metric uses time-series coloring ─────────────────
  const hasTimeseriesMetrics = useMemo(() => {
    return metricsToDisplay.some(metric => metricMeta[metric]?.colorMode === 'timeseries')
  }, [metricsToDisplay, metricMeta])

  // ── Sorted regions ─────────────────────────────────────────────────────
  const sortedRegions = useMemo(() => {
    if (!sortConfig.key) return regions
    return [...regions].sort((a, b) => {
      const va = displayMode === 'percentile'
        ? (percentiles[`${a}::${sortConfig.key}`] ?? null)
        : (latestDataPerRegion[a]?.[sortConfig.key] ?? null)
      const vb = displayMode === 'percentile'
        ? (percentiles[`${b}::${sortConfig.key}`] ?? null)
        : (latestDataPerRegion[b]?.[sortConfig.key] ?? null)
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      return sortConfig.direction === 'asc' ? va - vb : vb - va
    })
  }, [regions, sortConfig, displayMode, percentiles, latestDataPerRegion])



  // ── Flat metrics info for CSV export ─────────────────────────────────────
  const metricsInfo = useMemo(() => metricsToDisplay.map(key => ({
    key,
    label: metricMeta[key]?.label || key,
    unit: metricMeta[key]?.unit || '',
  })), [metricsToDisplay, metricMeta])

  // ── Latest real data date per metric (Aktualität) ────────────────────────
  // For each metric column: find the most recent DatePoint across ALL regions
  // where the metric carried a non-null value. Used as a tooltip on the header.
  const metricAktualitaet = useMemo(() => {
    if (!data || data.length === 0) return {}
    const result = {}
    for (const metric of metricsToDisplay) {
      let latest = null
      for (const record of data) {
        const v = record[metric]
        if (v !== null && v !== undefined && record.DatePoint) {
          if (!latest || record.DatePoint > latest) latest = record.DatePoint
        }
      }
      if (latest) result[metric] = latest.split('T')[0]
    }
    return result
  }, [data, metricsToDisplay])

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
      return `${value.toFixed(1)}${unit ? '\u00a0' + unit : ''}`
    }
    return String(value)
  }
  const fmt = formatValue || defaultFormatter

  // ── Cell content + style ─────────────────────────────────────────────────
  const getCellContent = (region, metric) => {
    const value = getValue(region, metric)
    const colorMode = metricMeta[metric]?.colorMode ?? null

    // ── S&P Rating: ordinal red→green based on credit quality ───────────────
    if (colorMode === 'sp_rating') {
      const text = fmt(value, metric)
      const style = colorFormatting ? getSPRatingStyle(value) : {}
      return { text, style }
    }

    // ── Time-series percentile: blue (historically low) ↔ amber (historically high) ─
    if (colorMode === 'timeseries') {
      const tsPct = timeseriesPercentiles[`${region}::${metric}`]
      if (displayMode === 'percentile') {
        if (tsPct === null) return { text: '–', style: {} }
        return { text: `${tsPct.toFixed(0)}%`, style: colorFormatting ? getTimeseriesStyle(tsPct) : {} }
      }
      return { text: fmt(value, metric), style: colorFormatting ? getTimeseriesStyle(tsPct) : {} }
    }

    // ── Default: cross-region percentile with higherBetter direction ─────────
    const pct = percentiles[`${region}::${metric}`]
    const higherBetter = metricMeta[metric]?.higherBetter ?? null
    if (displayMode === 'percentile') {
      if (pct === null) return { text: '–', style: {} }
      return { text: `${pct.toFixed(0)}%`, style: colorFormatting ? getPercentileStyle(pct, higherBetter) : {} }
    }
    return { text: fmt(value, metric), style: colorFormatting ? getPercentileStyle(pct, higherBetter) : {} }
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
        {colorFormatting && (
          <div className="metrics-table-formatting-group">
            <button
              className={`metrics-table-color-toggle ${colorFormatting ? 'active' : ''}`}
              onClick={() => setColorFormattingRaw(!colorFormatting)}
              title={colorFormatting ? 'Farbkodierung deaktivieren' : 'Farbkodierung aktivieren'}
            >
              {colorFormatting ? '🎨 Farbe AN' : '◯ Farbe AUS'}
            </button>
            <div className="metrics-table-legend">
              {hasTimeseriesMetrics && (
                <>
                  <span className="legend-item">
                    <span className="legend-swatch" style={{ background: 'linear-gradient(to right, rgba(59,130,246,0.12), rgba(59,130,246,0.5))' }}></span>
                    <span>Histor. niedrig</span>
                  </span>
                  <span className="legend-item">
                    <span className="legend-swatch" style={{ background: 'linear-gradient(to right, rgba(245,158,11,0.12), rgba(245,158,11,0.5))' }}></span>
                    <span>Histor. hoch</span>
                  </span>
                </>
              )}
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: 'linear-gradient(to right, rgba(220,38,38,0.28), rgba(52,211,153,0.48))' }}></span>
                <span>Schlecht–Gut</span>
              </span>
            </div>
          </div>
        )}
        {!colorFormatting && (
          <button
            className="metrics-table-color-toggle"
            onClick={() => setColorFormattingRaw(!colorFormatting)}
            title="Farbkodierung aktivieren"
          >
            ◯ Farbe AUS
          </button>
        )}
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
            {/* ── Row 2: metric name headers (sortable) ── */}
            <tr>
              {!columnGroups && <th className="metrics-table-region-label">Region</th>}
              {metricsToDisplay.map(metric => {
                const isSorted = sortConfig.key === metric
                const indicator = isSorted
                  ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')
                  : ' ⇅'
                const catLabel = metricMeta[metric]?.categoryLabel
                const subCatClass = catLabel ? ` sub-cat-${catLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : ''
                return (
                  <th
                    key={metric}
                    className={`metrics-table-metric-header sortable-col${isSorted ? ' sorted' : ''}${subCatClass}`}
                    onClick={() => handleSortClick(metric)}
                    title={metricAktualitaet[metric] ? `Aktualität: ${metricAktualitaet[metric]}` : 'Klicken zum Sortieren'}
                  >
                    {metricMeta[metric]?.label || metric}
                    <span className="sort-indicator">{indicator}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRegions.map(region => {
              const flag = REGION_FLAGS[region] || ''
              const displayName = REGION_TRANSLATIONS[region] || region
              return (
                <tr key={region} className="metric-row">
                  <td className="metrics-table-region-cell">
                    <span className="region-flag">{flag}</span>
                    <span className="region-name">{displayName}</span>
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

      <div className="metrics-table-export-row">
        <button
          className="metrics-table-export-btn metrics-table-export-btn-bottom"
          onClick={() => exportTableAsCSV(regions, metricsInfo, latestDataPerRegion, tabLabel)}
          title="Tabelle als CSV exportieren"
        >
          <ExcelIcon width={26} height={26} />
        </button>
        <button
          className="metrics-table-export-btn metrics-table-export-btn-doc"
          onClick={async () => {
            try {
              await downloadMetricsDocumentation()
            } catch (err) {
              alert(`Fehler beim Download: ${err.message}`)
            }
          }}
          title="Metriken-Dokumentation herunterladen (Excel)"
        >
          <MetricsDocIcon width={26} height={26} />
        </button>
        <span className="metrics-table-bloomberg">Bloomberg Finance L.P.</span>
      </div>

      {displayMode === 'percentile'}
    </div>
  )
}
