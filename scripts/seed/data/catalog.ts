// Vendor catalogs and the sourcing / compliance matches drawn against them.
//
// catalog_matches.score is `numeric` → passed as a string. Matches point at
// real seeded PO and invoice line items so the "what did we compare this
// against" links resolve.
import { DEMO_WORKSPACE_ID, daysAgo } from '../config'
import { invoiceLineId, poLineId } from './procurement'

export const VENDOR_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
]

// Four current catalogs plus last year's edition of each — vendors republish
// annually, and having two editions is what makes the sourcing comparison
// interesting rather than a single flat list.
export const CATALOG_IDS = Array.from(
  { length: 8 },
  (_, i) => `21000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)

export function buildVendorRows() {
  return [
    {
      id: VENDOR_IDS[0]!,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Nordwerk Interiors',
      contactInfo: 'orders@nordwerk-interiors.example · +49 30 5550 1180',
      createdAt: daysAgo(75),
      updatedAt: daysAgo(20),
    },
    {
      id: VENDOR_IDS[1]!,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Brightline Systems',
      contactInfo: 'sales@brightline-systems.example · +1 415 555 0142',
      createdAt: daysAgo(68),
      updatedAt: daysAgo(15),
    },
    {
      id: VENDOR_IDS[2]!,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Cedar Supply Co',
      contactInfo: 'hello@cedarsupply.example · +1 503 555 0199',
      createdAt: daysAgo(52),
      updatedAt: daysAgo(9),
    },
  ]
}

interface CatalogSpec {
  vendorIndex: number
  name: string
  sourceKind: 'upload' | 'scrape'
  seedUrl: string | null
  /** [sku, description, stock-image key from images.ts] */
  items: [string, string, string][]
}

const BASE_CATALOGS: CatalogSpec[] = [
  {
    vendorIndex: 0,
    name: 'Nordwerk workspace furniture 2026',
    sourceKind: 'upload',
    seedUrl: null,
    items: [
      ['NW-DSK-160', 'Height-adjustable desk 160x80, solid oak veneer', 'desk-chair'],
      ['NW-DSK-140', 'Height-adjustable desk 140x70, solid oak veneer', 'desk-shelving'],
      ['NW-CHR-MESH', 'Task chair, breathable mesh back, 4D armrests', 'seating-showroom'],
      ['NW-CHR-EXEC', 'Executive chair, bonded leather, headrest', 'seating-showroom'],
      ['NW-MAT-STD', 'Anti-fatigue standing mat, 90x60', 'desk-lamp-scene'],
      ['NW-DIV-120', 'Acoustic desk divider, 120cm, felt', 'desk-shelving'],
      ['NW-STO-3DR', 'Under-desk storage pedestal, three drawers', 'desk-chair'],
      ['NW-LMP-CCT', 'Task lamp, tunable white, USB-C passthrough', 'desk-lamp'],
    ],
  },
  {
    vendorIndex: 1,
    name: 'Brightline IT hardware, autumn list',
    sourceKind: 'scrape',
    seedUrl: 'https://catalog.brightline-systems.example/hardware',
    items: [
      ['BL-LAP-32', 'Developer notebook, 32GB RAM, 1TB NVMe', 'laptop-wood'],
      ['BL-LAP-16', 'Standard notebook, 16GB RAM, 512GB NVMe', 'laptop-blank'],
      ['BL-DCK-TB4', 'Thunderbolt 4 dock, dual DisplayPort, 4x USB-A', 'components'],
      ['BL-MON-27U', '27-inch UHD monitor, USB-C 90W power delivery', 'monitor-desktop'],
      ['BL-HDS-ANC', 'USB headset, active noise cancelling, boom mic', 'earbuds'],
      ['BL-WEB-1080', 'Conference webcam, 1080p60, dual mic array', 'monitor-camera'],
      ['BL-SSD-2T', 'Portable NVMe SSD, 2TB, USB 3.2 Gen 2', 'components'],
      ['BL-ADP-100', 'GaN power adapter, 100W, USB-C', 'components'],
      ['BL-LCK-KEY', 'Keyed laptop lock, 1.8m steel cable', 'components'],
    ],
  },
  {
    vendorIndex: 2,
    name: 'Cedar Supply consumables',
    sourceKind: 'upload',
    seedUrl: null,
    items: [
      ['CS-PPR-A4', 'A4 copier paper 80gsm, carton of five reams', 'boxes'],
      ['CS-TNR-BK', 'High-yield black toner cartridge', 'components'],
      ['CS-COF-1KG', 'Fair-trade whole bean coffee, 1kg', 'coffee-beans'],
      ['CS-CUP-50', 'Compostable cups, sleeve of 50', 'coffee-cups'],
      ['CS-WIP-200', 'Surface cleaning wipes, tub of 200', 'cleaning-sponge'],
      ['CS-NTB-A5', 'Hardcover dotted notebook, A5', 'scissors'],
      ['CS-MKR-12', 'Whiteboard marker assortment, box of 12', 'scissors'],
    ],
  },
  {
    vendorIndex: 2,
    name: 'Cedar Supply green line (recycled)',
    sourceKind: 'scrape',
    seedUrl: 'https://cedarsupply.example/green-line',
    items: [
      ['CS-GRN-PPR', 'Recycled A4 paper 80gsm, carton of five reams', 'packing-box'],
      ['CS-GRN-BIN', 'Three-stream recycling station, 60L', 'facilities-mop'],
      ['CS-GRN-PLT', 'Potted office plant, medium, peat-free', 'vase-decor'],
      ['CS-GRN-CUP', 'Reusable cup, 350ml, recycled polypropylene', 'coffee-cups'],
      ['CS-GRN-WIP', 'Plant-based cleaning wipes, tub of 200', 'cleaning-squeegee'],
      ['CS-GRN-NTB', 'Recycled paper notebook, A5, dotted', 'scissors'],
    ],
  },
]

// Prior-year editions keep the same SKUs — that is the point of a catalog
// number — and mark the description so the two editions are distinguishable
// in the UI.
const PRIOR_EDITIONS: CatalogSpec[] = BASE_CATALOGS.map(spec => ({
  ...spec,
  name: spec.name.includes('2026') ? spec.name.replace('2026', '2025') : `${spec.name} (2025 edition)`,
  sourceKind: 'upload' as const,
  seedUrl: null,
  items: spec.items.map(
    ([sku, description, image]) => [sku, `${description} — 2025 edition`, image] as [string, string, string],
  ),
}))

const CATALOGS: CatalogSpec[] = [...BASE_CATALOGS, ...PRIOR_EDITIONS]

/** Every stock-image key the catalog references, for the seeder to fetch. */
export function catalogImageKeys(): string[] {
  return [...new Set(CATALOGS.flatMap(spec => spec.items.map(([, , image]) => image)))]
}

/** Storage key for an item photo, mirroring the catalog upload key shape. */
export function catalogPhotoKey(catalogIndex: number, n: number, image: string): string {
  return `${DEMO_WORKSPACE_ID}/catalogs/${CATALOG_IDS[catalogIndex]}/photos/${n}-${image}.jpg`
}

export function catalogItemId(catalogIndex: number, n: number): string {
  return `22000000-0000-4000-8000-${String(catalogIndex * 100 + n).padStart(12, '0')}`
}

/** Prior-year editions are a year older than the current ones. */
const catalogAge = (i: number) => (i < BASE_CATALOGS.length ? 40 - i * 6 : 400 - (i - BASE_CATALOGS.length) * 6)

export function buildCatalogRows() {
  return CATALOGS.map((spec, i) => ({
    id: CATALOG_IDS[i]!,
    workspaceId: DEMO_WORKSPACE_ID,
    vendorId: VENDOR_IDS[spec.vendorIndex]!,
    name: spec.name,
    sourceKind: spec.sourceKind,
    storageKey: null,
    seedUrl: spec.seedUrl,
    status: 'done' as const,
    queueJobId: null,
    enqueuedAt: daysAgo(catalogAge(i)),
    processingStartedAt: daysAgo(catalogAge(i)),
    rowCount: spec.items.length,
    lastError: null,
    pagesFound: spec.sourceKind === 'scrape' ? spec.items.length + 2 : null,
    pagesSucceeded: spec.sourceKind === 'scrape' ? spec.items.length : null,
    pagesFailed: spec.sourceKind === 'scrape' ? 2 : null,
    lastProgressAt: daysAgo(catalogAge(i) - 1),
    createdAt: daysAgo(catalogAge(i)),
    updatedAt: daysAgo(catalogAge(i) - 1),
  }))
}

/**
 * @param availableImages keys the seeder actually managed to upload. Anything
 * missing gets a null photoStorageKey rather than a key that would 404.
 */
export function buildCatalogItemRows(availableImages: Set<string> = new Set()) {
  return CATALOGS.flatMap((spec, catalogIndex) =>
    spec.items.map(([sku, description, image], n) => ({
      id: catalogItemId(catalogIndex, n + 1),
      workspaceId: DEMO_WORKSPACE_ID,
      catalogId: CATALOG_IDS[catalogIndex]!,
      lineNumber: n + 1,
      sku,
      description,
      photoStorageKey: availableImages.has(image) ? catalogPhotoKey(catalogIndex, n + 1, image) : null,
      sourcePageNumber: spec.sourceKind === 'scrape' ? n + 1 : null,
      rawRow: { sku, description },
      createdAt: daysAgo(catalogAge(catalogIndex)),
    })),
  )
}

/** Photo objects to upload: one per item that has an available image. */
export function buildCatalogPhotoUploads(availableImages: Set<string>): { key: string; image: string }[] {
  return CATALOGS.flatMap((spec, catalogIndex) =>
    spec.items
      .map(([, , image], n) => ({ image, n: n + 1 }))
      .filter(({ image }) => availableImages.has(image))
      .map(({ image, n }) => ({ key: catalogPhotoKey(catalogIndex, n, image), image })),
  )
}

type MatchSpec = [
  matchType: 'sourcing' | 'compliance',
  catalogIndex: number,
  itemNumber: number,
  vendorIndex: number,
  poIndex: number | null,
  poLine: number | null,
  invIndex: number | null,
  invLine: number | null,
  score: string,
  isMatch: boolean,
  reason: string,
]

export function buildCatalogMatchRows() {
  const specs: MatchSpec[] = [
    ['sourcing', 0, 1, 0, 0, 1, null, null, '0.94', true, 'Same 160x80 oak sit-stand desk; vendor SKU differs but the specification matches line for line.'],
    ['sourcing', 0, 3, 0, 0, 2, null, null, '0.88', true, 'Mesh-back ergonomic task chair matches the ordered chair specification.'],
    ['sourcing', 0, 5, 0, 0, 10, null, null, '0.81', true, 'Anti-fatigue standing mat available from this vendor at list price — relevant to the line missing from the invoice.'],
    ['sourcing', 1, 1, 1, 1, 1, null, null, '0.96', true, 'Identical 32GB / 1TB developer notebook configuration.'],
    ['sourcing', 1, 4, 1, 1, 4, null, null, '0.72', false, 'Monitor is 27-inch UHD in both cases but the catalog entry lacks the 90W USB-C power delivery the PO specifies.'],
    ['compliance', 1, 5, 1, null, null, 1, 3, '0.91', true, 'Invoiced headset matches the approved catalog entry, so the purchase is within policy.'],
    ['compliance', 2, 3, 2, null, null, 2, 5, '0.89', true, 'Invoiced coffee matches the approved consumables catalog entry.'],
    ['compliance', 3, 3, 2, null, null, 2, 5, '0.44', false, 'Green-line substitute is peat-free and recycled, but it is not the SKU the invoice bills for.'],
  ]

  return specs.map(
    (
      [matchType, catalogIndex, itemNumber, vendorIndex, poIndex, poLine, invIndex, invLine, score, isMatch, reason],
      i,
    ) => ({
      workspaceId: DEMO_WORKSPACE_ID,
      matchType,
      queryPoLineItemId: poIndex !== null && poLine !== null ? poLineId(poIndex, poLine) : null,
      queryInvoiceLineItemId: invIndex !== null && invLine !== null ? invoiceLineId(invIndex, invLine) : null,
      catalogItemId: catalogItemId(catalogIndex, itemNumber),
      vendorId: VENDOR_IDS[vendorIndex]!,
      score,
      isMatch,
      reason,
      status: 'open' as const,
      dismissedAt: null,
      dismissedBy: null,
      createdAt: daysAgo(18 - i),
    }),
  )
}
