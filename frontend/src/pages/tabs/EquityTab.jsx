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
import './TabStyles.css'

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
function EquityLineChart({ chartData, regions, metricLabel, metricKey, yAxisLabel = '', unit = '', currency = 'EUR', height = 300, chartType = 'Line' }) {
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

  const isRSI = metricKey && metricKey.includes('RSI')
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

  const isCurrencyAffected = isEquityMetricCurrencyAffected(metricKey)
  const dateRange = getDateRange(chartData, 'DatePoint')
  const subheading = isCurrencyAffected
    ? (dateRange ? `${dateRange}, in ${currency}` : `in ${currency}`)
    : dateRange

  const fullTitle = `Aktien – ${metricLabel}`
  const exportItem = {
    id: makeId(fullTitle),
    title: fullTitle,
    pptx_title: metricLabel,
    subheading,
    yAxisLabel,
    source: 'Quelle: Bloomberg Finance L.P.',
    tab: 'Aktien',
    chartData,
    regions: activeRegions,
    xKey: 'DatePoint',
  }

  // Build range-bar data (one entry per region: min/max/median/current)
  const barData = activeRegions
    .map((region, idx) => {
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
              formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
              labelFormatter={(label) => fmtDate(label, smartDateFormatter)}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            {isRSI && (
              <>
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" />
                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 2" />
              </>
            )}
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

  // Apply date-range filter for charts
  const filteredRecords = allRecords.filter((r) => {
    if (!r.DatePoint) return false
    const d = new Date(r.DatePoint)
    if (filters.startDate && d < new Date(filters.startDate)) return false
    if (filters.endDate   && d > new Date(filters.endDate))   return false
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
              regions={regions}
              metricLabel={getColumnTitle(column)}
              metricKey={column}
              yAxisLabel={getYAxisLabel(column)}
              unit={getEquityMetricUnit(column)}
              currency={currency}
              height={chartHeight}
              chartType={chartType}
            />
          ))
        ) : (
          <div className="chart-empty">Keine Metriken verfügbar</div>
        )}
      </div>
    </div>
  )
}

export default EquityTab
