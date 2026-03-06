import { PerformanceChart, MetricChart } from '../../components/Charts'
import { MetricsTable } from '../../components/MetricsTable'
import { getMetricLabel, EQUITY_METRICS_CATEGORIES } from '../../config/metricsConfig'
import './TabStyles.css'

/**
 * Convert column name to friendly title using the central metricsConfig.
 * Falls back to a few extra mappings for non-equity-specific columns.
 */
function getColumnTitle(columnName) {
  // First try the central config (covers all equity metrics)
  const label = getMetricLabel(columnName)
  if (label !== columnName) return label

  // Extra fallbacks for columns outside EQUITY_METRICS_CATEGORIES
  const extras = {
    'PX_LAST': 'Kurs (PX_LAST)',
    'MA_50': '50-Tage Ø',
    'Rolling Sharpe': 'Rolling Sharpe Ratio',
    'Rolling Returns': 'Rolling Returns',
    '2Y Yields': '2J Rendite',
    '5Y Yields': '5J Rendite',
    '10Y Yields': '10J Rendite',
    '20Y Yields': '20J Rendite',
  }
  return extras[columnName] || columnName
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

      {/* Latest Values Table */}
      <MetricsTable
        data={data.data}
        regions={filters.regions}
        columns={selectedMetricsTable.length > 0 ? selectedMetricsTable : columns}
        categories={EQUITY_METRICS_CATEGORIES}
        lookback={filters.lookback}
        tabLabel="Aktien"
      />

      <div
        className="chart-grid"
        style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
      >
        <PerformanceChart 
          data={data.data}
          title="Equity Market Performance"
          height={chartHeight}
        />
        
        {/* Dynamically render one chart per selected numerical column */}
        {columns.length > 0 ? (
          columns
            .filter(col => selectedMetricsGraph.length === 0 || selectedMetricsGraph.includes(col))
            .map((column) => (
            <MetricChart 
              key={column}
              data={data.data}
              dataKey={column}
              title={getColumnTitle(column)}
              yAxisLabel={getYAxisLabel(column)}
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
