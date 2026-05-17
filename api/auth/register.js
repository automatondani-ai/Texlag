import jwt    from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import redis  from '../_lib/redis.js'

const VALID_ROLES = ['admin', 'driver']
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE    = /^\+?[\d\s\-().]{7,20}$/

// ── Local auth: JWT admin OR ADMIN_SECRET bootstrap token ─────────────────────
//
// Scoped to this file only so the ADMIN_SECRET escape hatch never leaks into
// other admin-protected endpoints.  Priority order:
//   1. Valid JWT with role === 'admin'  → normal admin session
//   2. Bearer value === ADMIN_SECRET    → bootstrap (no admin account exists yet)
//
function authorizeRegister(req, res) {
  const header = req.headers['authorization'] ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header.trim()

  if (!token) {
    res.status(401).json({ error: 'Authorization token is required' })
    return null
  }

  // ── Try JWT first ────────────────────────────────────────────────────────────
  const secret = process.env.JWT_SECRET
  if (secret) {
    try {
      const payload = jwt.verify(token, secret)
      if (payload.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' })
        return null
      }
      return payload   // { email, firstName, lastName, role }
    } catch {
      // Not a valid JWT — fall through to ADMIN_SECRET check
    }
  }

  // ── Fall back to ADMIN_SECRET bootstrap token ────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET
  if (adminSecret && token === adminSecret) {
    return { email: 'system@bootstrap', role: 'admin' }
  }

  res.status(401).json({ error: 'Invalid token' })
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Admin guard ─────────────────────────────────────────────────────────────
  const admin = authorizeRegister(req, res)
  if (!admin) return

  // ── Input validation ────────────────────────────────────────────────────────
  const {
    email,
    password,
    firstName,
    lastName,
    phone    = '',
    role     = 'driver',
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
  if (phone && !PHONE_RE.test(String(phone).trim())) {
    return res.status(400).json({ error: '`phone` format is invalid' })
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
  } catch {
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
    phone:        phone ? String(phone).trim() : '',
    role,
    passwordHash,
    createdAt:    new Date().toISOString(),
    createdBy:    admin.email,
  }

  try {
    await redis.set(`users:${normalizedEmail}`, user)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  const { passwordHash: _, ...safeUser } = user
  return res.status(201).json({ user: safeUser })
}
