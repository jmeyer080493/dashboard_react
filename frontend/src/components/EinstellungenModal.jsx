import { useState, useEffect } from 'react'
import axios from 'axios'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import './EinstellungenModal.css'

const API_BASE = 'http://localhost:8000'

// Map App's page names to internal setting keys
const PAGE_NAME_TO_KEY = {
  'Länder':      'laender',
  'Faktoren':    'faktoren',
  'Sektoren':    'sektoren',
  'Alternative': 'alternativ',
}

const PAGE_OPTIONS = [
  { value: 'laender',    label: '🌍 Länder',      permission: 'countries' },
  { value: 'faktoren',   label: '📊 Faktoren',    permission: 'factors'   },
  { value: 'sektoren',   label: '🏭 Sektoren',    permission: 'sectors'   },
  { value: 'alternativ', label: '📈 Alternative', permission: 'extras'    },
]

const LAENDER_TABS = [
  { value: 'all',    label: 'Alle Tabs' },
  { value: 'equity', label: 'Aktien'    },
  { value: 'fi',     label: 'Anleihen'  },
  { value: 'macro',  label: 'Makro'     },
]

const CHARTS_PER_ROW_OPTIONS = [
  { value: 1, label: '1 Grafik pro Zeile' },
  { value: 2, label: '2 Grafiken pro Zeile' },
  { value: 3, label: '3 Grafiken pro Zeile' },
]

const CHART_HEIGHT_OPTIONS = [
  { value: 300, label: 'Klein' },
  { value: 450, label: 'Mittel' },
  { value: 650, label: 'Groß' },
  { value: 800, label: 'Sehr groß' },
]

const LINE_WIDTH_OPTIONS = [
  { value: 1,   label: 'Dünn' },
  { value: 2,   label: 'Mittel' },
  { value: 3,   label: 'Dick' },
  { value: 5,   label: 'Sehr dick' },
]

