import { createContext, useContext, useState, useCallback } from 'react'

const TOKEN_KEY = 'texlag_token'

/**
 * Decode a JWT payload without verifying the signature.
 * The server verifies the signature on every API call; the client only
 * needs the claims to drive UI decisions.
 * Returns null if the token is malformed or expired.
 */
function decodeJWT(token) {
  try {
    const b64     = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64))
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    return token ? decodeJWT(token) : null
  })

  /** Store a fresh token and derive user state from it. */
  const login = useCallback((token) => {
    localStorage.setItem(TOKEN_KEY, token)
    setUser(decodeJWT(token))
  }, [])

  /** Clear the token and sign the user out. */
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  /** Return the raw token string for use in Authorization headers. */
  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), [])

  return (
    <AuthContext.Provider value={{ user, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
