import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import logoUrl from '../assets/texlag-logo.avif'

export default function LoginPage() {
  const { login } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [showPassword, setShowPassword] = useState(false)

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
          <img src={logoUrl} alt="TexLag Express" className="login-brand__logo" />
          <div className="login-brand__text">
            <div className="login-brand__name">TexLag Express</div>
            <div className="login-brand__sub">America's Leading Transportation Company.</div>
            <div className="login-brand__creds">USDOT: 3609656 | MC-1229052 | +1(832)-944-5199</div>
          </div>
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <p className="form-legend"><span aria-hidden="true">*</span> Required field</p>

          <div className="field">
            <label className="label" htmlFor="email">Email address <span className="req" aria-hidden="true">*</span></label>
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
            <label className="label" htmlFor="password">Password <span className="req" aria-hidden="true">*</span></label>
            <div className="input-reveal-wrap">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  /* eye-off */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  /* eye */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
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
