import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './Data.css'

const API_BASE = 'http://localhost:8000'

// ─────────────────────────────────────────────────────────────────────────────
// Status indicator helper
// ─────────────────────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  return (
    <span
      className={`data-status-dot data-status-dot--${status === 'red' || status === 'alert' ? 'red' : 'green'}`}
      title={status === 'red' || status === 'alert' ? 'Stale / Alert' : 'Up to date'}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Expandable section row – Data Freshness table
// ─────────────────────────────────────────────────────────────────────────────
function FreshnessSection({ sectionKey, status, label, latestDate, staleItems, renderDetail, expanded, onToggle }) {
  const isRed = status === 'red'
  const hasItems = staleItems && staleItems.length > 0

  return (
    <>
      <tr
        className={`data-section-header ${isRed ? 'data-section-header--red' : ''}`}
        onClick={() => hasItems && onToggle(sectionKey)}
        style={{ cursor: hasItems ? 'pointer' : 'default' }}
      >
        <td className="data-col-status">
          <StatusDot status={status} />
          {hasItems && (
            <span className="data-expand-chevron">{expanded ? '▲' : '▼'}</span>
          )}
        </td>
        <td className={`data-col-name ${isRed ? 'data-col-name--bold' : ''}`}>{label}</td>
        <td className="data-col-date">{latestDate || '—'}</td>
      </tr>
      {hasItems && expanded && staleItems.map((item, idx) => (
        <tr key={idx} className="data-detail-row">
          <td className="data-col-status"><StatusDot status="red" /></td>
          <td className="data-col-name data-col-name--indent">{renderDetail(item)}</td>
          <td className="data-col-date">{item.latest_date || '—'}</td>
        </tr>
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Freshness Table
// ─────────────────────────────────────────────────────────────────────────────
function DataFreshnessTable({ data }) {
  const [expanded, setExpanded] = useState({})

  const toggle = useCallback((key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  if (!data) return <div className="data-loading">Keine Daten</div>

  const sections = [
    {
      key: 'performance',
      status: data.performance?.header_status,
      label: 'Performance',
      latestDate: data.performance?.latest_date,
      staleItems: data.performance?.stale_items || [],
      renderDetail: (item) => item.id,
    },
    {
      key: 'benchmark_weights',
      status: data.benchmark_weights?.status,
      label: 'Benchmark Weights',
      latestDate: data.benchmark_weights?.latest_date,
      staleItems: data.benchmark_weights?.stale
        ? [{ id: 'Benchmark Weights', latest_date: data.benchmark_weights?.latest_date, days_old: data.benchmark_weights?.days_old }]
        : [],
      renderDetail: () => 'Benchmark Weights',
    },
    {
      key: 'market_data_jm',
      status: data.market_data_jm?.header_status,
      label: 'Market Data JM',
      latestDate: data.market_data_jm?.latest_date,
      staleItems: data.market_data_jm?.stale_items || [],
      renderDetail: (item) => item.id,
    },
    {
      key: 'bloomberg',
      status: data.bloomberg?.header_status,
      label: 'Bloomberg Data',
      latestDate: data.bloomberg?.latest_date,
      staleItems: data.bloomberg?.stale_items || [],
      renderDetail: (item) => `${item.ticker} – ${item.field}`,
    },
    {
      key: 'data_pipe',
      status: data.data_pipe?.header_status,
      label: 'Data Pipe',
      latestDate: data.data_pipe?.latest_date,
      staleItems: data.data_pipe?.stale_items || [],
      renderDetail: (item) => item.name,
    },
    {
      key: 'sector_pe_ratios',
      status: data.sector_pe_ratios?.header_status,
      label: 'Sector PE Ratios',
      latestDate: data.sector_pe_ratios?.latest_date,
      staleItems: data.sector_pe_ratios?.stale_items || [],
      renderDetail: (item) => item.index_name,
    },
    {
      key: 'port',
      status: data.port?.header_status,
      label: 'Port',
      latestDate: data.port?.latest_date,
      staleItems: data.port?.stale_items || [],
      renderDetail: (item) => item.name,
    },
  ]

  // Red sections float to the top
  const sorted = [...sections].sort((a, b) => {
    return (a.status === 'red' ? 0 : 1) - (b.status === 'red' ? 0 : 1)
  })

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-col-status">Status</th>
            <th className="data-col-name">Data Type</th>
            <th className="data-col-date">Latest Date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(sec => (
            <FreshnessSection
              key={sec.key}
              sectionKey={sec.key}
              status={sec.status}
              label={sec.label}
              latestDate={sec.latestDate}
              staleItems={sec.staleItems}
              renderDetail={sec.renderDetail}
              expanded={!!expanded[sec.key]}
              onToggle={toggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Job Checks Table
// ─────────────────────────────────────────────────────────────────────────────
function JobChecksTable({ checks }) {
  const [expanded, setExpanded] = useState({})

  const toggle = useCallback((idx) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }))
  }, [])

  if (!checks) return <div className="data-loading">Keine Daten</div>

  // Alert rows float to the top
  const sorted = [...checks]
    .map((c, origIdx) => ({ ...c, origIdx }))
    .sort((a, b) => (a.status === 'alert' ? 0 : 1) - (b.status === 'alert' ? 0 : 1))

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-col-status">Status</th>
            <th className="data-col-name">Check</th>
            <th className="data-col-source">Source</th>
            <th className="data-col-date">Last Check</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((check, sortedIdx) => {
            const { origIdx } = check
            const isAlert = check.status === 'alert'
            const details = check.details || []
            const hasDetails = details.length > 0 && isAlert
            const ts = check.timestamp ? check.timestamp.split('T')[0] : '—'

            return (
              <>
                <tr
                  key={origIdx}
                  className={`data-section-header ${isAlert ? 'data-section-header--red' : ''}`}
                  onClick={() => hasDetails && toggle(origIdx)}
                  style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                >
                  <td className="data-col-status">
                    <StatusDot status={isAlert ? 'red' : 'green'} />
                    {hasDetails && (
                      <span className="data-expand-chevron">{expanded[origIdx] ? '▲' : '▼'}</span>
                    )}
                  </td>
                  <td className={`data-col-name ${isAlert ? 'data-col-name--bold' : ''}`}>
                    {check.message}
                  </td>
                  <td className="data-col-source data-col-source--muted">{check.source || '—'}</td>
                  <td className="data-col-date">{ts}</td>
                </tr>
                {hasDetails && expanded[origIdx] && details.map((d, di) => (
                  <tr key={`${origIdx}-${di}`} className="data-detail-row">
                    <td className="data-col-status" />
                    <td className="data-col-name data-col-name--indent">{d.name}</td>
                    <td className="data-col-source data-col-source--muted">
                      Last updated: {d.mod_date || '—'}
                    </td>
                    <td className="data-col-date" />
                  </tr>
                ))}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Data component
// ─────────────────────────────────────────────────────────────────────────────
function Data({
  freshnessData,
  jobChecksData,
  onFreshnessDataChange,
  onJobChecksDataChange,
  onAlertsChange,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [freshnessRes, jobRes] = await Promise.all([
        axios.get(`${API_BASE}/api/data/freshness`),
        axios.get(`${API_BASE}/api/data/job-checks`),
      ])

      const freshness = freshnessRes.data
      const jobChecks = jobRes.data?.checks || []

      onFreshnessDataChange(freshness)
      onJobChecksDataChange(jobChecks)
      setLastRefresh(new Date().toLocaleTimeString())

      const hasJobAlerts = jobChecks.some(c => c.status === 'alert')
      const hasFreshnessAlerts = freshness?.has_any_alerts || false
      if (onAlertsChange) onAlertsChange(hasJobAlerts || hasFreshnessAlerts)
    } catch (err) {
      console.error('Data fetch error:', err)
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [onFreshnessDataChange, onJobChecksDataChange, onAlertsChange])

  // Auto-load only if no cached data available
  useEffect(() => {
    if (!freshnessData && !jobChecksData) {
      fetchData()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hasAnyAlert =
    freshnessData?.has_any_alerts ||
    (Array.isArray(jobChecksData) && jobChecksData.some(c => c.status === 'alert'))

  return (
    <div className="page-container data-page">
      {/* Header */}
      <div className="page-header">
        <div className="data-header-row">
          <div>
            <h1>
              Data{' '}
              {hasAnyAlert && (
                <span className="data-alert-badge" title="Data freshness alerts active">●</span>
              )}
            </h1>
            {lastRefresh && (
              <p className="data-last-refresh">Last refreshed: {lastRefresh}</p>
            )}
          </div>
          <button
            className="data-refresh-btn"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? '⟳ Loading…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="data-error-banner">
          ⚠ Error loading data: {error}
        </div>
      )}

      {/* Two-column layout */}
      <div className="data-tables-grid">
        {/* Left: Daily Job Checks */}
        <div className="data-table-card">
          <h3 className="data-table-title">Daily Job Checks</h3>
          {loading && !jobChecksData ? (
            <div className="data-loading">Loading…</div>
          ) : (
            <JobChecksTable checks={jobChecksData} />
          )}
        </div>

        {/* Right: Data Freshness */}
        <div className="data-table-card">
          <h3 className="data-table-title">Data Freshness</h3>
          {loading && !freshnessData ? (
            <div className="data-loading">Loading…</div>
          ) : (
            <DataFreshnessTable data={freshnessData} />
          )}
        </div>
      </div>
    </div>
  )
}

export default Data
