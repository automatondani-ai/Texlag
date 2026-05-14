import { useState, useEffect } from 'react'

const FIELDS = [
  { key: 'cpm',          label: 'CPM (Cost Per Mile)',  hint: 'Base driver rate per mile'        },
  { key: 'gasSurcharge', label: 'Gas Surcharge',        hint: 'Fuel surcharge per mile'          },
  { key: 'hazmat',       label: 'Hazmat Surcharge',     hint: 'Per mile when hazmat is active'   },
  { key: 'tanker',       label: 'Tanker Surcharge',     hint: 'Per mile when tanker is active'   },
  { key: 'tolls',        label: 'Toll Flat Rate',       hint: 'Flat toll estimate per load'      },
]

export default function AdminView() {
  const [rates,       setRates]       = useState({})
  const [adminSecret, setAdminSecret] = useState('')
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')

  useEffect(() => {
    fetch('/api/rates')
      .then(r => r.json())
      .then(data => setRates(data.rates ?? {}))
      .catch(e  => setError('Failed to load rates: ' + e.message))
      .finally(  () => setLoading(false))
  }, [])

  async function save() {
    setError('')
    setSuccess('')

    if (!adminSecret.trim()) return setError('Enter the admin secret.')

    const payload = {}
    for (const { key, label } of FIELDS) {
      const v = parseFloat(rates[key])
      if (isNaN(v) || v < 0) return setError(`"${label}" must be a valid non-negative number.`)
      payload[key] = v
    }

    setSaving(true)
    try {
      const res = await fetch('/api/rates', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${adminSecret}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRates(data.rates)
      setSuccess('Rates updated successfully.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <span className="spinner spinner--dark" />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Rate Management</h1>
        <p className="page__subtitle">Update the freight rate variables stored in Vercel KV.</p>
      </div>

      {error   && <div className="banner banner--error">{error}</div>}
      {success && <div className="banner banner--success">{success}</div>}

      <div className="card">
        <p className="card__title">Rate Variables</p>
        <div className="rates-grid">
          {FIELDS.map(({ key, label, hint }) => (
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
                  onChange={e => setRates(r => ({ ...r, [key]: e.target.value }))}
                />
              </div>
              <span className="hint">{hint}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <p className="card__title">Authentication</p>
        <div className="field">
          <label className="label">Admin Secret</label>
          <input
            className="input"
            type="password"
            placeholder="Enter ADMIN_SECRET value"
            value={adminSecret}
            onChange={e => setAdminSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="btn btn--teal btn--full" onClick={save} disabled={saving}>
          {saving ? <><span className="spinner" />Saving&hellip;</> : 'Save Rates'}
        </button>
      </div>
    </div>
  )
}
