import bcrypt from 'bcryptjs'
import redis from '../_lib/redis.js'
import { signToken } from '../_lib/auth.js'

// Pre-generated bcrypt hash used when a user is not found, so the response
// time is indistinguishable from a real failed-password attempt (timing safety).
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCaBLzMNQXG0sDhf0oUAAv2'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body ?? {}

  // ── Input validation ────────────────────────────────────────────────────────
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: '`email` is required' })
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: '`password` is required' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  // ── Credential check ────────────────────────────────────────────────────────
  let user
  try {
    user = await redis.get(`users:${normalizedEmail}`)
  } catch (e) {
    return res.status(502).json({ error: 'Database error' })
  }

  // Always run bcrypt.compare to keep response time constant whether or not
  // the user exists — prevents user-enumeration via timing.
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH
  const match = await bcrypt.compare(password, hashToCheck)

  if (!user || !match) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  // ── Issue token ─────────────────────────────────────────────────────────────
  const claims = {
    email:     user.email,
    firstName: user.firstName,
    lastName:  user.lastName,
    role:      user.role,
  }

  let token
  try {
    token = signToken(claims)
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message })
  }

  return res.status(200).json({
    token,
    user:               claims,
    mustChangePassword: user.mustChangePassword === true,
  })
}
