import { useState } from 'react'
import './Sidebar.css'

function Sidebar({ onPageChange }) {
  const [activeItem, setActiveItem] = useState('Länder')

  const menuItems = [
    { name: 'Länder', icon: '🌍' },
    { name: 'Faktoren', icon: '📊' },
    { name: 'Sektoren', icon: '🏢' },
    { name: 'Portfolios', icon: '💼' },
    { name: 'Data', icon: '📈' },
    { name: 'Anleihen', icon: '📝' },
    { name: 'DuoPlus', icon: '⚡' },
    { name: 'Alternative', icon: '🔄' },
    { name: 'User', icon: '👤' },
  ]

  const bottomItems = [
    { name: 'PPTX (0)', icon: '📊', color: '#ff6b6b' },
    { name: 'Excel (0)', icon: '📗', color: '#51cf66' },
  ]

  const footerItems = [
    { name: 'Einstellungen', icon: '⚙️' },
    { name: 'Feedback', icon: '💬' },
    { name: 'Abmelden', icon: '🚪' },
  ]

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
              className={`menu-item ${activeItem === item.name ? 'active' : ''}`}
              onClick={() => {
                setActiveItem(item.name)
                if (onPageChange) onPageChange(item.name)
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span className="menu-label">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="bottom-buttons">
            {bottomItems.map((item) => (
              <button key={item.name} className="bottom-button" style={{ backgroundColor: item.color }}>
                <span className="button-icon">{item.icon}</span>
                <span className="button-label">{item.name}</span>
              </button>
            ))}
          </div>

          <div className="divider"></div>

          <div className="footer-items">
            {footerItems.map((item) => (
              <button key={item.name} className="footer-item">
                <span className="footer-icon">{item.icon}</span>
                <span className="footer-label">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
