import { useState, useEffect, useRef } from 'react'
import './Länder.css'
import GlobalControls from '../components/GlobalControls'
import EquityTab from './tabs/EquityTab'
import FixedIncomeTab from './tabs/FixedIncomeTab'
import MacroTab from './tabs/MacroTab'
import {
  STANDARD_DEFAULTS, FI_STANDARD_DEFAULTS, MACRO_STANDARD_DEFAULTS,
  ALL_MACRO_TABLE_METRICS, ALL_MACRO_GRAPH_METRICS, VIRTUAL_GRAPH_METRICS,
} from '../config/metricsConfig'
import { ALL_REGIONS, FI_ONLY_REGIONS } from '../config/countries'

//  Module-level data cache (survives component unmount / tab switch) 
const _equityCache    = {}
const _fiCache        = {}
const _macroCache     = {}
const _equityColCache = {}
const _onceCache      = { masterEquity: null, masterFI: null, masterMacro: null, ratings: null }

function _equityKey(f)    { const d = f.customMode ? `|${f.startDate}|${f.endDate}` : ''; return `${f.regions.join(',')}|${f.lookback}${d}|${f.currency}` }
function _fiKey(f)        { const d = f.customMode ? `|${f.startDate}|${f.endDate}` : ''; return `${f.regions.join(',')}|${f.lookback}${d}` }
function _macroKey(f)     { const d = f.customMode ? `|${f.startDate}|${f.endDate}` : ''; return `${f.lookback}${d}` }
function _equityColKey(f) { return `${f.regions.join(',')}|${f.lookback}` }

const A_BBB_RATINGS = new Set(['A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-'])
const FI_EXCLUDED   = new Set(['China', 'India', 'EM'])

function makeDate(yearsAgo) {
  const d = new Date()
  if (yearsAgo === 0) return d.toISOString().split('T')[0]
  d.setFullYear(d.getFullYear() - yearsAgo)
  return d.toISOString().split('T')[0]
}

function initFilters(storageKey, defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return { ...defaults, ...saved }
  } catch {
    return defaults
  }
}

const EQUITY_DEFAULTS = {
  regions:    ['U.S.', 'Europe', 'Japan', 'UK', 'EM', 'China'],
  lookback:   '1Y',
  startDate:  makeDate(1),
  endDate:    makeDate(0),
  currency:   'EUR',
  customMode: false,
}
const FI_DEFAULTS = {
  regions:    ['U.S.', 'Europe', 'Germany', 'France', 'Italy', 'UK', 'Spain'],
  lookback:   '1Y',
  startDate:  makeDate(1),
  endDate:    makeDate(0),
  customMode: false,
}
const MACRO_DEFAULTS = {
  regions:    ['U.S.', 'Europe', 'Japan', 'UK'],
  lookback:   '1Y',
  startDate:  makeDate(1),
  endDate:    makeDate(0),
  customMode: false,
}

