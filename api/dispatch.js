/**
 * POST /api/dispatch
 *
 * Routes by the `action` field in the request body:
 *   action: 'generate-pdf' — fetch a saved quote by ID, render PDF, return download
 *   action: 'send-quote'   — fetch a saved quote by ID, render PDF, email to broker
 *
 * Both actions require:
 *   { quoteId: string }              — the saved quote ID (e.g. "20250601-001")
 *   { brokerEmail: string }          — send-quote only
 *
 * Security: the quote is always loaded from Redis, never trusted from the
 * client body.  Drivers may only access their own quotes; admins may access
 * any quote.
 */

import { Resend }             from 'resend'
import redis                  from './_lib/redis.js'
import { requireAuth }        from './_lib/auth.js'
import { buildDocument, BRAND, fmt } from './_lib/buildQuotePDF.js'
import { logAudit, AUDIT }    from './_lib/audit.js'
import { LOGO_BASE64 }        from './_lib/logoBase64.js'
import { k }                  from './_lib/keys.js'
import { setSecurityHeaders } from './_lib/headers.js'

// ── Cold-start diagnostics ───────────────────────────────────────────────────
console.log('[dispatch] module loaded — LOGO_BASE64 present:', !!LOGO_BASE64,
  LOGO_BASE64 ? `(${LOGO_BASE64.length} chars)` : '(null — Image element will be omitted from PDF)')
console.log('[dispatch] env — RESEND_API_KEY set:', !!process.env.RESEND_API_KEY,
  '| RESEND_FROM_EMAIL:', process.env.RESEND_FROM_EMAIL ?? '(not set — will use fallback)')

const EMAIL_RE          = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_TIMEOUT_MS = 25_000
// Fields the PDF builder requires — validated after fetching from Redis
const REQUIRED = ['quoteId', 'pickup', 'dropoffs', 'lineItems', 'finalQuote']

// ── PDF filename helper ───────────────────────────────────────────────────────
function extractCity(address) {
  if (!address || typeof address !== 'string') return null
  const city = address.split(',')[0].trim()
  return city.length > 0 ? city : null
}

function pdfFilename(quote) {
  const fromCity = extractCity(quote.pickup)
  const toCity   = extractCity(
    Array.isArray(quote.dropoffs) && quote.dropoffs.length > 0
      ? quote.dropoffs[quote.dropoffs.length - 1]
      : null
  )
  if (fromCity && toCity) {
    const safe = s => s.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')
    return `TexLag-Quote-${safe(fromCity)}-to-${safe(toCity)}-${quote.quoteId}.pdf`
  }
  return `TexLag-Quote-${quote.quoteId}.pdf`
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms,
      )
    ),
  ])
}

// ── Fetch quote from Redis and enforce ownership ──────────────────────────────
// Drivers may only access their own quotes.  Admins may access any quote.
async function loadAndAuthorizeQuote(quoteId, caller, res) {
  if (!quoteId || typeof quoteId !== 'string' || !/^\d{8}-\d{3,}$/.test(quoteId.trim())) {
    res.status(400).json({ error: '`quoteId` must be a valid quote ID (e.g. "20250601-001")' })
    return null
  }

  let quote
  try {
    quote = await redis.get(k.quote(quoteId.trim()))
  } catch {
    res.status(502).json({ error: 'Database error' })
    return null
  }

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return null
  }

  // Drivers may only access their own quotes
  if (caller.role !== 'admin' && quote.driver?.email?.toLowerCase() !== caller.email?.toLowerCase()) {
    res.status(403).json({ error: 'You do not have permission to access this quote' })
    return null
  }

  const missing = REQUIRED.filter(f => quote[f] == null)
  if (missing.length) {
    res.status(422).json({ error: 'Quote record is incomplete', missing })
    return null
  }

  return quote
}

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

