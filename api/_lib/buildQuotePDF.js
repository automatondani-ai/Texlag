/**
 * Shared PDF document builder used by both api/generate-pdf.js and
 * api/send-quote.js.  Written with React.createElement (no JSX) so it works
 * inside Vercel serverless functions without a JSX transform step.
 *
 * Mirrors the layout of src/components/QuotePDF.jsx exactly.
 */

import { createElement as h } from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { LOGO_BASE64 } from './logoBase64.js'

// ── Brand ────────────────────────────────────────────────────────────────────

export const BRAND = {
  name:  'TexLag Express',
  usdot: 'USDOT Number: 3609656',
  mc:    'MC-1229052',
  phone: 'Phone: +1(832) - 944 - 5199',
}

// ── Design tokens ────────────────────────────────────────────────────────────

const C = {
  navy:        '#1e293b',
  navyDark:    '#0f172a',
  blue:        '#045184',
  teal:        '#0d9488',
  white:       '#ffffff',
  gray50:      '#f8fafc',
  gray100:     '#f1f5f9',
  gray200:     '#e2e8f0',
  gray400:     '#94a3b8',
  gray500:     '#64748b',
  gray600:     '#475569',
  gray700:     '#334155',
  gray800:     '#1e293b',
  amberBg:     '#fffbeb',
  amberBorder: '#f59e0b',
  amberTitle:  '#92400e',
  amberBody:   '#78350f',
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.gray800,
    backgroundColor: C.white,
    paddingTop: 0,
    paddingBottom: 72,
    paddingHorizontal: 0,
  },
  header: {
    backgroundColor: C.navy,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 52,
    height: 52,
    marginRight: 14,
    objectFit: 'contain',
  },
  headerBrand: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  headerMeta: { flexDirection: 'row' },
  headerMetaText: {
    fontSize: 8,
    color: C.gray400,
    marginRight: 16,
  },
  headerQuoteWord: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: C.teal,
    letterSpacing: 2,
  },
  infoBar: {
    flexDirection: 'row',
    backgroundColor: C.gray100,
    borderBottomWidth: 1,
    borderBottomColor: C.gray200,
    paddingVertical: 12,
    paddingHorizontal: 48,
    marginBottom: 24,
  },
  infoCell: { flex: 1 },
  infoLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray400,
    letterSpacing: 0.7,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.gray800,
  },
  body: { paddingHorizontal: 48 },
  sectionTitle: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.gray400,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 18,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 5,
  },
  routeBadge: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    backgroundColor: C.blue,
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 3,
    width: 50,
    textAlign: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  routeBadgeTeal: { backgroundColor: C.teal },
  routeAddress: {
    flex: 1,
    fontSize: 9.5,
    color: C.gray800,
    lineHeight: 1.4,
  },
  legLine: {
    fontSize: 7.5,
    color: C.gray400,
    marginBottom: 2,
    marginLeft: 60,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 3,
    marginBottom: 1,
  },
  thCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
  },
  tableRowAlt: { backgroundColor: C.gray50 },
  tdLabel:  { fontSize: 8.5, color: C.gray700 },
  tdMuted:  { fontSize: 8.5, color: C.gray500, textAlign: 'right' },
  tdAmount: { fontSize: 8.5, color: C.gray800, textAlign: 'right' },
  colDesc: { flex: 1 },
  colQty:  { width: 70, textAlign: 'right' },
  colAmt:  { width: 72, textAlign: 'right' },
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: C.gray200,
    marginTop: 2,
  },
  subtotalLabel: {
    flex: 1,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
  },
  subtotalValue: {
    width: 72,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.gray600,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.navyDark,
    borderRadius: 4,
    marginTop: 5,
    alignItems: 'center',
  },
  totalLabelWrap: { flex: 1 },
  totalLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  totalNote: {
    fontSize: 7,
    color: C.gray400,
    marginTop: 2,
  },
  totalValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  complianceBox: {
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.amberBg,
    borderLeftWidth: 3,
    borderLeftColor: C.amberBorder,
    borderRadius: 2,
  },
  complianceTitle: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.amberTitle,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  complianceBody: {
    fontSize: 8,
    color: C.amberBody,
    lineHeight: 1.6,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 48,
    right: 48,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: C.gray200,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  footerPreparedBy: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.gray600,
    marginBottom: 2,
  },
  footerSub: { fontSize: 7, color: C.gray400 },
  footerRight: { alignItems: 'flex-end' },
  footerIdText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    marginBottom: 2,
  },
  footerDateText: { fontSize: 7, color: C.gray400 },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = n => `$${Number(n ?? 0).toFixed(2)}`

function itemQty(item) {
  if (item.days  != null) return `${item.days} day${item.days !== 1 ? 's' : ''}`
  if (item.miles != null) return `${item.miles} mi`
  return '—'
}

// ── Document builder ─────────────────────────────────────────────────────────

