import { useState } from 'react'
import logoUrl from '../assets/texlag-logo.avif'

const RULES = [
  { id: 'len',     label: 'Minimum 8 characters',           test: p => p.length >= 8 },
  { id: 'upper',   label: 'At least one uppercase letter',  test: p => /[A-Z]/.test(p) },
  { id: 'number',  label: 'At least one number',            test: p => /[0-9]/.test(p) },
  { id: 'special', label: 'At least one special character', test: p => /[^A-Za-z0-9]/.test(p) },
]

export default function ForgotPasswordPage({ onBack, onSuccess }) {
  // Step 1: email → request code
  // Step 2: code + new password → reset
  const [step,         setStep]         = useState(1)
  const [email,        setEmail]        = useState('')
  const [code,         setCode]         = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const checks    = RULES.map(r => ({ ...r, passed: r.test(password) }))
  const allPassed = checks.every(c => c.passed)

  // ── Step 1: send reset code ────────────────────────────────────────────────
  async function handleRequestCode(e) {
    e.preventDefault()
    if (!email.trim()) return setError('Enter your email address.')
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'forgot-password', email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setStep(2)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: verify code + set new password ────────────────────────────────
  async function handleResetPassword(e) {
    e.preventDefault()
    if (!code.trim())  return setError('Enter the 6-digit reset code.')
    if (!allPassed)    return setError('Password does not meet all requirements.')
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'reset-password',
          email:       email.trim(),
          code:        code.trim(),
          newPassword: password,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Signal the parent (LoginPage) to show a success message and return to login
      onSuccess('Password reset successfully. You can now sign in.')
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

        {/* Step indicator */}
        <div className="cpw-heading">
          <h2 className="cpw-title">
            {step === 1 ? 'Reset Password' : 'Set New Password'}
          </h2>
          <p className="cpw-sub">
            {step === 1
              ? 'Enter your email address and we\'ll send you a 6-digit reset code.'
              : `A reset code was sent to ${email}. Enter it below along with your new password.`}
          </p>
        </div>

        {/* Step progress */}
        <div className="fp-steps">
          <div className={`fp-step ${step >= 1 ? 'fp-step--active' : ''}`}>
            <span className="fp-step__dot">{step > 1 ? '✓' : '1'}</span>
            <span className="fp-step__label">Request Code</span>
          </div>
          <div className="fp-step-line" />
          <div className={`fp-step ${step >= 2 ? 'fp-step--active' : ''}`}>
            <span className="fp-step__dot">2</span>
            <span className="fp-step__label">Set Password</span>
          </div>
        </div>

        {error && <div className="banner banner--error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ── Step 1 form ──────────────────────────────────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleRequestCode} noValidate>
            <div className="field">
              <label className="label" htmlFor="fp-email">
                Email address <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id="fp-email"
                className="input"
                type="email"
                placeholder="you@texlag.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                autoComplete="email"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn--primary btn--full"
              style={{ marginTop: 20 }}
              disabled={loading}
            >
              {loading ? <><span className="spinner" />Sending code…</> : 'Send Reset Code'}
            </button>
          </form>
        )}

        {/* ── Step 2 form ──────────────────────────────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleResetPassword} noValidate>

            <div className="field">
              <label className="label" htmlFor="fp-code">
                Reset Code <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id="fp-code"
                className="input fp-code-input"
                type="text"
                inputMode="numeric"
                placeholder="_ _ _ _ _ _"
                maxLength={6}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
                autoFocus
                autoComplete="one-time-code"
                required
              />
              <span className="hint">Check your inbox for the 6-digit code. It expires in 15 minutes.</span>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label className="label" htmlFor="fp-password">
                New Password <span className="req" aria-hidden="true">*</span>
              </label>
              <div className="input-reveal-wrap">
                <input
                  id="fp-password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
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
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    ) : (
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
              disabled={loading || !allPassed || code.length < 6}
            >
              {loading ? <><span className="spinner" />Resetting…</> : 'Reset Password'}
            </button>

            <button
              type="button"
              className="fp-resend-btn"
              onClick={() => { setStep(1); setCode(''); setPassword(''); setError('') }}
            >
              Didn't receive a code? Try again
            </button>
          </form>
        )}

        {/* Back to login */}
        <button type="button" className="cpw-signout" onClick={onBack}>
          ← Back to Sign In
        </button>

      </div>
    </div>
  )
}
