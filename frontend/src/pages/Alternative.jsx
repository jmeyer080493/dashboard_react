import './PageStyles.css'

function Alternative() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Alternative 🔄</h1>
        <p>Alternative Anlageklassen und Strategien</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Alternative Anlagen</h3>
          <p>Übersicht der Alternative Assets</p>
          <ul className="dummy-list">
            <li>Hedge Funds: 15%</li>
            <li>Private Equity: 12%</li>
            <li>Real Estate: 18%</li>
            <li>Rohstoffe: 8%</li>
            <li>Kryptowährungen: 2%</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Performance-Vergleich</h3>
          <p>Alternative vs. Traditionell</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Comparison Chart Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Diversifikation</h3>
          <p>Diversifikationseffekt durch Alternative</p>
          <ul className="dummy-list">
            <li>Korrelation zu Aktien: 0.32</li>
            <li>Korrelation zu Anleihen: -0.15</li>
            <li>Portfolio Volatilität Reduktion: 8%</li>
            <li>Sharpe Ratio Verbesserung: +0.12</li>
          </ul>
        </div>

        <div className="card">
          <h3>Rendite-Charakteristiken</h3>
          <p>Statistische Kennzahlen</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Statistics Placeholder</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Alternative
