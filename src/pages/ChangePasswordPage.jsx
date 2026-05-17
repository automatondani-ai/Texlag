import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import logoUrl from '../assets/texlag-logo.avif'

const RULES = [
  { id: 'len',     label: 'Minimum 8 characters',          test: p => p.length >= 8 },
  { id: 'upper',   label: 'At least one uppercase letter', test: p => /[A-Z]/.test(p) },
  { id: 'number',  label: 'At least one number',           test: p => /[0-9]/.test(p) },
  { id: 'special', label: 'At least one special character',test: p => /[^A-Za-z0-9]/.test(p) },
]

export default function ChangePasswordPage() {
  const { getToken, clearPasswordFlag, logout } = useAuth()

  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const checks   = RULES.map(r => ({ ...r, passed: r.test(password) }))
  const allPassed = checks.every(c => c.passed)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!allPassed) return
    setError('')
    setLoading(true)

    try {
      const res  = await fetch('/api/auth/change-password', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ newPassword: password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      // Unblock the portal — App.jsx re-renders and shows DriverPortal
      clearPasswordFlag()
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

        {/* Heading */}
        <div className="cpw-heading">
          <h2 className="cpw-title">Set Your Password</h2>
          <p className="cpw-sub">
            Your account was created with a temporary password. You must set a
            new password before accessing the portal.
          </p>
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>

          {/* New password field */}
          <div className="field">
            <label className="label" htmlFor="new-password">
              New Password <span className="req" aria-hidden="true">*</span>
            </label>
            <div className="input-reveal-wrap">
              <input
                id="new-password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoFocus
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Live checklist */}
          <ul className="pw-checklist" aria-label="Password requirements">
            {checks.map(c => (
              <li key={c.id} className={`pw-check${c.passed ? ' pw-check--ok' : ''}`}>
                <span className="pw-check__icon" aria-hidden="true">
                  {c.passed ? (
                    /* checkmark */
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    /* circle */
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="9"/>
                    </svg>
                  )}
                </span>
                {c.label}
              </li>
            ))}
          </ul>

          <button
            type="submit"
            className="btn btn--primary btn--full"
            style={{ marginTop: 20 }}
            disabled={loading || !allPassed}
          >
            {loading ? <><span className="spinner" />Saving…</> : 'Set Password & Continue'}
          </button>

        </form>

        {/* Sign out link — only way to leave this screen */}
        <button type="button" className="cpw-signout" onClick={logout}>
          Sign out
        </button>

      </div>
    </div>
  )
}