function Länder({ activeTab, onActiveTabChange, graphSettings }) {
  const gs = graphSettings ?? {}
  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  const [equityFilters, setEquityFilters] = useState(() => initFilters('länder_equity_filters', EQUITY_DEFAULTS))
  const [fiFilters,     setFiFilters]     = useState(() => initFilters('länder_fi_filters',     FI_DEFAULTS))
  const [macroFilters,  setMacroFilters]  = useState(() => initFilters('länder_macro_filters',  MACRO_DEFAULTS))

  const [equityChartType, setEquityChartType] = useState(() => { try { return localStorage.getItem('länder_equity_chartType') || 'Line' } catch { return 'Line' } })
  const [fiChartType,     setFiChartType]     = useState(() => { try { return localStorage.getItem('länder_fi_chartType')     || 'Line' } catch { return 'Line' } })
  const [macroChartType,  setMacroChartType]  = useState(() => { try { return localStorage.getItem('länder_macro_chartType')  || 'Line' } catch { return 'Line' } })

  useEffect(() => { try { localStorage.setItem('länder_equity_filters',    JSON.stringify(equityFilters)) } catch {} }, [equityFilters])
  useEffect(() => { try { localStorage.setItem('länder_fi_filters',        JSON.stringify(fiFilters))     } catch {} }, [fiFilters])
  useEffect(() => { try { localStorage.setItem('länder_macro_filters',     JSON.stringify(macroFilters))  } catch {} }, [macroFilters])
  useEffect(() => { try { localStorage.setItem('länder_equity_chartType',  equityChartType)               } catch {} }, [equityChartType])
  useEffect(() => { try { localStorage.setItem('länder_fi_chartType',      fiChartType)                   } catch {} }, [fiChartType])
  useEffect(() => { try { localStorage.setItem('länder_macro_chartType',   macroChartType)                } catch {} }, [macroChartType])

  const [equityData,    setEquityData]    = useState(() => _equityCache[_equityKey(equityFilters)] ?? null)
  const [equityLoading, setEquityLoading] = useState(false)
  const [equityError,   setEquityError]   = useState(null)
  const [equityColumns, setEquityColumns] = useState(() => _equityColCache[_equityColKey(equityFilters)] ?? [])
  const [equityColumnsLoading, setEquityColumnsLoading] = useState(false)
  const [masterEquityColumns,  setMasterEquityColumns]  = useState(() => _onceCache.masterEquity ?? [])

  const [fiData,    setFiData]    = useState(() => _fiCache[_fiKey(fiFilters)] ?? null)
  const [fiLoading, setFiLoading] = useState(false)
  const [fiError,   setFiError]   = useState(null)
  const [masterFIColumns, setMasterFIColumns] = useState(() => _onceCache.masterFI ?? [])

  const [ratingsData, setRatingsData] = useState(() => _onceCache.ratings ?? [])

  const [macroData,    setMacroData]    = useState(() => _macroCache[_macroKey(macroFilters)] ?? null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroError,   setMacroError]   = useState(null)
  const [masterMacroColumns, setMasterMacroColumns] = useState(() => _onceCache.masterMacro ?? [])

  const [equityStale, setEquityStale] = useState(false)
  const [fiStale,     setFiStale]     = useState(false)
  const [macroStale,  setMacroStale]  = useState(false)

  const loadMetrics = (key) => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null } catch { return null } }
  const [selectedMetricsTable,      setSelectedMetricsTable]      = useState(() => loadMetrics('metricsFilter_table')       || [])
  const [selectedMetricsGraph,      setSelectedMetricsGraph]      = useState(() => loadMetrics('metricsFilter_graph')       || [])
  const [selectedFIMetricsTable,    setSelectedFIMetricsTable]    = useState(() => loadMetrics('fiMetricsFilter_table')     || [])
  const [selectedFIMetricsGraph,    setSelectedFIMetricsGraph]    = useState(() => loadMetrics('fiMetricsFilter_graph')     || [])
  const [selectedMacroMetricsTable, setSelectedMacroMetricsTable] = useState(() => (loadMetrics('macroMetricsFilter_table') || []).filter(k => ALL_MACRO_TABLE_METRICS.includes(k)))
  const [selectedMacroMetricsGraph, setSelectedMacroMetricsGraph] = useState(() => (loadMetrics('macroMetricsFilter_graph') || []).filter(k => ALL_MACRO_GRAPH_METRICS.includes(k)))

  useEffect(() => { try { localStorage.setItem('metricsFilter_table',      JSON.stringify(selectedMetricsTable))      } catch {} }, [selectedMetricsTable])
  useEffect(() => { try { localStorage.setItem('metricsFilter_graph',      JSON.stringify(selectedMetricsGraph))      } catch {} }, [selectedMetricsGraph])
  useEffect(() => { try { localStorage.setItem('fiMetricsFilter_table',    JSON.stringify(selectedFIMetricsTable))    } catch {} }, [selectedFIMetricsTable])
  useEffect(() => { try { localStorage.setItem('fiMetricsFilter_graph',    JSON.stringify(selectedFIMetricsGraph))    } catch {} }, [selectedFIMetricsGraph])
  useEffect(() => { try { localStorage.setItem('macroMetricsFilter_table', JSON.stringify(selectedMacroMetricsTable)) } catch {} }, [selectedMacroMetricsTable])
  useEffect(() => { try { localStorage.setItem('macroMetricsFilter_graph', JSON.stringify(selectedMacroMetricsGraph)) } catch {} }, [selectedMacroMetricsGraph])

  const handleMetricsChange      = (c) => { if (c.tableMetrics !== undefined) setSelectedMetricsTable(c.tableMetrics);       if (c.graphMetrics !== undefined) setSelectedMetricsGraph(c.graphMetrics) }
  const handleFIMetricsChange    = (c) => { if (c.tableMetrics !== undefined) setSelectedFIMetricsTable(c.tableMetrics);     if (c.graphMetrics !== undefined) setSelectedFIMetricsGraph(c.graphMetrics) }
  const handleMacroMetricsChange = (c) => { if (c.tableMetrics !== undefined) setSelectedMacroMetricsTable(c.tableMetrics);  if (c.graphMetrics !== undefined) setSelectedMacroMetricsGraph(c.graphMetrics) }

  const authHeaders = () => {
    const token = localStorage.getItem('auth_token')
    return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
                 : { 'Content-Type': 'application/json' }
  }

  const fetchData = async (endpoint, params, setData, setLoading, setError, cache, cacheKey) => {
    if (cache && cacheKey && cache[cacheKey]) { setData(cache[cacheKey]); return }
    try {
      setLoading(true); setError(null)
      const res = await fetch(`/api${endpoint}?${params.toString()}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      if (cache && cacheKey) cache[cacheKey] = result
      setData(result)
    } catch (err) { setError(err.message); setData(null) }
    finally { setLoading(false) }
  }

  const buildEquityParams = (f) => {
    const p = new URLSearchParams()
    p.append('regions', f.regions.join(','))
    if (f.customMode) { if (f.startDate) p.append('start_date', f.startDate); if (f.endDate) p.append('end_date', f.endDate) }
    p.append('lookback', f.lookback)
    p.append('currency', f.currency)
    return p
  }
  const buildFIParams = (f) => {
    const p = new URLSearchParams()
    p.append('regions', f.regions.join(','))
    if (f.customMode) { if (f.startDate) p.append('start_date', f.startDate); if (f.endDate) p.append('end_date', f.endDate) }
    p.append('lookback', f.lookback)
    return p
  }
  const buildMacroParams = (f) => {
    const p = new URLSearchParams()
    p.append('regions', ALL_REGIONS.join(','))
    if (f.customMode) { if (f.startDate) p.append('start_date', f.startDate); if (f.endDate) p.append('end_date', f.endDate) }
    p.append('lookback', f.lookback)
    return p
  }

  const fetchEquityFull = (f) => {
    fetchData('/countries/equity', buildEquityParams(f), setEquityData, setEquityLoading, setEquityError, _equityCache, _equityKey(f))
    const colKey = _equityColKey(f)
    if (_equityColCache[colKey]) { setEquityColumns(_equityColCache[colKey]); return }
    const p = new URLSearchParams()
    p.append('regions', f.regions.join(','))
    p.append('lookback', f.lookback)
    fetch(`/api/countries/equity/columns?${p.toString()}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(result => {
        if (result.status === 'ok') {
          const cols = result.columns || []
          _equityColCache[colKey] = cols
          setEquityColumns(cols)
          setSelectedMetricsTable(prev => prev.filter(m => cols.includes(m)))
          setSelectedMetricsGraph(prev => prev.filter(m => cols.includes(m) || VIRTUAL_GRAPH_METRICS.includes(m)))
        }
      })
      .catch(err => console.error('Failed to fetch equity columns:', err))
  }
  const fetchFIData    = (f) => fetchData('/countries/fixed-income', buildFIParams(f),    setFiData,    setFiLoading,    setFiError,    _fiCache,    _fiKey(f))
  const fetchMacroData = (f) => fetchData('/countries/macro',        buildMacroParams(f), setMacroData, setMacroLoading, setMacroError, _macroCache, _macroKey(f))

  // One-time master columns + ratings on mount
  useEffect(() => {
    if (_onceCache.masterEquity) { setMasterEquityColumns(_onceCache.masterEquity) } else {
      fetch('/api/countries/equity/columns-master', { headers: authHeaders() }).then(r => r.json()).then(result => {
        if (result.status === 'ok') {
          _onceCache.masterEquity = result.columns || []
          setMasterEquityColumns(_onceCache.masterEquity)
          if (selectedMetricsTable.length === 0 && selectedMetricsGraph.length === 0) {
            setSelectedMetricsTable(STANDARD_DEFAULTS.table)
            setSelectedMetricsGraph(STANDARD_DEFAULTS.graph)
          }
        }
      }).catch(console.error)
    }
    if (_onceCache.masterFI) { setMasterFIColumns(_onceCache.masterFI) } else {
      fetch('/api/countries/fixed-income/columns-master', { headers: authHeaders() }).then(r => r.json()).then(result => {
        if (result.status === 'ok') {
          _onceCache.masterFI = result.columns || []
          setMasterFIColumns(_onceCache.masterFI)
          if (selectedFIMetricsTable.length === 0 && selectedFIMetricsGraph.length === 0) {
            setSelectedFIMetricsTable(FI_STANDARD_DEFAULTS.table)
            setSelectedFIMetricsGraph(FI_STANDARD_DEFAULTS.graph)
          }
        }
      }).catch(console.error)
    }
    if (_onceCache.masterMacro) { setMasterMacroColumns(_onceCache.masterMacro) } else {
      fetch('/api/countries/macro/columns-master', { headers: authHeaders() }).then(r => r.json()).then(result => {
        if (result.status === 'ok') {
          _onceCache.masterMacro = result.columns || []
          setMasterMacroColumns(_onceCache.masterMacro)
          if (selectedMacroMetricsTable.length === 0 && selectedMacroMetricsGraph.length === 0) {
            setSelectedMacroMetricsTable(MACRO_STANDARD_DEFAULTS.table)
            setSelectedMacroMetricsGraph(MACRO_STANDARD_DEFAULTS.graph)
          }
        }
      }).catch(console.error)
    }
    if (_onceCache.ratings) { setRatingsData(_onceCache.ratings) } else {
      fetch('/api/countries/fixed-income/ratings', { headers: authHeaders() }).then(r => r.json()).then(result => {
        if (result.status === 'ok') { _onceCache.ratings = result.data || []; setRatingsData(_onceCache.ratings) }
      }).catch(console.error)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // FI A-BBB default: only if user has never saved FI prefs
  useEffect(() => {
    if (ratingsData.length === 0) return
    if (localStorage.getItem('länder_fi_filters')) return
    const FI_AVAILABLE = [...ALL_REGIONS.filter(r => !FI_EXCLUDED.has(r)), ...FI_ONLY_REGIONS]
    const aBbb = ratingsData
      .filter(r => r.SP && A_BBB_RATINGS.has(r.SP) && FI_AVAILABLE.includes(r.Regions) && r.Regions !== 'Japan')
      .map(r => r.Regions)
    if (aBbb.length > 0) setFiFilters(prev => ({ ...prev, regions: aBbb }))
  }, [ratingsData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Per-tab fetch effects: each fires independently on its own filter changes
  useEffect(() => {
    if (activeTabRef.current !== 'equity') { setEquityStale(true); return }
    const t = setTimeout(() => fetchEquityFull(equityFilters), 300)
    return () => clearTimeout(t)
  }, [equityFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTabRef.current !== 'fixed-income') { setFiStale(true); return }
    const t = setTimeout(() => fetchFIData(fiFilters), 300)
    return () => clearTimeout(t)
  }, [fiFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTabRef.current !== 'macro') { setMacroStale(true); return }
    const t = setTimeout(() => fetchMacroData(macroFilters), 300)
    return () => clearTimeout(t)
  }, [macroFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tab switch: fetch stale data for the newly active tab
  useEffect(() => {
    if (activeTab === 'equity'        && equityStale) { fetchEquityFull(equityFilters); setEquityStale(false) }
    else if (activeTab === 'fixed-income' && fiStale) { fetchFIData(fiFilters);         setFiStale(false) }
    else if (activeTab === 'macro'   && macroStale)   { fetchMacroData(macroFilters);   setMacroStale(false) }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive current-tab props for GlobalControls
  const curFilters      = activeTab === 'equity' ? equityFilters    : activeTab === 'fixed-income' ? fiFilters    : macroFilters
  const curSetFilters   = activeTab === 'equity' ? setEquityFilters : activeTab === 'fixed-income' ? setFiFilters : setMacroFilters
  const curChartType    = activeTab === 'equity' ? equityChartType  : activeTab === 'fixed-income' ? fiChartType  : macroChartType
  const curSetChartType = activeTab === 'equity' ? setEquityChartType : activeTab === 'fixed-income' ? setFiChartType : setMacroChartType

  const handleFiltersChange   = (changes) => curSetFilters(prev => ({ ...prev, ...changes }))
  const handleChartTypeChange = (type) => curSetChartType(type)

  return (
    <div className="länder-container">
      {/* key=activeTab forces GlobalControls remount on tab switch so uncontrolled
          date inputs reset their defaultValues to the restored tab's dates */}
      <GlobalControls
        key={activeTab}
        filters={curFilters}
        onFiltersChange={handleFiltersChange}
        activeTab={activeTab}
        availableMetrics={activeTab === 'equity' ? [...masterEquityColumns, ...VIRTUAL_GRAPH_METRICS] : []}
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
        chartType={curChartType}
        onChartTypeChange={handleChartTypeChange}
        ratingsData={ratingsData}
      />

      <div className="länder-tabs">
        <div className="tab-buttons">
          <button className={`tab-button ${activeTab === 'equity'       ? 'active' : ''}`} onClick={() => onActiveTabChange('equity')}> Aktien</button>
          <button className={`tab-button ${activeTab === 'fixed-income' ? 'active' : ''}`} onClick={() => onActiveTabChange('fixed-income')}> Anleihen</button>
          <button className={`tab-button ${activeTab === 'macro'        ? 'active' : ''}`} onClick={() => onActiveTabChange('macro')}> Makro</button>
        </div>

        <div className="tab-content">
          {activeTab === 'equity' && (
            <EquityTab
              filters={equityFilters}
              data={equityData}
              loading={equityLoading}
              error={equityError}
              columns={equityColumns}
              columnsLoading={equityColumnsLoading}
              selectedMetricsTable={selectedMetricsTable}
              selectedMetricsGraph={selectedMetricsGraph}
              chartsPerRow={gs.equity?.chartsPerRow ?? 2}
              chartHeight={gs.equity?.chartHeight ?? 450}
              lineWidth={gs.equity?.lineWidth ?? 3}
              chartType={equityChartType}
            />
          )}
          {activeTab === 'fixed-income' && (
            <FixedIncomeTab
              filters={fiFilters}
              data={fiData}
              loading={fiLoading}
              error={fiError}
              selectedMetricsTable={selectedFIMetricsTable}
              selectedMetricsGraph={selectedFIMetricsGraph}
              chartsPerRow={gs.fi?.chartsPerRow ?? 2}
              chartHeight={gs.fi?.chartHeight ?? 450}
              lineWidth={gs.fi?.lineWidth ?? 3}
              chartType={fiChartType}
              ratingsData={ratingsData}
            />
          )}
          {activeTab === 'macro' && (
            <MacroTab
              filters={macroFilters}
              data={macroData}
              loading={macroLoading}
              error={macroError}
              selectedMetricsTable={selectedMacroMetricsTable}
              selectedMetricsGraph={selectedMacroMetricsGraph}
              chartsPerRow={gs.macro?.chartsPerRow ?? 2}
              chartHeight={gs.macro?.chartHeight ?? 450}
              lineWidth={gs.macro?.lineWidth ?? 3}
              chartType={macroChartType}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default Länder
