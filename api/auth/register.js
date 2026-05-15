import bcrypt from 'bcryptjs'
import redis from '../_lib/redis.js'
import { requireAdmin } from '../_lib/auth.js'

const VALID_ROLES = ['admin', 'driver']
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Admin guard ─────────────────────────────────────────────────────────────
  const admin = requireAdmin(req, res)
  if (!admin) return // requireAdmin already sent the error response

  // ── Input validation ────────────────────────────────────────────────────────
  const {
    email,
    password,
    firstName,
    lastName,
    role = 'driver',
  } = req.body ?? {}

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'A valid `email` is required' })
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: '`password` must be at least 8 characters' })
  }
  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
    return res.status(400).json({ error: '`firstName` is required' })
  }
  if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
    return res.status(400).json({ error: '`lastName` is required' })
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({
      error: `\`role\` must be one of: ${VALID_ROLES.join(', ')}`,
    })
  }

  const normalizedEmail = String(email).toLowerCase().trim()

  // ── Duplicate check ─────────────────────────────────────────────────────────
  let existing
  try {
    existing = await redis.get(`users:${normalizedEmail}`)
  } catch (e) {
    return res.status(502).json({ error: 'Database error' })
  }

  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' })
  }

  // ── Persist ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 12)

  const user = {
    email:        normalizedEmail,
    firstName:    firstName.trim(),
    lastName:     lastName.trim(),
    role,
    passwordHash,
    createdAt:    new Date().toISOString(),
    createdBy:    admin.email,
  }

  try {
    await redis.set(`users:${normalizedEmail}`, user)
  } catch (e) {
    return res.status(502).json({ error: 'Database error' })
  }

  // Return the new account without the password hash
  const { passwordHash: _, ...safeUser } = user
  return res.status(201).json({ user: safeUser })
}
