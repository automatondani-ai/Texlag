/**
 * POST /api/send-quote
 *
 * Body: { quote, brokerEmail, detentionHourlyRate? }
 * Auth: Bearer JWT (any valid session — admin or driver)
 *
 * Generates the quote PDF from the shared builder, then sends it to the
 * broker's address via the Resend SDK with the PDF attached.
 *
 * Required env vars:
 *   RESEND_API_KEY     — Resend secret key
 *   RESEND_FROM_EMAIL  — Verified sender address, e.g. quotes@yourdomain.com
 *                        Falls back to onboarding@resend.dev when not set
 *                        (Resend test address — only delivers to your own account).
 */

import { Resend }          from 'resend'
import { renderToBuffer }  from '@react-pdf/renderer'
import { verifyToken }     from './_lib/auth.js'
import { buildDocument, BRAND, fmt } from './_lib/buildQuotePDF.js'

const REQUIRED = ['quoteId', 'pickup', 'dropoffs', 'lineItems', 'finalQuote']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Email HTML template ──────────────────────────────────────────────────────

function buildEmailHtml(quote, driverName) {
  const dateStr = new Date(quote.generatedAt ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const route       = [quote.pickup, ...(quote.dropoffs ?? [])].join(' → ')
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

          <!-- ── Header band -->
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

          <!-- ── Body -->
          <tr>
            <td style="padding:32px 40px 28px;">

              <p style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 6px 0;">
                Freight Quote — ${quote.quoteId}
              </p>
              <p style="font-size:13px;color:#64748b;margin:0 0 24px 0;">${dateStr}</p>

              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 24px 0;">
                Dear Broker,
              </p>
              <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 24px 0;">
                Please find attached a freight quote prepared by
                <strong style="color:#1e293b;">${driverName}</strong>
                on behalf of TexLag Express. The attached PDF contains the full
                itemised cost breakdown including all applicable rates,
                surcharges, and policy terms applicable to this load.
              </p>

              <!-- ── Quote summary card -->
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

              <!-- ── Final quote total bar -->
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

          <!-- ── Footer -->
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

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  let caller
  try {
    caller = verifyToken(req)
  } catch (e) {
    return res.status(e.status ?? 401).json({ error: e.message })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const {
    quote,
    brokerEmail,
    detentionHourlyRate = 75,
  } = req.body ?? {}

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!brokerEmail || typeof brokerEmail !== 'string' || !EMAIL_RE.test(brokerEmail.trim())) {
    return res.status(400).json({ error: '`brokerEmail` must be a valid email address' })
  }

  if (!quote || typeof quote !== 'object') {
    return res.status(400).json({ error: '`quote` object is required in the request body' })
  }

  const missing = REQUIRED.filter(k => quote[k] == null)
  if (missing.length) {
    return res.status(400).json({ error: 'Quote is missing required fields', missing })
  }

  // ── Env vars ────────────────────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

  if (!resendKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not configured' })
  }

  // ── Generate PDF buffer ─────────────────────────────────────────────────────
  let pdfBuffer
  try {
    pdfBuffer = await renderToBuffer(
      buildDocument(quote, Number(detentionHourlyRate) || 75)
    )
  } catch (e) {
    console.error('[send-quote] PDF generation failed:', e)
    return res.status(500).json({ error: `PDF generation failed: ${e.message}` })
  }

  // ── Send email via Resend ───────────────────────────────────────────────────
  const driverName = `${caller.firstName ?? ''} ${caller.lastName ?? ''}`.trim()
  const subject    = `Freight Quote — TexLag Express — ${quote.quoteId}`
  const filename   = `TexLag-Quote-${quote.quoteId}.pdf`

  const resend = new Resend(resendKey)

  const { data, error: sendError } = await resend.emails.send({
    from:    `TexLag Express <${fromEmail}>`,
    to:      [brokerEmail.trim()],
    subject,
    html:    buildEmailHtml(quote, driverName),
    attachments: [
      {
        filename,
        content: pdfBuffer.toString('base64'),
      },
    ],
  })

  if (sendError) {
    console.error('[send-quote] Resend error:', sendError)
    return res.status(502).json({
      error:   'Email delivery failed',
      details: sendError.message ?? sendError,
    })
  }

  return res.status(200).json({
    success:   true,
    messageId: data?.id ?? null,
    sentTo:    brokerEmail.trim(),
    quoteId:   quote.quoteId,
    subject,
  })
}
