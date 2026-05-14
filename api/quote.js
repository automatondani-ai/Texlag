import { kv } from '@vercel/kv'
import { randomUUID } from 'crypto'

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

// Fetch a single road-distance leg in miles via Distance Matrix API.
async function fetchLegMiles(origin, destination, apiKey) {
  const url = new URL(DISTANCE_MATRIX_URL)
  url.searchParams.set('origins', origin)
  url.searchParams.set('destinations', destination)
  url.searchParams.set('units', 'imperial')
  url.searchParams.set('mode', 'driving')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Google Maps HTTP ${res.status}`)

  const data = await res.json()
  if (data.status !== 'OK') throw new Error(`Google Maps error: ${data.status}`)

  const element = data.rows?.[0]?.elements?.[0]
  if (!element || element.status !== 'OK') {
    throw new Error(
      `No route from "${origin}" to "${destination}": ${element?.status ?? 'UNKNOWN'}`
    )
  }

  // distance.value is meters → convert to miles
  return element.distance.value / 1609.344
}

// Sum road miles across all legs in parallel (origins are known upfront).
async function totalRoadMiles(pickup, dropoffs, apiKey) {
  const stops = [pickup, ...dropoffs]
  const legPromises = stops.slice(0, -1).map((origin, i) =>
    fetchLegMiles(origin, stops[i + 1], apiKey)
  )
  const legMiles = await Promise.all(legPromises)
  return { total: legMiles.reduce((sum, m) => sum + m, 0), legs: legMiles }
}

// Pull rates from KV with sensible defaults if keys aren't seeded yet.
async function loadRates() {
  const [cpm, gas, hazmat, tanker, tollFlat] = await Promise.all([
    kv.get('rates:cpm'),
    kv.get('rates:gas_surcharge'),
    kv.get('rates:hazmat'),
    kv.get('rates:tanker'),
    kv.get('rates:toll_flat'),
  ])

  return {
    cpm:      Number(cpm      ?? 2.50),
    gas:      Number(gas      ?? 0.25),
    hazmat:   Number(hazmat   ?? 0.35),
    tanker:   Number(tanker   ?? 0.30),
    tollFlat: Number(tollFlat ?? 150.00),
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Input validation ────────────────────────────────────────────────────────
  const { pickup, dropoffs, driverMode, toggles } = req.body ?? {}

  if (!pickup || typeof pickup !== 'string') {
    return res.status(400).json({ error: '`pickup` must be a non-empty string' })
  }
  if (!Array.isArray(dropoffs) || dropoffs.length === 0 || dropoffs.some(d => typeof d !== 'string' || !d)) {
    return res.status(400).json({ error: '`dropoffs` must be a non-empty array of strings' })
  }
  if (!['solo', 'team'].includes(driverMode)) {
    return res.status(400).json({ error: '`driverMode` must be "solo" or "team"' })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY environment variable is not set' })
  }

  const { hazmat = false, tanker = false, tolls: tollsEnabled = false } = toggles ?? {}

  // ── Parallel data fetch ─────────────────────────────────────────────────────
  let miles, legs, rates
  try {
    ;[{ total: miles, legs }, rates] = await Promise.all([
      totalRoadMiles(pickup, dropoffs, apiKey),
      loadRates(),
    ])
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  // ── Rate assembly ───────────────────────────────────────────────────────────
  //
  // internalDriverCost always uses single-driver CPM so dispatch can see the
  // actual driver outlay regardless of how the client quote is structured.
  //
  // Client quote doubles the CPM component for team loads to cover two drivers
  // while all per-mile surcharges remain the same.

  const clientCpm   = driverMode === 'team' ? rates.cpm * 2 : rates.cpm
  const internalCpm = rates.cpm  // always single-driver basis

  const hazmatRate  = hazmat       ? rates.hazmat   : 0
  const tankerRate  = tanker       ? rates.tanker   : 0
  const tollAmount  = tollsEnabled ? rates.tollFlat : 0

  // Per-mile totals
  const clientRatePerMile   = clientCpm   + rates.gas + hazmatRate + tankerRate
  const internalRatePerMile = internalCpm + rates.gas + hazmatRate + tankerRate

  const subtotalMileage   = round2(miles * clientRatePerMile)
  const totalQuote        = round2(subtotalMileage + tollAmount)
  const internalDriverCost = round2(miles * internalRatePerMile)

  // ── Response ────────────────────────────────────────────────────────────────
  const quoteId = `Q-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`

  return res.status(200).json({
    quoteId,
    generatedAt: new Date().toISOString(),

    // Route
    pickup,
    dropoffs,
    legs: legs.map((m, i) => ({
      from: i === 0 ? pickup : dropoffs[i - 1],
      to:   dropoffs[i],
      miles: round2(m),
    })),
    totalMiles: round2(miles),

    // Options
    driverMode,
    toggles: { hazmat, tanker, tolls: tollsEnabled },

    // Line items (null entries omitted by JSON serialisation when null)
    lineItems: {
      cpm: {
        label:  driverMode === 'team' ? 'CPM (team — 2× driver)' : 'CPM (solo driver)',
        rate:   clientCpm,
        miles:  round2(miles),
        amount: round2(miles * clientCpm),
      },
      gasSurcharge: {
        label:  'Fuel surcharge',
        rate:   rates.gas,
        miles:  round2(miles),
        amount: round2(miles * rates.gas),
      },
      hazmat: hazmat ? {
        label:  'Hazmat surcharge',
        rate:   rates.hazmat,
        miles:  round2(miles),
        amount: round2(miles * rates.hazmat),
      } : null,
      tanker: tanker ? {
        label:  'Tanker surcharge',
        rate:   rates.tanker,
        miles:  round2(miles),
        amount: round2(miles * rates.tanker),
      } : null,
      tolls: tollsEnabled ? {
        label:  'Toll estimate (flat)',
        amount: tollAmount,
      } : null,
    },

    subtotalMileage,
    totalQuote,

    // Internal — not shown in client-facing quote UI
    internalDriverCost,
  })
}
