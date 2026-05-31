import redis              from './_lib/redis.js'
import { requireAdmin }  from './_lib/auth.js'
import { verifyToken }   from './_lib/auth.js'
import { logAudit, AUDIT } from './_lib/audit.js'
import { setSecurityHeaders } from './_lib/headers.js'

// ── Rate catalogue ──────────────────────────────────────────────────────────
//
// Each entry maps a Redis key suffix → public-facing camelCase name.
// Defaults apply when a key has never been written to KV.

const RATE_CATALOGUE = [
  { kv: 'interstate_cpm',         client: 'interstateCpm',        default: 2.50 },
  { kv: 'interstate_broker_cpm',  client: 'interstateBrokerCpm',  default: 3.50 },
  { kv: 'intrastate_cpm',         client: 'intrastateCpm',        default: 2.00 },
  { kv: 'intrastate_broker_cpm',  client: 'intrastateBrokerCpm',  default: 2.75 },
  { kv: 'interstate_truck_rate',  client: 'interstateTruckRate',  default: 3.50 },
  { kv: 'intrastate_truck_rate',  client: 'intrastateTruckRate',  default: 3.00 },
  { kv: 'interstate_insurance_rate',  client: 'interstateInsuranceRate',  default: 0.15 },
  { kv: 'intrastate_insurance_rate',  client: 'intrastateInsuranceRate',  default: 0.15 },
  { kv: 'interstate_hazmat_rate',     client: 'interstateHazmatRate',     default: 0.25 },
  { kv: 'intrastate_hazmat_rate',     client: 'intrastateHazmatRate',     default: 0.25 },
  { kv: 'trailer_hold_rate',          client: 'trailerHoldRate',          default: 75.00 },
  { kv: 'gas_price_per_gallon',   client: 'gasPricePerGallon',    default: 3.85 },
  { kv: 'mpg',                    client: 'mpg',                  default: 6    },
  { kv: 'speed_mph',              client: 'speedMph',             default: 65   },
  { kv: 'driver_assist_per_pallet', client: 'driverAssistPerPallet', default: 25.00 },
  // Legacy per-mile surcharges consumed by /api/quote
  { kv: 'cpm',                    client: 'cpm',                  default: 1.85 },
  { kv: 'gas_surcharge',          client: 'gasSurcharge',         default: 0.18 },
  { kv: 'hazmat',                 client: 'hazmat',               default: 0.25 },
  { kv: 'tanker',                 client: 'tanker',               default: 0.20 },
  { kv: 'toll_flat',              client: 'tolls',                default: 35.00 },
]

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
  setSecurityHeaders(res)

  // ── GET — requires any valid JWT ────────────────────────────────────────────
  // Pricing rates are confidential business data; unauthenticated access is not
  // permitted even though the frontend reads them on mount.
  if (req.method === 'GET') {
    try {
      verifyToken(req)
    } catch (e) {
      return res.status(e.status ?? 401).json({ error: e.message })
    }
    try {
      const rates = await getCurrentRates()
      return res.status(200).json({ rates })
    } catch {
      return res.status(502).json({ error: 'Database error' })
    }
  }

  // ── POST — admin JWT required ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const admin = await requireAdmin(req, res)
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

    const updated     = await getCurrentRates()
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
