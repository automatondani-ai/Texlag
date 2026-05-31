import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

const GROUPS = [
  {
    title: 'Interstate',
    fields: [
      { key: 'interstateCpm',           label: 'Driver CPM',       hint: 'Internal driver cost per mile — interstate loads. Used only for driver payout calculation.'   },
      { key: 'interstateBrokerCpm',     label: 'Broker CPM',       hint: 'Marked-up CPM charged to the broker — interstate loads. Used for the broker-facing quote total.' },
      { key: 'interstateTruckRate',     label: 'Truck Rate',       hint: 'Per-day truck charge billed on the broker quote'  },
      { key: 'interstateInsuranceRate', label: 'Insurance Rate',   hint: 'Per-day insurance charge — interstate loads'      },
      { key: 'interstateHazmatRate',    label: 'Hazmat Rate',      hint: 'Per-day hazmat surcharge — interstate loads (applied when Hazmat toggle is on)' },
    ],
  },
  {
    title: 'Intrastate',
    fields: [
      { key: 'intrastateCpm',           label: 'Driver CPM',       hint: 'Internal driver cost per mile — intrastate loads. Used only for driver payout calculation.'   },
      { key: 'intrastateBrokerCpm',     label: 'Broker CPM',       hint: 'Marked-up CPM charged to the broker — intrastate loads. Used for the broker-facing quote total.' },
      { key: 'intrastateTruckRate',     label: 'Truck Rate',       hint: 'Per-day truck charge billed on the broker quote'  },
      { key: 'intrastateInsuranceRate', label: 'Insurance Rate',   hint: 'Per-day insurance charge — intrastate loads'      },
      { key: 'intrastateHazmatRate',    label: 'Hazmat Rate',      hint: 'Per-day hazmat surcharge — intrastate loads (applied when Hazmat toggle is on)' },
    ],
  },
  {
    title: 'Operating Costs',
    fields: [
      { key: 'trailerHoldRate',       label: 'Trailer Hold Rate',              hint: 'Per-day trailer detention fee ($)'                        },
      { key: 'gasPricePerGallon',     label: 'Gas Price Per Gallon',           hint: 'Current market fuel price'                                },
      { key: 'mpg',                   label: 'Vehicle MPG (Miles Per Gallon)', hint: 'Avg fuel efficiency for heavy freight — default 6 mpg', prefix: '' },
      { key: 'speedMph',             label: 'Average Speed (mph)',            hint: 'Used to auto-calculate trip days: miles ÷ speed ÷ 11 hrs — default 65', prefix: '' },
      { key: 'driverAssistPerPallet', label: 'Driver Assist Fee (per pallet)', hint: 'Cost per pallet when driver assist is enabled — default $25.00' },
    ],
  },
]

const ALL_KEYS = GROUPS.flatMap(g => g.fields.map(f => f.key))

export default function PricingView() {
  const { getToken } = useAuth()
  const [rates,   setRates]   = useState({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  // Fetch current rates on mount; abort on unmount to avoid stale state updates
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/rates', {
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(d => setRates(d.rates ?? {}))
      .catch(e => { if (e.name !== 'AbortError') setError('Failed to load rates.') })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [getToken])

  function setField(key, val) {
    setRates(r => ({ ...r, [key]: val }))
    setSuccess('')
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const payload = {}
    for (const key of ALL_KEYS) {
      const v = parseFloat(rates[key])
      if (isNaN(v) || v < 0) {
        return setError(`"${key}" must be a valid non-negative number.`)
      }
      payload[key] = v
    }

    setSaving(true)
    try {
      const res  = await fetch('/api/rates', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRates(data.rates)
      setSuccess('Pricing variables saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <span className="spinner spinner--dark" />
      </div>
    )
  }

  return (
    <div className="view-page">
      <div className="view-page__header">
        <h2 className="view-page__title">Pricing Variables</h2>
        <p className="view-page__sub">
          Rates are applied live to all new quotes. Changes take effect immediately.
        </p>
      </div>

      {error   && <div className="banner banner--error">{error}</div>}
      {success && <div className="banner banner--success">{success}</div>}

      <form onSubmit={save}>
        {GROUPS.map(group => (
          <div key={group.title} className="card" style={{ marginBottom: 14 }}>
            <p className="card__title">{group.title}</p>
            <div className="rates-grid">
              {group.fields.map(({ key, label, hint, prefix = '$' }) => (
                <div key={key} className="field">
                  {/* htmlFor connects label to its input via matching id */}
                  <label className="label" htmlFor={`pricing-${key}`}>{label}</label>
                  {prefix ? (
                    <div className="input-prefix-wrap">
                      <span className="prefix">{prefix}</span>
                      <input
                        id={`pricing-${key}`}
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={rates[key] ?? ''}
                        onChange={e => setField(key, e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      id={`pricing-${key}`}
                      className="input"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={rates[key] ?? ''}
                      onChange={e => setField(key, e.target.value)}
                    />
                  )}
                  <span className="hint">{hint}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 6 }}>
          <button className="btn btn--teal" type="submit" disabled={saving}>
            {saving ? <><span className="spinner" />Saving…</> : 'Save Pricing'}
          </button>
        </div>
      </form>
    </div>
  )
}
