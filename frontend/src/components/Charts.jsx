import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useExport } from '../context/ExportContext'
import { ExcelIcon, PowerPointIcon } from '../icons/MicrosoftIcons'
import { getSmartDateFormat } from '../config/metricsConfig'
import './Charts.css'

/** Produce a stable string ID from a chart title */
function makeId(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Build a German-formatted date range string from chartData, e.g. "01.01.2020 – 31.12.2024" */
function getDateRange(chartData, xKey) {
  if (!chartData || chartData.length === 0) return ''
  const dates = chartData.map(r => r[xKey]).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

/**
 * Performance Chart Component
 * Displays equity performance across multiple regions on the same chart
 * Data format: [{ DatePoint: "2024-01-01", Germany: 100, France: 102, ... }, ...]
 */
export function PerformanceChart({ data, title = 'Market Performance', tab = 'Aktien', height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!data || data.length === 0) {
    return <div className="chart-empty">Keine Daten verfügbar</div>
  }

  // Determine date key (could be 'date' or 'DatePoint')
  const dateKey = data[0]?.DatePoint ? 'DatePoint' : 'date'
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(data, dateKey)
  
  // Get unique region names from first data point, sorted by latest value (high to low)
  const regions = data[0] ? Object.keys(data[0])
    .filter(k => k !== dateKey && !k.includes('_'))
    .sort((a, b) => {
      const lastRow = data[data.length - 1] || {}
      return (lastRow[b] ?? -Infinity) - (lastRow[a] ?? -Infinity)
    }) : []
  
  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  const fullTitle = tab ? `${tab} – ${title}` : title
  const exportItem = { id: makeId(fullTitle), title: fullTitle, pptx_title: title, subheading: getDateRange(data, dateKey), tab, chartData: data, regions, xKey: dateKey }

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey={dateKey} tick={{ fontSize: 12 }} tickFormatter={(val) => smartDateFormatter(val)} interval={smartInterval} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={v => typeof v === 'number' ? Math.round(v) : v} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
            labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
          />
          <Legend
            formatter={(name, entry) => {
              const lastVal = data[data.length - 1]?.[entry.dataKey]
              return `${name} (${lastVal != null ? lastVal.toFixed(1) : '—'})`
            }}
          />
          {regions.map((region, idx) => (
            <Line
              key={region}
              type="monotone"
              dataKey={region}
              stroke={colors[idx % colors.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {data[data.length - 1]?.DatePoint && (
          <span className="chart-export-date">Aktualität: {data[data.length - 1].DatePoint.split('T')[0]}</span>
        )}
  
      </div>
    </div>
  )
}

/**
 * Single Metric Chart Component
 * Displays a single metric for one or more regions, with separate lines per region
 * Handles both single-region and multi-region data formats
 */
export function MetricChart({ data, dataKey, title, yAxisLabel = '', tab = 'Aktien', height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(data, 'DatePoint')

  if (!data || data.length === 0) {
    return <div className="chart-empty">Keine Daten verfügbar</div>
  }

  // Get the first data point to check which columns are available
  const firstDataPoint = data[0]
  
  // Find all columns that match this metric (either exact match or region_metric format)
  const metricColumns = Object.keys(firstDataPoint)
    .filter(key => {
      // Exact match (single region or backward compatibility)
      if (key === dataKey) return true
      // Region-prefixed format (Region_MetricName)
      if (key.endsWith(`_${dataKey}`)) return true
      return false
    })
    .sort((a, b) => {
      const lastRow = data[data.length - 1] || {}
      return (lastRow[b] ?? -Infinity) - (lastRow[a] ?? -Infinity)
    })
  
  // Extract region names from column keys
  const regions = metricColumns.map(col =>
    col.includes('_') ? col.split('_')[0] : col
  )

  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  const fullTitle = tab ? `${tab} – ${title || dataKey}` : (title || dataKey)
  // For export: use the actual column names (metricColumns) as regions so
  // _chartdata_to_traces can find them in the chartData rows
  const exportRegions = metricColumns.length > 0 ? metricColumns : regions
  const exportItem = { id: makeId(fullTitle), title: fullTitle, pptx_title: title, subheading: getDateRange(data, 'DatePoint'), tab, chartData: data, regions: exportRegions, xKey: 'DatePoint' }

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="DatePoint" tick={{ fontSize: 12 }} tickFormatter={(val) => smartDateFormatter(val)} interval={smartInterval} />
          <YAxis tick={{ fontSize: 12 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} tickFormatter={v => typeof v === 'number' ? Math.round(v) : v} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
            labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
          />
          <Legend
            formatter={(name, entry) => {
              const lastVal = data[data.length - 1]?.[entry.dataKey]
              return `${name} (${lastVal != null ? lastVal.toFixed(1) : '—'})`
            }}
          />
          {metricColumns.length > 0 ? (
            metricColumns.map((column, idx) => {
              // Extract region name from column (e.g., "Germany_MACD" -> "Germany")
              const regionName = column.includes('_') 
                ? column.split('_')[0]
                : 'Value'
              
              return (
                <Line
                  key={column}
                  type="monotone"
                  dataKey={column}
                  name={regionName}
                  stroke={colors[idx % colors.length]}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              )
            })
          ) : (
            // Fallback to simple line if no region-prefixed columns found
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#8b5cf6"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {data[data.length - 1]?.DatePoint && (
          <span className="chart-export-date">Aktualität: {data[data.length - 1].DatePoint.split('T')[0]}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Compare Multiple Metrics Chart
 * Displays multiple metrics on the same chart (useful for yield curves, spreads, etc.)
 */
export function ComparisonChart({ data, metrics, title, tab = '', height = 300 }) {
  const { addToPptx, addToXlsx } = useExport()
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(data, 'date')

  if (!data || data.length === 0) {
    return <div className="chart-empty">Keine Daten verfügbar</div>
  }

  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  // Sort metrics by latest value (high to low)
  const sortedMetrics = [...(metrics ?? [])].sort((a, b) => {
    const lastRow = data[data.length - 1] || {}
    return (lastRow[b] ?? -Infinity) - (lastRow[a] ?? -Infinity)
  })

  const fullTitle = tab ? `${tab} – ${title}` : title
  const exportItem = { id: makeId(fullTitle || 'chart'), title: fullTitle, pptx_title: title, subheading: getDateRange(data, 'date'), tab, chartData: data, regions: metrics ?? [], xKey: 'date' }

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(val) => smartDateFormatter(val)} interval={smartInterval} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={v => typeof v === 'number' ? Math.round(v) : v} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(4) : value}
            labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
          />
          <Legend
            formatter={(name, entry) => {
              const lastVal = data[data.length - 1]?.[entry.dataKey]
              return `${name} (${lastVal != null ? lastVal.toFixed(1) : '—'})`
            }}
          />
          {sortedMetrics.map((metric, idx) => (
            <Line
              key={metric}
              type="monotone"
              dataKey={metric}
              stroke={colors[idx % colors.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={20} height={20} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={20} height={20} /></button>
        {data[data.length - 1]?.date && (
          <span className="chart-export-date">Aktualität: {data[data.length - 1].date.split('T')[0]}</span>
        )}
      </div>
    </div>
  )
}
