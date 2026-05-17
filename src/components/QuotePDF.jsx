import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

// ── Brand constants ──────────────────────────────────────────────────────────

const BRAND = {
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

  // ── Header band (full bleed) ──────────────────────────────────────────────
  header: {
    backgroundColor: C.navy,
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 0,
  },
  headerLeft: {},
  headerBrand: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  headerMeta: {
    flexDirection: 'row',
  },
  headerMetaText: {
    fontSize: 8,
    color: C.gray400,
    marginRight: 16,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerQuoteWord: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: C.teal,
    letterSpacing: 2,
  },

  // ── Info bar ──────────────────────────────────────────────────────────────
  infoBar: {
    flexDirection: 'row',
    backgroundColor: C.gray100,
    borderBottomWidth: 1,
    borderBottomColor: C.gray200,
    paddingVertical: 12,
    paddingHorizontal: 48,
    marginBottom: 24,
  },
  infoCell: {
    flex: 1,
  },
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

  // ── Body padding wrapper ──────────────────────────────────────────────────
  body: {
    paddingHorizontal: 48,
  },

  // ── Section ───────────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.gray400,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 18,
  },

  // ── Route rows ────────────────────────────────────────────────────────────
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
  routeBadgeTeal: {
    backgroundColor: C.teal,
  },
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

  // ── Table ─────────────────────────────────────────────────────────────────
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
  tableRowAlt: {
    backgroundColor: C.gray50,
  },
  tdLabel: {
    fontSize: 8.5,
    color: C.gray700,
  },
  tdMuted: {
    fontSize: 8.5,
    color: C.gray500,
    textAlign: 'right',
  },
  tdAmount: {
    fontSize: 8.5,
    color: C.gray800,
    textAlign: 'right',
  },

  // Column widths
  colDesc: { flex: 1 },
  colQty:  { width: 70, textAlign: 'right' },
  colAmt:  { width: 72, textAlign: 'right' },

  // ── Subtotal / total rows ─────────────────────────────────────────────────
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
  totalLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  totalNote: {
    fontSize: 7,
    color: C.gray400,
    fontFamily: 'Helvetica',
    marginTop: 2,
  },
  totalValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },

  // ── Detention compliance box ───────────────────────────────────────────────
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

  // ── Footer (fixed) ────────────────────────────────────────────────────────
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
  footerSub: {
    fontSize: 7,
    color: C.gray400,
  },
  footerRight: {
    alignItems: 'flex-end',
  },
  footerIdText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    marginBottom: 2,
  },
  footerDateText: {
    fontSize: 7,
    color: C.gray400,
  },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n => `$${Number(n ?? 0).toFixed(2)}`

