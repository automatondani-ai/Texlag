import { useState } from 'react'
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

const DETENTION_COMPLIANCE =
  'Under FMCSA regulations, undue delay of a commercial motor vehicle driver is prohibited. ' +
  'Shippers and receivers must load/unload within the agreed free time. ' +
  'Delays beyond the free period must be logged and may be subject to carrier detention charges ' +
  'per the Rate Confirmation. All detention claims require dispatch authorisation and documented ' +
  'on-site wait times signed by the facility representative.'

const DEADHEAD_MODES = [
  { value: 'manual',   label: 'Manual Miles'   },
  { value: 'location', label: 'Location-Based'  },
  { value: 'gps',      label: 'GPS Ping'        },
]

const fmt     = n  => `$${Number(n).toFixed(2)}`
const fmtRate = r  => `$${Number(r).toFixed(4)}/mi`

// ── Component ───────────────────────────────────────────────────────────────

export default function DriverQuoteForm() {
  const { getToken } = useAuth()

  // Route
  const [jurisdiction,    setJurisdiction]    = useState('interstate')
  const [pickup,          setPickup]          = useState('')
  const [dropoffs,        setDropoffs]        = useState([''])

  // Trip details
  const [tripDays,        setTripDays]        = useState('')
  const [trailerHoldDays, setTrailerHoldDays] = useState('')

  // Deadhead
  const [deadheadMode,    setDeadheadMode]    = useState('manual')
  const [deadheadMiles,   setDeadheadMiles]   = useState('')
  const [deadheadOrigin,  setDeadheadOrigin]  = useState('')
  const [deadheadLoading, setDeadheadLoading] = useState(false)
  const [deadheadStatus,  setDeadheadStatus]  = useState('')

  // Driver
  const [driverMode,      setDriverMode]      = useState('solo')

  // Toggles
  const [driverAssist,       setDriverAssist]       = useState(false)
  const [driverAssistAmount, setDriverAssistAmount] = useState('')
  const [detention,          setDetention]          = useState(false)
  const [detentionAmount,    setDetentionAmount]    = useState('')
  const [lowBackhaul,        setLowBackhaul]        = useState(false)

  // Quote output
  const [quoting, setQuoting] = useState(false)
  const [quote,   setQuote]   = useState(null)
  const [error,   setError]   = useState('')

  // ── Dropoff helpers ────────────────────────────────────────────────────────
  const updateDropoff = (i, v) => setDropoffs(d => d.map((x, j) => j === i ? v : x))
  const addDropoff    = ()     => setDropoffs(d => [...d, ''])
  const removeDropoff = i     => setDropoffs(d => d.filter((_, j) => j !== i))

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

  // ── Quote generation ───────────────────────────────────────────────────────
  async function generate(e) {
    e.preventDefault()
    setError('')
    setQuote(null)
    if (!pickup.trim())                  return setError('Enter a pickup location.')
    if (dropoffs.some(d => !d.trim()))   return setError('Fill in all drop-off locations.')

    setQuoting(true)
    try {
      const res  = await fetch('/api/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body:    JSON.stringify({
          jurisdiction,
          pickup:          pickup.trim(),
          dropoffs:        dropoffs.map(d => d.trim()),
          driverMode,
          tripDays:        Number(tripDays)        || 0,
          trailerHoldDays: Number(trailerHoldDays) || 0,
          deadheadMiles:   Number(deadheadMiles)   || 0,
          toggles: {
            hazmat:       false,
            tanker:       false,
            tolls:        false,
            driverAssist,
            detention,
            lowBackhaul,
          },
          extras: {
            driverAssistAmount: driverAssist ? Number(driverAssistAmount) || 0 : 0,
            detentionAmount:    detention    ? Number(detentionAmount)    || 0 : 0,
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
            <label className="label">Pickup Location</label>
            <input className="input" placeholder="Address or ZIP code"
              value={pickup} onChange={e => setPickup(e.target.value)} />
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label className="label">Drop-offs</label>
            <div className="stop-list">
              {dropoffs.map((val, i) => (
                <div key={i} className="stop-row">
                  <span className="stop-badge">{i + 1}</span>
                  <input className="input" placeholder={`Destination ${i + 1}`}
                    value={val} onChange={e => updateDropoff(i, e.target.value)} />
                  {dropoffs.length > 1 && (
                    <button type="button" className="icon-btn icon-btn--danger"
                      onClick={() => removeDropoff(i)} title="Remove stop">×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="add-stop-btn" onClick={addDropoff}>+ Add stop</button>
          </div>
        </div>

        {/* ── 3. Trip details ────────────────────────────────────────────── */}
        <div className="card">
          <p className="card__title">Trip Details</p>
          <div className="trip-details-grid">
            <div className="field">
              <label className="label">Estimated Trip Days</label>
              <input className="input" type="number" min="0" step="1" placeholder="e.g. 3"
                value={tripDays} onChange={e => setTripDays(e.target.value)} />
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
                onClick={() => { setDeadheadMode(value); setDeadheadStatus('') }}>
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
                  <input className="input" placeholder="Address or ZIP code"
                    value={deadheadOrigin} onChange={e => setDeadheadOrigin(e.target.value)} />
                  <button type="button" className="btn btn--outline btn--sm"
                    onClick={calcDeadheadByAddress} disabled={deadheadLoading}>
                    {deadheadLoading
                      ? <span className="spinner spinner--dark" />
                      : 'Calculate'}
                  </button>
                </div>
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
            {driverAssist && (
              <div className="input-prefix-wrap option-amount">
                <span className="prefix">$</span>
                <input className="input" type="number" min="0" step="0.01" placeholder="0.00"
                  value={driverAssistAmount} onChange={e => setDriverAssistAmount(e.target.value)} />
              </div>
            )}
          </div>

          <div className="option-divider" />

          {/* Detention */}
          <div className="option-col">
            <div className="option-row">
              <div
                className={`toggle-chip${detention ? ' toggle-chip--on' : ''}`}
                onClick={() => setDetention(v => !v)}
              >
                <div className="switch"><div className="switch__knob" /></div>
                <span className="toggle-label">Detention</span>
              </div>
              {detention && (
                <div className="input-prefix-wrap option-amount">
                  <span className="prefix">$</span>
                  <input className="input" type="number" min="0" step="0.01" placeholder="0.00"
                    value={detentionAmount} onChange={e => setDetentionAmount(e.target.value)} />
                </div>
              )}
            </div>
            {!detention && (
              <p className="detention-compliance">{DETENTION_COMPLIANCE}</p>
            )}
          </div>

          <div className="option-divider" />

          {/* Low/No Backhaul */}
          <div className="option-row">
            <div
              className={`toggle-chip${lowBackhaul ? ' toggle-chip--on' : ''}`}
              onClick={() => setLowBackhaul(v => !v)}
            >
              <div className="switch"><div className="switch__knob" /></div>
              <span className="toggle-label">Low / No Backhaul</span>
            </div>
          </div>
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
      {quote && <QuoteResultCard quote={quote} />}
    </div>
  )
}

// ── Inline result display ────────────────────────────────────────────────────

function QuoteResultCard({ quote }) {
  const activeItems = Object.entries(quote.lineItems ?? {}).filter(([, v]) => v !== null)

  // Secondary descriptor shown under the label: rate/mi or rate/day
  function itemMeta(item) {
    if (item.days  != null) return `${item.days} day${item.days !== 1 ? 's' : ''}`
    if (item.miles != null) return `${item.miles} mi`
    return null
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
                  <div className="item-label">{item.label}</div>
                </td>
                <td style={{ textAlign: 'right', color: 'var(--gray-400)', fontSize: 12 }}>
                  {itemMeta(item) ?? '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(item.amount)}</td>
              </tr>
            ))}

            <tr className="line-items__divider"><td colSpan={3} /></tr>

            <tr className="line-items__subtotal">
              <td colSpan={2}>Core subtotal</td>
              <td style={{ textAlign: 'right' }}>{fmt(quote.coreSubtotal)}</td>
            </tr>

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

        <div className="internal-row">
          <span className="internal-row__label">Internal Driver Cost (single-driver payable)</span>
          <span className="internal-row__value">{fmt(quote.internalDriverCost)}</span>
        </div>

        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 10 }}>
          Generated by {quote.driver?.firstName} {quote.driver?.lastName} &middot; {new Date(quote.generatedAt).toLocaleString()}
        </div>
      </div>
    </div>
  )
}
