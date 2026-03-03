import './PageStyles.css'

function DuoPlus() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>DuoPlus ⚡</h1>
        <p>Advanced Portfolio Analytics und Strategien</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Strategie-Performance</h3>
          <p>Performance der DuoPlus-Strategien</p>
          <ul className="dummy-list">
            <li>Strategie A: +8.5% YTD</li>
            <li>Strategie B: +12.3% YTD</li>
            <li>Strategie C: +5.7% YTD</li>
            <li>Benchmark: +7.2% YTD</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Optimierte Allokation</h3>
          <p>Optimale Portfolio-Gewichte</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Allocation Chart Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Risiko-Adjusted Returns</h3>
          <p>Risikobereintigte Renditekennzahlen</p>
          <ul className="dummy-list">
            <li>Sharpe Ratio: 0.95</li>
            <li>Sortino Ratio: 1.32</li>
            <li>Information Ratio: 0.68</li>
            <li>Calmar Ratio: 0.55</li>
          </ul>
        </div>

        <div className="card">
          <h3>Echtzeitoptimierung</h3>
          <p>Automatische Portfolio-Anpassungen</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Optimization Events Placeholder</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DuoPlus
