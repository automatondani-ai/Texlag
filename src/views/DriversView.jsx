import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '' }

function DriverRow({ driver }) {
  const joined = new Date(driver.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  return (
    <tr>
      <td>
        <div className="dt-name">{driver.firstName} {driver.lastName}</div>
      </td>
      <td>{driver.email}</td>
      <td>{driver.phone || <span className="dt-empty">—</span>}</td>
      <td>{joined}</td>
      <td>{driver.createdBy}</td>
    </tr>
  )
}

export default function DriversView() {
  const { getToken }  = useAuth()
  const [drivers,      setDrivers]     = useState([])
  const [loadingList,  setLoadingList]  = useState(true)
  const [listError,    setListError]    = useState('')
  const [showForm,     setShowForm]     = useState(false)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [creating,     setCreating]     = useState(false)
  const [formError,    setFormError]    = useState('')
  const [formSuccess,  setFormSuccess]  = useState('')

  const loadDrivers = useCallback(async () => {
    setLoadingList(true)
    setListError('')
    try {
      const res  = await fetch('/api/admin/drivers', {
        headers: { 'Authorization': `Bearer ${getToken()}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDrivers(data.drivers)
    } catch (e) {
      setListError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [getToken])

  useEffect(() => { loadDrivers() }, [loadDrivers])

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
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ ...form, role: 'driver' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setFormSuccess(`Driver ${data.user.firstName} ${data.user.lastName} created.`)
      setForm(EMPTY_FORM)
      setShowForm(false)
      loadDrivers()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="view-page">

      {/* Header */}
      <div className="view-page__header view-page__header--row">
        <div>
          <h2 className="view-page__title">Driver Management</h2>
          <p className="view-page__sub">
            {drivers.length} driver{drivers.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <button
          className={`btn ${showForm ? 'btn--outline' : 'btn--primary'} btn--sm`}
          onClick={() => { setShowForm(s => !s); setFormError(''); setFormSuccess('') }}
        >
          {showForm ? '✕ Cancel' : '+ New Driver'}
        </button>
      </div>

      {/* Global success after form closes */}
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
                <label className="label">First Name</label>
                <input className="input" placeholder="Jane" value={form.firstName}
                  onChange={e => setField('firstName', e.target.value)} required />
              </div>
              <div className="field">
                <label className="label">Last Name</label>
                <input className="input" placeholder="Smith" value={form.lastName}
                  onChange={e => setField('lastName', e.target.value)} required />
              </div>
              <div className="field">
                <label className="label">Email</label>
                <input className="input" type="email" placeholder="jane@texlag.com" value={form.email}
                  onChange={e => setField('email', e.target.value)} required />
              </div>
              <div className="field">
                <label className="label">Phone Number <span className="label-opt">(optional)</span></label>
                <input className="input" type="tel" placeholder="+1 555 000 0000" value={form.phone}
                  onChange={e => setField('phone', e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="hint" style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                  A temporary password will be set automatically and emailed to the driver.
                  They will be required to change it on first login.
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

      {/* Drivers table */}
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
                <th>Joined</th>
                <th>Created by</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => <DriverRow key={d.email} driver={d} />)}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
