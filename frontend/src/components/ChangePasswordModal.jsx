import { useState } from 'react'
import axios from 'axios'
import './ChangePasswordModal.css'

const API_BASE = 'http://localhost:8000'

export default function ChangePasswordModal({ isOpen, onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState(null) // { type: 'success'|'error', text: string }
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleClose = () => {
    setCurrent(''); setNext(''); setConfirm(''); setMessage(null)
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage(null)

    if (!current || !next || !confirm) {
      setMessage({ type: 'error', text: 'Bitte alle Felder ausfüllen' })
      return
    }
    if (next !== confirm) {
      setMessage({ type: 'error', text: 'Passwörter stimmen nicht überein' })
      return
    }
    if (next.length < 8) {
      setMessage({ type: 'error', text: 'Passwort muss mindestens 8 Zeichen lang sein' })
      return
    }

    setLoading(true)
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/change-password`, {
        current_password: current,
        new_password: next,
        confirm_password: confirm,
      })
      setMessage({ type: 'success', text: data.message })
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      const msg = err.response?.data?.detail ?? 'Passwortänderung fehlgeschlagen'
      setMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cpwd-overlay" onClick={handleClose}>
      <div className="cpwd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cpwd-header">
          <h2 className="cpwd-title">Passwort ändern</h2>
          <button className="cpwd-close" onClick={handleClose} aria-label="Schließen">✕</button>
        </div>

        <form className="cpwd-form" onSubmit={handleSubmit} noValidate>
          <label className="cpwd-label">
            Aktuelles Passwort
            <input
              className="cpwd-input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Aktuelles Passwort"
              disabled={loading}
            />
          </label>

          <label className="cpwd-label">
            Neues Passwort <span className="cpwd-hint">(mind. 8 Zeichen)</span>
            <input
              className="cpwd-input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="Neues Passwort"
              disabled={loading}
            />
          </label>

          <label className="cpwd-label">
            Passwort bestätigen
            <input
              className="cpwd-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Passwort wiederholen"
              disabled={loading}
            />
          </label>

          {message && (
            <p className={`cpwd-message cpwd-message--${message.type}`}>{message.text}</p>
          )}

          <div className="cpwd-footer">
            <button type="button" className="cpwd-btn cpwd-btn--secondary" onClick={handleClose}>
              Abbrechen
            </button>
            <button type="submit" className="cpwd-btn cpwd-btn--primary" disabled={loading}>
              {loading ? <span className="cpwd-spinner" /> : 'Ändern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
