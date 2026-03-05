import { useState, useEffect } from 'react'
import axios from 'axios'
import './FeedbackModal.css'

const API_BASE = 'http://localhost:8000'

const PAGE_OPTIONS = [
  { label: '💬 Allgemein',   value: 'Allgemein' },
  { label: '🌍 Länder',      value: 'Länder' },
  { label: '📊 Faktoren',    value: 'Faktoren' },
  { label: '🏢 Sektoren',    value: 'Sektoren' },
  { label: '💼 Portfolios',  value: 'Portfolios' },
  { label: '📈 Data',        value: 'Data' },
  { label: '📝 Anleihen',    value: 'Anleihen' },
  { label: '⚡ DuoPlus',     value: 'DuoPlus' },
  { label: '🔄 Alternative', value: 'Alternative' },
]

const TYPE_OPTIONS = [
  { label: '🐛 Fehler (Bug)',           value: 'Bug' },
  { label: '💡 Wunsch (Feature)',       value: 'Feature Request' },
  { label: '💬 Allgemeines Feedback',   value: 'General Feedback' },
  { label: '❓ Sonstiges',              value: 'Other' },
]

const MAX_CHARS = 2000

export default function FeedbackModal({ isOpen, onClose, currentPage }) {
  const [page, setPage]           = useState('')
  const [feedbackType, setType]   = useState('')
  const [text, setText]           = useState('')
  const [errors, setErrors]       = useState({})
  const [loading, setLoading]     = useState(false)
  const [success, setSuccess]     = useState(false)

  // Auto-populate page when modal opens
  useEffect(() => {
    if (isOpen) {
      const matched = PAGE_OPTIONS.find(o => o.value === currentPage)
      setPage(matched ? matched.value : 'Allgemein')
      setType('')
      setText('')
      setErrors({})
      setSuccess(false)
    }
  }, [isOpen, currentPage])

  if (!isOpen) return null

  const validate = () => {
    const e = {}
    if (!page)              e.page = '❌ Bitte wähle eine Seite aus'
    if (!feedbackType)      e.type = '❌ Bitte wähle einen Feedback-Typ aus'
    if (!text.trim())       e.text = '❌ Bitte füge eine Nachricht hinzu'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setLoading(true)
    try {
      const token = localStorage.getItem('authToken')
      await axios.post(
        `${API_BASE}/api/feedback/submit`,
        { page, feedback_type: feedbackType, feedback_text: text.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 1800)
    } catch (err) {
      setErrors({ submit: err.response?.data?.detail ?? 'Fehler beim Senden. Bitte erneut versuchen.' })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) onClose()
  }

  return (
    <div className="feedback-overlay" onClick={handleClose}>
      <div className="feedback-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="feedback-header">
          <div className="feedback-header-title">
            <span className="feedback-header-icon">💬</span>
            <span>Feedback geben</span>
          </div>
          <button className="feedback-close-btn" onClick={handleClose} disabled={loading}>✕</button>
        </div>

        {/* Body */}
        <div className="feedback-body">

          {success ? (
            <div className="feedback-success">
              <span className="feedback-success-icon">✅</span>
              <p>Vielen Dank für Ihr Feedback!<br />Es wurde erfolgreich übermittelt.</p>
            </div>
          ) : (
            <>
              <div className="feedback-hint">
                ℹ️ Hi, ich bin Kevin, der Praktikant. Bitte hinterlasse Dein Feedback — ich hab meinem Chef versprochen, dieses Mal nicht zu weinen.
              </div>

              {/* Page */}
              <div className="feedback-field">
                <label className="feedback-label">Seite:</label>
                <select
                  className={`feedback-select ${errors.page ? 'feedback-select--error' : ''}`}
                  value={page}
                  onChange={e => { setPage(e.target.value); setErrors(prev => ({ ...prev, page: '' })) }}
                >
                  <option value="" disabled>Bitte Seite auswählen...</option>
                  {PAGE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {errors.page && <span className="feedback-error">{errors.page}</span>}
              </div>

              {/* Type */}
              <div className="feedback-field">
                <label className="feedback-label">Feedback-Typ:</label>
                <select
                  className={`feedback-select ${errors.type ? 'feedback-select--error' : ''}`}
                  value={feedbackType}
                  onChange={e => { setType(e.target.value); setErrors(prev => ({ ...prev, type: '' })) }}
                >
                  <option value="" disabled>Typ auswählen...</option>
                  {TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {errors.type && <span className="feedback-error">{errors.type}</span>}
              </div>

              {/* Text */}
              <div className="feedback-field">
                <label className="feedback-label">Ihre Nachricht:</label>
                <textarea
                  className={`feedback-textarea ${errors.text ? 'feedback-textarea--error' : ''}`}
                  value={text}
                  maxLength={MAX_CHARS}
                  onChange={e => { setText(e.target.value); setErrors(prev => ({ ...prev, text: '' })) }}
                  placeholder="Beschreiben Sie Ihr Feedback..."
                />
                <div className="feedback-charcount">{text.length}/{MAX_CHARS}</div>
                {errors.text && <span className="feedback-error">{errors.text}</span>}
              </div>

              {errors.submit && (
                <div className="feedback-error feedback-error--submit">{errors.submit}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="feedback-footer">
            <button
              className="feedback-btn feedback-btn--submit"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Wird gesendet...' : '📤 Feedback absenden'}
            </button>
            <button
              className="feedback-btn feedback-btn--cancel"
              onClick={handleClose}
              disabled={loading}
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
