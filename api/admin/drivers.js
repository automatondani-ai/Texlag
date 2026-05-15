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
      return res.status(200).json({ drivers: [] })
    }

    // Fetch all user records in one round-trip
    const records = await redis.mget(...keys)

    const drivers = records
      .filter(u => u && u.role === 'driver')
      .map(({ passwordHash: _, ...u }) => u)        // strip hash before sending
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    return res.status(200).json({ drivers })
  } catch (e) {
    console.error('GET /api/admin/drivers error:', e)
    return res.status(502).json({ error: 'Database error' })
  }
}
