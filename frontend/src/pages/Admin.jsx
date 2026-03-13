import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './Admin.css'

const API_BASE = 'http://localhost:8000'

// AuthContext already sets axios.defaults.headers.common['Authorization'] on login.
// These are thin wrappers so call-sites look consistent; no custom header needed.
const api = {
  get:    (url)       => axios.get(url),
  post:   (url, data) => axios.post(url, data),
  put:    (url, data) => axios.put(url, data),
  delete: (url)       => axios.delete(url),
}

// All tabs / permission keys in display order
const ALL_PERMISSIONS = [
  { key: 'countries',    label: 'Länder' },
  { key: 'factors',      label: 'Faktoren' },
  { key: 'sectors',      label: 'Sektoren' },
  { key: 'portfolios',   label: 'Portfolios' },
  { key: 'data',         label: 'Data' },
  { key: 'anleihen',     label: 'Anleihen' },
  { key: 'duoplus',      label: 'DuoPlus' },
  { key: 'extras',       label: 'Alternative' },
  { key: 'user',         label: 'User' },
  { key: 'admin',        label: 'Admin' },
]

// ── Small reusable status banner ─────────────────────────────────────────────
function StatusBanner({ status }) {
  if (!status) return null
  return (
    <div className={`admin-banner admin-banner--${status.type}`}>
      {status.message}
    </div>
  )
}

// ── Confirmation dialog ───────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="admin-overlay">
      <div className="admin-dialog">
        <p className="admin-dialog__message">{message}</p>
        <div className="admin-dialog__actions">
          <button className="admin-btn admin-btn--danger" onClick={onConfirm}>Bestätigen</button>
          <button className="admin-btn admin-btn--secondary" onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: Users
