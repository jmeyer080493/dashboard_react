import { PerformanceChart, MetricChart, ComparisonChart } from '../../components/Charts'
import './TabStyles.css'

/**
 * Macro Tab Component
 * Displays macroeconomic indicators, PMI, inflation, interest rates, etc.
 * Data is fetched by parent component (Länder) for instant switching
 */
function MacroTab({ filters, data, loading, error }) {

  if (loading) {
    return <div className="tab-loading">📊 Laden...</div>
  }

  if (error) {
    return <div className="tab-error">❌ Fehler: {error}</div>
  }

  if (!data) {
    return <div className="tab-empty">Keine Daten verfügbar</div>
  }

  return (
    <div className="macro-tab">
      <div className="tab-header">
        <h2>Makro - Macroeconomics</h2>
        <p className="sub-title">
          Daten für: {filters.regions.join(', ')} | 
          Zeitraum: {filters.lookback}
        </p>
      </div>

      <div className="metadata">
        <span>Datensätze: {data.metadata?.record_count || 0}</span>
        <span>Aktualisiert: {new Date().toLocaleDateString('de-DE')}</span>
      </div>

      <div className="chart-grid">
        <ComparisonChart 
          data={data.data}
          metrics={['ECB_Rate', 'FED_Rate', 'BoE_Rate']}
          title="Central Bank Policy Rates"
        />
        <ComparisonChart 
          data={data.data}
          metrics={['Inflation_EA', 'Inflation_US', 'Inflation_UK']}
          title="Headline Inflation Rates"
        />
        <ComparisonChart 
          data={data.data}
          metrics={['PMI_Manufacturing', 'PMI_Services']}
          title="Purchasing Managers' Index (PMI)"
        />
        <MetricChart 
          data={data.data}
          dataKey="Debt_to_GDP"
          title="Government Debt to GDP Ratio"
          yAxisLabel="% of GDP"
        />
      </div>
    </div>
  )
}

export default MacroTab
