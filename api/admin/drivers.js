/**
 * /api/admin/drivers
 *
 * Routes by HTTP method + query / body parameters:
 *
 *   GET  /api/admin/drivers                         — list all drivers + stats
 *   GET  /api/admin/drivers?action=quotes&email=... — paginated quote history for a driver
 *   POST /api/admin/drivers  body: { action: 'toggle-status', email } — toggle active flag
 */

import redis from '../_lib/redis.js'
import { requireAdmin } from '../_lib/auth.js'
import { logAudit, AUDIT } from '../_lib/audit.js'

const PAGE_SIZE = 15

// ── GET: list drivers ─────────────────────────────────────────────────────────

async function handleList(req, res) {
  try {
    const keys = await redis.keys('users:*')

    if (!keys.length) {
      return res.status(200).json({
        drivers: [],
        stats: { total: 0, active: 0, deactivated: 0, platformQuotesSent: 0 },
      })
    }

    const records = await redis.mget(...keys)

    const drivers = records
      .filter(u => u && u.role === 'driver')
      .map(({ passwordHash: _, ...u }) => u)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // Fetch per-driver quote counts + platform total in one parallel batch
    const [platformTotal, ...quoteCounts] = await Promise.all([
      redis.get('quotes:platform:total'),
      ...drivers.map(d => redis.llen(`quotes:driver:${d.email}`)),
    ])

    const enriched = drivers.map((d, i) => ({
      ...d,
      active:     d.active !== false,   // undefined → true for legacy records
      quoteCount: Number(quoteCounts[i] ?? 0),
    }))

    const stats = {
      total:              enriched.length,
      active:             enriched.filter(d => d.active).length,
      deactivated:        enriched.filter(d => !d.active).length,
      platformQuotesSent: Number(platformTotal ?? 0),
    }

    return res.status(200).json({ drivers: enriched, stats })
  } catch (e) {
    console.error('GET /api/admin/drivers error:', e)
    return res.status(502).json({ error: 'Database error' })
  }
}

// ── GET: driver quote history ─────────────────────────────────────────────────

async function handleQuotes(req, res) {
  const { email, page: pageStr = '1' } = req.query ?? {}

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: '`email` query param is required' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const page            = Math.max(1, parseInt(pageStr, 10) || 1)

  try {
    // LPUSH order: index 0 is the newest quote ID
    const allIds = await redis.lrange(`quotes:driver:${normalizedEmail}`, 0, -1)
    const total  = allIds.length

    if (total === 0) {
      return res.status(200).json({ quotes: [], total: 0, page: 1, totalPages: 1 })
    }

    const totalPages = Math.ceil(total / PAGE_SIZE)
    const safePage   = Math.min(page, totalPages)
    const start      = (safePage - 1) * PAGE_SIZE
    const pageIds    = allIds.slice(start, start + PAGE_SIZE)

    const raw    = await redis.mget(...pageIds.map(id => `quote:${id}`))
    const quotes = raw.filter(Boolean)

    return res.status(200).json({ quotes, total, page: safePage, totalPages })
  } catch (e) {
    console.error('[driver-quotes]', e)
    return res.status(502).json({ error: 'Database error' })
  }
}

// ── POST: toggle driver active status ─────────────────────────────────────────

async function handleToggleStatus(req, res, admin) {
  const { email } = req.body ?? {}
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: '`email` is required' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  let user
  try {
    user = await redis.get(`users:${normalizedEmail}`)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  if (user.role !== 'driver') {
    return res.status(400).json({ error: 'Can only toggle status of driver accounts' })
  }

  // Toggle: undefined/true → false, false → true
  const newActive = user.active === false

  const updated = { ...user, active: newActive }

  try {
    await redis.set(`users:${normalizedEmail}`, updated)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  console.log(`[admin/drivers/toggle-status] ${normalizedEmail} → active: ${newActive}`)

  logAudit({
    action:      newActive ? AUDIT.DRIVER_ACTIVATED : AUDIT.DRIVER_DEACTIVATED,
    performedBy: admin.email,
    description: `Driver ${normalizedEmail} ${newActive ? 'activated' : 'deactivated'}`,
  })

  const { passwordHash: _, ...safeUser } = updated
  return res.status(200).json({ user: { ...safeUser, active: newActive } })
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const admin = requireAdmin(req, res)
  if (!admin) return

  // ── GET ───────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action } = req.query ?? {}
    if (action === 'quotes') return handleQuotes(req, res)
    return handleList(req, res)
  }

  // ── POST ──────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body ?? {}
    if (action === 'toggle-status') return handleToggleStatus(req, res, admin)
    return res.status(400).json({
      error:   '`action` must be: toggle-status',
      allowed: ['toggle-status'],
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
