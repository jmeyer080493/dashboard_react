import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from './Sidebar'
import Länder from './pages/Länder'
import Faktoren from './pages/Faktoren'
import Sektoren from './pages/Sektoren'
import Portfolios from './pages/Portfolios'
import Data from './pages/Data'
import Anleihen from './pages/Anleihen'
import DuoPlus from './pages/DuoPlus'
import Alternative from './pages/Alternative'
import User from './pages/User'
import Login from './pages/Login'
import { ALL_REGIONS } from './config/countries'
import { ExportProvider } from './context/ExportContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { PptxModal, XlsxModal } from './components/ExportModal'
import EinstellungenModal from './components/EinstellungenModal'
import FeedbackModal from './components/FeedbackModal'
import './App.css'

// Inner component that can access the AuthContext
function AppInner() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Login />
  }

  return <AppShell />
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ThemeProvider>
  )
}

function AppShell() {
  const { logout, permissions } = useAuth()
  const [currentPage, setCurrentPage] = useState(null)  // null = derive from permissions
  const [apiStatus, setApiStatus] = useState('checking')
  const [einstellungenOpen, setEinstellungenOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const DEFAULT_GRAPH_SETTINGS = {
    equity:   { chartsPerRow: 2, chartHeight: 300 },
    fi:       { chartsPerRow: 2, chartHeight: 300 },
    macro:    { chartsPerRow: 2, chartHeight: 300 },
    faktoren: { chartsPerRow: 3, chartHeight: 420 },
    sektoren: { chartsPerRow: 2, chartHeight: 500 },
  }

  // User tab alert state – set by NordrheinTab when it loads its data
  const [userHasAlerts, setUserHasAlerts] = useState(false)

  const [graphSettings, setGraphSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('graphSettings')
      return stored ? JSON.parse(stored) : DEFAULT_GRAPH_SETTINGS
    } catch {
      return DEFAULT_GRAPH_SETTINGS
    }
  })

  const handleSaveGraphSettings = (newSettings) => {
    setGraphSettings(newSettings)
    try { localStorage.setItem('graphSettings', JSON.stringify(newSettings)) } catch {}
  }

  // Permission map – mirrors Sidebar's PAGE_PERMISSIONS
  const PAGE_PERMISSIONS = {
    'Länder':      'countries',
    'Faktoren':    'factors',
    'Sektoren':    'sectors',
    'Portfolios':  'portfolios',
    'Data':        'data',
    'Anleihen':    'anleihen',
    'DuoPlus':     'duoplus',
    'Alternative': 'extras',
    'User':        'user',
  }

  const canAccess = (page) => {
    const required = PAGE_PERMISSIONS[page]
    return !required || permissions.includes(required)
  }

  // Resolve the active page: use currentPage if permitted, else first permitted page
  const ALL_PAGES = ['Länder','Faktoren','Sektoren','Portfolios','Data','Anleihen','DuoPlus','Alternative','User']
  const firstPermitted = ALL_PAGES.find(canAccess) ?? 'Länder'
  const activePage = (currentPage && canAccess(currentPage)) ? currentPage : firstPermitted
  
  // Länder page state - persists across page navigation
  const [länderActiveTab, setLänderActiveTab] = useState('equity')
  const [länderFilters, setLänderFilters] = useState({
    regions: ALL_REGIONS.length > 0 ? [ALL_REGIONS[0]] : ['Germany'],
    startDate: null,
    endDate: null,
    lookback: '1Y',
    showAverages: false,
    currency: 'EUR'
  })

  const handleLänderFiltersChange = (newFilters) => {
    setLänderFilters(prev => ({
      ...prev,
      ...newFilters
    }))
  }

  useEffect(() => {
    checkApiHealth()
  }, [])

  const checkApiHealth = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/health')
      setApiStatus('connected')
    } catch (error) {
      setApiStatus('disconnected')
      console.error('API connection error:', error)
    }
  }

  const renderPage = () => {
    // Double-check permission server-side guard
    if (!canAccess(activePage)) {
      return (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#999' }}>
          <h2 style={{ color: '#c9a0dc', marginBottom: '0.75rem' }}>Kein Zugriff</h2>
          <p>Sie haben keine Berechtigung für diese Seite.</p>
        </div>
      )
    }
    switch (activePage) {
      case 'Länder':
        return (
          <Länder 
            activeTab={länderActiveTab}
            onActiveTabChange={setLänderActiveTab}
            filters={länderFilters}
            onFiltersChange={handleLänderFiltersChange}
            graphSettings={graphSettings}
          />
        )
      case 'Faktoren':
        return <Faktoren graphSettings={graphSettings} />
      case 'Sektoren':
        return <Sektoren graphSettings={graphSettings} />
      case 'Portfolios':
        return <Portfolios />
      case 'Data':
        return <Data />
      case 'Anleihen':
        return <Anleihen />
      case 'DuoPlus':
        return <DuoPlus />
      case 'Alternative':
        return <Alternative />
      case 'User':
        return <User onAlertsChange={setUserHasAlerts} />
      default:
        return (
          <Länder 
            activeTab={länderActiveTab}
            onActiveTabChange={setLänderActiveTab}
            filters={länderFilters}
            onFiltersChange={handleLänderFiltersChange}
            graphSettings={graphSettings}
          />
        )
    }
  }

  return (
    <ExportProvider>
      <div className="app-container">
        <Sidebar
            onPageChange={setCurrentPage}
            onLogout={logout}
            onOpenEinstellungen={() => setEinstellungenOpen(true)}
            onOpenFeedback={() => setFeedbackOpen(true)}
            userHasAlerts={userHasAlerts}
          />
        <main className="main-content">
          <div className="content-wrapper">
            {/* API Status Indicator */}
            <div className={`api-indicator ${apiStatus}`}>
              <span className="indicator-dot"></span>
              <span className="indicator-text">
                Backend: {apiStatus === 'connected' ? '✓ Connected' : '✗ Disconnected'}
              </span>
            </div>

            {/* Page Content */}
            {renderPage()}
          </div>
        </main>

        {/* Export Modals */}
        <PptxModal />
        <XlsxModal />

        {/* Einstellungen Modal */}
        <EinstellungenModal
          isOpen={einstellungenOpen}
          onClose={() => setEinstellungenOpen(false)}
          graphSettings={graphSettings}
          onSaveSettings={handleSaveGraphSettings}
        />

        {/* Feedback Modal */}
        <FeedbackModal
          isOpen={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          currentPage={activePage}
        />
      </div>
    </ExportProvider>
  )
}

export default App