async function handleGeneratePdf(req, res, caller) {
  const tag = '[dispatch/generate-pdf]'
  console.log(tag, 'handler entered — caller:', caller.email)

  const { quoteId, detentionHourlyRate = 75 } = req.body ?? {}

  const quote = await loadAndAuthorizeQuote(quoteId, caller, res)
  if (!quote) return   // loadAndAuthorizeQuote already wrote the error response

  let element
  try {
    console.log(tag, 'building PDF document element — logo available:', !!LOGO_BASE64)
    element = await buildDocument(quote, Number(detentionHourlyRate) || 75, LOGO_BASE64)
    console.log(tag, 'document element built OK')
  } catch (e) {
    console.error(tag, 'buildDocument threw:', e.message, e.stack)
    return res.status(500).json({ error: 'PDF generation failed' })
  }

  let buffer
  try {
    console.log(tag, 'calling renderToBuffer…')
    const { renderToBuffer } = await import('@react-pdf/renderer')
    buffer = await renderToBuffer(element)
    console.log(tag, 'renderToBuffer complete — bytes:', buffer.length)
  } catch (e) {
    console.error(tag, 'renderToBuffer threw:', e.message, e.stack)
    return res.status(500).json({ error: 'PDF generation failed' })
  }

  // Stream directly in the response — buffer is never written to disk
  const filename = pdfFilename(quote)
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

  const { quoteId, brokerEmail, detentionHourlyRate = 75 } = req.body ?? {}

  if (!brokerEmail || typeof brokerEmail !== 'string' || !EMAIL_RE.test(brokerEmail.trim())) {
    return res.status(400).json({ error: '`brokerEmail` must be a valid email address' })
  }

  const quote = await loadAndAuthorizeQuote(quoteId, caller, res)
  if (!quote) return

  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
  console.log(tag, 'RESEND_API_KEY set:', !!resendKey, '| from:', fromEmail)

  if (!resendKey) {
    return res.status(500).json({ error: 'Email service is not configured' })
  }

  let element
  try {
    console.log(tag, 'building PDF document element — logo available:', !!LOGO_BASE64)
    element = await buildDocument(quote, Number(detentionHourlyRate) || 75, LOGO_BASE64)
    console.log(tag, 'document element built OK')
  } catch (e) {
    console.error(tag, 'buildDocument threw:', e.message, e.stack)
    return res.status(500).json({ error: 'PDF generation failed' })
  }

  let pdfBuffer
  try {
    console.log(tag, 'calling renderToBuffer…')
    const { renderToBuffer } = await import('@react-pdf/renderer')
    pdfBuffer = await renderToBuffer(element)
    console.log(tag, 'renderToBuffer complete — bytes:', pdfBuffer.length)
  } catch (e) {
    console.error(tag, 'renderToBuffer threw:', e.message, e.stack)
    return res.status(500).json({ error: 'PDF generation failed' })
  }

  const driverName = `${caller.firstName ?? ''} ${caller.lastName ?? ''}`.trim()
  const subject    = `Freight Quote — TexLag Express — ${quote.quoteId}`
  const filename   = pdfFilename(quote)

  // TEST MODE: redirect outbound mail to RESEND_TEST_EMAIL if set
  const testOverride = process.env.RESEND_TEST_EMAIL?.trim() || null
  const effectiveTo  = testOverride ?? brokerEmail.trim()
  if (testOverride) {
    console.log(tag, 'TEST MODE — redirecting email to:', testOverride)
  }

  console.log(tag, 'sending email — to:', effectiveTo, '| subject:', subject)

  let data, sendError
  try {
    const resend = new Resend(resendKey)
    console.log(tag, `calling Resend (timeout: ${RESEND_TIMEOUT_MS / 1000}s)…`)
    ;({ data, error: sendError } = await withTimeout(
      resend.emails.send({
        from:    `TexLag Express <${fromEmail}>`,
        to:      [effectiveTo],
        subject,
        html:    buildEmailHtml(quote, driverName),
        attachments: [{
          filename,
          content:      pdfBuffer.toString('base64'),
          content_type: 'application/pdf',
        }],
      }),
      RESEND_TIMEOUT_MS,
      'Resend API call',
    ))
  } catch (e) {
    console.error(tag, 'Resend threw:', e.message)
    return res.status(502).json({ error: 'Email delivery failed' })
  }

  if (sendError) {
    console.error(tag, 'Resend API error:', JSON.stringify(sendError))
    return res.status(502).json({ error: 'Email delivery failed' })
  }

  console.log(tag, 'email sent — messageId:', data?.id)

  logAudit({
    action:      AUDIT.QUOTE_EMAILED,
    performedBy: caller.email,
    description: testOverride
      ? `Quote ${quote.quoteId} emailed (TEST → ${testOverride}, intended: ${brokerEmail.trim()})`
      : `Quote ${quote.quoteId} emailed to broker ${brokerEmail.trim()}`,
  })

  return res.status(200).json({
    success:   true,
    messageId: data?.id ?? null,
    sentTo:    effectiveTo,
    quoteId:   quote.quoteId,
    subject,
  })
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setSecurityHeaders(res)

  try {
    console.log('[dispatch] request — method:', req.method,
      '| action:', req.body?.action, '| cwd:', process.cwd())

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    // ── Auth: verify JWT, active flag, token-invalidation-after-pw-change ──────
    const caller = await requireAuth(req, res)
    if (!caller) return
    console.log('[dispatch] auth OK — caller:', caller.email, '| role:', caller.role)

    const { action } = req.body ?? {}

    switch (action) {
      case 'generate-pdf': return await handleGeneratePdf(req, res, caller)
      case 'send-quote':   return await handleSendQuote(req, res, caller)
      default:
        return res.status(400).json({
          error:   '`action` must be one of: generate-pdf, send-quote',
          allowed: ['generate-pdf', 'send-quote'],
        })
    }
  } catch (err) {
    console.error('[dispatch] TOP-LEVEL UNHANDLED ERROR:', err.message, err.stack)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
