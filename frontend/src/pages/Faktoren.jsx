/**
 * Faktoren (Factor Analysis) Page
 *
 * Displays 6 cumulative-return charts for equity factor indices (MSCI) across
 * four configurable views:  U.S. · Europe · U.S. vs. Europe · World
 *
 * Controls:
 *   - Quick date-range buttons (MtD, YtD, 1Y, 3Y, 7Y, All)
 *   - Manual start / end date inputs
 *   - View selector (region / comparison mode)
 *   - Currency selector (USD / EUR)
 *
 * Each chart supports PPTX + XLSX export via the shared ExportContext.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import FaktorenChart from '../components/FaktorenChart'
import './Faktoren.css'

// ── Constants ────────────────────────────────────────────────────────────────

const DATE_BUTTONS = ['MtD', 'YtD', '1Y', '3Y', '7Y', 'All']
const GRAPH_NAMES  = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']

const VIEW_CONFIG = [
  { id: 'U.S.',            label: 'USA'            },
  { id: 'Europe',          label: 'Europa'         },
  { id: 'U.S. vs. Europe', label: 'USA vs. Europa' },
  { id: 'World',           label: 'Welt'           },
]

const CURRENCY_CONFIG = [
  { id: 'USD', label: 'USD' },
  { id: 'EUR', label: 'EUR' },
]

// ── Date helpers ─────────────────────────────────────────────────────────────

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
    start = '1900-01-01'
  }
  return { start, end }
}

// ── Persistence key ───────────────────────────────────────────────────────────
const STORAGE_KEY = 'faktoren_filters'

function loadSavedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const defaults = computeDateRange('1Y')
    return {
      view:       saved.view       || 'U.S.',
      currency:   saved.currency   || 'USD',
      lookback:   saved.lookback   || '1Y',
      startDate:  saved.startDate  || defaults.start,
      endDate:    saved.endDate    || defaults.end,
      customMode: saved.customMode || false,
    }
  } catch {
    const defaults = computeDateRange('1Y')
    return { view: 'U.S.', currency: 'USD', lookback: '1Y', customMode: false, ...defaults }
  }
}

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// ── Component ─────────────────────────────────────────────────────────────────

export default function Faktoren({ graphSettings }) {
  const gs = graphSettings ?? {}
  const chartsPerRow = gs.faktoren?.chartsPerRow ?? 3
  const chartHeight  = gs.faktoren?.chartHeight  ?? 450

  // ── Filter state (seeded from localStorage once at mount) ──────────────────
  // useRef ensures loadSavedFilters() is called only once, not on every render
  const _initRef = useRef(null)
  if (_initRef.current === null) _initRef.current = loadSavedFilters()
  const _init = _initRef.current

  const [view,       setView]       = useState(_init.view)
  const [currency,   setCurrency]   = useState(_init.currency)
  const [lookback,   setLookback]   = useState(_init.lookback)
  const [startDate,  setStartDate]  = useState(_init.startDate)
  const [endDate,    setEndDate]    = useState(_init.endDate)
  const [customMode, setCustomMode] = useState(_init.customMode)

  // ── Data state ───────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [graphsData, setGraphsData] = useState(null) // { g1: {...}, ... }

  // ── Persist filters to localStorage whenever they change ─────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, currency, lookback, startDate, endDate, customMode }))
  }, [view, currency, lookback, startDate, endDate, customMode])

  // ── Date-range button handler ─────────────────────────────────────────────
  const handleLookbackBtn = (btn) => {
    const { start, end } = computeDateRange(btn)
    setLookback(btn)
    setStartDate(start)
    setEndDate(end)
    setCustomMode(false)
  }

  // ── Controlled date input handlers ───────────────────────────────────────
  const handleStartDateChange = (e) => {
    setStartDate(e.target.value)
    setCustomMode(true)
  }
  const handleEndDateChange = (e) => {
    setEndDate(e.target.value)
    setCustomMode(true)
  }

  // ── Fetch data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    // Only fetch when both dates are valid YYYY-MM-DD
    if (!isValidDate(startDate) || !isValidDate(endDate)) return

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        view,
        currency,
        start_date: startDate,
        end_date:   endDate,
        lookback,
      })
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`/api/faktoren/data?${params}`, { headers })
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
  }, [view, currency, startDate, endDate, lookback])

  // Re-fetch whenever relevant filters change
  useEffect(() => { fetchData() }, [fetchData])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="faktoren-page">

      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div className="faktoren-controls">

        {/* Date range */}
        <div className="faktoren-control-section">
          <label>Zeitraum</label>
          <div className="faktoren-btn-group">
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
          <div className="faktoren-date-inputs">
            <input
              type="text"
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChange={handleStartDateChange}
              className="faktoren-date-input"
            />
            <span className="faktoren-date-sep">–</span>
            <input
              type="text"
              placeholder="YYYY-MM-DD"
              value={endDate}
              onChange={handleEndDateChange}
              className="faktoren-date-input"
            />
          </div>
        </div>

        {/* View selector */}
        <div className="faktoren-control-section">
          <label>Ansicht</label>
          <div className="faktoren-btn-group">
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

        {/* Currency selector */}
        <div className="faktoren-control-section">
          <label>Währung</label>
          <div className="faktoren-btn-group">
            {CURRENCY_CONFIG.map(c => (
              <button
                key={c.id}
                className={`quick-btn${currency === c.id ? ' active' : ''}`}
                onClick={() => setCurrency(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      {loading && (
        <div className="faktoren-status loading">📊 Daten werden geladen…</div>
      )}
      {error && (
        <div className="faktoren-status error">❌ Fehler: {error}</div>
      )}

      {/* ── Chart grid ────────────────────────────────────────────────────── */}
      {!loading && graphsData && (
        <div
          className="faktoren-chart-grid"
          style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
        >
          {GRAPH_NAMES.map(gn => {
            const g = graphsData[gn]
            if (!g) return null
            return (
              <FaktorenChart
                key={gn}
                title={g.title}
                data={g.data}
                series={g.series}
                hasDifference={g.has_difference}
                height={chartHeight}
                tab="Faktoren"
              />
            )
          })}
        </div>
      )}

      {!loading && !error && !graphsData && (
        <div className="faktoren-empty">Keine Daten verfügbar.</div>
      )}
    </div>
  )
}

