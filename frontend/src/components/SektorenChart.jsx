/**
 * SektorenChart – Sector PE Ratio Chart Component
 *
 * Renders either:
 *   Line mode – one colored line per sector / series over time
 *   Bar  mode – horizontal range bar (min → max) with current-value dot overlay per series
 *
 * Includes PPTX and XLSX export buttons via ExportContext (same pattern as FaktorenChart).
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import {
  ComposedChart,
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
} from 'recharts'
import { useExport } from '../context/ExportContext'
import { getSmartDateFormat } from '../config/metricsConfig'
import { withDataGapWarning } from '../utils/exportWarnings'
import './Charts.css'
import './SektorenChart.css'
import { ExcelIcon, PowerPointIcon } from '../icons/MicrosoftIcons'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FALLBACK_COLORS = [
  '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#14b8a6', '#6366f1', '#84cc16', '#f43f5e', '#06b6d4',
]

function resolveColor(name, colors, seriesIndex) {
  if (colors && colors[name]) return colors[name]
  return FALLBACK_COLORS[seriesIndex % FALLBACK_COLORS.length]
}

function getDateRange(data) {
  if (!data || data.length === 0) return ''
  const dates = data.map(r => r.DatePoint).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = d => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
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

/** Find the first (oldest) non-null value for a specific series across all data points */
function getFirstValueForSeries(data, seriesName) {
  if (!data || data.length === 0) return undefined
  for (let i = 0; i < data.length; i++) {
    const value = data[i][seriesName]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

// ── Custom Tooltips ───────────────────────────────────────────────────────────

function LineTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #ccc)',
      padding: '8px 12px',
      borderRadius: 6,
      fontSize: 12,
      maxHeight: 300,
      overflowY: 'auto',
      maxWidth: 280,
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : '—'}
        </p>
      ))}
    </div>
  )
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #ccc)',
      padding: '8px 12px',
      borderRadius: 6,
      fontSize: 12,
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{d.fullName}</p>
      <p style={{ margin: '2px 0', color: d.color }}>Aktuell: {d.current != null ? d.current.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#888' }}>Median:  {d.median != null ? d.median.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#aaa' }}>Min:     {d.min != null ? d.min.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#aaa' }}>Max:     {d.max != null ? d.max.toFixed(2) : '—'}</p>
    </div>
  )
}



// ── Main component ────────────────────────────────────────────────────────────

/**
 * Apply a local period filter to chart data, anchored to the latest date in the data.
 */
function applyLocalPeriod(data, period) {
  if (!period || period === 'All') return data
  const allDates = data.map(r => r.DatePoint).filter(Boolean).sort()
  if (!allDates.length) return data
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
  const cutoffStr = cutoffDate.toISOString().split('T')[0]
  return data.filter(r => r.DatePoint >= cutoffStr)
}

/**
 * Props:
 *   title     {string}   Chart title
 *   data      {Array}    Wide rows: [{DatePoint, SeriesName: value, ...}]
 *   series    {string[]} Ordered series names
 *   colors    {object}   {seriesName: hexColor} – from backend
 *   chartType {string}   'Line' | 'Bar'
 *   height    {number}   Total height in px
 *   tab       {string}   Tab label for export metadata
 *   fixedYDomain {[number, number]} Optional fixed y-axis domain [min, max] for bar charts
 */
