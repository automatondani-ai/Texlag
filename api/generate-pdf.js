/**
 * POST /api/generate-pdf
 *
 * Accepts { quote, detentionHourlyRate? } in the request body, renders the PDF
 * via @react-pdf/renderer, and returns it as a downloadable buffer.
 *
 * PDF layout is defined in api/_lib/buildQuotePDF.js and shared with
 * api/send-quote.js so both endpoints always produce identical documents.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import { verifyToken }    from './_lib/auth.js'
import { buildDocument }  from './_lib/buildQuotePDF.js'

const REQUIRED = ['quoteId', 'pickup', 'dropoffs', 'lineItems', 'finalQuote']

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

  let buffer
  try {
    buffer = await renderToBuffer(buildDocument(quote, Number(detentionHourlyRate) || 75))
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
