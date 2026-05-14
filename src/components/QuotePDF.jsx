import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

const fmt     = (n) => `$${Number(n).toFixed(2)}`
const fmtRate = (r) => `$${Number(r).toFixed(4)}/mi`

const C = {
  blue:      '#2563eb',
  blueDark:  '#1e40af',
  teal:      '#0d9488',
  tealLight: '#f0fdfa',
  gray50:    '#f8fafc',
  gray100:   '#f1f5f9',
  gray200:   '#e2e8f0',
  gray400:   '#94a3b8',
  gray500:   '#64748b',
  gray600:   '#475569',
  gray700:   '#334155',
  gray800:   '#1e293b',
  white:     '#ffffff',
}

const s = StyleSheet.create({
  // ── PAGE
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 44,
    paddingBottom: 76,
    paddingHorizontal: 48,
    color: C.gray800,
    backgroundColor: C.white,
  },

  // ── HEADER
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 18,
    marginBottom: 28,
    borderBottomWidth: 2.5,
    borderBottomColor: C.blue,
  },
  brand: {
    fontSize: 21,
    fontFamily: 'Helvetica-Bold',
    color: C.blue,
    letterSpacing: 0.4,
  },
  brandSub: {
    fontSize: 7.5,
    color: C.gray400,
    marginTop: 4,
    letterSpacing: 1.4,
  },
  quoteWord: {
    fontSize: 21,
    fontFamily: 'Helvetica-Bold',
    color: C.teal,
    textAlign: 'right',
  },
  quoteMeta: {
    fontSize: 8,
    color: C.gray400,
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 1.6,
  },

  // ── SECTION
  section: { marginBottom: 22 },
  sectionTitle: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray400,
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
    letterSpacing: 0.8,
  },

  // ── ROUTE ROWS
  routeRow: { flexDirection: 'row', marginBottom: 5, alignItems: 'flex-start' },
  routeKey: {
    width: 62,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    paddingTop: 1,
    letterSpacing: 0.5,
  },
  routeVal: { flex: 1, fontSize: 10, color: C.gray800, lineHeight: 1.4 },

  // ── TABLE
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: C.gray100,
    borderRadius: 4,
    marginBottom: 1,
  },
  thCell: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
    alignItems: 'flex-start',
  },
  tableRowAlt: { backgroundColor: C.gray50 },
  tdCell: { fontSize: 10, color: C.gray700 },
  tdSub:  { fontSize: 7.5, color: C.gray400, marginTop: 2 },

  // Column widths — LETTER usable width ≈ 516pt
  colDesc:   { flex: 1 },
  colMiles:  { width: 60, textAlign: 'right' },
  colAmount: { width: 70, textAlign: 'right' },

  // ── SUBTOTAL / TOTAL
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: C.gray200,
  },
  subtotalLabel: {
    flex: 1,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.gray600,
  },
  subtotalValue: {
    width: 70,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.gray600,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: C.blueDark,
    borderRadius: 5,
    marginTop: 6,
    alignItems: 'center',
  },
  totalLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  totalValue: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },

  // ── INTERNAL COST
  internalBox: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: C.gray50,
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.gray200,
  },
  internalLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray400,
    letterSpacing: 0.5,
  },
  internalValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.gray600,
  },

  // ── FOOTER
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.gray200,
  },
  footerText: {
    fontSize: 7.5,
    color: C.gray400,
    textAlign: 'center',
    lineHeight: 1.6,
  },
  footerBrand: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    textAlign: 'center',
    marginTop: 4,
  },
})

