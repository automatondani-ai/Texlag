import { kv } from '@vercel/kv'

const RATE_KEYS = ['cpm', 'gas_surcharge', 'hazmat', 'tanker', 'toll_flat']

const DEFAULTS = {
  cpm:          1.85,
  gas_surcharge: 0.18,
  hazmat:        0.25,
  tanker:        0.20,
  toll_flat:    35.00,
}

// KV field name → public-facing JSON key
const KV_TO_CLIENT = {
  cpm:           'cpm',
  gas_surcharge: 'gasSurcharge',
  hazmat:        'hazmat',
  tanker:        'tanker',
  toll_flat:     'tolls',
}

// Public-facing JSON key → KV field name
const CLIENT_TO_KV = Object.fromEntries(
  Object.entries(KV_TO_CLIENT).map(([kv, client]) => [client, kv])
)

async function getCurrentRates() {
  const values = await Promise.all(RATE_KEYS.map(k => kv.get(`rates:${k}`)))

  return Object.fromEntries(
    RATE_KEYS.map((key, i) => [
      KV_TO_CLIENT[key],
      Number(values[i] ?? DEFAULTS[key]),
    ])
  )
}

function authorised(req) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  const header = req.headers['authorization'] ?? ''
  // Accept both "Bearer <secret>" and bare "<secret>"
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  return token === secret
}

export default async function handler(req, res) {
  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rates = await getCurrentRates()
    return res.status(200).json({ rates })
  }

  // ── POST ────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!process.env.ADMIN_SECRET) {
      return res.status(500).json({ error: 'ADMIN_SECRET environment variable is not set' })
    }
    if (!authorised(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const body = req.body ?? {}
    const allowed = Object.keys(KV_TO_CLIENT) // ['cpm','gas_surcharge',...]
      .map(k => KV_TO_CLIENT[k])              // client-facing names

    // Reject unknown keys to avoid silent typos
    const unknown = Object.keys(body).filter(k => !allowed.includes(k))
    if (unknown.length) {
      return res.status(400).json({
        error: `Unknown rate field(s): ${unknown.join(', ')}`,
        allowed,
      })
    }

    // Validate every supplied value is a finite positive number
    const invalid = Object.entries(body).filter(
      ([, v]) => typeof v !== 'number' || !Number.isFinite(v) || v < 0
    )
    if (invalid.length) {
      return res.status(400).json({
        error: 'All rate values must be non-negative finite numbers',
        invalid: invalid.map(([k]) => k),
      })
    }

    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'Request body must include at least one rate field' })
    }

    // Write only the fields that were supplied
    await Promise.all(
      Object.entries(body).map(([clientKey, value]) =>
        kv.set(`rates:${CLIENT_TO_KV[clientKey]}`, value)
      )
    )

    // Return the full updated rate set so the caller doesn't need a follow-up GET
    const updated = await getCurrentRates()
    return res.status(200).json({ rates: updated })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
