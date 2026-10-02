# Fix B6 + B15 — a catalog search survives one bad model verdict

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed.

- Classification: BUG_FIX · Deep (LLM cost path, catalog match writes) · Vendor Catalog / Vision Matching. Contract areas: API — search and verify responses gain `unjudged` (additive); a search where nothing was compared answers `503` with a plain message (was `500`) or `402` when the budget is spent (unchanged). DB — none. Jobs — none. Web — `CatalogMatchSearchResult` type and one toast.
- Root cause (B6): `CatalogMatchService.search` judged candidates in `Promise.all`. One rejection (malformed JSON, refusal, timeout, budget spent part-way) rejected the whole search before the delete+insert transaction: the caller got `500 Internal server error`, and the verdicts that had already come back, and been metered, were discarded.
- Root cause (B15): `parseCompareJson` threw `new CatalogExtractionParseError()`, whose default text says "catalog extraction".
- Fix:
  - Each candidate's compare is caught; verdicts that came back are saved.
  - Failures are logged once per search (count and distinct reasons).
  - The scoped delete leaves out the failed candidates, so each keeps the open verdict an earlier search gave it.
  - The response carries `unjudged: <count>`.
  - With nothing compared: a budget error is rethrown (`402`); anything else becomes `ServiceUnavailableException(CATALOG_COMPARE_UNAVAILABLE_MESSAGE)`.
  - The page adds a neutral toast after the unchanged summary: "Some catalog items were not compared", reading "N catalog item(s) could not be compared. Search again to retry."
  - The compare parse error now reads "Model returned malformed catalog comparison JSON".
- Decision taken (reversible, recorded): partial results over all-or-nothing. A failed candidate is not retried inside the request (the chain already retries a timeout once); the user retries with the button the toast names.
- Not changed: there is no "warning" toast variant in `@repo/ui` (`default | success | error | loading`), so the skip toast is `default`. Adding a variant is a design-system change.
- Tests first (RED `3df4f72`):
  - api unit `partial search failures (B6)` (5);
  - `packages/ai` B15 (1);
  - API e2e (2);
  - web (3);
  - Playwright (1), via an `E2E-UNJUDGED` marker in the OpenAI stub.
  - The S3 malformed-verdict case's expected message changed on purpose.
