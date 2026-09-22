import type { ProcurementDocKind } from './procurement-parse.service'

/**
 * Exhaustiveness guard for `ProcurementDocKind`.
 *
 * Before S5 the procurement domain branched on document kind with ternaries and
 * `if (kind === 'purchase_order') … else …`, where the else-branch was always
 * "invoice". That shape compiles cleanly when a third kind is added and then
 * silently writes the new kind into the invoice table — the worst failure this
 * domain has available, because it is invisible until someone reads the data.
 *
 * Calling this in a `switch` default turns "I forgot a kind" into a compile
 * error: `kind` only narrows to `never` once every case is handled, so an
 * unhandled member makes the argument un-assignable.
 *
 *     switch (kind) {
 *       case 'purchase_order': return poThing
 *       case 'invoice':        return invoiceThing
 *       case 'goods_receipt':  return grnThing
 *       default:               return assertUnreachable(kind)
 *     }
 *
 * IMPORTANT: this only protects branches that were actually converted. A plain
 * if/else left behind keeps compiling after the union grows. The union must not
 * be widened until every branch site is a switch — see the S5 plan's ordering.
 *
 * The throw is a genuine runtime backstop, not decoration: a value can still
 * arrive from JSON (a Bull job payload) that TypeScript never checked.
 */
export function assertUnreachable(value: never): never {
  throw new Error(`Unhandled procurement document kind: ${String(value)}`)
}

/**
 * Human label for a kind, used in messages a user reads.
 *
 * Lives here rather than in the documents service because the parse processor
 * needs the same mapping and had grown its own inline copy — two places to
 * update, one of which would be forgotten when a kind was added.
 */
export function docLabel(kind: ProcurementDocKind): string {
  switch (kind) {
    case 'purchase_order':
      return 'Purchase order'
    case 'invoice':
      return 'Invoice'
    case 'goods_receipt':
      return 'Goods receipt'
    default:
      return assertUnreachable(kind)
  }
}
