import './PageStyles.css'

function Faktoren() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Faktoren 📊</h1>
        <p>Analyse von Faktoren und deren Auswirkungen auf Portfolios</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Faktor-Performance</h3>
          <p>Vergleich verschiedener Faktoren im Zeitverlauf</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Chart Placeholder</p>
          </div>
        </div>
        
        <div className="card">
          <h3>Faktor-Exposure</h3>
          <p>Aktuelle Exposure-Werte nach Faktor</p>
          <ul className="dummy-list">
            <li>Value: +2.5%</li>
            <li>Momentum: -1.2%</li>
            <li>Quality: +3.1%</li>
            <li>Size: -0.8%</li>
          </ul>
        </div>

        <div className="card">
          <h3>Faktor-Korelation</h3>
          <p>Korrelationsmatrix zwischen Faktoren</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Correlation Matrix Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Faktor-Attribution</h3>
          <p>Beiträge der Faktoren zum Portfolioperformance</p>
          <ul className="dummy-list">
            <li>Faktor 1: 1.5% Beitrag</li>
            <li>Faktor 2: 0.8% Beitrag</li>
            <li>Faktor 3: 0.3% Beitrag</li>
            <li>Faktor 4: -0.2% Beitrag</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Faktoren
