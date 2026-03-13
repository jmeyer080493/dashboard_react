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
  { id: 'EUR', label: 'EUR' },
  { id: 'USD', label: 'USD' },
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
      currency:   saved.currency   || 'EUR',
      lookback:   saved.lookback   || '1Y',
      startDate:  saved.startDate  || defaults.start,
      endDate:    saved.endDate    || defaults.end,
      customMode: saved.customMode || false,
      chartType:  saved.chartType  || 'Line',
    }
  } catch {
    const defaults = computeDateRange('1Y')
    return { view: 'U.S.', currency: 'EUR', lookback: '1Y', customMode: false, chartType: 'Line', ...defaults }
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

// ── Module-level data cache (survives component unmount / tab switch) ──────────
const _graphsCache    = {}   // cacheKey → graphs  (filtered window)
const _allGraphsCache = {}   // cacheKey → graphs  (full history)
const _inflight       = {}   // cacheKey → Promise  (in-flight requests – deduplicates StrictMode double-fires)
const _allInflight    = {}   // allCacheKey → Promise

// ── Component ─────────────────────────────────────────────────────────────────

export default function Faktoren({ graphSettings }) {
  const gs = graphSettings ?? {}
  const chartsPerRow = gs.faktoren?.chartsPerRow ?? 3
  const chartHeight  = gs.faktoren?.chartHeight  ?? 450
  const lineWidth    = gs.faktoren?.lineWidth    ?? 2

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
  const [chartType,  setChartType]  = useState(_init.chartType)

  // ── Data state ───────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [graphsData, setGraphsData] = useState(() => {
    const k = `${_init.view}|${_init.currency}|${_init.lookback}|${_init.startDate}|${_init.endDate}`
    return _graphsCache[k] ?? null
  })
  const [allGraphsData, setAllGraphsData] = useState(() => {
    const k = `all|${_init.view}|${_init.currency}`
    return _allGraphsCache[k] ?? null
  })

  // ── Persist filters to localStorage whenever they change ─────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, currency, lookback, startDate, endDate, customMode, chartType }))
  }, [view, currency, lookback, startDate, endDate, customMode, chartType])

  // ── Date-range button handler ─────────────────────────────────────────────
  const handleLookbackBtn = (btn) => {
    const { start, end } = computeDateRange(btn)
    setLookback(btn)
    setStartDate(start)
    setEndDate(end)
    setCustomMode(false)
  }

  // ── Date input commit handler ─────────────────────────────────────────────
  // Inputs are uncontrolled (key+defaultValue); this only fires on blur/Enter
  const commitDate = (field, value) => {
    if (value === (field === 'start' ? startDate : endDate)) return // No change
    const datePattern = /^[0-9]{4}(?:-|\/|\.)(0?[1-9]|1[0-2])(?:-|\/|\.)(0?[1-9]|[12][0-9]|3[01])$/
    if (value && !datePattern.test(value)) return // Invalid format, reject silently
    const normalized = value ? normalizeDate(value) : ''
    if (field === 'start') setStartDate(normalized)
    else setEndDate(normalized)
    setCustomMode(true)
  }

  // ── Fetch data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    // Only fetch when both dates are valid YYYY-MM-DD
    if (!isValidDate(startDate) || !isValidDate(endDate)) return

    const cacheKey = `${view}|${currency}|${lookback}|${startDate}|${endDate}`
    if (_graphsCache[cacheKey]) {
      setGraphsData(_graphsCache[cacheKey])
      return
    }

    // Another call for the same key is already in-flight (React StrictMode double-invoke).
    // Await the shared promise so this instance still receives the result.
    if (_inflight[cacheKey]) {
      const result = await _inflight[cacheKey]
      if (result) setGraphsData(result)
      return
    }

    // Register a shared promise before the first await so any concurrent call can latch onto it.
    let resolveInflight, rejectInflight
    _inflight[cacheKey] = new Promise((res, rej) => { resolveInflight = res; rejectInflight = rej })

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
      _graphsCache[cacheKey] = json.graphs
      resolveInflight(json.graphs)
      setGraphsData(json.graphs)
    } catch (err) {
      rejectInflight(err)
      setError(err.message)
      setGraphsData(null)
    } finally {
      setLoading(false)
      delete _inflight[cacheKey]
    }
  }, [view, currency, startDate, endDate, lookback])

  // Re-fetch whenever relevant filters change
  useEffect(() => { fetchData() }, [fetchData])

  // ── Secondary "All" fetch – full history for local per-chart period overrides ──
  // Only re-runs when view or currency changes, not when dates change.
  const fetchAllData = useCallback(async () => {
    const allCacheKey = `all|${view}|${currency}`
    if (_allGraphsCache[allCacheKey]) {
      setAllGraphsData(_allGraphsCache[allCacheKey])
      return
    }

    if (_allInflight[allCacheKey]) {
      const result = await _allInflight[allCacheKey]
      if (result) setAllGraphsData(result)
      return
    }

    let resolveInflight, rejectInflight
    _allInflight[allCacheKey] = new Promise((res, rej) => { resolveInflight = res; rejectInflight = rej })

    try {
      const { start, end } = computeDateRange('All')
      const params = new URLSearchParams({ view, currency, start_date: start, end_date: end, lookback: 'All' })
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`/api/faktoren/data?${params}`, { headers })
      if (!res.ok) { rejectInflight(new Error(`HTTP ${res.status}`)); return }
      const json = await res.json()
      if (json.status !== 'error') {
        _allGraphsCache[allCacheKey] = json.graphs
        resolveInflight(json.graphs)
        setAllGraphsData(json.graphs)
      } else {
        rejectInflight(new Error(json.error))
      }
    } catch (err) {
      rejectInflight(err)
    } finally {
      delete _allInflight[allCacheKey]
    }
  }, [view, currency])
  useEffect(() => { fetchAllData() }, [fetchAllData])

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
              key={startDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={startDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('start', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('start', e.target.value) }}
              className="faktoren-date-input"
            />
            <span className="faktoren-date-sep">–</span>
            <input
              key={endDate}
              type="text"
              placeholder="YYYY-MM-DD"
              defaultValue={endDate}
              pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
              onBlur={(e) => commitDate('end', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDate('end', e.target.value) }}
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

        {/* Chart type selector */}
        <div className="faktoren-control-section">
          <label>Charttyp</label>
          <div className="faktoren-btn-group">
            {[{ id: 'Line', label: 'Standard' }, { id: 'Bar', label: 'Balken' }].map(ct => (
              <button
                key={ct.id}
                className={`quick-btn${chartType === ct.id ? ' active' : ''}`}
                onClick={() => setChartType(ct.id)}
              >
                {ct.label}
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
                currency={currency}
                yAxisLabel="%"
                globalPeriod={lookback}
                chartType={chartType}
                allData={allGraphsData?.[gn]?.data ?? null}
                lineWidth={lineWidth}
                dataKey={`${startDate}|${endDate}`}
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

