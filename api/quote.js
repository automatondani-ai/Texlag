import redis from './_lib/redis.js'
import { verifyToken } from './_lib/auth.js'
import { randomUUID } from 'crypto'

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
  interstate_cpm:        2.50,
  intrastate_cpm:        2.00,
  interstate_truck_rate: 3.50,
  intrastate_truck_rate: 3.00,
  insurance_rate:        0.15,
  trailer_hold_rate:    75.00,
  gas_price_per_gallon:  3.85,
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
    tripDays        = 0,
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
  const { driverAssist = false, detention = false, lowBackhaul = false } = toggles
  const driverAssistFee = driverAssist ? Math.max(0, Number(extras.driverAssistAmount) || 0) : 0
  const detentionFee    = detention    ? Math.max(0, Number(extras.detentionAmount)    || 0) : 0
  const numTripDays     = Math.max(0, Number(tripDays)        || 0)
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

  // ── Select jurisdiction-based rates ─────────────────────────────────────────
  const baseCpm      = jurisdiction === 'interstate'
    ? rates.interstate_cpm
    : rates.intrastate_cpm
  const truckRate    = jurisdiction === 'interstate'
    ? rates.interstate_truck_rate
    : rates.intrastate_truck_rate
  const insuranceRate = rates.insurance_rate
  const holdRate      = rates.trailer_hold_rate
  const gasRate       = rates.gas_price_per_gallon

  // Team loads: client CPM doubled; internal always single-driver basis
  const clientCpm   = driverMode === 'team' ? r2(baseCpm * 2) : baseCpm
  const internalCpm = baseCpm

  // ── Formula ─────────────────────────────────────────────────────────────────
  //
  // Core Subtotal = (Total Miles    × Driver Base CPM)
  //              + (Trip Days       × Truck Rate)
  //              + (Trip Days       × Insurance Rate)
  //              + (Trailer Hold Days × Hold Rate)
  //              + (Deadhead Miles  × Driver Base CPM)
  //              + Driver Assist Fee
  //
  // Total Gas Surcharge = Total Miles × Gas Price Per Gallon
  //
  // Backhaul OFF:  Final Quote = Core Subtotal + Gas Surcharge + Detention Fee
  // Backhaul ON:   Final Quote = Core Subtotal + Gas Surcharge + Detention Fee
  //                              + Gas Surcharge  (gas surcharge applied twice)

  const cpmMileage      = r2(totalMiles * clientCpm)
  const truckCharge     = r2(numTripDays * truckRate)
  const insuranceCharge = r2(numTripDays * insuranceRate)
  const holdCharge      = r2(numHoldDays * holdRate)
  const deadheadCharge  = r2(numDeadhead * clientCpm)
  const gasSurcharge    = r2(totalMiles  * gasRate)

  const coreSubtotal = r2(
    cpmMileage +
    truckCharge +
    insuranceCharge +
    holdCharge +
    deadheadCharge +
    driverAssistFee
  )

  const backhaulGas  = lowBackhaul ? gasSurcharge : 0   // second gas charge if ON
  const finalQuote   = r2(coreSubtotal + gasSurcharge + detentionFee + backhaulGas)

  // Internal: same structure but always single-driver CPM, no client markups
  const internalDriverCost = r2(
    (totalMiles * internalCpm) +
    (numTripDays * truckRate) +
    (numTripDays * insuranceRate) +
    (numHoldDays * holdRate) +
    (numDeadhead * internalCpm)
  )

  // ── Build response ──────────────────────────────────────────────────────────
  const quoteId = `Q-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`
  const pl = pickup.trim()
  const dl = dropoffs.map(d => d.trim())

  return res.status(200).json({
    // ── Identity ──────────────────────────────────────────────────────────────
    quoteId,
    generatedAt: new Date().toISOString(),
    driver: {
      email:     caller.email,
      firstName: caller.firstName,
      lastName:  caller.lastName,
    },

    // ── Route ─────────────────────────────────────────────────────────────────
    pickup:       pl,
    dropoffs:     dl,
    jurisdiction,
    totalMiles:   r2(totalMiles),
    legs: legs.map((m, i) => ({
      from:  i === 0 ? pl : dl[i - 1],
      to:    dl[i],
      miles: r2(m),
    })),

    // ── Options ───────────────────────────────────────────────────────────────
    driverMode,
    toggles: { driverAssist, detention, lowBackhaul },

    // ── Line items ────────────────────────────────────────────────────────────
    // null entries are omitted by JSON serialisation
    lineItems: {
      cpmMileage: {
        label:  driverMode === 'team'
          ? `Route miles — Team CPM (2× @ $${clientCpm}/mi)`
          : `Route miles — Solo CPM ($${clientCpm}/mi)`,
        rate:   clientCpm,
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
      holdCharge: numHoldDays > 0 ? {
        label:  `Trailer hold ($${holdRate}/day × ${numHoldDays} day${numHoldDays !== 1 ? 's' : ''})`,
        rate:   holdRate,
        days:   numHoldDays,
        amount: holdCharge,
      } : null,
      deadheadCharge: numDeadhead > 0 ? {
        label:  `Deadhead CPM ($${clientCpm}/mi × ${numDeadhead} mi)`,
        rate:   clientCpm,
        miles:  numDeadhead,
        amount: deadheadCharge,
      } : null,
      driverAssistFee: driverAssist ? {
        label:  'Driver assist fee',
        amount: driverAssistFee,
      } : null,
      gasSurcharge: {
        label:  `Fuel surcharge ($${gasRate}/mi × ${r2(totalMiles)} mi)`,
        rate:   gasRate,
        miles:  r2(totalMiles),
        amount: gasSurcharge,
      },
      backhaulSurcharge: lowBackhaul ? {
        label:  `Low/No Backhaul surcharge (additional fuel — $${gasRate}/mi × ${r2(totalMiles)} mi)`,
        rate:   gasRate,
        miles:  r2(totalMiles),
        amount: gasSurcharge,   // same value, applied a second time
      } : null,
      detentionFee: detention ? {
        label:  'Detention fee',
        amount: detentionFee,
      } : null,
    },

    // ── Totals ────────────────────────────────────────────────────────────────
    coreSubtotal,
    gasSurcharge,
    backhaulApplied: lowBackhaul,
    totalQuote:  finalQuote,   // alias kept for QuoteResultCard compatibility
    finalQuote,

    // ── Internal (not shown in client-facing output) ───────────────────────────
    internalDriverCost,

    // ── Rates snapshot (audit trail) ──────────────────────────────────────────
    ratesSnapshot: {
      jurisdiction,
      baseCpm,
      clientCpm,
      truckRate,
      insuranceRate,
      holdRate,
      gasRate,
    },
  })
}
