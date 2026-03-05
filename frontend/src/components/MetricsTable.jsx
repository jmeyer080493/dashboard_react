import './MetricsTable.css'

/**
 * MetricsTable Component
 * Displays the latest values for each metric for each selected region
 * Used above charts to give quick overview of current data
 */
export function MetricsTable({ data, regions, columns = null, formatValue = null }) {
  if (!data || data.length === 0) {
    return <div className="metrics-table-empty">Keine Daten verfügbar</div>
  }

  // Build latest data per region by finding the most recent record for each region
  const latestDataPerRegion = {}
  for (const record of data) {
    const recordRegion = record.Regions
    if (recordRegion && regions.includes(recordRegion)) {
      // Keep track of the latest record for each region by date
      if (!latestDataPerRegion[recordRegion] || 
          record.DatePoint > latestDataPerRegion[recordRegion].DatePoint) {
        latestDataPerRegion[recordRegion] = record
      }
    }
  }

  // If columns are not provided, derive them from the data structure
  let metricsToDisplay = columns
  if (!metricsToDisplay) {
    // Find all keys that are metrics (not DatePoint, Regions, Ticker, Currency)
    const latestDataSample = data[0]
    const excludedKeys = ['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name']
    const allKeys = Object.keys(latestDataSample)
      .filter(k => !excludedKeys.includes(k))
    
    metricsToDisplay = allKeys.sort()
  }

  if (metricsToDisplay.length === 0) {
    return <div className="metrics-table-empty">Keine Metriken verfügbar</div>
  }

  // Helper to get value for a region and metric
  const getValue = (region, metric) => {
    const regionData = latestDataPerRegion[region]
    if (!regionData) {
      return null
    }
    // Get the metric value directly from the region's record
    const value = regionData[metric]
    return value !== undefined ? value : null
  }

  // Default formatter
  const defaultFormatter = (value) => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'number') {
      return value.toFixed(2)
    }
    return String(value)
  }

  const formatter = formatValue || defaultFormatter

  return (
    <div className="metrics-table-container">
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Metrik</th>
            {regions.map(region => (
              <th key={region} className="region-header">{region}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricsToDisplay.map(metric => (
            <tr key={metric} className="metric-row">
              <td className="metric-name">{metric}</td>
              {regions.map(region => {
                const value = getValue(region, metric)
                return (
                  <td key={`${region}-${metric}`} className="metric-value">
                    {formatter(value, metric)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
