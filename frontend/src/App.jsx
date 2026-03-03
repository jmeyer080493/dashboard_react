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
import './App.css'

function App() {
  const [currentPage, setCurrentPage] = useState('Länder')
  const [apiStatus, setApiStatus] = useState('checking')
  
  // Länder page state - persists across page navigation
  const [länderActiveTab, setLänderActiveTab] = useState('equity')
  const [länderFilters, setLänderFilters] = useState({
    regions: ['Germany'],
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
    switch (currentPage) {
      case 'Länder':
        return (
          <Länder 
            activeTab={länderActiveTab}
            onActiveTabChange={setLänderActiveTab}
            filters={länderFilters}
            onFiltersChange={handleLänderFiltersChange}
          />
        )
      case 'Faktoren':
        return <Faktoren />
      case 'Sektoren':
        return <Sektoren />
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
        return <User />
      default:
        return (
          <Länder 
            activeTab={länderActiveTab}
            onActiveTabChange={setLänderActiveTab}
            filters={länderFilters}
            onFiltersChange={handleLänderFiltersChange}
          />
        )
    }
  }

  return (
    <div className="app-container">
      <Sidebar onPageChange={setCurrentPage} />
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
    </div>
  )
}

export default App
