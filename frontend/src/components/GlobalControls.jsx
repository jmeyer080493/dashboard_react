import { useState, useEffect, useRef } from 'react'
import './GlobalControls.css'
import MetricsFilterModal from './MetricsFilterModal'
import {
  ALL_REGIONS,
  FI_ONLY_REGIONS,
  REGION_PRESETS,
  EUROPEAN_COUNTRIES,
  WORLD_REGIONS,
  getPresetRegions,
  getRegionDisplayName,
  REGION_ABBREVIATIONS,
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

// Normalize flexible date format (YYYY-MM-DD, YYYY/MM/D, etc.) to YYYY-MM-DD
function normalizeDate(dateStr) {
  const match = dateStr.match(/^(\d{4})(?:-|\/|\.)(\d{1,2})(?:-|\/|\.)(\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
// S&P rating groups for FI quick-select buttons
const AAA_AA_RATINGS = new Set(['AAA', 'AA+', 'AA', 'AA-'])
const A_BBB_RATINGS  = new Set(['A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-'])

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
  // Chart type toggle
  chartType = 'Line',
  onChartTypeChange,
  // Ratings (for FI rating-based quick select)
  ratingsData = [],
}) {
  console.log('[DEBUG GLOBALCONTROLS] Received props:', { activeTab, availableMetricsCount: availableMetrics.length, availableMetrics })
  const [showMetricsModal, setShowMetricsModal] = useState(false)
  const [activeDateRange, setActiveDateRange] = useState(filters.customMode ? null : (filters.lookback ?? '1Y'))
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const countryDropdownRef = useRef(null)
  // Per-tab region memory: saves the full region selection for each tab so that
  // switching away and back restores the original selection (e.g. FI-only countries
  // are dropped when switching to Equity, but restored when switching back to FI).
  const prevActiveTabRef = useRef(activeTab)
  const tabRegionsRef = useRef({})

  // Close country dropdown on outside click
  useEffect(() => {
    if (!showCountryDropdown) return
    const handleOutside = (e) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target)) {
        setShowCountryDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showCountryDropdown])

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

  const LOOKBACK_OPTIONS = ['YtD', '1Y', '3Y', '5Y', 'All']

  // Commit date on blur or Enter (with validation & normalization)
  const commitDate = (field, value) => {
    if (value === (field === 'start' ? filters.startDate : filters.endDate)) return // No change
    const datePattern = /^[0-9]{4}(?:-|\/|\.)(0?[1-9]|1[0-2])(?:-|\/|\.)(0?[1-9]|[12][0-9]|3[01])$/
    if (value && !datePattern.test(value)) return // Invalid format, reject silently
    const normalized = value ? normalizeDate(value) : ''
    if (field === 'start') onFiltersChange({ startDate: normalized, customMode: true })
    else onFiltersChange({ endDate: normalized, customMode: true })
    setActiveDateRange(null)
  }

  // Regions excluded per tab
  const EXCLUDED_FI    = new Set(['China', 'India', 'EM'])
  const EXCLUDED_MACRO = new Set(['EM'])
  // For the FI tab: base regions minus excluded, PLUS the FI-only countries (yields-only)
  const AVAILABLE_REGIONS = isFITab
    ? [...ALL_REGIONS.filter(r => !EXCLUDED_FI.has(r)), ...FI_ONLY_REGIONS]
    : isMacroTab
    ? ALL_REGIONS.filter(r => !EXCLUDED_MACRO.has(r))
    : ALL_REGIONS

  // When the active tab changes: save the outgoing tab's full region selection, then
  // restore the incoming tab's previously-saved selection (or filter the current one
  // down to what's valid for the new tab if no saved state exists yet).
  useEffect(() => {
    const prevTab = prevActiveTabRef.current
    if (prevTab === activeTab) return // initial mount – nothing to do

    // Persist the outgoing tab's complete region list (including tab-specific extras)
    tabRegionsRef.current = {
      ...tabRegionsRef.current,
      [prevTab]: filters.regions,
    }

    const savedForNewTab = tabRegionsRef.current[activeTab]
    if (savedForNewTab) {
      // Restore the selection last used on this tab, clamped to what's available here
      const valid = savedForNewTab.filter(r => AVAILABLE_REGIONS.includes(r))
      onFiltersChange({ regions: valid })
    } else {
      // First visit to this tab: strip any regions that aren't available here
      const invalid = filters.regions.filter(r => !AVAILABLE_REGIONS.includes(r))
      if (invalid.length > 0) {
        onFiltersChange({ regions: filters.regions.filter(r => AVAILABLE_REGIONS.includes(r)) })
      }
    }

    prevActiveTabRef.current = activeTab
  }, [activeTab])

  const handleDateQuickSelect = (days, label) => {
    const endDate = new Date()
    const startDate = new Date()
    if (label === 'YtD') {
      // Last trading day of previous year – use Dec 31 as the base/anchor date.
      // The backend will look up the last available price on or before this date.
      startDate.setFullYear(startDate.getFullYear() - 1, 11, 31) // Dec 31 of prev year
    } else {
      startDate.setDate(startDate.getDate() - days)
    }
    
    setActiveDateRange(label)
    onFiltersChange({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      lookback: label,
      customMode: false,
    })
  }

  const handleRegionPreset = (preset) => {
    let presetRegions = getPresetRegions(preset, AVAILABLE_REGIONS)
    
    // Add Emerging Markets to "Welt" selection on the Equity tab
    if (preset === 'Welt' && isEquityTab && !presetRegions.includes('EM') && !presetRegions.includes('China')) {
      presetRegions = [...presetRegions, 'EM', 'China']
    }
    
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
          {[['YtD', 0], ['1Y', 365], ['3Y', 365 * 3], ['5Y', 365 * 5], ['All', 365 * 10]].map(([label, days]) => (
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
            key={filters.startDate}
            type="text"
            placeholder="YYYY-MM-DD"
            className="länder-date-input"
            defaultValue={filters.startDate || ''}
            pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
            onBlur={(e) => commitDate('start', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDate('start', e.target.value) }}
          />
          <span className="date-sep">→</span>
          <input
            key={filters.endDate}
            type="text"
            placeholder="YYYY-MM-DD"
            className="länder-date-input"
            defaultValue={filters.endDate || ''}
            pattern={"[0-9]{4}(-|/|\\.)(0?[1-9]|1[0-2])(-|/|\\.)(0?[1-9]|[12][0-9]|3[01])"}
            onBlur={(e) => commitDate('end', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDate('end', e.target.value) }}
          />
        </div>
      </div>

      {/* ── Land / Region ────────────────────────────────────────── */}
      <div className="control-section">
        <span className="ctrl-label">🌍 Land / Region</span>
        <div className="control-group">
          {/* Preset buttons – hide "Welt" on the Fixed Income tab, and hide "Alle" */}
          {Object.keys(REGION_PRESETS)
            .filter(preset => preset !== 'Alle' && !(isFITab && preset === 'Welt'))
            .map(preset => {
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
            })
          }

          {/* Rating-based quick-select buttons (Fixed Income tab only) */}
          {isFITab && (() => {
            const ratingBuckets = [
              { label: 'AAA-AA', ratingSet: AAA_AA_RATINGS },
              { label: 'A-BBB',  ratingSet: A_BBB_RATINGS, exclude: new Set(['Japan']) },
            ]
            return ratingBuckets.map(({ label, ratingSet, exclude = new Set() }) => {
              const matchingRegions = ratingsData
                .filter(r => r.SP && ratingSet.has(r.SP) && AVAILABLE_REGIONS.includes(r.Regions) && !exclude.has(r.Regions))
                .map(r => r.Regions)
              const isActive =
                matchingRegions.length > 0 &&
                matchingRegions.length === filters.regions.length &&
                matchingRegions.every(r => filters.regions.includes(r))
              return (
                <button
                  key={label}
                  className={`preset-btn ${isActive ? 'active' : ''}`}
                  onClick={() => onFiltersChange({ regions: matchingRegions })}
                  title={`Länder mit S&P Rating ${label}`}
                >
                  {label}
                </button>
              )
            })
          })()}

          <div className="country-multiselect" ref={countryDropdownRef}>
            <button
              className={`country-multiselect-trigger ${showCountryDropdown ? 'open' : ''}`}
              onClick={() => setShowCountryDropdown(v => !v)}
              title={filters.regions.map(r => getRegionDisplayName(r)).join(', ') || 'Keine Länder ausgewählt'}
            >
              <span className="country-multiselect-value">
                {filters.regions.length === 0
                  ? 'Keine'
                  : filters.regions.length === AVAILABLE_REGIONS.length
                  ? `Alle (${AVAILABLE_REGIONS.length})`
                  : filters.regions.map(r => REGION_ABBREVIATIONS[r] || r).join(', ')}
              </span>
              <span className="country-multiselect-arrow">{showCountryDropdown ? '▴' : '▾'}</span>
            </button>

            {showCountryDropdown && (
              <div className="country-multiselect-dropdown">
                <div className="country-multiselect-actions">
                  <button onClick={() => onFiltersChange({ regions: [...AVAILABLE_REGIONS] })}>Alle</button>
                  <button onClick={() => onFiltersChange({ regions: [] })}>Keine</button>
                </div>
                <div className="country-multiselect-list">
                  {AVAILABLE_REGIONS.map(region => {
                    const abbr = REGION_ABBREVIATIONS[region] || region
                    const checked = filters.regions.includes(region)
                    return (
                      <label
                        key={region}
                        className={`country-option ${checked ? 'checked' : ''}`}
                        title={getRegionDisplayName(region)}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRegion(region)}
                        />
                        <span className="country-abbr">{abbr}</span>
                        <span className="country-fullname">{getRegionDisplayName(region)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Spacer ───────────────────────────────────────────────── */}
      <div className="controls-spacer" />

      {/* ── Charttyp ─────────────────────────────────────────────── */}
      {onChartTypeChange && (
        <div className="control-section">
          <span className="ctrl-label">📊 Charttyp</span>
          <div className="control-group">
            {[{ id: 'Line', label: 'Standard' }, { id: 'Bar', label: 'Balken' }].map(ct => (
              <button
                key={ct.id}
                className={`lookback-btn ${chartType === ct.id ? 'active' : ''}`}
                onClick={() => onChartTypeChange(ct.id)}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
