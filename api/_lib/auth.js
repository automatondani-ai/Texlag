import jwt   from 'jsonwebtoken'
import redis from './redis.js'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw Object.assign(new Error('JWT_SECRET is not configured'), { status: 500 })
  return secret
}

/**
 * Sign a JWT containing the user's public claims.
 * @param {{ email, firstName, lastName, role }} payload
 * @returns {string} signed token
 */
export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '8h' })
}

/**
 * Verify and decode a JWT from the Authorization header.
 * Throws an error with a `.status` property on failure.
 * This is the low-level primitive — prefer requireAuth() or requireAdmin()
 * for handler-level guards since those also check account liveness.
 *
 * @param {import('http').IncomingMessage} req
 * @returns decoded payload
 */
export function verifyToken(req) {
  const header = req.headers['authorization'] ?? ''
  const token  = (header.startsWith('Bearer ') ? header.slice(7) : header).trim()

  if (!token) {
    throw Object.assign(new Error('Authorization token is required'), { status: 401 })
  }

  try {
    return jwt.verify(token, getSecret())
  } catch (e) {
    const msg = e.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token'
    throw Object.assign(new Error(msg), { status: 401 })
  }
}

/**
 * Async auth guard for any authenticated endpoint (driver or admin).
 *
 * 1. Verifies the JWT signature and expiry.
 * 2. Fetches the user record from Redis to confirm the account still exists.
 * 3. Rejects deactivated accounts (active === false) with 403.
 * 4. Rejects tokens issued before the account's last password change, so
 *    changing a password immediately invalidates all older sessions.
 *
 * Writes a 4xx response and returns null on failure; returns the decoded
 * JWT payload on success.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @returns {Promise<object|null>} decoded payload or null
 */
export async function requireAuth(req, res) {
  let payload
  try {
    payload = verifyToken(req)
  } catch (e) {
    res.status(e.status ?? 401).json({ error: e.message })
    return null
  }

  let user
  try {
    user = await redis.get(`users:${payload.email}`)
  } catch {
    res.status(502).json({ error: 'Database error' })
    return null
  }

  if (!user) {
    res.status(401).json({ error: 'Account not found — please log in again' })
    return null
  }

  if (user.active === false) {
    res.status(403).json({ error: 'Account deactivated — contact your administrator' })
    return null
  }

  // Invalidate tokens issued before the most recent password change.
  // jwt sets `iat` (issued-at) in seconds; passwordChangedAt is an ISO string.
  if (user.passwordChangedAt && payload.iat) {
    const tokenIssuedAt  = new Date(payload.iat * 1000)
    const passwordChanged = new Date(user.passwordChangedAt)
    if (passwordChanged > tokenIssuedAt) {
      res.status(401).json({ error: 'Session expired — please log in again' })
      return null
    }
  }

  return payload
}

/**
 * Async auth guard for admin-only endpoints.
 * Performs the same liveness checks as requireAuth() and additionally
 * verifies that the decoded role is exactly 'admin'.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @returns {Promise<object|null>} decoded payload or null
 */
export async function requireAdmin(req, res) {
  const payload = await requireAuth(req, res)
  if (!payload) return null   // requireAuth already wrote the error response

  if (payload.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }

  return payload
}
