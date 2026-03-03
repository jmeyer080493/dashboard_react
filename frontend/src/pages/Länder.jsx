import { useState, useEffect } from 'react'
import './Länder.css'
import GlobalControls from '../components/GlobalControls'
import EquityTab from './tabs/EquityTab'
import FixedIncomeTab from './tabs/FixedIncomeTab'
import MacroTab from './tabs/MacroTab'

/**
 * Länder (Countries) Page
 * 
 * Main container for the Countries dashboard with tabs for Equity, Fixed Income, and Macro data.
 * Manages global state for filters that affect all tabs.
 * Preloads data for all tabs upfront to ensure instant switching.
 */
function Länder({ activeTab, onActiveTabChange, filters, onFiltersChange }) {
  // State for all three tabs' data
  const [equityData, setEquityData] = useState(null)
  const [equityLoading, setEquityLoading] = useState(false)
  const [equityError, setEquityError] = useState(null)
  const [equityColumns, setEquityColumns] = useState([])
  const [equityColumnsLoading, setEquityColumnsLoading] = useState(false)

  const [fixedIncomeData, setFixedIncomeData] = useState(null)
  const [fixedIncomeLoading, setFixedIncomeLoading] = useState(false)
  const [fixedIncomeError, setFixedIncomeError] = useState(null)

  const [macroData, setMacroData] = useState(null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroError, setMacroError] = useState(null)

  // Build API params from filters
  const buildParams = () => {
    const params = new URLSearchParams()
    params.append('regions', filters.regions.join(','))
    if (filters.startDate) params.append('start_date', filters.startDate)
    if (filters.endDate) params.append('end_date', filters.endDate)
    params.append('lookback', filters.lookback)
    params.append('show_averages', filters.showAverages)
    return params
  }

  // Fetch data for a specific endpoint
  const fetchTabData = async (endpoint, setData, setLoading, setError, isCurrencyNeeded = false) => {
    try {
      setLoading(true)
      setError(null)

      const params = buildParams()
      if (isCurrencyNeeded) {
        params.append('currency', filters.currency)
      }

      const token = localStorage.getItem('auth_token')
      const headers = {
        'Content-Type': 'application/json'
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(`/api${endpoint}?${params.toString()}`, { headers })
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result = await response.json()
      if (result.error) {
        throw new Error(result.error)
      }

      setData(result)
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // Fetch equity columns
  const fetchEquityColumns = async () => {
    try {
      setEquityColumnsLoading(true)
      const regionsParam = filters.regions.join(',')
      const params = new URLSearchParams()
      params.append('regions', regionsParam)
      params.append('lookback', filters.lookback)

      const response = await fetch(`/api/countries/equity/columns?${params.toString()}`)
      const result = await response.json()

      if (result.status === 'ok') {
        setEquityColumns(result.columns || [])
      } else {
        console.error('Error fetching columns:', result)
        setEquityColumns([])
      }
    } catch (err) {
      console.error('Failed to fetch columns:', err)
      setEquityColumns([])
    } finally {
      setEquityColumnsLoading(false)
    }
  }

  // Fetch all data upfront when filters change
  useEffect(() => {
    // Debounce to avoid too many requests
    const timeout = setTimeout(() => {
      // Fetch all three endpoints in parallel
      fetchTabData('/countries/equity', setEquityData, setEquityLoading, setEquityError, true)
      fetchTabData('/countries/fixed-income', setFixedIncomeData, setFixedIncomeLoading, setFixedIncomeError)
      fetchTabData('/countries/macro', setMacroData, setMacroLoading, setMacroError)
      fetchEquityColumns()
    }, 300)

    return () => clearTimeout(timeout)
  }, [filters])

  return (
    <div className="länder-container">
      {/* Global controls row */}
      <GlobalControls 
        filters={filters}
        onFiltersChange={onFiltersChange}
        activeTab={activeTab}
      />

      {/* Tab container */}
      <div className="länder-tabs">
        <div className="tab-buttons">
          <button
            className={`tab-button ${activeTab === 'equity' ? 'active' : ''}`}
            onClick={() => onActiveTabChange('equity')}
          >
            📈 Aktien
          </button>
          <button
            className={`tab-button ${activeTab === 'fixed-income' ? 'active' : ''}`}
            onClick={() => onActiveTabChange('fixed-income')}
          >
            💼 Anleihen
          </button>
          <button
            className={`tab-button ${activeTab === 'macro' ? 'active' : ''}`}
            onClick={() => onActiveTabChange('macro')}
          >
            🌍 Makro
          </button>
        </div>

        <div className="tab-content">
          {activeTab === 'equity' && (
            <EquityTab 
              filters={filters}
              data={equityData}
              loading={equityLoading}
              error={equityError}
              columns={equityColumns}
              columnsLoading={equityColumnsLoading}
            />
          )}
          {activeTab === 'fixed-income' && (
            <FixedIncomeTab 
              filters={filters}
              data={fixedIncomeData}
              loading={fixedIncomeLoading}
              error={fixedIncomeError}
            />
          )}
          {activeTab === 'macro' && (
            <MacroTab 
              filters={filters}
              data={macroData}
              loading={macroLoading}
              error={macroError}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default Länder
