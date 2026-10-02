# Fix B4: blank catalog rows are not items

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed.

- **Classification:** BUG_FIX · Standard (one Bull processor's row filter; no schema or route change) · Vendor Catalog.
- **Contract areas:**
  - API: `rowCount` and items no longer include blank rows.
  - DB: none.
  - Jobs: the parse writes fewer rows.
- **Root cause:** `CatalogParseProcessor.parseSpreadsheet` parsed with `skipEmptyLines: true`, which keeps a `,,` row (it has fields, all empty). It also mapped rows whose only values sit in unmapped columns. Both produced `{ sku: null, description: null }` items. Nothing filtered them before `replaceItems`, so they showed up in the catalog list and its counts, and a stray `photo_url` on such a row was even fetched. The PDF path likewise kept a model reading with neither field.
- **Fix:** `describesAnItem()` keeps a row only if it has a SKU or a description, which is what catalog matching searches on.
  - Spreadsheet path: applied right after mapping, before photo fetching.
  - PDF path: applied per page before numbering.
  - Kept rows are numbered 1..n.
- **Not changed:** a catalog whose rows are all blank still finishes `done` with 0 items. Procurement fails such a file since B2; making catalogs do the same is an owner decision.
- **Tests first (RED `3f1d3ee`):**
  - Unit `blank rows (B4)` (4).
  - API e2e (1).
  - No page change, so no browser test.
