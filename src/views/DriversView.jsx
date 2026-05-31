import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '' }

const fmt = n => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function fmtDate(iso, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  return new Date(iso).toLocaleDateString('en-US', opts)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function dateParts(iso) {
  const d = new Date(iso)
  return isNaN(d) ? null : { year: d.getFullYear(), month: d.getMonth() + 1 }
}

// ── Module-scope pure function (moved from inside DriverProfile) ──────────────
// Builds the same descriptive filename the server-side pdfFilename() helper
// produces so the browser's Save dialog shows the right name.
function quoteFilename(q) {
  const extractCity = addr => {
    if (!addr || typeof addr !== 'string') return null
    const city = addr.split(',')[0].trim()
    return city.length > 0 ? city : null
  }
  const fromCity = extractCity(q.pickup)
  const toCity   = extractCity(
    Array.isArray(q.dropoffs) && q.dropoffs.length > 0
      ? q.dropoffs[q.dropoffs.length - 1]
      : null
  )
  if (fromCity && toCity) {
    const safe = s => s.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')
    return `TexLag-Quote-${safe(fromCity)}-to-${safe(toCity)}-${q.quoteId}.pdf`
  }
  return `TexLag-Quote-${q.quoteId}.pdf`
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ stats }) {
  return (
    <div className="summary-cards">
      <div className="summary-card">
        <div className="summary-card__value summary-card__value--green">{stats.active}</div>
        <div className="summary-card__label">Active Drivers</div>
      </div>
      <div className="summary-card">
        <div className="summary-card__value summary-card__value--muted">{stats.deactivated}</div>
        <div className="summary-card__label">Deactivated Drivers</div>
      </div>
      <div className="summary-card">
        <div className="summary-card__value summary-card__value--blue">{stats.platformQuotesSent}</div>
        <div className="summary-card__label">Quotes Generated (Platform-wide)</div>
      </div>
    </div>
  )
}

// ── Driver Profile Panel ──────────────────────────────────────────────────────

