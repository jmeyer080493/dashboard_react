import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
  ReferenceLine,
} from 'recharts'
import { useExport } from '../context/ExportContext'
import './User.css'

// ─── small helpers ────────────────────────────────────────────────────────────

function makeId(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function getDateRange(data, xKey) {
  if (!data || data.length === 0) return ''
  const dates = data.map(r => r[xKey]).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = d => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

const PERIODS = ['MtD', 'YtD', '1Y', 'All']

// ─── Performance chart (two stacked panels) ───────────────────────────────────

function PerformanceChart({ data, latestDate, loading, selectedPeriod, onPeriodChange }) {
  const { addToPptx, addToXlsx } = useExport()

  // Enrich data with clamped positive / negative difference for fill areas
  const enriched = (data || []).map(row => ({
    ...row,
    pos_diff: row.Difference_Pct > 0 ? row.Difference_Pct : 0,
    neg_diff: row.Difference_Pct < 0 ? row.Difference_Pct : 0,
  }))

  const exportItem = {
    id: makeId('User – 5 Faktoren Selektion vs. Eurostoxx 50'),
    title: 'User – 5 Faktoren Selektion vs. Eurostoxx 50',
    pptx_title: '5 Faktoren vs. EuroStoxx 50',
    subheading: getDateRange(enriched, 'DATE'),
    tab: 'User',
    chartData: enriched,
    regions: ['Portfolio_Return_Pct', 'Benchmark_Return_Pct', 'Difference_Pct'],
    xKey: 'DATE',
    group: 1,
  }

  return (
    <div className="user-chart-block">
      {/* Title row + period buttons */}
      <div className="user-chart-header">
        <span className="user-chart-title">5 Faktoren Selektion vs. Eurostoxx 50</span>
        <div className="user-period-buttons">
          {PERIODS.map(p => (
            <button
              key={p}
              className={`user-period-btn${selectedPeriod === p ? ' active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="user-chart-loading">📊 Laden…</div>
      ) : !data || data.length === 0 ? (
        <div className="user-chart-empty">Keine Performance-Daten verfügbar</div>
      ) : (
        <>
          {/* Upper panel – cumulative returns */}
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={enriched} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="DATE" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={v => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11 }}
                width={55}
              />
              <Tooltip
                formatter={(v, name) => [`${v.toFixed(2)}%`, name]}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Portfolio_Return_Pct"
                name="Portfolio"
                stroke="#1f77b4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="Benchmark_Return_Pct"
                name="Benchmark (EuroStoxx 50)"
                stroke="#ff7f0e"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Lower panel – difference with green/red fills */}
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={enriched} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="DATE" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={v => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11 }}
                width={55}
              />
              <Tooltip
                formatter={(v, name) => {
                  if (name === 'Differenz') return [`${v.toFixed(2)}%`, name]
                  return null
                }}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
              />
              <ReferenceLine y={0} stroke="#555" strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="pos_diff"
                fill="rgba(0,160,0,0.25)"
                stroke="none"
                isAnimationActive={false}
                legendType="none"
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="neg_diff"
                fill="rgba(180,0,0,0.2)"
                stroke="none"
                isAnimationActive={false}
                legendType="none"
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="Difference_Pct"
                name="Differenz"
                stroke="#222"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Export buttons + update info */}
      <div className="user-chart-footer">
        <button
          className="user-export-btn pptx"
          onClick={() => addToPptx(exportItem)}
          title="Zu PowerPoint hinzufügen"
        >
          📊 PPTX
        </button>
        <button
          className="user-export-btn xlsx"
          onClick={() => addToXlsx(exportItem)}
          title="Zu Excel hinzufügen"
        >
          📗 Excel
        </button>
        {latestDate && (
          <span className="user-chart-update">Letztes Update: {latestDate}, in EUR</span>
        )}
      </div>
    </div>
  )
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, highlight }) {
  return (
    <div className={`user-card${highlight ? ' user-card--alert' : ''}`}>
      <div className="user-card-label">{label}</div>
      <div className="user-card-value">{value}</div>
    </div>
  )
}

function AlertBox({ alerts, alertDetails }) {
  const hasAlerts = Object.values(alerts || {}).some(Boolean)

  return (
    <div className="user-alert-box">
      <div className="user-alert-box-header">⚠️ Alerts</div>
      {!hasAlerts ? (
        <p className="user-alert-none">Keine aktiven Alerts</p>
      ) : (
        <div className="user-alert-list">
          {(alertDetails || []).map((d, i) => (
            <div key={i} className="user-alert-item">
              <strong className="user-alert-type">📌 {d.type}</strong>
              <div className="user-alert-meta">
                {d.rating    && <span>Rating: <b>{d.rating}</b> · Schwellenwert: {d.threshold}</span>}
                {d.threshold && !d.rating && <span>Schwellenwert: {d.threshold}</span>}
                {d.source    && <div>Quelle: {d.source}</div>}
                {d.fix       && <div>Lösung: {d.fix}</div>}
                {d.status    && <div>Status: {d.status}</div>}
                {d.latest    && <div>Letztes Datum: {d.latest}</div>}
                {d.url && (
                  <div>
                    <a href={d.url} target="_blank" rel="noreferrer" className="user-alert-link">
                      Factsheet herunterladen ↗
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Table with xlsx export ───────────────────────────────────────────────────

function DataTable({ title, rows, updateLabel, dateNeedsHighlight }) {
  const [downloading, setDownloading] = useState(false)

  if (!rows || rows.length === 0) return null
  const columns = Object.keys(rows[0])

  const handleXlsxDownload = async () => {
    setDownloading(true)
    try {
      const response = await axios.post(
        'http://localhost:8000/api/export/table',
        { rows, columns, sheet_name: title.slice(0, 31), filename: title.replace(/\s+/g, '_') },
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/\s+/g, '_')}_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Table export failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="user-table-block">
      <h6 className="user-table-title">{title}</h6>
      <div className="user-table-scroll">
        <table className="user-data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  style={{ textAlign: col === 'Titel' || col === 'Name' ? 'left' : 'center' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map(col => {
                  const isLink    = col === 'Links' && row[col]
                  const isDateCol = col === 'Datum' && typeof dateNeedsHighlight === 'function'
                  const isAlert   = isDateCol && dateNeedsHighlight(row[col])
                  const isDiff    = col === 'Diff'
                  const val       = row[col]
                  return (
                    <td
                      key={col}
                      className={[
                        isAlert ? 'user-td-date-alert' : '',
                        isDiff && val > 0 ? 'user-td-pos' : '',
                        isDiff && val < 0 ? 'user-td-neg' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ textAlign: col === 'Titel' || col === 'Name' ? 'left' : 'center' }}
                    >
                      {isLink ? (
                        <a href={val} target="_blank" rel="noreferrer">🔗</a>
                      ) : (
                        String(val ?? '')
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="user-table-footer">
        <button
          className="user-export-btn xlsx"
          onClick={handleXlsxDownload}
          disabled={downloading}
          title="Als Excel herunterladen"
        >
          {downloading ? '⏳' : '📗'} Excel
        </button>
        {updateLabel && (
          <span className="user-table-update">Letztes Update: {updateLabel}</span>
        )}
      </div>
    </div>
  )
}

// ─── Nordrhein tab ────────────────────────────────────────────────────────────

function NordrheinTab({ onAlertsChange }) {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [perfData,    setPerfData]    = useState(null)
  const [perfLoading, setPerfLoading] = useState(false)
  const [period, setPeriod] = useState(
    () => localStorage.getItem('user_perf_period') || '1Y'
  )

  // ── Fetch main tab data (holdings, tables, cards, alerts) ──────────────
  const fetchMainData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('auth_token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await axios.get('http://localhost:8000/api/user/data', { headers })
      setData(res.data)
      if (onAlertsChange) onAlertsChange(res.data?.has_alerts ?? false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [onAlertsChange])

  // ── Fetch performance chart data ───────────────────────────────────────
  const fetchPerfData = useCallback(async (p) => {
    setPerfLoading(true)
    try {
      const res = await axios.get(`http://localhost:8000/api/user/performance?period=${p}`)
      setPerfData(res.data)
    } catch (err) {
      console.error('Performance fetch failed:', err)
      setPerfData(null)
    } finally {
      setPerfLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchMainData()
  }, [fetchMainData])

  // Reload performance when period changes
  useEffect(() => {
    localStorage.setItem('user_perf_period', period)
    fetchPerfData(period)
  }, [period, fetchPerfData])

  // ── Date-highlight helper for STOXX table ──────────────────────────────
  const dateNeedsHighlight = useCallback((dateStr) => {
    if (!dateStr) return false
    try {
      const d    = new Date(dateStr)
      const diff = Math.abs((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
      return diff <= 5
    } catch {
      return false
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) return <div className="user-loading">📊 Daten werden geladen…</div>
  if (error)   return <div className="user-error">❌ Fehler: {error}</div>
  if (!data)   return <div className="user-empty">Keine Daten verfügbar</div>

  const {
    cards          = {},
    card_alerts    = {},
    alerts         = {},
    alert_details  = [],
    portfolio_comparison = [],
    stoxx_announcements  = [],
  } = data

  return (
    <div className="user-nordrhein">
      {/* ── Summary cards row ─────────────────────────────────────── */}
      <div className="user-cards-row">
        <SummaryCard
          label="Average Rating EM"
          value={cards.average_rating}
          highlight={card_alerts.rating_is_poor}
        />
        <SummaryCard
          label="Factsheet Datum"
          value={cards.factsheet_date}
          highlight={card_alerts.factsheet_is_old}
        />
        <SummaryCard
          label="Overlap"
          value={`${cards.overlap ?? 0}%`}
        />
        <SummaryCard
          label="Benchmark Datum"
          value={cards.benchmark_date}
          highlight={card_alerts.benchmark_is_outdated}
        />
        <AlertBox alerts={alerts} alertDetails={alert_details} />
      </div>

      {/* ── Performance chart ────────────────────────────────────── */}
      <PerformanceChart
        data={perfData?.data}
        latestDate={perfData?.latest_date}
        loading={perfLoading}
        selectedPeriod={period}
        onPeriodChange={setPeriod}
      />

      {/* ── Tables row ───────────────────────────────────────────── */}
      <div className="user-tables-row">
        <DataTable
          title="Aktien Portfolio vs Eurostoxx 50"
          rows={portfolio_comparison}
          updateLabel={cards.portfolio_update}
        />
        <DataTable
          title="STOXX Ankündigungen"
          rows={stoxx_announcements}
          updateLabel={cards.stoxx_latest_update}
          dateNeedsHighlight={dateNeedsHighlight}
        />
      </div>
    </div>
  )
}

// ─── Test tab ─────────────────────────────────────────────────────────────────

function TestTab() {
  return (
    <div className="user-test-tab">
      <h4>Test Portfolio Analysis</h4>
      <p className="user-test-desc">
        Dieses Panel befindet sich noch in der Entwicklung. Weitere Portfolio-Analysen
        werden hier ergänzt.
      </p>
    </div>
  )
}

// ─── Top-level User page ──────────────────────────────────────────────────────

function User({ onAlertsChange }) {
  const [activeSubTab, setActiveSubTab] = useState(
    () => localStorage.getItem('user_subtab') || 'nordrhein'
  )

  const handleSubTabChange = (tab) => {
    setActiveSubTab(tab)
    localStorage.setItem('user_subtab', tab)
  }

  return (
    <div className="user-container">
      {/* Sub-tab buttons */}
      <div className="user-tabs">
        <button
          className={`user-tab-btn${activeSubTab === 'nordrhein' ? ' active' : ''}`}
          onClick={() => handleSubTabChange('nordrhein')}
        >
          Nordrhein
        </button>
        <button
          className={`user-tab-btn${activeSubTab === 'test' ? ' active' : ''}`}
          onClick={() => handleSubTabChange('test')}
        >
          Test
        </button>
      </div>

      {/* Tab content */}
      <div className="user-tab-content">
        {activeSubTab === 'nordrhein' && (
          <NordrheinTab onAlertsChange={onAlertsChange} />
        )}
        {activeSubTab === 'test' && <TestTab />}
      </div>
    </div>
  )
}

export default User

