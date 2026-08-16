// Static scenario data for the landing page's two interactive pieces: the hero
// match demo (a document/line walkthrough) and the product tour (four vignettes
// portraying real app screens). Both read from this one module so the same
// "PO #4417" story stays identical between them instead of drifting into two
// hand-copied variants -- the same reason `landing-example.ts` exists.
//
// Every figure here is a PLACEHOLDER METRIC for a static marketing example --
// not a measured product statistic and not customer data. Confirm/replace
// before treating any of these as a real claim.

// Illustrative catalog photo -- Unsplash, "Grey stainless steel bolt and screw
// lot" by Marcel Strauss (free for commercial use, hotlinking permitted per
// Unsplash's guidelines). The same photo already backs `landing-example.ts`.
// PLACEHOLDER ASSET -- replace with real catalog photography before launch.
export const DEMO_CATALOG_PHOTO =
  'https://images.unsplash.com/photo-1564226591723-659ff3852b2a?q=80&w=400&auto=format&fit=crop'

// `kind` drives the tone of the row, pill, and evidence border:
//   ok   -> matched   (primary-strong teal)
//   warn -> flagged   (flag amber)
//   bad  -> mismatch  (destructive red)
export type DemoLineKind = 'ok' | 'warn' | 'bad'

export type DemoLine = {
  no: string
  item: string
  price: string
  tag: string
  kind: DemoLineKind
  poPrice: string
  catPrice: string
  confidence: string
  text: string
  source: string
}

export type DemoDoc = {
  label: string
  lines: readonly DemoLine[]
}

export const DEMO_DOCS = [
  {
    label: 'PO #4417 · Ironclad',
    lines: [
      {
        no: 'L01',
        item: '40 × 1/2in galvanised elbow',
        price: '$1.12',
        tag: 'Matched',
        kind: 'ok',
        // PLACEHOLDER METRIC
        poPrice: '$1.12',
        // PLACEHOLDER METRIC
        catPrice: '$1.12',
        // PLACEHOLDER METRIC
        confidence: '96%',
        text: 'Catalog entry agrees on part number, price, and photo. Nothing to review on this line.',
        source: 'ironclad-supply/catalog-2026-Q1.pdf · p.07',
      },
      {
        no: 'L03',
        item: '200 × 3/8in steel hex bolts',
        price: '$0.42',
        tag: 'Flagged',
        kind: 'warn',
        // PLACEHOLDER METRIC
        poPrice: '$0.42',
        // PLACEHOLDER METRIC -- deliberately above the PO price; this is the flag
        catPrice: '$0.51',
        // PLACEHOLDER METRIC
        confidence: '92%',
        text: 'Vendor catalog lists this SKU at $0.51/unit — 18% above the PO price. The photo matches, so the item is right and the price is not.',
        source: 'ironclad-supply/catalog-2026-Q1.pdf · p.14',
      },
      {
        no: 'L07',
        item: '12 × pipe wrench, 14in',
        price: '$18.40',
        tag: 'Mismatch',
        kind: 'bad',
        // PLACEHOLDER METRIC
        poPrice: '$18.40',
        // PLACEHOLDER METRIC
        catPrice: '$18.40',
        // PLACEHOLDER METRIC
        confidence: '61%',
        text: 'Price agrees, but the catalog photo for this SKU shows a 10in wrench. Likely a substituted item — verify before receiving.',
        source: 'ironclad-supply/catalog-2026-Q1.pdf · p.31',
      },
    ],
  },
  {
    label: 'INV #8820 · Northgate',
    lines: [
      {
        no: 'L02',
        item: '2,000 × corrugated mailer 9×6',
        price: '$0.31',
        tag: 'Matched',
        kind: 'ok',
        // PLACEHOLDER METRIC
        poPrice: '$0.31',
        // PLACEHOLDER METRIC
        catPrice: '$0.31',
        // PLACEHOLDER METRIC
        confidence: '97%',
        text: 'Invoiced price and quantity match the PO and the current price list. Cleared without review.',
        source: 'northgate/price-list-jan-2026.xlsx · row 118',
      },
      {
        no: 'L05',
        item: '500 × kraft paper tape, 48mm',
        // PLACEHOLDER METRIC -- the invoiced rate. Intentionally HIGHER than
        // poPrice below: the invoice bills above the agreed PO price, which is
        // the whole point of this line. Do not "correct" them to match.
        price: '$2.05',
        tag: 'Flagged',
        kind: 'warn',
        // PLACEHOLDER METRIC
        poPrice: '$1.80',
        // PLACEHOLDER METRIC
        catPrice: '$1.80',
        // PLACEHOLDER METRIC
        confidence: '94%',
        text: 'Invoice bills $2.05/roll against a $1.80 PO and price-list entry — a 13.9% increase with no revised quote attached.',
        source: 'northgate/price-list-jan-2026.xlsx · row 204',
      },
      {
        no: 'L06',
        item: '24 × stretch wrap roll, 20in',
        price: '$9.60',
        tag: 'Mismatch',
        kind: 'bad',
        // PLACEHOLDER METRIC
        poPrice: '$9.60',
        // PLACEHOLDER METRIC
        catPrice: '$9.60',
        // PLACEHOLDER METRIC
        confidence: '88%',
        text: 'Unit price is correct, but the invoice bills 24 rolls where the PO ordered 18. Quantity overage of 6 flagged before payment.',
        source: 'northgate/po-8791.pdf · line 6',
      },
      {
        no: 'L09',
        item: '6 × pallet strapping kit',
        price: '$41.00',
        tag: 'Matched',
        kind: 'ok',
        // PLACEHOLDER METRIC
        poPrice: '$41.00',
        // PLACEHOLDER METRIC
        catPrice: '$41.00',
        // PLACEHOLDER METRIC
        confidence: '95%',
        text: 'Matched to the catalog entry on SKU, price, and photo. No prior flags on this item.',
        source: 'northgate/catalog-2026.pdf · p.22',
      },
    ],
  },
] as const satisfies readonly DemoDoc[]

