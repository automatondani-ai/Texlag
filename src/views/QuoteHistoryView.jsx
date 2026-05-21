import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'

const fmt    = n  => `$${Number(n ?? 0).toFixed(2)}`
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Extract first comma-segment from a Google Maps address string.
// "Houston, TX, USA" → "Houston"  |  raw ZIP → left as-is
function cityOf(addr) {
  if (!addr) return '?'
  const seg = addr.split(',')[0].trim()
  return seg || addr
}

// "2026-05-21T..." → { year: 2026, month: 5 }
function dateParts(iso) {
  const d = new Date(iso)
  return isNaN(d) ? null : { year: d.getFullYear(), month: d.getMonth() + 1 }
}

// "2026-05-21T..." → "May 21, 2026"
function fmtDate(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function QuoteHistoryView() {
  const { getToken } = useAuth()

  const [quotes,      setQuotes]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [wonUpdating, setWonUpdating] = useState(() => new Set())   // quoteIds in-flight

  // Filter state
  const [filterMonth, setFilterMonth] = useState('')   // '' | '1'..'12'
  const [filterYear,  setFilterYear]  = useState('')   // '' | '2025'..'2xxx'

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    fetch('/api/driver/quotes', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) throw new Error(d.error)
        // Sort newest first by generatedAt (should already be, but guarantee)
        const sorted = [...(d.quotes ?? [])].sort(
          (a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)
        )
        setQuotes(sorted)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [getToken])

  // ── Derived filter options ────────────────────────────────────────────────
  const { availableYears, availableMonths } = useMemo(() => {
    const yearSet  = new Set()
    const monthSet = new Set()
    quotes.forEach(q => {
      const p = dateParts(q.generatedAt)
      if (p) {
        yearSet.add(p.year)
        monthSet.add(p.month)
      }
    })
    return {
      availableYears:  [...yearSet].sort((a, b) => b - a),
      availableMonths: [...monthSet].sort((a, b) => a - b),
    }
  }, [quotes])

  // ── Filtered quotes ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return quotes.filter(q => {
      const p = dateParts(q.generatedAt)
      if (!p) return true
      if (filterYear  && p.year  !== Number(filterYear))  return false
      if (filterMonth && p.month !== Number(filterMonth)) return false
      return true
    })
  }, [quotes, filterYear, filterMonth])

  // ── Earnings summary (won quotes only) ───────────────────────────────────
  const wonQuotes = useMemo(() => filtered.filter(q => q.won), [filtered])

  const totalWonBroker = useMemo(
    () => wonQuotes.reduce((s, q) => s + Number(q.brokerTotal ?? q.finalQuote ?? 0), 0),
    [wonQuotes]
  )
  const totalWonDriver = useMemo(
    () => wonQuotes.reduce((s, q) => s + Number(q.internalDriverCost ?? 0), 0),
    [wonQuotes]
  )

  // ── Won toggle ────────────────────────────────────────────────────────────
  async function toggleWon(quoteId, currentWon) {
    const next = !currentWon

    // Optimistic update
    setQuotes(qs => qs.map(q => q.quoteId === quoteId ? { ...q, won: next } : q))
    setWonUpdating(s => new Set(s).add(quoteId))

    try {
      const res  = await fetch('/api/driver/quotes', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ quoteId, won: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Reconcile with server response
      setQuotes(qs => qs.map(q => q.quoteId === quoteId ? data.quote : q))
    } catch (e) {
      // Revert on failure
      setQuotes(qs => qs.map(q => q.quoteId === quoteId ? { ...q, won: currentWon } : q))
      console.error('[QuoteHistory] toggleWon error:', e.message)
    } finally {
      setWonUpdating(s => { const n = new Set(s); n.delete(quoteId); return n })
    }
  }

  function clearFilters() {
    setFilterMonth('')
    setFilterYear('')
  }

  const hasFilters = filterMonth !== '' || filterYear !== ''

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="qh-loading">
        <span className="spinner spinner--dark" />
        <span>Loading quote history…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qh-page">
        <div className="banner banner--error">{error}</div>
      </div>
    )
  }

  return (
    <div className="qh-page">

      {/* ── Earnings summary — only shown when ≥1 won quote is in view ── */}
      {wonQuotes.length > 0 && (
        <div className="qh-summary">
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

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      {quotes.length > 0 && (
        <div className="qh-filters">
          <div className="qh-filters__group">
            <label className="qh-filters__label">Month</label>
            <select
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
            <label className="qh-filters__label">Year</label>
            <select
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
            <button className="btn btn--outline btn--sm qh-filters__clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}

          <span className="qh-filters__count">
            {filtered.length} quote{filtered.length !== 1 ? 's' : ''}
            {hasFilters ? ' matching' : ' total'}
          </span>
        </div>
      )}

      {/* ── Quote list ───────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="qh-empty">
          {quotes.length === 0
            ? 'No quotes generated yet. Generate your first quote above.'
            : 'No quotes match the selected filters.'}
        </div>
      ) : (
        <div className="qh-list">
          {filtered.map(q => {
            const from   = cityOf(q.pickup)
            const to     = cityOf(q.dropoffs?.[q.dropoffs.length - 1])
            const isWon  = !!q.won
            const inFlight = wonUpdating.has(q.quoteId)

            return (
              <div key={q.quoteId} className={`qh-row${isWon ? ' qh-row--won' : ''}`}>
                {/* Left: ID + date + route */}
                <div className="qh-row__info">
                  <div className="qh-row__top">
                    <code className="quote-id-code">{q.quoteId}</code>
                    <span className="qh-row__date">{fmtDate(q.generatedAt)}</span>
                  </div>
                  <div className="qh-row__route">
                    <span className="qh-route-city">{from}</span>
                    <span className="qh-route-arrow">→</span>
                    <span className="qh-route-city">{to}</span>
                  </div>
                </div>

                {/* Right: amount + won status */}
                <div className="qh-row__right">
                  <div className="qh-row__amount">{fmt(q.brokerTotal ?? q.finalQuote)}</div>
                  <button
                    className={`qh-won-btn${isWon ? ' qh-won-btn--on' : ''}`}
                    onClick={() => toggleWon(q.quoteId, isWon)}
                    disabled={inFlight}
                    title={isWon ? 'Click to unmark as won' : 'Click to mark as won'}
                  >
                    {inFlight ? (
                      <span className="spinner spinner--dark" style={{ width: 12, height: 12 }} />
                    ) : isWon ? (
                      '✓ Won'
                    ) : (
                      'Pending'
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
