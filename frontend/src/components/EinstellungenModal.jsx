import { useState, useEffect } from 'react'
import axios from 'axios'
import { useTheme } from '../context/ThemeContext'
import './EinstellungenModal.css'

const API_BASE = 'http://localhost:8000'

const LÄNDER_TABS = [
  { value: 'all',    label: 'Alle' },
  { value: 'equity', label: 'Aktien' },
  { value: 'fi',     label: 'Anleihen' },
  { value: 'macro',  label: 'Makro' },
]

const CHARTS_PER_ROW_OPTIONS = [
  { value: 1, label: '1 Grafik pro Zeile' },
  { value: 2, label: '2 Grafiken pro Zeile' },
  { value: 3, label: '3 Grafiken pro Zeile' },
  { value: 4, label: '4 Grafiken pro Zeile' },
]

const CHART_HEIGHT_OPTIONS = [
  { value: 300, label: 'Klein (300px)' },
  { value: 450, label: 'Mittel (450px)' },
  { value: 650, label: 'Groß (650px)' },
]

export default function EinstellungenModal({ isOpen, onClose, graphSettings, onSaveSettings }) {
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState('grafiken')
  const [activeLänderTab, setActiveLänderTab] = useState('all')

  // Draft state for graph settings (edited before save)
  const [draft, setDraft] = useState(graphSettings)

  // Password change state
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwdMessage, setPwdMessage] = useState(null)
  const [pwdLoading, setPwdLoading] = useState(false)

  // Sync draft when modal opens or graphSettings changes
  useEffect(() => {
    if (isOpen) {
      setDraft(graphSettings)
    }
  }, [isOpen, graphSettings])

  if (!isOpen) return null

  const handleClose = () => {
    // Reset password fields on close
    setCurrent(''); setNext(''); setConfirm(''); setPwdMessage(null)
    onClose()
  }

  // ── Graph settings helpers ───────────────────────────────────────────────

  const getEffectiveValue = (field) => {
    if (activeLänderTab === 'all') {
      // Show equity value as representative (all are the same when set via "Alle")
      return draft.equity[field]
    }
    return draft[activeLänderTab][field]
  }

  const setFieldValue = (field, value) => {
    if (activeLänderTab === 'all') {
      setDraft(prev => ({
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
              <div className="eins-btn-group" style={{ marginTop: '0.25rem' }}>
                <button
                  className={`eins-theme-btn ${theme === 'light' ? 'eins-theme-btn--active' : ''}`}
                  onClick={() => setTheme('light')}
                >
                  ☀️ Hell
                </button>
                <button
                  className={`eins-theme-btn ${theme === 'dark' ? 'eins-theme-btn--active' : ''}`}
                  onClick={() => setTheme('dark')}
                >
                  🌙 Dunkel
                </button>
              </div>
            </div>
          )}

          {/* ── Grafiken ────────────────────────────────────────────────── */}
          {activeTab === 'grafiken' && (
            <div className="eins-section">
              <h3 className="eins-section-title">Layout – Länder</h3>

              {/* Tab selector */}
              <label className="eins-label">Anwenden auf:</label>
              <div className="eins-btn-group eins-btn-group--tabs">
                {LÄNDER_TABS.map(t => (
                  <button
                    key={t.value}
                    className={`eins-tab-sel-btn ${activeLänderTab === t.value ? 'eins-tab-sel-btn--active' : ''}`}
                    onClick={() => setActiveLänderTab(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Graphs per row */}
              <label className="eins-label">Grafiken pro Zeile:</label>
              <div className="eins-btn-group">
                {CHARTS_PER_ROW_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`eins-option-btn ${getEffectiveValue('chartsPerRow') === opt.value ? 'eins-option-btn--active' : ''}`}
                    onClick={() => setFieldValue('chartsPerRow', opt.value)}
                  >
                    {opt.value}
                  </button>
                ))}
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

                <button type="submit" className="eins-btn eins-btn--primary eins-btn--full" disabled={pwdLoading}>
                  {pwdLoading ? <span className="eins-spinner" /> : 'Passwort ändern'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="eins-footer">
          {activeTab === 'grafiken' ? (
            <>
              <button className="eins-btn eins-btn--secondary" onClick={handleClose}>
                Abbrechen
              </button>
              <button className="eins-btn eins-btn--primary" onClick={handleSaveGraphSettings}>
                Speichern
              </button>
            </>
          ) : (
            <button className="eins-btn eins-btn--secondary eins-btn--full" onClick={handleClose}>
              Schließen
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
