import { PerformanceChart, MetricChart } from '../../components/Charts'
import './TabStyles.css'

/**
 * Convert column name to friendly title
 * Converts database column names to readable titles
 */
function getColumnTitle(columnName) {
  const titleMap = {
    'PX_LAST': 'Price (PX_LAST)',
    'MA_50': 'Moving Average 50-Day',
    'RSI': 'Relative Strength Index (RSI)',
    'MACD': 'MACD',
    'MACD_Signal': 'MACD Signal',
    'MACD_Histogram': 'MACD Histogram',
    'MOM_3': '3-Month Momentum',
    'MOM_12': '12-Month Momentum',
    'MOM_TS': 'Time Series Momentum',
    'Rolling Volatility': 'Rolling Volatility',
    'Rolling Sharpe': 'Rolling Sharpe Ratio',
    '2Y Yields': '2-Year Yields',
    '5Y Yields': '5-Year Yields',
    '10Y Yields': '10-Year Yields',
    '20Y Yields': '20-Year Yields',
  }
  
  return titleMap[columnName] || columnName
}

/**
 * Get Y-axis label for a metric
 */
function getYAxisLabel(columnName) {
  if (columnName.includes('RSI')) return 'RSI (0-100)'
  if (columnName.includes('Volatility')) return 'Volatility (%)'
  if (columnName.includes('Sharpe')) return 'Sharpe Ratio'
  if (columnName.includes('Momentum')) return 'Momentum (%)'
  if (columnName.includes('Yield')) return 'Yield (%)'
  if (columnName.includes('MACD')) return 'MACD'
  if (columnName.includes('MA_')) return 'Price'
  if (columnName.includes('Price')) return 'Price'
  return ''
}

/**
 * Equity Tab Component
 * Displays equity market data, technical indicators, and performance metrics
 * Dynamically generates a line graph for each numerical column
 * Data is fetched by parent component (Länder) for instant switching
 */
function EquityTab({ filters, data, loading, error, columns, columnsLoading }) {

  if (loading || columnsLoading) {
    return <div className="tab-loading">📊 Laden...</div>
  }

  if (error) {
    return <div className="tab-error">❌ Fehler: {error}</div>
  }

  if (!data) {
    return <div className="tab-empty">Keine Daten verfügbar</div>
  }

  return (
    <div className="equity-tab">
      <div className="tab-header">
        <h2>Aktien - Equities</h2>
        <p className="sub-title">
          Daten für: {filters.regions.join(', ')} | 
          Zeitraum: {filters.lookback} | 
          Währung: {filters.currency}
        </p>
      </div>

      <div className="metadata">
        <span>Datensätze: {data.metadata?.record_count || 0}</span>
        <span>Verfügbare Metriken: {columns.length}</span>
        <span>Aktualisiert: {new Date().toLocaleDateString('de-DE')}</span>
      </div>

      <div className="chart-grid">
        <PerformanceChart 
          data={data.data}
          title="Equity Market Performance"
        />
        
        {/* Dynamically render one chart per available numerical column */}
        {columns.length > 0 ? (
          columns.map((column) => (
            <MetricChart 
              key={column}
              data={data.data}
              dataKey={column}
              title={getColumnTitle(column)}
              yAxisLabel={getYAxisLabel(column)}
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
