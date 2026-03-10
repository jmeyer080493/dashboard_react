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
import { withDataGapWarning } from '../../utils/exportWarnings'
import {
  getMacroMetricLabel,
  getMacroYAxisLabel,
  getMacroMetricUnit,
  getSmartDateFormat,
  MACRO_STANDARD_DEFAULTS,
  MACRO_METRICS_CATEGORIES,
} from '../../config/metricsConfig'
import { useExport } from '../../context/ExportContext'
import { ExcelIcon, PowerPointIcon } from '../../icons/MicrosoftIcons'
import './TabStyles.css'

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

// Colour palette – one colour per region
const REGION_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

/** Determine month sampling based on lookback */
function getMonthSamplingFactor(lookback) {
  switch (lookback) {
    case '5Y':
    case '10Y':
    case 'All':
      return 6  // Every 6th month
    case '3Y':
      return 3  // Every 3rd month
    case 'YtD':
    case '1Y':
    default:
      return 1  // All months
  }
}



/**
 * Pivot raw Macro records (one row per DatePoint × Region) into chart-ready shape.
 *
 * Input:  [{DatePoint, Regions:'Germany', GDP:1.5, ...}, ...]
 * Output: [{DatePoint:'2024-01-01', Germany:1.5, France:2.1, ...}, ...]
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

/** Return unit string for a Macro metric key */
function getUnit(metricKey) {
  if (
    metricKey.includes('PMI') ||
    metricKey === 'Economic Surprise' ||
    metricKey === 'Consumer Confidence'
  ) return ''
  return '%'
}

