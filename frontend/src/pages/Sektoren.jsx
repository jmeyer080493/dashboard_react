/**
 * Sektoren (Sector Analysis) Page
 *
 * Displays 4 PE ratio charts across three views (U.S. · Europe · U.S. vs. Europe):
 *   g1: KGV (PE Ratio)
 *   g2: KGV (Fwd.) (Forward PE Ratio)
 *   g3: KGV - KGV (Fwd.) (PE Difference)
 *   g4: KGV vs. KGV (Fwd.) (Both fields together)
 *
 * Controls:
 *   - Quick date-range buttons (MtD, YtD, 1Y, 3Y, 7Y, All)
 *   - Manual start / end date inputs (controlled, ISO format YYYY-MM-DD)
 *   - View selector (region)
 *   - Chart type (Line / Bar)
 *   - Sector dropdown selector with multi-select, Alle/Keine buttons
 *
 * State persistence: all filter state is saved to localStorage under 'sektoren_filters'.
 * Each chart exposes PPTX + XLSX export via the shared ExportContext.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import SektorenChart from '../components/SektorenChart'
import './Sektoren.css'

// Close dropdown on outside click
function useClickOutside(ref, callback) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [ref, callback])
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_BUTTONS = ['MtD', 'YtD', '1Y', '3Y', '7Y', 'All']
const GRAPH_NAMES  = ['g1', 'g2', 'g3', 'g4']

const VIEW_CONFIG = [
  { id: 'U.S.',            label: 'USA'            },
  { id: 'Europe',          label: 'Europa'         },
  { id: 'U.S. vs. Europe', label: 'USA vs. Europa' },
]

const CHART_TYPES = [
  { id: 'Line', label: 'Linie'   },
  { id: 'Bar',  label: 'Balken'  },
]

const ALL_SECTORS = [
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Financials',
  'Health Care',
  'Industrials',
  'Information Technology',
  'Materials',
  'Real Estate',
  'Utilities',
]

const SECTOR_DE = {
  'Communication Services':  'Kommunikation',
  'Consumer Discretionary':  'Zyklische Konsumgüter',
  'Consumer Staples':        'Nicht-zyklische Konsumgüter',
  'Energy':                  'Energie',
  'Financials':              'Finanzen',
  'Health Care':             'Gesundheitswesen',
  'Industrials':             'Industrie',
  'Information Technology':  'Informationstechnologie',
  'Materials':               'Rohstoffe',
  'Real Estate':             'Immobilien',
  'Utilities':               'Versorger',
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function computeDateRange(lookback) {
  const today = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const end = fmt(today)
  let start
  if (lookback === 'MtD') {
    start = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`
  } else if (lookback === 'YtD') {
    start = `${today.getFullYear() - 1}-12-31`
  } else if (lookback === '1Y') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 1); start = fmt(d)
  } else if (lookback === '3Y') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 3); start = fmt(d)
  } else if (lookback === '7Y') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 7); start = fmt(d)
  } else {
    start = '1990-01-01'
  }
  return { start, end }
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sektoren_filters'

function loadSavedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const defaults = computeDateRange('1Y')
    return {
      view:            saved.view            || 'U.S.',
      lookback:        saved.lookback        || '1Y',
      startDate:       saved.startDate       || defaults.start,
      endDate:         saved.endDate         || defaults.end,
      customMode:      saved.customMode      ?? false,
      chartType:       saved.chartType       || 'Line',
      selectedSectors: Array.isArray(saved.selectedSectors) && saved.selectedSectors.length > 0
                         ? saved.selectedSectors
                         : ALL_SECTORS,
    }
  } catch {
    const defaults = computeDateRange('1Y')
    return { view: 'U.S.', lookback: '1Y', customMode: false, chartType: 'Line', selectedSectors: ALL_SECTORS, ...defaults }
  }
}

const isValidDate = s => /^[0-9]{4}(?:-|\/|\.)(0?[1-9]|1[0-2])(?:-|\/|\.)(0?[1-9]|[12][0-9]|3[01])$/.test(s)

// ── Module-level data cache (survives component unmount / tab switch) ──────────
const _graphsCache    = {}   // cacheKey → graphs  (filtered window)
const _allGraphsCache = {}   // cacheKey → graphs  (full history)

// Normalize flexible date format to YYYY-MM-DD
function normalizeDate(dateStr) {
  const match = dateStr.match(/^(\d{4})(?:-|\/|\.)(\d{1,2})(?:-|\/|\.)(\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Sektoren({ graphSettings }) {
  const gs = graphSettings ?? {}
  const chartsPerRow = gs.sektoren?.chartsPerRow ?? 2
  const chartHeight  = gs.sektoren?.chartHeight  ?? 450
  const lineWidth    = gs.sektoren?.lineWidth    ?? 2

  // Seed state from localStorage once at mount
  const _initRef = useRef(null)
  if (_initRef.current === null) _initRef.current = loadSavedFilters()
  const _init = _initRef.current

  const [view,            setView]            = useState(_init.view)
  const [lookback,        setLookback]        = useState(_init.lookback)
  const [startDate,       setStartDate]       = useState(_init.startDate)
  const [endDate,         setEndDate]         = useState(_init.endDate)
  const [customMode,      setCustomMode]      = useState(_init.customMode)
  const [chartType,       setChartType]       = useState(_init.chartType)
  const [selectedSectors, setSelectedSectors] = useState(_init.selectedSectors)
  const [showSectorDropdown, setShowSectorDropdown] = useState(false)
  const sectorDropdownRef = useRef(null)

  useClickOutside(sectorDropdownRef, () => setShowSectorDropdown(false))

  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [graphsData, setGraphsData] = useState(() => {
    const k = `${_init.view}|${_init.lookback}|${_init.startDate}|${_init.endDate}|${_init.selectedSectors.join(',')}`
    return _graphsCache[k] ?? null
  })
  const [allGraphsData, setAllGraphsData] = useState(() => {
    const k = `all|${_init.view}|${_init.selectedSectors.join(',')}`
    return _allGraphsCache[k] ?? null
  })

  // Persist to localStorage on every filter change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      { view, lookback, startDate, endDate, customMode, chartType, selectedSectors }
    ))
  }, [view, lookback, startDate, endDate, customMode, chartType, selectedSectors])

  // ── Handlers ─────────────────────────────────────────────────────────────

  // Calculate combined y-axis domain for KGV and KGV (Fwd.) in bar mode
  const calculateCombinedBarDomain = (g1Data, g2Data, g1Series, g2Series) => {
    if (!g1Data?.length || !g2Data?.length || !g1Series?.length || !g2Series?.length) return null
    const allVals = []
    // Collect all values from both datasets
    for (const row of g1Data) {
      for (const s of g1Series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v)) allVals.push(v)
      }
    }
    for (const row of g2Data) {
      for (const s of g2Series) {
        const v = row[s]
        if (v != null && !Number.isNaN(v)) allVals.push(v)
      }
    }
    if (allVals.length === 0) return null
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const pad = (max - min) * 0.1
    return [Math.max(0, min - pad), max + pad]
  }

  const handleLookbackBtn = btn => {
    const { start, end } = computeDateRange(btn)
    setLookback(btn); setStartDate(start); setEndDate(end); setCustomMode(false)
  }

  // Uncontrolled inputs (key+defaultValue); only fires on blur/Enter
  const commitDate = (field, value) => {
    if (value === (field === 'start' ? startDate : endDate)) return // No change
    const datePattern = /^[0-9]{4}(?:-|\/|\.)(0?[1-9]|1[0-2])(?:-|\/|\.)(0?[1-9]|[12][0-9]|3[01])$/
    if (value && !datePattern.test(value)) return // Invalid format, reject silently
    const normalized = value ? normalizeDate(value) : ''
    if (field === 'start') setStartDate(normalized)
    else setEndDate(normalized)
    setCustomMode(true)
  }

  const toggleSector = sector => {
    setSelectedSectors(prev =>
      prev.includes(sector)
        ? prev.filter(s => s !== sector)
        : [...prev, sector]
    )
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return
    if (selectedSectors.length === 0) { setGraphsData(null); return }

    const cacheKey = `${view}|${lookback}|${startDate}|${endDate}|${selectedSectors.join(',')}`
    if (_graphsCache[cacheKey]) {
      setGraphsData(_graphsCache[cacheKey])
      return
    }

    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({
        view,
        lookback,
        start_date: startDate,
        end_date:   endDate,
        sectors:    selectedSectors.join(','),
      })
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`/api/sektoren/data?${params}`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.status === 'error') throw new Error(json.error)
      _graphsCache[cacheKey] = json.graphs
      setGraphsData(json.graphs)
    } catch (err) {
      setError(err.message)
      setGraphsData(null)
    } finally {
      setLoading(false)
    }
  }, [view, lookback, startDate, endDate, selectedSectors])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Secondary "All" fetch – full history for local per-chart period overrides ──
  const fetchAllData = useCallback(async () => {
    if (selectedSectors.length === 0) return

    const allCacheKey = `all|${view}|${selectedSectors.join(',')}`
    if (_allGraphsCache[allCacheKey]) {
      setAllGraphsData(_allGraphsCache[allCacheKey])
      return
    }

    try {
      const { start, end } = computeDateRange('All')
      const params = new URLSearchParams({ view, lookback: 'All', start_date: start, end_date: end, sectors: selectedSectors.join(',') })
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`/api/sektoren/data?${params}`, { headers })
      if (!res.ok) return
      const json = await res.json()
      if (json.status !== 'error') {
        _allGraphsCache[allCacheKey] = json.graphs
        setAllGraphsData(json.graphs)
      }
    } catch {}
  }, [view, selectedSectors])
  useEffect(() => { fetchAllData() }, [fetchAllData])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sektoren-page">

      {/* Controls */}
      <div className="sektoren-controls">

        {/* Zeitraum */}
        <div className="sektoren-control-section">
          <label>Zeitraum</label>
          <div className="sektoren-btn-group">
            {DATE_BUTTONS.map(btn => (
              <button
                key={btn}
                className={`quick-btn${!customMode && lookback === btn ? ' active' : ''}`}
                onClick={() => handleLookbackBtn(btn)}
              >
                {btn}
              </button>
            ))}
          </div>
          <div className="sektoren-date-inputs">
            <input
              key={startDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={startDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('start', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('start', e.target.value) }}
              className="sektoren-date-input"
            />
            <span className="sektoren-date-sep">–</span>
            <input
              key={endDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={endDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('end', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('end', e.target.value) }}
              className="sektoren-date-input"
            />
          </div>
        </div>

        {/* Ansicht */}
        <div className="sektoren-control-section">
          <label>Ansicht</label>
          <div className="sektoren-btn-group">
            {VIEW_CONFIG.map(v => (
              <button
                key={v.id}
                className={`quick-btn${view === v.id ? ' active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Charttyp – "Linie" disabled for "U.S. vs. Europa" (always Bar in that view) */}
        <div className="sektoren-control-section">
          <label>Charttyp</label>
          <div className="sektoren-btn-group">
            {CHART_TYPES.map(ct => {
              const isDisabled = view === 'U.S. vs. Europe' && ct.id === 'Line'
              return (
                <button
                  key={ct.id}
                  className={`quick-btn${!isDisabled && chartType === ct.id ? ' active' : ''}`}
                  onClick={() => !isDisabled && setChartType(ct.id)}
                  disabled={isDisabled}
                >
                  {ct.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Sektoren */}
        <div className="sektoren-control-section sektoren-sector-section">
          <label>Sektoren</label>
          <div className="sektoren-sector-multiselect" ref={sectorDropdownRef}>
            <button
              className={`sektoren-sector-trigger ${showSectorDropdown ? 'open' : ''}`}
              onClick={() => setShowSectorDropdown(v => !v)}
              title={selectedSectors.map(s => SECTOR_DE[s] || s).join(', ') || 'Keine Sektoren ausgewählt'}
            >
              <span className="sektoren-sector-value">
                {selectedSectors.length === 0
                  ? 'Keine'
                  : selectedSectors.length === ALL_SECTORS.length
                  ? `Alle (${ALL_SECTORS.length})`
                  : selectedSectors.map(s => s.split(' ').map(w => w[0]).join('')).join(', ')}
              </span>
              <span className="sektoren-sector-arrow">{showSectorDropdown ? '▴' : '▾'}</span>
            </button>

            {showSectorDropdown && (
              <div className="sektoren-sector-dropdown">
                <div className="sektoren-sector-actions">
                  <button onClick={() => setSelectedSectors([...ALL_SECTORS])}>Alle</button>
                  <button onClick={() => setSelectedSectors([])}>Keine</button>
                </div>
                <div className="sektoren-sector-list">
                  {ALL_SECTORS.map(sector => {
                    const checked = selectedSectors.includes(sector)
                    return (
                      <label
                        key={sector}
                        className={`sektoren-sector-option ${checked ? 'checked' : ''}`}
                        title={sector}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSector(sector)}
                        />
                        <span className="sektoren-sector-name">{SECTOR_DE[sector] || sector}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Status */}
      {loading && <div className="sektoren-status loading">Daten werden geladen…</div>}
      {error   && <div className="sektoren-status error">❌ Fehler: {error}</div>}

      {/* Chart grid */}
      {!loading && graphsData && (() => {
        // In Bar mode, g4 (KGV vs. KGV (Fwd.)) is Line-only → hide it
        const effectiveChartType = view === 'U.S. vs. Europe' ? 'Bar' : chartType
        const isComparison = view === 'U.S. vs. Europe'
        const visibleGraphs = effectiveChartType === 'Bar'
          ? ['g1', 'g2', 'g3']
          : GRAPH_NAMES
        
        // Calculate combined domain for KGV and KGV (Fwd.) in bar mode
        let barDomainG1G2 = null
        if (effectiveChartType === 'Bar' && graphsData.g1 && graphsData.g2) {
          barDomainG1G2 = calculateCombinedBarDomain(
            graphsData.g1.data,
            graphsData.g2.data,
            graphsData.g1.series,
            graphsData.g2.series
          )
        }

        return (
          <div
            className="sektoren-chart-grid"
            style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
          >
            {visibleGraphs.map(gn => {
              const g = graphsData[gn]
              if (!g) return null
              
              // Use combined domain for g1 and g2 in bar mode
              const useFixedDomain = effectiveChartType === 'Bar' && (gn === 'g1' || gn === 'g2') ? barDomainG1G2 : null
              
              return (
                <SektorenChart
                  key={`${gn}-${view}`}
                  title={g.title}
                  data={g.data}
                  series={g.series}
                  colors={g.colors}
                  chartType={effectiveChartType}
                  isComparison={isComparison}
                  height={chartHeight}
                  tab="Sektoren"
                  yAxisLabel="Wert"
                  fixedYDomain={useFixedDomain}
                  globalPeriod={lookback}
                  allData={allGraphsData?.[gn]?.data ?? null}                lineWidth={lineWidth}                />
              )
            })}
          </div>
        )
      })()}

      {!loading && !error && selectedSectors.length === 0 && (
        <div className="sektoren-empty">Bitte mindestens einen Sektor auswählen.</div>
      )}
      {!loading && !error && graphsData === null && selectedSectors.length > 0 && (
        <div className="sektoren-empty">Keine Daten verfügbar.</div>
      )}
    </div>
  )
}
