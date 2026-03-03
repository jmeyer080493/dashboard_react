import './PageStyles.css'

function Sektoren() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Sektoren 🏢</h1>
        <p>Sektorale Analyse und Performance-Tracking</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Sektor-Performance</h3>
          <p>Performance der verschiedenen Sektoren</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Chart Placeholder</p>
          </div>
        </div>
        
        <div className="card">
          <h3>Sektor-Gewichtung</h3>
          <p>Gewichtung der Sektoren im Portfolio</p>
          <ul className="dummy-list">
            <li>Technologie: 25%</li>
            <li>Finanzen: 20%</li>
            <li>Industrie: 18%</li>
            <li>Gesundheit: 15%</li>
            <li>Energie: 12%</li>
            <li>Sonstige: 10%</li>
          </ul>
        </div>

        <div className="card">
          <h3>Sektor-Vergleich</h3>
          <p>Vergleich mit Benchmark-Index</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Comparison Chart Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Sektor-Trends</h3>
          <p>Aktuelle Trends und Prognosen</p>
          <ul className="dummy-list">
            <li>📈 Technologie: Starker Aufwind</li>
            <li>📉 Energie: Abwärtstrendfähigkeit</li>
            <li>➡️ Finanzen: Seitwärtstrend</li>
            <li>📈 Gesundheit: Moderates Wachstum</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Sektoren
