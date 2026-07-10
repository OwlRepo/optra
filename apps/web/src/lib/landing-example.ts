// Shared illustrative example for the landing page hero vignette and pillar
// showcase, so the "PO #4417" story stays identical between both usages
// instead of drifting into two hand-copied variants.
//
// Every numeric value here is a PLACEHOLDER METRIC for the static marketing
// example — not a measured product statistic. Confirm/replace before treating
// any of these as a real claim.
export const HERO_MATCH_EXAMPLE = {
  poNumber: '4417',
  lineNumber: 3,
  quantity: 200,
  itemDescription: '3/8in steel hex bolts',
  vendorName: 'Ironclad Supply',
  // Illustrative catalog photo — Unsplash, "Grey stainless steel bolt and
  // screw lot" by Marcel Strauß (free for commercial use, hotlinking
  // permitted per Unsplash's guidelines).
  photoUrl: 'https://images.unsplash.com/photo-1564226591723-659ff3852b2a?q=80&w=800&auto=format&fit=crop',
  // PLACEHOLDER METRIC
  poUnitPrice: 0.42,
  // PLACEHOLDER METRIC
  catalogUnitPrice: 0.51,
  // PLACEHOLDER METRIC — illustrative percent-above-PO-price figure quoted in copy
  priceDeltaPercent: 18,
  // PLACEHOLDER METRIC — 0-1 confidence score backing the ConfidenceMeter visual
  matchConfidence: 0.92,
  matchConfidenceLabel: 'High',
  // PLACEHOLDER METRIC
  catalogSourcesChecked: 3,
} as const
