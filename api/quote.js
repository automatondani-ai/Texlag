import redis from './_lib/redis.js'
import { verifyToken } from './_lib/auth.js'
import { logAudit, AUDIT } from './_lib/audit.js'

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

// ── Distance Matrix ─────────────────────────────────────────────────────────

async function fetchLegMiles(origin, destination, apiKey) {
  const url = new URL(DISTANCE_MATRIX_URL)
  url.searchParams.set('origins',      origin)
  url.searchParams.set('destinations', destination)
  url.searchParams.set('units',        'imperial')
  url.searchParams.set('mode',         'driving')
  url.searchParams.set('key',          apiKey)

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Google Maps HTTP ${r.status}`)

  const data = await r.json()
  if (data.status !== 'OK') throw new Error(`Google Maps error: ${data.status}`)

  const el = data.rows?.[0]?.elements?.[0]
  if (!el || el.status !== 'OK') {
    throw new Error(`No route from "${origin}" to "${destination}": ${el?.status ?? 'UNKNOWN'}`)
  }

  return el.distance.value / 1609.344   // metres → miles
}

async function totalRoadMiles(pickup, dropoffs, apiKey) {
  const stops = [pickup, ...dropoffs]
  const legs  = await Promise.all(
    stops.slice(0, -1).map((o, i) => fetchLegMiles(o, stops[i + 1], apiKey))
  )
  return { total: legs.reduce((s, m) => s + m, 0), legs }
}

// ── Rate loader ─────────────────────────────────────────────────────────────

const RATE_KEYS_AND_DEFAULTS = {
  interstate_cpm:                2.50,
  interstate_broker_cpm:         3.50,
  intrastate_cpm:                2.00,
  intrastate_broker_cpm:         2.75,
  interstate_truck_rate:         3.50,
  intrastate_truck_rate:         3.00,
  interstate_insurance_rate:     0.15,
  intrastate_insurance_rate:     0.15,
  interstate_hazmat_rate:        0.25,
  intrastate_hazmat_rate:        0.25,
  trailer_hold_rate:            75.00,
  gas_price_per_gallon:          3.85,
  mpg:                           6,
  speed_mph:                    65,
  driver_assist_per_pallet:     25.00,
}

async function loadRates() {
  const keys   = Object.keys(RATE_KEYS_AND_DEFAULTS)
  const values = await Promise.all(keys.map(k => redis.get(`rates:${k}`)))
  return Object.fromEntries(
    keys.map((k, i) => [k, Number(values[i] ?? RATE_KEYS_AND_DEFAULTS[k])])
  )
}

// ── Rounding ────────────────────────────────────────────────────────────────

const r2 = n => Math.round(n * 100) / 100

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: any valid JWT (admin or driver) ───────────────────────────────────
  let caller
  try {
    caller = verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const {
    jurisdiction    = 'interstate',
    pickup,
    dropoffs,
    driverMode      = 'solo',
    numberOfPallets = 0,
    trailerHoldDays = 0,
    deadheadMiles   = 0,
    toggles         = {},
    extras          = {},
  } = req.body ?? {}

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!pickup || typeof pickup !== 'string' || !pickup.trim()) {
    return res.status(400).json({ error: '`pickup` must be a non-empty string' })
  }
  if (
    !Array.isArray(dropoffs) ||
    dropoffs.length === 0 ||
    dropoffs.some(d => typeof d !== 'string' || !d.trim())
  ) {
    return res.status(400).json({ error: '`dropoffs` must be a non-empty array of strings' })
  }
  if (!['interstate', 'intrastate'].includes(jurisdiction)) {
    return res.status(400).json({ error: '`jurisdiction` must be "interstate" or "intrastate"' })
  }
  if (!['solo', 'team'].includes(driverMode)) {
    return res.status(400).json({ error: '`driverMode` must be "solo" or "team"' })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' })

  // ── Normalise inputs ────────────────────────────────────────────────────────
  const { driverAssist = false, detention = false, lowBackhaul = false, partialBackhaul = false, hazmat = false } = toggles
  const numPallets      = Math.max(0, Number(numberOfPallets) || 0)
  const detentionFee    = detention ? Math.max(0, Number(extras.detentionAmount) || 0) : 0
  const numHoldDays     = Math.max(0, Number(trailerHoldDays) || 0)
  const numDeadhead     = Math.max(0, Number(deadheadMiles)   || 0)

  // ── Parallel fetch: route miles + rates ─────────────────────────────────────
  let totalMiles, legs, rates
  try {
    ;[{ total: totalMiles, legs }, rates] = await Promise.all([
      totalRoadMiles(pickup.trim(), dropoffs.map(d => d.trim()), apiKey),
      loadRates(),
    ])
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  // ── Auto-calculate trip days ─────────────────────────────────────────────────
  //
  // Trip hours = Total Route Miles ÷ Average Speed (mph)
  // Trip days  = Math.ceil(Trip hours ÷ 11)   [11 hrs = HOS daily driving limit]
  // Minimum 1 day always (even sub-day loads still occupy one work day).
  const speed       = Math.max(1, Number(rates.speed_mph) || 65)
  const tripHours   = totalMiles / speed
  const numTripDays = Math.max(1, Math.ceil(tripHours / 11))

  // ── Select jurisdiction-based rates ─────────────────────────────────────────
  const driverBaseCpm  = jurisdiction === 'interstate'
    ? rates.interstate_cpm
    : rates.intrastate_cpm
  const brokerBaseCpm  = jurisdiction === 'interstate'
    ? rates.interstate_broker_cpm
    : rates.intrastate_broker_cpm
  const truckRate      = jurisdiction === 'interstate'
    ? rates.interstate_truck_rate
    : rates.intrastate_truck_rate
  const insuranceRate  = jurisdiction === 'interstate'
    ? rates.interstate_insurance_rate
    : rates.intrastate_insurance_rate
  const hazmatRate     = jurisdiction === 'interstate'
    ? rates.interstate_hazmat_rate
    : rates.intrastate_hazmat_rate
  const holdRate           = rates.trailer_hold_rate
  const gasRate            = rates.gas_price_per_gallon
  const mpg                = Math.max(0.1, Number(rates.mpg) || 6)   // guard against zero
  const driverAssistRate   = Math.max(0, Number(rates.driver_assist_per_pallet) || 25)
  const driverAssistFee    = driverAssist ? r2(numPallets * driverAssistRate) : 0

  // Team loads: both CPMs are doubled; internal always single-driver basis
  const brokerCpm  = driverMode === 'team' ? r2(brokerBaseCpm * 2) : brokerBaseCpm
  const driverCpm  = driverMode === 'team' ? r2(driverBaseCpm * 2) : driverBaseCpm

  // ── Broker-facing formula (shown to driver and on PDF) ───────────────────────
  //
  // Core Subtotal = (Total Miles      × Broker CPM)
  //              + (Trip Days         × Truck Rate)
  //              + (Trip Days         × Insurance Rate)
  //              + (Trip Days         × Hazmat Rate)   [if hazmat toggle]
  //              + (Trailer Hold Days × Hold Rate)
  //              + (Deadhead Miles    × Broker CPM)
  //              + Driver Assist Fee
  //
  // Broker Total  = Core Subtotal + Gas Surcharge + Detention Fee [+ Backhaul Gas]

  const cpmMileage      = r2(totalMiles * brokerCpm)
  const truckCharge     = r2(numTripDays * truckRate)
  const insuranceCharge = r2(numTripDays * insuranceRate)
  const hazmatCharge    = hazmat ? r2(numTripDays * hazmatRate) : 0
  const holdCharge      = r2(numHoldDays * holdRate)
  const deadheadCharge  = r2(numDeadhead * brokerCpm)
  const gasSurcharge    = r2((totalMiles / mpg) * gasRate)

  const coreSubtotal = r2(
    cpmMileage +
    truckCharge +
    insuranceCharge +
    hazmatCharge +
    holdCharge +
    deadheadCharge +
    driverAssistFee
  )

  // Backhaul surcharge: full gas again (default) or half gas (partial)
  const backhaulGas = lowBackhaul
    ? (partialBackhaul ? r2(gasSurcharge / 2) : gasSurcharge)
    : 0
  const finalQuote  = r2(coreSubtotal + gasSurcharge + detentionFee + backhaulGas)

  // ── Internal driver-cost calculation ─────────────────────────────────────────
  //
  // Uses Driver CPM (not Broker CPM).  Excludes gas, detention, and driver assist
  // since those are pass-through costs, not driver payable.
  const internalDriverCost = r2(
    (totalMiles * driverBaseCpm) +
    (numTripDays * truckRate) +
    (numTripDays * insuranceRate) +
    (numHoldDays * holdRate) +
    (numDeadhead * driverBaseCpm)
  )

  // ── Generate quote ID: YYYYMMDD-NNN ────────────────────────────────────────
  //
  // Atomically increments a per-day counter in Redis.  Counter key includes the
  // date, so it resets automatically each new day with no cron or cleanup needed.
  // incr() returns 1 on the first call for a new key, giving 001 as the first
  // ID each day.  We only reach here after validation + route fetch both passed,
  // so a Maps failure never burns a sequence number.
  let quoteId
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')  // YYYYMMDD
    const seq  = await redis.incr(`quote_counter:${date}`)
    quoteId    = `${date}-${String(seq).padStart(3, '0')}`
  } catch {
    return res.status(502).json({ error: 'Failed to generate quote ID' })
  }

  // ── Build full response payload ─────────────────────────────────────────────
  //
  // The payload is constructed once and used for both the HTTP response and the
  // Redis snapshot so that admins can reconstruct a complete PDF at any time.
  const pl          = pickup.trim()
  const dl          = dropoffs.map(d => d.trim())
  const generatedAt = new Date().toISOString()

  const quotePayload = {
    // ── Identity ────────────────────────────────────────────────────────────
    quoteId,
    generatedAt,
    driver: {
      email:     caller.email,
      firstName: caller.firstName,
      lastName:  caller.lastName,
    },

    // ── Route ───────────────────────────────────────────────────────────────
    pickup:       pl,
    dropoffs:     dl,
    jurisdiction,
    totalMiles:   r2(totalMiles),
    legs: legs.map((m, i) => ({
      from:  i === 0 ? pl : dl[i - 1],
      to:    dl[i],
      miles: r2(m),
    })),

    // ── Options ─────────────────────────────────────────────────────────────
    driverMode,
    tripDays:        numTripDays,
    numberOfPallets: numPallets,
    toggles: { driverAssist, detention, lowBackhaul, partialBackhaul, hazmat },

    // ── Line items ───────────────────────────────────────────────────────────
    // null entries are omitted by JSON serialisation
    lineItems: {
      cpmMileage: {
        // No rate figure in the label — broker CPM is internal pricing info
        label:  driverMode === 'team' ? 'Route Miles — Team CPM' : 'Route Miles — Solo CPM',
        rate:   brokerCpm,
        miles:  r2(totalMiles),
        amount: cpmMileage,
      },
      truckCharge: {
        label:  `Truck rate ($${truckRate}/day × ${numTripDays} day${numTripDays !== 1 ? 's' : ''})`,
        rate:   truckRate,
        days:   numTripDays,
        amount: truckCharge,
      },
      insuranceCharge: {
        label:  `Insurance ($${insuranceRate}/day × ${numTripDays} day${numTripDays !== 1 ? 's' : ''})`,
        rate:   insuranceRate,
        days:   numTripDays,
        amount: insuranceCharge,
      },
      hazmatCharge: hazmat ? {
        label:  `Hazmat ($${hazmatRate}/day × ${numTripDays} day${numTripDays !== 1 ? 's' : ''})`,
        rate:   hazmatRate,
        days:   numTripDays,
        amount: hazmatCharge,
      } : null,
      holdCharge: numHoldDays > 0 ? {
        label:  `Trailer hold ($${holdRate}/day × ${numHoldDays} day${numHoldDays !== 1 ? 's' : ''})`,
        rate:   holdRate,
        days:   numHoldDays,
        amount: holdCharge,
      } : null,
      deadheadCharge: numDeadhead > 0 ? {
        label:  `Deadhead CPM ($${brokerCpm}/mi × ${numDeadhead} mi)`,
        rate:   brokerCpm,
        miles:  numDeadhead,
        amount: deadheadCharge,
      } : null,
      driverAssistFee: driverAssist ? {
        label:   `Driver assist (${numPallets} pallet${numPallets !== 1 ? 's' : ''} × $${driverAssistRate}/pallet)`,
        pallets: numPallets,
        amount:  driverAssistFee,
      } : null,
      gasSurcharge: {
        label:  `Fuel surcharge (${r2(totalMiles)} mi ÷ ${mpg} mpg × $${gasRate}/gal)`,
        rate:   gasRate,
        miles:  r2(totalMiles),
        amount: gasSurcharge,
      },
      backhaulSurcharge: lowBackhaul ? {
        label:  partialBackhaul
          ? 'Backhaul Surcharge — Partial (50%)'
          : 'Backhaul Surcharge',
        rate:   gasRate,
        miles:  r2(totalMiles),
        amount: backhaulGas,
      } : null,
      detentionFee: detention ? {
        label:  'Detention fee',
        amount: detentionFee,
      } : null,
    },

    // ── Totals ───────────────────────────────────────────────────────────────
    coreSubtotal,
    gasSurcharge,
    backhaulApplied: lowBackhaul,
    brokerTotal:  finalQuote,        // broker-facing total (uses Broker CPM)
    internalTotal: internalDriverCost, // driver payout (uses Driver CPM)
    totalQuote:   finalQuote,        // alias kept for QuoteResultCard compatibility
    finalQuote,

    // ── Internal (not shown in client-facing output) ─────────────────────────
    internalDriverCost,

    // ── Rates snapshot (audit trail + trip-duration formula display) ─────────
    ratesSnapshot: {
      jurisdiction,
      driverBaseCpm,
      brokerBaseCpm,
      brokerCpm,
      driverCpm,
      truckRate,
      insuranceRate,
      hazmatRate,
      holdRate,
      gasRate,
      mpg,
      speed,
      driverAssistRate,
    },
  }

  // ── Audit log (fire-and-forget — non-fatal) ────────────────────────────────
  logAudit({
    action:      AUDIT.QUOTE_GENERATED,
    performedBy: caller.email,
    description: `Quote ${quoteId} generated — ${pl} → ${dl[dl.length - 1]} — Total: $${finalQuote.toFixed(2)}`,
  })

  // ── Persist to Redis (awaited) ──────────────────────────────────────────────
  //
  // Storage is awaited so the admin dashboard can immediately see new quotes.
  // Stored under:
  //   quote:{quoteId}               — full payload (enables PDF regeneration)
  //   quotes:driver:{email}         — ordered list of quote IDs per driver
  //   quotes:platform:total         — platform-wide counter
  //
  // A storage failure is non-fatal: we log it and still return the payload to
  // the driver so the quote is not lost from their screen.
  try {
    await Promise.all([
      redis.set(`quote:${quoteId}`, quotePayload),
      redis.lpush(`quotes:driver:${caller.email}`, quoteId),
      redis.incr('quotes:platform:total'),
    ])
  } catch (err) {
    console.error('[quote] Redis snapshot save failed — quote not persisted:', err)
  }

  return res.status(200).json(quotePayload)
}
