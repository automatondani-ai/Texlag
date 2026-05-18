/**
 * POST /api/auth
 *
 * Routes by the `action` field in the request body:
 *   action: 'login'           — authenticate and return JWT
 *   action: 'register'        — create a new user account (admin only)
 *   action: 'change-password' — update password for the authenticated caller
 */

import bcrypt      from 'bcryptjs'
import jwt         from 'jsonwebtoken'
import { Resend }  from 'resend'
import redis       from './_lib/redis.js'
import { signToken, verifyToken } from './_lib/auth.js'
import { logAudit, AUDIT }        from './_lib/audit.js'

// ── Shared constants ──────────────────────────────────────────────────────────

const DEFAULT_PASSWORD = 'Password@123'
const VALID_ROLES      = ['admin', 'driver']
const EMAIL_RE         = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE         = /^\+?[\d\s\-().]{7,20}$/

// Pre-generated bcrypt hash used when a user is not found so response time is
// indistinguishable from a real failed-password attempt (timing safety).
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCaBLzMNQXG0sDhf0oUAAv2'

const PW_RULES = [
  { id: 'len',     test: p => p.length >= 8,           msg: 'at least 8 characters'          },
  { id: 'upper',   test: p => /[A-Z]/.test(p),         msg: 'at least one uppercase letter'  },
  { id: 'number',  test: p => /[0-9]/.test(p),         msg: 'at least one number'            },
  { id: 'special', test: p => /[^A-Za-z0-9]/.test(p), msg: 'at least one special character' },
]

// ── action: 'login' ───────────────────────────────────────────────────────────

async function handleLogin(req, res) {
  const { email, password } = req.body ?? {}

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: '`email` is required' })
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: '`password` is required' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  let user
  try {
    user = await redis.get(`users:${normalizedEmail}`)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  // Always run bcrypt.compare to keep response time constant (timing safety)
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH
  const match = await bcrypt.compare(password, hashToCheck)

  if (!user || !match) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  if (user.active === false) {
    return res.status(403).json({ error: 'Account deactivated — contact your administrator' })
  }

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

// ── action: 'register' ────────────────────────────────────────────────────────

function authorizeRegister(req, res) {
  const header = req.headers['authorization'] ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header.trim()

  if (!token) {
    res.status(401).json({ error: 'Authorization token is required' })
    return null
  }

  const secret = process.env.JWT_SECRET
  if (secret) {
    try {
      const payload = jwt.verify(token, secret)
      if (payload.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' })
        return null
      }
      return payload
    } catch {
      // Not a valid JWT — fall through to ADMIN_SECRET check
    }
  }

  const adminSecret = process.env.ADMIN_SECRET
  if (adminSecret && token === adminSecret) {
    return { email: 'system@bootstrap', role: 'admin' }
  }

  res.status(401).json({ error: 'Invalid token' })
  return null
}

function buildWelcomeEmail(firstName, email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome to TexLag Express</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.09);">
          <tr>
            <td style="background:#1e293b;padding:28px 40px 24px;">
              <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;margin-bottom:6px;">
                TexLag Express
              </div>
              <div style="font-size:11px;color:#94a3b8;">
                USDOT Number: 3609656&nbsp;&nbsp;·&nbsp;&nbsp;MC-1229052&nbsp;&nbsp;·&nbsp;&nbsp;Phone: +1(832)-944-5199
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 28px;">
              <p style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 8px 0;">
                Welcome, ${firstName}!
              </p>
              <p style="font-size:13px;color:#64748b;margin:0 0 24px 0;">
                Your TexLag Express driver account has been created.
              </p>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 20px 0;">
                You can now log in to the driver portal using the credentials below.
                You will be asked to set a new password on your first login.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Username (Email)</div>
                    <div style="font-size:14px;font-weight:600;color:#1e293b;font-family:monospace;">${email}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Temporary Password</div>
                    <div style="font-size:14px;font-weight:600;color:#1e293b;font-family:monospace;">${DEFAULT_PASSWORD}</div>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:2px;margin-bottom:24px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="font-size:13px;color:#78350f;margin:0;line-height:1.6;">
                      <strong>Important:</strong> You will be required to set a new password when you first sign in.
                      Please keep your new password secure and do not share it.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0;">
                Regards,<br>
                <strong style="color:#1e293b;">TexLag Express Admin</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;">
              <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.8;text-align:center;">
                TexLag Express &nbsp;·&nbsp; USDOT Number: 3609656 &nbsp;·&nbsp; MC-1229052<br>
                Phone: +1(832)-944-5199
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function sendWelcomeEmail(firstName, email) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[auth/register] RESEND_API_KEY not set — skipping welcome email')
    return
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
  const resend    = new Resend(resendKey)
  try {
    const { data, error } = await resend.emails.send({
      from:    `TexLag Express <${fromEmail}>`,
      to:      [email],
      subject: 'Welcome to TexLag Express — Your Driver Account',
      html:    buildWelcomeEmail(firstName, email),
    })
    if (error) {
      console.error('[auth/register] Welcome email failed:', JSON.stringify(error))
    } else {
      console.log('[auth/register] Welcome email sent — messageId:', data?.id)
    }
  } catch (e) {
    console.error('[auth/register] Welcome email threw:', e.message)
  }
}