function DriverProfile({ driver: initialDriver, onBack, getToken }) {
  const [driver,         setDriver]         = useState(initialDriver)
  const [quotes,         setQuotes]         = useState([])
  const [loadingQ,       setLoadingQ]       = useState(true)
  const [errorQ,         setErrorQ]         = useState('')
  const [toggling,       setToggling]       = useState(false)
  const [toggleMsg,      setToggleMsg]      = useState('')
  const [resetting,      setResetting]      = useState(false)
  const [resetToast,     setResetToast]     = useState('')
  const [pdfDownloading, setPdfDownloading] = useState(new Set())
  const [pdfError,       setPdfError]       = useState('')

  // Quote filters
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear,  setFilterYear]  = useState('')

  // total is derived from the quotes array — no separate state needed
  const total = quotes.length

  const fetchQuotes = useCallback(async () => {
    setLoadingQ(true)
    setErrorQ('')
    try {
      const res  = await fetch(
        `/api/admin/drivers?action=quotes&email=${encodeURIComponent(driver.email)}&all=true`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setQuotes(
        (data.quotes ?? []).toSorted(
          (a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)
        )
      )
    } catch (e) {
      setErrorQ(e.message)
    } finally {
      setLoadingQ(false)
    }
  }, [driver.email, getToken])

  useEffect(() => { fetchQuotes() }, [fetchQuotes])

  // ── Derived filter options ────────────────────────────────────────────────
  const { availableYears, availableMonths } = useMemo(() => {
    const yearSet  = new Set()
    const monthSet = new Set()
    quotes.forEach(q => {
      const p = dateParts(q.generatedAt)
      if (p) { yearSet.add(p.year); monthSet.add(p.month) }
    })
    return {
      availableYears:  [...yearSet].toSorted((a, b) => b - a),
      availableMonths: [...monthSet].toSorted((a, b) => a - b),
    }
  }, [quotes])

  const filtered = useMemo(() => quotes.filter(q => {
    const p = dateParts(q.generatedAt)
    if (!p) return true
    if (filterYear  && p.year  !== Number(filterYear))  return false
    if (filterMonth && p.month !== Number(filterMonth)) return false
    return true
  }), [quotes, filterYear, filterMonth])

  const wonQuotes      = useMemo(() => filtered.filter(q => q.won), [filtered])
  const totalWonBroker = useMemo(
    () => wonQuotes.reduce((s, q) => s + Number(q.brokerTotal ?? q.finalQuote ?? 0), 0),
    [wonQuotes]
  )
  const totalWonDriver = useMemo(
    () => wonQuotes.reduce((s, q) => s + Number(q.internalDriverCost ?? 0), 0),
    [wonQuotes]
  )
  const hasFilters = filterMonth !== '' || filterYear !== ''

  async function handleToggle() {
    setToggling(true)
    setToggleMsg('')
    try {
      const res  = await fetch('/api/admin/drivers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'toggle-status', email: driver.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDriver(prev => ({ ...prev, active: data.user.active }))
      setToggleMsg(data.user.active ? 'Driver activated.' : 'Driver deactivated.')
    } catch (e) {
      setToggleMsg(e.message)
    } finally {
      setToggling(false)
    }
  }

  async function handleSendReset() {
    setResetting(true)
    setResetToast('')
    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'forgot-password', email: driver.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResetToast(`Password reset email sent to ${driver.email}.`)
    } catch (e) {
      setResetToast(`Error: ${e.message}`)
    } finally {
      setResetting(false)
      setTimeout(() => setResetToast(''), 5000)
    }
  }

  async function downloadQuotePDF(q) {
    setPdfError('')
    setPdfDownloading(s => new Set(s).add(q.quoteId))
    try {
      const res = await fetch('/api/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'generate-pdf', quoteId: q.quoteId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `Server error ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = quoteFilename(q)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[downloadQuotePDF]', e)
      setPdfError(`PDF error for ${q.quoteId}: ${e.message}`)
    } finally {
      setPdfDownloading(s => { const n = new Set(s); n.delete(q.quoteId); return n })
    }
  }

  const isActive = driver.active !== false

  return (
    <div className="driver-profile">

      {/* Back */}
      <button type="button" className="profile-back-btn" onClick={onBack}>
        ← Back to Drivers
      </button>

      {/* Profile header */}
      <div className="profile-header">
        <div className="profile-header__left">
          <h2 className="profile-header__name">{driver.firstName} {driver.lastName}</h2>
          <span className={`status-badge ${isActive ? 'status-badge--active' : 'status-badge--inactive'}`}>
            {isActive ? '● Active' : '● Deactivated'}
          </span>
        </div>
        <div className="profile-header__actions">
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={handleSendReset}
            disabled={resetting}
            title="Send a password reset code to this driver"
          >
            {resetting ? <><span className="spinner" style={{ borderTopColor: 'currentColor', borderColor: 'rgba(0,0,0,.15)' }} />Sending…</> : 'Send Password Reset'}
          </button>
          <button
            type="button"
            className={`btn btn--sm ${isActive ? 'btn--danger-outline' : 'btn--outline'}`}
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? <><span className="spinner" style={{ borderTopColor: 'currentColor', borderColor: 'rgba(0,0,0,.15)' }} />…</> : isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      {toggleMsg && (
        <div className={`banner ${toggleMsg.includes('activated') && !toggleMsg.includes('De') ? 'banner--success' : toggleMsg.includes('Deactivated') ? 'banner--warning' : 'banner--error'}`} style={{ marginBottom: 16 }}>
          {toggleMsg}
        </div>
      )}

      {resetToast && (
        <div className={`banner ${resetToast.startsWith('Error') ? 'banner--error' : 'banner--success'}`} style={{ marginBottom: 16 }}>
          {resetToast}
        </div>
      )}

      {/* Info grid */}
      <div className="profile-info-grid">
        <div className="profile-info-item">
          <div className="profile-info-item__label">Email</div>
          <div className="profile-info-item__value">{driver.email}</div>
        </div>
        <div className="profile-info-item">
          <div className="profile-info-item__label">Phone</div>
          <div className="profile-info-item__value">{driver.phone || <span style={{ color: 'var(--gray-300)' }}>—</span>}</div>
        </div>
        <div className="profile-info-item">
          <div className="profile-info-item__label">Account Status</div>
          <div className="profile-info-item__value">
            <span className={`status-badge ${isActive ? 'status-badge--active' : 'status-badge--inactive'}`}>
              {isActive ? '● Active' : '● Deactivated'}
            </span>
          </div>
        </div>
        <div className="profile-info-item">
          <div className="profile-info-item__label">Joined</div>
          <div className="profile-info-item__value">{fmtDate(driver.createdAt, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div className="profile-info-item">
          <div className="profile-info-item__label">Created By</div>
          <div className="profile-info-item__value">{driver.createdBy}</div>
        </div>
        <div className="profile-info-item">
          <div className="profile-info-item__label">Total Quotes Generated</div>
          <div className="profile-info-item__value profile-info-item__value--stat">
            {loadingQ ? (driver.quoteCount ?? '…') : total}
          </div>
        </div>
      </div>

      {/* Quote history */}
      <div className="profile-quotes">
        <div className="profile-quotes__heading">Quote History</div>

        {pdfError && (
          <div className="banner banner--error" style={{ marginBottom: 12 }}>{pdfError}</div>
        )}

        {loadingQ ? (
          <div className="profile-quotes__empty"><span className="spinner spinner--dark" /></div>
        ) : errorQ ? (
          <div className="banner banner--error">{errorQ}</div>
        ) : (
          <>
            {/* Earnings summary — won quotes only */}
            {wonQuotes.length > 0 && (
              <div className="qh-summary" style={{ marginBottom: 16 }}>
                <div className="qh-summary-card">
                  <div className="qh-summary-card__value">{fmt(totalWonBroker)}</div>
                  <div className="qh-summary-card__label">Total Won — Broker Amount</div>
                </div>
                <div className="qh-summary-card">
                  <div className="qh-summary-card__value qh-summary-card__value--teal">{fmt(totalWonDriver)}</div>
                  <div className="qh-summary-card__label">Total Won — Driver Payable</div>
                </div>
              </div>
            )}

            {/* Filters */}
            {quotes.length > 0 && (
              <div className="qh-filters" style={{ marginBottom: 16 }}>
                <div className="qh-filters__group">
                  {/* htmlFor connects to the select via matching id */}
                  <label className="qh-filters__label" htmlFor="profile-filter-month">Month</label>
                  <select
                    id="profile-filter-month"
                    className="qh-select"
                    value={filterMonth}
                    onChange={e => setFilterMonth(e.target.value)}
                  >
                    <option value="">All months</option>
                    {availableMonths.map(m => (
                      <option key={m} value={String(m)}>{MONTHS[m - 1]}</option>
                    ))}
                  </select>
                </div>
                <div className="qh-filters__group">
                  <label className="qh-filters__label" htmlFor="profile-filter-year">Year</label>
                  <select
                    id="profile-filter-year"
                    className="qh-select"
                    value={filterYear}
                    onChange={e => setFilterYear(e.target.value)}
                  >
                    <option value="">All years</option>
                    {availableYears.map(y => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>
                {hasFilters && (
                  <button
                    type="button"
                    className="btn btn--outline btn--sm qh-filters__clear"
                    onClick={() => { setFilterMonth(''); setFilterYear('') }}
                  >
                    Clear filters
                  </button>
                )}
                <span className="qh-filters__count">
                  {filtered.length} quote{filtered.length !== 1 ? 's' : ''}
                  {hasFilters ? ' matching' : ' total'}
                </span>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="profile-quotes__empty">
                {quotes.length === 0
                  ? 'No quotes generated yet.'
                  : 'No quotes match the selected filters.'}
              </div>
            ) : (
              <div className="dt-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Quote ID</th>
                      <th>Route</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(q => {
                      const dest        = q.dropoffs?.[q.dropoffs.length - 1] ?? ''
                      const downloading = pdfDownloading.has(q.quoteId)
                      return (
                        <tr key={q.quoteId}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(q.generatedAt)}</td>
                          <td><code className="quote-id-code">{q.quoteId}</code></td>
                          <td className="quote-route">{q.pickup} → {dest}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(q.finalQuote)}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span
                              className={`qh-won-btn${q.won ? ' qh-won-btn--on' : ''}`}
                              style={{ cursor: 'default', pointerEvents: 'none' }}
                            >
                              {q.won ? '✓ Won' : 'Pending'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn--sm btn--outline"
                              title={`Download PDF for ${q.quoteId}`}
                              disabled={downloading}
                              onClick={() => downloadQuotePDF(q)}
                              style={{ minWidth: 36, padding: '3px 8px' }}
                            >
                              {downloading
                                ? <span className="spinner spinner--dark" style={{ width: 12, height: 12 }} />
                                : '⬇'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function DriversView() {
  const { getToken } = useAuth()

  const [drivers,       setDrivers]       = useState([])
  const [stats,         setStats]         = useState({ total: 0, active: 0, deactivated: 0, platformQuotesSent: 0 })
  const [loadingList,   setLoadingList]   = useState(true)
  const [listError,     setListError]     = useState('')

  const [showForm,      setShowForm]      = useState(false)
  const [form,          setForm]          = useState(EMPTY_FORM)
  const [creating,      setCreating]      = useState(false)
  const [formError,     setFormError]     = useState('')
  const [formSuccess,   setFormSuccess]   = useState('')

  const [selectedDriver, setSelectedDriver] = useState(null)
  const [toggling,       setToggling]       = useState(null)
  const [resettingRow,   setResettingRow]   = useState(null)
  const [rowResetMsg,    setRowResetMsg]    = useState({})

  // ── Load drivers ────────────────────────────────────────────────────────────
  const loadDrivers = useCallback(async () => {
    setLoadingList(true)
    setListError('')
    try {
      const res  = await fetch('/api/admin/drivers', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDrivers(data.drivers)
      if (data.stats) setStats(data.stats)
    } catch (e) {
      setListError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [getToken])

  useEffect(() => { loadDrivers() }, [loadDrivers])

  useEffect(() => {
    if (selectedDriver) return
    const id = setInterval(loadDrivers, 60_000)
    return () => clearInterval(id)
  }, [loadDrivers, selectedDriver])

  // ── Toggle active status ────────────────────────────────────────────────────
  async function toggleStatus(email) {
    setToggling(email)
    try {
      const res  = await fetch('/api/admin/drivers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'toggle-status', email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      loadDrivers()
    } catch (e) {
      alert(e.message)
    } finally {
      setToggling(null)
    }
  }

  // ── Send password reset email ───────────────────────────────────────────────
  async function sendResetForRow(email) {
    setResettingRow(email)
    setRowResetMsg(m => ({ ...m, [email]: '' }))
    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'forgot-password', email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRowResetMsg(m => ({ ...m, [email]: `Reset email sent to ${email}.` }))
    } catch (e) {
      setRowResetMsg(m => ({ ...m, [email]: `Error: ${e.message}` }))
    } finally {
      setResettingRow(null)
      setTimeout(() => setRowResetMsg(m => ({ ...m, [email]: '' })), 5000)
    }
  }

  // ── Create driver ───────────────────────────────────────────────────────────
  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setFormError('')
    setFormSuccess('')
  }

  async function createDriver(e) {
    e.preventDefault()
    setFormError('')
    setFormSuccess('')
    setCreating(true)
    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'register', ...form, role: 'driver' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setFormSuccess(`Driver ${data.user.firstName} ${data.user.lastName} created. Welcome email sent.`)
      setForm(EMPTY_FORM)
      setShowForm(false)
      loadDrivers()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setCreating(false)
    }
  }

  // ── Profile view ────────────────────────────────────────────────────────────
  if (selectedDriver) {
    return (
      <div className="view-page">
        <DriverProfile
          driver={selectedDriver}
          onBack={() => { setSelectedDriver(null); loadDrivers() }}
          getToken={getToken}
        />
      </div>
    )
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="view-page">

      <SummaryCards stats={stats} />

      <div className="view-page__header view-page__header--row" style={{ marginTop: 24 }}>
        <div>
          <h2 className="view-page__title">Driver Management</h2>
          <p className="view-page__sub">
            {stats.total} driver{stats.total !== 1 ? 's' : ''} registered
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={loadDrivers}
            disabled={loadingList}
            title="Refresh driver list and quote counts"
            style={{ minWidth: 36 }}
          >
            {loadingList
              ? <><span className="spinner spinner--dark" style={{ width: 12, height: 12, marginRight: 4 }} />Refreshing…</>
              : '↻ Refresh'}
          </button>
          <button
            type="button"
            className={`btn ${showForm ? 'btn--outline' : 'btn--primary'} btn--sm`}
            onClick={() => { setShowForm(s => !s); setFormError(''); setFormSuccess('') }}
          >
            {showForm ? '✕ Cancel' : '+ New Driver'}
          </button>
        </div>
      </div>

      {formSuccess && !showForm && (
        <div className="banner banner--success">{formSuccess}</div>
      )}

      {/* Create driver form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="card__title">New Driver Account</p>
          {formError   && <div className="banner banner--error">{formError}</div>}
          {formSuccess && <div className="banner banner--success">{formSuccess}</div>}
          <form onSubmit={createDriver}>
            <div className="driver-form-grid">
              <div className="field">
                {/* htmlFor + matching id associates label to input for screen readers */}
                <label className="label" htmlFor="new-driver-first-name">First Name</label>
                <input
                  id="new-driver-first-name"
                  className="input"
                  placeholder="Jane"
                  value={form.firstName}
                  onChange={e => setField('firstName', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="new-driver-last-name">Last Name</label>
                <input
                  id="new-driver-last-name"
                  className="input"
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={e => setField('lastName', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="new-driver-email">Email</label>
                <input
                  id="new-driver-email"
                  className="input"
                  type="email"
                  placeholder="jane@texlag.com"
                  value={form.email}
                  onChange={e => setField('email', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="new-driver-phone">
                  Phone <span className="label-opt">(optional)</span>
                </label>
                <input
                  id="new-driver-phone"
                  className="input"
                  type="tel"
                  placeholder="+1 555 000 0000"
                  value={form.phone}
                  onChange={e => setField('phone', e.target.value)}
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="hint">
                  A temporary password (Password@123) will be emailed to the driver.
                  They must set a new password on first login.
                </span>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn btn--primary" type="submit" disabled={creating}>
                {creating ? <><span className="spinner" />Creating…</> : 'Create Driver'}
              </button>
            </div>
          </form>
        </div>
      )}

      {listError && <div className="banner banner--error">{listError}</div>}

      {loadingList ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <span className="spinner spinner--dark" />
        </div>
      ) : drivers.length === 0 ? (
        <div className="dt-empty-state">No drivers registered yet.</div>
      ) : (
        <div className="dt-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Quotes</th>
                <th>Joined</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => {
                const isActive = d.active !== false
                return (
                  <tr key={d.email} style={{ opacity: isActive ? 1 : 0.65 }}>
                    <td>
                      <button
                        type="button"
                        className="dt-name-btn"
                        onClick={() => setSelectedDriver(d)}
                      >
                        {d.firstName} {d.lastName}
                      </button>
                    </td>
                    <td>{d.email}</td>
                    <td>{d.phone || <span className="dt-empty">—</span>}</td>
                    <td style={{ textAlign: 'center' }}>{d.quoteCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.createdAt)}</td>
                    <td>
                      <span className={`status-badge ${isActive ? 'status-badge--active' : 'status-badge--inactive'}`}>
                        {isActive ? '● Active' : '● Deactivated'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn--sm btn--outline"
                          onClick={() => sendResetForRow(d.email)}
                          disabled={resettingRow === d.email}
                          title="Send a password reset code to this driver"
                        >
                          {resettingRow === d.email ? '…' : 'Reset Password'}
                        </button>
                        <button
                          type="button"
                          className={`btn btn--sm ${isActive ? 'btn--danger-outline' : 'btn--outline'}`}
                          onClick={() => toggleStatus(d.email)}
                          disabled={toggling === d.email}
                          style={{ minWidth: 100 }}
                        >
                          {toggling === d.email
                            ? '…'
                            : isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--outline"
                          onClick={() => setSelectedDriver(d)}
                        >
                          View Profile
                        </button>
                      </div>
                      {rowResetMsg[d.email] && (
                        <div className={`row-toast ${rowResetMsg[d.email].startsWith('Error') ? 'row-toast--error' : 'row-toast--ok'}`}>
                          {rowResetMsg[d.email]}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
