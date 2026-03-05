import { useState } from 'react'
import axios from 'axios'
import { useExport } from '../context/ExportContext'
import './ExportModal.css'

// ────────────────────────────────────────────────────────────────────────────
// Shared queue item row  (group input + remove button)
// ────────────────────────────────────────────────────────────────────────────
function QueueItem({ item, groupLabel, onGroupChange, onRemove }) {
  return (
    <div className="export-queue-item">
      <span className="export-queue-item-icon">📈</span>
      <div className="export-queue-item-info">
        <span className="export-queue-item-title">{item.title}</span>
        <span className="export-queue-item-meta">
          {item.regions?.join(', ')}
        </span>
      </div>
      <div className="export-queue-item-controls">
        <label className="export-queue-group-label">{groupLabel}</label>
        <input
          type="number"
          min={1}
          value={item.group}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= 1) onGroupChange(item.id, v)
          }}
          className="export-queue-group-input"
        />
        <button
          className="export-queue-item-remove"
          onClick={() => onRemove(item.id)}
          title="Entfernen"
        >
          &#x2715;
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// PPTX Modal
// ────────────────────────────────────────────────────────────────────────────
export function PptxModal() {
  const {
    pptxItems, pptxModalOpen, setPptxModalOpen,
    removeFromPptx, clearPptx, updatePptxGroup,
    quickGroupPptx,
  } = useExport()
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  if (!pptxModalOpen) return null

  const handleDownload = async () => {
    if (pptxItems.length === 0) return
    setLoading(true)
    setStatus('')
    try {
      const response = await axios.post(
        'http://localhost:8000/api/export/pptx',
        { items: pptxItems },
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `Dashboard_Export_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pptx`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Datei gespeichert')
    } catch (err) {
      setStatus(`Fehler: ${err.response?.data?.detail || err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="export-modal-overlay" onClick={() => setPptxModalOpen(false)}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-modal-header pptx-header">
          <div className="export-modal-header-title">
            <span className="export-modal-icon">📊</span>
            <span>PowerPoint Export</span>
          </div>
          <button className="export-modal-close" onClick={() => setPptxModalOpen(false)}>&#x2715;</button>
        </div>

        {/* Body */}
        <div className="export-modal-body">
          {/* Quick layout section */}
          <div className="export-quick-section">
            <span className="export-quick-label">Diagramme pro Folie:</span>
            <div className="export-quick-buttons">
              <button className="export-quick-btn pptx" onClick={() => quickGroupPptx(1)}>1</button>
              <button className="export-quick-btn pptx" onClick={() => quickGroupPptx(2)}>2</button>
              <button className="export-quick-btn pptx" onClick={() => quickGroupPptx(4)}>4</button>
            </div>
          </div>

          <div className="export-modal-count-row">
            <span className="export-modal-label">Ausgewählte Diagramme</span>
            <span className="export-modal-badge pptx-badge">{pptxItems.length}</span>
          </div>

          <div className="export-queue-list">
            {pptxItems.length === 0 ? (
              <div className="export-queue-empty">
                Keine Diagramme ausgewählt.<br />
                Klicken Sie auf den 📊-Button unter einem Diagramm.
              </div>
            ) : (
              pptxItems.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  groupLabel="Folie"
                  onGroupChange={updatePptxGroup}
                  onRemove={removeFromPptx}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="export-modal-footer">
          {status && <span className="export-modal-status">{status}</span>}
          <div className="export-modal-footer-buttons">
            {pptxItems.length > 0 && (
              <button className="export-btn-secondary" onClick={clearPptx}>Alle entfernen</button>
            )}
            <button className="export-btn-secondary" onClick={() => setPptxModalOpen(false)}>Schliessen</button>
            <button
              className="export-btn-primary pptx-btn"
              onClick={handleDownload}
              disabled={pptxItems.length === 0 || loading}
            >
              {loading ? 'Erstellen...' : 'PPTX speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Excel Modal
// ────────────────────────────────────────────────────────────────────────────
export function XlsxModal() {
  const {
    xlsxItems, xlsxModalOpen, setXlsxModalOpen,
    removeFromXlsx, clearXlsx, updateXlsxGroup,
    quickGroupXlsx,
  } = useExport()
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  if (!xlsxModalOpen) return null

  const handleDownload = async () => {
    if (xlsxItems.length === 0) return
    setLoading(true)
    setStatus('')
    try {
      const response = await axios.post(
        'http://localhost:8000/api/export/excel',
        { items: xlsxItems },
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `Dashboard_Export_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Datei gespeichert')
    } catch (err) {
      setStatus(`Fehler: ${err.response?.data?.detail || err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="export-modal-overlay" onClick={() => setXlsxModalOpen(false)}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-modal-header xlsx-header">
          <div className="export-modal-header-title">
            <span className="export-modal-icon">📗</span>
            <span>Excel Export</span>
          </div>
          <button className="export-modal-close" onClick={() => setXlsxModalOpen(false)}>&#x2715;</button>
        </div>

        {/* Body */}
        <div className="export-modal-body">
          {/* Quick layout section */}
          <div className="export-quick-section">
            <span className="export-quick-label">Diagramme pro Blatt:</span>
            <div className="export-quick-buttons">
              <button className="export-quick-btn xlsx" onClick={() => quickGroupXlsx(1)}>1</button>
              <button className="export-quick-btn xlsx" onClick={() => quickGroupXlsx(2)}>2</button>
              <button className="export-quick-btn xlsx" onClick={() => quickGroupXlsx(4)}>4</button>
            </div>
          </div>

          <div className="export-modal-count-row">
            <span className="export-modal-label">Ausgewählte Diagramme</span>
            <span className="export-modal-badge xlsx-badge">{xlsxItems.length}</span>
          </div>

          <div className="export-queue-list">
            {xlsxItems.length === 0 ? (
              <div className="export-queue-empty">
                Keine Diagramme ausgewählt.<br />
                Klicken Sie auf den 📗-Button unter einem Diagramm.
              </div>
            ) : (
              xlsxItems.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  groupLabel="Blatt"
                  onGroupChange={updateXlsxGroup}
                  onRemove={removeFromXlsx}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="export-modal-footer">
          {status && <span className="export-modal-status">{status}</span>}
          <div className="export-modal-footer-buttons">
            {xlsxItems.length > 0 && (
              <button className="export-btn-secondary" onClick={clearXlsx}>Alle entfernen</button>
            )}
            <button className="export-btn-secondary" onClick={() => setXlsxModalOpen(false)}>Schliessen</button>
            <button
              className="export-btn-primary xlsx-btn"
              onClick={handleDownload}
              disabled={xlsxItems.length === 0 || loading}
            >
              {loading ? 'Erstellen...' : 'Excel herunterladen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
