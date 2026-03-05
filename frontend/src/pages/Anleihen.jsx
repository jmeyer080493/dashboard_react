/**
 * Anleihen (Bonds) Page
 *
 * Displays:
 *   1. Bond Checks Table – renten_checks data with live Cash % from AMS
 *   2. Bond Issuance Table – new_issuance_bonds.xlsx with ranking
 *      Click a row → chart shown below
 *   3. CDS / ASW Spread Chart – CDS curve for the selected bond's currency
 *      overlaid with ASW composite spreads by rating
 *
 * State persistence: filter, sort, page, selected bond saved to localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts'
import axios from 'axios'
import './Anleihen.css'

const API_BASE = 'http://localhost:8000'
const STORAGE_KEY = 'anleihen_state'
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// ── Colour palette for ASW rating curves ─────────────────────────────────────
const RATING_COLORS = {
  'AAA': '#00D084', 'AA+': '#FFD700', 'AA': '#FFA500', 'AA-': '#FF8C00',
  'A+': '#FFFF00',  'A':   '#FFD700', 'A-': '#FFA500',
  'BBB+': '#FF9999','BBB': '#FF6B6B','BBB-': '#FF4444',
  'BB+': '#FF3333', 'BB':  '#FF4444','BB-': '#FF0000',
  'B+': '#CC0000',  'B':   '#CC0000','B-': '#990000',
  'CCC': '#8B0000',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function formatCash(val) {
  if (val == null || val === '') return '—'
  const n = parseFloat(val)
  return isNaN(n) ? '—' : `${n.toFixed(1)} %`
}

function formatPct(val) {
  if (val == null || val === '') return '—'
  const n = parseFloat(val)
  return isNaN(n) ? String(val) : `${n.toFixed(1)} %`
}

// ── CDS / ASW Chart ───────────────────────────────────────────────────────────

const TENOR_ORDER = ['1Y', '3Y', '5Y', '7Y', '10Y']

function buildChartData(cdsCurve, aswCurves) {
  const map = {}
  for (const t of TENOR_ORDER) map[t] = { tenor: t }
  for (const pt of (cdsCurve || [])) {
    if (map[pt.tenor]) map[pt.tenor].CDS = pt.value
  }
  for (const [rating, points] of Object.entries(aswCurves || {})) {
    for (const pt of points) {
      if (map[pt.tenor]) map[pt.tenor][`ASW_${rating}`] = pt.value
    }
  }
  return TENOR_ORDER.map(t => map[t])
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="anleihen-tooltip">
      <p className="anleihen-tooltip-label">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value} bps
        </p>
      ))}
    </div>
  )
}

function CdsCurveChart({ chartData, bondName }) {
  if (!chartData) {
    return (
      <div className="anleihen-chart-placeholder">
        Wählen Sie eine Anleihe aus der Tabelle, um die CDS-Kurve anzuzeigen.
      </div>
    )
  }

  const { status, metadata, cds_curve, asw_curves, bond_point } = chartData

  if (status === 'error') {
    return <div className="anleihen-chart-error">Fehler beim Laden der Chartdaten.</div>
  }

  if (!metadata?.supported) {
    return (
      <div className="anleihen-chart-placeholder">
        {metadata?.message || 'CDS-Daten nur für EUR / USD verfügbar.'}
      </div>
    )
  }

  const data = buildChartData(cds_curve, asw_curves)
  const aswRatings = Object.keys(asw_curves || {}).sort()
  const currency = metadata?.currency || ''
  const maturity = metadata?.maturity || ''
  const name = bondName || metadata?.bond_name || ''
  const title = `CDS vs. ASW Spreads – ${currency} | ${name}${maturity ? ` | Fälligkeit: ${maturity}` : ''}`

  return (
    <div className="anleihen-chart-container">
      <div className="anleihen-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={480}>
        <ComposedChart data={data} margin={{ top: 20, right: 40, bottom: 30, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,100,0.3)" />
          <XAxis
            dataKey="tenor"
            type="category"
            allowDuplicatedCategory={false}
            tick={{ fill: 'var(--color-text)', fontSize: 12 }}
            label={{ value: 'Laufzeit', position: 'insideBottom', offset: -10, fill: 'var(--color-text-muted)' }}
          />
          <YAxis
            tick={{ fill: 'var(--color-text)', fontSize: 12 }}
            label={{ value: 'Spread (bps)', angle: -90, position: 'insideLeft', offset: 10, fill: 'var(--color-text-muted)', dy: 50 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '11px' }} />

          {/* CDS curve */}
          <Line
            type="monotone"
            dataKey="CDS"
            name="CDS Kurve"
            stroke="#1f77b4"
            strokeWidth={3}
            dot={{ r: 5, fill: '#1f77b4' }}
            activeDot={{ r: 7 }}
            connectNulls
          />

          {/* ASW spread curves by rating */}
          {aswRatings.map(rating => (
            <Line
              key={rating}
              type="monotone"
              dataKey={`ASW_${rating}`}
              name={`ASW ${rating}`}
              stroke={RATING_COLORS[rating] || '#FFA500'}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          ))}

          {/* Bond point marker */}
          {bond_point && (
            <ReferenceDot
              x={bond_point.tenor_label}
              y={bond_point.cds_spread}
              r={10}
              fill="#FF6B6B"
              stroke="white"
              strokeWidth={2}
              label={{
                value: `★ ${name || 'Bond'}`,
                position: 'top',
                fill: '#FF6B6B',
                fontSize: 11,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Bond Checks Table ─────────────────────────────────────────────────────────

function ChecksTable({ checksData, checksLoading }) {
  if (checksLoading) return <div className="anleihen-loading">Lade Fonds-Daten…</div>
  if (!checksData?.rows?.length) return null

  const { columns, rows } = checksData
  const displayCols = columns.filter(c => c !== '__id__')

  return (
    <div className="anleihen-section">
      <h3 className="anleihen-section-title">Fondseigenschaften</h3>
      <div className="anleihen-checks-wrapper">
        <table className="anleihen-checks-table">
          <thead>
            <tr>
              {displayCols.map(col => <th key={col}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'anleihen-row-alt' : ''}>
                {displayCols.map(col => {
                  const val = row[col]
                  let display = val == null ? '—' : String(val)
                  if (col === 'Cash') display = formatCash(val)
                  if (col === 'max. FX-Exposure' || col === 'max. Corporates') display = formatPct(val)
                  return (
                    <td
                      key={col}
                      className={
                        col === 'Cash' || col === 'max. FX-Exposure' || col === 'max. Corporates'
                          ? 'anleihen-td-right anleihen-td-mono'
                          : ''
                      }
                    >
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Bond Issuance Table ───────────────────────────────────────────────────────

function IssuanceTable({
  tableData, tableLoading, tableError,
  selectedRow, onSelectRow,
  sortConfig, onSort,
  globalFilter, onGlobalFilterChange,
  currentPage, onPageChange,
  pageSize, onPageSizeChange,
}) {
  if (tableLoading) return <div className="anleihen-loading">Lade Anleihen-Daten…</div>
  if (tableError) return <div className="anleihen-chart-error">Fehler: {tableError}</div>
  if (!tableData?.rows?.length) return <div className="anleihen-loading">Keine Daten verfügbar.</div>

  const { columns, rows } = tableData

  // Filter
  const lc = globalFilter.trim().toLowerCase()
  const filtered = lc
    ? rows.filter(row => Object.values(row).some(v => v != null && String(v).toLowerCase().includes(lc)))
    : rows

  // Sort
  const sorted = [...filtered]
  if (sortConfig.key) {
    sorted.sort((a, b) => {
      let aVal = a[sortConfig.key], bVal = b[sortConfig.key]
      if (aVal == null) return 1
      if (bVal == null) return -1
      const aNum = parseFloat(String(aVal).replace(',', '.'))
      const bNum = parseFloat(String(bVal).replace(',', '.'))
      if (!isNaN(aNum) && !isNaN(bNum))
        return sortConfig.dir === 'asc' ? aNum - bNum : bNum - aNum
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      return sortConfig.dir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(currentPage, totalPages - 1)
  const paginated = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const handleSort = col => {
    if (sortConfig.key === col) {
      onSort({ key: col, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      onSort({ key: col, dir: 'asc' })
    }
  }

  const sortIcon = col => {
    if (sortConfig.key !== col) return <span className="anleihen-sort-icon">⇕</span>
    return <span className="anleihen-sort-icon active">{sortConfig.dir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <div className="anleihen-section">
      <h3 className="anleihen-section-title">Neuemissionen – Klicken zum Analysieren</h3>
      <div className="anleihen-table-controls">
        <input
          type="text"
          className="anleihen-filter-input"
          placeholder="Tabelle filtern…"
          value={globalFilter}
          onChange={e => { onGlobalFilterChange(e.target.value); onPageChange(0) }}
        />
        <span className="anleihen-result-count">
          {filtered.length} Anleihe{filtered.length !== 1 ? 'n' : ''}{lc ? ' (gefiltert)' : ''}
        </span>
        <div className="anleihen-page-size">
          <label>Einträge:&nbsp;</label>
          <select value={pageSize} onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(0) }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="anleihen-table-scroll">
        <table className="anleihen-issuance-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={`anleihen-th-sortable ${sortConfig.key === col ? 'anleihen-th-active' : ''}`}
                >
                  {col}&nbsp;{sortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((row, i) => {
              const origIdx = rows.indexOf(row)
              const isSelected = selectedRow != null && origIdx === selectedRow
              return (
                <tr
                  key={origIdx}
                  className={[
                    'anleihen-issuance-row',
                    isSelected ? 'anleihen-row-selected' : '',
                    i % 2 === 1 ? 'anleihen-row-alt' : '',
                  ].join(' ')}
                  onClick={() => onSelectRow(isSelected ? null : origIdx)}
                >
                  {columns.map(col => {
                    const val = row[col]
                    const display = val == null || val === '' ? '' : String(val)
                    return (
                      <td
                        key={col}
                        className={[
                          col === 'Rank' ? 'anleihen-td-rank' : '',
                          col === 'Amount Local' ? 'anleihen-td-right anleihen-td-mono' : '',
                        ].join(' ')}
                      >
                        {display}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="anleihen-pagination">
        <button className="anleihen-page-btn" onClick={() => onPageChange(0)} disabled={safePage === 0}>«</button>
        <button className="anleihen-page-btn" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 0}>‹</button>
        <span className="anleihen-page-info">Seite {safePage + 1} / {totalPages}</span>
        <button className="anleihen-page-btn" onClick={() => onPageChange(safePage + 1)} disabled={safePage >= totalPages - 1}>›</button>
        <button className="anleihen-page-btn" onClick={() => onPageChange(totalPages - 1)} disabled={safePage >= totalPages - 1}>»</button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Anleihen() {
  const saved = loadSavedState()

  // ── Checks table ──────────────────────────────────────────────────────────
  const [checksData, setChecksData]       = useState(null)
  const [checksLoading, setChecksLoading] = useState(true)

  // ── Issuance table ────────────────────────────────────────────────────────
  const [tableData, setTableData]       = useState(null)
  const [tableLoading, setTableLoading] = useState(true)
  const [tableError, setTableError]     = useState(null)

  // ── Persisted table state ─────────────────────────────────────────────────
  const [selectedRow, setSelectedRow]   = useState(saved.selectedRow ?? null)
  const [sortConfig, setSortConfig]     = useState(saved.sortConfig   ?? { key: null, dir: 'asc' })
  const [globalFilter, setGlobalFilter] = useState(saved.globalFilter ?? '')
  const [currentPage, setCurrentPage]   = useState(saved.currentPage  ?? 0)
  const [pageSize, setPageSize]         = useState(saved.pageSize      ?? 25)

  // ── Chart state ───────────────────────────────────────────────────────────
  const [chartData, setChartData]       = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError]     = useState(null)

  const prevBondKeyRef = useRef(null)

  // ── Persist ───────────────────────────────────────────────────────────────
  useEffect(() => {
    saveState({ selectedRow, sortConfig, globalFilter, currentPage, pageSize })
  }, [selectedRow, sortConfig, globalFilter, currentPage, pageSize])

  // ── Load checks table ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setChecksLoading(true)
    axios.get(`${API_BASE}/api/anleihen/checks-table`)
      .then(res => { if (!cancelled) { setChecksData(res.data); setChecksLoading(false) } })
      .catch(() => { if (!cancelled) setChecksLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Load issuance table ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setTableLoading(true)
    axios.get(`${API_BASE}/api/anleihen/issuance-table`)
      .then(res => { if (!cancelled) { setTableData(res.data); setTableLoading(false) } })
      .catch(err => { if (!cancelled) { setTableError(err.message); setTableLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // ── Load chart data when selected row changes ─────────────────────────────
  useEffect(() => {
    if (selectedRow == null || !tableData?.rows) {
      setChartData(null)
      prevBondKeyRef.current = null
      return
    }
    const bond = tableData.rows[selectedRow]
    if (!bond) return

    const bondKey = JSON.stringify({ name: bond.Name, maturity: bond.Maturity, currency: bond.Currency })
    if (prevBondKeyRef.current === bondKey) return
    prevBondKeyRef.current = bondKey

    setChartLoading(true)
    setChartError(null)
    axios.post(`${API_BASE}/api/anleihen/chart-data`, { bond })
      .then(res => { setChartData(res.data); setChartLoading(false) })
      .catch(err => { setChartError(err.message); setChartLoading(false) })
  }, [selectedRow, tableData])

  const selectedBondName = (selectedRow != null && tableData?.rows)
    ? (tableData.rows[selectedRow]?.Name || tableData.rows[selectedRow]?.Issuer || '')
    : ''

  const handleSelectRow = useCallback((rowIdx) => {
    setSelectedRow(rowIdx)
    if (rowIdx == null) {
      setChartData(null)
      prevBondKeyRef.current = null
    }
  }, [])

  return (
    <div className="anleihen-page">
      <div className="anleihen-header">
        <h1>Anleihen</h1>
        <p>Neuemissionen und Rentenmärkte – CDS / ASW Spread Analyse</p>
      </div>

      {/* 1 – Fondseigenschaften */}
      <ChecksTable checksData={checksData} checksLoading={checksLoading} />

      {/* 2 – Neuemissionen Tabelle */}
      <IssuanceTable
        tableData={tableData}
        tableLoading={tableLoading}
        tableError={tableError}
        selectedRow={selectedRow}
        onSelectRow={handleSelectRow}
        sortConfig={sortConfig}
        onSort={setSortConfig}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />

      {/* 3 – Selected bond + chart */}
      <div className="anleihen-section">
        {selectedRow != null && tableData?.rows && (
          <div className="anleihen-selected-info">
            <strong>Ausgewählte Anleihe:</strong>&nbsp;
            {selectedBondName}&nbsp;|&nbsp;
            {tableData.rows[selectedRow]?.Currency}&nbsp;|&nbsp;
            Fälligkeit: {tableData.rows[selectedRow]?.Maturity || '—'}
            {chartData?.bond_point && (
              <>&nbsp;|&nbsp;CDS Spread: {chartData.bond_point.cds_spread.toFixed(0)} bps</>
            )}
            <button
              className="anleihen-clear-btn"
              onClick={() => handleSelectRow(null)}
              title="Auswahl aufheben"
            >✕</button>
          </div>
        )}

        {chartLoading && <div className="anleihen-loading">Lade Chart-Daten…</div>}
        {chartError  && <div className="anleihen-chart-error">Chart-Fehler: {chartError}</div>}
        {!chartLoading && !chartError && (
          <CdsCurveChart chartData={chartData} bondName={selectedBondName} />
        )}
      </div>
    </div>
  )
}
