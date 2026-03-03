import './PageStyles.css'

function Data() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Data 📈</h1>
        <p>Datenverwaltung und Analyse</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Datenquellen</h3>
          <p>Verfügbare Datenquellen und Status</p>
          <ul className="dummy-list">
            <li>✓ Marktdaten: Aktiv</li>
            <li>✓ Wirtschaftsindikatoren: Aktiv</li>
            <li>✓ Fundamentaldaten: Aktiv</li>
            <li>✓ Sentimentdaten: Aktiv</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Datenqualität</h3>
          <p>Qualitätsmetriken für verfügbare Daten</p>
          <ul className="dummy-list">
            <li>Vollständigkeit: 99.2%</li>
            <li>Aktualität: &lt; 5 Min</li>
            <li>Genauigkeit: 99.8%</li>
            <li>Verfügbarkeit: 99.9%</li>
          </ul>
        </div>

        <div className="card">
          <h3>Aktualisierungen</h3>
          <p>Letzte Datenaktualisierungen</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Update Timeline Placeholder</p>
          </div>
        </div>

        <div className="card">
          <h3>Datenspeicher</h3>
          <p>Speicherverbrauch und Kapazität</p>
          <ul className="dummy-list">
            <li>Verwendet: 850 GB</li>
            <li>Verfügbar: 3.2 TB</li>
            <li>Auslastung: 25%</li>
            <li>Wachstum: +2% pro Woche</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Data
