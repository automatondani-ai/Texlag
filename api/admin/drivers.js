import redis from '../_lib/redis.js'
import { requireAdmin } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const admin = requireAdmin(req, res)
  if (!admin) return

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
      total:               enriched.length,
      active:              enriched.filter(d => d.active).length,
      deactivated:         enriched.filter(d => !d.active).length,
      platformQuotesSent:  Number(platformTotal ?? 0),
    }

    return res.status(200).json({ drivers: enriched, stats })
  } catch (e) {
    console.error('GET /api/admin/drivers error:', e)
    return res.status(502).json({ error: 'Database error' })
  }
}
