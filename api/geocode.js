/**
 * POST /api/geocode
 *
 * Resolves a US ZIP code or Canadian postal code to a human-readable
 * city/state/province string using the Google Maps Geocoding API.
 * Protected by JWT auth (any valid token).
 *
 * Accepts:
 *   US  ZIP   — 5 digits,            e.g. "75001"
 *   CA  postal — FSA+LDU format,     e.g. "M5V 3A8" or "M5V3A8"
 *
 * Request body: { zip: "75001" }  or  { zip: "M5V 3A8" }
 *
 * Success response:
 *   { resolved: "75001 - Addison, TX",    city: "Addison",  state: "TX" }
 *   { resolved: "M5V 3A8 - Toronto, ON",  city: "Toronto",  state: "ON" }
 *
 * Error responses:
 *   400  — missing or unrecognised postal/ZIP format
 *   404  — code exists but Google returned no usable results
 *   502  — upstream Google Maps error
 */

import { verifyToken } from './_lib/auth.js'

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

// Matches US 5-digit ZIP  OR  Canadian postal code (FSA + LDU, optional space)
const POSTAL_RE = /^(\d{5}|[A-Za-z]\d[A-Za-z][\s]?\d[A-Za-z]\d)$/

// Normalise a Canadian postal code to "A1A 1A1" (upper-case, space between FSA and LDU)
function normalisePostal(raw) {
  const upper = raw.toUpperCase().replace(/\s+/g, '')
  // If 6 chars and not all digits it's a Canadian code — insert the space
  if (upper.length === 6 && !/^\d+$/.test(upper)) {
    return `${upper.slice(0, 3)} ${upper.slice(3)}`
  }
  return raw.trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: any valid JWT ────────────────────────────────────────────────────
  try {
    verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  // ── Validate input ─────────────────────────────────────────────────────────
  const { zip } = req.body ?? {}
  if (!zip || typeof zip !== 'string' || !POSTAL_RE.test(zip.trim())) {
    return res.status(400).json({
      error: '`zip` must be a 5-digit US ZIP code or a Canadian postal code (e.g. M5V 3A8)',
    })
  }
  const postalCode = normalisePostal(zip.trim())

  // ── Call Google Maps Geocoding API ─────────────────────────────────────────
  // No country bias — Google resolves both US and Canadian codes natively.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' })
  }

  let data
  try {
    const url = new URL(GEOCODE_URL)
    url.searchParams.set('address', postalCode)
    url.searchParams.set('key',     apiKey)

    const r = await fetch(url.toString())
    if (!r.ok) throw new Error(`Google Maps HTTP ${r.status}`)
    data = await r.json()
  } catch (err) {
    console.error('[geocode] fetch error:', err.message)
    return res.status(502).json({ error: `Geocoding request failed: ${err.message}` })
  }

  if (data.status !== 'OK' || !data.results?.length) {
    console.warn('[geocode] no results for:', postalCode, '— status:', data.status)
    return res.status(404).json({ error: `No results found for "${postalCode}"` })
  }

  // ── Parse address components ───────────────────────────────────────────────
  // Walk through all results until we find one with both a city and a
  // state/province.  City preference order:
  //   locality > sublocality_level_1 > administrative_area_level_3
  // State/province: administrative_area_level_1 short_name (e.g. "TX", "ON")
  let city  = null
  let state = null

  for (const result of data.results) {
    const comps = result.address_components ?? []

    const locality    = comps.find(c => c.types.includes('locality'))
    const subLocality = comps.find(c => c.types.includes('sublocality_level_1'))
    const area3       = comps.find(c => c.types.includes('administrative_area_level_3'))
    const stateComp   = comps.find(c => c.types.includes('administrative_area_level_1'))

    const resolvedCity  = locality?.short_name ?? subLocality?.short_name ?? area3?.short_name ?? null
    const resolvedState = stateComp?.short_name ?? null

    if (resolvedCity && resolvedState) {
      city  = resolvedCity
      state = resolvedState
      break
    }
  }

  if (!city || !state) {
    console.warn('[geocode] could not extract city/state for:', postalCode)
    return res.status(404).json({ error: `Could not determine city/province for "${postalCode}"` })
  }

  const resolved = `${postalCode} - ${city}, ${state}`
  console.log('[geocode] resolved:', postalCode, '→', resolved)

  return res.status(200).json({ resolved, city, state })
}