export default function EinstellungenModal({ isOpen, onClose, activePage, graphSettings, onSaveSettings }) {
  const { theme, setTheme } = useTheme()
  const { permissions } = useAuth()
  const [activeTab, setActiveTab] = useState('grafiken')

  // Only show pages the current user has access to
  const visiblePageOptions = PAGE_OPTIONS.filter(p => permissions.includes(p.permission))

  // Page selector in Grafiken tab
  const [selectedPage, setSelectedPage] = useState('laender')
  // Tab selector – only used when selectedPage === 'laender'
  const [activeLänderTab, setActiveLänderTab] = useState('all')

  // Draft state for graph settings (edited before save)
  const [draft, setDraft] = useState(graphSettings)

  // Password change state
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwdMessage, setPwdMessage] = useState(null)
  const [pwdLoading, setPwdLoading] = useState(false)

  // Sync draft + pre-select current page when modal opens
  useEffect(() => {
    if (isOpen) {
      setDraft(graphSettings)
      // Pre-select current page, but fall back to first visible page if not accessible
      const preferred = PAGE_NAME_TO_KEY[activePage]
      const fallback = visiblePageOptions[0]?.value ?? 'laender'
      setSelectedPage(visiblePageOptions.find(p => p.value === preferred) ? preferred : fallback)
      setActiveLänderTab('all')
    }
  }, [isOpen, graphSettings, activePage])

  if (!isOpen) return null

  const handleClose = () => {
    // Reset password fields on close
    setCurrent(''); setNext(''); setConfirm(''); setPwdMessage(null)
    onClose()
  }

  // ── Graph settings helpers ───────────────────────────────────────────────

  const getAllTabsValues = (field) => {
    return {
      equity: draft.equity?.[field],
      fi: draft.fi?.[field],
      macro: draft.macro?.[field],
    }
  }

  const areAllTabsEqual = (field) => {
    const vals = getAllTabsValues(field)
    return vals.equity === vals.fi && vals.fi === vals.macro
  }

  // All page keys (all 6 sections)
  const ALL_PAGE_KEYS = ['equity', 'fi', 'macro', 'faktoren', 'sektoren', 'alternativ']

  const getAllPagesValues = (field) => {
    return ALL_PAGE_KEYS.map(k => draft[k]?.[field])
  }

  const areAllPagesEqual = (field) => {
    const vals = getAllPagesValues(field)
    return vals.every(v => v === vals[0])
  }

  const getMostCommonValue = (field) => {
    const vals = getAllTabsValues(field)
    const valuesArray = [vals.equity, vals.fi, vals.macro]
    
    // Count occurrences
    const counts = {}
    valuesArray.forEach(v => {
      counts[v] = (counts[v] || 0) + 1
    })
    
    // Return the most common value
    return Object.keys(counts).reduce((a, b) => 
      counts[a] > counts[b] ? a : b
    )
  }

  const getMostCommonValueAllPages = (field) => {
    const vals = getAllPagesValues(field)
    const counts = {}
    vals.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b)
  }

  const getEffectiveValue = (field) => {
    if (selectedPage === 'all') {
      return getMostCommonValueAllPages(field)
    }
    if (selectedPage === 'laender') {
      if (activeLänderTab === 'all') {
        // Return the most common value across all tabs
        return getMostCommonValue(field)
      } else {
        return draft[activeLänderTab]?.[field]
      }
    }
    return draft[selectedPage]?.[field]
  }

  const setFieldValue = (field, value) => {
    if (selectedPage === 'all') {
      setDraft(prev => ({
        ...prev,
        ...Object.fromEntries(ALL_PAGE_KEYS.map(k => [k, { ...prev[k], [field]: value }])),
      }))
    } else if (selectedPage === 'laender') {
      if (activeLänderTab === 'all') {
        setDraft(prev => ({
          ...prev,
          equity: { ...prev.equity, [field]: value },
          fi:     { ...prev.fi,     [field]: value },
          macro:  { ...prev.macro,  [field]: value },
        }))
      } else {
        setDraft(prev => ({
          ...prev,
          [activeLänderTab]: { ...prev[activeLänderTab], [field]: value },
        }))
      }
    } else {
      setDraft(prev => ({
        ...prev,
        [selectedPage]: { ...prev[selectedPage], [field]: value },
      }))
    }
  }

  const handleSaveGraphSettings = () => {
    onSaveSettings(draft)
    onClose()
  }

  // ── Password change ──────────────────────────────────────────────────────

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setPwdMessage(null)

    if (!current || !next || !confirm) {
      setPwdMessage({ type: 'error', text: 'Bitte alle Felder ausfüllen' })
      return
    }
    if (next !== confirm) {
      setPwdMessage({ type: 'error', text: 'Passwörter stimmen nicht überein' })
      return
    }
    if (next.length < 8) {
      setPwdMessage({ type: 'error', text: 'Passwort muss mindestens 8 Zeichen lang sein' })
      return
    }

    setPwdLoading(true)
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/change-password`, {
        current_password: current,
        new_password: next,
        confirm_password: confirm,
      })
      setPwdMessage({ type: 'success', text: data.message })
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      const msg = err.response?.data?.detail ?? 'Passwortänderung fehlgeschlagen'
      setPwdMessage({ type: 'error', text: msg })
    } finally {
      setPwdLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="eins-overlay" onClick={handleClose}>
      <div className="eins-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="eins-header">
          <h2 className="eins-title">⚙️ Einstellungen</h2>
          <button className="eins-close" onClick={handleClose} aria-label="Schließen">✕</button>
        </div>

        {/* Tab bar */}
        <div className="eins-tabs">
          {[
            { id: 'darstellung', label: '🎨 Darstellung' },
            { id: 'grafiken',    label: '📊 Grafiken' },
            { id: 'sicherheit', label: '🔒 Sicherheit' },
          ].map(tab => (
            <button
              key={tab.id}
              className={`eins-tab ${activeTab === tab.id ? 'eins-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="eins-body">

          {/* ── Darstellung ─────────────────────────────────────────────── */}
          {activeTab === 'darstellung' && (
            <div className="eins-section">
              <h3 className="eins-section-title">Design-Modus</h3>
              <p className="eins-hint">Wählen Sie zwischen hellem und dunklem Dashboard-Design.</p>
              <div className="eins-btn-group" style={{ marginTop: '0.25rem', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  className={`eins-theme-btn ${theme === 'light' ? 'eins-theme-btn--active' : ''}`}
                  onClick={() => setTheme('light')}
                  style={{ width: '100%', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}
                >
                  <span>☀️ Hell</span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Helles Dashboard-Design</span>
                </button>
                <button
                  className={`eins-theme-btn ${theme === 'dark' ? 'eins-theme-btn--active' : ''}`}
                  onClick={() => setTheme('dark')}
                  style={{ width: '100%', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}
                >
                  <span>🌙 Dunkel</span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Dunkles Dashboard-Design</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Grafiken ────────────────────────────────────────────────── */}
          {activeTab === 'grafiken' && (
            <div className="eins-section">
              <h3 className="eins-section-title">Layout-Einstellungen</h3>

              {/* Page selector */}
              <label className="eins-label">Seite auswählen:</label>
              <div className="eins-select-wrap">
                <select
                  className="eins-select"
                  value={selectedPage}
                  onChange={(e) => { setSelectedPage(e.target.value); setActiveLänderTab('all') }}
                >
                  <option value="all">🌐 Alle Seiten</option>
                  {visiblePageOptions.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Alle Seiten hint */}
              {selectedPage === 'all' && (
                <p style={{ fontSize: '0.55rem', margin: '0', opacity: 0.5 }}>
                  {areAllPagesEqual('chartsPerRow') && areAllPagesEqual('chartHeight') && areAllPagesEqual('lineWidth')
                    ? '✓ Alle Seiten nutzen die gleichen Einstellungen'
                    : '⚠ Die Seiten nutzen unterschiedliche Einstellungen. Die Dropdowns zeigen die häufigste Einstellung an.'}
                </p>
              )}

              {/* Tab selector – only for Länder */}
              {selectedPage === 'laender' && (
                <>
                  <label className="eins-label">Anwenden auf:</label>
                  
                  {activeLänderTab === 'all' && (
                    <>
                      <p style={{ fontSize: '0.55rem', margin: '0', opacity: 0.5 }}>
                        {areAllTabsEqual('chartsPerRow') && areAllTabsEqual('chartHeight') && areAllTabsEqual('lineWidth')
                          ? '✓ Alle Tabs nutzen die gleichen Einstellungen'
                          : '⚠ Die Tabs nutzen unterschiedliche Einstellungen. Die Dropdowns zeigen die häufigste Einstellung an.'}
                      </p>
                    </>
                  )}
                  
                  <div className="eins-select-wrap">
                    <select
                      className="eins-select"
                      value={activeLänderTab}
                      onChange={(e) => setActiveLänderTab(e.target.value)}
                    >
                      {LAENDER_TABS.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Graphs per row */}
              <label className="eins-label">Grafiken pro Zeile:</label>
              <div className="eins-select-wrap">
                <select
                  className="eins-select"
                  value={getEffectiveValue('chartsPerRow')}
                  onChange={(e) => setFieldValue('chartsPerRow', Number(e.target.value))}
                >
                  {CHARTS_PER_ROW_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Chart height */}
              <label className="eins-label">Grafik-Höhe:</label>
              <div className="eins-select-wrap">
                <select
                  className="eins-select"
                  value={getEffectiveValue('chartHeight')}
                  onChange={(e) => setFieldValue('chartHeight', Number(e.target.value))}
                >
                  {CHART_HEIGHT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Line width */}
              <label className="eins-label">Grafik-Linie:</label>
              <div className="eins-select-wrap">
                <select
                  className="eins-select"
                  value={getEffectiveValue('lineWidth') ?? 2}
                  onChange={(e) => setFieldValue('lineWidth', Number(e.target.value))}
                >
                  {LINE_WIDTH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── Sicherheit ──────────────────────────────────────────────── */}
          {activeTab === 'sicherheit' && (
            <div className="eins-section">
              <h3 className="eins-section-title">Passwort ändern</h3>
              <form className="eins-form" onSubmit={handlePasswordSubmit} noValidate>
                <label className="eins-label">
                  Aktuelles Passwort
                  <input
                    className="eins-input"
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="Aktuelles Passwort"
                    disabled={pwdLoading}
                  />
                </label>

                <label className="eins-label">
                  Neues Passwort <span className="eins-hint-inline">(mind. 8 Zeichen)</span>
                  <input
                    className="eins-input"
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="Neues Passwort"
                    disabled={pwdLoading}
                  />
                </label>

                <label className="eins-label">
                  Passwort bestätigen
                  <input
                    className="eins-input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Passwort wiederholen"
                    disabled={pwdLoading}
                  />
                </label>

                {pwdMessage && (
                  <p className={`eins-message eins-message--${pwdMessage.type}`}>{pwdMessage.text}</p>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="eins-footer">
          {activeTab === 'grafiken' ? (
            <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
              <button className="eins-btn eins-btn--secondary" onClick={handleClose} style={{ flex: 1, margin: 0 }}>
                Abbrechen
              </button>
              <button className="eins-btn eins-btn--primary" onClick={handleSaveGraphSettings} style={{ flex: 1, margin: 0 }}>
                Speichern
              </button>
            </div>          ) : activeTab === 'sicherheit' ? (
            <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
              <button className="eins-btn eins-btn--secondary" onClick={handleClose} style={{ flex: 1, margin: 0 }}>
                Schließen
              </button>
              <button type="submit" className="eins-btn eins-btn--primary" onClick={handlePasswordSubmit} style={{ flex: 1, margin: 0 }} disabled={pwdLoading}>
                {pwdLoading ? <span className="eins-spinner" /> : 'Passwort ändern'}
              </button>
            </div>          ) : (
            <button className="eins-btn eins-btn--secondary eins-btn--full" onClick={handleClose} style={{ margin: 0 }}>
              Schließen
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
