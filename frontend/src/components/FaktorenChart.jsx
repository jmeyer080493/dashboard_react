/**
 * FaktorenChart – Factor Analysis Chart Component
 *
 * Renders a line chart of cumulative-return series for one factor graph.
 * When `hasDifference` is true (exactly 2 main series), a second smaller panel
 * is shown below with the spread between the two series (green above 0, red below).
 * Both panels share the X-axis domain.
 *
 * Includes PPTX and XLSX export buttons that plug into the existing ExportContext.
 */

import { useState, useEffect, useRef } from 'react'
import {
  LineChart,
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
  ComposedChart,
  Area,
} from 'recharts'
import { useExport } from '../context/ExportContext'
import { getSmartDateFormat } from '../config/metricsConfig'
import { withDataGapWarning } from '../utils/exportWarnings'
import './Charts.css'
import { ExcelIcon, PowerPointIcon } from '../icons/MicrosoftIcons'

/** Stable ID from a string */
function makeId(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** German-formatted date range string */
function getDateRange(chartData) {
  if (!chartData || chartData.length === 0) return ''
  const dates = chartData.map(r => r.DatePoint).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = d => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

const LINE_COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']
const DIFF_COLOR  = '#1a1a1a'

/**
 * Build a value-formatter function based on the yUnit prop.
 *   'pct'  → "12.34 %"
 *   'M'    → "34.12M"
 *   'B'    → "1.23B"
 *   'raw'  → "42.00"
 */
function buildFmt(yUnit) {
  switch (yUnit) {
    case 'M':   return v => (v == null ? '—' : `${(v / 1e6).toFixed(2)}M`)
    case 'B':   return v => (v == null ? '—' : `${(v / 1e9).toFixed(2)}B`)
    case 'raw': return v => (v == null ? '—' : typeof v === 'number' ? v.toFixed(2) : String(v))
    default:    return v => (v == null ? '—' : `${v.toFixed(2)} %`)  // 'pct'
  }
}

/** Same as buildFmt but rounds to 1 decimal – used for legend labels. */
function buildLegendFmt(yUnit) {
  switch (yUnit) {
    case 'M':   return v => (v == null ? '—' : `${(v / 1e6).toFixed(1)}M`)
    case 'B':   return v => (v == null ? '—' : `${(v / 1e9).toFixed(1)}B`)
    case 'raw': return v => (v == null ? '—' : typeof v === 'number' ? v.toFixed(1) : String(v))
    default:    return v => (v == null ? '—' : `${v.toFixed(1)} %`)  // 'pct'
  }
}

/** Find the latest (most recent) value for a specific series across all data points */
function getLatestValueForSeries(data, seriesName) {
  if (!data || data.length === 0) return undefined
  // Iterate backwards to find the most recent value for this series
  for (let i = data.length - 1; i >= 0; i--) {
    const value = data[i][seriesName]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

/** Compute the ISO cutoff date string for a given period, anchored to the latest date in data. */
function getPeriodCutoff(data, period) {
  if (!period || period === 'All') return null
  const allDates = data.map(r => r.DatePoint).filter(Boolean).sort()
  if (!allDates.length) return null
  const latestDate = new Date(allDates[allDates.length - 1])
  let cutoffDate
  if (period === 'MtD') {
    cutoffDate = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1)
  } else if (period === 'YtD') {
    cutoffDate = new Date(latestDate.getFullYear() - 1, 11, 31)
  } else {
    const daysMap = { '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5, '7Y': 365 * 7 }
    const days = daysMap[period] ?? 365
    cutoffDate = new Date(latestDate.getTime() - days * 86400000)
  }
  return cutoffDate.toISOString().split('T')[0]
}

/**
 * Rebase cumulative-return data to a new period start.
 *
 * The backend stores values as (price_i / price_base - 1) * 100 where price_base
 * is anchored to the global start_date. When the user selects a local period that
 * extends beyond the global window we supply allData (rebased from ~1990).
 * This function re-normalises those values so the local period start = 0 %:
 *   new_value[i] = ((cr[i]/100 + 1) / (cr[base]/100 + 1) - 1) * 100
 *
 * The "Difference" column (spread between two series) is recomputed from the
 * freshly-rebased series values.
 *
 * seriesNames – list of series keys (excluding "Difference")
 */
function rebaseToLocalPeriod(allData, period, seriesNames) {
  const cutoffStr = getPeriodCutoff(allData, period)
  if (!cutoffStr) return allData          // 'All' – no rebase needed

  // Last row on or before cutoffStr provides the base price for each series
  const baseValues = {}
  for (const s of seriesNames) {
    const pre = allData.filter(r => r.DatePoint <= cutoffStr && r[s] != null)
    if (pre.length) {
      baseValues[s] = pre[pre.length - 1][s]
    } else {
      // No data before cutoff – use the first available value
      const post = allData.find(r => r[s] != null)
      if (post) baseValues[s] = post[s]
    }
  }

  // Filter to local window and re-normalise
  const filtered = allData.filter(r => r.DatePoint >= cutoffStr)
  return filtered.map(row => {
    const newRow = { DatePoint: row.DatePoint }
    for (const s of seriesNames) {
      const base = baseValues[s]
      if (base == null || row[s] == null) {
        newRow[s] = null
      } else {
        // Convert: cr_period = (factor_i / factor_base - 1) * 100
        // where factor = cr_all/100 + 1
        newRow[s] = ((row[s] / 100 + 1) / (base / 100 + 1) - 1) * 100
      }
    }
    // Recompute Difference from the two rebased series (when exactly 2 series)
    if (seriesNames.length === 2) {
      const [a, b] = seriesNames
      if (newRow[a] != null && newRow[b] != null) {
        newRow.Difference = newRow[a] - newRow[b]
      }
    }
    return newRow
  })
}

/** Custom tooltip – receives a `format` prop injected by the parent */
function CustomTooltip({ active, payload, label, format }) {
  if (!active || !payload || payload.length === 0) return null
  const fmt = format ?? (v => (typeof v === 'number' ? `${v.toFixed(2)} %` : '—'))
  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #ccc)',
      padding: '8px 12px',
      borderRadius: 6,
      fontSize: 12,
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

function DiffTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  const val = payload.find(p => p.name === 'Differenz')?.value
  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #ccc)',
      padding: '6px 10px',
      borderRadius: 6,
      fontSize: 12,
    }}>
      <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
      {val != null && <p style={{ margin: 0 }}>Differenz: {val.toFixed(2)} %</p>}
    </div>
  )
}

/**
 * FaktorenChart
 *
 * Props:
 *   title       {string}  Chart title (displayed above chart)
 *   data        {Array}   Wide rows: [{DatePoint, SeriesA, SeriesB, Difference?}]
 *   series      {string[]} Ordered series names (excludes "Difference")
 *   hasDifference {bool}  Whether to render the split difference panel
 *   height      {number}  Total height in px (default 420)
 *   tab         {string}  Tab label for export metadata
 */
/** Custom tooltip for range bar chart */
function FaktorenRangeBarTooltip({ active, payload }) {
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

export default function FaktorenChart({
  title = '',
  data = [],
  series = [],
  hasDifference = false,
  height = 420,
  tab = 'Faktoren',
  /** 'pct' (default) | 'M' | 'B' | 'raw' – controls Y-axis tick labels & tooltip values */
  yUnit = 'pct',
  /** When true the Y-axis auto-scales to the data range instead of starting at 0 */
  yDomainAuto = false,
  /** Currency to append to subheading, e.g. 'EUR' or 'USD' */
  currency = null,
  /** Y-axis label for export, e.g. '%' */
  yAxisLabel = '%',
  /** Global lookback period from parent page – clears local override when changed */
  globalPeriod = null,
  /** Global chart type from parent page – clears local override when changed */
  chartType = 'Line',
  /** Full unfiltered dataset – used by local period so it can reach beyond the global window */
  allData = null,
  /** Line stroke width in pixels */
  lineWidth = 2,
}) {
  const { addToPptx, addToXlsx } = useExport()

  // ── Local period filter (persisted per chart) ──────────────────────────────
  const [localPeriod, setLocalPeriodRaw] = useState(() => {
    try { return localStorage.getItem(`chartPeriod_faktoren_${title}`) || null } catch { return null }
  })
  const setLocalPeriod = (p) => {
    setLocalPeriodRaw(p)
    try {
      if (p) localStorage.setItem(`chartPeriod_faktoren_${title}`, p)
      else localStorage.removeItem(`chartPeriod_faktoren_${title}`)
    } catch {}
  }
  const prevGlobalPeriodRef = useRef(globalPeriod)
  useEffect(() => {
    if (prevGlobalPeriodRef.current === globalPeriod) return
    prevGlobalPeriodRef.current = globalPeriod
    setLocalPeriod(null)
  }, [globalPeriod])

  // ── Local chart type override (persisted per chart) ────────────────────────
  const [localChartType, setLocalChartTypeRaw] = useState(() => {
    try { return localStorage.getItem(`chartType_faktoren_${title}`) || null } catch { return null }
  })
  const setLocalChartType = (t) => {
    setLocalChartTypeRaw(t)
    try {
      if (t) localStorage.setItem(`chartType_faktoren_${title}`, t)
      else localStorage.removeItem(`chartType_faktoren_${title}`)
    } catch {}
  }
  const prevGlobalChartTypeRef = useRef(chartType)
  useEffect(() => {
    if (prevGlobalChartTypeRef.current === chartType) return
    prevGlobalChartTypeRef.current = chartType
    setLocalChartType(null)
  }, [chartType])
  const effectiveChartType = localChartType ?? chartType

  const activeBtn = localPeriod ?? globalPeriod
  // When a local period is active AND different from the global period, rebase
  // the full-history data so each series starts at 0% at the local period start.
  // If localPeriod === globalPeriod the backend data is already correctly rebased –
  // calling rebaseToLocalPeriod on top would double-rebase and produce wrong numbers.
  const effectiveLocalPeriod = (localPeriod && localPeriod !== globalPeriod) ? localPeriod : null
  const displayData = effectiveLocalPeriod
    ? rebaseToLocalPeriod(allData ?? data, effectiveLocalPeriod, series)
    : data

  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(displayData)

  const chartTypeButtons = (
    <div className="chart-type-buttons" style={{ borderRight: 'none', paddingRight: 0, marginRight: 0, marginBottom: '4px' }}>
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
      {['MtD', 'YtD', '1Y', '3Y', '7Y', 'All'].map(p => (
        <button
          key={p}
          className={`chart-period-btn${activeBtn === p ? ' active' : ''}`}
          onClick={() => setLocalPeriod(p)}
        >{p}</button>
      ))}
    </div>
  )

  if (!data || data.length === 0) {
    return (
      <div className="chart-container faktoren-chart">
        {title && (
          <div className="chart-header">
            <h3>{title}</h3>
            {periodButtons}
          </div>
        )}
        {chartTypeButtons}
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // The main series = all series except "Difference", sorted by latest value (high to low)
  const mainSeries = series
    .filter(s => s !== 'Difference')
    .sort((a, b) => {
      const latestA = getLatestValueForSeries(displayData, a) ?? -Infinity
      const latestB = getLatestValueForSeries(displayData, b) ?? -Infinity
      return latestB - latestA
    })

  // Build range-bar data (one entry per series: min/max/median/current)
  const barData = mainSeries
    .map((s, idx) => {
      const vals = displayData.map(r => r[s]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const current = getLatestValueForSeries(displayData, s)
      return { name: s, spacer: min, range: max - min, current, median, min, max, color: LINE_COLORS[idx % LINE_COLORS.length] }
    })
    .filter(Boolean)
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))

  // Export: include all columns (the consumer will flatten them)
  const fullTitle   = tab ? `${tab} – ${title}` : title
  const dateRange   = getDateRange(displayData)
  const subheading  = currency
    ? (dateRange ? `${dateRange}, in ${currency}` : `in ${currency}`)
    : dateRange
  const periodLabel = activeBtn || 'All'
  const ctLabel     = effectiveChartType === 'Bar' ? 'Balken' : 'Linie'
  const exportItem  = {
    id:         `${makeId(fullTitle)}-${periodLabel.toLowerCase()}-${effectiveChartType.toLowerCase()}`,
    title:      `${fullTitle} (${periodLabel}, ${ctLabel})`,
    pptx_title: title,
    subheading,
    yAxisLabel,
    source:     'Quelle: Bloomberg Finance L.P.',
    tab,
    chartData:  displayData,
    regions:    mainSeries,
    xKey:       'DatePoint',
    chartType:  effectiveChartType,
    balkenData: effectiveChartType === 'Bar' ? barData : undefined,
  }

  const mainHeight = hasDifference && effectiveChartType !== 'Bar' ? Math.round(height * 0.70) : height
  const diffHeight = hasDifference && effectiveChartType !== 'Bar' ? height - mainHeight - 8 : 0

  // Build formatter and axis config from yUnit
  const fmtValue = buildFmt(yUnit)
  const fmtLegend = buildLegendFmt(yUnit)
  const yAxisWidth = yUnit === 'B' ? 72 : yUnit === 'M' ? 64 : 52
  const yAxisTickFmt = (v) => {
    if (yUnit === 'M') return `${(v / 1e6).toFixed(0)}M`
    if (yUnit === 'B') return `${(v / 1e9).toFixed(0)}B`
    if (yUnit === 'raw') return v.toFixed(0)
    return `${v.toFixed(0)} %`
  }
  // Smart domain: 5 % padding on each side so the chart never pins to 0
  const yDomain = yDomainAuto
    ? [(min) => min * 0.95, (max) => max * 1.05]
    : undefined

  // Build diff data with positiveVal / negativeVal for the filled areas
  const diffData = hasDifference
    ? displayData.map(row => ({
        DatePoint:    row.DatePoint,
        Difference:   row.Difference ?? null,
        positiveVal:  row.Difference > 0 ? row.Difference : 0,
        negativeVal:  row.Difference < 0 ? row.Difference : 0,
      }))
    : []

  return (
    <div className="chart-container faktoren-chart">
      {title && (
        <div className="chart-header">
          <h3>{title}</h3>
          {periodButtons}
        </div>
      )}
      {chartTypeButtons}

      {/* ── Bar chart (Balken mode) ───────────────────────────────── */}
      {effectiveChartType === 'Bar' && (
        <ResponsiveContainer width="100%" height={height - 48}>
          <ComposedChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={60} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={yAxisTickFmt} width={yAxisWidth} />
            <Tooltip content={<FaktorenRangeBarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
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
        </ResponsiveContainer>
      )}

      {/* ── Main line chart ──────────────────────────────────────── */}
      {effectiveChartType !== 'Bar' && (
      <ResponsiveContainer width="100%" height={mainHeight}>
        <LineChart data={displayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e0e0e0)" />
          <XAxis
            dataKey="DatePoint"
            tick={{ fontSize: 11 }}
            tickFormatter={smartDateFormatter}
            interval={smartInterval}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={yAxisTickFmt}
            width={yAxisWidth}
            {...(yDomain ? { domain: yDomain } : {})}
          />
          <Tooltip content={<CustomTooltip format={fmtValue} />} />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12 }}
            formatter={name => {
              const latestVal = getLatestValueForSeries(displayData, name)
              return `${name} (${latestVal != null ? fmtLegend(latestVal) : '—'})`
            }}
          />
          {mainSeries.map((s, idx) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              name={s}
              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
              dot={false}
              strokeWidth={lineWidth}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      )}

      {/* ── Difference sub-chart (only when hasDifference) ───────── */}
      {hasDifference && effectiveChartType !== 'Bar' && (
        <div style={{ marginTop: 4 }}>
          <ResponsiveContainer width="100%" height={diffHeight}>
            <ComposedChart data={diffData} margin={{ top: 2, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e0e0e0)" />
              <XAxis
                dataKey="DatePoint"
                tick={{ fontSize: 10 }}
                tickFormatter={smartDateFormatter}
                interval={smartInterval}
              />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}`} width={42} />
              <Tooltip content={<DiffTooltip />} />
              <ReferenceLine y={0} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="positiveVal"
                name="Pos. Differenz"
                stroke="none"
                fill="rgba(0,200,0,0.3)"
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
              <Area
                type="monotone"
                dataKey="negativeVal"
                name="Neg. Differenz"
                stroke="none"
                fill="rgba(200,0,0,0.3)"
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="Difference"
                name="Differenz"
                stroke={DIFF_COLOR}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Export buttons ───────────────────────────────────────── */}
      <div className="chart-export-buttons">
        <button
          className="chart-export-btn pptx"
          onClick={() => withDataGapWarning(addToPptx, displayData, mainSeries)(exportItem)}
          title="Zu PowerPoint hinzufügen"
        >
          <PowerPointIcon width={26} height={26} />
        </button>
        <button
          className="chart-export-btn xlsx"
          onClick={() => withDataGapWarning(addToXlsx, displayData, mainSeries)(exportItem)}
          title="Zu Excel hinzufügen"
        >
          <ExcelIcon width={26} height={26} />
        </button>
        {displayData[displayData.length - 1]?.DatePoint && (
          <>
            <span className="chart-export-date">Aktualität: {displayData[displayData.length - 1].DatePoint.split('T')[0]}, Bloomberg Finance L.P.</span>
      
          </>
        )}
      </div>
    </div>
  )
}
