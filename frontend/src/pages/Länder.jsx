import { useState, useEffect } from 'react'
import './Länder.css'
import GlobalControls from '../components/GlobalControls'
import EquityTab from './tabs/EquityTab'
import FixedIncomeTab from './tabs/FixedIncomeTab'
import MacroTab from './tabs/MacroTab'
import { STANDARD_DEFAULTS, FI_STANDARD_DEFAULTS, MACRO_STANDARD_DEFAULTS } from '../config/metricsConfig'

/**
 * Länder (Countries) Page
 * 
 * Main container for the Countries dashboard with tabs for Equity, Fixed Income, and Macro data.
 * Manages global state for filters that affect all tabs.
 * Preloads data for all tabs upfront to ensure instant switching.
 */
function Länder({ activeTab, onActiveTabChange, filters, onFiltersChange, graphSettings }) {
  const gs = graphSettings ?? {}
  // Helper to load metrics from localStorage
  const loadMetricsFromStorage = (key) => {
    try {
      const stored = localStorage.getItem(key)
      const result = stored ? JSON.parse(stored) : null
      console.log(`[DEBUG] loadMetricsFromStorage(${key}):`, result)
      return result
    } catch (err) {
      console.error(`Failed to load ${key} from localStorage:`, err)
      return null
    }
  }

  // State for all three tabs' data
  const [equityData, setEquityData] = useState(null)
  const [equityLoading, setEquityLoading] = useState(false)
  const [equityError, setEquityError] = useState(null)
  const [equityColumns, setEquityColumns] = useState([])
  const [equityColumnsLoading, setEquityColumnsLoading] = useState(false)
  
  // Master columns: CONSISTENT list of all possible metrics (does not change with region selection)
  const [masterEquityColumns, setMasterEquityColumns] = useState([])

  const [fixedIncomeData, setFixedIncomeData] = useState(null)
  const [fixedIncomeLoading, setFixedIncomeLoading] = useState(false)
  const [fixedIncomeError, setFixedIncomeError] = useState(null)

  const [macroData, setMacroData] = useState(null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroError, setMacroError] = useState(null)

  // ── Equity metrics filter state ──────────────────────────────────────────
  const [selectedMetricsTable, setSelectedMetricsTable] = useState(() => {
    const loaded = loadMetricsFromStorage('metricsFilter_table') || []
    console.log('[DEBUG] Initial selectedMetricsTable from localStorage:', loaded)
    return loaded
  })
  const [selectedMetricsGraph, setSelectedMetricsGraph] = useState(() => {
    const loaded = loadMetricsFromStorage('metricsFilter_graph') || []
    console.log('[DEBUG] Initial selectedMetricsGraph from localStorage:', loaded)
    return loaded
  })

  // ── Fixed-Income metrics filter state ───────────────────────────────────
  const [masterFIColumns, setMasterFIColumns] = useState([])
  const [selectedFIMetricsTable, setSelectedFIMetricsTable] = useState(() => {
    return loadMetricsFromStorage('fiMetricsFilter_table') || []
  })
  const [selectedFIMetricsGraph, setSelectedFIMetricsGraph] = useState(() => {
    return loadMetricsFromStorage('fiMetricsFilter_graph') || []
  })

  // ── Macro metrics filter state ───────────────────────────────────────────
  const [masterMacroColumns, setMasterMacroColumns] = useState([])
  const [selectedMacroMetricsTable, setSelectedMacroMetricsTable] = useState(() => {
    return loadMetricsFromStorage('macroMetricsFilter_table') || []
  })
  const [selectedMacroMetricsGraph, setSelectedMacroMetricsGraph] = useState(() => {
    return loadMetricsFromStorage('macroMetricsFilter_graph') || []
  })

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
        const columns = result.columns || []
        setEquityColumns(columns)
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

  // Handle metrics changes from modal
  const handleMetricsChange = (changes) => {
    console.log('[DEBUG] handleMetricsChange called with:', changes)
    if (changes.tableMetrics !== undefined) {
      console.log('[DEBUG] Setting selectedMetricsTable to:', changes.tableMetrics)
      setSelectedMetricsTable(changes.tableMetrics)
    }
    if (changes.graphMetrics !== undefined) {
      console.log('[DEBUG] Setting selectedMetricsGraph to:', changes.graphMetrics)
      setSelectedMetricsGraph(changes.graphMetrics)
    }
  }

  // Handle FI metrics changes from modal
  const handleFIMetricsChange = (changes) => {
    if (changes.tableMetrics !== undefined) setSelectedFIMetricsTable(changes.tableMetrics)
    if (changes.graphMetrics !== undefined) setSelectedFIMetricsGraph(changes.graphMetrics)
  }

  // Handle Macro metrics changes from modal
  const handleMacroMetricsChange = (changes) => {
    if (changes.tableMetrics !== undefined) setSelectedMacroMetricsTable(changes.tableMetrics)
    if (changes.graphMetrics !== undefined) setSelectedMacroMetricsGraph(changes.graphMetrics)
  }

  // Save equity metrics to localStorage
  useEffect(() => {
    console.log('[DEBUG] EFFECT SAVE: Saving to localStorage')
    console.log('[DEBUG] EFFECT SAVE: selectedMetricsTable =', selectedMetricsTable)
    console.log('[DEBUG] EFFECT SAVE: selectedMetricsGraph =', selectedMetricsGraph)
    try {
      localStorage.setItem('metricsFilter_table', JSON.stringify(selectedMetricsTable))
      localStorage.setItem('metricsFilter_graph', JSON.stringify(selectedMetricsGraph))
    } catch (err) {
      console.error('Failed to save metrics to localStorage:', err)
    }
  }, [selectedMetricsTable, selectedMetricsGraph])

  // Save FI metrics to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('fiMetricsFilter_table', JSON.stringify(selectedFIMetricsTable))
      localStorage.setItem('fiMetricsFilter_graph', JSON.stringify(selectedFIMetricsGraph))
    } catch (err) {
      console.error('Failed to save FI metrics to localStorage:', err)
    }
  }, [selectedFIMetricsTable, selectedFIMetricsGraph])

  // Save Macro metrics to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('macroMetricsFilter_table', JSON.stringify(selectedMacroMetricsTable))
      localStorage.setItem('macroMetricsFilter_graph', JSON.stringify(selectedMacroMetricsGraph))
    } catch (err) {
      console.error('Failed to save Macro metrics to localStorage:', err)
    }
  }, [selectedMacroMetricsTable, selectedMacroMetricsGraph])

  // Initialize selection defaults only on first mount
  useEffect(() => {
    console.log('[DEBUG] EFFECT MOUNT: selectedMetricsTable.length =', selectedMetricsTable.length)
    console.log('[DEBUG] EFFECT MOUNT: selectedMetricsGraph.length =', selectedMetricsGraph.length)
    if (selectedMetricsTable.length === 0 && selectedMetricsGraph.length === 0) {
      console.log('[DEBUG] MOUNT: Both empty, will set to defaults when columns load')
    } else {
      console.log('[DEBUG] MOUNT: Selections already loaded from localStorage')
    }
  }, [])

  // Fetch MASTER columns (constant, does not change) and initial data
  useEffect(() => {
    console.log('[DEBUG] EFFECT INIT COLUMNS: Fetching master columns on mount')
    
    // Fetch master equity columns - ONCE
    fetch(`/api/countries/equity/columns-master`)
      .then(r => {
        console.log('[DEBUG] INIT COLUMNS: Fetch response status:', r.status)
        return r.json()
      })
      .then(result => {
        console.log('[DEBUG] INIT COLUMNS: Master columns response:', result)
        if (result.status === 'ok') {
          const masterColumns = result.columns || []
          console.log('[DEBUG] INIT COLUMNS: Fetched master columns:', masterColumns)
          console.log('[DEBUG] INIT COLUMNS: Setting masterEquityColumns to:', masterColumns)
          setMasterEquityColumns(masterColumns)
          
          // Only set defaults if BOTH selections are truly empty (first visit)
          if (selectedMetricsTable.length === 0 && selectedMetricsGraph.length === 0) {
            setSelectedMetricsTable(STANDARD_DEFAULTS.table)
            setSelectedMetricsGraph(STANDARD_DEFAULTS.graph)
          }
        } else {
          console.error('[DEBUG] INIT COLUMNS: Bad status in response:', result)
        }
      })
      .catch(err => console.error('[DEBUG] INIT COLUMNS: Fetch error:', err))

    // Fetch master FI columns - ONCE
    fetch(`/api/countries/fixed-income/columns-master`)
      .then(r => r.json())
      .then(result => {
        if (result.status === 'ok') {
          const masterColumns = result.columns || []
          setMasterFIColumns(masterColumns)
          // Only set FI defaults if both selections are empty (first visit)
          if (selectedFIMetricsTable.length === 0 && selectedFIMetricsGraph.length === 0) {
            setSelectedFIMetricsTable(FI_STANDARD_DEFAULTS.table)
            setSelectedFIMetricsGraph(FI_STANDARD_DEFAULTS.graph)
          }
        }
      })
      .catch(err => console.error('[DEBUG] INIT FI COLUMNS: Fetch error:', err))

    // Fetch master Macro columns - ONCE
    fetch(`/api/countries/macro/columns-master`)
      .then(r => r.json())
      .then(result => {
        if (result.status === 'ok') {
          const masterColumns = result.columns || []
          setMasterMacroColumns(masterColumns)
          if (selectedMacroMetricsTable.length === 0 && selectedMacroMetricsGraph.length === 0) {
            setSelectedMacroMetricsTable(MACRO_STANDARD_DEFAULTS.table)
            setSelectedMacroMetricsGraph(MACRO_STANDARD_DEFAULTS.graph)
          }
        }
      })
      .catch(err => console.error('[DEBUG] INIT MACRO COLUMNS: Fetch error:', err))
  }, []) // Only run once on mount

  // Fetch all data upfront when filters change
  useEffect(() => {
    console.log('[DEBUG] EFFECT FILTERS: Filters changed')
    console.log('[DEBUG] EFFECT FILTERS: filters =', filters)
    console.log('[DEBUG] EFFECT FILTERS: selectedMetricsTable =', selectedMetricsTable)
    console.log('[DEBUG] EFFECT FILTERS: selectedMetricsGraph =', selectedMetricsGraph)
    
    const timeout = setTimeout(() => {
      console.log('[DEBUG] FILTERS DEBOUNCE: Fetching data after debounce')
      // Fetch all three endpoints in parallel
      fetchTabData('/countries/equity', setEquityData, setEquityLoading, setEquityError, true)
      fetchTabData('/countries/fixed-income', setFixedIncomeData, setFixedIncomeLoading, setFixedIncomeError)
      fetchTabData('/countries/macro', setMacroData, setMacroLoading, setMacroError)
      
      // Fetch columns but DON'T reset selections
      const regionsParam = filters.regions.join(',')
      const params = new URLSearchParams()
      params.append('regions', regionsParam)
      params.append('lookback', filters.lookback)

      console.log('[DEBUG] FILTERS: Fetching columns for regions:', regionsParam)
      fetch(`/api/countries/equity/columns?${params.toString()}`)
        .then(r => r.json())
        .then(result => {
          if (result.status === 'ok') {
            const newColumns = result.columns || []
            console.log('[DEBUG] FILTERS: Columns fetched:', newColumns)
            setEquityColumns(newColumns)
            console.log('[DEBUG] FILTERS: selectedMetricsTable still =', selectedMetricsTable)
            console.log('[DEBUG] FILTERS: selectedMetricsGraph still =', selectedMetricsGraph)
            
            // CRITICAL FIX: Filter selected metrics to only include newly available ones
            const filteredTable = selectedMetricsTable.filter(m => newColumns.includes(m))
            const filteredGraph = selectedMetricsGraph.filter(m => newColumns.includes(m))
            
            if (filteredTable.length !== selectedMetricsTable.length) {
              console.log('[DEBUG] FILTERS: ⚠️ Filtering table metrics from', selectedMetricsTable.length, 'to', filteredTable.length)
              setSelectedMetricsTable(filteredTable)
            }
            if (filteredGraph.length !== selectedMetricsGraph.length) {
              console.log('[DEBUG] FILTERS: ⚠️ Filtering graph metrics from', selectedMetricsGraph.length, 'to', filteredGraph.length)
              setSelectedMetricsGraph(filteredGraph)
            }
          }
        })
        .catch(err => console.error('Failed to fetch columns:', err))
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
        availableMetrics={activeTab === 'equity' ? masterEquityColumns : []}
        selectedMetricsTable={selectedMetricsTable}
        selectedMetricsGraph={selectedMetricsGraph}
        onMetricsChange={handleMetricsChange}
        availableFIMetrics={masterFIColumns}
        selectedFIMetricsTable={selectedFIMetricsTable}
        selectedFIMetricsGraph={selectedFIMetricsGraph}
        onFIMetricsChange={handleFIMetricsChange}
        availableMacroMetrics={masterMacroColumns}
        selectedMacroMetricsTable={selectedMacroMetricsTable}
        selectedMacroMetricsGraph={selectedMacroMetricsGraph}
        onMacroMetricsChange={handleMacroMetricsChange}
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
              selectedMetricsTable={selectedMetricsTable}
              selectedMetricsGraph={selectedMetricsGraph}
              chartsPerRow={gs.equity?.chartsPerRow ?? 2}
              chartHeight={gs.equity?.chartHeight ?? 300}
            />
          )}
          {activeTab === 'fixed-income' && (
            <FixedIncomeTab 
              filters={filters}
              data={fixedIncomeData}
              loading={fixedIncomeLoading}
              error={fixedIncomeError}
              selectedMetricsTable={selectedFIMetricsTable}
              selectedMetricsGraph={selectedFIMetricsGraph}
              chartsPerRow={gs.fi?.chartsPerRow ?? 2}
              chartHeight={gs.fi?.chartHeight ?? 300}
            />
          )}
          {activeTab === 'macro' && (
            <MacroTab 
              filters={filters}
              data={macroData}
              loading={macroLoading}
              error={macroError}
              selectedMetricsTable={selectedMacroMetricsTable}
              selectedMetricsGraph={selectedMacroMetricsGraph}
              chartsPerRow={gs.macro?.chartsPerRow ?? 2}
              chartHeight={gs.macro?.chartHeight ?? 300}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default Länder
