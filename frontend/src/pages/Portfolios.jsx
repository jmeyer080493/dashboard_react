import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import axios from 'axios'
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as LineTooltip,
  ComposedChart, Bar, ReferenceLine,
} from 'recharts'
import { useExport } from '../context/ExportContext'
import { ExcelIcon, PowerPointIcon } from '../icons/MicrosoftIcons'
import './Portfolios.css'

const API_BASE = 'http://localhost:8000'

// ─── Colour palette for pie charts ───────────────────────────────────────────
const PIE_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16',
  '#06b6d4', '#a855f7', '#fb923c', '#22d3ee', '#e879f9',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(val) {
  if (val == null || isNaN(val)) return '—'
  return `${Number(val).toLocaleString('de-DE', { maximumFractionDigits: 0 })}`
}

function colorForValue(val) {
  if (val > 0) return 'var(--portfolio-positive)'
  if (val < 0) return 'var(--portfolio-negative)'
  return 'inherit'
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS ─ OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════

// ─── AUM Summary Cards ────────────────────────────────────────────────────────
function AumCards({ cards }) {
  if (!cards) return null
  const defs = [
    { key: 'total',   label: 'Total AUM',      cls: 'card-total' },
    { key: 'MA',      label: 'Multi Asset',     cls: 'card-ma' },
    { key: 'HC',      label: 'Health Care',     cls: 'card-hc' },
    { key: 'Spezial', label: 'Spezial Fonds',   cls: 'card-spezial' },
  ]
  return (
    <div className="portfolio-aum-cards">
      {defs.map(({ key, label, cls }) => (
        <div key={key} className={`portfolio-aum-card ${cls}`}>
          <div className="portfolio-aum-card-label">{label}</div>
          <div className="portfolio-aum-card-value">EUR {cards[key] ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

// ─── AUM by Portfolio Table ───────────────────────────────────────────────────
function AumTable({ rows, columns, onExport }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sorted = [...(rows || [])].sort((a, b) => {
    if (!sortCol) return 0
    const av = a[sortCol] ?? ''
    const bv = b[sortCol] ?? ''
    const na = parseFloat(String(av).replace(/\./g, '').replace(',', '.'))
    const nb = parseFloat(String(bv).replace(/\./g, '').replace(',', '.'))
    const num = !isNaN(na) && !isNaN(nb)
    const cmp = num ? na - nb : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  if (!rows || rows.length === 0) {
    return <div className="portfolio-empty">Keine AUM-Daten verfügbar</div>
  }

  return (
    <div className="portfolio-table-section">
      <div className="portfolio-section-header">
        <h6 className="portfolio-section-title">AUM nach Portfolio</h6>
      </div>
      <div className="portfolio-table-scroll">
        <table className="portfolio-data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} onClick={() => handleSort(col)} className="sortable-header">
                  {col}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col} className={col === 'AUM (EUR)' ? 'num-cell' : ''}>
                    {row[col] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="portfolio-export-row">
        <button className="portfolio-export-btn xlsx" onClick={onExport} title="Zu Excel hinzufügen">
          <ExcelIcon width={26} height={26} />
        </button>
      </div>
    </div>
  )
}

// ─── Liquiditätsübersicht Table ───────────────────────────────────────────────
function LiquidityTable({ rows, dateLabels, dateKeys, onExport }) {
  const [expanded, setExpanded] = useState({})

  const toggle = useCallback((key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  if (!rows || rows.length === 0) {
    return <div className="portfolio-empty">Keine Liquiditätsdaten verfügbar</div>
  }

  const fmtCell = (val) => {
    if (val == null || isNaN(val)) return '0'
    return fmtCurrency(val)
  }

  return (
    <div className="portfolio-table-section">
      <div className="portfolio-section-header">
        <h6 className="portfolio-section-title">Liquiditätsübersicht</h6>
      </div>
      <div className="portfolio-table-scroll">
        <table className="portfolio-data-table liquidity-table">
          <thead>
            <tr>
              <th>Portfolio</th>
              <th className="num-header">Heute</th>
              {dateLabels.map((lbl, i) => (
                <th key={i} className="num-header">{lbl}</th>
              ))}
              <th className="num-header">Fälligkeiten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = !!expanded[row.portfolio]
              const hasCurrencies = row.currency_rows && row.currency_rows.length > 0
              const allMatKeys = row.all_maturity_date_keys || []

              return [
                <tr
                  key={row.portfolio}
                  className={`liquidity-main-row${row.has_negative ? ' liquidity-negative' : ''}`}
                  onClick={() => hasCurrencies && toggle(row.portfolio)}
                  style={{ cursor: hasCurrencies ? 'pointer' : 'default' }}
                >
                  <td className="liquidity-portfolio-cell">
                    {hasCurrencies && (
                      <span className="liquidity-chevron">{isExpanded ? '▼' : '▶'}</span>
                    )}
                    <strong>{row.displayName}</strong>
                  </td>
                  <td className="num-cell" style={{ color: colorForValue(row.today) }}>
                    <strong>{fmtCell(row.today)}</strong>
                  </td>
                  {dateKeys.map((dk, i) => {
                    const val = row[dk] ?? 0
                    const hasMat = allMatKeys.some(mk => mk <= dk)
                    return (
                      <td key={i} className="num-cell" style={{ color: colorForValue(val) }}>
                        <strong>{fmtCell(val)}</strong>
                        {hasMat && (
                          <span className="liquidity-maturity-asterisk" title="Fälligkeiten fließen ein"> *</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="num-cell">{row.maturities ?? 0}</td>
                </tr>,

                ...(isExpanded && hasCurrencies ? row.currency_rows.map((crow) => (
                  <tr key={`${row.portfolio}-${crow.currency}`} className="liquidity-currency-row">
                    <td className="liquidity-currency-name">↳ {crow.currency}</td>
                    <td className="num-cell" style={{ color: colorForValue(crow.today), opacity: 0.85 }}>
                      {fmtCell(crow.today)}
                    </td>
                    {dateKeys.map((dk, i) => {
                      const val = crow[dk] ?? 0
                      return (
                        <td key={i} className="num-cell" style={{ color: colorForValue(val), opacity: 0.85 }}>
                          {fmtCell(val)}
                        </td>
                      )
                    })}
                    <td className="num-cell">—</td>
                  </tr>
                )) : []),
              ]
            })}
          </tbody>
        </table>
      </div>
      <div className="portfolio-export-row">
        <button className="portfolio-export-btn xlsx" onClick={onExport} title="Zu Excel hinzufügen">
          <ExcelIcon width={26} height={26} />
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS ─ PORTFOLIO TAB
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Portfolio Metric Cards ───────────────────────────────────────────────────
function PortfolioMetricCards({ metrics }) {
  if (!metrics) return null
  const { total_value, total_holdings, top_holding_weight, equity_pct, fi_pct, cash_pct } = metrics

  const fmt = (v, suffix = '') =>
    v != null ? `${Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 })}${suffix}` : '—'

  const cards = [
    { label: 'Gesamtwert',          value: `EUR ${fmt(total_value)}`,   cls: 'card-total' },
    { label: 'Positionen',          value: fmt(total_holdings),          cls: '' },
    { label: 'Größte Position',     value: fmt(top_holding_weight, '%'), cls: '' },
    { label: 'Aktien',              value: fmt(equity_pct, '%'),         cls: 'card-equity' },
    { label: 'Anleihen',            value: fmt(fi_pct, '%'),             cls: 'card-fi' },
    { label: 'Liquidität & Sonst.', value: fmt(cash_pct, '%'),           cls: 'card-cash' },
  ]

  return (
    <div className="portfolio-aum-cards">
      {cards.map(({ label, value, cls }) => (
        <div key={label} className={`portfolio-aum-card ${cls}`}>
          <div className="portfolio-aum-card-label">{label}</div>
          <div className="portfolio-aum-card-value">{value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Holdings Table ───────────────────────────────────────────────────────────
function HoldingsTable({ holdings, onExport }) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState('Gewicht (%)')
  const [sortDir, setSortDir] = useState('desc')

  if (!holdings || holdings.length === 0) {
    return <div className="portfolio-empty">Keine Bestände verfügbar</div>
  }

  const columns = Object.keys(holdings[0])

  const filtered = holdings.filter(row =>
    !search ||
    Object.values(row).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  )

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) return 0
    const av = a[sortCol] ?? ''
    const bv = b[sortCol] ?? ''
    const na = parseFloat(String(av).replace('%', '').replace(/\./g, '').replace(',', '.'))
    const nb = parseFloat(String(bv).replace('%', '').replace(/\./g, '').replace(',', '.'))
    const num = !isNaN(na) && !isNaN(nb)
    const cmp = num ? na - nb : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  return (
    <div className="portfolio-holdings-section">
      <div className="portfolio-section-header">
        <h6 className="portfolio-section-title">Bestände</h6>
        <input
          className="portfolio-search"
          placeholder="Suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="portfolio-table-scroll holdings-scroll">
        <table className="portfolio-data-table holdings-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} onClick={() => handleSort(col)} className="sortable-header">
                  {col}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col}>{row[col] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="portfolio-export-row">
        <button className="portfolio-export-btn xlsx" onClick={onExport} title="Zu Excel hinzufügen">
          <ExcelIcon width={26} height={26} />
        </button>
      </div>
    </div>
  )
}

// ─── Allocation Pie Chart ─────────────────────────────────────────────────────
function AllocationPieChart({ title, chartId, data, latestDate, tab }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!data || data.length === 0) {
    return (
      <div className="portfolio-pie-container">
        <div className="portfolio-section-header">
          <h6 className="portfolio-section-title">{title}</h6>
        </div>
        <div className="portfolio-empty">Keine Daten</div>
      </div>
    )
  }

  const exportChartData = data.map(d => ({ name: d.name, Wert: d.value }))
  const exportItem = {
    id:         `portfolio-${chartId}`,
    title:      `Portfolios – ${title}`,
    pptx_title: title,
    subheading: latestDate ? `Datum: ${latestDate}` : '',
    source:     'Eigene Berechnungen',
    tab,
    chartData:  exportChartData,
    regions:    ['Wert'],
    xKey:       'name',
  }

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.04) return null
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
            fontSize={11} fontWeight={600}>
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    )
  }

  return (
    <div className="portfolio-pie-container">
      <div className="portfolio-section-header">
        <h6 className="portfolio-section-title">{title}</h6>
      </div>
      <div className="portfolio-pie-wrapper">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={110}
              labelLine={false}
              label={renderCustomLabel}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <ReTooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              iconType="circle"
              iconSize={10}
              formatter={(value) => <span style={{ fontSize: 12 }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {latestDate && (
        <div className="portfolio-chart-date">Aktualität: {latestDate}</div>
      )}
      <div className="portfolio-export-row">
        <button className="portfolio-export-btn pptx" onClick={() => addToPptx(exportItem)}
                title="Zu PowerPoint hinzufügen">
          <PowerPointIcon width={26} height={26} />
        </button>
        <button className="portfolio-export-btn xlsx" onClick={() => addToXlsx(exportItem)}
                title="Zu Excel hinzufügen">
          <ExcelIcon width={26} height={26} />
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewTab({ data, loading, error, onExportAum, onExportLiquidity }) {
  if (loading) return <div className="portfolio-loading">Daten werden geladen…</div>
  if (error)   return <div className="portfolio-error">Fehler: {error}</div>
  if (!data)   return null

  return (
    <div className="portfolio-overview">
      <AumCards cards={data.aum_cards} />
      <div className="portfolio-tables-row">
        <AumTable
          rows={data.aum_table_rows}
          columns={data.aum_table_cols}
          onExport={onExportAum}
        />
        <LiquidityTable
          rows={data.liquidity_rows}
          dateLabels={data.liquidity_date_labels || []}
          dateKeys={data.liquidity_date_keys || []}
          onExport={onExportLiquidity}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO TAB WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

const PIE_CHART_DEFS = [
  { key: 'asset_type',     title: 'Vermögensaufteilung',                    id: 'asset-type' },
  { key: 'security_type',  title: 'Wertpapiertyp-Aufteilung',               id: 'security-type' },
  { key: 'country',        title: 'Länderaufteilung (Gesamt)',               id: 'country' },
  { key: 'country_equity', title: 'Länderaufteilung (Aktien)',               id: 'country-equity' },
  { key: 'country_fi',     title: 'Länderaufteilung (Anleihen)',             id: 'country-fi' },
  { key: 'sector_equity',  title: 'Sektoraufteilung (Aktien)',               id: 'sector-equity' },
  { key: 'bond_split',     title: 'Anleihenaufteilung (Corp. vs. Staatl.)', id: 'bond-split' },
]

function PortfolioTab({
  portfolioList, selectedPortfolio, portfolioData,
  loadingPortfolio, errorPortfolio,
  onPortfolioChange, onExportHoldings,
}) {
  return (
    <div className="portfolio-tab-content">
      <div className="portfolio-controls-row">
        <label className="portfolio-selector-label">Portfolio auswählen:</label>
        <select
          className="portfolio-selector"
          value={selectedPortfolio || ''}
          onChange={e => onPortfolioChange(e.target.value)}
        >
          {!selectedPortfolio && <option value="">– bitte wählen –</option>}
          {(portfolioList || []).map(({ label, value }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {loadingPortfolio && <div className="portfolio-loading">Daten werden geladen…</div>}
      {errorPortfolio   && <div className="portfolio-error">Fehler: {errorPortfolio}</div>}

      {portfolioData && !loadingPortfolio && (
        <>
          <PortfolioMetricCards metrics={portfolioData.metrics} />
          <HoldingsTable holdings={portfolioData.holdings} onExport={onExportHoldings} />
          <div className="portfolio-pie-grid">
            {PIE_CHART_DEFS.map(({ key, title, id }) => {
              const slices = portfolioData.allocation?.[key]
              if (!slices || slices.length === 0) return null
              return (
                <AllocationPieChart
                  key={key}
                  title={title}
                  chartId={id}
                  data={slices}
                  latestDate={portfolioData.latest_date}
                  tab="Portfolios"
                />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE TAB
// ═══════════════════════════════════════════════════════════════════════════════

const FUND_TEAM_MAP = {
  MA:      ['Forte', 'DuoPlus', 'GEP', 'Vivace', 'Piano', 'Mezzo'],
  HC:      ['AMO', 'ADH', 'AMB', 'MBH', 'AFH', 'AMC', 'Stiftung'],
  Spezial: ['PoolD', 'Elbe', 'Nordrhein', 'RVAB', 'AVW', 'SAE'],
}

const PERF_COLORS = [
  '#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6',
  '#ec4899','#14b8a6','#f43f5e','#6366f1','#84cc16',
  '#06b6d4','#a855f7','#fb923c','#22d3ee','#e879f9',
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

function firstOfMonth(dateStr) {
  return dateStr.slice(0, 8) + '01'
}

function lastDayOfPrevMonth(dateStr) {
  const d = new Date(dateStr)
  d.setDate(0)          // last day of previous month
  return d.toISOString().slice(0, 10)
}

function fmtPerf(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function relColor(v) {
  if (v == null || isNaN(v)) return {}
  return v > 0
    ? { color: 'var(--portfolio-positive)', fontWeight: 600 }
    : v < 0
      ? { color: 'var(--portfolio-negative)', fontWeight: 600 }
      : {}
}

// Merge multi-series [{name, dates, values}] into recharts [{date, s1, s2, ...}]
function mergeChartSeries(seriesList) {
  if (!seriesList?.length) return []
  const map = new Map()
  seriesList.forEach(({ name, dates, values }) => {
    dates.forEach((d, i) => {
      if (!map.has(d)) map.set(d, { date: d })
      map.get(d)[name] = values[i]
    })
  })
  return Array.from(map.values()).sort((a, b) => a.date < b.date ? -1 : 1)
}

function PerformanceTab() {
  const today = todayStr()

  // ── Controls ──────────────────────────────────────────────────────────────
  const [activeTeams, setActiveTeams]       = useState({ MA: false, HC: false, Spezial: false })
  const [selectedFunds, setSelectedFunds]   = useState([])
  const [source, setSource]                 = useState('kvg')
  const [anteilsklasse, setAnteilsklasse]   = useState({ V: true, R: false })
  const [portfolioType, setPortfolioType]   = useState({ All: true, EQ: false, FI: false })

  // ── Table controls ────────────────────────────────────────────────────────
  const [asOfDate, setAsOfDate]     = useState(today)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd]     = useState('')
  const [tableData, setTableData]     = useState(null)
  const [loadingTable, setLoadingTable] = useState(false)
  const [errorTable, setErrorTable]   = useState(null)

  // ── Chart controls ────────────────────────────────────────────────────────
  const [activePeriod, setActivePeriod] = useState('YtD')
  const [chartStart, setChartStart]     = useState(firstOfMonth(today.slice(0,4) + '-01-01'))
  const [chartEnd, setChartEnd]         = useState(today)
  const [showBenchmarks, setShowBenchmarks] = useState(false)
  const [chartData, setChartData]       = useState(null)
  const [loadingChart, setLoadingChart] = useState(false)
  const [errorChart, setErrorChart]     = useState(null)

  // ── Determine visible funds from team filter ──────────────────────────────
  const anyTeam = Object.values(activeTeams).some(Boolean)
  const visibleFunds = anyTeam
    ? Object.entries(activeTeams).flatMap(([t, on]) => on ? FUND_TEAM_MAP[t] : [])
    : Object.values(FUND_TEAM_MAP).flat()

  // Remove selected funds no longer visible when filter changes
  useEffect(() => {
    setSelectedFunds(prev => prev.filter(f => visibleFunds.includes(f)))
  }, [activeTeams])   // eslint-disable-line

  // ── Set chart date from period button ─────────────────────────────────────
  const applyPeriod = (period) => {
    setActivePeriod(period)
    const t = today
    if (period === 'MtD')    { setChartStart(firstOfMonth(t));                  setChartEnd(t) }
    else if (period === '1M') { setChartStart(addMonths(t, -1));                 setChartEnd(t) }
    else if (period === 'LM') { const lm = lastDayOfPrevMonth(t); setChartStart(firstOfMonth(lm)); setChartEnd(lm) }
    else if (period === 'YtD') { setChartStart(t.slice(0,4) + '-01-01');         setChartEnd(t) }
    else if (period === '1Y')  { setChartStart(addMonths(t, -12));               setChartEnd(t) }
  }

  // ── Set initial chart range to YtD ───────────────────────────────────────
  useEffect(() => { applyPeriod('YtD') }, [])  // eslint-disable-line

  // ── Load table ───────────────────────────────────────────────────────────
  const loadTable = useCallback(() => {
    if (!selectedFunds.length) return
    setLoadingTable(true)
    setErrorTable(null)
    axios.post(`${API_BASE}/api/portfolios/performance/table`, {
      portfolios:     selectedFunds,
      source,
      anteilsklasse,
      portfolio_type: portfolioType,
      as_of_date:     asOfDate || null,
      custom_start:   customStart || null,
      custom_end:     customEnd   || null,
    })
      .then(r => setTableData(r.data))
      .catch(e => setErrorTable(e.message))
      .finally(() => setLoadingTable(false))
  }, [selectedFunds, source, anteilsklasse, portfolioType, asOfDate, customStart, customEnd])

  // ── Load chart ───────────────────────────────────────────────────────────
  const loadChart = useCallback(() => {
    if (!selectedFunds.length) return
    setLoadingChart(true)
    setErrorChart(null)
    axios.post(`${API_BASE}/api/portfolios/performance/chart`, {
      portfolios:      selectedFunds,
      source,
      portfolio_type:  portfolioType,
      anteilsklasse,
      start_date:      chartStart || null,
      end_date:        chartEnd   || null,
      show_benchmarks: showBenchmarks,
    })
      .then(r => setChartData(r.data))
      .catch(e => setErrorChart(e.message))
      .finally(() => setLoadingChart(false))
  }, [selectedFunds, source, portfolioType, anteilsklasse, chartStart, chartEnd, showBenchmarks])

  // ── Derived chart data ───────────────────────────────────────────────────
  const mergedChart = chartData?.series ? mergeChartSeries(chartData.series) : []

  // Assign stable colors per series name
  const seriesColorMap = {}
  ;(chartData?.series || []).forEach((s, i) => {
    if (!seriesColorMap[s.displayName]) {
      seriesColorMap[s.displayName] = PERF_COLORS[Object.keys(seriesColorMap).length % PERF_COLORS.length]
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────
  const TABLE_PERIODS = ['MtD', 'LM', 'YtD', '1Y']

  return (
    <div className="perf-tab">
      {/* ─── Shared controls ─────────────────────────────────────────── */}
      <div className="perf-shared-controls">
        {/* Team filter */}
        <div className="perf-control-group">
          <span className="perf-control-label">Team:</span>
          {['MA', 'HC', 'Spezial'].map(t => (
            <button
              key={t}
              className={`perf-team-btn${activeTeams[t] ? ' active' : ''}`}
              onClick={() => setActiveTeams(prev => ({ ...prev, [t]: !prev[t] }))}
            >{t}</button>
          ))}
        </div>

        {/* Fund multi-select */}
        <div className="perf-control-group perf-fund-select-wrap">
          <span className="perf-control-label">Fonds:</span>
          <div className="perf-fund-checklist">
            {visibleFunds.map(f => (
              <label key={f} className="perf-fund-check-item">
                <input
                  type="checkbox"
                  checked={selectedFunds.includes(f)}
                  onChange={e => setSelectedFunds(prev =>
                    e.target.checked ? [...prev, f] : prev.filter(x => x !== f)
                  )}
                />
                {f}
              </label>
            ))}
          </div>
        </div>

        {/* Source, Anteilsklasse, Portfolio Type */}
        <div className="perf-control-group">
          <span className="perf-control-label">Quelle:</span>
          {['kvg', 'bloomberg'].map(s => (
            <button
              key={s}
              className={`perf-toggle-btn${source === s ? ' active' : ''}`}
              onClick={() => setSource(s)}
            >{s === 'kvg' ? 'KVG' : 'Bloomberg'}</button>
          ))}
        </div>

        <div className="perf-control-group">
          <span className="perf-control-label">Anteilsklasse:</span>
          {['V', 'R'].map(k => (
            <button
              key={k}
              className={`perf-toggle-btn${anteilsklasse[k] ? ' active' : ''}`}
              onClick={() => setAnteilsklasse(prev => ({ ...prev, [k]: !prev[k] }))}
            >{k}</button>
          ))}
        </div>

        <div className="perf-control-group">
          <span className="perf-control-label">Portfolio Typ:</span>
          {['All', 'EQ', 'FI'].map(t => (
            <button
              key={t}
              className={`perf-toggle-btn${portfolioType[t] ? ' active' : ''}`}
              onClick={() => setPortfolioType(prev => ({ ...prev, [t]: !prev[t] }))}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* ─── Two-column: table left, chart right ─────────────────────── */}
      <div className="perf-two-col">
        {/* LEFT: Table panel */}
        <div className="perf-panel">
          <div className="perf-panel-header">
            <h6 className="perf-panel-title">Performance-Tabelle</h6>
            <div className="perf-table-controls">
              <label className="perf-control-label">As-of:</label>
              <input
                type="date" className="perf-date-input"
                value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
              />
              <label className="perf-control-label">Custom Start:</label>
              <input
                type="date" className="perf-date-input"
                value={customStart} onChange={e => setCustomStart(e.target.value)}
              />
              <label className="perf-control-label">Custom End:</label>
              <input
                type="date" className="perf-date-input"
                value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              />
              <button
                className="perf-load-btn"
                onClick={loadTable}
                disabled={!selectedFunds.length || loadingTable}
              >
                {loadingTable ? 'Lade…' : 'Laden'}
              </button>
            </div>
          </div>

          {errorTable && <div className="portfolio-error">Fehler: {errorTable}</div>}

          {!tableData && !loadingTable && (
            <div className="portfolio-empty">
              Fonds auswählen und «Laden» klicken.
            </div>
          )}

          {tableData?.rows?.length > 0 && (
            <div className="perf-table-scroll">
              <table className="perf-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="perf-th-portfolio">Portfolio</th>
                    {TABLE_PERIODS.map(p => (
                      <th key={p} colSpan={3} className="perf-th-period">{p}</th>
                    ))}
                    {tableData.has_custom && (
                      <th colSpan={3} className="perf-th-period">Custom</th>
                    )}
                  </tr>
                  <tr>
                    {TABLE_PERIODS.flatMap(p => [
                      <th key={`${p}r`} className="perf-th-sub">Port (%)</th>,
                      <th key={`${p}b`} className="perf-th-sub">Bench (%)</th>,
                      <th key={`${p}d`} className="perf-th-sub">Rel (%)</th>,
                    ])}
                    {tableData.has_custom && [
                      <th key="cr"  className="perf-th-sub">Port (%)</th>,
                      <th key="cb"  className="perf-th-sub">Bench (%)</th>,
                      <th key="cd"  className="perf-th-sub">Rel (%)</th>,
                    ]}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="perf-td-portfolio">{row.Portfolio}</td>
                      {TABLE_PERIODS.flatMap(p => {
                        const port  = row[`${p} (%)`]
                        const bench = row[`${p} Bench (%)`]
                        const rel   = row[`${p} Rel (%)`]
                        return [
                          <td key={`${p}r`} className="perf-td-num">{fmtPerf(port)}</td>,
                          <td key={`${p}b`} className="perf-td-num">{fmtPerf(bench)}</td>,
                          <td key={`${p}d`} className="perf-td-num perf-td-rel" style={relColor(rel)}>{fmtPerf(rel)}</td>,
                        ]
                      })}
                      {tableData.has_custom && (() => {
                        const cp = row['Custom (%)']
                        const cb = row['Custom Bench (%)']
                        const cr = row['Custom Rel (%)']
                        return [
                          <td key="cr"  className="perf-td-num">{fmtPerf(cp)}</td>,
                          <td key="cb"  className="perf-td-num">{fmtPerf(cb)}</td>,
                          <td key="cd"  className="perf-td-num perf-td-rel" style={relColor(cr)}>{fmtPerf(cr)}</td>,
                        ]
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT: Chart panel */}
        <div className="perf-panel">
          <div className="perf-panel-header">
            <h6 className="perf-panel-title">Kumulierte Performance</h6>
            <div className="perf-chart-controls">
              {['MtD', '1M', 'LM', 'YtD', '1Y'].map(p => (
                <button
                  key={p}
                  className={`perf-period-btn${activePeriod === p ? ' active' : ''}`}
                  onClick={() => applyPeriod(p)}
                >{p}</button>
              ))}
            </div>
            <div className="perf-chart-controls">
              <label className="perf-control-label">Von:</label>
              <input
                type="date" className="perf-date-input"
                value={chartStart} onChange={e => { setChartStart(e.target.value); setActivePeriod('') }}
              />
              <label className="perf-control-label">Bis:</label>
              <input
                type="date" className="perf-date-input"
                value={chartEnd} onChange={e => { setChartEnd(e.target.value); setActivePeriod('') }}
              />
              <label className="perf-check-label">
                <input
                  type="checkbox"
                  checked={showBenchmarks}
                  onChange={e => setShowBenchmarks(e.target.checked)}
                />
                Benchmarks
              </label>
              <button
                className="perf-load-btn"
                onClick={loadChart}
                disabled={!selectedFunds.length || loadingChart}
              >
                {loadingChart ? 'Lade…' : 'Laden'}
              </button>
            </div>
          </div>

          {errorChart && <div className="portfolio-error">Fehler: {errorChart}</div>}

          {!chartData && !loadingChart && (
            <div className="portfolio-empty">Fonds auswählen und «Laden» klicken.</div>
          )}

          {chartData?.series?.length > 0 && (
            <div className="perf-chart-wrapper">
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={mergedChart} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v.toFixed(1)}%`}
                    width={55}
                  />
                  <LineTooltip
                    formatter={(v, name) => [v != null ? `${v.toFixed(2)}%` : '—', name]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {(chartData.series || []).map(s => (
                    <Line
                      key={s.name}
                      type="monotone"
                      dataKey={s.name}
                      stroke={seriesColorMap[s.displayName] || '#3b82f6'}
                      strokeDasharray={s.type === 'benchmark' ? '5 5' : undefined}
                      dot={false}
                      strokeWidth={1.8}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTRIBUTION TAB
// ═══════════════════════════════════════════════════════════════════════════════

const ATTR_NUM_COLS = [
  ['weightPortfolio', 'Port'],  ['weightBenchmark', 'Bench'],  ['weightActive', 'Active'],
  ['CTRPortfolio',    'Port'],  ['CTRBenchmark',    'Bench'],  ['CTRActive',    'Active'],
  ['returnPortfolio', 'Port'],  ['returnBenchmark', 'Bench'],  ['returnActive', 'Active'],
]
const ATTR_INDENT = [6, 14, 26, 38]

function AttributionTab() {
  const [meta,         setMeta]         = useState(null)
  const [loadingMeta,  setLoadingMeta]  = useState(true)
  const [selPortfolio, setSelPortfolio] = useState('')
  const [selScope,     setSelScope]     = useState('')
  const [selPeriod,    setSelPeriod]    = useState('')
  const [selDate,      setSelDate]      = useState('')
  const [rows,         setRows]         = useState([])
  const [loadingTable, setLoadingTable] = useState(false)
  const [errorTable,   setErrorTable]   = useState(null)
  const [runDate,      setRunDate]      = useState(null)
  const [expanded,     setExpanded]     = useState(new Set())
  const [filters,      setFilters]      = useState({})
  const [sortCol,      setSortCol]      = useState(null)
  const [sortDir,      setSortDir]      = useState('asc')
  const [chartLevelMode, setChartLevelMode] = useState('l2_all')
  const [chartL2Filter,  setChartL2Filter]  = useState('')
  const [chartVizMode,   setChartVizMode]   = useState('outperf')

  // ── Load meta once ──────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API_BASE}/api/portfolios/attribution/meta`)
      .then(r => {
        setMeta(r.data)
        const portfolios = r.data.portfolios || []
        const def = portfolios.includes('Mezzo') ? 'Mezzo' : portfolios[0] || ''
        setSelPortfolio(def)
      })
      .catch(e => console.error('Attribution meta:', e))
      .finally(() => setLoadingMeta(false))
  }, [])

  // ── Cascade: portfolio → scope ──────────────────────────────────────────────
  useEffect(() => {
    if (!meta || !selPortfolio) return
    const scopes = meta.scopes_by_portfolio?.[selPortfolio] || []
    const def = scopes.includes('Gesamt') ? 'Gesamt' : scopes[0] || ''
    setSelScope(def)
  }, [meta, selPortfolio])  // eslint-disable-line

  // ── Cascade: scope → period ─────────────────────────────────────────────────
  useEffect(() => {
    if (!meta || !selPortfolio || !selScope) return
    const periods = meta.periods_by_portfolio_scope?.[selPortfolio]?.[selScope] || []
    const PREF = ['YTD', 'MTD', 'YTDM']
    const def = periods.find(p => PREF.includes(p.toUpperCase())) || periods[0] || ''
    setSelPeriod(def)
  }, [meta, selPortfolio, selScope])  // eslint-disable-line

  // ── Cascade: period → date ──────────────────────────────────────────────────
  useEffect(() => {
    if (!meta || !selPortfolio || !selScope || !selPeriod) return
    const dates = meta.dates_by_portfolio_scope_period?.[selPortfolio]?.[selScope]?.[selPeriod] || []
    setSelDate(dates[0] || '')
  }, [meta, selPortfolio, selScope, selPeriod])  // eslint-disable-line

  // ── Load table ──────────────────────────────────────────────────────────────
  const loadTable = () => {
    if (!selPortfolio || !selScope || !selPeriod) return
    setLoadingTable(true)
    setErrorTable(null)
    axios.post(`${API_BASE}/api/portfolios/attribution/table`, {
      portfolio_name: selPortfolio,
      scope:          selScope,
      period:         selPeriod,
      run_date:       selDate || null,
    })
      .then(r => {
        const data = r.data.rows || []
        setRows(data)
        setRunDate(r.data.run_date || null)
        // Auto-expand L2 rows
        const initial = new Set(data.filter(row => row.structure === 'Main').map(row => row.id))
        setExpanded(initial)
        setSortCol(null)
        setFilters({})
      })
      .catch(e => setErrorTable(e.message))
      .finally(() => setLoadingTable(false))
  }

  // ── Precompute children map ─────────────────────────────────────────────────
  const childrenOf = useMemo(() => {
    const m = {}
    rows.forEach(r => {
      if (r.parent_id !== null) {
        if (!m[r.parent_id]) m[r.parent_id] = []
        m[r.parent_id].push(r.id)
      }
    })
    return m
  }, [rows])

  const hasChildren = id => !!(childrenOf[id]?.length)

  const rowById = useMemo(() => {
    const m = {}
    rows.forEach(r => { m[r.id] = r })
    return m
  }, [rows])

  // ── L2 options for chart filter ─────────────────────────────────────────────
  const l2Options = useMemo(() => (
    [...new Set(rows.filter(r => r.structure === 'Main').map(r => r.level2).filter(Boolean))]
  ), [rows])

  useEffect(() => {
    if (l2Options.length > 0) setChartL2Filter(prev => prev || l2Options[0])
  }, [l2Options]) // eslint-disable-line

  // ── Chart data (derived client-side from table rows) ─────────────────────
  const SEC_STRUCTS = ['Main|Sub|Security', 'Main|DirectSecurity', 'OnlySecurity']
  const chartData = useMemo(() => {
    if (!rows.length) return []
    let filtered
    if      (chartLevelMode === 'l2_all')   filtered = rows.filter(r => r.structure === 'Main')
    else if (chartLevelMode === 'l3_by_l2') filtered = rows.filter(r => r.structure === 'Main|Sub' && r.level2 === chartL2Filter)
    else if (chartLevelMode === 'sec_by')   filtered = rows.filter(r => SEC_STRUCTS.includes(r.structure) && r.level2 === chartL2Filter)
    else                                    filtered = rows.filter(r => SEC_STRUCTS.includes(r.structure))
    return filtered.map(r => {
      const rp = r.returnPortfolio, rb = r.returnBenchmark
      const outperf = (rp != null && rb != null) ? +((rp - rb).toFixed(4)) : null
      return {
        name:            r.name,
        returnPortfolio: rp,
        returnBenchmark: rb,
        outperformance:  outperf,
        CTRPortfolio:    r.CTRPortfolio,
        weightPortfolio: r.weightPortfolio,
        fillReturn:  (rp != null && rb != null && rp >= rb) ? '#33a02c' : '#d73027',
        fillOutperf: (rp != null && rb != null && rp >= rb) ? '#33a02c' : '#d73027',
        fillCTR:     (r.CTRPortfolio != null && r.CTRPortfolio >= 0) ? '#33a02c' : '#d73027',
      }
    })
  }, [rows, chartLevelMode, chartL2Filter]) // eslint-disable-line

  // ── Toggle row expansion ────────────────────────────────────────────────────
  const toggleRow = useCallback(id => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        // Collapse this node and all its descendants
        const queue = [id]
        while (queue.length) {
          const cur = queue.shift()
          next.delete(cur)
          ;(childrenOf[cur] || []).forEach(cid => queue.push(cid))
        }
      } else {
        next.add(id)
      }
      return next
    })
  }, [childrenOf])

  const expandAll  = () => setExpanded(new Set(rows.filter(r => hasChildren(r.id)).map(r => r.id)))
  const collapseAll = () => setExpanded(new Set())

  // ── Visibility check ────────────────────────────────────────────────────────
  const isVisible = useCallback(row => {
    if (row.parent_id === null) return true
    if (!expanded.has(row.parent_id)) return false
    const parent = rowById[row.parent_id]
    if (!parent) return true
    return isVisible(parent)
  }, [expanded, rowById])

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const matchesFilters = useCallback(row => {
    return Object.entries(filters).every(([col, fval]) => {
      if (!fval) return true
      const cell = col === 'name' ? (row.name || '') : String(row[col] ?? '')
      return cell.toLowerCase().includes(fval.toLowerCase())
    })
  }, [filters])

  const visibleRows = useMemo(() => {
    let result = rows.filter(row => isVisible(row) && matchesFilters(row))
    if (sortCol) {
      result = [...result].sort((a, b) => {
        let av = sortCol === 'name' ? (a.name || '') : (a[sortCol] ?? null)
        let bv = sortCol === 'name' ? (b.name || '') : (b[sortCol] ?? null)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        if (typeof av === 'string') av = av.toLowerCase()
        if (typeof bv === 'string') bv = bv.toLowerCase()
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [rows, isVisible, matchesFilters, sortCol, sortDir])

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const setFilter = (col, val) => setFilters(prev => ({ ...prev, [col]: val }))

  const fmtNum = v => v == null ? '' : Number(v).toFixed(2)

  const numCls = (v, colorize = false) => {
    if (!colorize || v == null) return ''
    if (v > 0) return 'attr-pos'
    if (v < 0) return 'attr-neg'
    return ''
  }

  const sortArrow = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const rowBgCls = row => {
    if (row.structure === 'Overarching') {
      if (row.level1 === 'Overall')   return 'attr-row-overall'
      if (row.level1 === 'Residuals') return 'attr-row-residuals'
      return 'attr-row-holdings'
    }
    if (row.structure === 'Main')     return 'attr-row-l2'
    if (row.structure === 'Main|Sub') return 'attr-row-l3'
    return 'attr-row-security'
  }

  const scopeOpts   = meta?.scopes_by_portfolio?.[selPortfolio] || []
  const periodOpts  = meta?.periods_by_portfolio_scope?.[selPortfolio]?.[selScope] || []
  const dateOpts    = meta?.dates_by_portfolio_scope_period?.[selPortfolio]?.[selScope]?.[selPeriod] || []

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="attr-tab">
      {/* Controls */}
      <div className="attr-controls">
        <div className="attr-ctrl-group">
          <label className="attr-ctrl-label">Portfolio</label>
          <select className="attr-select" value={selPortfolio}
            onChange={e => setSelPortfolio(e.target.value)} disabled={loadingMeta}>
            {!selPortfolio && <option value="">– wählen –</option>}
            {(meta?.portfolios || []).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="attr-ctrl-group">
          <label className="attr-ctrl-label">Scope</label>
          <select className="attr-select" value={selScope}
            onChange={e => setSelScope(e.target.value)} disabled={!scopeOpts.length}>
            {!selScope && <option value="">–</option>}
            {scopeOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="attr-ctrl-group">
          <label className="attr-ctrl-label">Periode</label>
          <select className="attr-select" value={selPeriod}
            onChange={e => setSelPeriod(e.target.value)} disabled={!periodOpts.length}>
            {!selPeriod && <option value="">–</option>}
            {periodOpts.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="attr-ctrl-group">
          <label className="attr-ctrl-label">Datum</label>
          <select className="attr-select" value={selDate}
            onChange={e => setSelDate(e.target.value)} disabled={!dateOpts.length}>
            {!selDate && <option value="">–</option>}
            {dateOpts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button className="attr-load-btn" onClick={loadTable}
          disabled={!selPortfolio || !selScope || !selPeriod || loadingTable}>
          {loadingTable ? 'Lade…' : 'Laden'}
        </button>
        {rows.length > 0 && <>
          <button className="attr-expand-btn" onClick={expandAll}>▼ Aufklappen</button>
          <button className="attr-expand-btn" onClick={collapseAll}>▶ Einklappen</button>
        </>}
        {runDate && <span className="attr-run-date">Stand: {runDate}</span>}
      </div>

      {errorTable && <div className="portfolio-error">Fehler: {errorTable}</div>}

      {!rows.length && !loadingTable && (
        <div className="portfolio-empty">Portfolio, Scope, Periode und Datum auswählen und «Laden» klicken.</div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="attr-table-wrap">
          <table className="attr-table">
            <thead>
              {/* Group headers */}
              <tr className="attr-thead-group">
                <th colSpan={2} className="attr-th-name-header">Name</th>
                <th colSpan={3} className="attr-th-group">Weight (%)</th>
                <th colSpan={3} className="attr-th-group">CTR (pp)</th>
                <th colSpan={3} className="attr-th-group">Return (%)</th>
              </tr>
              {/* Sub-headers (sortable) */}
              <tr className="attr-thead-sub">
                <th className="attr-th-name attr-sortable" colSpan={2}
                  onClick={() => handleSort('name')}>Name{sortArrow('name')}</th>
                {ATTR_NUM_COLS.map(([col, lbl]) => (
                  <th key={col} className="attr-th-num attr-sortable"
                    onClick={() => handleSort(col)}>{lbl}{sortArrow(col)}</th>
                ))}
              </tr>
              {/* Filter row */}
              <tr className="attr-thead-filter">
                <th colSpan={2} className="attr-th-filter-name">
                  <input type="text" placeholder="Name filtern…" className="attr-filter-input"
                    value={filters.name || ''} onChange={e => setFilter('name', e.target.value)} />
                </th>
                {ATTR_NUM_COLS.map(([col]) => (
                  <th key={col} className="attr-th-filter-num">
                    <input type="text" placeholder="…" className="attr-filter-input attr-filter-num"
                      value={filters[col] || ''} onChange={e => setFilter(col, e.target.value)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const hasKids   = hasChildren(row.id)
                const isExp     = expanded.has(row.id)
                const indent    = ATTR_INDENT[Math.min(row.level, ATTR_INDENT.length - 1)]
                const bgCls     = rowBgCls(row)
                return (
                  <tr key={row.id} className={`attr-tr ${bgCls}`}>
                    <td className="attr-td-toggle">
                      {hasKids
                        ? <button className={`attr-toggle${isExp ? ' expanded' : ''}`}
                            onClick={() => toggleRow(row.id)}
                            title={isExp ? 'Einklappen' : 'Aufklappen'}>
                            {isExp ? '▼' : '▶'}
                          </button>
                        : <span className="attr-toggle-spacer" />}
                    </td>
                    <td className="attr-td-name" style={{ paddingLeft: `${indent}px` }}>
                      {row.name}
                    </td>
                    <td className="attr-td-num">{fmtNum(row.weightPortfolio)}</td>
                    <td className="attr-td-num">{fmtNum(row.weightBenchmark)}</td>
                    <td className={`attr-td-num ${numCls(row.weightActive)}`}>{fmtNum(row.weightActive)}</td>
                    <td className={`attr-td-num ${numCls(row.CTRPortfolio, true)}`}>{fmtNum(row.CTRPortfolio)}</td>
                    <td className="attr-td-num">{fmtNum(row.CTRBenchmark)}</td>
                    <td className={`attr-td-num ${numCls(row.CTRActive, true)}`}>{fmtNum(row.CTRActive)}</td>
                    <td className={`attr-td-num ${numCls(row.returnPortfolio, true)}`}>{fmtNum(row.returnPortfolio)}</td>
                    <td className="attr-td-num">{fmtNum(row.returnBenchmark)}</td>
                    <td className={`attr-td-num ${numCls(row.returnActive, true)}`}>{fmtNum(row.returnActive)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Attribution Charts ───────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="attr-chart-section">
          <div className="attr-chart-controls">
            <div className="attr-ctrl-group">
              <label className="attr-ctrl-label">Ansicht</label>
              <select className="attr-select" value={chartLevelMode} onChange={e => setChartLevelMode(e.target.value)}>
                <option value="l2_all">Kategorien (L2)</option>
                <option value="l3_by_l2">Unterkategorien (L3)</option>
                <option value="sec_by">Wertpapiere nach Kategorie</option>
                <option value="sec_all">Alle Wertpapiere</option>
              </select>
            </div>
            {(chartLevelMode === 'l3_by_l2' || chartLevelMode === 'sec_by') && (
              <div className="attr-ctrl-group">
                <label className="attr-ctrl-label">Kategorie</label>
                <select className="attr-select" value={chartL2Filter} onChange={e => setChartL2Filter(e.target.value)}>
                  {l2Options.map(l2 => <option key={l2} value={l2}>{l2}</option>)}
                </select>
              </div>
            )}
            <div className="attr-ctrl-group">
              <label className="attr-ctrl-label">2. Diagramm</label>
              <select className="attr-select" value={chartVizMode} onChange={e => setChartVizMode(e.target.value)}>
                <option value="outperf">Outperformance (%)</option>
                <option value="ctr">Beitrag CTR (pp)</option>
              </select>
            </div>
          </div>

          {chartData.length > 0 ? (
            <div className="attr-charts-grid">
              {/* Chart 1 – Return vs. Benchmark (horizontal bars) */}
              <div className="attr-chart-panel">
                <p className="attr-chart-title">Return vs. Benchmark (%)</p>
                <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 30 + 60)}>
                  <ComposedChart layout="vertical" data={chartData}
                    margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3"
                      stroke="var(--border-color, #e5e7eb)" />
                    <XAxis type="number" domain={['auto', 'auto']}
                      tickFormatter={v => v.toFixed(1)} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={130}
                      tick={{ fontSize: 10 }} />
                    <LineTooltip
                      formatter={(val, name) => [val == null ? '–' : Number(val).toFixed(2) + '%', name]}
                      contentStyle={{ fontSize: '0.8rem' }} />
                    <ReferenceLine x={0} stroke="#6b7280" strokeWidth={1} />
                    <Bar dataKey="returnPortfolio" name="Return Port." barSize={11} radius={[0, 2, 2, 0]}>
                      {chartData.map((e, i) => <Cell key={i} fill={e.fillReturn} />)}
                    </Bar>
                    <Bar dataKey="returnBenchmark" name="Return Bench." fill="#94a3b8" barSize={5} radius={[0, 2, 2, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Chart 2 – Outperformance or CTR (horizontal bars) */}
              <div className="attr-chart-panel">
                <p className="attr-chart-title">
                  {chartVizMode === 'ctr'
                    ? 'Beitrag zur Performance – CTR Portfolio (pp)'
                    : 'Outperformance Portfolio vs. Benchmark (%)'}
                </p>
                <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 30 + 60)}>
                  <ComposedChart layout="vertical" data={chartData}
                    margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3"
                      stroke="var(--border-color, #e5e7eb)" />
                    <XAxis type="number" domain={['auto', 'auto']}
                      tickFormatter={v => v.toFixed(2)} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={130}
                      tick={{ fontSize: 10 }} />
                    <LineTooltip
                      formatter={(val, name) => [
                        val == null ? '–' : Number(val).toFixed(2) + (chartVizMode === 'ctr' ? ' pp' : '%'),
                        name
                      ]}
                      contentStyle={{ fontSize: '0.8rem' }} />
                    <ReferenceLine x={0} stroke="#6b7280" strokeWidth={1} />
                    <Bar
                      dataKey={chartVizMode === 'ctr' ? 'CTRPortfolio' : 'outperformance'}
                      name={chartVizMode === 'ctr' ? 'CTR Portfolio' : 'Outperformance'}
                      barSize={11} radius={[0, 2, 2, 0]}>
                      {chartData.map((e, i) => (
                        <Cell key={i} fill={chartVizMode === 'ctr' ? e.fillCTR : e.fillOutperf} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="portfolio-empty">Keine Chartdaten für diese Ansicht.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function Portfolios() {
  const { addToXlsx } = useExport()

  // ── Navigation ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview')

  // ── Overview state ────────────────────────────────────────────────────────────
  const [overviewData, setOverviewData]       = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [errorOverview, setErrorOverview]     = useState(null)
  const overviewLoadedRef = useRef(false)

  // ── Portfolio tab state ───────────────────────────────────────────────────────
  const [portfolioList, setPortfolioList]         = useState([])
  const [selectedPortfolio, setSelectedPortfolio] = useState(null)
  const [portfolioData, setPortfolioData]         = useState(null)
  const [loadingPortfolio, setLoadingPortfolio]   = useState(false)
  const [errorPortfolio, setErrorPortfolio]       = useState(null)
  const portfolioListLoadedRef = useRef(false)

  // ── Load overview data once ───────────────────────────────────────────────────
  useEffect(() => {
    if (overviewLoadedRef.current) return
    overviewLoadedRef.current = true
    setLoadingOverview(true)
    setErrorOverview(null)
    axios.get(`${API_BASE}/api/portfolios/overview`)
      .then(res => {
        if (res.data.status === 'error') throw new Error(res.data.error)
        setOverviewData(res.data)
      })
      .catch(err => setErrorOverview(err.message))
      .finally(() => setLoadingOverview(false))
  }, [])

  // ── Load portfolio list when Portfolio tab first activated ────────────────────
  useEffect(() => {
    if (activeTab !== 'portfolio' || portfolioListLoadedRef.current) return
    portfolioListLoadedRef.current = true
    axios.get(`${API_BASE}/api/portfolios/holdings`)
      .then(res => {
        if (res.data.status === 'error') throw new Error(res.data.error)
        const list = res.data.portfolios || []
        setPortfolioList(list)
        if (list.length > 0 && !selectedPortfolio) {
          setSelectedPortfolio(list[0].value)
        }
      })
      .catch(err => console.warn('Portfolio list error:', err.message))
  }, [activeTab, selectedPortfolio])

  // ── Load portfolio detail when selection changes ──────────────────────────────
  useEffect(() => {
    if (!selectedPortfolio) return
    setLoadingPortfolio(true)
    setErrorPortfolio(null)
    setPortfolioData(null)
    axios.get(`${API_BASE}/api/portfolios/holdings/${encodeURIComponent(selectedPortfolio)}`)
      .then(res => {
        if (res.data.status === 'error') throw new Error(res.data.error)
        setPortfolioData(res.data)
      })
      .catch(err => setErrorPortfolio(err.message))
      .finally(() => setLoadingPortfolio(false))
  }, [selectedPortfolio])

  // ── Export helpers ────────────────────────────────────────────────────────────
  const handleExportAumTable = useCallback(() => {
    if (!overviewData?.aum_table_rows?.length) return
    const cols = overviewData.aum_table_cols || []
    addToXlsx({
      id:        'portfolio-aum-table',
      title:     'Portfolios – AUM nach Portfolio',
      pptx_title:'AUM nach Portfolio',
      subheading:'',
      source:    'Eigene Berechnungen',
      tab:       'Portfolios',
      chartData: overviewData.aum_table_rows.map(r => {
        const out = {}
        cols.forEach(col => { out[col] = r[col] ?? '' })
        return out
      }),
      regions: cols.slice(2),
      xKey:    cols[0] || 'Portfolio',
    })
  }, [overviewData, addToXlsx])

  const handleExportLiquidity = useCallback(() => {
    if (!overviewData?.liquidity_rows?.length) return
    const labels = overviewData.liquidity_date_labels || []
    const keys   = overviewData.liquidity_date_keys   || []
    const cols   = ['Portfolio', 'Heute', ...labels, 'Fälligkeiten']
    const rowKeys = ['displayName', 'today', ...keys, 'maturities']
    addToXlsx({
      id:        'portfolio-liquidity-table',
      title:     'Portfolios – Liquiditätsübersicht',
      pptx_title:'Liquiditätsübersicht',
      subheading:'',
      source:    'Eigene Berechnungen',
      tab:       'Portfolios',
      chartData: overviewData.liquidity_rows.map(r => {
        const out = {}
        cols.forEach((col, i) => { out[col] = r[rowKeys[i]] ?? '' })
        return out
      }),
      regions: cols.slice(1),
      xKey:    'Portfolio',
    })
  }, [overviewData, addToXlsx])

  const handleExportHoldings = useCallback(() => {
    if (!portfolioData?.holdings?.length) return
    const cols = Object.keys(portfolioData.holdings[0])
    addToXlsx({
      id:        `portfolio-holdings-${selectedPortfolio}`,
      title:     `Portfolios – Bestände (${selectedPortfolio})`,
      pptx_title:'Bestände',
      subheading: portfolioData.latest_date ? `Datum: ${portfolioData.latest_date}` : '',
      source:    'Eigene Berechnungen',
      tab:       'Portfolios',
      chartData: portfolioData.holdings,
      regions:   cols.slice(1),
      xKey:      cols[0],
    })
  }, [portfolioData, selectedPortfolio, addToXlsx])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="portfolio-page">
      <div className="page-header">
        <h1>Portfolios</h1>
        <p>Portfolio-Management und Überwachung</p>
      </div>

      {/* Sub-tab navigation */}
      <div className="portfolio-subtabs">
        <button
          className={`portfolio-subtab${activeTab === 'overview' ? ' active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >Overview</button>
        <button
          className={`portfolio-subtab${activeTab === 'portfolio' ? ' active' : ''}`}
          onClick={() => setActiveTab('portfolio')}
        >Portfolio</button>
        <button
          className={`portfolio-subtab${activeTab === 'performance' ? ' active' : ''}`}
          onClick={() => setActiveTab('performance')}
        >Performance</button>
        <button
          className={`portfolio-subtab${activeTab === 'attribution' ? ' active' : ''}`}
          onClick={() => setActiveTab('attribution')}
        >Attribution</button>
      </div>

      {/* Both tabs remain mounted to preserve state */}
      <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
        <OverviewTab
          data={overviewData}
          loading={loadingOverview}
          error={errorOverview}
          onExportAum={handleExportAumTable}
          onExportLiquidity={handleExportLiquidity}
        />
      </div>

      <div style={{ display: activeTab === 'portfolio' ? 'block' : 'none' }}>
        <PortfolioTab
          portfolioList={portfolioList}
          selectedPortfolio={selectedPortfolio}
          portfolioData={portfolioData}
          loadingPortfolio={loadingPortfolio}
          errorPortfolio={errorPortfolio}
          onPortfolioChange={setSelectedPortfolio}
          onExportHoldings={handleExportHoldings}
        />
      </div>

      {activeTab === 'performance' && (
        <PerformanceTab />
      )}

      {activeTab === 'attribution' && (
        <AttributionTab />
      )}
    </div>
  )
}

export default Portfolios
