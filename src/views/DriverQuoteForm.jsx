import { useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

// ── Static content ──────────────────────────────────────────────────────────

const OPERATIONAL_NOTES = [
  'All loads require a signed Rate Confirmation from dispatch before departure.',
  'Detention time is recorded after 2 free hours at pickup or delivery — notify dispatch immediately upon arrival.',
  'Driver Assist charges apply only when the driver physically participates in loading or unloading; documented prior approval is required.',
  'Deadhead mileage compensation applies from the driver\'s current location to the pickup point only.',
  'Team driver loads: both drivers must hold valid CDLs on file with dispatch; the lead driver manages ELD compliance.',
  'Trailer Hold fees accrue daily after the first 24-hour grace period at the drop-off facility.',
  'Any accident, mechanical failure, or delay must be reported to dispatch within 15 minutes of occurrence.',
  'Fuel advances are available for loads exceeding 500 miles — request through dispatch prior to departure.',
  'Driver pay is issued on Net-7 terms following signed Proof of Delivery submission.',
]

const DEADHEAD_MODES = [
  { value: 'manual',   label: 'Manual Miles'   },
  { value: 'location', label: 'Location-Based'  },
  { value: 'gps',      label: 'GPS Ping'        },
]

const fmt     = n  => `$${Number(n).toFixed(2)}`
const fmtRate = r  => `$${Number(r).toFixed(4)}/mi`
// Matches US 5-digit ZIP  OR  Canadian postal code (FSA + LDU, optional space)
const ZIP_RE  = /^(\d{5}|[A-Za-z]\d[A-Za-z][\s]?\d[A-Za-z]\d)$/

// ── Component ───────────────────────────────────────────────────────────────

export default function DriverQuoteForm() {
  const { getToken } = useAuth()

  // Route
  const [jurisdiction,    setJurisdiction]    = useState('interstate')
  const [pickup,          setPickup]          = useState('')
  const [dropoffs,        setDropoffs]        = useState([''])

  // ZIP auto-resolution state
  // zipResolving: Set of field keys currently awaiting geocode ('pickup' | 'drop-N')
  // zipWarning:   Map of field key → warning message string
  const [zipResolving, setZipResolving] = useState(() => new Set())
  const [zipWarning,   setZipWarning]   = useState(() => new Map())
  // Debounce timer refs: one per field key
  const zipTimers = useRef({})

  // Trip details
  const [trailerHoldDays, setTrailerHoldDays] = useState('')

  // Deadhead
  const [deadheadMode,    setDeadheadMode]    = useState('manual')
  const [deadheadMiles,   setDeadheadMiles]   = useState('')
  const [deadheadOrigin,  setDeadheadOrigin]  = useState('')
  const [deadheadLoading, setDeadheadLoading] = useState(false)
  const [deadheadStatus,  setDeadheadStatus]  = useState('')

  // Driver
  const [driverMode,      setDriverMode]      = useState('solo')

  // Pallets (always required)
  const [numberOfPallets, setNumberOfPallets] = useState('')

  // Toggles
  const [driverAssist,    setDriverAssist]    = useState(false)
  const [detention,       setDetention]       = useState(false)
  const [detentionAmount, setDetentionAmount] = useState('')
  const [lowBackhaul,     setLowBackhaul]     = useState(false)
  const [partialBackhaul, setPartialBackhaul] = useState(false)
  const [hazmat,          setHazmat]          = useState(false)

  // Quote output
  const [quoting,    setQuoting]    = useState(false)
  const [quote,      setQuote]      = useState(null)
  const [error,      setError]      = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError,   setPdfError]   = useState('')

  // Send to broker
  const [brokerEmail,  setBrokerEmail]  = useState('')
  const [sending,      setSending]      = useState(false)
  const [sendStatus,   setSendStatus]   = useState('')   // '' | 'ok' | 'err'
  const [sendMessage,  setSendMessage]  = useState('')

  // ── Dropoff helpers ────────────────────────────────────────────────────────
  const updateDropoff = (i, v) => {
    setDropoffs(d => d.map((x, j) => j === i ? v : x))
    scheduleZipResolve(`drop-${i}`, v, val => {
      setDropoffs(d => d.map((x, j) => j === i ? val : x))
    })
  }
  const addDropoff    = ()     => setDropoffs(d => [...d, ''])
  const removeDropoff = i     => {
    setDropoffs(d => d.filter((_, j) => j !== i))
    // Clean up any pending timer / warning for removed stop
    clearTimeout(zipTimers.current[`drop-${i}`])
    delete zipTimers.current[`drop-${i}`]
    setZipWarning(m => { const n = new Map(m); n.delete(`drop-${i}`); return n })
    setZipResolving(s => { const n = new Set(s); n.delete(`drop-${i}`); return n })
  }

  // ── ZIP auto-resolution ────────────────────────────────────────────────────
  // Called whenever a location field value changes.  If the new value is a bare
  // 5-digit ZIP we debounce 600 ms then geocode; otherwise we clear any prior
  // warning for that field so stale messages don't linger.
  function scheduleZipResolve(key, value, setter) {
    // Always clear the existing timer so each keystroke resets the clock.
    clearTimeout(zipTimers.current[key])

    // If there's a warning showing and the driver has changed the value,
    // clear it immediately so they don't see a stale error.
    setZipWarning(m => {
      if (!m.has(key)) return m
      const n = new Map(m); n.delete(key); return n
    })

    if (!ZIP_RE.test(value.trim())) return   // not a bare ZIP — nothing to resolve

    zipTimers.current[key] = setTimeout(() => resolveZip(key, value.trim(), setter), 600)
  }

  async function resolveZip(key, zip, setter) {
    setZipResolving(s => new Set(s).add(key))
    setZipWarning(m => { const n = new Map(m); n.delete(key); return n })
    try {
      const res  = await fetch('/api/geocode', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ zip }),
      })
      const data = await res.json()
      if (!res.ok || !data.resolved) throw new Error(data.error ?? 'No result')
      setter(data.resolved)
    } catch {
      setZipWarning(m => new Map(m).set(key, 'Could not resolve — please verify.'))
    } finally {
      setZipResolving(s => { const n = new Set(s); n.delete(key); return n })
    }
  }

  // ── Deadhead — location-based ──────────────────────────────────────────────
  async function calcDeadheadByAddress() {
    if (!deadheadOrigin.trim()) return setDeadheadStatus('Enter your current location first.')
    if (!pickup.trim())          return setDeadheadStatus('Enter a pickup address first.')
    setDeadheadLoading(true)
    setDeadheadStatus('Calculating…')
    try {
      const res  = await fetch('/api/deadhead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body:    JSON.stringify({ origin: deadheadOrigin, destination: pickup }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDeadheadMiles(String(data.miles))
      setDeadheadStatus(`${data.miles} mi to pickup · ${data.duration}`)
    } catch (e) {
      setDeadheadStatus(`Error: ${e.message}`)
    } finally {
      setDeadheadLoading(false)
    }
  }

  // ── Deadhead — GPS ping ────────────────────────────────────────────────────
  function pingGPS() {
    if (!navigator.geolocation) return setDeadheadStatus('Geolocation is not supported by your browser.')
    if (!pickup.trim())          return setDeadheadStatus('Enter a pickup address first.')
    setDeadheadLoading(true)
    setDeadheadStatus('Acquiring location…')

    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        setDeadheadStatus('Position found — calculating distance…')
        try {
          const res  = await fetch('/api/deadhead', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body:    JSON.stringify({ origin: { lat, lng }, destination: pickup }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
          setDeadheadMiles(String(data.miles))
          setDeadheadStatus(`${data.miles} mi to pickup · ${data.duration}`)
        } catch (e) {
          setDeadheadStatus(`Error: ${e.message}`)
        } finally {
          setDeadheadLoading(false)
        }
      },
      err => {
        setDeadheadLoading(false)
        setDeadheadStatus(`GPS error: ${err.message}`)
      },
      { timeout: 10_000, enableHighAccuracy: false }
    )
  }

  // ── Download PDF via POST /api/generate-pdf ───────────────────────────────

  // Extract the city portion from a full address string returned by Google Maps.
  // e.g. "Houston, TX, USA" → "Houston"  |  "Dallas, TX" → "Dallas"
  // Returns null if the string is empty or has no comma.
  function extractCity(address) {
    if (!address || typeof address !== 'string') return null
    const city = address.split(',')[0].trim()
    return city.length > 0 ? city : null
  }

  // Build the descriptive PDF filename from the quote's resolved location data.
  // Falls back to plain quoteId-only name if city names cannot be extracted.
  function pdfFilename(q) {
    const fromCity = extractCity(q.pickup)
    const toCity   = extractCity(
      Array.isArray(q.dropoffs) && q.dropoffs.length > 0
        ? q.dropoffs[q.dropoffs.length - 1]
        : null
    )
    if (fromCity && toCity) {
      // Sanitise: replace spaces/slashes with hyphens, strip non-alphanumeric chars
      const safe = s => s.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')
      return `TexLag-Quote-${safe(fromCity)}-to-${safe(toCity)}-${q.quoteId}.pdf`
    }
    return `TexLag-Quote-${q.quoteId}.pdf`
  }

  async function downloadPDF() {
    if (!quote) return
    setPdfLoading(true)
    setPdfError('')
    try {
      const res = await fetch('/api/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'generate-pdf', quote }),
      })
      if (!res.ok) {
        // Server returned JSON error — read it and surface the message
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `Server error ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = pdfFilename(quote)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[downloadPDF]', e)
      setPdfError(e.message)
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Send quote to broker ───────────────────────────────────────────────────
  async function sendToBroker(e) {
    e.preventDefault()
    if (!quote) return
    if (!brokerEmail.trim()) return setSendMessage('Enter the broker\'s email address.')

    setSending(true)
    setSendStatus('')
    setSendMessage('')
    try {
      const res  = await fetch('/api/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'send-quote', quote, brokerEmail: brokerEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSendStatus('ok')
      setSendMessage(`Quote sent to ${brokerEmail.trim()}`)
    } catch (err) {
      setSendStatus('err')
      setSendMessage(err.message)
    } finally {
      setSending(false)
    }
  }

  // ── Quote generation ───────────────────────────────────────────────────────
  async function generate(e) {
    e.preventDefault()
    setError('')
    setQuote(null)
    if (!pickup.trim())                       return setError('Enter a pickup location.')
    if (dropoffs.some(d => !d.trim()))        return setError('Fill in all drop-off locations.')
    if (!numberOfPallets || Number(numberOfPallets) < 1)
                                              return setError('Enter the number of pallets (minimum 1).')

    const token = getToken()
    if (!token) return setError('Session expired — please log in again.')

    setQuoting(true)
    try {
      const res  = await fetch('/api/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({
          jurisdiction,
          pickup:          pickup.trim(),
          dropoffs:        dropoffs.map(d => d.trim()),
          driverMode,
          numberOfPallets: Number(numberOfPallets) || 0,
          trailerHoldDays: Number(trailerHoldDays) || 0,
          deadheadMiles:   Number(deadheadMiles)   || 0,
          toggles: {
            hazmat,
            tanker:       false,
            tolls:        false,
            driverAssist,
            detention,
            lowBackhaul,
            partialBackhaul: lowBackhaul ? partialBackhaul : false,
          },
          extras: {
            detentionAmount: detention ? Number(detentionAmount) || 0 : 0,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setQuote(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setQuoting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Load Quote</h1>
        <p className="page__subtitle">Configure your load to generate a freight quote.</p>
        <p className="form-legend"><span aria-hidden="true">*</span> Required field</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <form onSubmit={generate} noValidate>

        {/* ── 1. Jurisdiction ────────────────────────────────────────────── */}
        <div className="jurisdiction-toggle">
          {[
            { value: 'interstate', label: 'Interstate', desc: 'Crossing state lines'  },
            { value: 'intrastate', label: 'Intrastate', desc: 'Within state only'     },
          ].map(({ value, label, desc }) => (
            <button
              key={value}
              type="button"
              className={`jurisdiction-btn${jurisdiction === value ? ' jurisdiction-btn--active' : ''}`}
              onClick={() => setJurisdiction(value)}
            >
              <span className="jurisdiction-btn__label">{label}</span>
              <span className="jurisdiction-btn__desc">{desc}</span>
            </button>
          ))}
        </div>

        {/* ── 2. Route ───────────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Route</p>

          <div className="field">
            <label className="label">Pickup Location <span className="req" aria-hidden="true">*</span></label>
            <div className="zip-field-wrap">
              <input className="input" placeholder="Address or ZIP code"
                value={pickup}
                onChange={e => {
                  const v = e.target.value
                  setPickup(v)
                  scheduleZipResolve('pickup', v, setPickup)
                }} />
              {zipResolving.has('pickup') && (
                <span className="zip-spinner"><span className="spinner spinner--dark" /></span>
              )}
            </div>
            {zipWarning.get('pickup') && (
              <span className="zip-warning">{zipWarning.get('pickup')}</span>
            )}
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label className="label">Drop-offs <span className="req" aria-hidden="true">*</span></label>
            <div className="stop-list">
              {dropoffs.map((val, i) => (
                <div key={i} className="stop-row">
                  <span className="stop-badge">{i + 1}</span>
                  <div className="zip-field-wrap" style={{ flex: 1 }}>
                    <input className="input" placeholder={`Destination ${i + 1}`}
                      value={val}
                      onChange={e => updateDropoff(i, e.target.value)} />
                    {zipResolving.has(`drop-${i}`) && (
                      <span className="zip-spinner"><span className="spinner spinner--dark" /></span>
                    )}
                  </div>
                  {dropoffs.length > 1 && (
                    <button type="button" className="icon-btn icon-btn--danger"
                      onClick={() => removeDropoff(i)} title="Remove stop">×</button>
                  )}
                </div>
              ))}
              {dropoffs.map((_, i) => zipWarning.get(`drop-${i}`) ? (
                <span key={`warn-${i}`} className="zip-warning">{zipWarning.get(`drop-${i}`)}</span>
              ) : null)}
            </div>
            <button type="button" className="add-stop-btn" onClick={addDropoff}>+ Add stop</button>
          </div>
        </div>

        {/* ── 3. Trip details ────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Trip Details</p>
          <div className="trip-details-grid">
            <div className="field">
              <label className="label">
                Number of Pallets <span className="req" aria-hidden="true">*</span>
              </label>
              <input className="input" type="number" min="1" step="1" placeholder="e.g. 12"
                value={numberOfPallets} onChange={e => setNumberOfPallets(e.target.value)} />
              <span className="hint">Required — used to calculate driver assist cost</span>
            </div>
            <div className="field">
              <label className="label">Trailer Hold Days</label>
              <input className="input" type="number" min="0" step="1" placeholder="0"
                value={trailerHoldDays} onChange={e => setTrailerHoldDays(e.target.value)} />
              <span className="hint">Days trailer remains at drop-off facility</span>
            </div>
          </div>
        </div>

        {/* ── 4. Deadhead miles ──────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Deadhead Miles</p>

          <div className="deadhead-modes">
            {DEADHEAD_MODES.map(({ value, label }) => (
              <button key={value} type="button"
                className={`deadhead-mode-btn${deadheadMode === value ? ' deadhead-mode-btn--active' : ''}`}
                onClick={() => {
                  setDeadheadMode(value)
                  setDeadheadStatus('')
                  // Clear any pending deadhead ZIP resolution when switching modes
                  clearTimeout(zipTimers.current['deadhead'])
                  setZipWarning(m => { const n = new Map(m); n.delete('deadhead'); return n })
                  setZipResolving(s => { const n = new Set(s); n.delete('deadhead'); return n })
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Manual */}
          {deadheadMode === 'manual' && (
            <div className="field" style={{ marginTop: 16 }}>
              <label className="label">Miles</label>
              <input className="input" type="number" min="0" step="0.1" placeholder="e.g. 45"
                value={deadheadMiles} onChange={e => setDeadheadMiles(e.target.value)} />
            </div>
          )}

          {/* Location-based */}
          {deadheadMode === 'location' && (
            <div style={{ marginTop: 16 }}>
              <div className="field">
                <label className="label">Your Current Location</label>
                <div className="deadhead-location-row">
                  <div className="zip-field-wrap" style={{ flex: 1 }}>
                    <input className="input" placeholder="Address, ZIP, or postal code"
                      value={deadheadOrigin}
                      onChange={e => {
                        const v = e.target.value
                        setDeadheadOrigin(v)
                        scheduleZipResolve('deadhead', v, setDeadheadOrigin)
                      }} />
                    {zipResolving.has('deadhead') && (
                      <span className="zip-spinner"><span className="spinner spinner--dark" /></span>
                    )}
                  </div>
                  <button type="button" className="btn btn--outline btn--sm"
                    onClick={calcDeadheadByAddress}
                    disabled={deadheadLoading || zipResolving.has('deadhead')}>
                    {deadheadLoading
                      ? <span className="spinner spinner--dark" />
                      : 'Calculate'}
                  </button>
                </div>
                {zipWarning.get('deadhead') && (
                  <span className="zip-warning">{zipWarning.get('deadhead')}</span>
                )}
              </div>
              {deadheadMiles && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label className="label">Deadhead Miles <span className="label-opt">(editable)</span></label>
                  <input className="input" type="number" min="0" step="0.1"
                    value={deadheadMiles} onChange={e => setDeadheadMiles(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {/* GPS */}
          {deadheadMode === 'gps' && (
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--outline gps-btn"
                onClick={pingGPS} disabled={deadheadLoading}>
                {deadheadLoading
                  ? <><span className="spinner spinner--dark" />Locating…</>
                  : '📍 Use My Location'}
              </button>
              {deadheadMiles && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label className="label">Deadhead Miles <span className="label-opt">(editable)</span></label>
                  <input className="input" type="number" min="0" step="0.1"
                    value={deadheadMiles} onChange={e => setDeadheadMiles(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {deadheadStatus && (
            <p className={`deadhead-status${deadheadStatus.startsWith('Error') || deadheadStatus.startsWith('GPS error') ? ' deadhead-status--err' : ''}`}>
              {deadheadStatus}
            </p>
          )}
        </div>

        {/* ── 5. Driver ──────────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Driver</p>
          <div className="mode-toggle">
            {[{ value: 'solo', label: 'Solo' }, { value: 'team', label: 'Team' }].map(({ value, label }) => (
              <button key={value} type="button"
                className={`mode-btn${driverMode === value ? ' mode-btn--active' : ''}`}
                onClick={() => setDriverMode(value)}>
                {label}
              </button>
            ))}
          </div>
          {driverMode === 'team' && (
            <p className="mode-hint">Team loads are billed at 2× CPM on the client quote.</p>
          )}
        </div>

        {/* ── 6. Load options ────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Load Options</p>

          {/* Driver Assist */}
          <div className="option-row">
            <div
              className={`toggle-chip${driverAssist ? ' toggle-chip--on' : ''}`}
              onClick={() => setDriverAssist(v => !v)}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Driver Assist</span>
            </div>
          </div>
          {driverAssist && (
            <p className="option-sub-hint">
              {numberOfPallets
                ? `${numberOfPallets} pallet${Number(numberOfPallets) !== 1 ? 's' : ''} × admin rate`
                : 'Set pallet count above'}
            </p>
          )}

          <div className="option-divider" />

          {/* Detention */}
          <div className="option-row">
            <div
              className={`toggle-chip${detention ? ' toggle-chip--on' : ''}`}
              onClick={() => setDetention(v => !v)}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Detention</span>
            </div>
          </div>
          {detention && (
            <div className="input-prefix-wrap option-sub-field">
              <span className="prefix">$</span>
              <input className="input" type="number" min="0" step="0.01" placeholder="0.00"
                value={detentionAmount} onChange={e => setDetentionAmount(e.target.value)} />
            </div>
          )}

          <div className="option-divider" />

          {/* Hazmat */}
          <div className="option-row">
            <div
              className={`toggle-chip${hazmat ? ' toggle-chip--on' : ''}`}
              onClick={() => setHazmat(v => !v)}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Hazmat</span>
            </div>
          </div>

          {/* Low/No Backhaul */}
          <div className="option-row">
            <div
              className={`toggle-chip${lowBackhaul ? ' toggle-chip--on' : ''}`}
              onClick={() => {
                const next = !lowBackhaul
                setLowBackhaul(next)
                if (!next) setPartialBackhaul(false)   // reset child when parent turns off
              }}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Low / No Backhaul</span>
            </div>
          </div>

          {/* Partial Backhaul — flush with all other rows, no indentation */}
          {lowBackhaul && (
            <div className="option-row">
              <div
                className={`toggle-chip${partialBackhaul ? ' toggle-chip--on' : ''}`}
                onClick={() => setPartialBackhaul(v => !v)}
              >
                <div className="switch"><div className="switch__knob" /></div>
                <span className="toggle-label">
                  Partial Backhaul
                  <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: 11, marginLeft: 6 }}>
                    Split fuel cost with client (50%)
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── 7. Operational notes ───────────────────────────────────────── */}
        <div className="card notes-panel">
          <div className="notes-panel__header">
            <p className="card__title" style={{ marginBottom: 0 }}>Operational Notes</p>
            <span className="notes-lock">🔒 Read-only</span>
          </div>
          <ol className="notes-list">
            {OPERATIONAL_NOTES.map((note, i) => (
              <li key={i} className="notes-list__item">{note}</li>
            ))}
          </ol>
        </div>

        {/* ── Generate ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: 20 }}>
          <button type="submit" className="btn btn--primary btn--full" disabled={quoting}>
            {quoting ? <><span className="spinner" />Generating Quote…</> : 'Generate Quote'}
          </button>
        </div>
      </form>

      {/* ── Quote result ───────────────────────────────────────────────────── */}
      {quote && (
        <QuoteResultCard
          quote={quote}
          onDownloadPDF={downloadPDF}
          pdfLoading={pdfLoading}
          pdfError={pdfError}
          brokerEmail={brokerEmail}
          onBrokerEmailChange={setBrokerEmail}
          onSend={sendToBroker}
          sending={sending}
          sendStatus={sendStatus}
          sendMessage={sendMessage}
        />
      )}
    </div>
  )
}

// ── Inline result display ────────────────────────────────────────────────────

function QuoteResultCard({
  quote,
  onDownloadPDF, pdfLoading, pdfError,
  brokerEmail, onBrokerEmailChange,
  onSend, sending, sendStatus, sendMessage,
}) {
  const activeItems = Object.entries(quote.lineItems ?? {}).filter(([, v]) => v !== null)

  const SCREEN_LABEL_RENAME = {
    'Route Miles — Solo CPM':         'Route Miles',
    'Route Miles — Team CPM':         'Route Miles',
    'Truck rate':                     'Truck Rate',
    'Driver assist':                  'Driver Assist',
    'Trailer hold':                   'Trailer Hold',
    'Deadhead CPM':                   'Deadhead',
    'Fuel surcharge':                 'Gas',
    'Detention fee':                  'Detention Fee',
    'Backhaul Surcharge':             'Backhaul Surcharge',
    'Backhaul Surcharge — Partial':   'Backhaul Surcharge (Partial 50%)',
  }
  function screenLabel(label) {
    const stripped = (label ?? '').replace(/\s*\(.*/, '').trim()
    return SCREEN_LABEL_RENAME[stripped] ?? stripped
  }

  // Secondary descriptor shown under the label: days / miles / pallets
  function itemMeta(item) {
    if (item.days    != null) return `${item.days} day${item.days !== 1 ? 's' : ''}`
    if (item.miles   != null) return `${item.miles} mi`
    if (item.pallets != null) return `${item.pallets} pallet${item.pallets !== 1 ? 's' : ''}`
    return '—'
  }

  return (
    <div className="quote-result" style={{ marginTop: 28 }}>
      <div className="quote-result__header">
        <div>
          <div className="quote-result__id">{quote.quoteId}</div>
          <div className="quote-result__route">
            {quote.pickup} → {quote.dropoffs.join(' → ')}
          </div>
        </div>
        <div className="quote-result__meta">
          {quote.totalMiles} mi &middot; {quote.driverMode} &middot; {quote.jurisdiction}
        </div>
      </div>

      {/* Reference fields — trip duration and pallet count */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 24px',
        padding: '8px 16px',
        background: 'var(--gray-50, #f8fafc)',
        borderBottom: '1px solid var(--gray-100)',
        fontSize: 12,
        color: 'var(--gray-600)',
      }}>
        <span>
          <span style={{ fontWeight: 600 }}>Estimated Trip Duration: </span>
          {quote.tripDays} day{quote.tripDays !== 1 ? 's' : ''}
          <span style={{ color: 'var(--gray-400)', fontSize: 11, marginLeft: 4 }}>
            ({quote.totalMiles} mi ÷ {quote.ratesSnapshot?.speed ?? 65} mph ÷ 11 hrs)
          </span>
        </span>
        <span>
          <span style={{ fontWeight: 600 }}>Pallets: </span>
          {quote.numberOfPallets ?? 0}
        </span>
        {quote.toggles?.lowBackhaul && (
          <span>
            <span style={{ fontWeight: 600 }}>Backhaul: </span>
            {quote.toggles?.partialBackhaul ? 'Partial (50%)' : 'Full surcharge'}
          </span>
        )}
      </div>

      <div className="quote-result__body">
        <table className="line-items">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {activeItems.map(([key, item]) => (
              <tr key={key}>
                <td>
                  <div className="item-label">{screenLabel(item.label)}</div>
                </td>
                <td style={{ textAlign: 'right', color: 'var(--gray-400)', fontSize: 12 }}>
                  {itemMeta(item)}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(item.amount)}</td>
              </tr>
            ))}

            <tr className="line-items__total">
              <td colSpan={2}>
                Final Quote
                {quote.backhaulApplied && (
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 6 }}>
                    (backhaul surcharge applied)
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(quote.finalQuote)}</td>
            </tr>
          </tbody>
        </table>

        {/* Detention notice — always shown; rate appended when detention is charged */}
        <p className="detention-notice">
          {quote.toggles?.detention
            ? `Detention charges apply after 2 hours of free waiting time, at a rate of ${fmt(quote.lineItems?.detentionFee?.amount ?? 0)} per hour.`
            : 'Detention charges apply after 2 hours of free waiting time.'
          }
        </p>

        <div className="internal-row">
          <span className="internal-row__label">
            Internal Driver Cost (single-driver payable)
            <span className="internal-row__desc">
              Based on ${quote.ratesSnapshot?.driverCpm ?? quote.ratesSnapshot?.driverBaseCpm ?? '—'}/mi CPM and applicable load charges.
            </span>
          </span>
          <span className="internal-row__value">{fmt(quote.internalDriverCost)}</span>
        </div>

        {/* ── Generated-by + Download row */}
        <div className="quote-result__pdf-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
            Generated by {quote.driver?.firstName} {quote.driver?.lastName} &middot; {new Date(quote.generatedAt).toLocaleString()}
          </div>
          <button
            className="btn btn--outline btn--sm"
            onClick={onDownloadPDF}
            disabled={pdfLoading}
            style={{ flexShrink: 0, marginLeft: 16 }}
          >
            {pdfLoading
              ? <><span className="spinner spinner--dark" />Generating…</>
              : '⬇ Download PDF'}
          </button>
        </div>
        {pdfError && (
          <p style={{ fontSize: 12, marginTop: 8, color: 'var(--red)', fontWeight: 500 }}>
            ✕ PDF error: {pdfError}
          </p>
        )}

        {/* ── Send to broker panel */}
        <div className="broker-send-panel" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 10 }}>
            Send Quote to Broker
          </p>
          <form className="broker-send-form" onSubmit={onSend} style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              type="email"
              placeholder="broker@example.com"
              value={brokerEmail}
              onChange={e => onBrokerEmailChange(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn btn--primary btn--sm"
              disabled={sending}
              style={{ flexShrink: 0 }}
            >
              {sending
                ? <><span className="spinner" />Sending…</>
                : '✉ Send'}
            </button>
          </form>
          {sendMessage && (
            <p style={{
              fontSize: 12,
              marginTop: 8,
              color: sendStatus === 'ok' ? 'var(--green)' : 'var(--red)',
              fontWeight: 500,
            }}>
              {sendStatus === 'ok' ? '✓ ' : '✕ '}{sendMessage}
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
