import { useState, useEffect, useRef } from 'react'
import {
  ComposedChart,
  LineChart,
  BarChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { MetricsTable } from '../../components/MetricsTable'
import { getMetricLabel, getYAxisLabel, isEquityMetricCurrencyAffected, getEquityMetricUnit, getSmartDateFormat, EQUITY_METRICS_CATEGORIES, STANDARD_DEFAULTS } from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
import { withDataGapWarning } from '../../utils/exportWarnings'
import { ExcelIcon, PowerPointIcon } from '../../icons/MicrosoftIcons'
import { REGION_TRANSLATIONS } from '../../config/countries'
import './TabStyles.css'

/** Translate a region key to its German display name */
const translateRegion = (r) => REGION_TRANSLATIONS[r] || r

// Colour palette – one colour per region
const REGION_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

/** Produce a stable string ID from a chart title */
function makeId(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Build a German-formatted date range string */
function getDateRange(chartData, xKey) {
  if (!chartData || chartData.length === 0) return ''
  const dates = chartData.map(r => r[xKey]).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

/**
 * Pivot flat equity records (one row per DatePoint × Region) into chart-ready shape.
 * Input:  [{DatePoint, Regions:'Germany', RSI:45, ...}, ...]
 * Output: [{DatePoint:'2024-01-01', Germany:45, France:50, ...}, ...]
 */
function pivotDataForChart(records, metricKey, regions) {
  const map = {}
  for (const row of records) {
    const date = row.DatePoint
    if (!date) continue
    const region = row.Regions
    if (!regions.includes(region)) continue
    const value = row[metricKey]
    if (value === undefined || value === null) continue
    if (!map[date]) map[date] = { DatePoint: date }
    map[date][region] = value
  }
  return Object.values(map).sort(
    (a, b) => new Date(a.DatePoint) - new Date(b.DatePoint)
  )
}

/** Short date label for chart axes - smart formatting based on time span */
function fmtDate(isoStr, smartDateFmt) {
  if (!isoStr || !smartDateFmt) return ''
  return smartDateFmt(isoStr)
}

/** Format y-axis label: 0 decimals */
function formatYValue(value) {
  if (typeof value !== 'number') return value
  return String(Math.round(value))
}

/**
 * Apply a local period filter to already-globally-filtered chart data.
 * Uses the latest date in chartData as the anchor.
 */
function applyLocalPeriod(chartData, period) {
  if (!period || period === 'All') return chartData
  const allDates = chartData.map(r => r.DatePoint).filter(Boolean).sort()
  if (!allDates.length) return chartData
  const latestStr = allDates[allDates.length - 1].slice(0, 10) // normalize to YYYY-MM-DD
  let cutoffStr
  if (period === 'YtD') {
    const year = parseInt(latestStr.slice(0, 4), 10)
    cutoffStr = `${year - 1}-12-31`
  } else {
    const daysMap = { '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 }
    const days = daysMap[period] ?? 365
    const latestMs = Date.UTC(
      parseInt(latestStr.slice(0, 4), 10),
      parseInt(latestStr.slice(5, 7), 10) - 1,
      parseInt(latestStr.slice(8, 10), 10)
    )
    const cutoffMs = latestMs - days * 86400000
    const d = new Date(cutoffMs)
    cutoffStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return chartData.filter(r => r.DatePoint.slice(0, 10) >= cutoffStr)
}

/** Determine if timeseries is long (>6 months) */
function isLongTimeseries(chartData) {
  if (!chartData || chartData.length < 2) return false
  const dates = chartData
    .map(r => r.DatePoint)
    .filter(d => d)
    .sort()
  if (dates.length < 2) return false
  const firstDate = new Date(dates[0])
  const lastDate = new Date(dates[dates.length - 1])
  const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
                     (lastDate.getMonth() - firstDate.getMonth())
  return monthsDiff > 6
}

/** Compute smart y-axis domain from data with padding */
function computeSmartDomain(chartData, regions) {
  if (!chartData || chartData.length === 0 || regions.length === 0) return [undefined, undefined]
  
  let min = Infinity, max = -Infinity
  for (const row of chartData) {
    for (const region of regions) {
      const val = row[region]
      if (val !== undefined && val !== null && typeof val === 'number') {
        if (val < min) min = val
        if (val > max) max = val
      }
    }
  }
  
  if (min === Infinity || max === -Infinity) return [undefined, undefined]
  
  const range = max - min
  const padding = range * 0.1 // 10% padding
  return [min - padding, max + padding]
}

/** Convert column name to friendly title using the central metricsConfig. */
function getColumnTitle(columnName) {
  const label = getMetricLabel(columnName)
  if (label !== columnName) return label
  const extras = {
    'Rolling Sharpe': 'Rolling Sharpe Ratio',
    'Rolling Returns': 'Rolling Returns',
  }
  return extras[columnName] || columnName
}

/** Format a value for legend display: 1 decimal, German locale */
function fmtLegendValue(val, unit = '') {
  if (val === null || val === undefined || typeof val !== 'number') return null
  const formatted = val.toFixed(1).toLocaleString('de-DE')
  return unit ? `${formatted}\u00a0${unit}` : formatted
}

/** Find the latest (most recent) value for a specific region across all data points */
function getLatestValueForRegion(chartData, region) {
  if (!chartData || chartData.length === 0) return undefined
  // Iterate backwards to find the most recent value for this region
  for (let i = chartData.length - 1; i >= 0; i--) {
    const value = chartData[i][region]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

/** Find the first (oldest) non-null value for a specific region across all data points */
function getFirstValueForRegion(chartData, region) {
  if (!chartData || chartData.length === 0) return undefined
  for (let i = 0; i < chartData.length; i++) {
    const value = chartData[i][region]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

/**
 * For each region, find the last date where the value genuinely changed.
 * After this date the backend has forward-filled the value unchanged.
 * Returns { region: dateString }.
 */
function findLastRealDatePerRegion(chartData, regions) {
  const result = {}
  for (const region of regions) {
    let lastRealDate = null
    for (let i = chartData.length - 1; i > 0; i--) {
      const currVal = chartData[i][region]
      const prevVal = chartData[i - 1][region]
      if (currVal != null && prevVal != null && Math.abs(currVal - prevVal) > 1e-10) {
        lastRealDate = chartData[i].DatePoint; break
      }
      if (currVal != null && prevVal == null) {
        lastRealDate = chartData[i].DatePoint; break
      }
    }
    // Fallback: first row with a value
    if (lastRealDate === null) {
      for (let i = 0; i < chartData.length; i++) {
        if (chartData[i][region] != null) { lastRealDate = chartData[i].DatePoint; break }
      }
    }
    if (lastRealDate !== null) result[region] = lastRealDate
  }
  return result
}

/**
 * Rebase pivoted Performance data so every region starts at exactly 0%
 * on the first date where ALL active regions have a value.
 *
 * Needed because the backend rebases each region independently to a
 * pre-window anchor, which can differ by ±1–2 trading days across regions
 * with different market calendars (e.g. U.S. holiday vs. Japan open).
 * Without this, each region's line starts at a slightly different level
 * inside the visible window.
 *
 * Uses MULTIPLICATIVE rebasing (not arithmetic subtraction) because
 * Performance values are compounded %-returns from a backend anchor:
 *   result = ((1 + v/100) / (1 + base/100) - 1) * 100
 * Arithmetic subtraction (v - base) would give wrong compounded returns,
 * especially noticeable when the base value is large (3Y, 5Y lookbacks).
 */
function rebaseToCommonStart(chartData, regions) {
  if (!chartData || chartData.length === 0 || regions.length === 0) return chartData
  let commonIdx = -1
  for (let i = 0; i < chartData.length; i++) {
    if (regions.every(r => chartData[i][r] !== null && chartData[i][r] !== undefined)) {
      commonIdx = i
      break
    }
  }
  if (commonIdx === -1) return chartData // no common row – return as-is
  const base = {}
  for (const r of regions) base[r] = chartData[commonIdx][r]
  return chartData.slice(commonIdx).map(row => {
    const out = { ...row }
    for (const r of regions) {
      if (out[r] !== null && out[r] !== undefined) {
        // Multiplicative: compound the period return from the common start date
        out[r] = ((1 + out[r] / 100) / (1 + base[r] / 100) - 1) * 100
      }
    }
    return out
  })
}

/**
 * Compute rebased Performance (Wertentwicklung) directly from raw PX_LAST prices
 * for a specific local time period.
 *
 * The backend anchors Performance to the GLOBAL lookback anchor date. Any local
 * period override would require working backwards through compounded returns, which
 * introduces floating-point error and depends on the global anchor choice. Instead,
 * we recompute from scratch using actual prices — exactly as the backend does —
 * but using the local period's cutoff as the anchor.
 *
 * referenceDate (optional, "YYYY-MM-DD") – for N-year periods this is used as the
 * "today" anchor instead of the latest data date, so the cutoff matches exactly what
 * GlobalControls computes for its startDate (today - N days).
 *
 * Returns pivoted [{DatePoint, Region1: %, ...}] data, or null if period is 'All'
 * (in which case the caller should fall back to backend data).
 */
function computePerfFromPrices(allRawRecords, regions, localPeriod, referenceDate = null) {
  if (!localPeriod || localPeriod === 'All' || !allRawRecords || allRawRecords.length === 0) return null
  const priceData = pivotDataForChart(allRawRecords, 'PX_LAST', regions)
  if (priceData.length === 0) return null
  const allDates = priceData.map(r => r.DatePoint).filter(Boolean).sort()
  const latestStr = allDates[allDates.length - 1].slice(0, 10)
  // For non-YtD periods: use referenceDate (today) so the anchor matches GlobalControls.
  // For YtD: always derive from the latest DATA year (what year-to-date means).
  const refStr = (localPeriod !== 'YtD' && referenceDate) ? referenceDate : latestStr
  let cutoffStr
  if (localPeriod === 'YtD') {
    const year = parseInt(latestStr.slice(0, 4), 10)
    cutoffStr = `${year - 1}-12-31`
  } else {
    const daysMap = { '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 }
    const days = daysMap[localPeriod]
    if (!days) return null
    const refMs = Date.UTC(
      parseInt(refStr.slice(0, 4), 10),
      parseInt(refStr.slice(5, 7), 10) - 1,
      parseInt(refStr.slice(8, 10), 10)
    )
    const d = new Date(refMs - days * 86400000)
    cutoffStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  // Anchor price = last known price ON OR BEFORE cutoff (same logic as backend).
  // DatePoints from backend include time ("2025-12-31T00:00:00"), so we slice to 10
  // chars for all comparisons — "2025-12-31T00:00:00" > "2025-12-31" in JS string
  // order, which would wrongly exclude that date from the anchor lookup.
  const anchorPrices = {}
  for (const region of regions) {
    const preRows = priceData.filter(r => r.DatePoint.slice(0, 10) <= cutoffStr && r[region] != null)
    if (preRows.length > 0) anchorPrices[region] = preRows[preRows.length - 1][region]
  }
  return priceData
    .filter(r => r.DatePoint.slice(0, 10) >= cutoffStr)
    .map(row => {
      const out = { DatePoint: row.DatePoint }
      for (const region of regions) {
        const anchor = anchorPrices[region]
        const price = row[region]
        out[region] = (anchor != null && anchor !== 0 && price != null)
          ? (price / anchor - 1) * 100
          : null
      }
      return out
    })
}

/**
 * Return a copy of chartData where each region's value is nulled out
 * for all rows after that region's last real date (removes forward-fill tail).
 */
function stripForwardFill(chartData, lastRealDateByRegion) {
  return chartData.map(row => {
    const newRow = { ...row }
    for (const [region, lastDate] of Object.entries(lastRealDateByRegion)) {
      if (row.DatePoint > lastDate) newRow[region] = null
    }
    return newRow
  })
}

/** Determine if log scale is appropriate for a dataset (all values must be positive) */
function canUseLogScale(chartData, regions) {
  if (!chartData || chartData.length === 0 || regions.length === 0) return false
  
  for (const row of chartData) {
    for (const region of regions) {
      const val = row[region]
      if (val !== undefined && val !== null && typeof val === 'number') {
        // Log scale requires strictly positive values
        if (val <= 0) return false
      }
    }
  }
  return true
}

/** Custom tooltip for range bar chart */
function RangeBarTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: 'var(--card-bg,#fff)', border: '1px solid #ccc', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{d.name}</p>
      <p style={{ margin: '2px 0', color: d.color }}>Aktuell: {d.current != null ? d.current.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#888' }}>Median: {d.median != null ? d.median.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#aaa' }}>Min: {d.min != null ? d.min.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#aaa' }}>Max: {d.max != null ? d.max.toFixed(2) : '—'}</p>
    </div>
  )
}

/**
 * Multi-Region Line Chart for a single equity metric.
 */
function EquityLineChart({ chartData, allChartData, allRawRecords, regions, metricLabel, metricKey, yAxisLabel = '', unit = '', currency = 'EUR', height = 300, chartType = 'Line', globalPeriod = null, lineWidth = 2 }) {
  const { addToPptx, addToXlsx } = useExport()

  // ── Local period filter (persisted per chart) ──────────────────────────
  const [localPeriod, setLocalPeriodRaw] = useState(() => {
    try { return localStorage.getItem(`chartPeriod_equity_${metricKey}`) || null } catch { return null }
  })
  const setLocalPeriod = (p) => {
    setLocalPeriodRaw(p)
    try {
      if (p) localStorage.setItem(`chartPeriod_equity_${metricKey}`, p)
      else localStorage.removeItem(`chartPeriod_equity_${metricKey}`)
    } catch {}
  }
  // Sync to global when global period changes (clears any local override)
  const prevGlobalPeriodRef = useRef(globalPeriod)
  useEffect(() => {
    if (prevGlobalPeriodRef.current === globalPeriod) return
    prevGlobalPeriodRef.current = globalPeriod
    setLocalPeriod(null)
  }, [globalPeriod])

  // ── Local chart type override (persisted per chart) ─────────────────────
  const [localChartType, setLocalChartTypeRaw] = useState(() => {
    try { return localStorage.getItem(`chartType_equity_${metricKey}`) || null } catch { return null }
  })
  const setLocalChartType = (t) => {
    setLocalChartTypeRaw(t)
    try {
      if (t) localStorage.setItem(`chartType_equity_${metricKey}`, t)
      else localStorage.removeItem(`chartType_equity_${metricKey}`)
    } catch {}
  }
  const prevGlobalChartTypeRef = useRef(chartType)
  useEffect(() => {
    if (prevGlobalChartTypeRef.current === chartType) return
    prevGlobalChartTypeRef.current = chartType
    setLocalChartType(null)
  }, [chartType])
  const effectiveChartType = localChartType ?? chartType

  // ── Legend mode (value / delta) ──────────────────────────────────────────
  const [legendMode, setLegendModeRaw] = useState(() => {
    try { return localStorage.getItem(`legendMode_equity_${metricKey}`) || 'value' } catch { return 'value' }
  })
  const setLegendMode = (m) => {
    setLegendModeRaw(m)
    try { localStorage.setItem(`legendMode_equity_${metricKey}`, m) } catch {}
  }

  // Active button: local override wins; falls back to global; null → no active btn
  const activeBtn = localPeriod ?? globalPeriod

  // For Performance (Wertentwicklung) with a local period override: recompute from
  // raw PX_LAST prices using the local anchor date (same method as the backend).
  // Skip recompute when localPeriod === globalPeriod — backend data is already correctly
  // anchored for this window. Pass today's UTC date so N-year cutoffs match GlobalControls.
  const utcToday = (() => { const n = new Date(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}` })()
  const localPerfData = (metricKey === 'Performance' && localPeriod && localPeriod !== globalPeriod)
    ? computePerfFromPrices(allRawRecords, regions, localPeriod, utcToday)
    : null
  const displayData = localPerfData
    ? localPerfData
    : localPeriod ? applyLocalPeriod(allChartData ?? chartData, localPeriod) : chartData
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(displayData)

  const chartTypeButtons = (
    <div className="chart-type-buttons">
      {[{ id: 'Line', label: 'Standard' }, { id: 'Bar', label: 'Balken' }].map(ct => (
        <button
          key={ct.id}
          className={`chart-period-btn${effectiveChartType === ct.id ? ' active' : ''}`}
          onClick={() => setLocalChartType(ct.id)}
        >
          {ct.label}
        </button>
      ))}
    </div>
  )

  const periodButtons = (
    <div className="chart-period-buttons">
      {['YtD', '1Y', '3Y', '5Y', 'All'].map(p => (
        <button
          key={p}
          className={`chart-period-btn${activeBtn === p ? ' active' : ''}`}
          onClick={() => setLocalPeriod(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Only render lines for regions that actually have at least one data point
  const activeRegions = regions.filter(r => displayData.some(d => d[r] !== undefined && d[r] !== null))

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-header"><h3>{metricLabel}</h3>{chartTypeButtons}{periodButtons}</div>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Strip backend forward-fill so each region's line ends at its last real data point
  const lastRealDateByRegion = findLastRealDatePerRegion(displayData, activeRegions)
  const strippedData = stripForwardFill(displayData, lastRealDateByRegion)
  // Note: no frontend rebasing needed. The backend correctly anchors each region's
  // Performance to the last price on or before the window start date. The filteredRecords
  // date filter now uses string comparisons (.slice(0,10)) so the start-date record is
  // correctly included. Any region that was closed on the anchor date will show a tiny
  // non-zero value on its first trading day, which is mathematically correct.
  const chartDisplayData = strippedData
  // "Aktualiät" = earliest of all regions' last real dates (every region has data up to at least this date)
  const letzesDatum = Object.values(lastRealDateByRegion).filter(Boolean).sort().shift() ?? null

  const isRSI = metricKey && metricKey.includes('RSI')
  const [yMin, yMax] = computeSmartDomain(chartDisplayData, activeRegions)
  const isLongSeries = isLongTimeseries(chartDisplayData)
  const useLogScale = canUseLogScale(chartDisplayData, activeRegions)
  
  // Compute even interval spacing for y-axis (linear only; log uses 'auto')
  let yDomain = ['auto', 'auto']
  if (yMin !== undefined && yMax !== undefined && !useLogScale) {
    const range = yMax - yMin
    if (range > 0) {
      const step = Math.pow(10, Math.floor(Math.log10(range)))
      const roundedMin = Math.floor(yMin / step) * step
      const roundedMax = Math.ceil(yMax / step) * step
      yDomain = [roundedMin, roundedMax]
    } else {
      // Flat data: add a fixed ±10% buffer around the single value
      const buffer = Math.abs(yMin) * 0.1 || 1
      yDomain = [yMin - buffer, yMax + buffer]
    }
  }

  const isCurrencyAffected = isEquityMetricCurrencyAffected(metricKey)
  const dateRange = getDateRange(chartDisplayData, 'DatePoint')
  const subheading = isCurrencyAffected
    ? (dateRange ? `${dateRange}, in ${currency}` : `in ${currency}`)
    : dateRange

  const periodLabel = activeBtn || 'All'
  const ctLabel     = effectiveChartType === 'Bar' ? 'Balken' : 'Linie'
  const fullTitle = `Aktien – ${metricLabel}`
  const exportItem = {
    id: `${makeId(fullTitle)}-${periodLabel.toLowerCase()}-${effectiveChartType.toLowerCase()}`,
    title: `${fullTitle} (${periodLabel}, ${ctLabel})`,
    pptx_title: metricLabel,
    subheading,
    yAxisLabel,
    source: 'Quelle: Bloomberg Finance L.P.',
    tab: 'Aktien',
    chartData: chartDisplayData,
    regions: activeRegions,
    xKey: 'DatePoint',
  }

  // Build range-bar data (one entry per region: min/max/median/current)
  const barData = activeRegions
    .map((region, idx) => {
      const vals = chartDisplayData.map(r => r[region]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const current = getLatestValueForRegion(chartDisplayData, region)
      return { name: translateRegion(region), spacer: min, range: max - min, current, median, min, max, color: REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length] }
    })
    .filter(Boolean)
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))

  // Attach Balken-specific export fields
  exportItem.chartType = effectiveChartType
  exportItem.balkenData = effectiveChartType === 'Bar' ? barData : undefined

  return (
    <div className="chart-container">
      <div className="chart-header"><h3>{metricLabel}</h3>{chartTypeButtons}{periodButtons}</div>
      <ResponsiveContainer width="100%" height={height}>
        {effectiveChartType === 'Bar' ? (
          <ComposedChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={60} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip content={<RangeBarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            <Bar dataKey="spacer" stackId="r" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="range" stackId="r" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {barData.map(d => <Cell key={d.name} fill={d.color} fillOpacity={0.6} />)}
            </Bar>
            <Line dataKey="current" stroke="none" strokeWidth={0} dot={(props) => {
              const { cx, cy, payload } = props
              if (cx == null || cy == null) return null
              return <circle key={payload.name} cx={cx} cy={cy} r={6} fill="white" stroke={payload.color} strokeWidth={2} />
            }} activeDot={false} legendType="none" isAnimationActive={false} />
            <Line dataKey="median" stroke="none" strokeWidth={0} dot={(props) => {
              const { cx, cy, payload } = props
              if (cx == null || cy == null) return null
              return <rect key={`med-${payload.name}`} x={cx - 14} y={cy - 2} width={28} height={4} fill={payload.color} fillOpacity={0.95} rx={1} />
            }} activeDot={false} legendType="none" isAnimationActive={false} />
          </ComposedChart>
        ) : (
          <LineChart data={chartDisplayData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="DatePoint"
              tick={{ fontSize: 11 }}
              tickFormatter={(isoStr) => fmtDate(isoStr, smartDateFormatter)}
              interval={smartInterval}
            />
            <YAxis 
              scale={useLogScale ? 'log' : undefined}
              tick={{ fontSize: 11 }}
              domain={yDomain}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
              formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
              labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
            />
            <Legend
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null
                return (
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px', fontSize: 14, paddingTop: 4, paddingLeft: 8, paddingRight: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', flex: 1, minWidth: 0 }}>
                      {payload.map((entry, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <svg width="16" height="4" style={{ flexShrink: 0 }}><line x1="0" y1="2" x2="16" y2="2" stroke={entry.color} strokeWidth="2" /></svg>
                          <span style={{ color: 'var(--text-primary)' }}>{entry.value}</span>
                        </span>
                      ))}
                    </div>
                    {metricKey !== 'Performance' && (
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        <button className={`chart-period-btn${legendMode === 'value' ? ' active' : ''}`} onClick={() => setLegendMode('value')}>Letzter Wert</button>
                        <button className={`chart-period-btn${legendMode === 'delta' ? ' active' : ''}`} onClick={() => setLegendMode('delta')}>Delta</button>
                      </div>
                    )}
                  </div>
                )
              }}
            />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            {isRSI && (
              <>
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" />
                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 2" />
              </>
            )}
            {[...activeRegions]
              .sort((a, b) => {
                if (legendMode === 'delta') {
                  const firstA = getFirstValueForRegion(chartDisplayData, a)
                  const lastA  = getLatestValueForRegion(chartDisplayData, a)
                  const firstB = getFirstValueForRegion(chartDisplayData, b)
                  const lastB  = getLatestValueForRegion(chartDisplayData, b)
                  const dA = (firstA != null && lastA != null) ? (lastA - firstA) : -Infinity
                  const dB = (firstB != null && lastB != null) ? (lastB - firstB) : -Infinity
                  return dB - dA
                }
                const latestA = getLatestValueForRegion(chartDisplayData, a) ?? -Infinity
                const latestB = getLatestValueForRegion(chartDisplayData, b) ?? -Infinity
                return latestB - latestA
              })
              .map((region) => {
              const latestValue = getLatestValueForRegion(chartDisplayData, region)
              const formatted = fmtLegendValue(latestValue, unit)
              let legendName
              if (legendMode === 'delta') {
                const firstValue = getFirstValueForRegion(chartDisplayData, region)
                if (firstValue != null && latestValue != null) {
                  const delta = latestValue - firstValue
                  const arrow = delta > 0.0001 ? '▲' : delta < -0.0001 ? '▼' : '→'
                  const formattedDelta = fmtLegendValue(Math.abs(delta), unit)
                  legendName = formattedDelta !== null ? `${translateRegion(region)} (${arrow} ${formattedDelta})` : translateRegion(region)
                } else {
                  legendName = translateRegion(region)
                }
              } else {
                legendName = formatted !== null ? `${translateRegion(region)} (${formatted})` : translateRegion(region)
              }
              return (
                <Line
                  key={region}
                  type="monotone"
                  dataKey={region}
                  name={legendName}
                  stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
                  dot={false}
                  strokeWidth={lineWidth}
                  isAnimationActive={false}
                  connectNulls
                />
              )
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => withDataGapWarning(addToPptx, chartDisplayData, activeRegions)(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => withDataGapWarning(addToXlsx, chartDisplayData, activeRegions)(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {letzesDatum && (
          <span className="chart-export-date">Aktualität: {new Date(letzesDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, Bloomberg Finance L.P.</span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RAINBOW CHART  (PE-Bänder)
// Shows price vs simulated EPS × P/E bands [8, 10, 12, 15, 18, 21] per region.
// Based on the reference Dash dashboard: countries/functions.py eq_create_rainbow_plot
// ─────────────────────────────────────────────────────────────────────────────

const BAND_LEVELS = [8, 10, 12, 15, 18, 21]
const BAND_COLORS = ['#9C27B0', '#3F51B5', '#4CAF50', '#D4AC00', '#FF9800', '#F44336']

/**
 * Build per-region data for the rainbow chart.
 * sim_eps = PX_LAST / PE_RATIO  →  band_n = sim_eps × n
 * Both PX_LAST and PE_RATIO must be present in the same row (Bloomberg monthly PE data).
 */
function prepareRainbowData(records, region) {
  return records
    .filter(r => r.Regions === region && r.PX_LAST != null && r.PE_RATIO != null)
    .sort((a, b) => String(a.DatePoint).localeCompare(String(b.DatePoint)))
    .map(row => {
      const simEps = row.PX_LAST / row.PE_RATIO
      const point = { DatePoint: row.DatePoint, PX_LAST: row.PX_LAST }
      BAND_LEVELS.forEach(l => { point[`b${l}`] = simEps * l })
      return point
    })
}

/**
 * Distance of current price above the 21x PE band.
 * Positive  → price is above (expensive), Negative → below.
 * Used to sort regions: most expensive first.
 */
function getLatestRainbowDistance(records, region) {
  const sorted = records
    .filter(r => r.Regions === region && r.PX_LAST != null && r.PE_RATIO != null)
    .sort((a, b) => String(b.DatePoint).localeCompare(String(a.DatePoint)))
  if (!sorted.length) return 0
  const { PX_LAST, PE_RATIO } = sorted[0]
  const simEps = PX_LAST / PE_RATIO
  return simEps > 0 ? PX_LAST / (simEps * 21) - 1 : 0
}

/** Single-region rainbow sub-chart */
function RainbowRegionChart({ region, records, regionColor, height = 220 }) {
  const data = prepareRainbowData(records, region)
  const { formatter: smartDateFormatter } = getSmartDateFormat(data)

  if (data.length === 0) {
    return (
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{translateRegion(region)}</div>
        <div className="chart-empty" style={{ height }}>Keine Daten (PX_LAST + PE_RATIO benötigt)</div>
      </div>
    )
  }

  // Limit to max 4 tick labels on x-axis
  const maxTicks = 4
  const interval = Math.ceil(data.length / maxTicks) - 1
  const useLogScale = canUseLogScale(data, ['PX_LAST', ...BAND_LEVELS.map(l => `b${l}`)])

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{translateRegion(region)}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="DatePoint"
            tick={{ fontSize: 10 }}
            tickFormatter={(s) => fmtDate(s, smartDateFormatter)}
            interval={interval}
          />
          <YAxis scale={useLogScale ? 'log' : undefined} domain={useLogScale ? ['auto', 'auto'] : undefined} tick={{ fontSize: 10 }} tickFormatter={formatYValue} width={42} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--card-bg,#fff)', border: '1px solid #ccc', fontSize: 11 }}
            formatter={(v, name) => [typeof v === 'number' ? v.toFixed(1) : v, name]}
            labelFormatter={(l) => typeof l === 'string' ? l.split('T')[0] : l}
          />
          {/* Actual price line – thicker, region colour */}
          <Line
            type="monotone"
            dataKey="PX_LAST"
            name="Kurs"
            stroke={regionColor}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
            legendType="none"
          />
          {/* PE-band lines */}
          {BAND_LEVELS.map((level, i) => (
            <Line
              key={`b${level}`}
              type="monotone"
              dataKey={`b${level}`}
              name={`${level}x KGV`}
              stroke={BAND_COLORS[i]}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
              connectNulls
              legendType="none"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Legend strip showing the 6 PE-band colour codes */
function RainbowLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginBottom: 12, fontSize: 11 }}>
      {BAND_LEVELS.map((l, i) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 22, height: 3, background: BAND_COLORS[i], borderRadius: 1 }} />
          {l}× KGV
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}>
        <span style={{ display: 'inline-block', width: 22, height: 3, background: '#666', borderRadius: 1 }} />
        Kurs (Region)
      </span>
    </div>
  )
}

/**
 * Rainbow chart section: one sub-chart per region, sorted by how far the
 * current price exceeds the 21× PE band (most expensive first).
 * Full width, up to 6 subplots per row. If fewer than 6 regions, stretches to fill row.
 */
function RainbowSection({ filteredRecords, allRecords, regions, chartHeight = 220, globalPeriod = null }) {
  if (!regions.length) return null

  // ── Local period filter (persisted per chart) ──────────────────────────
  const [localPeriod, setLocalPeriodRaw] = useState(() => {
    try { return localStorage.getItem('chartPeriod_equity_rainbow') || null } catch { return null }
  })
  const setLocalPeriod = (p) => {
    setLocalPeriodRaw(p)
    try {
      if (p) localStorage.setItem('chartPeriod_equity_rainbow', p)
      else localStorage.removeItem('chartPeriod_equity_rainbow')
    } catch {}
  }
  // Sync to global when global period changes (clears any local override)
  const prevGlobalPeriodRef = useRef(globalPeriod)
  useEffect(() => {
    if (prevGlobalPeriodRef.current === globalPeriod) return
    prevGlobalPeriodRef.current = globalPeriod
    setLocalPeriod(null)
  }, [globalPeriod])

  // Active button: local override wins; falls back to global; null → no active btn
  const activeBtn = localPeriod ?? globalPeriod

  // Use local period override if set, otherwise use globally-filtered data
  const displayRecords = localPeriod ? applyLocalPeriod(allRecords, localPeriod) : filteredRecords

  const sortedRegions = [...regions].sort(
    (a, b) => getLatestRainbowDistance(displayRecords, b) - getLatestRainbowDistance(displayRecords, a)
  )

  const cols = Math.min(6, sortedRegions.length)

  const periodButtons = (
    <div className="chart-period-buttons">
      {['YtD', '1Y', '3Y', '5Y', 'All'].map(p => (
        <button
          key={p}
          className={`chart-period-btn${activeBtn === p ? ' active' : ''}`}
          onClick={() => setLocalPeriod(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )

  // Aktualität: for each region find the last date with PX_LAST, then show the minimum
  const rainbowLastDates = regions
    .map(region => {
      const rows = displayRecords
        .filter(r => r.Regions === region && r.PX_LAST != null)
        .map(r => r.DatePoint)
        .filter(Boolean)
        .sort()
      return rows[rows.length - 1] ?? null
    })
    .filter(Boolean)
    .sort()
  const rainbowLetzesDatum = rainbowLastDates[0] ?? null

  return (
    <div className="chart-container" style={{ gridColumn: '1 / -1' }}>
      <div className="chart-header"><h3>Rainbow (PE-Bänder)</h3>{periodButtons}</div>
      <RainbowLegend />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: '16px',
        }}
      >
        {sortedRegions.map((region) => (
          <RainbowRegionChart
            key={region}
            region={region}
            records={displayRecords}
            regionColor={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
            height={chartHeight}
          />
        ))}
      </div>
      <div className="chart-export-buttons">
        {rainbowLetzesDatum && (
          <span className="chart-export-date">Aktualität: {new Date(rainbowLetzesDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, Bloomberg Finance L.P.</span>
        )}
      </div>
    </div>
  )
}

/**
 * Equity Tab Component
 * Displays equity market data, technical indicators, and performance metrics.
 * One line per selected region for every metric chart.
 */
function EquityTab({
  filters,
  data,
  loading,
  error,
  columns,
  columnsLoading,
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  chartsPerRow = 2,
  chartHeight = 300,
  chartType = 'Line',
  lineWidth = 2,
}) {
  if (loading || columnsLoading) {
    return <div className="tab-loading">📊 Laden...</div>
  }

  if (error) {
    return <div className="tab-error">❌ Fehler: {error}</div>
  }

  if (!data) {
    return <div className="tab-empty">Keine Daten verfügbar</div>
  }

  const regions = filters.regions || []
  const currency = filters.currency || 'EUR'
  const allRecords = data.data || []
  const globalPeriod = filters.customMode ? null : (filters.lookback || null)

  // Apply date-range filter for charts.
  // Use .slice(0,10) string comparison throughout: DatePoints are "YYYY-MM-DDTHH:MM:SS"
  // (local-time datetime). new Date() on a date-only string "YYYY-MM-DD" is parsed as
  // UTC midnight, while the datetime string is parsed as local midnight — in UTC+1 that
  // means March 13 local midnight < March 13 UTC midnight, so the start-date record
  // would be wrongly excluded. Slicing to 10 chars keeps everything as plain strings.
  const filteredRecords = allRecords.filter((r) => {
    if (!r.DatePoint) return false
    const dp = r.DatePoint.slice(0, 10)
    if (filters.startDate && dp < filters.startDate.slice(0, 10)) return false
    if (filters.endDate   && dp > filters.endDate.slice(0, 10))   return false
    return true
  })

  const graphColumns = columns.filter(
    col => selectedMetricsGraph.length === 0 || selectedMetricsGraph.includes(col)
  ).sort((a, b) => {
    // Sort by STANDARD_DEFAULTS.graph order to ensure consistent display
    const indexA = STANDARD_DEFAULTS.graph.indexOf(a)
    const indexB = STANDARD_DEFAULTS.graph.indexOf(b)
    // If both are in defaults, use their order; otherwise let backend order decide
    if (indexA >= 0 && indexB >= 0) return indexA - indexB
    if (indexA >= 0) return -1 // a is in defaults, comes first
    if (indexB >= 0) return 1  // b is in defaults, comes first
    return 0 // neither in defaults, keep original order
  })

  return (
    <div className="equity-tab">
      {/* Latest Values Table */}
      <MetricsTable
        data={allRecords}
        regions={regions}
        columns={selectedMetricsTable.length > 0 ? selectedMetricsTable : columns}
        categories={EQUITY_METRICS_CATEGORIES}
        lookback={filters.lookback}
        tabLabel="Aktien"
      />

      {/* One chart per selected metric – one line per region */}
      <div
        className="chart-grid"
        style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
      >
        {columns.length > 0 ? (
          graphColumns.map((column) => (
            <EquityLineChart
              key={column}
              chartData={pivotDataForChart(filteredRecords, column, regions)}
              allChartData={pivotDataForChart(allRecords, column, regions)}
              allRawRecords={column === 'Performance' ? allRecords : undefined}
              regions={regions}
              metricLabel={getColumnTitle(column)}
              metricKey={column}
              yAxisLabel={getYAxisLabel(column)}
              unit={getEquityMetricUnit(column)}
              currency={currency}
              height={chartHeight}
              chartType={chartType}
              globalPeriod={globalPeriod}
              lineWidth={lineWidth}
            />
          ))
        ) : (
          <div className="chart-empty">Keine Metriken verfügbar</div>
        )}

        {/* Rainbow PE-Bänder – rendered inline with the chart grid, spans all columns */}
        {selectedMetricsGraph.includes('Rainbow') && (
          <RainbowSection
            filteredRecords={filteredRecords}
            allRecords={allRecords}
            regions={regions}
            chartHeight={chartHeight}
            globalPeriod={globalPeriod}
          />
        )}
      </div>
    </div>
  )
}

export default EquityTab