/** Format a numeric Macro value for display */
function formatMacroValue(value, metricKey) {
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
 * Heatmap chart for PMI metrics (Standard mode).
 * X-axis = most recent months (newest → oldest, left → right)
 * Y-axis = regions
 * Cell colour = green (>50) / yellow (~50) / red (<50)
 */
function PMIHeatmapChart({ chartData, regions, metricLabel, metricKey }) {
  const { addToPptx, addToXlsx } = useExport()

  if (!chartData || chartData.length === 0 || regions.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  const activeRegions = regions.filter(r => chartData.some(d => d[r] != null))
  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Aggregate to one value per month (take the latest data point within each month).
  // PMI data is often stored at daily frequency with the same value repeated.
  const monthMap = {}
  for (const row of chartData) {
    const d = new Date(row.DatePoint)
    if (isNaN(d)) continue
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    // Keep the most recent entry for each month
    if (!monthMap[monthKey] || new Date(row.DatePoint) > new Date(monthMap[monthKey].DatePoint)) {
      monthMap[monthKey] = { ...row, _monthKey: monthKey }
    }
  }

  // Sort chronologically (oldest first) to select evenly-spaced months
  const allMonths = Object.values(monthMap).sort((a, b) => a._monthKey.localeCompare(b._monthKey))
  
  // Cap at 13 months, spacing equally across the entire range
  const MAX_MONTHS = 13
  let selectedMonths = allMonths
  if (allMonths.length > MAX_MONTHS) {
    // Select MAX_MONTHS evenly spaced across the entire range
    const step = (allMonths.length - 1) / (MAX_MONTHS - 1)
    selectedMonths = []
    for (let i = 0; i < MAX_MONTHS; i++) {
      const idx = Math.round(i * step)
      selectedMonths.push(allMonths[idx])
    }
  }
  
  // Reverse to newest first for display
  const sortedData = selectedMonths.reverse()

  // Colour: 40 → red (0°), 50 → yellow (60°), 62+ → green (~121°)
  const getPMIColor = (value) => {
    if (value == null) return 'var(--bg-surface, #374151)'
    const clamped = Math.max(40, Math.min(62, value))
    const hue = ((clamped - 40) * 5.5).toFixed(0)
    return `hsl(${hue}, 75%, 43%)`
  }

  // Show "Mrz 26" style labels; always show all since max 13 columns
  const fmtColDate = (isoStr) => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    const month = d.toLocaleDateString('de-DE', { month: 'short' })
    const year = String(d.getFullYear()).slice(-2)
    return `${month} ${year}`
  }

  const lastDate = sortedData[0]?.DatePoint?.split('T')[0] || ''
  const dateRange = getDateRange(chartData, 'DatePoint')
  const fullTitle = `Makro – ${metricLabel}`
  const exportItem = {
    id: makeId(fullTitle), title: fullTitle, pptx_title: metricLabel,
    subheading: dateRange, yAxisLabel: 'Index',
    source: 'Quelle: Bloomberg Finance L.P.',
    tab: 'Makro', chartData, regions: activeRegions, xKey: 'DatePoint',
  }

  return (
    <div className="chart-container pmi-heatmap-container">
      <h3>{metricLabel}</h3>
      <div className="pmi-heatmap-wrapper">
        {/* Rotated Y-axis label */}
        <div className="pmi-heatmap-yaxis-label">Index</div>

        <div className="pmi-heatmap-inner">
          {/* One row per region */}
          {activeRegions.map((region) => (
            <div key={region} className="pmi-heatmap-row">
              <div className="pmi-heatmap-row-label">{region}</div>
              <div className="pmi-heatmap-cells">
                {sortedData.map((row) => {
                  const value = row[region]
                  return (
                    <div
                      key={row.DatePoint}
                      className="pmi-heatmap-cell"
                      style={{ backgroundColor: getPMIColor(value) }}
                      title={`${region} – ${new Date(row.DatePoint).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}: ${value != null ? value.toFixed(1) : '–'}`}
                    >
                      <span className="pmi-cell-val">
                        {value != null ? Math.round(value) : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* X-axis date labels */}
          <div className="pmi-heatmap-row pmi-heatmap-dates-row">
            <div className="pmi-heatmap-row-label" />
            <div className="pmi-heatmap-cells">
              {sortedData.map((row) => (
                <div key={row.DatePoint} className="pmi-heatmap-date-label">
                  {fmtColDate(row.DatePoint)}
                </div>
              ))}
            </div>
          </div>

          {/* X-axis title */}
          <div className="pmi-heatmap-xaxis-title">Datum</div>
        </div>
      </div>

      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => withDataGapWarning(addToPptx, chartData, activeRegions)(exportItem)} title="Zu PowerPoint hinzufügen">
          <PowerPointIcon width={26} height={26} />
        </button>
        <button className="chart-export-btn xlsx" onClick={() => withDataGapWarning(addToXlsx, chartData, activeRegions)(exportItem)} title="Zu Excel hinzufügen">
          <ExcelIcon width={26} height={26} />
        </button>
        {lastDate && <span className="chart-export-date">Letztes Datum: {lastDate}</span>}
      </div>
    </div>
  )
}

/**
 * Multi-Region Line Chart for a single Macro metric.
 * PMI charts add a reference line at 50 (neutral expansion/contraction boundary).
 */
function MacroLineChart({ chartData, regions, metricLabel, metricKey, yAxisLabel = '', unit = '', height = 300, chartType = 'Line' }) {
  const { addToPptx, addToXlsx } = useExport()
  const { formatter: smartDateFormatter, interval: smartInterval } = getSmartDateFormat(chartData)

  if (!chartData || chartData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  // Only render lines for regions that actually have at least one data point
  const activeRegions = regions.filter(r => chartData.some(d => d[r] !== undefined && d[r] !== null))

  if (activeRegions.length === 0) {
    return (
      <div className="chart-container">
        <h3>{metricLabel}</h3>
        <div className="chart-empty">Keine Daten verfügbar</div>
      </div>
    )
  }

  const isPMI = metricKey && metricKey.includes('PMI')
  const [yMin, yMax] = computeSmartDomain(chartData, activeRegions)
  const isLongSeries = isLongTimeseries(chartData)
  
  // Compute even interval spacing for y-axis
  let yDomain = ['auto', 'auto']
  if (yMin !== undefined && yMax !== undefined) {
    const range = yMax - yMin
    const step = Math.pow(10, Math.floor(Math.log10(range)))
    const roundedMin = Math.floor(yMin / step) * step
    const roundedMax = Math.ceil(yMax / step) * step
    yDomain = [roundedMin, roundedMax]
  }
  
  const formatter = (value) => {
    if (typeof value !== 'number') return value
    return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`
  }

  const dateRange = getDateRange(chartData, 'DatePoint')
  const subheading = dateRange

  const fullTitle = `Makro – ${metricLabel}`
  const exportItem = { id: makeId(fullTitle), title: fullTitle, pptx_title: metricLabel, subheading, yAxisLabel, source: 'Quelle: Bloomberg Finance L.P.', tab: 'Makro', chartData, regions: activeRegions, xKey: 'DatePoint' }

  // Build range-bar data (one entry per region: min/max/median/current)
  const barData = activeRegions
    .map((region) => {
      const vals = chartData.map(r => r[region]).filter(v => v != null && !Number.isNaN(v))
      if (!vals.length) return null
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const sorted = [...vals].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const current = getLatestValueForRegion(chartData, region)
      return { name: region, spacer: min, range: max - min, current, min, max, color: REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length] }
    })
    .filter(Boolean)
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))

  // Attach Balken-specific export fields
  exportItem.chartType = chartType
  exportItem.balkenData = chartType === 'Bar' ? barData : undefined

  return (
    <div className="chart-container">
      <h3>{metricLabel}</h3>
      <ResponsiveContainer width="100%" height={height}>
        {chartType === 'Bar' ? (
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
            {isPMI && (
              <ReferenceLine y={50} stroke="#6366f1" strokeDasharray="6 3"
                label={{ value: '50', position: 'right', fontSize: 10, fill: '#6366f1' }} />
            )}
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
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="DatePoint"
              tick={{ fontSize: 11 }}
              tickFormatter={(isoStr) => fmtDate(isoStr, smartDateFormatter)}
              interval={smartInterval}
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              domain={yDomain}
              tickFormatter={formatYValue}
              width={yAxisLabel ? 48 : 40}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', offset: 12, style: { textAnchor: 'middle', fontSize: 11, fill: '#6b7280' } } : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', fontSize: 12 }}
              formatter={formatter}
              labelFormatter={(label) => fmtDate(label, smartDateFormatter)}
            />
            <Legend />
            {/* Zero baseline for all charts */}
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
            {/* PMI 50-line (expansion vs contraction boundary) */}
            {isPMI && (
              <ReferenceLine
                y={50}
                stroke="#6366f1"
                strokeDasharray="6 3"
                label={{ value: '50', position: 'right', fontSize: 10, fill: '#6366f1' }}
              />
            )}
            {[...activeRegions]
              .sort((a, b) => {
                const latestA = getLatestValueForRegion(chartData, a) ?? -Infinity
                const latestB = getLatestValueForRegion(chartData, b) ?? -Infinity
                return latestB - latestA
              })
              .map((region) => {
              const latestValue = getLatestValueForRegion(chartData, region)
              const formatted = fmtLegendValue(latestValue, unit)
              const legendName = formatted !== null ? `${region} (${formatted})` : region
              return (
                <Line
                  key={region}
                  type="monotone"
                  dataKey={region}
                  name={legendName}
                  stroke={REGION_COLORS[regions.indexOf(region) % REGION_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                  connectNulls
                />
              )
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
      <div className="chart-export-buttons">
        <button className="chart-export-btn pptx" onClick={() => withDataGapWarning(addToPptx, chartData, activeRegions)(exportItem)} title="Zu PowerPoint hinzufügen"><PowerPointIcon width={26} height={26} /></button>
        <button className="chart-export-btn xlsx" onClick={() => withDataGapWarning(addToXlsx, chartData, activeRegions)(exportItem)} title="Zu Excel hinzufügen"><ExcelIcon width={26} height={26} /></button>
        {chartData[chartData.length - 1]?.DatePoint && (
          <span className="chart-export-date">Letztes Datum: {chartData[chartData.length - 1].DatePoint.split('T')[0]}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Macro Tab Component
 *
 * Displays macroeconomic indicators per region:
 * - MetricsTable: latest values per region, filtered by selectedMetricsTable
 * - Line charts: one per selected graph metric, all regions on the same chart
 *
 * Data is pre-fetched by the parent <Länder> component.
 */
function MacroTab({
  filters,
  data,
  loading,
  error,
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  chartsPerRow = 2,
  chartHeight = 300,
  chartType = 'Line',
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
  const allRecords = data.data

  // Apply date-range filter for charts
  const filteredRecords = allRecords.filter((r) => {
    if (!r.DatePoint) return false
    const d = new Date(r.DatePoint)
    if (filters.startDate && d < new Date(filters.startDate)) return false
    if (filters.endDate   && d > new Date(filters.endDate))   return false
    return true
  })

  // Determine which metrics are actually present in the API response
  const availableMetrics =
    allRecords.length > 0
      ? Object.keys(allRecords[0]).filter(
          (k) => !['DatePoint', 'Regions', 'Ticker', 'Currency', 'Name'].includes(k)
        )
      : []

  // Use selections if provided, otherwise fall back to standard defaults.
  // When the user has explicitly chosen metrics, show all of them (even if the
  // API returned no data for a metric – it will display "–" in the table).
  // Only apply the availableMetrics filter when falling back to defaults so we
  // don't render empty charts for metrics with zero data points.
  const tableColumns = selectedMetricsTable.length > 0
    ? selectedMetricsTable
    : MACRO_STANDARD_DEFAULTS.table.filter((c) => availableMetrics.includes(c))

  const graphMetrics = (selectedMetricsGraph.length > 0
    ? selectedMetricsGraph
    : MACRO_STANDARD_DEFAULTS.graph
  ).filter((m) => availableMetrics.includes(m))

  return (
    <div className="macro-tab">
      {/* Latest Values Table */}
      <MetricsTable
        data={allRecords}
        regions={regions}
        columns={tableColumns}
        categories={MACRO_METRICS_CATEGORIES}
        lookback={filters.lookback}
        tabLabel="Makro"
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
            const isPMI = metric.includes('PMI')
            const cd = pivotDataForChart(filteredRecords, metric, regions)
            if (isPMI && chartType === 'Line') {
              return (
                <PMIHeatmapChart
                  key={metric}
                  chartData={cd}
                  regions={regions}
                  metricLabel={getMacroMetricLabel(metric)}
                  metricKey={metric}
                />
              )
            }
            return (
              <MacroLineChart
                key={metric}
                chartData={cd}
                regions={regions}
                metricLabel={getMacroMetricLabel(metric)}
                metricKey={metric}
                yAxisLabel={getMacroYAxisLabel(metric)}
                unit={getMacroMetricUnit(metric)}
                height={chartHeight}
                chartType={chartType}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export default MacroTab
