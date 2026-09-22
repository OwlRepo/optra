// Agreed vendor prices, with the window each one applies to (S9).
//
// POLICY v1 #5 keeps the approved PO unit price authoritative for the
// PO-vs-invoice comparison. These rows answer the other question — was the
// price we ordered at the one we had agreed — so they are deliberately
// authored to AGREE with the seeded purchase orders. The demo should open on a
// workspace that is buying on contract, not on a manufactured pile of
// exceptions.
//
// Every price is a STRING: drizzle maps `numeric` to a JS string and a number
// would round on the way in. Same rule as data/procurement.ts.
import { DEMO_WORKSPACE_ID, VENDOR_IDS, daysAgo } from '../config'
import { PO_LINE_SPECS } from './procurement'

export const PRICE_TERM_IDS = Array.from(
  { length: 8 },
  (_, i) => `15000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

/**
 * Two items per vendor carry an agreed price, not every item. A vendor with a
 * contract for some of its catalogue and not the rest is the ordinary case,
 * and it is what proves the comparison stays silent about items nobody agreed
 * a price for rather than flagging them all.
 */
const CONTRACTED_LINES_PER_VENDOR = 2

export function buildVendorPriceTermRows() {
  const rows: {
    id: string
    workspaceId: string
    vendorId: string
    sku: string
    skuKey: string
    uom: string | null
    unitPrice: string
    currency: string
    effectiveFrom: Date
    effectiveTo: Date | null
    sourceReference: string | null
    supersedesId: string | null
    createdBy: string | null
    createdAt: Date
    updatedAt: Date
  }[] = []

  let idIndex = 0
  const nextId = () => PRICE_TERM_IDS[idIndex++]!

  VENDOR_IDS.forEach((vendorId, vendorIndex) => {
    const lines = PO_LINE_SPECS[vendorIndex] ?? []

    lines.slice(0, CONTRACTED_LINES_PER_VENDOR).forEach((line, lineIndex) => {
      // Effective well before the oldest seeded purchase order (150 days), so
      // every order in the demo falls inside a live window.
      const from = daysAgo(400)

      // The first item of the first vendor carries a superseded pair, so the
      // demo shows the shape the service actually writes: a closed window
      // linking back to the price it replaced, never an edited row.
      const superseded = vendorIndex === 0 && lineIndex === 0
      if (superseded) {
        const olderId = nextId()
        const changeover = daysAgo(200)
        rows.push({
          id: olderId,
          workspaceId: DEMO_WORKSPACE_ID,
          vendorId,
          sku: line.sku,
          skuKey: line.sku.toLowerCase(),
          uom: null,
          // The price before the last renegotiation — history, not a correction.
          unitPrice: (Number(line.price) * 0.96).toFixed(2),
          currency: 'USD',
          effectiveFrom: from,
          effectiveTo: changeover,
          sourceReference: 'MSA-2025-11 Schedule B',
          supersedesId: null,
          createdBy: null,
          createdAt: from,
          updatedAt: changeover,
        })
        rows.push({
          id: nextId(),
          workspaceId: DEMO_WORKSPACE_ID,
          vendorId,
          sku: line.sku,
          skuKey: line.sku.toLowerCase(),
          uom: null,
          unitPrice: line.price,
          currency: 'USD',
          effectiveFrom: changeover,
          effectiveTo: null,
          sourceReference: 'MSA-2026-04 Schedule B rev 2',
          supersedesId: olderId,
          createdBy: null,
          createdAt: changeover,
          updatedAt: changeover,
        })
        return
      }

      rows.push({
        id: nextId(),
        workspaceId: DEMO_WORKSPACE_ID,
        vendorId,
        sku: line.sku,
        skuKey: line.sku.toLowerCase(),
        uom: null,
        unitPrice: line.price,
        currency: 'USD',
        effectiveFrom: from,
        effectiveTo: null,
        sourceReference: 'MSA-2026-04 Schedule B rev 2',
        supersedesId: null,
        createdBy: null,
        createdAt: from,
        updatedAt: from,
      })
    })
  })

  return rows
}
