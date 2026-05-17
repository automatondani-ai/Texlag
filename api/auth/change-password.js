/**
 * POST /api/auth/change-password
 *
 * Body: { newPassword }
 * Auth: Bearer JWT (driver)
 *
 * Validates the new password against complexity rules, hashes it, and
 * updates the user record in Redis. Clears the mustChangePassword flag.
 */

import bcrypt from 'bcryptjs'
import redis  from '../_lib/redis.js'
import { verifyToken } from '../_lib/auth.js'

const RULES = [
  { id: 'len',     test: p => p.length >= 8,           msg: 'at least 8 characters'          },
  { id: 'upper',   test: p => /[A-Z]/.test(p),         msg: 'at least one uppercase letter'  },
  { id: 'number',  test: p => /[0-9]/.test(p),         msg: 'at least one number'            },
  { id: 'special', test: p => /[^A-Za-z0-9]/.test(p), msg: 'at least one special character' },
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  let caller
  try {
    caller = verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  // ── Validate new password ───────────────────────────────────────────────────
  const { newPassword } = req.body ?? {}

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: '`newPassword` is required' })
  }

  const failed = RULES.filter(r => !r.test(newPassword))
  if (failed.length) {
    return res.status(400).json({
      error:  'Password does not meet complexity requirements',
      failed: failed.map(r => r.msg),
    })
  }

  // ── Load user from Redis ────────────────────────────────────────────────────
  let user
  try {
    user = await redis.get(`users:${caller.email}`)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  // ── Hash and save ───────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(newPassword, 12)

  const updated = {
    ...user,
    passwordHash,
    mustChangePassword: false,
    passwordChangedAt:  new Date().toISOString(),
  }

  try {
    await redis.set(`users:${caller.email}`, updated)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  console.log('[change-password] password updated for:', caller.email)
  return res.status(200).json({ success: true })
}
