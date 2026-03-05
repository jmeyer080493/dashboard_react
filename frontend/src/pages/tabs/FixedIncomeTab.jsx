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
import {
  getFIMetricLabel,
  FI_STANDARD_DEFAULTS,
} from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
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

/** Short date label for chart axes */
function fmtDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d)) return isoStr.slice(0, 10)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

/**
 * Multi-Region Line Chart for a single FI metric.
 */
function FILineChart({ chartData, regions, metricLabel, unit = '', height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }
  const formatter = (value) => {
    if (typeof value !== 'number') return value
    return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
  }

  const fullTitle = `Anleihen – ${metricLabel}`
  const exportItem = { id: makeId(fullTitle), title: fullTitle, pptx_title: metricLabel, subheading: getDateRange(chartData, 'DatePoint'), tab: 'Anleihen', chartData, regions, xKey: 'DatePoint' }

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
            formatter={formatter}
            labelFormatter={fmtDate}
          />
          <Legend />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
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
  const allRecords = data.data

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

  // Use selections if provided, otherwise fall back to standard defaults
  const tableColumns = (selectedMetricsTable.length > 0
    ? selectedMetricsTable
    : FI_STANDARD_DEFAULTS.table
  ).filter((c) => availableMetrics.includes(c))

  const graphMetrics = (selectedMetricsGraph.length > 0
    ? selectedMetricsGraph
    : FI_STANDARD_DEFAULTS.graph
  ).filter((m) => availableMetrics.includes(m))

  return (
    <div className="fixed-income-tab">
      {/* Tab header */}
      <div className="tab-header">
        <h2>Anleihen – Fixed Income</h2>
        <p className="sub-title">
          Regionen: {regions.join(', ')} | Zeitraum: {filters.lookback}
        </p>
      </div>

      {/* Metadata row */}
      <div className="metadata">
        <span>Datensätze: {data.metadata?.record_count ?? 0}</span>
        <span>Metriken: {availableMetrics.length}</span>
        <span>Aktualisiert: {new Date().toLocaleDateString('de-DE')}</span>
      </div>

      {/* Latest Values Table */}
      <MetricsTable
        data={allRecords}
        regions={regions}
        columns={tableColumns}
        formatValue={(value, metricKey) => formatFIValue(value, metricKey)}
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
          graphMetrics.map((metric) => (
            <FILineChart
              key={metric}
              chartData={pivotDataForChart(filteredRecords, metric, regions)}
              regions={regions}
              metricLabel={getFIMetricLabel(metric)}
              unit={getUnit(metric)}
              height={chartHeight}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default FixedIncomeTab
