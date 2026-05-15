import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      login(data.token) // triggers re-render in App → routes to portal
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">

        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand__logo">TE</div>
          <div>
            <div className="login-brand__name">TexLag Express</div>
            <div className="login-brand__sub">Freight Brokerage Portal</div>
          </div>
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="email">Email address</label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@texlag.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--full login-submit"
            disabled={loading}
          >
            {loading ? <><span className="spinner" />Signing in…</> : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  )
}
