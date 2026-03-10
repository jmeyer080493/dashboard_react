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
import {
  getFIMetricLabel,
  getFIYAxisLabel,
  getFIMetricUnit,
  getSmartDateFormat,
  FI_STANDARD_DEFAULTS,
  FI_METRICS_CATEGORIES,
} from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
import { withDataGapWarning } from '../../utils/exportWarnings'
import { ExcelIcon, PowerPointIcon } from '../../icons/MicrosoftIcons'
import './TabStyles.css'

/** Produce a stable string ID from a chart title */
function makeId(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Build a German-formatted date range string from chartData, e.g. "01.01.2020 – 31.12.2024" */
function getDateRange(chartData, xKey) {
  if (!chartData || chartData.length === 0) return ''
  const dates = chartData.map(r => r[xKey]).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}
const REGION_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

/**
 * Pivot raw FI records (one row per DatePoint × Region) so that each DatePoint
 * maps to one object with one key per region for a given metric.
 *
 * Input:  [{DatePoint, Regions:'Germany', '10Y Yields':2.5, ...}, ...]
 * Output: [{DatePoint:'2024-01-01', Germany:2.5, France:3.1, ...}, ...]
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

/** Return unit string for an FI metric key */
function getUnit(metricKey) {
  if (metricKey.includes('CDS')) return 'bp'
  if (
    metricKey.includes('Yields') ||
    metricKey.includes('Steepness') ||
    metricKey.includes('Curvature') ||
    metricKey.includes('Spreads') ||
    metricKey.includes('Expectations') ||
    metricKey.includes('Breakevens')
  ) return '%'
  return ''
}

/** Format a numeric FI value with appropriate precision and unit */
function formatFIValue(value, metricKey) {
  if (value === null || value === undefined) return '–'
  if (typeof value !== 'number') return String(value)
  const unit = getUnit(metricKey || '')
  return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
}

/** Format Y-axis values: 0 decimals */
function formatYValue(value) {
  if (typeof value !== 'number') return value
  return String(Math.round(value))
}

/** Check if time series is longer than 6 months for smart formatting */
function isLongTimeseries(chartData) {
  if (!chartData || chartData.length < 2) return false
  const dates = chartData.map(r => r.DatePoint).filter(d => d).sort()
  if (dates.length < 2) return false
  const firstDate = new Date(dates[0])
  const lastDate = new Date(dates[dates.length - 1])
  const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
                     (lastDate.getMonth() - firstDate.getMonth())
  return monthsDiff > 6
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

/**
 * Custom tooltip for range bar chart
 */
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
      <p style={{ margin: '2px 0', color: '#888' }}>Max: {d.max != null ? d.max.toFixed(2) : '—'}</p>
    </div>
  )
}

/**
 * Multi-Region Line Chart for a single FI metric.
 */