// Copy shown during the 1100ms scanning phase, before a verdict resolves.
// Note the em-dash placeholder applies to the catalog price and confidence
// only -- the PO price is read straight off the document, so it is known
// immediately and keeps its real value while the match runs.
export const DEMO_SCANNING = {
  text: 'Reading the line item, locating the catalog entry, comparing price and photo…',
  source: 'searching 3 catalog sources',
  placeholder: '——',
} as const

export const DEMO_SCAN_MS = 1100
export const DEMO_DWELL_MS = 3800

// --- Product tour -----------------------------------------------------------
// Four vignettes, each portraying a real authenticated screen. The first three
// deliberately reference lines that already exist above (L03 / L07 / L06) by id
// rather than restating their figures, so the tour and the hero demo can never
// disagree about the same invoice.

export type TourVignette = {
  id: string
  chip: string
  screen: string
  title: string
  description: string
  /** Indexes into DEMO_DOCS as [docIndex, lineIndex]; absent for the chat vignette. */
  line?: readonly [number, number]
}

export const TOUR_VIGNETTES = [
  {
    id: 'price',
    chip: 'Price increase',
    screen: 'Discrepancies',
    title: 'A price increase surfaces before approval',
    description:
      'The catalog lists this SKU above what the PO agreed. Optra shows the delta and the page it read it from.',
    line: [0, 1],
  },
  {
    id: 'photo',
    chip: 'Wrong item',
    screen: 'Catalog matches',
    title: 'The photo catches a substituted item',
    description:
      'Part numbers read fine as text. The catalog photo for this SKU shows a different tool than the one ordered.',
    line: [0, 2],
  },
  {
    id: 'quantity',
    chip: 'Quantity overage',
    screen: 'Procurement',
    title: 'An invoice bills more than the PO ordered',
    description:
      'Unit price is correct, so a price check alone would pass it. The quantity is what moved.',
    line: [1, 2],
  },
  {
    id: 'history',
    chip: 'Vendor history',
    screen: 'Workspace',
    title: 'Ask the workspace what this vendor did last time',
    description:
      'Every past match stays searchable, with the file and page behind each answer.',
  },
] as const satisfies readonly TourVignette[]

// The chat vignette needs its own copy -- it is the one tour frame with no
// corresponding line in DEMO_DOCS.
export const TOUR_CHAT_EXCHANGE = {
  question: 'Has Ironclad raised the price on 3/8in hex bolts before?',
  answer:
    'Yes — once. The same SKU moved from $0.42 to $0.51 in January 2026 and was flagged and resolved then. The two prior orders both matched at $0.42.',
  citations: [
    'ironclad-supply/catalog-2026-Q1.pdf · p.14',
    'ironclad-supply/catalog-2025-Q3.pdf · p.12',
  ],
  // PLACEHOLDER METRIC -- 0-1 confidence backing the in-frame meter
  confidence: 0.94,
} as const

// Past-flag history rows shown on the third product card and reused by the
// history vignette. PLACEHOLDER METRIC values throughout.
export const DEMO_HISTORY_ROWS = [
  { date: '2026-01-14', detail: 'flagged +18% · resolved', highlighted: true },
  { date: '2025-10-02', detail: 'matched · $0.42', highlighted: false },
  { date: '2025-06-19', detail: 'matched · $0.42', highlighted: false },
] as const
