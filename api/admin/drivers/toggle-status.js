/**
 * POST /api/admin/drivers/toggle-status
 *
 * Body: { email }
 * Auth: Admin JWT
 *
 * Toggles the `active` flag on a driver record.
 * Deactivated drivers cannot log in.
 */

import redis from '../../_lib/redis.js'
import { requireAdmin } from '../../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const admin = requireAdmin(req, res)
  if (!admin) return

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

  console.log(`[toggle-status] ${normalizedEmail} → active: ${newActive}`)

  const { passwordHash: _, ...safeUser } = updated
  return res.status(200).json({ user: { ...safeUser, active: newActive } })
}
