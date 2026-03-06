import { useState, useEffect } from 'react'

/**
 * Hook for fetching data from the backend API
 * 
 * Handles:
 * - Making API requests with authentication
 * - Loading states
 * - Error handling
 * - Caching (optional)
 */
export function useLänderData(endpoint, filters) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Build query parameters
        const params = new URLSearchParams()
        params.append('regions', filters.regions.join(','))
        
        if (filters.startDate) params.append('start_date', filters.startDate)
        if (filters.endDate) params.append('end_date', filters.endDate)
        
        params.append('lookback', filters.lookback)
        
        // Add currency for equity endpoint only
        if (endpoint.includes('equity')) {
          params.append('currency', filters.currency)
        }

        // Get token from localStorage (set from login)
        const token = localStorage.getItem('auth_token')
        
        const headers = {
          'Content-Type': 'application/json'
        }
        
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        
        const response = await fetch(`/api${endpoint}?${params.toString()}`, {
          headers
        })

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const result = await response.json()
        
        if (result.error) {
          throw new Error(result.error)
        }

        setData(result)
      } catch (err) {
        setError(err.message)
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    // Debounce API calls to avoid too many requests
    const timeout = setTimeout(fetchData, 300)
    return () => clearTimeout(timeout)
  }, [endpoint, filters])

  return { data, loading, error }
}

export default useLänderData
