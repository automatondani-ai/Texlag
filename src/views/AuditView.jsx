import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

// ── Action metadata ───────────────────────────────────────────────────────────

const ACTION_META = {
  DRIVER_CREATED:           { label: 'Driver Created',      color: 'blue'   },
  DRIVER_ACTIVATED:         { label: 'Driver Activated',    color: 'green'  },
  DRIVER_DEACTIVATED:       { label: 'Driver Deactivated',  color: 'red'    },
  RATES_UPDATED:            { label: 'Rates Updated',       color: 'amber'  },
  QUOTE_GENERATED:          { label: 'Quote Generated',     color: 'teal'   },
  QUOTE_EMAILED:            { label: 'Quote Emailed',       color: 'teal'   },
  PASSWORD_CHANGED:         { label: 'Password Changed',    color: 'gray'   },
  PASSWORD_RESET_REQUESTED: { label: 'Reset Requested',     color: 'amber'  },
  PASSWORD_RESET_COMPLETED: { label: 'Password Reset',      color: 'green'  },
}

function ActionBadge({ action }) {
  const meta  = ACTION_META[action] ?? { label: action, color: 'gray' }
  return (
    <span className={`audit-badge audit-badge--${meta.color}`}>
      {meta.label}
    </span>
  )
}

function fmtTimestamp(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

export default function AuditView() {
  const { getToken } = useAuth()

  const [entries,    setEntries]    = useState([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')

  const fetchPage = useCallback(async (p) => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(
        `/api/admin/audit-log?page=${p}&limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setEntries(data.entries)
      setTotal(data.total)
      setTotalPages(data.totalPages)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { fetchPage(page) }, [page, fetchPage])

  return (
    <div className="view-page">
      <div className="view-page__header">
        <h2 className="view-page__title">Audit Trail</h2>
        <p className="view-page__sub">
          System-wide activity log — {total} event{total !== 1 ? 's' : ''} recorded. Newest first.
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <span className="spinner spinner--dark" />
        </div>
      ) : entries.length === 0 ? (
        <div className="dt-empty-state">No audit events recorded yet.</div>
      ) : (
        <>
          <div className="dt-wrap">
            <table className="dt audit-table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Timestamp</th>
                  <th>Action</th>
                  <th>Performed By</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={`${entry.timestamp}-${i}`}>
                    <td className="audit-ts">{fmtTimestamp(entry.timestamp)}</td>
                    <td><ActionBadge action={entry.action} /></td>
                    <td className="audit-by">{entry.performedBy}</td>
                    <td className="audit-desc">{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn--sm btn--outline"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >← Prev</button>
              <span className="pagination__info">
                Page {page} of {totalPages} &nbsp;·&nbsp; {total} events
              </span>
              <button
                className="btn btn--sm btn--outline"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
