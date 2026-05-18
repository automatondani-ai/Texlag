/**
 * POST /api/dispatch
 *
 * Routes by the `action` field in the request body:
 *   action: 'generate-pdf' — render a quote PDF and return it as a download
 *   action: 'send-quote'   — render the PDF and email it to the broker via Resend
 *
 * Logo: LOGO_BASE64 is a PNG data URL loaded from src/assets/texlag-logo.png
 * at module initialisation time via logoBase64.js (no sharp, no runtime I/O
 * inside the handler).  Path uses process.cwd() so it survives ESM→CJS
 * transpilation on Vercel.
 *
 * Error strategy: every discrete stage is wrapped in its own try/catch so
 * the exact failure point appears in Vercel function logs.  A top-level catch
 * ensures any escaping error is still returned as JSON, never as an HTML page.
 */

import { Resend }         from 'resend'
import { renderToBuffer } from '@react-pdf/renderer'
import { verifyToken }    from './_lib/auth.js'
import { buildDocument, BRAND, fmt } from './_lib/buildQuotePDF.js'
import { logAudit, AUDIT }           from './_lib/audit.js'
import { LOGO_BASE64 }               from './_lib/logoBase64.js'

// Log logo status immediately at cold-start so it's visible in deploy logs
console.log('[dispatch] module loaded — LOGO_BASE64 present:', !!LOGO_BASE64,
  LOGO_BASE64 ? `(${LOGO_BASE64.length} chars)` : '(null — Image element will be omitted from PDF)')

const REQUIRED = ['quoteId', 'pickup', 'dropoffs', 'lineItems', 'finalQuote']
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Email HTML template ──────────────────────────────────────────────────────

