import { createContext, useContext, useState, useCallback } from 'react'

const TOKEN_KEY = 'texlag_token'
const MCP_KEY   = 'texlag_mcp'   // mustChangePassword

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

  const [mustChangePassword, setMustChangePassword] = useState(
    () => localStorage.getItem(MCP_KEY) === 'true'
  )

  /** Store a fresh token and the mustChangePassword flag. */
  const login = useCallback((token, mustChange = false) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(MCP_KEY, String(mustChange))
    setUser(decodeJWT(token))
    setMustChangePassword(mustChange)
  }, [])

  /** Clear the token and sign the user out. */
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(MCP_KEY)
    setUser(null)
    setMustChangePassword(false)
  }, [])

  /** Called after a successful password change — unblocks the portal. */
  const clearPasswordFlag = useCallback(() => {
    localStorage.setItem(MCP_KEY, 'false')
    setMustChangePassword(false)
  }, [])

  /** Return the raw token string for use in Authorization headers. */
  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), [])

  return (
    <AuthContext.Provider value={{ user, login, logout, getToken, mustChangePassword, clearPasswordFlag }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
