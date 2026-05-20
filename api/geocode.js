/**
 * POST /api/geocode
 *
 * Resolves a US ZIP code to a human-readable city/state string using the
 * Google Maps Geocoding API.  Protected by JWT auth (any valid token).
 *
 * Request body: { zip: "75001" }
 *
 * Success response:
 *   { resolved: "75001 - Addison, TX", city: "Addison", state: "TX" }
 *
 * Error responses:
 *   400  — missing/invalid zip field
 *   404  — ZIP exists but Google returned no usable results
 *   502  — upstream Google Maps error
 */

import { verifyToken } from './_lib/auth.js'

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const ZIP_RE      = /^\d{5}$/

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
  if (!zip || typeof zip !== 'string' || !ZIP_RE.test(zip.trim())) {
    return res.status(400).json({ error: '`zip` must be a 5-digit US ZIP code' })
  }
  const zipCode = zip.trim()

  // ── Call Google Maps Geocoding API ─────────────────────────────────────────
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' })
  }

  let data
  try {
    const url = new URL(GEOCODE_URL)
    url.searchParams.set('address',    zipCode)
    url.searchParams.set('components', 'country:US')
    url.searchParams.set('key',        apiKey)

    const r = await fetch(url.toString())
    if (!r.ok) throw new Error(`Google Maps HTTP ${r.status}`)
    data = await r.json()
  } catch (err) {
    console.error('[geocode] fetch error:', err.message)
    return res.status(502).json({ error: `Geocoding request failed: ${err.message}` })
  }

  if (data.status !== 'OK' || !data.results?.length) {
    console.warn('[geocode] no results for ZIP:', zipCode, '— status:', data.status)
    return res.status(404).json({ error: `No results found for ZIP ${zipCode}` })
  }

  // ── Parse address components ───────────────────────────────────────────────
  // Walk through all results until we find one with both locality and state.
  // Google sometimes returns the neighbourhood before the city — we prefer
  // locality > sublocality > administrative_area_level_3 for the city name.
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
    console.warn('[geocode] could not extract city/state for ZIP:', zipCode)
    return res.status(404).json({ error: `Could not determine city/state for ZIP ${zipCode}` })
  }

  const resolved = `${zipCode} - ${city}, ${state}`
  console.log('[geocode] resolved:', zipCode, '→', resolved)

  return res.status(200).json({ resolved, city, state })
}
