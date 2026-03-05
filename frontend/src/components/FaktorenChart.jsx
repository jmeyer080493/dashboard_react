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

import {
  LineChart,
  Line,
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
import './Charts.css'
import './FaktorenChart.css'

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
 *   'M'    → "34.1M"
 *   'B'    → "1.23B"
 *   'raw'  → "42.00"
 */
function buildFmt(yUnit) {
  switch (yUnit) {
    case 'M':   return v => (v == null ? '—' : `${(v / 1e6).toFixed(1)}M`)
    case 'B':   return v => (v == null ? '—' : `${(v / 1e9).toFixed(2)}B`)
    case 'raw': return v => (v == null ? '—' : typeof v === 'number' ? v.toFixed(2) : String(v))
    default:    return v => (v == null ? '—' : `${v.toFixed(2)} %`)  // 'pct'
  }
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
}) {
  const { addToPptx, addToXlsx } = useExport()

  if (!data || data.length === 0) {
    return (
      <div className="chart-container faktoren-chart">
        {title && <h3 className="faktoren-chart-title">{title}</h3>}
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // The main series = all series except "Difference"
  const mainSeries = series.filter(s => s !== 'Difference')

  // Export: include all columns (the consumer will flatten them)
  const fullTitle   = tab ? `${tab} – ${title}` : title
  const exportItem  = {
    id:         makeId(fullTitle),
    title:      fullTitle,
    pptx_title: title,
    subheading: getDateRange(data),
    tab,
    chartData:  data,
    regions:    mainSeries,
    xKey:       'DatePoint',
  }

  const mainHeight = hasDifference ? Math.round(height * 0.70) : height
  const diffHeight = hasDifference ? height - mainHeight - 8 : 0

  // Build formatter and axis config from yUnit
  const fmtValue = buildFmt(yUnit)
  const yAxisWidth = yUnit === 'B' ? 72 : yUnit === 'M' ? 64 : 52
  const yAxisTickFmt = (v) => {
    if (yUnit === 'M') return `${(v / 1e6).toFixed(1)}M`
    if (yUnit === 'B') return `${(v / 1e9).toFixed(2)}B`
    if (yUnit === 'raw') return v.toFixed(1)
    return `${v.toFixed(0)} %`
  }
  // Smart domain: 5 % padding on each side so the chart never pins to 0
  const yDomain = yDomainAuto
    ? [(min) => min * 0.95, (max) => max * 1.05]
    : undefined

  // Build diff data with positiveVal / negativeVal for the filled areas
  const diffData = hasDifference
    ? data.map(row => ({
        DatePoint:    row.DatePoint,
        Difference:   row.Difference ?? null,
        positiveVal:  row.Difference > 0 ? row.Difference : 0,
        negativeVal:  row.Difference < 0 ? row.Difference : 0,
      }))
    : []

  return (
    <div className="chart-container faktoren-chart">
      {title && <h3 className="faktoren-chart-title">{title}</h3>}

      {/* ── Main line chart ──────────────────────────────────────── */}
      <ResponsiveContainer width="100%" height={mainHeight}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e0e0e0)" />
          <XAxis
            dataKey="DatePoint"
            tick={{ fontSize: 11 }}
            tickFormatter={d => {
              try { return new Date(d).toLocaleDateString('de-DE', { month: '2-digit', year: '2-digit' }) }
              catch { return d }
            }}
            minTickGap={40}
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
              const lastVal = data[data.length - 1]?.[name]
              return `${name} (${lastVal != null ? fmtValue(lastVal) : '—'})`
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
              strokeWidth={2.5}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* ── Difference sub-chart (only when hasDifference) ───────── */}
      {hasDifference && (
        <div style={{ marginTop: 4 }}>
          <ResponsiveContainer width="100%" height={diffHeight}>
            <ComposedChart data={diffData} margin={{ top: 2, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e0e0e0)" />
              <XAxis
                dataKey="DatePoint"
                tick={{ fontSize: 10 }}
                tickFormatter={d => {
                  try { return new Date(d).toLocaleDateString('de-DE', { month: '2-digit', year: '2-digit' }) }
                  catch { return d }
                }}
                minTickGap={40}
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
          onClick={() => addToPptx(exportItem)}
          title="Zu PowerPoint hinzufügen"
        >
          📊 PPTX
        </button>
        <button
          className="chart-export-btn xlsx"
          onClick={() => addToXlsx(exportItem)}
          title="Zu Excel hinzufügen"
        >
          📗 Excel
        </button>
      </div>
    </div>
  )
}
