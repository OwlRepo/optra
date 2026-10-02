# Fix B17 — a catalog with no items fails with a reason

Owner instruction 2026-10-03: "just finish the whole plan now" (the open decision; recommended default taken: follow B2).

- **Classification:** BUG_FIX · Standard (one Bull processor; no schema or route change) · Vendor Catalog · Jobs.
- **Contract areas:** none. A catalog with no items now ends `failed` with a `lastError` reason where it used to end `done` with 0 items.
- **Root cause:** after B4 dropped blank rows, nothing checked that any row was left, in either parse path. A file whose rows were all blank, whose headers matched no alias, or a PDF that yielded no items finished `done` with 0 items, and matching then quietly found nothing.
- **Fix:**
  - The spreadsheet path throws `CatalogParseInputError(NO_CATALOG_ITEMS_MESSAGE)` when no row describes an item. It does this before any photo fetch.
  - The PDF path throws `NO_PDF_CATALOG_ITEMS_MESSAGE` when no page yielded an item.
  - Both are permanent failures: no Bull retry, and `lastError` holds the reason.
- **Tests first (RED `8767a93`):** unit (4) and API e2e (1). No page changed, so no browser test.
