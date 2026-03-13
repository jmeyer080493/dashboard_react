import { useState, useEffect, useRef } from 'react'
import {
  ComposedChart,
  LineChart,
  BarChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { MetricsTable } from '../../components/MetricsTable'
import {
  getFIMetricLabel,
  getFIYAxisLabel,
  getFIMetricUnit,
  getSmartDateFormat,
  FI_STANDARD_DEFAULTS,
  FI_METRICS_CATEGORIES,
} from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
import { withDataGapWarning } from '../../utils/exportWarnings'
import { ExcelIcon, PowerPointIcon } from '../../icons/MicrosoftIcons'
import { REGION_TRANSLATIONS } from '../../config/countries'
import './TabStyles.css'

/** Translate a region key to its German display name */
const translateRegion = (r) => REGION_TRANSLATIONS[r] || r

/** Produce a stable string ID from a chart title */
function makeId(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Build a German-formatted date range string from chartData, e.g. "01.01.2020 – 31.12.2024" */
function getDateRange(chartData, xKey) {
  if (!chartData || chartData.length === 0) return ''
  const dates = chartData.map(r => r[xKey]).filter(Boolean).sort()
  if (dates.length < 2) return ''
  const fmt = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}
const REGION_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

/**
 * Pivot raw FI records (one row per DatePoint × Region) so that each DatePoint
 * maps to one object with one key per region for a given metric.
 *
 * Input:  [{DatePoint, Regions:'Germany', '10Y Yields':2.5, ...}, ...]
 * Output: [{DatePoint:'2024-01-01', Germany:2.5, France:3.1, ...}, ...]
 */
function pivotDataForChart(records, metricKey, regions) {
  const map = {}
  for (const row of records) {
    const date = row.DatePoint
    if (!date) continue
    const region = row.Regions
    if (!regions.includes(region)) continue
    const value = row[metricKey]
    if (value === undefined || value === null) continue
    if (!map[date]) map[date] = { DatePoint: date }
    map[date][region] = value
  }
  return Object.values(map).sort(
    (a, b) => new Date(a.DatePoint) - new Date(b.DatePoint)
  )
}

/** Short date label for chart axes - smart formatting based on time span */
function fmtDate(isoStr, smartDateFmt) {
  if (!isoStr || !smartDateFmt) return ''
  return smartDateFmt(isoStr)
}

/**
 * Apply a local period filter to already-globally-filtered chart data.
 * Uses the latest date in chartData as the anchor.
 */
function applyLocalPeriod(chartData, period) {
  if (!period || period === 'All') return chartData
  const allDates = chartData.map(r => r.DatePoint).filter(Boolean).sort()
  if (!allDates.length) return chartData
  const latestStr = allDates[allDates.length - 1].slice(0, 10)
  let cutoffStr
  if (period === 'YtD') {
    const year = parseInt(latestStr.slice(0, 4), 10)
    cutoffStr = `${year - 1}-12-31`
  } else {
    const daysMap = { '1Y': 365, '3Y': 365 * 3, '5Y': 365 * 5 }
    const days = daysMap[period] ?? 365
    const latestMs = Date.UTC(
      parseInt(latestStr.slice(0, 4), 10),
      parseInt(latestStr.slice(5, 7), 10) - 1,
      parseInt(latestStr.slice(8, 10), 10)
    )
    const cutoffMs = latestMs - days * 86400000
    const d = new Date(cutoffMs)
    cutoffStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return chartData.filter(r => r.DatePoint.slice(0, 10) >= cutoffStr)
}

/** Compute smart y-axis domain from data with padding */
function computeSmartDomain(chartData, regions) {
  if (!chartData || chartData.length === 0 || regions.length === 0) return [undefined, undefined]
  
  let min = Infinity, max = -Infinity
  for (const row of chartData) {
    for (const region of regions) {
      const val = row[region]
      if (val !== undefined && val !== null && typeof val === 'number') {
        if (val < min) min = val
        if (val > max) max = val
      }
    }
  }
  
  if (min === Infinity || max === -Infinity) return [undefined, undefined]
  
  const range = max - min
  const padding = range * 0.1 // 10% padding
  return [min - padding, max + padding]
}

/** Return unit string for an FI metric key */
function getUnit(metricKey) {
  if (metricKey.includes('CDS')) return 'bp'
  if (
    metricKey.includes('Yields') ||
    metricKey.includes('Steepness') ||
    metricKey.includes('Curvature') ||
    metricKey.includes('Spreads') ||
    metricKey.includes('Expectations') ||
    metricKey.includes('Breakevens') ||
    metricKey === 'Government Debt'
  ) return '%'
  return ''
}

/** Format a numeric FI value with appropriate precision and unit */
function formatFIValue(value, metricKey) {
  if (value === null || value === undefined) return '–'
  if (typeof value !== 'number') return String(value)
  const unit = getUnit(metricKey || '')
  return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
}

/** Format Y-axis values: 0 decimals */
function formatYValue(value) {
  if (typeof value !== 'number') return value
  return String(Math.round(value))
}

/** Check if time series is longer than 6 months for smart formatting */
function isLongTimeseries(chartData) {
  if (!chartData || chartData.length < 2) return false
  const dates = chartData.map(r => r.DatePoint).filter(d => d).sort()
  if (dates.length < 2) return false
  const firstDate = new Date(dates[0])
  const lastDate = new Date(dates[dates.length - 1])
  const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
                     (lastDate.getMonth() - firstDate.getMonth())
  return monthsDiff > 6
}

/** Format a value for legend display: 1 decimal, German locale */
function fmtLegendValue(val, unit = '') {
  if (val === null || val === undefined || typeof val !== 'number') return null
  const formatted = val.toFixed(1).toLocaleString('de-DE')
  return unit ? `${formatted}\u00a0${unit}` : formatted
}

/**
 * For each region, find the last date where the value genuinely changed.
 * After this date the backend has forward-filled the value unchanged.
 * Returns { region: dateString }.
 */
function findLastRealDatePerRegion(chartData, regions) {
  const result = {}
  for (const region of regions) {
    let lastRealDate = null
    for (let i = chartData.length - 1; i > 0; i--) {
      const currVal = chartData[i][region]
      const prevVal = chartData[i - 1][region]
      if (currVal != null && prevVal != null && Math.abs(currVal - prevVal) > 1e-10) {
        lastRealDate = chartData[i].DatePoint; break
      }
      if (currVal != null && prevVal == null) {
        lastRealDate = chartData[i].DatePoint; break
      }
    }
    if (lastRealDate === null) {
      for (let i = 0; i < chartData.length; i++) {
        if (chartData[i][region] != null) { lastRealDate = chartData[i].DatePoint; break }
      }
    }
    if (lastRealDate !== null) result[region] = lastRealDate
  }
  return result
}

/**
 * Return a copy of chartData where each region's value is nulled out
 * for all rows after that region's last real date (removes forward-fill tail).
 */
function stripForwardFill(chartData, lastRealDateByRegion) {
  return chartData.map(row => {
    const newRow = { ...row }
    for (const [region, lastDate] of Object.entries(lastRealDateByRegion)) {
      if (row.DatePoint > lastDate) newRow[region] = null
    }
    return newRow
  })
}

/** Determine if log scale is appropriate for a dataset (all values must be positive) */
function canUseLogScale(chartData, regions) {
  if (!chartData || chartData.length === 0 || regions.length === 0) return false
  
  for (const row of chartData) {
    for (const region of regions) {
      const val = row[region]
      if (val !== undefined && val !== null && typeof val === 'number') {
        // Log scale requires strictly positive values
        if (val <= 0) return false
      }
    }
  }
  return true
}

/** Find the latest (most recent) value for a specific region across all data points */
function getLatestValueForRegion(chartData, region) {
  if (!chartData || chartData.length === 0) return undefined
  // Iterate backwards to find the most recent value for this region
  for (let i = chartData.length - 1; i >= 0; i--) {
    const value = chartData[i][region]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

/** Find the first (oldest) non-null value for a specific region across all data points */
function getFirstValueForRegion(chartData, region) {
  if (!chartData || chartData.length === 0) return undefined
  for (let i = 0; i < chartData.length; i++) {
    const value = chartData[i][region]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

/**
 * Custom tooltip for range bar chart
 */
function RangeBarTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: 'var(--card-bg,#fff)', border: '1px solid #ccc', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{d.name}</p>
      <p style={{ margin: '2px 0', color: d.color }}>Aktuell: {d.current != null ? d.current.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#888' }}>Median: {d.median != null ? d.median.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#aaa' }}>Min: {d.min != null ? d.min.toFixed(2) : '—'}</p>
      <p style={{ margin: '2px 0', color: '#888' }}>Max: {d.max != null ? d.max.toFixed(2) : '—'}</p>
    </div>
  )
}

/**
 * Multi-Region Line Chart for a single FI metric.
 */
function FILineChart({ chartData, allChartData, regions, metricLabel, metricKey, yAxisLabel = '', unit = '', height = 300, chartType = 'Line', globalPeriod = null, lineWidth = 2 }) {
  const { addToPptx, addToXlsx } = useExport()

  // ── Local period filter (persisted per chart) ──────────────────────────
  const [localPeriod, setLocalPeriodRaw] = useState(() => {
    try { return localStorage.getItem(`chartPeriod_fi_${metricKey}`) || null } catch { return null }
  })
  const setLocalPeriod = (p) => {
    setLocalPeriodRaw(p)
    try {
      if (p) localStorage.setItem(`chartPeriod_fi_${metricKey}`, p)
      else localStorage.removeItem(`chartPeriod_fi_${metricKey}`)
    } catch {}
  }
  // Sync to global when global period changes (clears any local override)
  const prevGlobalPeriodRef = useRef(globalPeriod)
  useEffect(() => {
    if (prevGlobalPeriodRef.current === globalPeriod) return
    prevGlobalPeriodRef.current = globalPeriod
    setLocalPeriod(null)
  }, [globalPeriod])

  // ── Local chart type override (persisted per chart) ─────────────────────
  const [localChartType, setLocalChartTypeRaw] = useState(() => {
    try { return localStorage.getItem(`chartType_fi_${metricKey}`) || null } catch { return null }
  })
  const setLocalChartType = (t) => {
    setLocalChartTypeRaw(t)
    try {
      if (t) localStorage.setItem(`chartType_fi_${metricKey}`, t)
      else localStorage.removeItem(`chartType_fi_${metricKey}`)
    } catch {}
  }
  const prevGlobalChartTypeRef = useRef(chartType)
  useEffect(() => {
    if (prevGlobalChartTypeRef.current === chartType) return
    prevGlobalChartTypeRef.current = chartType
    setLocalChartType(null)
  }, [chartType])
  const effectiveChartType = localChartType ?? chartType

  // ── Legend mode (value / delta) ──────────────────────────────────────────
  const [legendMode, setLegendModeRaw] = useState(() => {
    try { return localStorage.getItem(`legendMode_fi_${metricKey}`) || 'value' } catch { return 'value' }
  })
  const setLegendMode = (m) => {
    setLegendModeRaw(m)
    try { localStorage.setItem(`legendMode_fi_${metricKey}`, m) } catch {}
  }

  // Active button: local override wins; falls back to global; null → no active btn
  const activeBtn = localPeriod ?? globalPeriod

  const displayData = localPeriod ? applyLocalPeriod(allChartData ?? chartData, localPeriod) : chartData
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(displayData)

  const chartTypeButtons = (
    <div className="chart-type-buttons">
      {[{ id: 'Line', label: 'Standard' }, { id: 'Bar', label: 'Balken' }].map(ct => (
        <button
          key={ct.id}
          className={`chart-period-btn${effectiveChartType === ct.id ? ' active' : ''}`}
          onClick={() => setLocalChartType(ct.id)}
        >
          {ct.label}
        </button>
      ))}
    </div>
  )

  const periodButtons = (
    <div className="chart-period-buttons">
      {['YtD', '1Y', '3Y', '5Y', 'All'].map(p => (
        <button
          key={p}
          className={`chart-period-btn${activeBtn === p ? ' active' : ''}`}
          onClick={() => setLocalPeriod(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Only render lines for regions that actually have at least one data point
  // Exclude Germany and Europa from "Spreads to Bunds" chart (since they would be flat lines)
  const activeRegions = regions.filter(r => {
    if (metricKey === 'Spreads to Bunds' && (r === 'Germany' || r === 'Europa')) return false
    return displayData.some(d => d[r] !== undefined && d[r] !== null)
  })

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-header"><h3>{metricLabel}</h3>{chartTypeButtons}{periodButtons}</div>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Strip backend forward-fill so each region's line ends at its last real data point
  const lastRealDateByRegion = findLastRealDatePerRegion(displayData, activeRegions)
  const strippedData = stripForwardFill(displayData, lastRealDateByRegion)
  // "Aktualität" = earliest of all regions' last real dates
  const letzesDatum = Object.values(lastRealDateByRegion).filter(Boolean).sort().shift() ?? null

  const [yMin, yMax] = computeSmartDomain(strippedData, activeRegions)
  const isLongSeries = isLongTimeseries(strippedData)
  const useLogScale = canUseLogScale(strippedData, activeRegions)
  
  // Compute even interval spacing for y-axis (linear only; log uses 'auto')
  let yDomain = ['auto', 'auto']
  if (yMin !== undefined && yMax !== undefined && !useLogScale) {
    const range = yMax - yMin
    if (range > 0) {
      const step = Math.pow(10, Math.floor(Math.log10(range)))
      const roundedMin = Math.floor(yMin / step) * step
      const roundedMax = Math.ceil(yMax / step) * step
      yDomain = [roundedMin, roundedMax]
    } else {
      // Flat data: add a fixed ±10% buffer around the single value
      const buffer = Math.abs(yMin) * 0.1 || 1
      yDomain = [yMin - buffer, yMax + buffer]
    }
  }
  
  const formatter = (value) => {
    if (typeof value !== 'number') return value
    return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
  }

  const dateRange = getDateRange(strippedData, 'DatePoint')
  const subheading = dateRange

  const periodLabel = activeBtn || 'All'
  const ctLabel     = effectiveChartType === 'Bar' ? 'Balken' : 'Linie'
  const fullTitle = `Anleihen – ${metricLabel}`
  const exportItem = { id: `${makeId(fullTitle)}-${periodLabel.toLowerCase()}-${effectiveChartType.toLowerCase()}`, title: `${fullTitle} (${periodLabel}, ${ctLabel})`, pptx_title: metricLabel, subheading, yAxisLabel, source: 'Quelle: Bloomberg Finance L.P.', tab: 'Anleihen', chartData: strippedData, regions: activeRegions, xKey: 'DatePoint' }

  // Build range-bar data (one entry per region: min/max/median/current)
  const barData = activeRegions
    .map((region) => {
      const vals = strippedData.map(r => r[region]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const current = getLatestValueForRegion(strippedData, region)
      return { name: translateRegion(region), spacer: min, range: max - min, current, median, min, max, color: REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length] }
    })
    .filter(Boolean)
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))

  // Attach Balken-specific export fields
  exportItem.chartType = effectiveChartType
  exportItem.balkenData = effectiveChartType === 'Bar' ? barData : undefined

  return (
    <div className="chart-container">
      <div className="chart-header"><h3>{metricLabel}</h3>{chartTypeButtons}{periodButtons}</div>
      <ResponsiveContainer width="100%" height={height}>
        {effectiveChartType === 'Bar' ? (
          <ComposedChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={60} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip content={<RangeBarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            <Bar dataKey="spacer" stackId="r" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="range" stackId="r" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {barData.map(d => <Cell key={d.name} fill={d.color} fillOpacity={0.6} />)}
            </Bar>
            <Line dataKey="current" stroke="none" strokeWidth={0} dot={(props) => {
              const { cx, cy, payload } = props
              if (cx == null || cy == null) return null
              return <circle key={payload.name} cx={cx} cy={cy} r={6} fill="white" stroke={payload.color} strokeWidth={2} />
            }} activeDot={false} legendType="none" isAnimationActive={false} />
            <Line dataKey="median" stroke="none" strokeWidth={0} dot={(props) => {
              const { cx, cy, payload } = props
              if (cx == null || cy == null) return null
              return <rect key={`med-${payload.name}`} x={cx - 14} y={cy - 2} width={28} height={4} fill={payload.color} fillOpacity={0.95} rx={1} />
            }} activeDot={false} legendType="none" isAnimationActive={false} />
          </ComposedChart>
        ) : (
          <LineChart data={strippedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="DatePoint"
              tick={{ fontSize: 11 }}
              tickFormatter={(isoStr) => fmtDate(isoStr, smartDateFormatter)}
              interval={smartInterval}
            />
            <YAxis 
              scale={useLogScale ? 'log' : undefined}
              domain={useLogScale ? ['auto', 'auto'] : yDomain}
              tick={{ fontSize: 11 }}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
              formatter={formatter}
              labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
            />
            <Legend
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null
                return (
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px', fontSize: 14, paddingTop: 4, paddingLeft: 8, paddingRight: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', flex: 1, minWidth: 0 }}>
                      {payload.map((entry, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <svg width="16" height="4" style={{ flexShrink: 0 }}><line x1="0" y1="2" x2="16" y2="2" stroke={entry.color} strokeWidth="2" /></svg>
                          <span style={{ color: 'var(--text-primary)' }}>{entry.value}</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button className={`chart-period-btn${legendMode === 'value' ? ' active' : ''}`} onClick={() => setLegendMode('value')}>Letzter Wert</button>
                      <button className={`chart-period-btn${legendMode === 'delta' ? ' active' : ''}`} onClick={() => setLegendMode('delta')}>Delta</button>
                    </div>
                  </div>
                )
              }}
            />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            {[...activeRegions]
              .sort((a, b) => {
                if (legendMode === 'delta') {
                  const firstA = getFirstValueForRegion(strippedData, a)
                  const lastA  = getLatestValueForRegion(strippedData, a)
                  const firstB = getFirstValueForRegion(strippedData, b)
                  const lastB  = getLatestValueForRegion(strippedData, b)
                  const dA = (firstA != null && lastA != null) ? (lastA - firstA) : -Infinity
                  const dB = (firstB != null && lastB != null) ? (lastB - firstB) : -Infinity
                  return dB - dA
                }
                const latestA = getLatestValueForRegion(strippedData, a) ?? -Infinity
                const latestB = getLatestValueForRegion(strippedData, b) ?? -Infinity
                return latestB - latestA
              })
              .map((region) => {
              const latestValue = getLatestValueForRegion(strippedData, region)
              const formatted = fmtLegendValue(latestValue, unit)
              let legendName
              if (legendMode === 'delta') {
                const firstValue = getFirstValueForRegion(strippedData, region)
                if (firstValue != null && latestValue != null) {
                  const delta = latestValue - firstValue
                  const arrow = delta > 0.0001 ? '▲' : delta < -0.0001 ? '▼' : '→'
                  const formattedDelta = fmtLegendValue(Math.abs(delta), unit)
                  legendName = formattedDelta !== null ? `${translateRegion(region)} (${arrow} ${formattedDelta})` : translateRegion(region)
                } else {
                  legendName = translateRegion(region)
                }
              } else {
                legendName = formatted !== null ? `${translateRegion(region)} (${formatted})` : translateRegion(region)
              }
              return (
                <Line
                  key={region}
                  type="monotone"
                  dataKey={region}
                  name={legendName}
                  stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
                  dot={false}
                  strokeWidth={lineWidth}
                  isAnimationActive={false}
                  connectNulls
                />
              )
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => withDataGapWarning(addToPptx, strippedData, activeRegions)(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => withDataGapWarning(addToXlsx, strippedData, activeRegions)(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {letzesDatum && (
          <span className="chart-export-date">Aktualität: {new Date(letzesDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, Bloomberg Finance L.P.</span>
        )}
      </div>
    </div>
  )
}
// Yield curve column order (maturity periods available in v3 FI data)
const YIELD_CURVE_PERIODS = [
  { col: '2Y Yields',  label: '2J' },
  { col: '5Y Yields',  label: '5J' },
  { col: '10Y Yields', label: '10J' },
  { col: '20Y Yields', label: '20J' },
  { col: '30Y Yields', label: '30J' },
]

/**
 * Yield Curve chart — cross-sectional snapshot for the latest date,
 * one line per selected region, X = maturity period, Y = yield in %.
 */
function KurveChart({ regions, allRecords, height = 300, lineWidth = 2 }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!allRecords || allRecords.length === 0) {
    return (
      <div className="chart-container">
        <h3>Zinskurve</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Find the latest DatePoint that has yield data
  const latestByRegion = {}
  for (const row of allRecords) {
    if (!row.DatePoint || !regions.includes(row.Regions)) continue
    const hasYields = YIELD_CURVE_PERIODS.some(p => row[p.col] != null)
    if (!hasYields) continue
    if (!latestByRegion[row.Regions] || row.DatePoint > latestByRegion[row.Regions].DatePoint) {
      latestByRegion[row.Regions] = row
    }
  }

  // Build chart-friendly data: one object per period with region keys
  const chartData = YIELD_CURVE_PERIODS.map(({ col, label }) => {
    const point = { period: label }
    for (const region of regions) {
      const row = latestByRegion[region]
      if (row && row[col] != null) point[region] = row[col]
    }
    return point
  })

  // Only include regions that have at least one yield value
  let activeRegions = regions.filter(r =>
    chartData.some(d => d[r] !== undefined && d[r] !== null)
  )

  // Sort regions by 30Y yields in descending order
  const thirtyYearCol = '30Y Yields'
  activeRegions = activeRegions.sort((a, b) => {
    const valueA = latestByRegion[a]?.[thirtyYearCol] ?? -Infinity
    const valueB = latestByRegion[b]?.[thirtyYearCol] ?? -Infinity
    return valueB - valueA
  })

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <h3>Zinskurve</h3>
        <div className="chart-empty">Keine Renditedaten für die ausgewählten Länder</div>
      </div>
    )
  }

  // Aktualität = earliest of all regions' latest dates (min across regions)
  const latestDateStr = Object.values(latestByRegion)
    .map(r => r.DatePoint)
    .filter(Boolean)
    .sort()
    .shift()
  const latestDateFmt = latestDateStr
    ? new Date(latestDateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : ''

  const exportItem = {
    id: 'yield-curve',
    title: 'Anleihen – Zinskurve',
    pptx_title: 'Zinskurve',
    subheading: latestDateFmt,
    yAxisLabel: '%',
    source: 'Quelle: Bloomberg Finance L.P.',
    tab: 'Anleihen',
    chartData,
    regions: activeRegions,
    xKey: 'period',
  }

  return (
    <div className="chart-container">
      <h3>Zinskurve</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={v => `${v.toFixed(1)}`}
            width={44}
            label={{ value: '%', angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
            formatter={(value, name) => [`${value?.toFixed(2)} %`, name]}
            labelFormatter={(label) => typeof label === 'string' ? label.split('T')[0] : label}
          />
          <Legend />
          {activeRegions.map((region) => (
            <Line
              key={region}
              type="monotone"
              dataKey={region}
              stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
              strokeWidth={lineWidth}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => addToPptx(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => addToXlsx(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {latestDateFmt && (
          <span className="chart-export-date">Aktualität: {latestDateFmt}, Bloomberg Finance L.P.</span>
        )}
      </div>
    </div>
  )
}

/**
 * Fixed Income Tab Component
 *
 * Displays bond market signals: yield curves, CDS spreads, inflation expectations, etc.
 * - MetricsTable: latest values per region, filtered by selectedMetricsTable
 * - Line charts: one per selected graph metric, all regions on the same chart
 *
 * Data is pre-fetched by the parent <Länder> component and filtered here by date range.
 */
function FixedIncomeTab({
  filters,
  data,
  loading,
  error,
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  chartsPerRow = 2,
  chartHeight = 300,
  chartType = 'Line',
  ratingsData = [],
  lineWidth = 2,
}) {
  if (loading) {
    return <div className="tab-loading">📊 Laden…</div>
  }
  if (error) {
    return <div className="tab-error">❌ Fehler: {error}</div>
  }
  if (!data || !data.data) {
    return <div className="tab-empty">Keine Daten verfügbar</div>
  }

  const regions = filters.regions || []
  // Inject SP rating into every record so MetricsTable can display it.
  // We always inject (null when not found) so the column is stable even before
  // ratingsData has loaded – it will show '–' and fill in once data arrives.
  const spByRegion = Object.fromEntries(
    ratingsData.filter(r => r.Regions).map(r => [r.Regions, r.SP ?? null])
  )
  const allRecords = (data.data || []).map(r => ({ ...r, SP: spByRegion[r.Regions] ?? null }))
  const globalPeriod = filters.customMode ? null : (filters.lookback || null)

  // Apply date-range filter for charts
  const filteredRecords = allRecords.filter((r) => {
    if (!r.DatePoint) return false
    const dp = r.DatePoint.slice(0, 10)
    if (filters.startDate && dp < filters.startDate.slice(0, 10)) return false
    if (filters.endDate   && dp > filters.endDate.slice(0, 10))   return false
    return true
  })

  // Determine which metrics are actually present in the API response
  const availableMetrics =
    allRecords.length > 0
      ? Object.keys(allRecords[0]).filter(
          (k) => !['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name'].includes(k)
        )
      : []

  // Special metrics rendered by dedicated components (not dependent on availableMetrics)
  const SPECIAL_METRICS = new Set(['Kurve'])

  // Use selections if provided, otherwise fall back to standard defaults
  const tableColumns = (selectedMetricsTable.length > 0
    ? selectedMetricsTable
    : FI_STANDARD_DEFAULTS.table
  ).filter((c) => availableMetrics.includes(c))

  const graphMetrics = (selectedMetricsGraph.length > 0
    ? selectedMetricsGraph
    : FI_STANDARD_DEFAULTS.graph
  ).filter((m) => SPECIAL_METRICS.has(m) || availableMetrics.includes(m))

  return (
    <div className="fixed-income-tab">
      {/* Latest Values Table */}
      <MetricsTable
        data={allRecords}
        regions={regions}
        columns={tableColumns}
        categories={FI_METRICS_CATEGORIES}
        lookback={filters.lookback}
        tabLabel="Anleihen"
      />

      {/* Charts – one per selected graph metric */}
      <div
        className="chart-grid"
        style={{ gridTemplateColumns: `repeat(${chartsPerRow}, 1fr)` }}
      >
        {graphMetrics.length === 0 ? (
          <div className="chart-empty">
            Keine Grafik-Metriken ausgewählt – bitte nutzen Sie „🔧 Datenfelder Filtern“.
          </div>
        ) : (
          graphMetrics.map((metric) => {
            if (metric === 'Kurve') {
              return (
                <KurveChart
                  key="Kurve"
                  regions={regions}
                  allRecords={allRecords}
                  height={chartHeight}
                  lineWidth={lineWidth}
                />
              )
            }
            return (
              <FILineChart
                key={metric}
                chartData={pivotDataForChart(filteredRecords, metric, regions)}
                allChartData={pivotDataForChart(allRecords, metric, regions)}
                regions={regions}
                metricLabel={getFIMetricLabel(metric)}
                metricKey={metric}
                yAxisLabel={getFIYAxisLabel(metric)}
                unit={getFIMetricUnit(metric)}
                height={chartHeight}
                chartType={chartType}
                globalPeriod={globalPeriod}
                lineWidth={lineWidth}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export default FixedIncomeTab
