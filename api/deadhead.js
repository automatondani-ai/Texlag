import { verifyToken } from './_lib/auth.js'

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Require any valid authenticated session (admin or driver)
  try {
    verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  const { origin, destination } = req.body ?? {}

  // ── Validate destination ────────────────────────────────────────────────────
  if (!destination || typeof destination !== 'string' || !destination.trim()) {
    return res.status(400).json({ error: '`destination` must be a non-empty address string' })
  }

  // ── Resolve origin → string accepted by Distance Matrix ────────────────────
  let originStr
  if (typeof origin === 'string' && origin.trim()) {
    originStr = origin.trim()
  } else if (
    origin &&
    typeof origin === 'object' &&
    typeof origin.lat === 'number' &&
    typeof origin.lng === 'number'
  ) {
    // GPS coordinates from browser Geolocation API
    originStr = `${origin.lat},${origin.lng}`
  } else {
    return res.status(400).json({
      error: '`origin` must be an address string or a { lat: number, lng: number } object',
    })
  }

  // ── Google Maps Distance Matrix call ────────────────────────────────────────
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' })
  }

  const url = new URL(DISTANCE_MATRIX_URL)
  url.searchParams.set('origins',      originStr)
  url.searchParams.set('destinations', destination.trim())
  url.searchParams.set('units',        'imperial')
  url.searchParams.set('mode',         'driving')
  url.searchParams.set('key',          apiKey)

  let data
  try {
    const r = await fetch(url.toString())
    if (!r.ok) throw new Error(`Maps API HTTP ${r.status}`)
    data = await r.json()
  } catch (e) {
    return res.status(502).json({ error: `Google Maps request failed: ${e.message}` })
  }

  if (data.status !== 'OK') {
    return res.status(502).json({ error: `Google Maps error: ${data.status}` })
  }

  const element = data.rows?.[0]?.elements?.[0]
  if (!element || element.status !== 'OK') {
    return res.status(422).json({
      error: `No driving route found: ${element?.status ?? 'UNKNOWN'}`,
    })
  }

  const miles = Math.round((element.distance.value / 1609.344) * 10) / 10

  return res.status(200).json({
    miles,
    text:     element.distance.text,
    duration: element.duration.text,
  })
}
