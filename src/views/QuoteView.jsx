import { useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import QuotePDF from '../components/QuotePDF'

const OPTIONS = [
  { key: 'hazmat', label: 'Hazmat' },
  { key: 'tanker', label: 'Tanker' },
  { key: 'tolls',  label: 'Tolls'  },
]

const fmt     = (n) => `$${Number(n).toFixed(2)}`
const fmtRate = (r) => `$${Number(r).toFixed(4)}/mi`

export default function QuoteView() {
  const [pickup,     setPickup]     = useState('')
  const [dropoffs,   setDropoffs]   = useState([''])
  const [driverMode, setDriverMode] = useState('solo')
  const [toggles,    setToggles]    = useState({ hazmat: false, tanker: false, tolls: false })
  const [loading,    setLoading]    = useState(false)
  const [quote,      setQuote]      = useState(null)
  const [error,      setError]      = useState('')

  function updateDropoff(i, val) {
    setDropoffs(d => d.map((v, j) => (j === i ? val : v)))
  }

  function removeDropoff(i) {
    setDropoffs(d => d.filter((_, j) => j !== i))
  }

  function flipToggle(key) {
    setToggles(t => ({ ...t, [key]: !t[key] }))
  }

  async function generate() {
    setError('')
    setQuote(null)

    if (!pickup.trim())              return setError('Enter a pickup location.')
    if (dropoffs.some(d => !d.trim())) return setError('Fill in all dropoff locations.')

    setLoading(true)
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup: pickup.trim(), dropoffs: dropoffs.map(d => d.trim()), driverMode, toggles }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setQuote(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Generate Quote</h1>
        <p className="page__subtitle">Enter route details to calculate a freight quote.</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {/* Route */}
      <div className="card">
        <p className="card__title">Route</p>

        <div className="field">
          <label className="label">Pickup</label>
          <input
            className="input"
            placeholder="City, State or full address"
            value={pickup}
            onChange={e => setPickup(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginTop: 18 }}>
          <label className="label">Dropoffs</label>
          <div className="stop-list">
            {dropoffs.map((val, i) => (
              <div key={i} className="stop-row">
                <span className="stop-badge">{i + 1}</span>
                <input
                  className="input"
                  placeholder={`Destination ${i + 1}`}
                  value={val}
                  onChange={e => updateDropoff(i, e.target.value)}
                />
                {dropoffs.length > 1 && (
                  <button
                    className="icon-btn icon-btn--danger"
                    onClick={() => removeDropoff(i)}
                    title="Remove stop"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="add-stop-btn" onClick={() => setDropoffs(d => [...d, ''])}>
            + Add stop
          </button>
        </div>
      </div>

      {/* Driver mode */}
      <div className="card">
        <p className="card__title">Driver</p>
        <div className="mode-toggle">
          {['solo', 'team'].map(mode => (
            <button
              key={mode}
              className={`mode-btn${driverMode === mode ? ' mode-btn--active' : ''}`}
              onClick={() => setDriverMode(mode)}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        {driverMode === 'team' && (
          <p className="mode-hint">Team loads bill at 2× CPM — internal cost remains single-driver basis.</p>
        )}
      </div>

      {/* Options */}
      <div className="card">
        <p className="card__title">Options</p>
        <div className="toggles-grid">
          {OPTIONS.map(({ key, label }) => (
            <div
              key={key}
              className={`toggle-chip${toggles[key] ? ' toggle-chip--on' : ''}`}
              onClick={() => flipToggle(key)}
            >
              <div className="switch">
                <div className="switch__knob" />
              </div>
              <span className="toggle-label">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="btn btn--primary btn--full" onClick={generate} disabled={loading}>
          {loading ? <><span className="spinner" />Calculating&hellip;</> : 'Generate Quote'}
        </button>
      </div>

      {quote && <QuoteResult quote={quote} />}
    </div>
  )
}

function QuoteResult({ quote }) {
  const [exporting, setExporting] = useState(false)
  const { lineItems } = quote
  const activeItems = Object.entries(lineItems).filter(([, v]) => v !== null)

  async function exportPDF() {
    setExporting(true)
    try {
      const blob = await pdf(<QuotePDF quote={quote} />).toBlob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${quote.quoteId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="quote-result">
      <div className="quote-result__header">
        <div className="quote-result__id">{quote.quoteId}</div>
        <div className="quote-result__route">
          {quote.pickup}&nbsp;&rarr;&nbsp;{quote.dropoffs.join(' → ')}
        </div>
        <div className="quote-result__meta">
          {quote.totalMiles} mi &middot; {quote.driverMode} driver &middot; {new Date(quote.generatedAt).toLocaleString()}
        </div>
      </div>

      <div className="quote-result__body">
        <table className="line-items">
          <thead>
            <tr>
              <th>Description</th>
              <th>Miles</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {activeItems.map(([key, item]) => (
              <tr key={key}>
                <td>
                  <div className="item-label">{item.label}</div>
                  {item.rate != null && (
                    <div className="item-rate">{fmtRate(item.rate)}</div>
                  )}
                </td>
                <td>{item.miles != null ? item.miles : '—'}</td>
                <td>{fmt(item.amount)}</td>
              </tr>
            ))}
            <tr className="line-items__divider"><td colSpan={3} /></tr>
            <tr className="line-items__subtotal">
              <td colSpan={2}>Mileage subtotal</td>
              <td>{fmt(quote.subtotalMileage)}</td>
            </tr>
            <tr className="line-items__total">
              <td colSpan={2}>Total Quote</td>
              <td>{fmt(quote.totalQuote)}</td>
            </tr>
          </tbody>
        </table>

        <div className="internal-row">
          <span className="internal-row__label">Internal Driver Cost</span>
          <span className="internal-row__value">{fmt(quote.internalDriverCost)}</span>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn--outline btn--sm"
            onClick={exportPDF}
            disabled={exporting}
          >
            {exporting
              ? <><span className="spinner spinner--dark" />Generating…</>
              : <>↓ Export PDF</>}
          </button>
        </div>
      </div>
    </div>
  )
}
