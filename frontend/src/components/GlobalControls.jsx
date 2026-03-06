import { useState } from 'react'
import './GlobalControls.css'
import MetricsFilterModal from './MetricsFilterModal'
import {
  ALL_REGIONS,
  REGION_PRESETS,
  EUROPEAN_COUNTRIES,
  WORLD_REGIONS,
  getPresetRegions,
  getRegionDisplayName
} from '../config/countries'
import {
  EQUITY_METRICS_CATEGORIES,
  STANDARD_DEFAULTS,
  FI_METRICS_CATEGORIES,
  FI_STANDARD_DEFAULTS,
  MACRO_METRICS_CATEGORIES,
  MACRO_STANDARD_DEFAULTS,
} from '../config/metricsConfig'

/**
 * Global Controls for Länder Page
 * 
 * Handles:
 * - Date range selection (quick buttons via Lookback-Perioden + custom inputs)
 * - Region selection (presets + multi-select)
 * - Lookback period (for rolling calculations)
 * - Averages toggle
 * - Currency selector (equity tab only)
 * - Metrics filtering (table and graphs)
 */
function GlobalControls({ 
  filters, 
  onFiltersChange, 
  activeTab,
  availableMetrics = [],
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  onMetricsChange,
  // FI-specific metric props
  availableFIMetrics = [],
  selectedFIMetricsTable = [],
  selectedFIMetricsGraph = [],
  onFIMetricsChange,
  // Macro-specific metric props
  availableMacroMetrics = [],
  selectedMacroMetricsTable = [],
  selectedMacroMetricsGraph = [],
  onMacroMetricsChange,
}) {
  console.log('[DEBUG GLOBALCONTROLS] Received props:', { activeTab, availableMetricsCount: availableMetrics.length, availableMetrics })
  const [showMetricsModal, setShowMetricsModal] = useState(false)
  const [activeDateRange, setActiveDateRange] = useState('1Y') // '1Y' matches the default dates initialized in App.jsx

  // Determine which metric config to use based on active tab
  const isEquityTab = activeTab === 'equity'
  const isFITab = activeTab === 'fixed-income'
  const isMacroTab = activeTab === 'macro'
  const showMetricsButton = isEquityTab || isFITab || isMacroTab

  const modalCategories     = isFITab    ? FI_METRICS_CATEGORIES
                            : isMacroTab ? MACRO_METRICS_CATEGORIES
                            : EQUITY_METRICS_CATEGORIES
  const modalStdDefaults    = isFITab    ? FI_STANDARD_DEFAULTS
                            : isMacroTab ? MACRO_STANDARD_DEFAULTS
                            : STANDARD_DEFAULTS
  const modalStorageSuffix  = isFITab    ? '_fi'
                            : isMacroTab ? '_macro'
                            : ''
  const modalAvail          = isFITab    ? availableFIMetrics
                            : isMacroTab ? availableMacroMetrics
                            : availableMetrics
  const modalSelTable       = isFITab    ? selectedFIMetricsTable
                            : isMacroTab ? selectedMacroMetricsTable
                            : selectedMetricsTable
  const modalSelGraph       = isFITab    ? selectedFIMetricsGraph
                            : isMacroTab ? selectedMacroMetricsGraph
                            : selectedMetricsGraph
  const modalOnChangeTable  = isFITab
    ? (m) => { if (onFIMetricsChange)    onFIMetricsChange({ tableMetrics: m }) }
    : isMacroTab
    ? (m) => { if (onMacroMetricsChange) onMacroMetricsChange({ tableMetrics: m }) }
    : (m) => { if (onMetricsChange)      onMetricsChange({ tableMetrics: m }) }
  const modalOnChangeGraph  = isFITab
    ? (m) => { if (onFIMetricsChange)    onFIMetricsChange({ graphMetrics: m }) }
    : isMacroTab
    ? (m) => { if (onMacroMetricsChange) onMacroMetricsChange({ graphMetrics: m }) }
    : (m) => { if (onMetricsChange)      onMetricsChange({ graphMetrics: m }) }

  const LOOKBACK_OPTIONS = ['1Y', '3Y', '5Y', 'All']

  // Regions excluded per tab
  const EXCLUDED_FI    = new Set(['China', 'India', 'EM'])
  const EXCLUDED_MACRO = new Set(['EM'])
  const AVAILABLE_REGIONS = isFITab
    ? ALL_REGIONS.filter(r => !EXCLUDED_FI.has(r))
    : isMacroTab
    ? ALL_REGIONS.filter(r => !EXCLUDED_MACRO.has(r))
    : ALL_REGIONS

  const handleDateQuickSelect = (days, label) => {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    setActiveDateRange(label)
    onFiltersChange({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      lookback: label
    })
  }

  const handleRegionPreset = (preset) => {
    const presetRegions = getPresetRegions(preset, AVAILABLE_REGIONS)
    onFiltersChange({
      regions: presetRegions
    })
  }

  const toggleRegion = (region) => {
    const newRegions = filters.regions.includes(region)
      ? filters.regions.filter(r => r !== region)
      : [...filters.regions, region]
    
    onFiltersChange({ regions: newRegions })
  }

  return (
    <div className="global-controls">

      {/* ── Zeitraum ────────────────────────────────────────────── */}
      <div className="control-section">
        <span className="ctrl-label">📊 Zeitraum</span>
        <div className="control-group">
          {[['1Y', 365], ['3Y', 365 * 3], ['5Y', 365 * 5], ['All', 365 * 10]].map(([label, days]) => (
            <button
              key={label}
              className={`lookback-btn ${activeDateRange === label ? 'active' : ''}`}
              onClick={() => handleDateQuickSelect(days, label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Benutzerdefiniert ────────────────────────────────────── */}
      <div className="control-section">
        <span className="ctrl-label">📅 Benutzerdefiniert</span>
        <div className="date-inputs">
          <input
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => { setActiveDateRange(null); onFiltersChange({ startDate: e.target.value }) }}
          />
          <span className="date-sep">→</span>
          <input
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => { setActiveDateRange(null); onFiltersChange({ endDate: e.target.value }) }}
          />
        </div>
      </div>

      {/* ── Land / Region ────────────────────────────────────────── */}
      <div className="control-section">
        <span className="ctrl-label">🌍 Land / Region</span>
        <div className="control-group">
          {/* Preset buttons */}
          {Object.keys(REGION_PRESETS).map(preset => {
            const presetRegions = getPresetRegions(preset, AVAILABLE_REGIONS)
            const isActive = presetRegions.length === filters.regions.length &&
                             presetRegions.every(r => filters.regions.includes(r))
            return (
              <button
                key={preset}
                className={`preset-btn ${isActive ? 'active' : ''}`}
                onClick={() => handleRegionPreset(preset)}
              >
                {preset}
              </button>
            )
          })}

          {/* Smart region tag display */}
          {(() => {
            // Check if a named preset is active
            const activePreset = Object.keys(REGION_PRESETS).find(preset => {
              const pr = getPresetRegions(preset, AVAILABLE_REGIONS)
              return pr.length === filters.regions.length && pr.every(r => filters.regions.includes(r))
            })

            if (activePreset) {
              // Single summary chip – no remove needed, user can switch preset or deselect individually
              return (
                <span className="region-tag region-tag--preset">
                  {activePreset} · {filters.regions.length} Länder
                </span>
              )
            }

            const MAX_VISIBLE = 4
            const visible = filters.regions.slice(0, MAX_VISIBLE)
            const overflow = filters.regions.length - MAX_VISIBLE
            return (
              <>
                {visible.map(region => (
                  <span key={region} className="region-tag">
                    {getRegionDisplayName(region)}
                    <button className="tag-remove" onClick={() => toggleRegion(region)}>×</button>
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="region-tag region-tag--overflow">+{overflow}</span>
                )}
              </>
            )
          })()}

          {/* Add-region dropdown */}
          <select
            className="region-add-select"
            value=""
            onChange={(e) => {
              if (e.target.value) toggleRegion(e.target.value)
            }}
          >
            <option value="">+ Region</option>
            {AVAILABLE_REGIONS.filter(r => !filters.regions.includes(r)).map(region => (
              <option key={region} value={region}>{getRegionDisplayName(region)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Spacer ───────────────────────────────────────────────── */}
      <div className="controls-spacer" />

      {/* ── Währung (Equity only) ─────────────────────────────────── */}
      {activeTab === 'equity' && (
        <div className="control-section">
          <span className="ctrl-label">💱 Währung</span>
          <div className="control-group">
            <button
              className={`currency-btn ${filters.currency === 'EUR' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ currency: 'EUR' })}
            >EUR</button>
            <button
              className={`currency-btn ${filters.currency === 'USD' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ currency: 'USD' })}
            >USD</button>
          </div>
        </div>
      )}

      {/* ── Datenfelder Filtern ──────────────────────────────────── */}
      {showMetricsButton && (
        <div className="control-section">
          <span className="ctrl-label">&nbsp;</span>
          <button
            className="filter-metrics-btn"
            onClick={() => setShowMetricsModal(true)}
            title="Wählen Sie die Metriken für Tabelle und Diagramme"
          >
            🔧 Datenfelder
          </button>
        </div>
      )}

      {/* Metrics Filter Modal */}
      <MetricsFilterModal
        isOpen={showMetricsModal}
        onClose={() => setShowMetricsModal(false)}
        availableMetrics={modalAvail}
        selectedMetricsTable={modalSelTable}
        selectedMetricsGraph={modalSelGraph}
        onChangeTableMetrics={modalOnChangeTable}
        onChangeGraphMetrics={modalOnChangeGraph}
        categories={modalCategories}
        standardDefaults={modalStdDefaults}
        storageKeySuffix={modalStorageSuffix}
      />
    </div>
  )
}

export default GlobalControls
