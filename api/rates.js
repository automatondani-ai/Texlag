import redis from './_lib/redis.js'
import { requireAdmin } from './_lib/auth.js'
import { logAudit, AUDIT } from './_lib/audit.js'

// ── Rate catalogue ──────────────────────────────────────────────────────────
//
// Each entry maps a Redis key suffix → public-facing camelCase name.
// Defaults apply when a key has never been written to KV.

const RATE_CATALOGUE = [
  // Jurisdiction-based rates shown in the Admin Pricing panel
  { kv: 'interstate_cpm',         client: 'interstateCpm',        default: 2.50 },
  { kv: 'intrastate_cpm',         client: 'intrastateCpm',        default: 2.00 },
  { kv: 'interstate_truck_rate',  client: 'interstateTruckRate',  default: 3.50 },
  { kv: 'intrastate_truck_rate',  client: 'intrastateTruckRate',  default: 3.00 },
  { kv: 'insurance_rate',         client: 'insuranceRate',        default: 0.15 },
  { kv: 'trailer_hold_rate',      client: 'trailerHoldRate',      default: 75.00 },
  { kv: 'gas_price_per_gallon',   client: 'gasPricePerGallon',    default: 3.85 },
  // Legacy per-mile surcharges consumed by /api/quote
  { kv: 'cpm',                    client: 'cpm',                  default: 1.85 },
  { kv: 'gas_surcharge',          client: 'gasSurcharge',         default: 0.18 },
  { kv: 'hazmat',                 client: 'hazmat',               default: 0.25 },
  { kv: 'tanker',                 client: 'tanker',               default: 0.20 },
  { kv: 'toll_flat',              client: 'tolls',                default: 35.00 },
]

const KV_TO_ENTRY     = Object.fromEntries(RATE_CATALOGUE.map(e => [e.kv,     e]))
const CLIENT_TO_ENTRY = Object.fromEntries(RATE_CATALOGUE.map(e => [e.client, e]))
const ALL_CLIENT_KEYS = RATE_CATALOGUE.map(e => e.client)

async function getCurrentRates() {
  const values = await Promise.all(
    RATE_CATALOGUE.map(e => redis.get(`rates:${e.kv}`))
  )
  return Object.fromEntries(
    RATE_CATALOGUE.map((e, i) => [e.client, Number(values[i] ?? e.default)])
  )
}

export default async function handler(req, res) {
  // ── GET — public, no auth required ─────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rates = await getCurrentRates()
      return res.status(200).json({ rates })
    } catch {
      return res.status(502).json({ error: 'Database error' })
    }
  }

  // ── POST — admin JWT required ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const admin = requireAdmin(req, res)
    if (!admin) return

    const body = req.body ?? {}

    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'Request body must include at least one rate field' })
    }

    // Reject unknown keys to catch typos before any writes happen
    const unknown = Object.keys(body).filter(k => !CLIENT_TO_ENTRY[k])
    if (unknown.length) {
      return res.status(400).json({
        error:   `Unknown rate field(s): ${unknown.join(', ')}`,
        allowed: ALL_CLIENT_KEYS,
      })
    }

    // Every supplied value must be a non-negative finite number
    const invalid = Object.entries(body).filter(
      ([, v]) => typeof v !== 'number' || !Number.isFinite(v) || v < 0
    )
    if (invalid.length) {
      return res.status(400).json({
        error:   'All rate values must be non-negative finite numbers',
        invalid: invalid.map(([k]) => k),
      })
    }

    try {
      await Promise.all(
        Object.entries(body).map(([clientKey, value]) =>
          redis.set(`rates:${CLIENT_TO_ENTRY[clientKey].kv}`, value)
        )
      )
    } catch {
      return res.status(502).json({ error: 'Database error' })
    }

    const updated   = await getCurrentRates()
    const changedKeys = Object.keys(body).join(', ')

    logAudit({
      action:      AUDIT.RATES_UPDATED,
      performedBy: admin.email,
      description: `Pricing rates updated: ${changedKeys}`,
    })

    return res.status(200).json({ rates: updated })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
