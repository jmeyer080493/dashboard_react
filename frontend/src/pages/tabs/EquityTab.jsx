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
} from 'recharts'
import { MetricsTable } from '../../components/MetricsTable'
import { getMetricLabel, getYAxisLabel, isEquityMetricCurrencyAffected, EQUITY_METRICS_CATEGORIES } from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
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

/** Short date label for chart axes - smart formatting */
function fmtDate(isoStr, isLongTimeseries = false) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d)) return isoStr.slice(0, 10)
  if (isLongTimeseries) {
    // For long series (>6 months): "Mrz. 25" format
    return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })
  } else {
    // For short series: "31. Mrz" (month-end format)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
  }
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

/** Format a value for legend display: 0 decimals, German locale */
function fmtLegendValue(val) {
  if (val === null || val === undefined || typeof val !== 'number') return null
  return Math.round(val).toLocaleString('de-DE')
}

/**
 * Multi-Region Line Chart for a single equity metric.
 */
function EquityLineChart({ chartData, regions, metricLabel, metricKey, yAxisLabel = '', currency = 'EUR', height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()

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
    tab: 'Aktien',
    chartData,
    regions: activeRegions,
    xKey: 'DatePoint',
  }

  return (
    <div className="chart-container">
      <h3>{metricLabel}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="DatePoint"
            tick={{ fontSize: 11 }}
            tickFormatter={(isoStr) => fmtDate(isoStr, isLongSeries)}
            interval="preserveStartEnd"
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
            labelFormatter={fmtDate}
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
              const lastRow = chartData[chartData.length - 1] || {}
              return (lastRow[b] ?? -Infinity) - (lastRow[a] ?? -Infinity)
            })
            .map((region) => {
            const latest = fmtLegendValue(chartData[chartData.length - 1]?.[region])
            const legendName = latest !== null ? `${region} (${latest})` : region
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
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
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
  )

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
              currency={currency}
              height={chartHeight}
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
