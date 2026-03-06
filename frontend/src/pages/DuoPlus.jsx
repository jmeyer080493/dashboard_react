/**
 * DuoPlus Page
 *
 * Five sub-tabs:
 *   Overview     – placeholder (complex, migrated separately)
 *   US           – US equity ranking (Value / Growth / Quality + Summary)
 *   Europe       – Same layout for European equities
 *   Custom       – Arbitrary universe + configurable Rank Faktor limit
 *   Data Management – Data-quality statistics and source information
 *
 * State persistence:
 *   Control inputs (active tab, tickers, universe, rank limit) → localStorage
 *   Table data stays in React state (survives tab switches within the session)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import './DuoPlus.css'

const API_BASE = 'http://localhost:8000'
const STORAGE_KEY = 'duoplus_state'

// ─────────────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function savePersisted(obj) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Number formatting helper – abbreviates large financial values
// ─────────────────────────────────────────────────────────────────────────────
function fmtDataVal(v) {
  if (typeof v !== 'number' || isNaN(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared table component
// ─────────────────────────────────────────────────────────────────────────────

function DuoTable({ title, tableData, loading, error, filterText, maxRows }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage]       = useState(0)
  const PAGE_SIZE = maxRows ?? 50

  useEffect(() => { setPage(0) }, [filterText])

  if (loading) return <div className="duo-table-wrap"><div className="duo-loading">Lade Daten…</div></div>
  if (error)   return <div className="duo-table-wrap"><div className="duo-error">Fehler: {error}</div></div>
  if (!tableData?.rows?.length)
    return (
      <div className="duo-table-wrap duo-section">
        {title && <div className="duo-table-title">{title}</div>}
        <div className="duo-empty">Keine Daten verfügbar.</div>
      </div>
    )

  const { columns, rows } = tableData

  // Filter
  const lcFilter = (filterText || '').trim().toLowerCase()
  const filtered = lcFilter
    ? rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(lcFilter)))
    : rows

  // Sort
  const sorted = [...filtered]
  if (sortKey) {
    sorted.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      const an = parseFloat(av), bn = parseFloat(bv)
      if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages - 1)
  const pageItems  = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const handleSort = col => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
  }

  const fmtCell = (col, val) => {
    if (val == null || val === '') return '—'
    const v = parseFloat(val)
    if (!isNaN(v)) {
      if (col === 'Mcap 3M') return `${v.toFixed(2)}B`
      if (['Momentum', 'SG YoY', 'EG YoY', 'SG QoQ', 'EG QoQ', 'EPS StD', 'RoE', 'D2E'].includes(col))
        return `${v.toFixed(1)}%`
      if (['P2B', 'PE', 'P2S'].includes(col)) return v.toFixed(1)
    }
    return String(val)
  }

  const colorClass = (col, val) => {
    if (col === 'Momentum_Cat') {
      if (val === 'MU') return 'duo-cell-mu'
      if (val === 'MD') return 'duo-cell-md'
      return 'duo-cell-mn'
    }
    if ((col === 'UNGC' || col === 'Weapons') && val === 'True') return 'duo-cell-warn'
    return ''
  }

  return (
    <div className="duo-section duo-table-wrap">
      {title && <div className="duo-table-title">{title}</div>}
      <div className="duo-table-scroll">
        <table className="duo-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} onClick={() => handleSort(col)}
                    className={sortKey === col ? 'duo-th-active' : ''}>
                  {col}
                  <span className="duo-sort-icon">
                    {sortKey === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇕'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'duo-row-alt' : ''}>
                {columns.map(col => (
                  <td key={col} className={`duo-td ${colorClass(col, row[col])}`}>
                    {fmtCell(col, row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="duo-pagination">
          <button className="duo-page-btn" onClick={() => setPage(0)} disabled={safePage === 0}>«</button>
          <button className="duo-page-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>‹</button>
          <span className="duo-page-info">Seite {safePage + 1} / {totalPages}  ({filtered.length} Einträge)</span>
          <button className="duo-page-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}>›</button>
          <button className="duo-page-btn" onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1}>»</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Factor tables layout (Value + Growth + Quality side-by-side)
// ─────────────────────────────────────────────────────────────────────────────

function FactorTablesRow({ data, loading, error }) {
  if (loading) return <div className="duo-loading">Lade Ranking-Daten…</div>
  if (error)   return <div className="duo-error">Fehler: {error}</div>
  if (!data)   return null
  return (
    <div className="duo-factor-row">
      <DuoTable title="Value Stocks"   tableData={data.value}   loading={false} error={null} maxRows={30} />
      <DuoTable title="Growth Stocks"  tableData={data.growth}  loading={false} error={null} maxRows={30} />
      <DuoTable title="Quality Stocks" tableData={data.quality} loading={false} error={null} maxRows={30} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// US Tab
// ─────────────────────────────────────────────────────────────────────────────

function UsTab({ persistedTicker, onTickerChange }) {
  const [ticker,  setTicker]  = useState(persistedTicker || '')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [summaryFilter, setSummaryFilter] = useState('')
  const latestRef = useRef(0)

  const fetchData = useCallback(async (t) => {
    const id = ++latestRef.current
    setLoading(true); setError(null)
    try {
      const params = t?.trim() ? `?ticker=${encodeURIComponent(t.trim())}` : ''
      const res = await fetch(`${API_BASE}/api/duoplus/us${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.status === 'error') throw new Error(json.error)
      if (id === latestRef.current) setData(json)
    } catch (err) {
      if (id === latestRef.current) setError(err.message)
    } finally {
      if (id === latestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(ticker) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const debounceRef = useRef(null)
  const handleTicker = (val) => {
    setTicker(val); onTickerChange(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchData(val), 500)
  }

  return (
    <div className="duo-tab-content">
      <div className="duo-controls-row">
        <input className="duo-ticker-input" type="text" placeholder="Ticker filtern…"
               value={ticker} onChange={e => handleTicker(e.target.value)} />
        <button className="duo-refresh-btn" onClick={() => fetchData(ticker)}>↻ Aktualisieren</button>
      </div>

      <FactorTablesRow data={data} loading={loading} error={error} />

      {(data || loading) && (
        <>
          <div className="duo-controls-row" style={{ marginTop: '1.5rem' }}>
            <input className="duo-ticker-input" type="text" placeholder="Summary Tabelle filtern…"
                   value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)} />
          </div>
          <DuoTable title="Summary Metrics" tableData={data?.summary}
                    loading={loading} error={error} filterText={summaryFilter} maxRows={100} />
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Europe Tab
// ─────────────────────────────────────────────────────────────────────────────

function EuropeTab({ persistedTicker, onTickerChange }) {
  const [ticker,  setTicker]  = useState(persistedTicker || '')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [summaryFilter, setSummaryFilter] = useState('')
  const latestRef = useRef(0)

  const fetchData = useCallback(async (t) => {
    const id = ++latestRef.current
    setLoading(true); setError(null)
    try {
      const params = t?.trim() ? `?ticker=${encodeURIComponent(t.trim())}` : ''
      const res = await fetch(`${API_BASE}/api/duoplus/europe${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.status === 'error') throw new Error(json.error)
      if (id === latestRef.current) setData(json)
    } catch (err) {
      if (id === latestRef.current) setError(err.message)
    } finally {
      if (id === latestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(ticker) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const debounceRef = useRef(null)
  const handleTicker = (val) => {
    setTicker(val); onTickerChange(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchData(val), 500)
  }

  return (
    <div className="duo-tab-content">
      <div className="duo-controls-row">
        <input className="duo-ticker-input" type="text" placeholder="Ticker filtern…"
               value={ticker} onChange={e => handleTicker(e.target.value)} />
        <button className="duo-refresh-btn" onClick={() => fetchData(ticker)}>↻ Aktualisieren</button>
      </div>

      <FactorTablesRow data={data} loading={loading} error={error} />

      {(data || loading) && (
        <>
          <div className="duo-controls-row" style={{ marginTop: '1.5rem' }}>
            <input className="duo-ticker-input" type="text" placeholder="Summary Tabelle filtern…"
                   value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)} />
          </div>
          <DuoTable title="Summary Metrics" tableData={data?.summary}
                    loading={loading} error={error} filterText={summaryFilter} maxRows={100} />
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Tab
// ─────────────────────────────────────────────────────────────────────────────

function CustomTab({ persisted, onStateChange }) {
  const [universe,  setUniverse]  = useState(persisted.universe  || '')
  const [rankLimit, setRankLimit] = useState(persisted.rankLimit || 100)
  const [ticker,    setTicker]    = useState(persisted.ticker    || '')
  const [universes, setUniverses] = useState([])
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [summaryFilter, setSummaryFilter] = useState('')
  const latestRef = useRef(0)

  // Load universe list once
  useEffect(() => {
    fetch(`${API_BASE}/api/duoplus/universes`)
      .then(r => r.json())
      .then(json => {
        const list = json.universes || []
        setUniverses(list)
        if (!universe && list.length) {
          setUniverse(list[0])
          onStateChange({ universe: list[0] })
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async (u, rl, t) => {
    if (!u) return
    const id = ++latestRef.current
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ universe: u, rank_limit: rl || 100 })
      if (t?.trim()) params.set('ticker', t.trim())
      const res = await fetch(`${API_BASE}/api/duoplus/custom?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.status === 'error') throw new Error(json.error)
      if (id === latestRef.current) setData(json)
    } catch (err) {
      if (id === latestRef.current) setError(err.message)
    } finally {
      if (id === latestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { if (universe) fetchData(universe, rankLimit, ticker) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const debounceTickerRef = useRef(null)
  const debounceRankRef   = useRef(null)

  const handleUniverse = (val) => {
    setUniverse(val); onStateChange({ universe: val })
    fetchData(val, rankLimit, ticker)
  }
  const handleRankLimit = (val) => {
    const n = Math.max(1, Math.min(500, parseInt(val) || 100))
    setRankLimit(n); onStateChange({ rankLimit: n })
    clearTimeout(debounceRankRef.current)
    debounceRankRef.current = setTimeout(() => fetchData(universe, n, ticker), 600)
  }
  const handleTicker = (val) => {
    setTicker(val); onStateChange({ ticker: val })
    clearTimeout(debounceTickerRef.current)
    debounceTickerRef.current = setTimeout(() => fetchData(universe, rankLimit, val), 500)
  }

  return (
    <div className="duo-tab-content">
      <div className="duo-controls-row duo-custom-controls">
        <input className="duo-ticker-input" type="text" placeholder="Ticker filtern…"
               value={ticker} onChange={e => handleTicker(e.target.value)} />

        <select className="duo-universe-select" value={universe} onChange={e => handleUniverse(e.target.value)}>
          {universes.length === 0 && <option value="">Lädt Universen…</option>}
          {universes.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <div className="duo-rank-limit-wrap">
          <label className="duo-rank-limit-label">Stocks to rank:</label>
          <input className="duo-rank-limit-input" type="number" min={1} max={500}
                 value={rankLimit} onChange={e => handleRankLimit(e.target.value)} />
        </div>

        <button className="duo-refresh-btn" onClick={() => fetchData(universe, rankLimit, ticker)}>
          ↻ Aktualisieren
        </button>
      </div>

      <FactorTablesRow data={data} loading={loading} error={error} />

      {(data || loading) && (
        <>
          <div className="duo-controls-row" style={{ marginTop: '1.5rem' }}>
            <input className="duo-ticker-input" type="text" placeholder="Summary Tabelle filtern…"
                   value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)} />
          </div>
          <DuoTable title="Summary Metrics" tableData={data?.summary}
                    loading={loading} error={error} filterText={summaryFilter} maxRows={200} />
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Management Tab
// ─────────────────────────────────────────────────────────────────────────────

function DataMgmtTab() {
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const fetchStats = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/duoplus/data-quality`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStats(await res.json())
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const RegionCard = ({ regionKey, label }) => {
    const s = stats?.[regionKey]
    return (
      <div className="duo-quality-card">
        <div className="duo-quality-card-header">{label}</div>
        {loading && <div className="duo-loading">Lade Statistiken…</div>}
        {!loading && s && (
          <>
            <div className="duo-quality-meta">
              <span><strong>Index:</strong> {s.universe || '—'}</span>
              <span><strong>Stand:</strong> {s.data_date || '—'}</span>
              <span><strong>Aktien gesamt:</strong> {s.total_stocks}</span>
              <span><strong>Fehlende Datenpunkte:</strong> {s.missing_data_points}</span>
            </div>

            {s.outliers?.length > 0 && (
              <div className="duo-quality-section">
                <div className="duo-quality-sub-header">Ausreißer (Z-Score &gt; 3) – Top 30 nach Mcap</div>
                <div className="duo-table-scroll">
                  <table className="duo-table duo-table-sm">
                    <thead><tr><th>Ticker</th><th>Metriken</th><th>Werte</th></tr></thead>
                    <tbody>
                      {s.outliers.map((o, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'duo-row-alt' : ''}>
                          <td className="duo-td">{o.ticker}</td>
                          <td className="duo-td">{o.metrics.join(', ')}</td>
                          <td className="duo-td duo-mono">
                            {Object.entries(o.values).map(([k, v]) => `${k}: ${fmtDataVal(v)}`).join(' | ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {s.missing_stocks?.length > 0 && (
              <div className="duo-quality-section">
                <div className="duo-quality-sub-header">Aktien mit fehlenden Daten</div>
                <div className="duo-table-scroll">
                  <table className="duo-table duo-table-sm">
                    <thead><tr><th>Ticker</th><th>Fehlende Metriken</th></tr></thead>
                    <tbody>
                      {s.missing_stocks.map((m, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'duo-row-alt' : ''}>
                          <td className="duo-td">{m.ticker}</td>
                          <td className="duo-td duo-cell-warn">{m.missing_metrics.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {s.error && <div className="duo-error" style={{ marginTop: '1rem' }}>{s.error}</div>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="duo-tab-content">
      <div className="duo-info-box">
        <strong>Datenquelle</strong>
        <p>
          DuoPlus-Daten werden aus der Datenbank{' '}
          <code>ApoAsset_Quant.[dbo].[duoplus_data]</code> geladen.
        </p>
        <ul>
          <li>US-Universum: <strong>B500T Index</strong></li>
          <li>Europa-Universum: <strong>EURP600 Index</strong></li>
        </ul>
        <p className="duo-info-note">
          Das Dashboard lädt stets die aktuellsten verfügbaren Daten (MAX DatePoint).
        </p>
      </div>

      <div className="duo-quality-controls">
        <button className="duo-refresh-btn" onClick={fetchStats} disabled={loading}>
          ↻ Statistiken aktualisieren
        </button>
      </div>

      {error && <div className="duo-error">Fehler: {error}</div>}

      <div className="duo-quality-grid">
        <RegionCard regionKey="us" label="US Datenqualität" />
        <RegionCard regionKey="eu" label="Europa Datenqualität" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview – Summary Table (editable Factor + Decision via inline dropdowns)
// ─────────────────────────────────────────────────────────────────────────────

const FACTOR_OPTIONS   = ['Value', 'Growth', 'Quality', '-']
const DECISION_OPTIONS = ['Buy', 'Sell', 'Hold', 'DNB', '-']

function SummaryTable({ rows, selectedIdx, editingCell, onSelect, onStartEdit, onCommitEdit, onCancelEdit }) {
  const decisionColor = (val) => {
    if (val === 'Buy')  return '#2e7d32'
    if (val === 'Sell') return '#c62828'
    if (val === 'Hold') return '#f57c00'
    if (val === 'DNB')  return '#1565c0'
    return 'inherit'
  }
  const momentumClass = (val) => {
    if (val === 'MU') return 'duo-cell-mu'
    if (val === 'MD') return 'duo-cell-md'
    return ''
  }
  const COLS = ['Ticker','Region','Factor','Other Factors','Momentum','Best Rank','Recently Bought','Decision']

  return (
    <div className="duo-summary-table-wrap">
      <table className="duo-table duo-summary-table">
        <thead>
          <tr>{COLS.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ridx) => (
            <tr key={ridx}
                className={`${ridx % 2 === 1 ? 'duo-row-alt' : ''} ${selectedIdx === ridx ? 'duo-row-selected' : ''}`}
                onClick={() => onSelect(ridx === selectedIdx ? null : ridx)}>
              {COLS.map(col => {
                const isEditing = editingCell?.rowIdx === ridx && editingCell?.col === col
                const val = row[col]

                if (col === 'Factor') return (
                  <td key={col} className="duo-td duo-td-editable"
                      onClick={e => { e.stopPropagation(); onStartEdit(ridx, col) }}>
                    {isEditing
                      ? <select autoFocus className="duo-inline-select" value={val || '-'}
                            onChange={e => onCommitEdit(ridx, col, e.target.value)}
                            onBlur={() => onCancelEdit()}>
                          {FACTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      : <span className="duo-editable-cell">{val || '—'}</span>}
                  </td>
                )

                if (col === 'Decision') return (
                  <td key={col} className="duo-td duo-td-editable"
                      onClick={e => { e.stopPropagation(); onStartEdit(ridx, col) }}>
                    {isEditing
                      ? <select autoFocus className="duo-inline-select" value={val || '-'}
                            onChange={e => onCommitEdit(ridx, col, e.target.value)}
                            onBlur={() => onCancelEdit()}>
                          {DECISION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      : <span className="duo-editable-cell"
                              style={{ color: decisionColor(val), fontWeight: val && val !== '-' ? '600' : 'normal' }}>
                          {val || '—'}
                        </span>}
                  </td>
                )

                if (col === 'Momentum') return (
                  <td key={col} className={`duo-td ${momentumClass(val)}`}>{val || '—'}</td>
                )

                if (col === 'Recently Bought') return (
                  <td key={col} className={`duo-td ${val === 1 ? 'duo-cell-mu' : ''}`}>
                    {val === 1 ? 'Yes' : 'No'}
                  </td>
                )

                return <td key={col} className="duo-td">{val != null && val !== '' ? String(val) : '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview – small 3-column factor table (T0 / T+1 / T-1 / T-2)
// ─────────────────────────────────────────────────────────────────────────────

function Top5Table({ factorData, highlightMap }) {
  // factorData: {Value:[ticker,...], Growth:[...], Quality:[...]}
  // highlightMap (optional): {Value:[{ticker,highlight},...], ...}
  const FACTORS = ['Value', 'Growth', 'Quality']
  return (
    <table className="duo-top5-table">
      <thead><tr>{FACTORS.map(f => <th key={f}>{f}</th>)}</tr></thead>
      <tbody>
        {Array.from({ length: 5 }).map((_, i) => (
          <tr key={i}>
            {FACTORS.map(f => {
              if (highlightMap) {
                const item = (highlightMap[f] || [])[i]
                const tk   = item?.ticker || ''
                const hl   = item?.highlight
                return <td key={f} className={hl ? `duo-cell-${hl}` : ''}>{tk}</td>
              }
              const tk = (factorData?.[f] || [])[i] || ''
              return <td key={f}>{tk}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview – decision table (T+1): derived from summary rows
// ─────────────────────────────────────────────────────────────────────────────

function DecisionTable({ summaryRows, region, t0FactorMap }) {
  const FACTORS   = ['Value', 'Growth', 'Quality']
  const regionUpper = region.toUpperCase()
  
  const byFactor = useMemo(() => {
    const filtered = summaryRows.filter(r => r.Region === regionUpper && ['Hold','Buy'].includes(r.Decision))
    const grouped  = { Value: [], Growth: [], Quality: [] }
    for (const factor of FACTORS) {
      grouped[factor] = filtered
        .filter(r => r.Factor === factor)
        .sort((a, b) => (parseInt(a['Best Rank']) || 999) - (parseInt(b['Best Rank']) || 999))
        .map(r => r.Ticker)
    }
    return grouped
  }, [summaryRows, regionUpper])

  const maxRows = Math.max(5, ...FACTORS.map(f => byFactor[f].length))

  return (
    <table className="duo-top5-table">
      <thead><tr>{FACTORS.map(f => <th key={f}>{f}</th>)}</tr></thead>
      <tbody>
        {Array.from({ length: maxRows }).map((_, i) => (
          <tr key={i}>
            {FACTORS.map(f => {
              const tk     = byFactor[f][i] || ''
              const inT0   = t0FactorMap.hasOwnProperty(tk)
              const t0Fac  = t0FactorMap[tk]
              let hlCls    = ''
              if (tk) {
                if (!inT0)                    hlCls = 'duo-cell-green'
                else if (t0Fac && t0Fac !== f) hlCls = 'duo-cell-blue'
              }
              return <td key={f} className={hlCls}>{tk}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview Tab – full implementation
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ persisted, onStateChange }) {
  const { user }         = useAuth()

  // Controls
  const [momentum,    setMomentum]    = useState(persisted.momentum    ?? false)
  const [factorOrder, setFactorOrder] = useState(persisted.factorOrder || 'VGQ')
  const [draftMode,   setDraftMode]   = useState(persisted.draftMode   ?? false)
  const [highestRank, setHighestRank] = useState(persisted.highestRank ?? false)

  // Data
  const [overviewData,  setOverviewData]  = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)

  // Summary (persisted)
  const [summaryRows,   setSummaryRows]   = useState(persisted.summaryRows   || [])
  const [baseTickerSet, setBaseTickerSet] = useState(() => new Set(persisted.baseTickerSet || []))

  // UI state
  const [selectedIdx,  setSelectedIdx]   = useState(null)
  const [editingCell,  setEditingCell]   = useState(null)
  const [showAddModal, setShowAddModal]  = useState(false)
  const [addInput,     setAddInput]      = useState('')
  const [tickerErr,    setTickerErr]     = useState(null)
  const [adding,       setAdding]        = useState(false)
  const [notification, setNotification]  = useState(null)
  const [saving,       setSaving]        = useState(false)

  // Track controls to detect actual changes
  const prevControlsKey = useRef(null)
  const controlsKey     = JSON.stringify({ momentum, factorOrder, draftMode, highestRank })

  // Persist to parent
  useEffect(() => {
    onStateChange({
      momentum, factorOrder, draftMode, highestRank,
      summaryRows,
      baseTickerSet: [...baseTickerSet],
    })
  }, [momentum, factorOrder, draftMode, highestRank, summaryRows]) // eslint-disable-line

  // Fetch overview data
  const fetchData = useCallback(async (controlsChanged) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        factor_order: factorOrder,
        draft:        draftMode,
        momentum:     momentum,
        highest_rank: highestRank,
      })
      const res  = await fetch(`${API_BASE}/api/duoplus/overview?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOverviewData(data)

      const newBase    = data.summary || []
      const newBaseSet = new Set(newBase.map(r => `${r.Ticker}|${r.Region}`))

      setSummaryRows(prev => {
        if (controlsChanged || !prev.length) return newBase
        // Preserve Factor/Decision edits; keep manually added tickers
        const editMap = {}
        prev.forEach(r => { editMap[`${r.Ticker}|${r.Region}`] = r })
        const merged = newBase.map(base => {
          const key = `${base.Ticker}|${base.Region}`
          const ex  = editMap[key]
          return ex ? { ...base, Factor: ex.Factor, Decision: ex.Decision } : base
        })
        const manual = prev.filter(r => !newBaseSet.has(`${r.Ticker}|${r.Region}`))
        return [...merged, ...manual]
      })
      setBaseTickerSet(newBaseSet)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [factorOrder, draftMode, momentum, highestRank]) // eslint-disable-line

  useEffect(() => {
    const changed = prevControlsKey.current !== null && prevControlsKey.current !== controlsKey
    prevControlsKey.current = controlsKey
    fetchData(changed)
  }, [controlsKey]) // eslint-disable-line

  // Derived: decision rows & validation
  const decisionRows = useMemo(() =>
    summaryRows.filter(r => r.Decision === 'Hold' || r.Decision === 'Buy'),
  [summaryRows])

  const isDecisionValid = useMemo(() => {
    if (!decisionRows.length) return false
    for (const region of ['US', 'EU'])
      for (const factor of ['Value', 'Growth', 'Quality'])
        if (decisionRows.filter(r => r.Region === region && r.Factor === factor).length !== 5)
          return false
    return true
  }, [decisionRows])

  // T0 factor maps per region for T+1 highlights
  const t0FactorMaps = useMemo(() => {
    const res = { us: {}, eu: {} }
    for (const region of ['us', 'eu']) {
      const factors = overviewData?.[`${region}_t0`] || {}
      const map = {}
      for (const [f, tickers] of Object.entries(factors))
        for (const tk of (tickers || [])) map[tk] = f
      res[region] = map
    }
    return res
  }, [overviewData])

  // Cell editing
  const startEdit   = (rowIdx, col) => { setEditingCell({ rowIdx, col }); setSelectedIdx(rowIdx) }
  const commitEdit  = (rowIdx, col, val) => {
    setSummaryRows(prev => { const u = [...prev]; u[rowIdx] = { ...u[rowIdx], [col]: val }; return u })
    setEditingCell(null)
  }
  const cancelEdit  = () => setEditingCell(null)

  // Add ticker
  const handleAdd = async () => {
    if (!addInput.trim()) return
    setAdding(true); setTickerErr(null)
    try {
      const res  = await fetch(`${API_BASE}/api/duoplus/overview/ticker?ticker=${encodeURIComponent(addInput.trim())}`)
      const data = await res.json()
      if (!data.found) {
        setTickerErr('Ticker nicht gefunden')
      } else {
        const key = `${data.row.Ticker}|${data.row.Region}`
        if (summaryRows.some(r => `${r.Ticker}|${r.Region}` === key))
          setTickerErr('Ticker ist bereits in der Summary')
        else {
          setSummaryRows(prev => [...prev, data.row])
          setShowAddModal(false); setAddInput('')
        }
      }
    } catch (e) {
      setTickerErr(e.message)
    } finally {
      setAdding(false)
    }
  }

  // Delete selected row
  const handleDelete = () => {
    if (selectedIdx === null) return
    setSummaryRows(prev => prev.filter((_, i) => i !== selectedIdx))
    setSelectedIdx(null)
  }

  // Save trades
  const handleSave = async () => {
    setSaving(true); setNotification(null)
    try {
      const res  = await fetch(`${API_BASE}/api/duoplus/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: decisionRows, username: user?.username || '' }),
      })
      const data = await res.json()
      setNotification({ type: data.success ? 'success' : 'error', msg: data.message })
    } catch (e) {
      setNotification({ type: 'error', msg: e.message })
    } finally {
      setSaving(false)
    }
  }

  // Bloomberg CSV
  const handleBloomberg = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/duoplus/bloomberg-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: decisionRows }),
      })
      const data = await res.json()
      setNotification({ type: data.success ? 'success' : 'error', msg: data.message })
    } catch (e) {
      setNotification({ type: 'error', msg: e.message })
    }
  }

  return (
    <div className="duo-tab-content">

      {/* ── Controls row ── */}
      <div className="duo-overview-controls">
        <div className="duo-ctrl-group">
          <span className="duo-ctrl-label">Momentum</span>
          <button
            className={`duo-toggle-btn${momentum ? ' duo-toggle-btn-on' : ''}`}
            onClick={() => setMomentum(v => !v)}
            title="Exclude stocks with negative momentum from top-5 selection">
            {momentum ? 'On' : 'Off'}
          </button>
        </div>

        <div className="duo-ctrl-group">
          <span className="duo-ctrl-label">Factor Order</span>
          <select className="duo-ctrl-select" value={factorOrder} onChange={e => setFactorOrder(e.target.value)}>
            <option value="VGQ">Value – Growth – Quality</option>
            <option value="VQG">Value – Quality – Growth</option>
            <option value="QVG">Quality – Value – Growth</option>
            <option value="QGV">Quality – Growth – Value</option>
            <option value="GVQ">Growth – Value – Quality</option>
            <option value="GQV">Growth – Quality – Value</option>
          </select>
        </div>

        <div className="duo-ctrl-group">
          <span className="duo-ctrl-label">Draft</span>
          <button
            className={`duo-toggle-btn${draftMode ? ' duo-toggle-btn-on' : ''}`}
            onClick={() => setDraftMode(v => !v)}
            title="On: Round-robin selection (1 per factor). Off: Fill each factor completely first.">
            {draftMode ? 'On' : 'Off'}
          </button>
        </div>

        <div className="duo-ctrl-group">
          <span className="duo-ctrl-label">Highest Rank</span>
          <button
            className={`duo-toggle-btn${highestRank ? ' duo-toggle-btn-on' : ''}`}
            onClick={() => setHighestRank(v => !v)}
            title="On: Assigns each stock to the factor with its best rank. Ignores Factor Order and Draft.">
            {highestRank ? 'On' : 'Off'}
          </button>
        </div>

        <button className="duo-refresh-btn" onClick={() => fetchData(false)} disabled={loading}>
          {loading ? '…' : '↻'}
        </button>
      </div>

      {error && <div className="duo-error">Fehler: {error}</div>}

      {/* ── Main layout ── */}
      <div className="duo-overview-layout">

        {/* Left: Ticker Summary */}
        <div className="duo-overview-left">
          <div className="duo-panel-title">Ticker Summary</div>

          <SummaryTable
            rows={summaryRows}
            selectedIdx={selectedIdx}
            editingCell={editingCell}
            onSelect={setSelectedIdx}
            onStartEdit={startEdit}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
          />

          <div className="duo-summary-actions">
            <button className="duo-btn duo-btn-sm" title="Add Ticker"
                    onClick={() => { setShowAddModal(true); setTickerErr(null) }}>+</button>
            <button className="duo-btn duo-btn-sm duo-btn-danger" title="Delete Selected"
                    disabled={selectedIdx === null} onClick={handleDelete}>−</button>
            <button className="duo-btn" disabled={!isDecisionValid || saving} onClick={handleSave}>
              {saving ? 'Speichern…' : 'Save Trades'}
            </button>
            <button className="duo-btn duo-btn-secondary" disabled={!isDecisionValid} onClick={handleBloomberg}>
              Bloomberg CSV
            </button>
          </div>

          {notification && (
            <div className={`duo-notification duo-notification-${notification.type}`}>
              {notification.msg}
            </div>
          )}
        </div>

        {/* Right: US + EU period columns */}
        <div className="duo-overview-right">
          <div className="duo-overview-columns">

            {/* US column */}
            <div className="duo-region-col">
              <div className="duo-region-col-header">U.S.</div>
              <div className="duo-period-row">
                <DecisionTable summaryRows={summaryRows} region="us" t0FactorMap={t0FactorMaps.us} />
              </div>
              <div className="duo-period-row">
                <Top5Table factorData={overviewData?.us_t0} />
              </div>
              <div className="duo-period-row">
                <Top5Table highlightMap={overviewData?.us_t1_highlighted} />
              </div>
              <div className="duo-period-row">
                <Top5Table highlightMap={overviewData?.us_t2_highlighted} />
              </div>
            </div>

            {/* EU column */}
            <div className="duo-region-col">
              <div className="duo-region-col-header">Europe</div>
              <div className="duo-period-row">
                <DecisionTable summaryRows={summaryRows} region="eu" t0FactorMap={t0FactorMaps.eu} />
              </div>
              <div className="duo-period-row">
                <Top5Table factorData={overviewData?.eu_t0} />
              </div>
              <div className="duo-period-row">
                <Top5Table highlightMap={overviewData?.eu_t1_highlighted} />
              </div>
              <div className="duo-period-row">
                <Top5Table highlightMap={overviewData?.eu_t2_highlighted} />
              </div>
            </div>

            {/* Period labels */}
            <div className="duo-period-label-col">
              <div className="duo-period-label-spacer"></div>
              <div className="duo-period-label">T+1</div>
              <div className="duo-period-label">T0</div>
              <div className="duo-period-label">T-1</div>
              <div className="duo-period-label">T-2</div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Add Ticker Modal ── */}
      {showAddModal && (
        <div className="duo-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="duo-modal" onClick={e => e.stopPropagation()}>
            <div className="duo-modal-header">
              <span>Ticker hinzufügen</span>
              <button className="duo-modal-close"
                      onClick={() => { setShowAddModal(false); setAddInput(''); setTickerErr(null) }}>✕</button>
            </div>
            <div className="duo-modal-body">
              <input className="duo-ticker-input" type="text" placeholder="z.B. AAPL"
                     autoFocus value={addInput}
                     onChange={e => { setAddInput(e.target.value); setTickerErr(null) }}
                     onKeyDown={e => e.key === 'Enter' && handleAdd()} />
              {tickerErr && <div className="duo-error" style={{ marginTop: '0.5rem' }}>{tickerErr}</div>}
            </div>
            <div className="duo-modal-footer">
              <button className="duo-btn duo-btn-primary" onClick={handleAdd} disabled={adding}>
                {adding ? '…' : 'Submit'}
              </button>
              <button className="duo-btn" onClick={() => { setShowAddModal(false); setAddInput(''); setTickerErr(null) }}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview'        },
  { id: 'us',        label: 'US'              },
  { id: 'europe',    label: 'Europe'          },
  { id: 'custom',    label: 'Custom'          },
  { id: 'data-mgmt', label: 'Data Management' },
]

export default function DuoPlus() {
  const saved = loadSaved()

  const [activeTab, setActiveTab] = useState(saved.activeTab || 'us')
  const [usTicker,  setUsTicker]  = useState(saved.usTicker  || '')
  const [euTicker,  setEuTicker]  = useState(saved.euTicker  || '')
  const [customState, setCustomState] = useState({
    universe:  saved.customUniverse  || '',
    rankLimit: saved.customRankLimit || 100,
    ticker:    saved.customTicker    || '',
  })
  const [overviewState, setOverviewState] = useState({
    momentum:     saved.overviewMomentum    ?? false,
    factorOrder:  saved.overviewFactorOrder || 'VGQ',
    draftMode:    saved.overviewDraftMode   ?? false,
    highestRank:  saved.overviewHighestRank ?? false,
    summaryRows:  saved.overviewSummaryRows  || [],
    baseTickerSet: saved.overviewBaseTickerSet || [],
  })

  useEffect(() => {
    savePersisted({
      activeTab,
      usTicker,
      euTicker,
      customUniverse:       customState.universe,
      customRankLimit:      customState.rankLimit,
      customTicker:         customState.ticker,
      overviewMomentum:     overviewState.momentum,
      overviewFactorOrder:  overviewState.factorOrder,
      overviewDraftMode:    overviewState.draftMode,
      overviewHighestRank:  overviewState.highestRank,
      overviewSummaryRows:  overviewState.summaryRows,
      overviewBaseTickerSet: overviewState.baseTickerSet,
    })
  }, [activeTab, usTicker, euTicker, customState, overviewState])

  const handleCustomChange = (partial) =>
    setCustomState(prev => ({ ...prev, ...partial }))

  return (
    <div className="duo-page">
      <div className="duo-header">
        <h1>DuoPlus ⚡</h1>
        <p>Equity Ranking – Value · Growth · Quality</p>
      </div>

      {/* Sub-tab bar */}
      <div className="duo-tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`duo-tab-btn${activeTab === t.id ? ' duo-tab-btn-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* All panels mounted – hidden via CSS display to preserve state */}
      <div style={{ display: activeTab === 'overview'  ? 'block' : 'none' }}>
        <OverviewTab persisted={overviewState} onStateChange={setOverviewState} />
      </div>
      <div style={{ display: activeTab === 'us'        ? 'block' : 'none' }}>
        <UsTab persistedTicker={usTicker} onTickerChange={setUsTicker} />
      </div>
      <div style={{ display: activeTab === 'europe'    ? 'block' : 'none' }}>
        <EuropeTab persistedTicker={euTicker} onTickerChange={setEuTicker} />
      </div>
      <div style={{ display: activeTab === 'custom'    ? 'block' : 'none' }}>
        <CustomTab persisted={customState} onStateChange={handleCustomChange} />
      </div>
      <div style={{ display: activeTab === 'data-mgmt' ? 'block' : 'none' }}><DataMgmtTab /></div>
    </div>
  )
}
