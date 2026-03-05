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
  const [activeDateRange, setActiveDateRange] = useState('1Y')

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
  const AVAILABLE_REGIONS = ALL_REGIONS

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
      {/* Date Range Section with Custom Date Inputs */}
      <div className="control-section">
        <label>📅 Zeiträume (Benutzerdefiniert)</label>
        <div className="date-inputs">
          <input
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => onFiltersChange({ startDate: e.target.value })}
            placeholder="Start Date"
          />
          <input
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => onFiltersChange({ endDate: e.target.value })}
            placeholder="End Date"
          />
        </div>
      </div>

      {/* Region Selection Section */}
      <div className="control-section">
        <label>🌍 Land / Region auswählen</label>
        <div className="control-group">
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
        </div>

        <div className="region-selector">
          <div className="region-tags">
            {filters.regions.map(region => (
              <span key={region} className="region-tag">
                {getRegionDisplayName(region)}
                <button
                  className="tag-remove"
                  onClick={() => toggleRegion(region)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          
          <select
            multiple
            value={filters.regions}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, option => option.value)
              onFiltersChange({ regions: selected })
            }}
            className="regions-select"
          >
            {AVAILABLE_REGIONS.map(region => (
              <option key={region} value={region}>
                {getRegionDisplayName(region)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lookback Period Section - Controls date range */}
      <div className="control-section">
        <label>📊 Lookback-Perioden</label>
        <div className="control-group">
          <button
            key="1Y"
            className={`lookback-btn ${activeDateRange === '1Y' ? 'active' : ''}`}
            onClick={() => handleDateQuickSelect(365, '1Y')}
          >
            1Y
          </button>
          <button
            key="3Y"
            className={`lookback-btn ${activeDateRange === '3Y' ? 'active' : ''}`}
            onClick={() => handleDateQuickSelect(365 * 3, '3Y')}
          >
            3Y
          </button>
          <button
            key="5Y"
            className={`lookback-btn ${activeDateRange === '5Y' ? 'active' : ''}`}
            onClick={() => handleDateQuickSelect(365 * 5, '5Y')}
          >
            5Y
          </button>
          <button
            key="All"
            className={`lookback-btn ${activeDateRange === 'All' ? 'active' : ''}`}
            onClick={() => handleDateQuickSelect(365 * 10, 'All')}
          >
            All
          </button>
        </div>
      </div>

      {/* Display Options Section */}
      <div className="control-section">
        <label>
          <input
            type="checkbox"
            checked={filters.showAverages}
            onChange={(e) => onFiltersChange({ showAverages: e.target.checked })}
          />
          <span>Durchschnitte anzeigen</span>
        </label>
      </div>

      {/* Currency Selector (Equity Tab Only) */}
      {activeTab === 'equity' && (
        <div className="control-section">
          <label>💱 Währung (Aktien)</label>
          <div className="control-group">
            <button
              className={`currency-btn ${filters.currency === 'EUR' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ currency: 'EUR' })}
            >
              EUR
            </button>
            <button
              className={`currency-btn ${filters.currency === 'USD' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ currency: 'USD' })}
            >
              USD
            </button>
          </div>
        </div>
      )}

      {/* Metrics Filter Button - shown for Equity and Fixed Income tabs */}
      {showMetricsButton && (
        <div className="control-section">
          <button 
            className="filter-metrics-btn"
            onClick={() => setShowMetricsModal(true)}
            title="Wählen Sie die Metriken für Tabelle und Diagramme"
          >
            🔧 Datenfelder Filtern
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