export default function SektorenChart({
  title = '',
  data = [],
  series = [],
  colors = {},
  chartType = 'Line',
  height = 500,
  tab = 'Sektoren',
  isComparison = false,   // true for "U.S. vs. Europa" view → grouped US/EU bar chart
  /** Y-axis label for export, e.g. 'Wert' */
  yAxisLabel = 'Wert',
  fixedYDomain = null,    // [min, max] for fixed y-axis in bar charts
  /** Global lookback period from parent page – clears local override when changed */
  globalPeriod = null,
  /** Full unfiltered dataset – used by local period so it can reach beyond the global window */
  allData = null,
  /** Line stroke width in pixels */
  lineWidth = 2,
}) {
  const { addToPptx, addToXlsx } = useExport()

  // ── Local period filter (persisted per chart) ─────────────────────────────
  const [localPeriod, setLocalPeriodRaw] = useState(() => {
    try { return localStorage.getItem(`chartPeriod_sektoren_${title}`) || null } catch { return null }
  })
  const setLocalPeriod = (p) => {
    setLocalPeriodRaw(p)
    try {
      if (p) localStorage.setItem(`chartPeriod_sektoren_${title}`, p)
      else localStorage.removeItem(`chartPeriod_sektoren_${title}`)
    } catch {}
  }
  const prevGlobalPeriodRef = useRef(globalPeriod)
  useEffect(() => {
    if (prevGlobalPeriodRef.current === globalPeriod) return
    prevGlobalPeriodRef.current = globalPeriod
    setLocalPeriod(null)
  }, [globalPeriod])

  const activeBtn = localPeriod ?? globalPeriod
  const displayData = localPeriod ? applyLocalPeriod(allData ?? data, localPeriod) : data

  const [localChartType, setLocalChartTypeRaw] = useState(() => {
    try { return localStorage.getItem(`chartType_sektoren_${title}`) || null } catch { return null }
  })
  const setLocalChartType = (ct) => {
    setLocalChartTypeRaw(ct)
    try {
      if (ct) localStorage.setItem(`chartType_sektoren_${title}`, ct)
      else localStorage.removeItem(`chartType_sektoren_${title}`)
    } catch {}
  }
  const prevGlobalChartTypeRef = useRef(chartType)
  useEffect(() => {
    if (prevGlobalChartTypeRef.current === chartType) return
    prevGlobalChartTypeRef.current = chartType
    setLocalChartType(null)
  }, [chartType])
  const effectiveChartType = localChartType ?? chartType

  // ── Legend mode (Letzter Wert / Delta) ──────────────────────────────────
  const [legendMode, setLegendModeRaw] = useState(() => {
    try { return localStorage.getItem(`legendMode_sektoren_${title}`) || 'value' } catch { return 'value' }
  })
  const setLegendMode = (m) => {
    setLegendModeRaw(m)
    try { localStorage.setItem(`legendMode_sektoren_${title}`, m) } catch {}
  }

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
      {['MtD', 'YtD', '1Y', '3Y', '7Y', 'All'].map(p => (
        <button
          key={p}
          className={`chart-period-btn${activeBtn === p ? ' active' : ''}`}
          onClick={() => setLocalPeriod(p)}
        >{p}</button>
      ))}
    </div>
  )

  // Export item shared between PPTX / XLSX
  const exportItem = useMemo(() => {
    // Pre-compute Balken (range-bar) data for export when effectiveChartType === 'Bar'
    let balkenData
    if (effectiveChartType === 'Bar') {
      balkenData = series
        .map((name, idx) => {
          const vals = displayData.map(r => r[name]).filter(v => v != null && !Number.isNaN(v))
          if (!vals.length) return null
          const min = Math.min(...vals)
          const max = Math.max(...vals)
          const current = displayData[displayData.length - 1]?.[name] ?? vals[vals.length - 1]
          const color = resolveColor(name, colors, idx)
          return { name, spacer: min, range: max - min, current, min, max, color }
        })
        .filter(Boolean)
    }
    const periodLabel = activeBtn || 'All'
    const ctLabel     = effectiveChartType === 'Bar' ? 'Balken' : 'Linie'
    return {
      id:         `sektoren-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${periodLabel.toLowerCase()}-${effectiveChartType.toLowerCase()}`,
      title:      `${title} (${periodLabel}, ${ctLabel})`,
      pptx_title: title,
      subheading: getDateRange(displayData),
      yAxisLabel,
      source:     'Quelle: Bloomberg Finance L.P.',
      tab,
      chartData:  displayData,
      regions:    series,
      xKey:       'DatePoint',
      chartType:  effectiveChartType,
      balkenData,
    }
  }, [title, displayData, series, tab, yAxisLabel, effectiveChartType, colors, activeBtn])

  // ── Bar chart data preparation ───────────────────────────────────────────
  const barData = useMemo(() => {
    if (effectiveChartType !== 'Bar') return []
    return series.map((name, idx) => {
      const vals = displayData.map(r => r[name]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const last = displayData[displayData.length - 1]
      const current = last?.[name] ?? vals[vals.length - 1]
      const color = resolveColor(name, colors, idx)
      const shortName = name.length > 28 ? name.slice(0, 26) + '…' : name
      return {
        fullName: name,
        name:     shortName,
        spacer:   min,         // transparent base
        range:    max - min,   // colored range
        current,
        median,
        min,
        max,
        color,
      }
    })
    .filter(Boolean)
    .sort((a, b) =>
      isComparison
        ? a.fullName.localeCompare(b.fullName, 'de')   // alphabetical by full series name
        : b.current - a.current                         // default: current value desc
    )
  }, [effectiveChartType, isComparison, displayData, series, colors])

  // ── Smart Y-axis scale: log when all values > 0, linear when negatives present ──
  const yAxisScale = useMemo(() => {
    if (effectiveChartType !== 'Line' || !displayData.length || !series.length) return 'linear'
    for (const row of displayData) {
      for (const s of series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v) && v <= 0) return 'linear'
      }
    }
    return 'log'
  }, [displayData, series, effectiveChartType])

  // ── Smart linear Y-domain: percentile-based clipping to suppress extreme outliers ──
  const yDomain = useMemo(() => {
    if (yAxisScale !== 'linear' || effectiveChartType !== 'Line' || !displayData.length || !series.length) return null
    const allVals = []
    for (const row of displayData) {
      for (const s of series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v)) allVals.push(v)
      }
    }
    if (allVals.length < 20) return null
    allVals.sort((a, b) => a - b)
    const n = allVals.length
    // Use 1st / 99th percentile as the outer fence for detecting genuine extreme outliers
    const p01 = allVals[Math.max(0, Math.floor(n * 0.01))]
    const p99 = allVals[Math.min(n - 1, Math.floor(n * 0.99))]
    const range = p99 - p01
    if (range <= 0) return null
    const lo = p01 - range * 0.1
    const hi = p99 + range * 0.1
    // Only apply when genuine extreme outliers actually exist beyond the fence
    if (allVals[0] >= lo && allVals[n - 1] <= hi) return null
    const pad = range * 0.05
    return [lo - pad, hi + pad]
  }, [yAxisScale, effectiveChartType, displayData, series])
  // ── Sort series by latest value (high to low) for line chart legend ──────
  const sortedSeriesForLine = useMemo(() => {
    if (!displayData.length || !series.length) return series.map((name, i) => ({ name, i }))
    return series
      .map((name, i) => ({ name, i }))
      .sort((a, b) => {
        if (legendMode === 'delta') {
          const firstA = getFirstValueForSeries(displayData, a.name)
          const lastA  = getLatestValueForSeries(displayData, a.name)
          const firstB = getFirstValueForSeries(displayData, b.name)
          const lastB  = getLatestValueForSeries(displayData, b.name)
          const dA = (firstA != null && lastA != null) ? (lastA - firstA) : -Infinity
          const dB = (firstB != null && lastB != null) ? (lastB - firstB) : -Infinity
          return dB - dA
        }
        const latestA = getLatestValueForSeries(displayData, a.name) ?? -Infinity
        const latestB = getLatestValueForSeries(displayData, b.name) ?? -Infinity
        return latestB - latestA
      })
  }, [displayData, series, legendMode])
  // (yAxisWidth removed – bar charts are now vertical so label length doesn't affect Y-axis)

  // ── Chart height split ───────────────────────────────────────────────────
  const innerHeight = height - 56  // subtract header + buttons

  // ── Line chart ────────────────────────────────────────────────────────────
  const lineChart = (
    <LineChart data={displayData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
      <CartesianGrid stroke="var(--border-color, #e5e7eb)" strokeDasharray="3 3" />
      <XAxis
        dataKey="DatePoint"
        tick={{ fontSize: 11 }}
        tickFormatter={smartDateFormatter}
        interval={smartInterval}
      />
      <YAxis
        tick={{ fontSize: 11 }}
        width={52}
        scale={yAxisScale}
        domain={
          yAxisScale === 'log'
            ? ['auto', 'auto']
            : yDomain
              ? yDomain
              : [undefined, undefined]
        }
        allowDataOverflow={yDomain != null}
        tickFormatter={v => typeof v === 'number' ? Math.round(v) : v}
      />
      <Tooltip content={<LineTooltip />} />
      <Legend
        content={({ payload }) => {
          if (!payload || payload.length === 0) return null
          return (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px', fontSize: 11, paddingTop: 4, paddingLeft: 8, paddingRight: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', flex: 1, minWidth: 0 }}>
                {payload.map((entry, i) => {
                  const name = entry.value
                  let label
                  if (legendMode === 'delta') {
                    const firstVal = getFirstValueForSeries(displayData, name)
                    const lastVal  = getLatestValueForSeries(displayData, name)
                    if (firstVal != null && lastVal != null) {
                      const delta = lastVal - firstVal
                      const arrow = delta > 0.0001 ? '▲' : delta < -0.0001 ? '▼' : '→'
                      label = `${name} (${arrow} ${Math.abs(delta).toFixed(1)})`
                    } else {
                      label = name
                    }
                  } else {
                    const latestVal = getLatestValueForSeries(displayData, name)
                    label = `${name} (${latestVal != null ? latestVal.toFixed(1) : '—'})`
                  }
                  return (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="4" style={{ flexShrink: 0 }}><line x1="0" y1="2" x2="16" y2="2" stroke={entry.color} strokeWidth="2" /></svg>
                      <span style={{ color: 'var(--text-primary)' }}>{label}</span>
                    </span>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                <button className={`chart-period-btn${legendMode === 'value' ? ' active' : ''}`} onClick={() => setLegendMode('value')}>Letzter Wert</button>
                <button className={`chart-period-btn${legendMode === 'delta' ? ' active' : ''}`} onClick={() => setLegendMode('delta')}>Delta</button>
              </div>
            </div>
          )
        }}
      />
      {sortedSeriesForLine.map(({ name, i }) => (
        <Line
          key={name}
          type="monotone"
          dataKey={name}
          stroke={resolveColor(name, colors, i)}
          strokeWidth={lineWidth}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  )

  // ── Comparison bar chart removed – comparison view reuses barChart with alphabetical sort ──

  // ── Bar chart (vertical columns) ─────────────────────────────────────────────────
  const barChart = (
    <ComposedChart
      data={barData}
      margin={{ top: 8, right: 16, left: 0, bottom: 90 }}
    >
      <CartesianGrid vertical={false} stroke="var(--border-color, #e5e7eb)" strokeDasharray="3 3" />
      <XAxis
        dataKey="name"
        tick={{ fontSize: 10 }}
        angle={-40}
        textAnchor="end"
        interval={0}
        height={90}
      />
      <YAxis
        tick={{ fontSize: 11 }}
        width={48}
        domain={fixedYDomain ? [fixedYDomain[0], fixedYDomain[1]] : ['auto', 'auto']}
        tickFormatter={v => typeof v === 'number' ? Math.round(v) : v}
      />
      <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />

      {/* Transparent spacer from 0 → min */}
      <Bar dataKey="spacer" stackId="r" fill="transparent" isAnimationActive={false} />

      {/* Colored range from min → max */}
      <Bar dataKey="range" stackId="r" isAnimationActive={false} radius={[3, 3, 0, 0]}>
        {barData.map(d => (
          <Cell key={d.fullName} fill={d.color} fillOpacity={0.6} />
        ))}
      </Bar>

      {/* Current value: rendered as a dotted line with zero stroke (dot-only trick) */}
      <Line
        dataKey="current"
        stroke="none"
        strokeWidth={0}
        dot={(dotProps) => {
          const { cx, cy, payload } = dotProps
          if (cx == null || cy == null) return null
          return (
            <circle
              key={payload.fullName}
              cx={cx}
              cy={cy}
              r={6}
              fill="white"
              stroke={payload.color}
              strokeWidth={2}
            />
          )
        }}
        activeDot={false}
        legendType="none"
        isAnimationActive={false}
      />

      {/* Median value: small horizontal tick inside the bar */}
      <Line
        dataKey="median"
        stroke="none"
        strokeWidth={0}
        dot={(dotProps) => {
          const { cx, cy, payload } = dotProps
          if (cx == null || cy == null) return null
          return (
            <rect
              key={`med-${payload.fullName}`}
              x={cx - 14}
              y={cy - 2}
              width={28}
              height={4}
              fill={payload.color}
              fillOpacity={0.95}
              rx={1}
            />
          )
        }}
        activeDot={false}
        legendType="none"
        isAnimationActive={false}
      />
    </ComposedChart>
  )

  return (
    <div className="sektoren-chart" style={{ height }}>
      {/* Title + chart type + period buttons */}
      <div className="chart-header" style={{ marginBottom: '0.5rem' }}>
        <div className="sektoren-chart-title" style={{ margin: 0 }}>{title}</div>
        {chartTypeButtons}
        {periodButtons}
      </div>

      {/* Chart area */}
      <div style={{ height: innerHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          {effectiveChartType === 'Bar' ? barChart : lineChart}
        </ResponsiveContainer>
      </div>

      {/* Export buttons */}
      <div className="chart-export-buttons">
        <button
          className="chart-export-btn pptx"
          title="Zu PowerPoint hinzufügen"
          onClick={() => withDataGapWarning(addToPptx, displayData, series)(exportItem)}
        >
          <PowerPointIcon width={26} height={26} />
        </button>
        <button
          className="chart-export-btn xlsx"
          title="Zu Excel hinzufügen"
          onClick={() => withDataGapWarning(addToXlsx, displayData, series)(exportItem)}
        >
          <ExcelIcon width={26} height={26} />
        </button>
        {displayData[displayData.length - 1]?.DatePoint && (
          <span className="chart-export-date">Aktualität: {displayData[displayData.length - 1].DatePoint.split('T')[0]}, Bloomberg Finance L.P.</span>
        )}
      </div>
    </div>
  )
}
