/**
 * GET /api/admin/audit-log?page=1&limit=25
 *
 * Auth: Admin JWT
 *
 * Returns paginated audit log entries, newest first.
 * Entries are stored in the Redis list `audit_log:index` by audit.js.
 */

import redis from '../_lib/redis.js'
import { requireAdmin } from '../_lib/auth.js'

const DEFAULT_LIMIT = 25

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const admin = requireAdmin(req, res)
  if (!admin) return

  const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  try {
    const total = await redis.llen('audit_log:index')

    if (total === 0) {
      return res.status(200).json({ entries: [], total: 0, page: 1, totalPages: 1 })
    }

    const totalPages = Math.ceil(total / limit)
    const safePage   = Math.min(page, totalPages)
    const start      = (safePage - 1) * limit
    const stop       = start + limit - 1

    const raw     = await redis.lrange('audit_log:index', start, stop)
    // Upstash auto-parses JSON; guard for any raw strings just in case.
    const entries = raw.map(e => (typeof e === 'string' ? JSON.parse(e) : e))

    return res.status(200).json({ entries, total, page: safePage, totalPages })
  } catch (e) {
    console.error('[audit-log]', e)
    return res.status(502).json({ error: 'Database error' })
  }
}
