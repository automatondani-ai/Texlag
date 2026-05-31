import redis                  from './_lib/redis.js'
import { requireAuth }        from './_lib/auth.js'
import { logAudit, AUDIT }   from './_lib/audit.js'
import { k }                  from './_lib/keys.js'
import { setSecurityHeaders } from './_lib/headers.js'
import { isRateLimited }      from './_lib/rateLimit.js'

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

// ── Input limits ─────────────────────────────────────────────────────────────

const MAX_LOCATION_LEN   = 200   // chars per address string
const MAX_DROPOFFS       = 3     // maximum number of drop-off stops
const MAX_DEADHEAD_MILES = 3000
const MAX_HOLD_DAYS      = 30
const MAX_PALLETS        = 999
const MAX_DETENTION_AMT  = 10_000

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
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: verify JWT, active flag, and token-invalidation-after-pw-change ──
  const caller = await requireAuth(req, res)
  if (!caller) return

  // ── Per-user rate limit: max 60 quotes per hour ─────────────────────────────
  const limited = await isRateLimited(`quote_rate:${caller.email}`, 60, 3600)
  if (limited) {
    return res.status(429).json({ error: 'Rate limit exceeded. Maximum 60 quotes per hour.' })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const {
    jurisdiction          = 'interstate',
    pickup,
    dropoffs,
    driverMode            = 'solo',
    loadType              = 'palletized',
    numberOfPallets       = 0,
    driverAssistManualFee = 0,
    trailerHoldDays       = 0,
    deadheadMiles         = 0,
    toggles               = {},
    extras                = {},
  } = req.body ?? {}

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!pickup || typeof pickup !== 'string' || !pickup.trim()) {
    return res.status(400).json({ error: '`pickup` must be a non-empty string' })
  }
  if (pickup.trim().length > MAX_LOCATION_LEN) {
    return res.status(400).json({ error: `\`pickup\` must be ${MAX_LOCATION_LEN} characters or fewer` })
  }
  if (!Array.isArray(dropoffs) || dropoffs.length === 0) {
    return res.status(400).json({ error: '`dropoffs` must be a non-empty array of strings' })
  }
  if (dropoffs.length > MAX_DROPOFFS) {
    return res.status(400).json({ error: `Maximum ${MAX_DROPOFFS} drop-off stops are allowed` })
  }
  if (dropoffs.some(d => typeof d !== 'string' || !d.trim())) {
    return res.status(400).json({ error: '`dropoffs` must be a non-empty array of strings' })
  }
  if (dropoffs.some(d => d.trim().length > MAX_LOCATION_LEN)) {
    return res.status(400).json({ error: `Each drop-off must be ${MAX_LOCATION_LEN} characters or fewer` })
  }
  if (!['interstate', 'intrastate'].includes(jurisdiction)) {
    return res.status(400).json({ error: '`jurisdiction` must be "interstate" or "intrastate"' })
  }
  if (!['solo', 'team'].includes(driverMode)) {
    return res.status(400).json({ error: '`driverMode` must be "solo" or "team"' })
  }
  if (!['palletized', 'non-palletized'].includes(loadType)) {
    return res.status(400).json({ error: '`loadType` must be "palletized" or "non-palletized"' })
  }

  // Numeric range validation
  const rawDeadhead  = Number(deadheadMiles)
  const rawHoldDays  = Number(trailerHoldDays)
  const rawPallets   = Number(numberOfPallets)
  const rawManualFee = Number(driverAssistManualFee)
  const rawDetention = Number(extras?.detentionAmount ?? 0)

  if (!Number.isFinite(rawDeadhead)  || rawDeadhead  < 0 || rawDeadhead  > MAX_DEADHEAD_MILES) {
    return res.status(400).json({ error: `\`deadheadMiles\` must be 0–${MAX_DEADHEAD_MILES}` })
  }
  if (!Number.isFinite(rawHoldDays)  || rawHoldDays  < 0 || rawHoldDays  > MAX_HOLD_DAYS) {
    return res.status(400).json({ error: `\`trailerHoldDays\` must be 0–${MAX_HOLD_DAYS}` })
  }
  if (!Number.isFinite(rawPallets)   || rawPallets   < 0 || rawPallets   > MAX_PALLETS) {
    return res.status(400).json({ error: `\`numberOfPallets\` must be 0–${MAX_PALLETS}` })
  }
  if (!Number.isFinite(rawManualFee) || rawManualFee < 0 || rawManualFee > MAX_DETENTION_AMT) {
    return res.status(400).json({ error: `\`driverAssistManualFee\` must be 0–${MAX_DETENTION_AMT}` })
  }
  if (!Number.isFinite(rawDetention) || rawDetention < 0 || rawDetention > MAX_DETENTION_AMT) {
    return res.status(400).json({ error: `\`extras.detentionAmount\` must be 0–${MAX_DETENTION_AMT}` })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Server configuration error' })

  // ── Normalise inputs ────────────────────────────────────────────────────────
  const { driverAssist = false, detention = false, lowBackhaul = false, partialBackhaul = false, hazmat = false } = toggles
  const numPallets   = Math.max(0, rawPallets)
  const detentionFee = detention ? Math.max(0, rawDetention) : 0
  const numHoldDays  = Math.max(0, rawHoldDays)
  const numDeadhead  = Math.max(0, rawDeadhead)

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
  const speed       = Math.max(1, Number(rates.speed_mph) || 65)
  const tripHours   = totalMiles / speed
  const numTripDays = Math.max(1, Math.ceil(tripHours / 11))

  // ── Select jurisdiction-based rates ─────────────────────────────────────────
  const driverBaseCpm  = jurisdiction === 'interstate' ? rates.interstate_cpm        : rates.intrastate_cpm
  const brokerBaseCpm  = jurisdiction === 'interstate' ? rates.interstate_broker_cpm : rates.intrastate_broker_cpm
  const truckRate      = jurisdiction === 'interstate' ? rates.interstate_truck_rate  : rates.intrastate_truck_rate
  const insuranceRate  = jurisdiction === 'interstate' ? rates.interstate_insurance_rate : rates.intrastate_insurance_rate
  const hazmatRate     = jurisdiction === 'interstate' ? rates.interstate_hazmat_rate  : rates.intrastate_hazmat_rate
  const holdRate           = rates.trailer_hold_rate
  const gasRate            = rates.gas_price_per_gallon
  const mpg                = Math.max(0.1, Number(rates.mpg) || 6)
  const driverAssistRate   = Math.max(0, Number(rates.driver_assist_per_pallet) || 25)
  const manualFee          = Math.max(0, rawManualFee)
  const useManualFee       = loadType === 'non-palletized' || numPallets === 0
  const driverAssistFee    = driverAssist
    ? (useManualFee ? r2(manualFee) : r2(numPallets * driverAssistRate))
    : 0

  // Team loads: both CPMs are doubled
  const brokerCpm  = driverMode === 'team' ? r2(brokerBaseCpm * 2) : brokerBaseCpm
  const driverCpm  = driverMode === 'team' ? r2(driverBaseCpm * 2) : driverBaseCpm

  // ── Broker-facing formula ───────────────────────────────────────────────────
  const cpmMileage      = r2(totalMiles * brokerCpm)
  const truckCharge     = r2(numTripDays * truckRate)
  const insuranceCharge = r2(numTripDays * insuranceRate)
  const hazmatCharge    = hazmat ? r2(numTripDays * hazmatRate) : 0
  const holdCharge      = r2(numHoldDays * holdRate)
  const deadheadCharge  = r2(numDeadhead * brokerCpm)
  const gasSurcharge    = r2((totalMiles / mpg) * gasRate)

  const coreSubtotal = r2(
    cpmMileage + truckCharge + insuranceCharge + hazmatCharge +
    holdCharge + deadheadCharge + driverAssistFee
  )

  const backhaulGas = lowBackhaul
    ? (partialBackhaul ? r2(gasSurcharge / 2) : gasSurcharge)
    : 0
  const finalQuote  = r2(coreSubtotal + gasSurcharge + detentionFee + backhaulGas)

  // ── Internal driver-cost calculation ─────────────────────────────────────────
  const ic_routeMiles   = r2(totalMiles  * driverBaseCpm)
  const ic_deadhead     = r2(numDeadhead * driverBaseCpm)
  const ic_truckCharge  = r2(numTripDays * truckRate)
  const ic_insurance    = r2(numTripDays * insuranceRate)
  const ic_gas          = r2((totalMiles / mpg) * gasRate)
  const ic_driverAssist = driverAssist
    ? (useManualFee ? r2(manualFee) : r2(numPallets * driverAssistRate))
    : 0
  const ic_detention    = detention ? detentionFee : 0
  const ic_hazmat       = hazmat    ? r2(numTripDays * hazmatRate) : 0
  const ic_holdCharge   = r2(numHoldDays * holdRate)
  const ic_backhaulGas  = lowBackhaul
    ? (partialBackhaul ? r2(ic_gas / 2) : ic_gas)
    : 0

  const internalDriverCost = r2(
    ic_routeMiles + ic_deadhead + ic_truckCharge + ic_insurance +
    ic_gas + ic_driverAssist + ic_detention + ic_hazmat +
    ic_holdCharge + ic_backhaulGas
  )

  // ── Generate quote ID: YYYYMMDD-NNN ────────────────────────────────────────
  let quoteId
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const seq  = await redis.incr(k.quoteCounter(date))
    quoteId    = `${date}-${String(seq).padStart(3, '0')}`
  } catch {
    return res.status(502).json({ error: 'Failed to generate quote ID' })
  }

  // ── Debug logging ────────────────────────────────────────────────────────────
  console.log(`[quote:${quoteId}] Internal cost breakdown:`, {
    routeMiles:   `${r2(totalMiles)} mi × $${driverBaseCpm}/mi = $${ic_routeMiles}`,
    deadhead:     numDeadhead > 0 ? `${numDeadhead} mi × $${driverBaseCpm}/mi = $${ic_deadhead}` : 'n/a',
    truckCharge:  `${numTripDays} day(s) × $${truckRate}/day = $${ic_truckCharge}`,
    insurance:    `${numTripDays} day(s) × $${insuranceRate}/day = $${ic_insurance}`,
    gas:          `${r2(totalMiles)} mi ÷ ${mpg} mpg × $${gasRate}/gal = $${ic_gas}`,
    driverAssist: driverAssist
      ? (useManualFee ? `flat fee $${ic_driverAssist}` : `${numPallets} pallets × $${driverAssistRate}/pallet = $${ic_driverAssist}`)
      : 'off',
    detention:    detention ? `$${ic_detention}` : 'off',
    hazmat:       hazmat    ? `${numTripDays} day(s) × $${hazmatRate}/day = $${ic_hazmat}` : 'off',
    holdCharge:   numHoldDays > 0 ? `${numHoldDays} day(s) × $${holdRate}/day = $${ic_holdCharge}` : 'n/a',
    backhaulGas:  lowBackhaul ? `${partialBackhaul ? '50% partial' : 'full'} = $${ic_backhaulGas}` : 'off',
    TOTAL:        `$${internalDriverCost}`,
  })

  // ── Build full response payload ─────────────────────────────────────────────
  const pl          = pickup.trim()
  const dl          = dropoffs.map(d => d.trim())
  const generatedAt = new Date().toISOString()

  const quotePayload = {
    quoteId,
    generatedAt,
    driver: {
      email:     caller.email,
      firstName: caller.firstName,
      lastName:  caller.lastName,
    },
    pickup:       pl,
    dropoffs:     dl,
    jurisdiction,
    totalMiles:   r2(totalMiles),
    legs: legs.map((m, i) => ({
      from:  i === 0 ? pl : dl[i - 1],
      to:    dl[i],
      miles: r2(m),
    })),
    driverMode,
    loadType,
    tripDays:        numTripDays,
    numberOfPallets: numPallets,
    toggles: { driverAssist, detention, lowBackhaul, partialBackhaul, hazmat },
    lineItems: {
      cpmMileage: {
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
        label:   useManualFee
          ? 'Driver assist (flat fee)'
          : `Driver assist (${numPallets} pallet${numPallets !== 1 ? 's' : ''} × $${driverAssistRate}/pallet)`,
        ...(useManualFee ? {} : { pallets: numPallets }),
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
    coreSubtotal,
    gasSurcharge,
    backhaulApplied: lowBackhaul,
    brokerTotal:   finalQuote,
    internalTotal: internalDriverCost,
    totalQuote:    finalQuote,
    finalQuote,
    internalDriverCost,
    internalCostBreakdown: {
      routeMiles:  ic_routeMiles,
      deadhead:    ic_deadhead,
      truckCharge: ic_truckCharge,
      insurance:   ic_insurance,
      gas:         ic_gas,
      driverAssist:ic_driverAssist,
      detention:   ic_detention,
      hazmat:      ic_hazmat,
      holdCharge:  ic_holdCharge,
      backhaulGas: ic_backhaulGas,
      total:       internalDriverCost,
    },
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

  logAudit({
    action:      AUDIT.QUOTE_GENERATED,
    performedBy: caller.email,
    description: `Quote ${quoteId} generated — ${pl} → ${dl[dl.length - 1]} — Total: $${finalQuote.toFixed(2)}`,
  })

  try {
    await Promise.all([
      redis.set(k.quote(quoteId), quotePayload),
      redis.lpush(k.quotesDriver(caller.email), quoteId),
      redis.incr(k.platformTotal()),
    ])
  } catch (err) {
    console.error('[quote] Redis snapshot save failed — quote not persisted:', err)
  }

  return res.status(200).json(quotePayload)
}
