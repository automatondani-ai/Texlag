import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

const GROUPS = [
  {
    title: 'Interstate',
    fields: [
      { key: 'interstateCpm',       label: 'CPM',        hint: 'Driver cost per mile — interstate loads'         },
      { key: 'interstateTruckRate', label: 'Truck Rate',  hint: 'All-in rate billed to client per mile'           },
    ],
  },
  {
    title: 'Intrastate',
    fields: [
      { key: 'intrastateCpm',       label: 'CPM',        hint: 'Driver cost per mile — intrastate loads'         },
      { key: 'intrastateTruckRate', label: 'Truck Rate',  hint: 'All-in rate billed to client per mile'           },
    ],
  },
  {
    title: 'Operating Costs',
    fields: [
      { key: 'insuranceRate',       label: 'Insurance Rate',       hint: 'Per-mile insurance surcharge'           },
      { key: 'trailerHoldRate',     label: 'Trailer Hold Rate',    hint: 'Per-day trailer detention fee ($)'      },
      { key: 'gasPricePerGallon',   label: 'Gas Price Per Gallon', hint: 'Current market fuel price'              },
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

  useEffect(() => {
    fetch('/api/rates')
      .then(r => r.json())
      .then(d => setRates(d.rates ?? {}))
      .catch(() => setError('Failed to load rates.'))
      .finally(() => setLoading(false))
  }, [])

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
              {group.fields.map(({ key, label, hint }) => (
                <div key={key} className="field">
                  <label className="label">{label}</label>
                  <div className="input-prefix-wrap">
                    <span className="prefix">$</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates[key] ?? ''}
                      onChange={e => setField(key, e.target.value)}
                    />
                  </div>
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