function buildEmailHtml(quote, driverName) {
  const dateStr = new Date(quote.generatedAt ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const route        = [quote.pickup, ...(quote.dropoffs ?? [])].join(' → ')
  const jurisdiction = quote.jurisdiction === 'intrastate' ? 'Intrastate' : 'Interstate'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Freight Quote — TexLag Express — ${quote.quoteId}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.09);">
          <tr>
            <td style="background:#1e293b;padding:28px 40px 24px;">
              <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.3px;margin-bottom:6px;">
                TexLag Express
              </div>
              <div style="font-size:11px;color:#94a3b8;">
                ${BRAND.usdot}&nbsp;&nbsp;·&nbsp;&nbsp;${BRAND.mc}&nbsp;&nbsp;·&nbsp;&nbsp;${BRAND.phone}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 28px;">
              <p style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 6px 0;">
                Freight Quote — ${quote.quoteId}
              </p>
              <p style="font-size:13px;color:#64748b;margin:0 0 24px 0;">${dateStr}</p>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 24px 0;">Dear Broker,</p>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 24px 0;">
                Please find attached a freight quote prepared by
                <strong style="color:#1e293b;">${driverName}</strong>
                on behalf of TexLag Express. The attached PDF contains the full
                itemised cost breakdown including all applicable rates,
                surcharges, and policy terms applicable to this load.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:20px;">
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;" colspan="2">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Route</div>
                    <div style="font-size:13px;font-weight:600;color:#1e293b;">${route}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 18px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;width:50%;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Total Miles</div>
                    <div style="font-size:13px;font-weight:600;color:#1e293b;">${quote.totalMiles} mi</div>
                  </td>
                  <td style="padding:12px 18px;border-bottom:1px solid #e2e8f0;width:50%;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Jurisdiction</div>
                    <div style="font-size:13px;font-weight:600;color:#1e293b;">${jurisdiction}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 18px;border-right:1px solid #e2e8f0;width:50%;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Driver Mode</div>
                    <div style="font-size:13px;font-weight:600;color:#1e293b;">${quote.driverMode === 'team' ? 'Team (2 Drivers)' : 'Solo'}</div>
                  </td>
                  <td style="padding:12px 18px;width:50%;">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Quote ID</div>
                    <div style="font-size:13px;font-weight:600;color:#1e293b;">${quote.quoteId}</div>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#0f172a;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">
                      Final Quote${quote.backhaulApplied ? ' (Low/No Backhaul surcharge applied)' : ''}
                    </div>
                    <div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                      ${fmt(quote.finalQuote)}
                    </div>
                  </td>
                </tr>
              </table>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 24px 0;">
                This quote is valid for <strong>48 hours</strong> from the date
                of issue. All rates are subject to change based on current fuel
                prices and market conditions. To confirm availability and proceed
                with booking, please reply to this email or contact us directly.
              </p>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0;">
                Regards,<br>
                <strong style="color:#1e293b;">${driverName}</strong><br>
                <span style="color:#64748b;">TexLag Express</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;">
              <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.8;text-align:center;">
                TexLag Express &nbsp;·&nbsp; ${BRAND.usdot} &nbsp;·&nbsp; ${BRAND.mc}<br>
                ${BRAND.phone}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── action: 'generate-pdf' ────────────────────────────────────────────────────

async function handleGeneratePdf(req, res) {
  const tag = '[dispatch/generate-pdf]'
  console.log(tag, 'handler entered')

  // ── 1. Validate request body ─────────────────────────────────────────────
  let quote, detentionHourlyRate
  try {
    ;({ quote, detentionHourlyRate = 75 } = req.body ?? {})
    console.log(tag, 'body parsed — quoteId:', quote?.quoteId)
  } catch (e) {
    console.error(tag, 'body parse error:', e)
    return res.status(400).json({ error: 'Invalid request body' })
  }

  if (!quote || typeof quote !== 'object') {
    return res.status(400).json({ error: '`quote` object is required in the request body' })
  }

  const missing = REQUIRED.filter(k => quote[k] == null)
  if (missing.length) {
    console.error(tag, 'missing fields:', missing)
    return res.status(400).json({ error: 'Quote is missing required fields', missing })
  }

  // ── 2. Build the React element tree ─────────────────────────────────────
  let element
  try {
    console.log(tag, 'building PDF document element — logo available:', !!LOGO_BASE64)
    element = buildDocument(quote, Number(detentionHourlyRate) || 75, LOGO_BASE64)
    console.log(tag, 'document element built OK')
  } catch (e) {
    console.error(tag, 'buildDocument threw:', e.message)
    console.error(tag, 'buildDocument stack:', e.stack)
    return res.status(500).json({ error: `PDF document build failed: ${e.message}` })
  }

  // ── 3. Render to buffer ──────────────────────────────────────────────────
  let buffer
  try {
    console.log(tag, 'calling renderToBuffer…')
    buffer = await renderToBuffer(element)
    console.log(tag, 'renderToBuffer complete — bytes:', buffer.length)
  } catch (e) {
    console.error(tag, 'renderToBuffer threw:', e.message)
    console.error(tag, 'renderToBuffer stack:', e.stack)
    return res.status(500).json({ error: `PDF render failed: ${e.message}` })
  }

  // ── 4. Stream the PDF back ───────────────────────────────────────────────
  const filename = `TexLag-Quote-${quote.quoteId}.pdf`
  console.log(tag, 'sending PDF — filename:', filename, '— bytes:', buffer.length)
  res.setHeader('Content-Type',        'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length',      buffer.length)
  res.end(buffer)
}

// ── action: 'send-quote' ──────────────────────────────────────────────────────

async function handleSendQuote(req, res, caller) {
  const tag = '[dispatch/send-quote]'
  console.log(tag, 'handler entered — caller:', caller.email)

  // ── 1. Validate ──────────────────────────────────────────────────────────
  const { quote, brokerEmail, detentionHourlyRate = 75 } = req.body ?? {}

  if (!brokerEmail || typeof brokerEmail !== 'string' || !EMAIL_RE.test(brokerEmail.trim())) {
    return res.status(400).json({ error: '`brokerEmail` must be a valid email address' })
  }
  if (!quote || typeof quote !== 'object') {
    return res.status(400).json({ error: '`quote` object is required in the request body' })
  }
  const missing = REQUIRED.filter(k => quote[k] == null)
  if (missing.length) {
    console.error(tag, 'missing fields:', missing)
    return res.status(400).json({ error: 'Quote is missing required fields', missing })
  }

  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
  console.log(tag, 'RESEND_API_KEY set:', !!resendKey, '| from:', fromEmail)

  if (!resendKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not configured' })
  }

  // ── 2. Build PDF element ─────────────────────────────────────────────────
  let element
  try {
    console.log(tag, 'building PDF document element — logo available:', !!LOGO_BASE64)
    element = buildDocument(quote, Number(detentionHourlyRate) || 75, LOGO_BASE64)
    console.log(tag, 'document element built OK')
  } catch (e) {
    console.error(tag, 'buildDocument threw:', e.message)
    console.error(tag, 'buildDocument stack:', e.stack)
    return res.status(500).json({ error: `PDF document build failed: ${e.message}` })
  }

  // ── 3. Render PDF ────────────────────────────────────────────────────────
  let pdfBuffer
  try {
    console.log(tag, 'calling renderToBuffer…')
    pdfBuffer = await renderToBuffer(element)
    console.log(tag, 'renderToBuffer complete — bytes:', pdfBuffer.length)
  } catch (e) {
    console.error(tag, 'renderToBuffer threw:', e.message)
    console.error(tag, 'renderToBuffer stack:', e.stack)
    return res.status(500).json({ error: `PDF render failed: ${e.message}` })
  }

  // ── 4. Send email ────────────────────────────────────────────────────────
  const driverName = `${caller.firstName ?? ''} ${caller.lastName ?? ''}`.trim()
  const subject    = `Freight Quote — TexLag Express — ${quote.quoteId}`
  const filename   = `TexLag-Quote-${quote.quoteId}.pdf`

  console.log(tag, 'sending email — to:', brokerEmail.trim(), '| subject:', subject)

  let data, sendError
  try {
    const resend = new Resend(resendKey)
    ;({ data, error: sendError } = await resend.emails.send({
      from:    `TexLag Express <${fromEmail}>`,
      to:      [brokerEmail.trim()],
      subject,
      html:    buildEmailHtml(quote, driverName),
      attachments: [{
        filename,
        content:      pdfBuffer,
        content_type: 'application/pdf',
      }],
    }))
  } catch (e) {
    console.error(tag, 'Resend SDK threw:', e.message)
    console.error(tag, 'Resend stack:', e.stack)
    return res.status(502).json({ error: 'Email delivery failed', details: e.message })
  }

  if (sendError) {
    console.error(tag, 'Resend API error:', JSON.stringify(sendError))
    return res.status(502).json({
      error:   'Email delivery failed',
      details: sendError.message ?? JSON.stringify(sendError),
    })
  }

  console.log(tag, 'email sent — messageId:', data?.id)

  logAudit({
    action:      AUDIT.QUOTE_EMAILED,
    performedBy: caller.email,
    description: `Quote ${quote.quoteId} emailed to broker ${brokerEmail.trim()}`,
  })

  return res.status(200).json({
    success:   true,
    messageId: data?.id ?? null,
    sentTo:    brokerEmail.trim(),
    quoteId:   quote.quoteId,
    subject,
  })
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Top-level catch — ensures any unhandled error returns JSON, never HTML.
  // Individual stage try/catches above give precise failure-point logging.
  try {
    console.log('[dispatch] request — method:', req.method,
      '| action:', req.body?.action, '| cwd:', process.cwd())

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    // ── Auth ───────────────────────────────────────────────────────────────
    let caller
    try {
      caller = verifyToken(req)
      console.log('[dispatch] auth OK — caller:', caller.email)
    } catch (e) {
      console.warn('[dispatch] auth failed:', e.message)
      return res.status(e.status ?? 401).json({ error: e.message })
    }

    const { action } = req.body ?? {}

    switch (action) {
      case 'generate-pdf': return await handleGeneratePdf(req, res)
      case 'send-quote':   return await handleSendQuote(req, res, caller)
      default:
        return res.status(400).json({
          error:   '`action` must be one of: generate-pdf, send-quote',
          allowed: ['generate-pdf', 'send-quote'],
        })
    }
  } catch (err) {
    console.error('[dispatch] TOP-LEVEL UNHANDLED ERROR:', err.message)
    console.error('[dispatch] stack:', err.stack)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message ?? 'Internal server error' })
    }
  }
}
