/**
 * SektorenChart – Sector PE Ratio Chart Component
 *
 * Renders either:
 *   Line mode – one colored line per sector / series over time
 *   Bar  mode – horizontal range bar (min → max) with current-value dot overlay per series
 *
 * Includes PPTX and XLSX export buttons via ExportContext (same pattern as FaktorenChart).
 */

import { useMemo } from 'react'
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
import './Charts.css'
import './SektorenChart.css'

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
 * Props:
 *   title     {string}   Chart title
 *   data      {Array}    Wide rows: [{DatePoint, SeriesName: value, ...}]
 *   series    {string[]} Ordered series names
 *   colors    {object}   {seriesName: hexColor} – from backend
 *   chartType {string}   'Line' | 'Bar'
 *   height    {number}   Total height in px
 *   tab       {string}   Tab label for export metadata
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
}) {
  const { addToPptx, addToXlsx } = useExport()

  // Export item shared between PPTX / XLSX
  const exportItem = useMemo(() => ({
    id:        `sektoren-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    pptx_title: title,
    subheading: getDateRange(data),
    source:     'Bloomberg Finance L.P.',
    tab,
    chartData:  data,
    regions:    series,
    xKey:       'DatePoint',
  }), [title, data, series, tab])

  // ── Bar chart data preparation ───────────────────────────────────────────
  const barData = useMemo(() => {
    if (chartType !== 'Bar') return []
    return series.map((name, idx) => {
      const vals = data.map(r => r[name]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const last = data[data.length - 1]
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
  }, [chartType, isComparison, data, series, colors])

  // ── Smart Y-axis scale: log when all values > 0, linear when negatives present ──
  const yAxisScale = useMemo(() => {
    if (chartType !== 'Line' || !data.length || !series.length) return 'linear'
    for (const row of data) {
      for (const s of series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v) && v <= 0) return 'linear'
      }
    }
    return 'log'
  }, [data, series, chartType])

  // ── Smart linear Y-domain: IQR-based clipping to suppress extreme outliers ──
  const yDomain = useMemo(() => {
    if (yAxisScale !== 'linear' || chartType !== 'Line' || !data.length || !series.length) return null
    const allVals = []
    for (const row of data) {
      for (const s of series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v)) allVals.push(v)
      }
    }
    if (allVals.length < 8) return null
    allVals.sort((a, b) => a - b)
    const n = allVals.length
    const q1 = allVals[Math.floor(n * 0.25)]
    const q3 = allVals[Math.floor(n * 0.75)]
    const iqr = q3 - q1
    if (iqr <= 0) return null
    const lo = q1 - 3 * iqr
    const hi = q3 + 3 * iqr
    // Only apply clipping when extreme outliers actually fall outside the IQR fence
    if (allVals[0] >= lo && allVals[n - 1] <= hi) return null
    const pad = (hi - lo) * 0.05
    return [lo - pad, hi + pad]
  }, [yAxisScale, chartType, data, series])

  // (yAxisWidth removed – bar charts are now vertical so label length doesn't affect Y-axis)

  // ── Chart height split ───────────────────────────────────────────────────
  const innerHeight = height - 56  // subtract header + buttons

  // ── Line chart ────────────────────────────────────────────────────────────
  const lineChart = (
    <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
      <CartesianGrid stroke="var(--border-color, #e5e7eb)" strokeDasharray="3 3" />
      <XAxis
        dataKey="DatePoint"
        tick={{ fontSize: 11 }}
        tickFormatter={v => {
          try { return new Date(v).toLocaleDateString('de-DE', { month: '2-digit', year: '2-digit' }) }
          catch { return v }
        }}
        minTickGap={40}
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
        tickFormatter={v => typeof v === 'number' ? (v >= 100 ? Math.round(v) : v % 1 === 0 ? v : v.toFixed(1)) : v}
      />
      <Tooltip content={<LineTooltip />} />
      <Legend
        wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
        iconType="plainline"
        iconSize={16}
      />
      {series.map((name, i) => (
        <Line
          key={name}
          type="monotone"
          dataKey={name}
          stroke={resolveColor(name, colors, i)}
          strokeWidth={1.5}
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
        tickFormatter={v => typeof v === 'number' ? (v >= 100 ? Math.round(v) : v % 1 === 0 ? v : v.toFixed(1)) : v}
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
    </ComposedChart>
  )

  return (
    <div className="sektoren-chart" style={{ height }}>
      {/* Title */}
      <div className="sektoren-chart-title">{title}</div>

      {/* Chart area */}
      <div style={{ height: innerHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'Bar' ? barChart : lineChart}
        </ResponsiveContainer>
      </div>

      {/* Export buttons */}
      <div className="chart-export-buttons">
        <button
          className="chart-export-btn pptx"
          title="Zu PowerPoint hinzufügen"
          onClick={() => addToPptx(exportItem)}
        >
          PPT
        </button>
        <button
          className="chart-export-btn xlsx"
          title="Zu Excel hinzufügen"
          onClick={() => addToXlsx(exportItem)}
        >
          XLS
        </button>
      </div>
    </div>
  )
}