export default function QuotePDF({ quote }) {
  const activeItems = Object.entries(quote.lineItems).filter(([, v]) => v !== null)
  const isTeam      = quote.driverMode === 'team'

  const activeOptions = [
    quote.toggles?.hazmat && 'Hazmat',
    quote.toggles?.tanker && 'Tanker',
    quote.toggles?.tolls  && 'Tolls',
  ].filter(Boolean)

  const dateStr = new Date(quote.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Document title={quote.quoteId} author="Texlag Express">
      <Page size="LETTER" style={s.page}>

        {/* ── HEADER */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>TEXLAG EXPRESS</Text>
            <Text style={s.brandSub}>FREIGHT BROKERAGE</Text>
          </View>
          <View>
            <Text style={s.quoteWord}>QUOTE</Text>
            <Text style={s.quoteMeta}>{quote.quoteId}{'\n'}{dateStr}</Text>
          </View>
        </View>

        {/* ── ROUTE DETAILS */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>ROUTE DETAILS</Text>

          <View style={s.routeRow}>
            <Text style={s.routeKey}>PICKUP</Text>
            <Text style={s.routeVal}>{quote.pickup}</Text>
          </View>

          {quote.dropoffs.map((d, i) => (
            <View key={i} style={s.routeRow}>
              <Text style={s.routeKey}>
                {quote.dropoffs.length > 1 ? `DROP ${i + 1}` : 'DELIVERY'}
              </Text>
              <Text style={s.routeVal}>{d}</Text>
            </View>
          ))}

          <View style={s.routeRow}>
            <Text style={s.routeKey}>DISTANCE</Text>
            <Text style={s.routeVal}>{quote.totalMiles} miles total</Text>
          </View>

          <View style={s.routeRow}>
            <Text style={s.routeKey}>DRIVER</Text>
            <Text style={s.routeVal}>{isTeam ? 'Team (2 drivers)' : 'Solo'}</Text>
          </View>

          {activeOptions.length > 0 && (
            <View style={s.routeRow}>
              <Text style={s.routeKey}>OPTIONS</Text>
              <Text style={s.routeVal}>{activeOptions.join(', ')}</Text>
            </View>
          )}
        </View>

        {/* ── COST BREAKDOWN */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>COST BREAKDOWN</Text>

          {/* Table header */}
          <View style={s.tableHead}>
            <Text style={[s.thCell, s.colDesc]}>DESCRIPTION</Text>
            <Text style={[s.thCell, s.colMiles]}>MILES</Text>
            <Text style={[s.thCell, s.colAmount]}>AMOUNT</Text>
          </View>

          {/* Line item rows */}
          {activeItems.map(([key, item], i) => (
            <View key={key} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
              <View style={s.colDesc}>
                <Text style={s.tdCell}>{item.label}</Text>
                {item.rate != null && (
                  <Text style={s.tdSub}>{fmtRate(item.rate)}</Text>
                )}
              </View>
              <Text style={[s.tdCell, s.colMiles]}>
                {item.miles != null ? String(item.miles) : '—'}
              </Text>
              <Text style={[s.tdCell, s.colAmount]}>{fmt(item.amount)}</Text>
            </View>
          ))}

          {/* Subtotal */}
          <View style={s.subtotalRow}>
            <Text style={[s.subtotalLabel, s.colDesc]}>Mileage subtotal</Text>
            <Text style={s.subtotalValue}>{fmt(quote.subtotalMileage)}</Text>
          </View>

          {/* Total */}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total Quote</Text>
            <Text style={s.totalValue}>{fmt(quote.totalQuote)}</Text>
          </View>

          {/* Internal driver cost */}
          <View style={s.internalBox}>
            <Text style={s.internalLabel}>INTERNAL DRIVER COST (SINGLE-DRIVER BASIS)</Text>
            <Text style={s.internalValue}>{fmt(quote.internalDriverCost)}</Text>
          </View>
        </View>

        {/* ── FOOTER */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {'This quote is valid for 48 hours from the date of issue. All rates are subject to change based on fuel and market conditions.'}
            {isTeam
              ? `\nTeam load: client billed at 2× CPM. Driver payable is calculated on a single-driver basis (${fmt(quote.internalDriverCost)}) and should not be disclosed to the client.`
              : ''}
          </Text>
          <Text style={s.footerBrand}>Texlag Express · Freight Brokerage</Text>
        </View>

      </Page>
    </Document>
  )
}