async function handleRegister(req, res) {
  const admin = authorizeRegister(req, res)
  if (!admin) return

  const {
    email,
    firstName,
    lastName,
    phone = '',
    role  = 'driver',
  } = req.body ?? {}

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'A valid `email` is required' })
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
    return res.status(400).json({ error: `\`role\` must be one of: ${VALID_ROLES.join(', ')}` })
  }

  const normalizedEmail = String(email).toLowerCase().trim()

  let existing
  try {
    existing = await redis.get(`users:${normalizedEmail}`)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' })
  }

  const passwordHash       = await bcrypt.hash(DEFAULT_PASSWORD, 12)
  const mustChangePassword = role === 'driver'

  const user = {
    email:              normalizedEmail,
    firstName:          firstName.trim(),
    lastName:           lastName.trim(),
    phone:              phone ? String(phone).trim() : '',
    role,
    passwordHash,
    mustChangePassword,
    createdAt:          new Date().toISOString(),
    createdBy:          admin.email,
  }

  try {
    await redis.set(`users:${normalizedEmail}`, user)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  logAudit({
    action:      AUDIT.DRIVER_CREATED,
    performedBy: admin.email,
    description: `Driver account created for ${firstName.trim()} ${lastName.trim()} (${normalizedEmail})`,
  })

  if (role === 'driver') {
    sendWelcomeEmail(firstName.trim(), normalizedEmail).catch(() => {})
  }

  const { passwordHash: _, ...safeUser } = user
  return res.status(201).json({ user: safeUser })
}

// ── action: 'change-password' ─────────────────────────────────────────────────

async function handleChangePassword(req, res) {
  let caller
  try {
    caller = verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  const { newPassword } = req.body ?? {}

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: '`newPassword` is required' })
  }

  const failed = PW_RULES.filter(r => !r.test(newPassword))
  if (failed.length) {
    return res.status(400).json({
      error:  'Password does not meet complexity requirements',
      failed: failed.map(r => r.msg),
    })
  }

  let user
  try {
    user = await redis.get(`users:${caller.email}`)
  } catch {
    return res.status(502).json({ error: 'Database error' })
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

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

  console.log('[auth/change-password] password updated for:', caller.email)

  logAudit({
    action:      AUDIT.PASSWORD_CHANGED,
    performedBy: caller.email,
    description: `Password changed for ${caller.email}`,
  })

  return res.status(200).json({ success: true })
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action } = req.body ?? {}

  switch (action) {
    case 'login':           return handleLogin(req, res)
    case 'register':        return handleRegister(req, res)
    case 'change-password': return handleChangePassword(req, res)
    default:
      return res.status(400).json({
        error:   '`action` must be one of: login, register, change-password',
        allowed: ['login', 'register', 'change-password'],
      })
  }
}
