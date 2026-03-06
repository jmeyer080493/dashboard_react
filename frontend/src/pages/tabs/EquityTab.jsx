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
import { getMetricLabel, EQUITY_METRICS_CATEGORIES } from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
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

/** Short date label for chart axes */
function fmtDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d)) return isoStr.slice(0, 10)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

/**
 * Multi-Region Line Chart for a single equity metric.
 */
function EquityLineChart({ chartData, regions, metricLabel, metricKey, height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  const isRSI = metricKey && metricKey.includes('RSI')

  const fullTitle = `Aktien – ${metricLabel}`
  const exportItem = {
    id: makeId(fullTitle),
    title: fullTitle,
    pptx_title: metricLabel,
    subheading: getDateRange(chartData, 'DatePoint'),
    tab: 'Aktien',
    chartData,
    regions,
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
            tickFormatter={fmtDate}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11 }} />
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
          {regions.map((region, idx) => (
            <Line
              key={region}
              type="monotone"
              dataKey={region}
              name={region}
              stroke={REGION_COLORS[idx % REGION_COLORS.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen">📊 PPTX</button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen">📗 Excel</button>
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