export function buildDocument(quote, detentionHourlyRate = 75) {
  const detentionOff = !quote.toggles?.detention
  const activeItems  = Object.entries(quote.lineItems ?? {})
    .filter(([k, v]) => v !== null && k !== 'backhaulSurcharge')
  const driverName   = `${quote.driver?.firstName ?? ''} ${quote.driver?.lastName ?? ''}`.trim()
  const isTeam       = quote.driverMode === 'team'
  const jurisdLabel  = quote.jurisdiction === 'intrastate' ? 'Intrastate' : 'Interstate'

  const dateStr = new Date(quote.generatedAt ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return h(Document, { title: quote.quoteId, author: 'TexLag Express' },
    h(Page, { size: 'LETTER', style: s.page },

      // Header
      h(View, { style: s.header },
        h(View, { style: s.headerLeft },
          h(Image, { src: LOGO_BASE64, style: s.headerLogo }),
          h(View, null,
            h(Text, { style: s.headerBrand }, BRAND.name),
            h(View, { style: s.headerMeta },
              h(Text, { style: s.headerMetaText }, BRAND.usdot),
              h(Text, { style: s.headerMetaText }, BRAND.mc),
              h(Text, { style: s.headerMetaText }, BRAND.phone),
            ),
          ),
        ),
        h(View, { style: { alignItems: 'flex-end' } },
          h(Text, { style: s.headerQuoteWord }, 'QUOTE'),
        ),
      ),

      // Info bar
      h(View, { style: s.infoBar },
        h(View, { style: s.infoCell },
          h(Text, { style: s.infoLabel }, 'Quote ID'),
          h(Text, { style: s.infoValue }, quote.quoteId),
        ),
        h(View, { style: s.infoCell },
          h(Text, { style: s.infoLabel }, 'Date'),
          h(Text, { style: s.infoValue }, dateStr),
        ),
        h(View, { style: s.infoCell },
          h(Text, { style: s.infoLabel }, 'Jurisdiction'),
          h(Text, { style: s.infoValue }, jurisdLabel),
        ),
        h(View, { style: s.infoCell },
          h(Text, { style: s.infoLabel }, 'Driver Mode'),
          h(Text, { style: s.infoValue }, isTeam ? 'Team (2×)' : 'Solo'),
        ),
        h(View, { style: s.infoCell },
          h(Text, { style: s.infoLabel }, 'Total Miles'),
          h(Text, { style: s.infoValue }, `${quote.totalMiles} mi`),
        ),
      ),

      // Body
      h(View, { style: s.body },

        h(Text, { style: s.sectionTitle }, 'Route Details'),

        h(View, { style: s.routeRow },
          h(Text, { style: s.routeBadge }, 'PICKUP'),
          h(Text, { style: s.routeAddress }, quote.pickup),
        ),

        ...(quote.dropoffs ?? []).map((d, i) =>
          h(View, { key: `drop-${i}`, style: s.routeRow },
            h(Text, { style: [s.routeBadge, s.routeBadgeTeal] },
              (quote.dropoffs ?? []).length === 1 ? 'DELIVERY' : `DROP ${i + 1}`,
            ),
            h(Text, { style: s.routeAddress }, d),
          )
        ),

        ...(quote.legs ?? []).map((leg, i) =>
          h(Text, { key: `leg-${i}`, style: s.legLine },
            `Leg ${i + 1}: ${leg.from} → ${leg.to} · ${leg.miles} mi`,
          )
        ),

        h(Text, { style: s.sectionTitle }, 'Quote Breakdown'),

        h(View, { style: s.tableHead },
          h(Text, { style: [s.thCell, s.colDesc] }, 'Description'),
          h(Text, { style: [s.thCell, s.colQty] },  'Quantity'),
          h(Text, { style: [s.thCell, s.colAmt] },  'Amount'),
        ),

        ...activeItems.map(([key, item], i) =>
          h(View, { key, style: [s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}] },
            h(Text, { style: [s.tdLabel, s.colDesc] }, item.label),
            h(Text, { style: [s.tdMuted,  s.colQty] }, itemQty(item)),
            h(Text, { style: [s.tdAmount, s.colAmt] }, fmt(item.amount)),
          )
        ),

        h(View, { style: s.subtotalRow },
          h(Text, { style: s.subtotalLabel }, 'Core Subtotal'),
          h(Text, { style: s.subtotalValue }, fmt(quote.coreSubtotal)),
        ),

        h(View, { style: s.totalRow },
          h(View, { style: s.totalLabelWrap },
            h(Text, { style: s.totalLabel }, 'Final Quote'),
            quote.backhaulApplied
              ? h(Text, { style: s.totalNote }, 'Low/No Backhaul surcharge applied (fuel ×2)')
              : null,
          ),
          h(Text, { style: s.totalValue }, fmt(quote.finalQuote)),
        ),

        h(View, { style: s.complianceBox },
          h(Text, { style: s.complianceTitle }, 'Detention Policy'),
          h(Text, { style: s.complianceBody },
            detentionOff
              ? 'Detention charges apply after 2 hours of free waiting time.'
              : `Detention charges apply after 2 hours of free waiting time, at a rate of ${fmt(quote.lineItems?.detentionFee?.amount ?? 0)} per hour.`,
          ),
        ),
      ),

      // Footer (fixed across all pages)
      h(View, { style: s.footer, fixed: true },
        h(View, null,
          h(Text, { style: s.footerPreparedBy }, `Quote Prepared By: ${driverName}`),
          h(Text, { style: s.footerSub },
            `${BRAND.name} · ${BRAND.usdot} · ${BRAND.mc} · ${BRAND.phone}`,
          ),
        ),
        h(View, { style: s.footerRight },
          h(Text, { style: s.footerIdText },   quote.quoteId),
          h(Text, { style: s.footerDateText }, dateStr),
        ),
      ),
    )
  )
}
