import { useState } from 'react'
import './GlobalControls.css'

/**
 * Global Controls for Länder Page
 * 
 * Handles:
 * - Date range selection (quick buttons + custom inputs)
 * - Region selection (presets + multi-select)
 * - Lookback period (for rolling calculations)
 * - Averages toggle
 * - Currency selector (equity tab only)
 */
function GlobalControls({ filters, onFiltersChange, activeTab }) {
  const [showDateInputs, setShowDateInputs] = useState(false)

  const LOOKBACK_OPTIONS = ['1Y', '3Y', '5Y', 'All']
  const REGION_PRESETS = {
    'Alle': ['Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria', 'Finland'],
    'Welt': ['Germany', 'USA', 'Japan', 'China'],
    'Europa': ['Germany', 'France', 'Italy', 'Spain'],
    'US-EU': ['Germany', 'USA']
  }

  const AVAILABLE_REGIONS = [
    'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium',
    'Austria', 'Finland', 'USA', 'Japan', 'China', 'UK'
  ]

  const handleDateQuickSelect = (days) => {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    onFiltersChange({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    })
    setShowDateInputs(false)
  }

  const handleRegionPreset = (preset) => {
    onFiltersChange({
      regions: REGION_PRESETS[preset]
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
      {/* Date Range Section */}
      <div className="control-section">
        <label>📅 Zeiträume</label>
        <div className="control-group">
          <button 
            className="quick-btn"
            onClick={() => handleDateQuickSelect(365)}
          >
            1Y
          </button>
          <button 
            className="quick-btn"
            onClick={() => handleDateQuickSelect(365 * 3)}
          >
            3Y
          </button>
          <button 
            className="quick-btn"
            onClick={() => handleDateQuickSelect(365 * 5)}
          >
            5Y
          </button>
          <button 
            className="quick-btn"
            onClick={() => handleDateQuickSelect(365 * 10)}
          >
            All
          </button>
        </div>

        {showDateInputs && (
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
        )}
        <button 
          className="toggle-dates-btn"
          onClick={() => setShowDateInputs(!showDateInputs)}
        >
          {showDateInputs ? 'Einklappen' : 'Benutzerdefiniert'}
        </button>
      </div>

      {/* Region Selection Section */}
      <div className="control-section">
        <label>🌍 Land / Region auswählen</label>
        <div className="control-group">
          {Object.keys(REGION_PRESETS).map(preset => (
            <button
              key={preset}
              className="preset-btn"
              onClick={() => handleRegionPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="region-selector">
          <div className="region-tags">
            {filters.regions.map(region => (
              <span key={region} className="region-tag">
                {region}
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
                {region}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lookback Period Section */}
      <div className="control-section">
        <label>📊 Lookback-Perioden</label>
        <div className="control-group">
          {LOOKBACK_OPTIONS.map(option => (
            <button
              key={option}
              className={`lookback-btn ${filters.lookback === option ? 'active' : ''}`}
              onClick={() => onFiltersChange({ lookback: option })}
            >
              {option}
            </button>
          ))}
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
    </div>
  )
}

export default GlobalControls