// ═══════════════════════════════════════════════════════════════════════════
function UsersTab({ roles }) {
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [status, setStatus]     = useState(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [editRow, setEditRow]   = useState(null)   // user_id being edited inline
  const [confirm, setConfirm]   = useState(null)   // { message, onConfirm }
  const [resetTarget, setResetTarget] = useState(null) // user_id for pwd reset

  // New-user form state
  const [newUser, setNewUser] = useState({ username: '', password: '', role_id: '' })
  const [newPwd, setNewPwd]   = useState('')         // pwd-reset form

  const showStatus = (message, type = 'success') => {
    setStatus({ message, type })
    setTimeout(() => setStatus(null), 4000)
  }

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`${API_BASE}/api/admin/users`)
      setUsers(data)
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler beim Laden der Benutzer', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  // ── Create user ──────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newUser.username.trim() || !newUser.password || !newUser.role_id) {
      showStatus('Bitte alle Felder ausfüllen', 'error'); return
    }
    try {
      await api.post(`${API_BASE}/api/admin/users`, {
        username: newUser.username.trim(),
        password: newUser.password,
        role_id: parseInt(newUser.role_id),
      })
      showStatus(`Benutzer '${newUser.username}' erstellt`)
      setNewUser({ username: '', password: '', role_id: '' })
      setShowAdd(false)
      loadUsers()
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler beim Erstellen', 'error')
    }
  }

  // ── Toggle active ────────────────────────────────────────────────────────
  const handleToggleActive = (user) => {
    const action = user.is_active ? 'deaktivieren' : 'aktivieren'
    setConfirm({
      message: `Benutzer '${user.username}' ${action}?`,
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.put(`${API_BASE}/api/admin/users/${user.user_id}`, {
            is_active: !user.is_active,
          })
          showStatus(`Benutzer ${user.is_active ? 'deaktiviert' : 'aktiviert'}`)
          loadUsers()
        } catch (err) {
          showStatus(err.response?.data?.detail ?? 'Fehler', 'error')
        }
      },
    })
  }

  // ── Update role inline ───────────────────────────────────────────────────
  const handleRoleChange = async (user_id, role_id) => {
    try {
      await api.put(`${API_BASE}/api/admin/users/${user_id}`, { role_id: parseInt(role_id) })
      showStatus('Rolle aktualisiert')
      setEditRow(null)
      loadUsers()
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler', 'error')
    }
  }

  // ── Reset password ───────────────────────────────────────────────────────
  const handleResetPassword = async () => {
    if (!newPwd || newPwd.length < 8) {
      showStatus('Passwort muss mindestens 8 Zeichen lang sein', 'error'); return
    }
    try {
      await api.post(`${API_BASE}/api/admin/users/${resetTarget}/reset-password`, {
        new_password: newPwd,
      })
      showStatus('Passwort zurückgesetzt')
      setResetTarget(null)
      setNewPwd('')
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler', 'error')
    }
  }

  return (
    <div className="admin-section">
      <StatusBanner status={status} />
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="admin-section-header">
        <h2 className="admin-section-title">Benutzerverwaltung</h2>
        <button className="admin-btn admin-btn--primary" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? '✕ Abbrechen' : '＋ Neuer Benutzer'}
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div className="admin-add-form">
          <h3 className="admin-add-title">Neuen Benutzer anlegen</h3>
          <div className="admin-form-row">
            <label className="admin-label">Benutzername</label>
            <input
              className="admin-input"
              value={newUser.username}
              onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
              placeholder="z.B. max.mustermann"
            />
          </div>
          <div className="admin-form-row">
            <label className="admin-label">Passwort</label>
            <input
              className="admin-input"
              type="password"
              value={newUser.password}
              onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
              placeholder="Mindestens 8 Zeichen"
            />
          </div>
          <div className="admin-form-row">
            <label className="admin-label">Rolle</label>
            <select
              className="admin-select"
              value={newUser.role_id}
              onChange={e => setNewUser(p => ({ ...p, role_id: e.target.value }))}
            >
              <option value="">Rolle wählen…</option>
              {roles.map(r => (
                <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
              ))}
            </select>
          </div>
          <div className="admin-form-actions">
            <button className="admin-btn admin-btn--primary" onClick={handleCreate}>
              Benutzer erstellen
            </button>
          </div>
        </div>
      )}

      {/* Password reset modal */}
      {resetTarget && (
        <div className="admin-overlay">
          <div className="admin-dialog">
            <h3 className="admin-dialog__title">
              Passwort zurücksetzen für&nbsp;
              <em>{users.find(u => u.user_id === resetTarget)?.username}</em>
            </h3>
            <input
              className="admin-input"
              type="password"
              placeholder="Neues Passwort (min. 8 Zeichen)"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              autoFocus
            />
            <div className="admin-dialog__actions">
              <button className="admin-btn admin-btn--primary" onClick={handleResetPassword}>
                Zurücksetzen
              </button>
              <button className="admin-btn admin-btn--secondary" onClick={() => { setResetTarget(null); setNewPwd('') }}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User table */}
      {loading ? (
        <div className="admin-loading">Laden…</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Benutzername</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Erstellt</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.user_id} className={!user.is_active ? 'admin-row--inactive' : ''}>
                  <td className="admin-cell--id">{user.user_id}</td>
                  <td>{user.username}</td>
                  <td>
                    {editRow === user.user_id ? (
                      <select
                        className="admin-select admin-select--inline"
                        defaultValue={user.role_id}
                        autoFocus
                        onBlur={e => handleRoleChange(user.user_id, e.target.value)}
                        onChange={e => handleRoleChange(user.user_id, e.target.value)}
                      >
                        {roles.map(r => (
                          <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        className="admin-role-badge"
                        title="Klicken um Rolle zu ändern"
                        onClick={() => setEditRow(user.user_id)}
                      >
                        {user.role_name}
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`admin-status-badge admin-status-badge--${user.is_active ? 'active' : 'inactive'}`}>
                      {user.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="admin-cell--date">
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString('de-DE')
                      : '–'}
                  </td>
                  <td className="admin-cell--actions">
                    <button
                      className="admin-action-btn"
                      title="Passwort zurücksetzen"
                      onClick={() => setResetTarget(user.user_id)}
                    >
                      🔑
                    </button>
                    <button
                      className={`admin-action-btn ${user.is_active ? 'admin-action-btn--warn' : 'admin-action-btn--ok'}`}
                      title={user.is_active ? 'Deaktivieren' : 'Aktivieren'}
                      onClick={() => handleToggleActive(user)}
                    >
                      {user.is_active ? '🚫' : '✅'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: Role permissions matrix
// ═══════════════════════════════════════════════════════════════════════════
function RolesTab({ roles, onRolesChange }) {
  const [permMatrix, setPermMatrix]   = useState({})  // { role_id: Set(perms) }
  const [dirty, setDirty]             = useState({})  // { role_id: true }
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState({})
  const [status, setStatus]           = useState(null)
  const [showNewRole, setShowNewRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')

  const showStatus = (message, type = 'success') => {
    setStatus({ message, type })
    setTimeout(() => setStatus(null), 4000)
  }

  const loadPermissions = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`${API_BASE}/api/admin/roles/permissions`)
      // data is { "1": ["countries", ...], "2": [...], ... }
      const matrix = {}
      Object.entries(data).forEach(([rid, perms]) => {
        matrix[parseInt(rid)] = new Set(perms)
      })
      setPermMatrix(matrix)
      setDirty({})
    } catch (err) {
      showStatus('Fehler beim Laden der Berechtigungen', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPermissions() }, [loadPermissions])

  const togglePerm = (role_id, perm_key) => {
    setPermMatrix(prev => {
      const next = { ...prev }
      const set = new Set(next[role_id] ?? [])
      if (set.has(perm_key)) set.delete(perm_key); else set.add(perm_key)
      next[role_id] = set
      return next
    })
    setDirty(d => ({ ...d, [role_id]: true }))
  }

  const saveRole = async (role_id) => {
    setSaving(s => ({ ...s, [role_id]: true }))
    try {
      const perms = Array.from(permMatrix[role_id] ?? [])
      await api.put(`${API_BASE}/api/admin/roles/${role_id}/permissions`, { permissions: perms })
      showStatus('Berechtigungen gespeichert')
      setDirty(d => { const n = { ...d }; delete n[role_id]; return n })
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler beim Speichern', 'error')
    } finally {
      setSaving(s => { const n = { ...s }; delete n[role_id]; return n })
    }
  }

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) { showStatus('Rollenname darf nicht leer sein', 'error'); return }
    try {
      await api.post(`${API_BASE}/api/admin/roles`, { role_name: newRoleName.trim() })
      showStatus(`Rolle '${newRoleName}' erstellt`)
      setNewRoleName('')
      setShowNewRole(false)
      onRolesChange()   // reload parent roles list
      loadPermissions()
    } catch (err) {
      showStatus(err.response?.data?.detail ?? 'Fehler', 'error')
    }
  }

  return (
    <div className="admin-section">
      <StatusBanner status={status} />

      <div className="admin-section-header">
        <h2 className="admin-section-title">Rollen & Berechtigungen</h2>
        <button className="admin-btn admin-btn--primary" onClick={() => setShowNewRole(v => !v)}>
          {showNewRole ? '✕ Abbrechen' : '＋ Neue Rolle'}
        </button>
      </div>

      {showNewRole && (
        <div className="admin-add-form">
          <h3 className="admin-add-title">Neue Rolle anlegen</h3>
          <div className="admin-form-row">
            <label className="admin-label">Rollenname</label>
            <input
              className="admin-input"
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              placeholder="z.B. analyst"
            />
          </div>
          <div className="admin-form-actions">
            <button className="admin-btn admin-btn--primary" onClick={handleCreateRole}>
              Rolle erstellen
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="admin-loading">Laden…</div>
      ) : (
        <div className="admin-matrix-wrap">
          <p className="admin-matrix-hint">
            Klicken Sie auf eine Zelle, um eine Berechtigung zu aktivieren oder zu deaktivieren.
            Speichern Sie die Änderungen zeilenweise mit dem Button rechts.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--matrix">
              <thead>
                <tr>
                  <th className="admin-th--role">Rolle</th>
                  {ALL_PERMISSIONS.map(p => (
                    <th key={p.key} className="admin-th--perm">
                      <span className="admin-perm-label">{p.label}</span>
                    </th>
                  ))}
                  <th className="admin-th--save">Speichern</th>
                </tr>
              </thead>
              <tbody>
                {roles.map(role => {
                  const rolePerms = permMatrix[role.role_id] ?? new Set()
                  const isDirty = dirty[role.role_id]
                  return (
                    <tr key={role.role_id} className={isDirty ? 'admin-row--dirty' : ''}>
                      <td className="admin-cell--role-name">{role.role_name}</td>
                      {ALL_PERMISSIONS.map(p => {
                        const checked = rolePerms.has(p.key)
                        return (
                          <td
                            key={p.key}
                            className={`admin-cell--check ${checked ? 'admin-cell--on' : 'admin-cell--off'}`}
                            onClick={() => togglePerm(role.role_id, p.key)}
                            title={`${checked ? 'Entfernen' : 'Gewähren'}: ${p.label}`}
                          >
                            {checked ? '✓' : ''}
                          </td>
                        )
                      })}
                      <td className="admin-cell--save-btn">
                        <button
                          className={`admin-btn admin-btn--save ${isDirty ? 'admin-btn--dirty' : ''}`}
                          onClick={() => saveRole(role.role_id)}
                          disabled={!isDirty || saving[role.role_id]}
                        >
                          {saving[role.role_id] ? '…' : 'Speichern'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Admin page
// ═══════════════════════════════════════════════════════════════════════════
export default function Admin() {
  const [activeTab, setActiveTab] = useState('users')
  const [roles, setRoles]         = useState([])
  const [rolesLoading, setRolesLoading] = useState(true)

  const loadRoles = useCallback(async () => {
    setRolesLoading(true)
    try {
      const { data } = await api.get(`${API_BASE}/api/admin/roles`)
      setRoles(data)
    } catch { /* silently ignore */ }
    finally { setRolesLoading(false) }
  }, [])

  useEffect(() => { loadRoles() }, [loadRoles])

  const TABS = [
    { id: 'users',       label: '👥  Benutzer' },
    { id: 'roles',       label: '🔑  Rollen & Berechtigungen' },
  ]

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Administration</h1>
      </div>

      {/* Tab bar */}
      <div className="admin-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`admin-tab-btn ${activeTab === t.id ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-content">
        {rolesLoading ? (
          <div className="admin-loading">Rollen werden geladen…</div>
        ) : activeTab === 'users' ? (
          <UsersTab roles={roles} />
        ) : (
          <RolesTab roles={roles} onRolesChange={loadRoles} />
        )}
      </div>
    </div>
  )
}
