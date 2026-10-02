# Fix B10 + B11 — flag reasons name the line and the units as written

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed. B11 is taken with B10, ahead of B14 and B4, because both live in `ComparisonService.buildReason`.

- **Classification:** BUG_FIX · Standard (one private method's text; no schema, queue or route shape change) · Procurement match engine.
- **Contract areas:**
  - API: the `reason` string on new flags.
  - DB: none.
  - Web: none. The page prints `reason` as given.
- **Root cause, B10:** `buildReason` used `poLine?.sku ?? invoiceLine?.sku ?? '(unknown)'`. A line matched by description (no SKU) always read "Item (unknown) …", and with two such lines the reviewer could not tell them apart.
- **Root cause, B11:** the UOM reason printed `row.po_uom` / `row.inv_uom` / `row.grn_uom`. Those are the engine's normalized units (`normalizeUom`: trimmed, lower-cased), while the flag's `poValue` / `invoiceValue` / `receivedValue` keep the document text.
- **Fix:**
  - `lineName()` returns the SKU, else the quoted, trimmed description. Past 80 characters the description is shortened to 79 characters plus `…`.
  - The UOM reason prints each side's stated unit from its representative line, which is the one the flag values use. It falls back to the normalized unit only if that line is missing.
  - `buildReason` now receives the goods-receipt line for that.
- **Not changed:** flags already written keep their reasons, because runs are append-only. A re-compare writes the new text.
- **Tests first (RED `704fb64`):**
  - Unit `line names in reasons (B10, B11)` (5): `edge:` description-keyed quantity, `edge:` long description, `regression:` freight, `regression:` units as written, `happy:` SKU line.
  - API e2e (1).
  - No page changed, so no browser test.
