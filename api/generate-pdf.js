/**
 * POST /api/generate-pdf
 *
 * Accepts { quote, detentionHourlyRate? } in the request body, renders the PDF
 * via @react-pdf/renderer, and returns it as a downloadable buffer.
 *
 * PDF layout is defined in api/_lib/buildQuotePDF.js and shared with
 * api/send-quote.js so both endpoints always produce identical documents.
 */

import sharp               from 'sharp'
import { readFileSync }    from 'fs'
import { fileURLToPath }   from 'url'
import { dirname, join }   from 'path'
import { renderToBuffer }  from '@react-pdf/renderer'
import { verifyToken }     from './_lib/auth.js'
import { buildDocument }   from './_lib/buildQuotePDF.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const LOGO_PATH  = join(__dirname, '../src/assets/texlag-logo.avif')

const REQUIRED = ['quoteId', 'pickup', 'dropoffs', 'lineItems', 'finalQuote']

// ── Logo conversion (cached per cold start) ──────────────────────────────────

let _logoDataUrl = null

async function getLogoDataUrl() {
  if (_logoDataUrl) return _logoDataUrl
  const avifBuf   = readFileSync(LOGO_PATH)
  const pngBuf    = await sharp(avifBuf).png().toBuffer()
  _logoDataUrl    = `data:image/png;base64,${pngBuf.toString('base64')}`
  return _logoDataUrl
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  const { quote, detentionHourlyRate = 75 } = req.body ?? {}

  if (!quote || typeof quote !== 'object') {
    return res.status(400).json({ error: '`quote` object is required in the request body' })
  }

  const missing = REQUIRED.filter(k => quote[k] == null)
  if (missing.length) {
    return res.status(400).json({ error: 'Quote is missing required fields', missing })
  }

  // ── Convert logo ────────────────────────────────────────────────────────────
  let logoDataUrl
  try {
    logoDataUrl = await getLogoDataUrl()
    console.log('[generate-pdf] logo converted — bytes:', logoDataUrl.length)
  } catch (e) {
    console.error('[generate-pdf] logo conversion failed:', e)
    logoDataUrl = null   // buildDocument falls back to embedded LOGO_BASE64
  }

  // ── Render PDF ──────────────────────────────────────────────────────────────
  let buffer
  try {
    buffer = await renderToBuffer(
      buildDocument(quote, Number(detentionHourlyRate) || 75, logoDataUrl)
    )
    console.log('[generate-pdf] PDF rendered — bytes:', buffer.length)
  } catch (e) {
    console.error('[generate-pdf] renderToBuffer failed:', e)
    return res.status(500).json({ error: `PDF generation failed: ${e.message}` })
  }

  const filename = `TexLag-Quote-${quote.quoteId}.pdf`
  res.setHeader('Content-Type',        'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length',      buffer.length)
  res.end(buffer)
}