function FILineChart({ chartData, regions, metricLabel, yAxisLabel = '', unit = '', height = 300, chartType = 'Line' }) {
  const { addToPptx, addToXlsx } = useExport()
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(chartData)

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Only render lines for regions that actually have at least one data point
  const activeRegions = regions.filter(r => chartData.some(d => d[r] !== undefined && d[r] !== null))

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  const [yMin, yMax] = computeSmartDomain(chartData, activeRegions)
  const isLongSeries = isLongTimeseries(chartData)
  
  // Compute even interval spacing for y-axis
  let yDomain = ['auto', 'auto']
  if (yMin !== undefined && yMax !== undefined) {
    const range = yMax - yMin
    const step = Math.pow(10, Math.floor(Math.log10(range)))
    const roundedMin = Math.floor(yMin / step) * step
    const roundedMax = Math.ceil(yMax / step) * step
    yDomain = [roundedMin, roundedMax]
  }
  
  const formatter = (value) => {
    if (typeof value !== 'number') return value
    return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
  }

  const dateRange = getDateRange(chartData, 'DatePoint')
  const subheading = dateRange

  const fullTitle = `Anleihen – ${metricLabel}`
  const exportItem = { id: makeId(fullTitle), title: fullTitle, pptx_title: metricLabel, subheading, yAxisLabel, source: 'Quelle: Bloomberg Finance L.P.', tab: 'Anleihen', chartData, regions: activeRegions, xKey: 'DatePoint' }

  // Build range-bar data (one entry per region: min/max/median/current)
  const barData = activeRegions
    .map((region) => {
      const vals = chartData.map(r => r[region]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const current = getLatestValueForRegion(chartData, region)
      return { name: region, spacer: min, range: max - min, current, median, min, max, color: REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length] }
    })
    .filter(Boolean)
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))

  // Attach Balken-specific export fields
  exportItem.chartType = chartType
  exportItem.balkenData = chartType === 'Bar' ? barData : undefined

  return (
    <div className="chart-container">
      <h3>{metricLabel}</h3>
      <ResponsiveContainer width="100%" height={height}>
        {chartType === 'Bar' ? (
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
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="DatePoint"
              tick={{ fontSize: 11 }}
              tickFormatter={(isoStr) => fmtDate(isoStr, smartDateFormatter)}
              interval={smartInterval}
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              domain={yDomain}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
              formatter={formatter}
              labelFormatter={(label) => fmtDate(label, smartDateFormatter)}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            {[...activeRegions]
              .sort((a, b) => {
                const latestA = getLatestValueForRegion(chartData, a) ?? -Infinity
                const latestB = getLatestValueForRegion(chartData, b) ?? -Infinity
                return latestB - latestA
              })
              .map((region) => {
              const latestValue = getLatestValueForRegion(chartData, region)
              const formatted = fmtLegendValue(latestValue, unit)
              const legendName = formatted !== null ? `${region} (${formatted})` : region
              return (
                <Line
                  key={region}
                  type="monotone"
                  dataKey={region}
                  name={legendName}
                  stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                  connectNulls
                />
              )
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => withDataGapWarning(addToPptx, chartData, activeRegions)(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => withDataGapWarning(addToXlsx, chartData, activeRegions)(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {chartData[chartData.length - 1]?.DatePoint && (
          <span className="chart-export-date">Letztes Datum: {chartData[chartData.length - 1].DatePoint.split('T')[0]}</span>
        )}
      </div>
    </div>
  )
}
// Yield curve column order (maturity periods available in v3 FI data)
const YIELD_CURVE_PERIODS = [
  { col: '2Y Yields',  label: '2J' },
  { col: '5Y Yields',  label: '5J' },
  { col: '10Y Yields', label: '10J' },
  { col: '20Y Yields', label: '20J' },
  { col: '30Y Yields', label: '30J' },
]

/**
 * Yield Curve chart — cross-sectional snapshot for the latest date,
 * one line per selected region, X = maturity period, Y = yield in %.
 */
function KurveChart({ regions, allRecords, height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!allRecords || allRecords.length === 0) {
    return (
      <div className="chart-container">
        <h3>Zinskurve</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Find the latest DatePoint that has yield data
  const latestByRegion = {}
  for (const row of allRecords) {
    if (!row.DatePoint || !regions.includes(row.Regions)) continue
    const hasYields = YIELD_CURVE_PERIODS.some(p => row[p.col] != null)
    if (!hasYields) continue
    if (!latestByRegion[row.Regions] || row.DatePoint > latestByRegion[row.Regions].DatePoint) {
      latestByRegion[row.Regions] = row
    }
  }

  // Build chart-friendly data: one object per period with region keys
  const chartData = YIELD_CURVE_PERIODS.map(({ col, label }) => {
    const point = { period: label }
    for (const region of regions) {
      const row = latestByRegion[region]
      if (row && row[col] != null) point[region] = row[col]
    }
    return point
  })

  // Only include regions that have at least one yield value
  const activeRegions = regions.filter(r =>
    chartData.some(d => d[r] !== undefined && d[r] !== null)
  )

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <h3>Zinskurve</h3>
        <div className="chart-empty">Keine Renditedaten für die ausgewählten Länder</div>
      </div>
    )
  }

  const latestDateStr = Object.values(latestByRegion)
    .map(r => r.DatePoint)
    .sort()
    .pop()
  const latestDateFmt = latestDateStr
    ? new Date(latestDateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : ''

  const exportItem = {
    id: 'yield-curve',
    title: 'Anleihen – Zinskurve',
    pptx_title: 'Zinskurve',
    subheading: latestDateFmt,
    yAxisLabel: '%',
    source: 'Quelle: Bloomberg Finance L.P.',
    tab: 'Anleihen',
    chartData,
    regions: activeRegions,
    xKey: 'period',
  }

  return (
    <div className="chart-container">
      <h3>Zinskurve</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={v => `${v.toFixed(1)}`}
            width={44}
            label={{ value: '%', angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
            formatter={(value, name) => [`${value?.toFixed(2)} %`, name]}
          />
          <Legend />
          {activeRegions.map((region) => (
            <Line
              key={region}
              type="monotone"
              dataKey={region}
              stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
              strokeWidth={2.5}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {latestDateFmt && (
          <span className="chart-export-date">Letztes Datum: {latestDateStr?.split('T')[0]}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Fixed Income Tab Component
 *
 * Displays bond market signals: yield curves, CDS spreads, inflation expectations, etc.
 * - MetricsTable: latest values per region, filtered by selectedMetricsTable
 * - Line charts: one per selected graph metric, all regions on the same chart
 *
 * Data is pre-fetched by the parent <Länder> component and filtered here by date range.
 */
function FixedIncomeTab({
  filters,
  data,
  loading,
  error,
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  chartsPerRow = 2,
  chartHeight = 300,
  chartType = 'Line',
  ratingsData = [],
}) {
  if (loading) {
    return <div className="tab-loading">📊 Laden…</div>
  }
  if (error) {
    return <div className="tab-error">❌ Fehler: {error}</div>
  }
  if (!data || !data.data) {
    return <div className="tab-empty">Keine Daten verfügbar</div>
  }

  const regions = filters.regions || []
  // Inject SP rating into every record so MetricsTable can display it.
  // We always inject (null when not found) so the column is stable even before
  // ratingsData has loaded – it will show '–' and fill in once data arrives.
  const spByRegion = Object.fromEntries(
    ratingsData.filter(r => r.Regions).map(r => [r.Regions, r.SP ?? null])
  )
  const allRecords = (data.data || []).map(r => ({ ...r, SP: spByRegion[r.Regions] ?? null }))

  // Apply date-range filter for charts
  const filteredRecords = allRecords.filter((r) => {
    if (!r.DatePoint) return false
    const d = new Date(r.DatePoint)
    if (filters.startDate && d < new Date(filters.startDate)) return false
    if (filters.endDate   && d > new Date(filters.endDate))   return false
    return true
  })

  // Determine which metrics are actually present in the API response
  const availableMetrics =
    allRecords.length > 0
      ? Object.keys(allRecords[0]).filter(
          (k) => !['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name'].includes(k)
        )
      : []

  // Special metrics rendered by dedicated components (not dependent on availableMetrics)
  const SPECIAL_METRICS = new Set(['Kurve'])

  // Use selections if provided, otherwise fall back to standard defaults
  const tableColumns = (selectedMetricsTable.length > 0
    ? selectedMetricsTable
    : FI_STANDARD_DEFAULTS.table
  ).filter((c) => availableMetrics.includes(c))

  const graphMetrics = (selectedMetricsGraph.length > 0
    ? selectedMetricsGraph
    : FI_STANDARD_DEFAULTS.graph
  ).filter((m) => SPECIAL_METRICS.has(m) || availableMetrics.includes(m))

  return (
    <div className="fixed-income-tab">
      {/* Latest Values Table */}
      <MetricsTable
        data={allRecords}
        regions={regions}
        columns={tableColumns}
        categories={FI_METRICS_CATEGORIES}
        lookback={filters.lookback}
        tabLabel="Anleihen"
      />

      {/* Charts – one per selected graph metric */}
      <div
        className="chart-grid"
        style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
      >
        {graphMetrics.length === 0 ? (
          <div className="chart-empty">
            Keine Grafik-Metriken ausgewählt – bitte nutzen Sie „🔧 Datenfelder Filtern“.
          </div>
        ) : (
          graphMetrics.map((metric) => {
            if (metric === 'Kurve') {
              return (
                <KurveChart
                  key="Kurve"
                  regions={regions}
                  allRecords={allRecords}
                  height={chartHeight}
                />
              )
            }
            return (
              <FILineChart
                key={metric}
                chartData={pivotDataForChart(filteredRecords, metric, regions)}
                regions={regions}
                metricLabel={getFIMetricLabel(metric)}
                yAxisLabel={getFIYAxisLabel(metric)}
                unit={getFIMetricUnit(metric)}
                height={chartHeight}
                chartType={chartType}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export default FixedIncomeTab
