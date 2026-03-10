/**
 * Sektoren (Sector Analysis) Page
 *
 * Displays 4 PE ratio charts across three views (U.S. · Europe · U.S. vs. Europe):
 *   g1: KGV (PE Ratio)
 *   g2: Erwartetes KGV (Forward PE Ratio)
 *   g3: KGV - Erwartetes KGV (PE Difference)
 *   g4: KGV vs. Erwartetes KGV (Both fields together)
 *
 * Controls:
 *   - Quick date-range buttons (MtD, YtD, 1Y, 3Y, 7Y, All)
 *   - Manual start / end date inputs (controlled, ISO format YYYY-MM-DD)
 *   - View selector (region)
 *   - Chart type (Line / Bar)
 *   - Individual sector toggles + "Alle" shortcut
 *
 * State persistence: all filter state is saved to localStorage under 'sektoren_filters'.
 * Each chart exposes PPTX + XLSX export via the shared ExportContext.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import SektorenChart from '../components/SektorenChart'
import './Sektoren.css'

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

  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [graphsData, setGraphsData] = useState(null)

  // Persist to localStorage on every filter change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      { view, lookback, startDate, endDate, customMode, chartType, selectedSectors }
    ))
  }, [view, lookback, startDate, endDate, customMode, chartType, selectedSectors])

  // ── Handlers ─────────────────────────────────────────────────────────────

  // Calculate combined y-axis domain for KGV and Erwartetes KGV in bar mode
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

  // "Alle" toggles: if all are selected → deselect all; otherwise → select all
  const toggleAllSectors = () => {
    setSelectedSectors(prev =>
      prev.length === ALL_SECTORS.length ? [] : [...ALL_SECTORS]
    )
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return
    if (selectedSectors.length === 0) { setGraphsData(null); return }
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
      setGraphsData(json.graphs)
    } catch (err) {
      setError(err.message)
      setGraphsData(null)
    } finally {
      setLoading(false)
    }
  }, [view, lookback, startDate, endDate, selectedSectors])

  useEffect(() => { fetchData() }, [fetchData])

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
          <label>
            Sektoren
            <button
              className={`sektoren-all-btn${selectedSectors.length === ALL_SECTORS.length ? ' active' : ''}`}
              onClick={toggleAllSectors}
            >Alle</button>
          </label>
          <div className="sektoren-sector-btns">
            {ALL_SECTORS.map(sector => (
              <button
                key={sector}
                className={`quick-btn sektoren-sector-btn${selectedSectors.includes(sector) ? ' active' : ''}`}
                onClick={() => toggleSector(sector)}
              >
                {SECTOR_DE[sector] || sector}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Status */}
      {loading && <div className="sektoren-status loading">Daten werden geladen…</div>}
      {error   && <div className="sektoren-status error">❌ Fehler: {error}</div>}

      {/* Chart grid */}
      {!loading && graphsData && (() => {
        // In Bar mode, g4 (KGV vs. Erwartetes KGV) is Line-only → hide it
        const effectiveChartType = view === 'U.S. vs. Europe' ? 'Bar' : chartType
        const isComparison = view === 'U.S. vs. Europe'
        const visibleGraphs = effectiveChartType === 'Bar'
          ? ['g1', 'g2', 'g3']
          : GRAPH_NAMES
        
        // Calculate combined domain for KGV and Erwartetes KGV in bar mode
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
                  key={`${gn}-${view}-${effectiveChartType}`}
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
                />
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
