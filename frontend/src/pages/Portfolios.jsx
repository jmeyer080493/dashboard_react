import './PageStyles.css'

function Portfolios() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Portfolios 💼</h1>
        <p>Portfolio-Management und Überwachung</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Portfolio-Übersicht</h3>
          <p>Zusammenfassung aller Portfolios</p>
          <ul className="dummy-list">
            <li>Portfolio A: €1.2M</li>
            <li>Portfolio B: €850K</li>
            <li>Portfolio C: €620K</li>
            <li>Gesamt: €2.67M</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Portfolio-Performance</h3>
          <p>Rendite im Jahresverlauf</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Performance Chart Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Risiko-Metriken</h3>
          <p>Volatilität und Risiko-Kennzahlen</p>
          <ul className="dummy-list">
            <li>Volatilität: 12.5%</li>
            <li>Sharpe Ratio: 0.85</li>
            <li>Max Drawdown: -18.2%</li>
            <li>Beta: 0.92</li>
          </ul>
        </div>

        <div className="card">
          <h3>Allokation</h3>
          <p>Asset Allocation nach Klassen</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Allocation Chart Placeholder</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Portfolios
