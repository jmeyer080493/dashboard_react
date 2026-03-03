import './PageStyles.css'

function User() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>User 👤</h1>
        <p>Benutzerverwaltung und Profil</p>
      </div>
      
      <div className="content-grid">
        <div className="card">
          <h3>Benutzerprofil</h3>
          <p>Aktuelle Benutzerinformationen</p>
          <ul className="dummy-list">
            <li>Name: John Doe</li>
            <li>Email: john.doe@example.com</li>
            <li>Rolle: Portfolio Manager</li>
            <li>Beigetreten: January 15, 2024</li>
          </ul>
        </div>
        
        <div className="card">
          <h3>Berechtigungen</h3>
          <p>Aktive Berechtigungen und Rollen</p>
          <ul className="dummy-list">
            <li>✓ Dashboard Zugriff</li>
            <li>✓ Portfolio Management</li>
            <li>✓ Reporting</li>
            <li>✓ Daten Export</li>
          </ul>
        </div>

        <div className="card">
          <h3>Aktivitäts-Log</h3>
          <p>Letzte Benutzeraktivitäten</p>
          <ul className="dummy-list">
            <li>Portfolio aktualisiert: vor 2 Stunden</li>
            <li>Report heruntergeladen: vor 1 Tag</li>
            <li>Einstellungen geändert: vor 3 Tagen</li>
            <li>Angemeldet: heute, 09:15</li>
          </ul>
        </div>

        <div className="card">
          <h3>Einstellungen</h3>
          <p>Benutzereinstellungen und Voreinstellungen</p>
          <div className="dummy-chart" style={{ height: '200px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', paddingTop: '80px', color: '#999' }}>Settings Panel Placeholder</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default User
