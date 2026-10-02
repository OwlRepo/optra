# Fix B2 + B3 — unreadable spreadsheets fail with a reason; 2-column semicolon files parse

TL;DR: a CSV/XLSX purchase order, invoice or goods receipt whose rows all map to nothing
is marked "Ready" with 0 rows and only fails later at Compare. It will now fail at parse
with an actionable reason, exactly like an empty PDF already does. Separately, a
2-column semicolon file (`sku;qty`) is read with the wrong delimiter; the delimiter will be
guessed from non-blank lines only, so such files parse correctly.

## Task metadata
- Classification: BUG_FIX · Deep (Bull parse processor) · Procurement · Jobs / Client-Visible Error Text
- Contract areas: API — no shape change (an existing `lastError` gains one new authored message); DB — none; Jobs — new permanent-failure exit; Permissions — none
- Docs loaded: planning.md, plan-template.md
- RCA: approved 2026-10-02 (owner: "continue with the plan")
- Root cause: `procurement-parse.processor.ts` CSV/XLSX branch has no zero-row rule (`replaceLineItemsAndFinish` writes `done`, `rowCount: rows.length` at :307); the PDF branch has one (`ProcurementExtractionEmptyError`). B3: `Papa.parse(..., { skipEmptyLines: false })` lets the trailing empty record pull Papa's delimiter guess below its threshold for 2-column files.
- Detected running model: Opus 5.5 · Recommended: Opus 5.5 high for every phase
- Branch: `fix/no-ticket-zero-row-files` from `origin/enhancement/no-ticket-core-browser-flows` (stacked on S4; PR targets S4, retargeted to `main` after S1–S4 merge)

## Risk Matrix
| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| A real file that used to parse now fails | Low | upload shows Failed | guard fires only when ZERO rows map; every existing spec (S1 pins 25 real-world files) must stay green unchanged | revert the fix commit |
| Explicit delimiter changes parsing of an existing file | Low | wrong columns | delimiter guessed by Papa itself on the same text minus blank lines; probe: `,` `\t` `;` and comma-with-quoted-semicolons unchanged; full S1 + processor suites unchanged | revert |
| Auto-compare enqueue | None | — | the throw happens before `replaceLineItemsAndFinish` and the S8 hand-off, exactly like the PDF empty path | — |

## Backward Compatibility Matrix
| Changed file / symbol | Used by | Breaks? | Handling |
|---|---|---|---|
| `procurement-parse.processor.ts` `parseCsvRows`, `handleParse` CSV branch | Bull `procurement-parse` queue only | No | docs already `done` with 0 rows stay as they are; Compare's 400 guard (`comparison.service.ts:401`) remains the safety net for them |
| `lastError` text | procurement page `:428-429` renders it | No | same field, one new authored string |

## Phase 1 — RED (Opus 5.5 high)
Tests below, then `TDD_RED_BASE=origin/enhancement/no-ticket-core-browser-flows bun run tdd:red`; commit `test(procurement): unreadable spreadsheets must fail at parse with a reason`.

**Unit** `apps/api/src/procurement/procurement-parse.processor.spec.ts` — new `describe('files with no readable line items (B2/B3)')` inside `describe('ProcurementParseProcessor')`, using `seedWorkspace`, `seedPo`, `seedPoBuffer`, `job`:
- error: a header-only CSV fails at once with the no-line-items message and stores no lines
- error: an empty file fails with the no-line-items message
- error: a UTF-16 CSV fails with the no-line-items message
- error: a CSV whose headers match no known column fails with the no-line-items message (`Foo,Bar`)
- error: an XLSX with a title row above the header fails with the no-line-items message
- error: the failure is permanent — `handleParse` resolves on attempt 1 of 3 (no Bull retry) and `lastError` is the message
- edge: a two-column semicolon goods receipt ending in a newline parses both lines (B3)
- edge: a two-column semicolon file with CRLF line endings parses (B3)
- regression: a blank line inside a semicolon file still records the true sourceRow
- regression: a comma file whose descriptions contain semicolons still splits on commas
Each `error:` asserts `status 'failed'`, `lastError` equal to the message, zero rows in the line table.

**API e2e** `apps/api/test/procurement.e2e-spec.ts` — new `describe('unreadable files (B2/B3)')`:
- error: a header-only purchase order upload answers 201 and the document ends failed with the no-line-items reason, listed with that lastError
- edge: a two-column semicolon goods receipt uploaded over HTTP parses both lines (B3)

**Browser** `apps/e2e/tests/procurement-core.spec.ts` — new `describe('procurement core: unreadable files')`, workspace B; new fixture `apps/e2e/fixtures/po-headers-only.csv` = `sku,description,qty,unit price\n`:
- error: a purchase order with headers but no lines shows Failed with the reason in its row

## Phase 2 — fix (Opus 5.5 high)
`apps/api/src/procurement/procurement-parse.processor.ts`:

1. Old: `const INSERT_CHUNK_ROWS = 1_000`
   New:
   ```ts
   const INSERT_CHUNK_ROWS = 1_000

   // Records Papa samples to guess the delimiter, blank lines excluded.
   const DELIMITER_SAMPLE_ROWS = 50

   // Authored and client-safe: shown as lastError on the document row.
   export const NO_LINE_ITEMS_MESSAGE =
     'No line items were found in this file. Its first row must hold column headers such as SKU, Description, Qty and Unit price, and it must be saved as a UTF-8 CSV or an XLSX workbook.'
   ```
2. Old: `    const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: false })`
   New:
   ```ts
       // Papa guesses the delimiter from every record, blank ones included, so a
       // trailing newline in a two-column file (`sku;qty`) pulls the average field
       // count under its threshold and it falls back to a comma. Guess on the
       // non-blank records only, then parse every record with that delimiter so
       // sourceRow still counts blank lines.
       const { delimiter } = Papa.parse<Record<string, string>>(csvContent, {
         header: true,
         skipEmptyLines: 'greedy',
         preview: DELIMITER_SAMPLE_ROWS,
       }).meta
       const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: false, delimiter })
   ```
3. Old:
   ```ts
           rows = this.parseCsvRows(csvContent, converted?.sheetName ?? null)
           sourceKind = isXlsx ? 'xlsx' : 'csv'
   ```
   New:
   ```ts
           rows = this.parseCsvRows(csvContent, converted?.sheetName ?? null)
           // Rows that all map to nothing mean the headers were not recognised
           // (wrong row, unknown names, an encoding we do not read). Marking that
           // done would show "Ready" and fail only at compare, so it fails here,
           // the way an empty PDF does.
           if (rows.length === 0) {
             throw new ProcurementParseInputError(NO_LINE_ITEMS_MESSAGE)
           }
           sourceKind = isXlsx ? 'xlsx' : 'csv'
   ```
Done: all new tests green; every existing procurement unit, API e2e and Playwright spec green and unedited.

## Validation
`cd apps/api && bun run test` (full) ×1 and the processor spec ×3; API e2e full on fresh `optra_e2e`; `bun run e2e` full Playwright; `bun run type-check`; `bun run lint`; `sh scripts/check-test-layers.sh origin/enhancement/no-ticket-core-browser-flows`; graphify closeout.

## Docs
`docs/ai/risk-register.md` "Launch-Hardening Bugs" row: mark B2 + B3 fixed; `docs/ai/testing-strategy.md` note; `learnings.md` entry; `docs/plans/fix-zero-row-files.md` (this plan).
Optimisation / cache scan: not applicable. LLM/DB cost: none (one extra Papa pass over ≤ 50 records).
