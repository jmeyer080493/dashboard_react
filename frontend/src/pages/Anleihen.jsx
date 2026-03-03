import './PageStyles.css'

function Anleihen() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Anleihen 📝</h1>
        <p>Anleiheportfolio und Rentenmärkte</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Anleihen-Übersicht</h3>
          <p>Portfolio-Verteilung nach Anleihentyp</p>
          <ul className="dummy-list">
            <li>Staatsanleihen: 45%</li>
            <li>Unternehmensanleihen: 35%</li>
            <li>Kommunalanleihen: 12%</li>
            <li>Hochzinsanleihen: 8%</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Rendite-Kurven</h3>
          <p>Aktuelle Renditekurven der Märkte</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Yield Curve Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Duration und Konvexität</h3>
          <p>Zinsrisiko-Metriken</p>
          <ul className="dummy-list">
            <li>Modified Duration: 4.2 Jahre</li>
            <li>Konvexität: 0.18</li>
            <li>Durchschn. Coupon: 2.8%</li>
            <li>Gewichtete Laufzeit: 5.1 Jahre</li>
          </ul>
        </div>

        <div className="card">
          <h3>Spread-Analyse</h3>
          <p>Kredit- und Optionsspread</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Spread Evolution Placeholder</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Anleihen
