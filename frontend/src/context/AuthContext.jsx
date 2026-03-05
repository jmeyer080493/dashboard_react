/**
 * AuthContext – global authentication state for Dashboard V3.
 *
 * Stores the JWT and user data in localStorage so the session survives
 * a page reload. All API calls that need auth should read `token` from
 * this context and attach it as  Authorization: Bearer <token>.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API_BASE = 'http://localhost:8000'
const STORAGE_KEY = 'dashboard_auth'

const AuthContext = createContext(null)

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Discard if the JWT expiry timestamp has passed
    if (parsed.exp && Date.now() / 1000 > parsed.exp) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => loadStoredAuth())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Decoded JWT payload helpers
  const isAuthenticated = Boolean(auth?.token)
  const user = auth?.user ?? null
  const token = auth?.token ?? null
  // permissions is an array of strings like ['countries', 'factors', ...]
  const permissions = auth?.user?.permissions ?? []

  // Attach / remove the Authorization header for every axios call automatically
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common['Authorization']
    }
  }, [token])

  const login = useCallback(async (username, password, rememberMe = false) => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/login`, {
        username,
        password,
        remember_me: rememberMe,
      })

      // Decode exp from the JWT payload (middle part)
      let exp = null
      try {
        const payload = JSON.parse(atob(data.access_token.split('.')[1]))
        exp = payload.exp
      } catch { /* ignore */ }

      const authData = { token: data.access_token, user: data.user, exp }
      setAuth(authData)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authData))
      return { success: true }
    } catch (err) {
      const msg =
        err.response?.data?.detail ??
        err.response?.data?.message ??
        'Anmeldung fehlgeschlagen'
      setError(msg)
      return { success: false, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      if (token) {
        await axios.post(`${API_BASE}/api/auth/logout`).catch(() => {/* ignore */})
      }
    } finally {
      setAuth(null)
      localStorage.removeItem(STORAGE_KEY)
      delete axios.defaults.headers.common['Authorization']
    }
  }, [token])

  const clearError = useCallback(() => setError(null), [])

  /** Convenience: check if user has a specific permission */
  const hasPermission = useCallback(
    (perm) => permissions.includes(perm),
    [permissions]
  )

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, token, permissions, hasPermission, loading, error, login, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
