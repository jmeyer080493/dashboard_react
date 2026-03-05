import { useState } from 'react'
import { useExport } from './context/ExportContext'
import { useAuth } from './context/AuthContext'
import './Sidebar.css'

/**
 * Maps sidebar page names to the permission string stored in role_permissions.
 * Pages with no entry are always visible (e.g. pages the whole org uses).
 */
const PAGE_PERMISSIONS = {
  'Länder':      'countries',
  'Faktoren':    'factors',
  'Sektoren':    'sectors',
  'Portfolios':  'portfolios',
  'Data':        'data',
  'Anleihen':    'anleihen',
  'DuoPlus':     'duoplus',
  'Alternative': 'extras',
  'User':        'user',
}

function Sidebar({ onPageChange, onLogout, onOpenEinstellungen, onOpenFeedback, userHasAlerts, dataHasAlerts }) {
  const { user, permissions } = useAuth()
  const [activeItem, setActiveItem] = useState(null)   // set on first permitted nav
  const {
    pptxItems, xlsxItems,
    setPptxModalOpen, setXlsxModalOpen,
    clearPptx, clearXlsx,
  } = useExport()

  const allMenuItems = [
    { name: 'Länder',      icon: '🌍' },
    { name: 'Faktoren',    icon: '📊' },
    { name: 'Sektoren',    icon: '🏢' },
    { name: 'Portfolios',  icon: '💼' },
    { name: 'Data',        icon: '📈' },
    { name: 'Anleihen',    icon: '📝' },
    { name: 'DuoPlus',     icon: '⚡' },
    { name: 'Alternative', icon: '🔄' },
    { name: 'User',        icon: '👤' },
  ]

  // Only show items the user has permission for (or items with no permission requirement)
  const menuItems = allMenuItems.filter((item) => {
    const required = PAGE_PERMISSIONS[item.name]
    return !required || permissions.includes(required)
  })

  // Default to first permitted page if none active yet
  const effectiveActive = activeItem ?? menuItems[0]?.name

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>APO</h1>
        <div className="divider"></div>
      </div>

      <nav className="sidebar-nav">
        <div className="menu-items">
          {menuItems.map((item) => (
            <button
              key={item.name}
              className={[
                'menu-item',
                effectiveActive === item.name ? 'active' : '',
                item.name === 'User' && userHasAlerts ? 'menu-item--alert' : '',
                item.name === 'Data' && dataHasAlerts ? 'menu-item--alert' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => {
                setActiveItem(item.name)
                if (onPageChange) onPageChange(item.name)
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span className="menu-label">{item.name}</span>
              {item.name === 'User' && userHasAlerts && (
                <span className="menu-alert-dot" title="Aktive Alerts">●</span>
              )}
              {item.name === 'Data' && dataHasAlerts && (
                <span className="menu-alert-dot" title="Data Freshness Alerts">●</span>
              )}
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="bottom-buttons">
            <div className="bottom-button-row">
              <button
                className="bottom-button"
                style={{ backgroundColor: '#c0392b', flex: 1 }}
                onClick={() => setPptxModalOpen(true)}
              >
                <span className="button-icon">📊</span>
                <span className="button-label">PPTX ({pptxItems.length})</span>
              </button>
              {pptxItems.length > 0 && (
                <button className="bottom-button-clear" onClick={clearPptx} title="Liste leeren">✕</button>
              )}
            </div>
            <div className="bottom-button-row">
              <button
                className="bottom-button"
                style={{ backgroundColor: '#198754', flex: 1 }}
                onClick={() => setXlsxModalOpen(true)}
              >
                <span className="button-icon">📗</span>
                <span className="button-label">Excel ({xlsxItems.length})</span>
              </button>
              {xlsxItems.length > 0 && (
                <button className="bottom-button-clear" onClick={clearXlsx} title="Liste leeren">✕</button>
              )}
            </div>
          </div>

          <div className="divider"></div>

          {/* User info */}
          {user && (
            <div className="sidebar-user">
              <span className="sidebar-user-icon">👤</span>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{user.username}</span>
                <span className="sidebar-user-role">{user.role_name}</span>
              </div>
            </div>
          )}

          <div className="footer-items">
            <button className="footer-item" onClick={onOpenEinstellungen}>
              <span className="footer-icon">⚙️</span>
              <span className="footer-label">Einstellungen</span>
            </button>
            <button className="footer-item" onClick={onOpenFeedback}>
              <span className="footer-icon">💬</span>
              <span className="footer-label">Feedback</span>
            </button>
            <button className="footer-item footer-item--logout" onClick={onLogout}>
              <span className="footer-icon">🚪</span>
              <span className="footer-label">Abmelden</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
