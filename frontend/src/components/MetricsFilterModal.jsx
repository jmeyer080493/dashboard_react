import { useState, useEffect } from 'react'
import './MetricsFilterModal.css'
import {
  EQUITY_METRICS_CATEGORIES,
  STANDARD_DEFAULTS,
} from '../config/metricsConfig'

const USER_DEFAULT_KEY_TABLE = 'metricsFilter_userDefault_table'
const USER_DEFAULT_KEY_GRAPH = 'metricsFilter_userDefault_graph'

/**
 * MetricsFilterModal Component
 *
 * Category-based filter modal matching the reference Dash dashboard design.
 * Each field shows TABELLE and GRAFIK checkboxes inline.
 * "Spezial" category is graph-only (no TABELLE column).
 * Buttons: Save Default | Load Default | Load Standard | Ok
 *
 * Accepts optional `categories` and `standardDefaults` props so the same modal
 * can be reused for both equity and fixed-income tabs.
 */
function MetricsFilterModal({
  isOpen,
  onClose,
  availableMetrics = [],
  selectedMetricsTable = [],
  selectedMetricsGraph = [],
  onChangeTableMetrics,
  onChangeGraphMetrics,
  // Tab-specific overrides (default = equity)
  categories = null,
  standardDefaults = null,
  storageKeySuffix = '',   // e.g. '_fi' for fixed-income so defaults are stored separately
}) {
  // Use provided categories/defaults, or fall back to equity
  const activeCategories = categories || EQUITY_METRICS_CATEGORIES
  const activeStandardDefaults = standardDefaults || STANDARD_DEFAULTS

  const userDefaultKeyTable = USER_DEFAULT_KEY_TABLE + storageKeySuffix
  const userDefaultKeyGraph  = USER_DEFAULT_KEY_GRAPH  + storageKeySuffix

  const [pendingTable, setPendingTable] = useState([])
  const [pendingGraph, setPendingGraph]  = useState([])

  // Sync pending state from props whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setPendingTable(selectedMetricsTable)
      setPendingGraph(selectedMetricsGraph)
    }
  }, [isOpen, selectedMetricsTable, selectedMetricsGraph])

  // ── helpers ────────────────────────────────────────────────────────────────

  const isAvailable = (key) =>
    availableMetrics.length === 0 || availableMetrics.includes(key)

  const toggleTable = (key) =>
    setPendingTable(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )

  const toggleGraph = (key) =>
    setPendingGraph(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )

  // Toggle all fields in a category for table or graph
  const toggleCategoryAll = (cat, type, checked) => {
    const keys = cat.fields
      .filter(f => isAvailable(f.key) && (type === 'table' ? f.tableEnabled : f.graphEnabled))
      .map(f => f.key)

    if (type === 'table') {
      setPendingTable(prev =>
        checked ? [...new Set([...prev, ...keys])] : prev.filter(k => !keys.includes(k))
      )
    } else {
      setPendingGraph(prev =>
        checked ? [...new Set([...prev, ...keys])] : prev.filter(k => !keys.includes(k))
      )
    }
  }

  const isCategoryAllChecked = (cat, type) => {
    const eligible = cat.fields.filter(
      f => isAvailable(f.key) && (type === 'table' ? f.tableEnabled : f.graphEnabled)
    )
    if (eligible.length === 0) return false
    const list = type === 'table' ? pendingTable : pendingGraph
    return eligible.every(f => list.includes(f.key))
  }

  // ── default management ────────────────────────────────────────────────────

  const handleSaveDefault = () => {
    try {
      localStorage.setItem(userDefaultKeyTable, JSON.stringify(pendingTable))
      localStorage.setItem(userDefaultKeyGraph, JSON.stringify(pendingGraph))
    } catch (_) {}
  }

  const handleLoadDefault = () => {
    try {
      const t = JSON.parse(localStorage.getItem(userDefaultKeyTable) || 'null')
      const g = JSON.parse(localStorage.getItem(userDefaultKeyGraph) || 'null')
      if (t) setPendingTable(t)
      if (g) setPendingGraph(g)
    } catch (_) {}
  }

  const handleLoadStandard = () => {
    setPendingTable(activeStandardDefaults.table)
    setPendingGraph(activeStandardDefaults.graph)
  }

  const handleApply = () => {
    onChangeTableMetrics(pendingTable)
    onChangeGraphMetrics(pendingGraph)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="mfm-overlay" onClick={onClose}>
      <div className="mfm-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mfm-header">
          <span className="mfm-title">🔧 Datenfelder filtern</span>
          <button className="mfm-close" onClick={onClose}>×</button>
        </div>

        {/* Default action buttons */}
        <div className="mfm-default-btns">
          <button className="mfm-btn mfm-btn-save"   onClick={handleSaveDefault}>💾 Save Default</button>
          <button className="mfm-btn mfm-btn-load"   onClick={handleLoadDefault}>📂 Load Default</button>
          <button className="mfm-btn mfm-btn-std"    onClick={handleLoadStandard}>🔄 Load Standard</button>
        </div>

        {/* Body: category grid */}
        <div className="mfm-body">
          {activeCategories.map(cat => {
            const graphOnly = !!cat.graphOnly

            return (
              <div key={cat.key} className="mfm-category">

                {/* Category header row */}
                <div className="mfm-cat-header">
                  <span className="mfm-cat-name">{cat.label}</span>
                  <div className="mfm-cat-controls">
                    {!graphOnly && (
                      <label className="mfm-col-header" title="Alle Tabelle">
                        <input
                          type="checkbox"
                          checked={isCategoryAllChecked(cat, 'table')}
                          onChange={e => toggleCategoryAll(cat, 'table', e.target.checked)}
                        />
                        TABELLE
                      </label>
                    )}
                    <label className="mfm-col-header" title="Alle Grafik">
                      <input
                        type="checkbox"
                        checked={isCategoryAllChecked(cat, 'graph')}
                        onChange={e => toggleCategoryAll(cat, 'graph', e.target.checked)}
                      />
                      GRAFIK
                    </label>
                  </div>
                </div>

                {/* Field rows */}
                {cat.fields.map(field => {
                  const available = isAvailable(field.key)
                  return (
                    <div
                      key={field.key}
                      className={`mfm-field-row ${!available ? 'mfm-field-unavailable' : ''}`}
                    >
                      <span className="mfm-field-label">{field.label}</span>
                      <div className="mfm-field-checks">
                        {!graphOnly && (
                          <label className="mfm-check-cell">
                            <input
                              type="checkbox"
                              checked={pendingTable.includes(field.key)}
                              disabled={!available || !field.tableEnabled}
                              onChange={() => toggleTable(field.key)}
                            />
                          </label>
                        )}
                        <label className="mfm-check-cell">
                          <input
                            type="checkbox"
                            checked={pendingGraph.includes(field.key)}
                            disabled={!available || !field.graphEnabled}
                            onChange={() => toggleGraph(field.key)}
                          />
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mfm-footer">
          <button className="mfm-btn mfm-btn-ok" onClick={handleApply}>Ok</button>
        </div>

      </div>
    </div>
  )
}

export default MetricsFilterModal
