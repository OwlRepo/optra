import type { DiscrepancyFlagType } from '@/lib/api/procurement'

/**
 * The tone a finding renders in: its pill, its 3px row rule and its delta ink
 * (frame 2.7). Amber = act on it, red = money at risk, neutral = the documents
 * are not comparable yet.
 */
export type FlagTone = 'amber' | 'red' | 'neutral'

// Both maps are exhaustive `Record`s on purpose: under the web app's strict
// TypeScript they are the only place in the repo that fails to compile when the
// API learns a new flag type. An unlisted type would otherwise render a blank
// badge — no crash, no warning, just a discrepancy nobody can read. They live
// here rather than in the Discrepancies page because the review modal names
// the type in its header too (frame 2.9).
export const flagTypeTone: Record<DiscrepancyFlagType, FlagTone> = {
  quantity_mismatch: 'amber',
  price_mismatch: 'red',
  missing_on_invoice: 'neutral',
  missing_on_po: 'neutral',
  // Being billed for goods nobody kept is the one to act on first.
  invoice_exceeds_received: 'red',
  short_receipt: 'amber',
  // Neither of these is an accusation — they say the documents are not
  // comparable yet, which is a question for a human, not a dispute.
  uom_mismatch: 'neutral',
  currency_mismatch: 'neutral',
  // Ordering off contract is a finding about us, not about the vendor, so it
  // never renders as red however large the gap.
  contract_price_variance: 'amber',
  contract_price_unavailable: 'neutral',
}

export const flagTypeLabel: Record<DiscrepancyFlagType, string> = {
  quantity_mismatch: 'Quantity mismatch',
  price_mismatch: 'Price mismatch',
  missing_on_invoice: 'Missing on invoice',
  missing_on_po: 'Missing on PO',
  short_receipt: 'Short receipt',
  invoice_exceeds_received: 'Billed above received',
  uom_mismatch: 'Unit mismatch',
  currency_mismatch: 'Currency mismatch',
  contract_price_variance: 'Off contract price',
  contract_price_unavailable: 'Contract price unclear',
}

/**
 * A finding's delta as the frames write it (2.7, 2.9): the API sends invoice
 * minus PO with no sign on positives, so a positive gap gains a "+"; a
 * negative or zero gap is shown as sent.
 */
export function formatDelta(delta: string): string {
  const value = Number(delta)
  return Number.isFinite(value) && value > 0 && !delta.startsWith('+') ? `+${delta}` : delta
}