function itemQty(item) {
  if (item.days  != null) return `${item.days} day${item.days !== 1 ? 's' : ''}`
  if (item.miles != null) return `${item.miles} mi`
  return '—'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function QuotePDF({ quote, detentionHourlyRate = 75 }) {
  const detentionOff = !quote.toggles?.detention
  const activeItems  = Object.entries(quote.lineItems ?? {})
    .filter(([k, v]) => v !== null && k !== 'backhaulSurcharge')
  const driverName   = `${quote.driver?.firstName ?? ''} ${quote.driver?.lastName ?? ''}`.trim()
  const isTeam       = quote.driverMode === 'team'
  const jurisdLabel  = quote.jurisdiction === 'intrastate' ? 'Intrastate' : 'Interstate'

  const dateStr = new Date(quote.generatedAt ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Document title={quote.quoteId} author="TexLag Express">
      <Page size="LETTER" style={s.page}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerBrand}>{BRAND.name}</Text>
            <View style={s.headerMeta}>
              <Text style={s.headerMetaText}>{BRAND.usdot}</Text>
              <Text style={s.headerMetaText}>{BRAND.mc}</Text>
              <Text style={s.headerMetaText}>{BRAND.phone}</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.headerQuoteWord}>QUOTE</Text>
          </View>
        </View>

        {/* ── Info bar ─────────────────────────────────────────────────── */}
        <View style={s.infoBar}>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Quote ID</Text>
            <Text style={s.infoValue}>{quote.quoteId}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Date</Text>
            <Text style={s.infoValue}>{dateStr}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Jurisdiction</Text>
            <Text style={s.infoValue}>{jurisdLabel}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Driver Mode</Text>
            <Text style={s.infoValue}>{isTeam ? 'Team (2×)' : 'Solo'}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Total Miles</Text>
            <Text style={s.infoValue}>{quote.totalMiles} mi</Text>
          </View>
        </View>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <View style={s.body}>

          {/* Route */}
          <Text style={s.sectionTitle}>Route Details</Text>

          <View style={s.routeRow}>
            <Text style={s.routeBadge}>PICKUP</Text>
            <Text style={s.routeAddress}>{quote.pickup}</Text>
          </View>

          {(quote.dropoffs ?? []).map((d, i) => (
            <View key={i} style={s.routeRow}>
              <Text style={[s.routeBadge, s.routeBadgeTeal]}>
                {(quote.dropoffs ?? []).length === 1 ? 'DELIVERY' : `DROP ${i + 1}`}
              </Text>
              <Text style={s.routeAddress}>{d}</Text>
            </View>
          ))}

          {(quote.legs ?? []).map((leg, i) => (
            <Text key={i} style={s.legLine}>
              Leg {i + 1}: {leg.from} → {leg.to} · {leg.miles} mi
            </Text>
          ))}

          {/* Quote breakdown */}
          <Text style={s.sectionTitle}>Quote Breakdown</Text>

          <View style={s.tableHead}>
            <Text style={[s.thCell, s.colDesc]}>Description</Text>
            <Text style={[s.thCell, s.colQty]}>Quantity</Text>
            <Text style={[s.thCell, s.colAmt]}>Amount</Text>
          </View>

          {activeItems.map(([key, item], i) => (
            <View key={key} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
              <Text style={[s.tdLabel, s.colDesc]}>{item.label}</Text>
              <Text style={[s.tdMuted, s.colQty]}>{itemQty(item)}</Text>
              <Text style={[s.tdAmount, s.colAmt]}>{fmt(item.amount)}</Text>
            </View>
          ))}

          {/* Core subtotal */}
          <View style={s.subtotalRow}>
            <Text style={s.subtotalLabel}>Core Subtotal</Text>
            <Text style={s.subtotalValue}>{fmt(quote.coreSubtotal)}</Text>
          </View>

          {/* Final quote */}
          <View style={s.totalRow}>
            <View style={s.colDesc}>
              <Text style={s.totalLabel}>Final Quote</Text>
              {quote.backhaulApplied && (
                <Text style={s.totalNote}>Low/No Backhaul surcharge applied (fuel ×2)</Text>
              )}
            </View>
            <Text style={s.totalValue}>{fmt(quote.finalQuote)}</Text>
          </View>

          {/* Detention notice — always shown; rate appended when detention is charged */}
          <View style={s.complianceBox}>
            <Text style={s.complianceTitle}>Detention Policy</Text>
            <Text style={s.complianceBody}>
              {detentionOff
                ? 'Detention charges apply after 2 hours of free waiting time.'
                : `Detention charges apply after 2 hours of free waiting time, at a rate of ${fmt(quote.lineItems?.detentionFee?.amount ?? 0)} per hour.`
              }
            </Text>
          </View>

        </View>

        {/* ── Footer (fixed across all pages) ──────────────────────────── */}
        <View style={s.footer} fixed>
          <View>
            <Text style={s.footerPreparedBy}>
              Quote Prepared By: {driverName}
            </Text>
            <Text style={s.footerSub}>
              {BRAND.name} · {BRAND.usdot} · {BRAND.mc} · {BRAND.phone}
            </Text>
          </View>
          <View style={s.footerRight}>
            <Text style={s.footerIdText}>{quote.quoteId}</Text>
            <Text style={s.footerDateText}>{dateStr}</Text>
          </View>
        </View>

      </Page>
    </Document>
  )
}
