import { useState, useRef, useEffect } from 'react'
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

const fmt    = n => `$${Number(n).toFixed(2)}`
// Matches US 5-digit ZIP  OR  Canadian postal code (FSA + LDU, optional space)
const ZIP_RE = /^(\d{5}|[A-Za-z]\d[A-Za-z][\s]?\d[A-Za-z]\d)$/

// ── Module-scope pure functions ──────────────────────────────────────────────
// These don't close over any component state so they live here rather than
// being re-created on every render.

/**
 * Extract the city portion from a full address string returned by Google Maps.
 * e.g. "Houston, TX, USA" → "Houston"  |  "Dallas, TX" → "Dallas"
 * Returns null if the string is empty or has no comma.
 */
function extractCity(address) {
  if (!address || typeof address !== 'string') return null
  const city = address.split(',')[0].trim()
  return city.length > 0 ? city : null
}

/**
 * Build the descriptive PDF filename from the quote's resolved location data.
 * Falls back to plain quoteId-only name if city names cannot be extracted.
 */
function pdfFilename(q) {
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

// ── Module-scope static lookup (moved from inside QuoteResultCard) ───────────
// Declared here so the object is allocated once, not on every render.

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

// ── Stable stop-ID generator ─────────────────────────────────────────────────
// Used to give each dropoff stop a stable id for React reconciliation.
// Module-level counter means ids are unique within the session even if stops
// are added/removed rapidly.

let _stopSeq = 0
const genStopId = () => `stop-${++_stopSeq}`

// ── Keyboard handler for toggle chips ───────────────────────────────────────
// Fires the provided toggle function when Enter or Space is pressed, matching
// the expected behaviour for role="switch" interactive elements.

function makeToggleKeyDown(handler) {
  return e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DriverQuoteForm() {
  const { getToken } = useAuth()

  // Route
  const [jurisdiction, setJurisdiction] = useState('interstate')
  const [pickup,       setPickup]       = useState('')
  // dropoffs: array of { id: string, value: string }
  // Using stable ids (not array index) so React correctly reconciles rows
  // when stops are inserted or removed mid-list.
  const [dropoffs,     setDropoffs]     = useState(() => [{ id: genStopId(), value: '' }])

  // ZIP auto-resolution state
  const [zipResolving, setZipResolving] = useState(() => new Set())
  const [zipWarning,   setZipWarning]   = useState(() => new Map())
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
  const [driverMode, setDriverMode] = useState('solo')

  // Load type
  const [loadType,              setLoadType]              = useState('palletized')
  const [numberOfPallets,       setNumberOfPallets]       = useState('')
  const [driverAssistManualFee, setDriverAssistManualFee] = useState('')
  const [driverAssistRate,      setDriverAssistRate]      = useState(25.00)

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
  const [sendStatus,   setSendStatus]   = useState('')
  const [sendMessage,  setSendMessage]  = useState('')

  // Fetch admin-set driver assist rate once on mount.
  // AbortController cancels the request on unmount to avoid stale state updates.
  useEffect(() => {
    const token = getToken()
    if (!token) return
    const controller = new AbortController()
    fetch('/api/rates', {
      headers: { Authorization: `Bearer ${token}` },
      signal:  controller.signal,
    })
      .then(r => r.json())
      .then(d => {
        const r = Number(d.rates?.driverAssistPerPallet)
        if (r > 0) setDriverAssistRate(r)
      })
      .catch(e => { if (e.name !== 'AbortError') { /* silently ignore rate fetch failure */ } })
    return () => controller.abort()
  }, [getToken])

  // ── Dropoff helpers ────────────────────────────────────────────────────────
  const updateDropoff = (stopId, v) => {
    setDropoffs(d => d.map(s => s.id === stopId ? { ...s, value: v } : s))
    scheduleZipResolve(`drop-${stopId}`, v, val => {
      setDropoffs(d => d.map(s => s.id === stopId ? { ...s, value: val } : s))
    })
  }
  const addDropoff    = () => setDropoffs(d => [...d, { id: genStopId(), value: '' }])
  const removeDropoff = stopId => {
    setDropoffs(d => d.filter(s => s.id !== stopId))
    clearTimeout(zipTimers.current[`drop-${stopId}`])
    delete zipTimers.current[`drop-${stopId}`]
    setZipWarning(m => { const n = new Map(m); n.delete(`drop-${stopId}`); return n })
    setZipResolving(s => { const n = new Set(s); n.delete(`drop-${stopId}`); return n })
  }

  // ── ZIP auto-resolution ────────────────────────────────────────────────────
  function scheduleZipResolve(key, value, setter) {
    clearTimeout(zipTimers.current[key])
    setZipWarning(m => {
      if (!m.has(key)) return m
      const n = new Map(m); n.delete(key); return n
    })
    if (!ZIP_RE.test(value.trim())) return
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
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
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
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

  // ── Download PDF ──────────────────────────────────────────────────────────
  async function downloadPDF() {
    if (!quote) return
    setPdfLoading(true)
    setPdfError('')
    try {
      const res = await fetch('/api/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ action: 'generate-pdf', quoteId: quote.quoteId }),
      })
      if (!res.ok) {
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
        body:    JSON.stringify({ action: 'send-quote', quoteId: quote.quoteId, brokerEmail: brokerEmail.trim() }),
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
    if (!pickup.trim())                              return setError('Enter a pickup location.')
    if (dropoffs.some(d => !d.value.trim()))        return setError('Fill in all drop-off locations.')
    const token = getToken()
    if (!token) return setError('Session expired — please log in again.')

    setQuoting(true)
    try {
      const res  = await fetch('/api/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          jurisdiction,
          pickup:               pickup.trim(),
          dropoffs:             dropoffs.map(d => d.value.trim()),
          driverMode,
          loadType,
          numberOfPallets:      Number(numberOfPallets) || 0,
          driverAssistManualFee:Number(driverAssistManualFee) || 0,
          trailerHoldDays:      Number(trailerHoldDays) || 0,
          deadheadMiles:        Number(deadheadMiles)   || 0,
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
            {/* htmlFor links label to input via matching id */}
            <label className="label" htmlFor="pickup-location">
              Pickup Location <span className="req" aria-hidden="true">*</span>
            </label>
            <div className="zip-field-wrap">
              <input
                id="pickup-location"
                className="input"
                placeholder="Address or ZIP code"
                value={pickup}
                onChange={e => {
                  const v = e.target.value
                  setPickup(v)
                  scheduleZipResolve('pickup', v, setPickup)
                }}
              />
              {zipResolving.has('pickup') && (
                <span className="zip-spinner"><span className="spinner spinner--dark" /></span>
              )}
            </div>
            {zipWarning.get('pickup') && (
              <span className="zip-warning">{zipWarning.get('pickup')}</span>
            )}
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            {/* Group label — htmlFor points to the first stop's input */}
            <label className="label" htmlFor="dropoff-first">
              Drop-offs <span className="req" aria-hidden="true">*</span>
            </label>
            <div className="stop-list">
              {dropoffs.map((stop, i) => (
                // Stable stop.id key prevents React from confusing rows on add/remove
                <div key={stop.id} className="stop-row">
                  <span className="stop-badge">{i + 1}</span>
                  <div className="zip-field-wrap" style={{ flex: 1 }}>
                    <input
                      id={i === 0 ? 'dropoff-first' : undefined}
                      className="input"
                      placeholder={`Destination ${i + 1}`}
                      value={stop.value}
                      onChange={e => updateDropoff(stop.id, e.target.value)}
                      aria-label={`Drop-off location ${i + 1}`}
                    />
                    {zipResolving.has(`drop-${stop.id}`) && (
                      <span className="zip-spinner"><span className="spinner spinner--dark" /></span>
                    )}
                  </div>
                  {dropoffs.length > 1 && (
                    <button type="button" className="icon-btn icon-btn--danger"
                      onClick={() => removeDropoff(stop.id)} title="Remove stop">×</button>
                  )}
                </div>
              ))}
              {/* Zip warnings keyed by stop id — stable across add/remove */}
              {dropoffs.map(stop => zipWarning.get(`drop-${stop.id}`) ? (
                <span key={`warn-${stop.id}`} className="zip-warning">
                  {zipWarning.get(`drop-${stop.id}`)}
                </span>
              ) : null)}
            </div>
            <button type="button" className="add-stop-btn" onClick={addDropoff}>+ Add stop</button>
          </div>
        </div>

        {/* ── 3. Trip details ────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Trip Details</p>

          <div className="field" style={{ marginBottom: 16 }}>
            {/* Load Type labels a group of buttons; role="group" announces the
                context to screen readers; aria-labelledby points to the label id */}
            <span id="load-type-label" className="label">Load Type</span>
            <div
              className="mode-toggle"
              role="group"
              aria-labelledby="load-type-label"
            >
              {[
                { value: 'palletized',     label: 'Palletized Load'     },
                { value: 'non-palletized', label: 'Non-Palletized Load' },
              ].map(({ value, label }) => (
                <button key={value} type="button"
                  className={`mode-btn${loadType === value ? ' mode-btn--active' : ''}`}
                  onClick={() => setLoadType(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="trip-details-grid">
            {loadType === 'palletized' && (
              <div className="field">
                <label className="label" htmlFor="num-pallets">Number of Pallets</label>
                <input
                  id="num-pallets"
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 12"
                  value={numberOfPallets}
                  onChange={e => setNumberOfPallets(e.target.value)}
                />
                <span className="hint">Used to calculate driver assist cost</span>
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="trailer-hold-days">Trailer Hold Days</label>
              <input
                id="trailer-hold-days"
                className="input"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={trailerHoldDays}
                onChange={e => setTrailerHoldDays(e.target.value)}
              />
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
              <label className="label" htmlFor="deadhead-miles-manual">Miles</label>
              <input
                id="deadhead-miles-manual"
                className="input"
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 45"
                value={deadheadMiles}
                onChange={e => setDeadheadMiles(e.target.value)}
              />
            </div>
          )}

          {/* Location-based */}
          {deadheadMode === 'location' && (
            <div style={{ marginTop: 16 }}>
              <div className="field">
                <label className="label" htmlFor="deadhead-origin">Your Current Location</label>
                <div className="deadhead-location-row">
                  <div className="zip-field-wrap" style={{ flex: 1 }}>
                    <input
                      id="deadhead-origin"
                      className="input"
                      placeholder="Address, ZIP, or postal code"
                      value={deadheadOrigin}
                      onChange={e => {
                        const v = e.target.value
                        setDeadheadOrigin(v)
                        scheduleZipResolve('deadhead', v, setDeadheadOrigin)
                      }}
                    />
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
                  <label className="label" htmlFor="deadhead-miles-loc">
                    Deadhead Miles <span className="label-opt">(editable)</span>
                  </label>
                  <input
                    id="deadhead-miles-loc"
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={deadheadMiles}
                    onChange={e => setDeadheadMiles(e.target.value)}
                  />
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
                  <label className="label" htmlFor="deadhead-miles-gps">
                    Deadhead Miles <span className="label-opt">(editable)</span>
                  </label>
                  <input
                    id="deadhead-miles-gps"
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={deadheadMiles}
                    onChange={e => setDeadheadMiles(e.target.value)}
                  />
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
            {/*
              role="switch" + aria-checked tell assistive technology this is a toggle.
              tabIndex={0} makes the div keyboard-focusable.
              onKeyDown fires the toggle on Enter or Space (standard switch behaviour).
            */}
            <div
              role="switch"
              aria-checked={driverAssist}
              tabIndex={0}
              className={`toggle-chip${driverAssist ? ' toggle-chip--on' : ''}`}
              onClick={() => setDriverAssist(v => !v)}
              onKeyDown={makeToggleKeyDown(() => setDriverAssist(v => !v))}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Driver Assist</span>
            </div>
          </div>
          {driverAssist && (
            loadType === 'palletized' && Number(numberOfPallets) > 0
              ? (
                <div className="option-sub-field">
                  <label className="label" htmlFor="driver-assist-fee-readonly" style={{ fontSize: 12, marginBottom: 4 }}>
                    Driver Assist Fee
                  </label>
                  <div className="input-prefix-wrap">
                    <span className="prefix" style={{ color: 'var(--gray-300)' }}>$</span>
                    <input
                      id="driver-assist-fee-readonly"
                      className="input"
                      type="text"
                      readOnly
                      value={(Number(numberOfPallets) * driverAssistRate).toFixed(2)}
                      style={{ background: 'var(--gray-50, #f8fafc)', color: 'var(--gray-500)', cursor: 'default' }}
                    />
                  </div>
                  <span className="hint">
                    Calculated: {numberOfPallets} pallet{Number(numberOfPallets) !== 1 ? 's' : ''} × ${driverAssistRate.toFixed(2)}/pallet
                  </span>
                </div>
              )
              : (
                <div className="option-sub-field">
                  <label className="label" htmlFor="driver-assist-fee-manual" style={{ fontSize: 12, marginBottom: 4 }}>
                    Driver Assist Fee ($)
                  </label>
                  <div className="input-prefix-wrap">
                    <span className="prefix">$</span>
                    <input
                      id="driver-assist-fee-manual"
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={driverAssistManualFee}
                      onChange={e => setDriverAssistManualFee(e.target.value)}
                    />
                  </div>
                </div>
              )
          )}

          <div className="option-divider" />

          {/* Detention */}
          <div className="option-row">
            <div
              role="switch"
              aria-checked={detention}
              tabIndex={0}
              className={`toggle-chip${detention ? ' toggle-chip--on' : ''}`}
              onClick={() => setDetention(v => !v)}
              onKeyDown={makeToggleKeyDown(() => setDetention(v => !v))}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Detention</span>
            </div>
          </div>
          {detention && (
            <div className="input-prefix-wrap option-sub-field">
              <span className="prefix">$</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                aria-label="Detention fee amount"
                value={detentionAmount}
                onChange={e => setDetentionAmount(e.target.value)}
              />
            </div>
          )}

          <div className="option-divider" />

          {/* Hazmat */}
          <div className="option-row">
            <div
              role="switch"
              aria-checked={hazmat}
              tabIndex={0}
              className={`toggle-chip${hazmat ? ' toggle-chip--on' : ''}`}
              onClick={() => setHazmat(v => !v)}
              onKeyDown={makeToggleKeyDown(() => setHazmat(v => !v))}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Hazmat</span>
            </div>
          </div>

          {/* Low/No Backhaul */}
          <div className="option-row">
            <div
              role="switch"
              aria-checked={lowBackhaul}
              tabIndex={0}
              className={`toggle-chip${lowBackhaul ? ' toggle-chip--on' : ''}`}
              onClick={() => {
                const next = !lowBackhaul
                setLowBackhaul(next)
                if (!next) setPartialBackhaul(false)
              }}
              onKeyDown={makeToggleKeyDown(() => {
                const next = !lowBackhaul
                setLowBackhaul(next)
                if (!next) setPartialBackhaul(false)
              })}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Low / No Backhaul</span>
            </div>
          </div>

          {/* Partial Backhaul */}
          {lowBackhaul && (
            <div className="option-row">
              <div
                role="switch"
                aria-checked={partialBackhaul}
                tabIndex={0}
                className={`toggle-chip${partialBackhaul ? ' toggle-chip--on' : ''}`}
                onClick={() => setPartialBackhaul(v => !v)}
                onKeyDown={makeToggleKeyDown(() => setPartialBackhaul(v => !v))}
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
            {/* Note text is stable module-level content — safe as key */}
            {OPERATIONAL_NOTES.map(note => (
              <li key={note} className="notes-list__item">{note}</li>
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
          <span style={{ fontWeight: 600 }}>Load Type: </span>
          {quote.loadType === 'non-palletized'
            ? 'Non-Palletized'
            : `Palletized${(quote.numberOfPallets ?? 0) > 0
                ? ` — ${quote.numberOfPallets} pallet${quote.numberOfPallets !== 1 ? 's' : ''}`
                : ''}`}
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

        {/* Generated-by + Download row */}
        <div className="quote-result__pdf-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
            Generated by {quote.driver?.firstName} {quote.driver?.lastName} &middot; {new Date(quote.generatedAt).toLocaleString()}
          </div>
          <button
            type="button"
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

        {/* Send to broker panel */}
        <div className="broker-send-panel" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 10 }}>
            Send Quote to Broker
          </p>
          <form className="broker-send-form" onSubmit={onSend} style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              type="email"
              placeholder="broker@example.com"
              aria-label="Broker email address"
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
