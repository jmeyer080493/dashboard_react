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
import './Charts.css'

/**
 * Performance Chart Component
 * Displays equity performance across multiple regions on the same chart
 * Data format: [{ DatePoint: "2024-01-01", Germany: 100, France: 102, ... }, ...]
 */
export function PerformanceChart({ data, title = 'Market Performance' }) {
  if (!data || data.length === 0) {
    return <div className="chart-empty">Keine Daten verfügbar</div>
  }

  // Determine date key (could be 'date' or 'DatePoint')
  const dateKey = data[0]?.DatePoint ? 'DatePoint' : 'date'
  
  // Get unique region names from first data point (region names without underscore prefixes)
  const regions = data[0] ? Object.keys(data[0])
    .filter(k => k !== dateKey && !k.includes('_'))
    .sort() : []
  
  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey={dateKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
          />
          <Legend />
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
    </div>
  )
}

/**
 * Single Metric Chart Component
 * Displays a single metric for one or more regions, with separate lines per region
 * Handles both single-region and multi-region data formats
 */
export function MetricChart({ data, dataKey, title, yAxisLabel = '' }) {
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
    .sort()
  
  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="DatePoint" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
          />
          <Legend />
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
    </div>
  )
}

/**
 * Compare Multiple Metrics Chart
 * Displays multiple metrics on the same chart (useful for yield curves, spreads, etc.)
 */
export function ComparisonChart({ data, metrics, title }) {
  if (!data || data.length === 0) {
    return <div className="chart-empty">Keine Daten verfügbar</div>
  }

  const colors = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  return (
    <div className="chart-container">
      {title && <h3>{title}</h3>}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
            formatter={(value) => typeof value === 'number' ? value.toFixed(4) : value}
          />
          <Legend />
          {metrics.map((metric, idx) => (
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
    </div>
  )
}
