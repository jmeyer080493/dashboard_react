/**
 * Alternativ (Konsum USA / Consumer Activity) Page
 *
 * Displays 6 charts of US consumer/entertainment activity indices:
 *   g1 – TSA Reisende
 *   g2 – Kinokartenverkäufe USA
 *   g3 – Tägliche Restaurantreservierungen (OpenTable)
 *   g4 – Monatliche Restaurantreservierungen (OpenTable)
 *   g5 – Broadway Bruttoverkäufe
 *   g6 – Broadway Besucherzahlen
 *
 * Controls:
 *   - Quick date-range buttons (MtD, YtD, 1Y, 3Y, 7Y, All)
 *   - Manual start / end date inputs
 *
 * Each chart supports PPTX + XLSX export via the shared ExportContext.
 * State (lookback, dates) is persisted in localStorage across tab switches.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import FaktorenChart from '../components/FaktorenChart'
import './Alternativ.css'

// ── Constants ──────────────────────────────────────────────────────────────

const DATE_BUTTONS = ['MtD', 'YtD', '1Y', '3Y', '7Y', 'All']
const GRAPH_NAMES  = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']

/**
 * Y-axis unit per graph:
 *   g1 TSA Reisende          → millions ("34.1M")
 *   g2 Kinokartenverkäufe    → billions ("1.23B")
 *   g3 OpenTable daily       → percent  ("12 %")
 *   g4 OpenTable monthly     → percent  ("12 %")
 *   g5 Broadway Gross        → billions ("1.23B")
 *   g6 Broadway Attendance   → percent  ("12 %")
 */
const GRAPH_Y_UNIT = { g1: 'M', g2: 'B', g3: 'pct', g4: 'pct', g5: 'B', g6: 'pct' }

// ── Date helpers ───────────────────────────────────────────────────────────

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

// ── Persistence ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'alternativ_filters'

function loadSavedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const defaults = computeDateRange('1Y')
    return {
      lookback:   saved.lookback   || '1Y',
      startDate:  saved.startDate  || defaults.start,
      endDate:    saved.endDate    || defaults.end,
      customMode: saved.customMode || false,
    }
  } catch {
    const defaults = computeDateRange('1Y')
    return { lookback: '1Y', customMode: false, ...defaults }
  }
}

const isValidDate = s => /^[0-9]{4}(?:-|\/|\.)(0?[1-9]|1[0-2])(?:-|\/|\.)(0?[1-9]|[12][0-9]|3[01])$/.test(s)

// Normalize flexible date format (YYYY-MM-DD, YYYY/MM/D, etc.) to YYYY-MM-DD
function normalizeDate(dateStr) {
  const match = dateStr.match(/^(\d{4})(?:-|\/|\.)(\d{1,2})(?:-|\/|\.)(\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Alternative({ graphSettings }) {
  const gs = graphSettings ?? {}
  const chartsPerRow = gs.alternativ?.chartsPerRow ?? 2
  const chartHeight  = gs.alternativ?.chartHeight  ?? 450
  const lineWidth    = gs.alternativ?.lineWidth    ?? 2

  // ── Filter state (seeded from localStorage once at mount) ─────────────
  const _initRef = useRef(null)
  if (_initRef.current === null) _initRef.current = loadSavedFilters()
  const _init = _initRef.current

  const [lookback,   setLookback]   = useState(_init.lookback)
  const [startDate,  setStartDate]  = useState(_init.startDate)
  const [endDate,    setEndDate]    = useState(_init.endDate)
  const [customMode, setCustomMode] = useState(_init.customMode)

  // ── Data state ─────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [graphsData, setGraphsData] = useState(null)  // { g1: {...}, … g6: {...} }

  // ── Persist filters ────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lookback, startDate, endDate, customMode }))
  }, [lookback, startDate, endDate, customMode])

  // ── Date-range button handler ──────────────────────────────────────────
  const handleLookbackBtn = (btn) => {
    const { start, end } = computeDateRange(btn)
    setLookback(btn)
    setStartDate(start)
    setEndDate(end)
    setCustomMode(false)
  }

  // ── Date input commit handler ────────────────────────────────────────
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

  // ── Fetch data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ lookback, start_date: startDate, end_date: endDate })
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`/api/alternativ/data?${params}`, { headers })
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
  }, [lookback, startDate, endDate])

  // Re-fetch whenever filter values change
  useEffect(() => { fetchData() }, [fetchData])

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="alternativ-page">

      {/* ── Controls bar ────────────────────────────────────────────── */}
      <div className="alternativ-controls">

        {/* Date range */}
        <div className="alternativ-control-section">
          <label>Zeitraum</label>
          <div className="alternativ-btn-group">
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
          <div className="alternativ-date-inputs">
            <input
              key={startDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={startDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('start', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('start', e.target.value) }}
              className="alternativ-date-input"
            />
            <span className="alternativ-date-sep">–</span>
            <input
              key={endDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={endDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('end', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('end', e.target.value) }}
              className="alternativ-date-input"
            />
          </div>
        </div>

      </div>

      {/* ── Status messages ──────────────────────────────────────────── */}
      {loading && (
        <div className="alternativ-status loading">📊 Daten werden geladen…</div>
      )}
      {error && (
        <div className="alternativ-status error">❌ Fehler: {error}</div>
      )}

      {/* ── Chart grid ───────────────────────────────────────────────── */}
      {!loading && graphsData && (
        <div
          className="alternativ-chart-grid"
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
                tab="Alternativ"
                yUnit={GRAPH_Y_UNIT[gn] ?? 'pct'}
                yDomainAuto
                lineWidth={lineWidth}
              />
            )
          })}
        </div>
      )}

      {!loading && !error && !graphsData && (
        <div className="alternativ-empty">Keine Daten verfügbar.</div>
      )}

    </div>
  )
}
