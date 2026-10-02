# Fix B12 — catalog matches opened from a flag list what the search found

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed.

- Classification: BUG_FIX · Standard (web page only; no API, schema, job or permission change) · Vendor Catalog / Vision Matching · Catalog Match Integrity. Contract areas: API — none; DB — none.
- Root cause: `apps/web/app/workspaces/[id]/catalog-matches/page.tsx` searched by one line (`matchQuery`: the PO line when present, else the invoice line) but listed by both (`lineScope` carried `poLineItemId` and `invoiceLineItemId`). `CatalogMatchService.listMatches` ANDs the two filters, and a PO-line search stores `queryInvoiceLineItemId = null`, so the list was empty right after "1 match found". Every flag with both line ids (price, quantity, receiving) hit it through its "Find catalog matches" link (`discrepancies/page.tsx` `catalogMatchesHref`).
- Fix: `lineScope` mirrors `matchQuery` — `{ poLineItemId }` when present, else `{ invoiceLineItemId }`, else `{}` (sidebar entry keeps the workspace-wide list).
- Rejected alternative: OR the filters in the API. That changes a shared endpoint's contract for a page-local mistake.
- Tests first: web unit `catalog-matches/page.spec.ts` `describe('line scope (B12)')` (`regression:` both ids → list by PO line only; `edge:` invoice id only → list by invoice line); Playwright `catalog-core.spec.ts` follows the real flag link and asserts the found match is listed. API e2e not touched: no API change.
