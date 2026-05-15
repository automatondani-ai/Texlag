import jwt from 'jsonwebtoken'

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
 * @param {import('http').IncomingMessage} req
 * @returns decoded payload
 */
export function verifyToken(req) {
  const header = req.headers['authorization'] ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header.trim()

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
 * Middleware-style guard: verifies the token and checks for the admin role.
 * Writes a 401/403 response and returns null if the check fails.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @returns decoded payload | null
 */
export function requireAdmin(req, res) {
  let payload
  try {
    payload = verifyToken(req)
  } catch (e) {
    res.status(e.status ?? 401).json({ error: e.message })
    return null
  }

  if (payload.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }

  return payload
}
