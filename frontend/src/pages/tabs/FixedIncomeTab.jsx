import { PerformanceChart, MetricChart, ComparisonChart } from '../../components/Charts'
import './TabStyles.css'

/**
 * Fixed Income Tab Component
 * Displays bond data, yield curves, spreads, and credit metrics
 * Data is fetched by parent component (Länder) for instant switching
 */
function FixedIncomeTab({ filters, data, loading, error }) {

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
    <div className="fixed-income-tab">
      <div className="tab-header">
        <h2>Anleihen - Fixed Income</h2>
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
          metrics={['Yield_2Y', 'Yield_5Y', 'Yield_10Y']}
          title="Government Bond Yield Curve"
        />
        <MetricChart 
          data={data.data}
          dataKey="CDS_5Y"
          title="5-Year CDS Spreads"
          yAxisLabel="Basis Points"
        />
        <MetricChart 
          data={data.data}
          dataKey="Steepness"
          title="Yield Curve Steepness (10Y-2Y)"
          yAxisLabel="Basis Points"
        />
        <MetricChart 
          data={data.data}
          dataKey="Spread_to_Bund"
          title="Spread to German Bund"
          yAxisLabel="Basis Points"
        />
      </div>
    </div>
  )
}

export default FixedIncomeTab
