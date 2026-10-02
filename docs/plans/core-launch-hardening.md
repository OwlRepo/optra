# Core launch hardening — real-world edge-case tests (procurement + catalogs)

## Context

Optra launches commercially soon. The owner asked for core-focused tests on every layer
(unit, API e2e, browser e2e), ordered error → edge → happy, including real-world scenarios
researched on the internet, so problems are mitigated before many users arrive. Scope
(owner, 2026-10-02): **procurement match engine** and **vendor catalogs + matching**.

Plain English: today's tests mostly prove the clean-file path. Real buyers upload
spreadsheets saved by Excel on Windows, split deliveries across receipts, add freight
lines, send credit notes. This plan (a) pins every behaviour we rely on with tests, (b)
records every place Optra differs from mainstream accounts-payable tools as an owner
decision, and (c) lists the bugs this investigation PROVED, each with its evidence, to be
fixed in their own slices. Think of a crash-test programme: crash the car from every
angle real roads offer, record what bends, then fix what broke.

Owner decisions (2026-10-02): bugs → follow-up fix slices (RCA → approval → RED + fix);
policy gaps → pin today's behaviour + decision list; delivery → stacked slices per domain.
Owner instruction (2026-10-02): **no guesswork** — every fact below is verified by a cited
file:line or an experiment whose output is quoted; nothing is a hypothesis.

## Task Classification

```
Task Classification:
- Intent: ENHANCEMENT (test hardening) + BUG_FIX follow-ups (B1–B15, RCA-gated)
- Workflow: Feature Plan (test slices S1–S4) → Bug RCA per B-item
- Task Size: Deep (Bull processors, upload paths, tenant isolation, LLM budget paths)
- Domain: Procurement (PO ↔ Invoice ↔ GRN); Vendor Catalog / Vision Matching
- Risk: Jobs, Upload Parser Dependencies, Cross-Workspace Ids In Request Bodies,
  Catalog Match Integrity, Column-Alias Mapping, Client-Visible Error Text
- Contract Areas: API — No contract impact; Database — No contract impact;
  Permissions — asserted, not changed; External integrations — OpenAI test stub gains
  one route (harness only); Jobs — asserted, not changed
- Next Action: owner approval of discovery + this plan → S1
```

## Task metadata

- Docs loaded: planning.md, plan-template.md (also execution.md, handoff.md,
  testing-strategy.md, task-router.md, risk-register.md)
- Detected running model: Opus 5.5 (`claude-opus-5-5`)
- Recommended model: Opus 5.5, high reasoning, every phase → one (tier, reasoning) pair,
  so no switch stops. Fallback: Sonnet 5.5, high. Minimum capability: reads DuckDB SQL
  and Bull lifecycle precisely; smaller tiers drift on exact expected values.
- Claims reversed while investigating (each disproved by the evidence named):
  1. "Test-only PRs fail `tdd:gate` because they pass on base" — false. The merge-base
     RED run fires only when guarded source changes (`scripts/ci/tdd-gate.mjs:145,159-180`;
     guarded globs `scripts/ci/tdd-lib.mjs:15-27`). Test-only PRs are checked for titles.
  2. "CSV formula injection on export" — ruled out: no route builds a CSV from stored
     values; `Papa.unparse` call sites are DuckDB input (`comparison.service.ts`) and
     XLSX→CSV conversion in the parse processors; downloads stream the original bytes.
  3. "Path traversal / slashes in filenames reach the S3 key" — ruled out: busboy 1.6.0
     (multer 2.0.2) strips paths. Probe: `"../../etc/x.csv" -> "x.csv"`, `"a/b\\c.csv" -> "c.csv"`.
  4. "Long filenames overflow the name column" — ruled out for browser uploads: `name`
     is `varchar(500)` on purchase_orders/invoices/goods_receipts/catalogs
     (`packages/db/src/schema/purchaseOrders.ts:24` and siblings); OS filenames are
     ≤ 255 bytes, which decode to ≤ 255 latin1 characters.
  5. "Two simultaneous dismisses append two decisions" — ruled out: `dismissFlag` does
     `UPDATE … WHERE status='open' RETURNING` inside the transaction and inserts the
     decision only when a row came back (`comparison.service.ts:825-866`); the second
     transaction re-evaluates `status` after the row lock and gets no row.
  6. "A plain-text file named `.xlsx` fails as corrupt" — false: `XLSX.read` parses the
     text as a one-sheet workbook (probe output `{"csv":"sku,qty\r\nA1,10","sheetName":"Sheet1"}`).
     Pinned in S1 instead; a truncated real zip is what fails (`"Unsupported ZIP file"`).
  7. "4-column semicolon CSVs are misdetected" — false; only 2-column ones are (B3).
- Branches (stacked): `enhancement/no-ticket-core-parse-edges` (base `origin/main`) →
  `enhancement/no-ticket-core-compare-edges` → `enhancement/no-ticket-core-catalog-edges`
  → `enhancement/no-ticket-core-browser-flows`.
- Release path: one PR per slice, child PR targets its parent, retargeted to `main` after
  the parent merges, "Create a merge commit" (`docs/ai/handoff.md` "Stacked slices").
  **No PR is created or merged without the owner's explicit instruction** (handoff
  Completion Gate).
- Required skills: `/review` per slice; `/qa-only` after S4; `/investigate` per B-item;
  graphify closeout per slice.
- Execution preflight (per slice): `git fetch origin`;
  `scripts/new-task-worktree.sh enhancement <short-name> <base-ref>`; `nvm use` (Node 22);
  `bun install --frozen-lockfile --force` (see "Environment blockers"); confirm
  `node_modules/.bin/jest` and `node_modules/.bin/playwright` exist; `apps/api` and `apps/web` build cleanly (both
failed at 98% disk / 12 GiB free);
  copy root `.env` from the primary checkout;
  `bunx turbo run build --filter=@repo/db --filter=@repo/ai`; reuse the primary
  checkout's compose stack (`docker compose up -d --wait postgres redis seaweedfs`).
- Plan ack after approval: `.claude/.plan-ack` =
  `{"size":"deep","plan":"approved","matrices":"present"}`.

## Mandatory execution rules (strict — every slice, every commit)

The executor follows these exactly; deviation = stop and report.
1. **Canonical Task Flow** (`AGENTS.md`): nodes in order; `B` classification already done
   above; `S` → read `docs/ai/execution.md` before the worktree; `W` → read
   `docs/ai/handoff.md` before declaring done.
2. **Worktree isolation** (`execution.md` §Worktree): one branch + worktree per slice,
   never the primary checkout, never commit to `main`, stacked base = parent branch.
3. **Single-task rule**: implement only the current slice. If repository evidence
   contradicts a literal block below (a value, a title, an anchor), STOP and report the
   contradiction, the evidence and the correction. Never edit an assertion to make it
   pass; never weaken, skip or delete a test.
4. **Blast radius**: touch only the files listed for the slice. An unlisted file → stop,
   update both matrices, get re-approval.
5. **Test standards** (`testing-strategy.md` "Strict TDD"): titles are plain string
   literals starting with `error:` / `edge:` / `regression:` / `happy:`, declared in that
   order per new `describe`; a PR adding `happy:` also adds `error:` or `edge:`. Never mock
   `duckdb` in comparison specs. Never spend `/auth/register` in new API e2e fixtures (use
   seed helpers). Assert only on rows the spec owns (parallel-worker rule).
6. **No guarded source** in S1–S4. Proof per slice: `git diff --stat <base>` lists only
   spec files, fixtures, `apps/e2e/**`, docs. (So `bun run tdd:red` is not required for
   S1–S4; it IS required for every B-fix slice before its source edit.)
7. **Commits**: `test(<scope>): …` for tests, `docs(ai): …` for docs; focused; **no
   `Co-Authored-By` trailer** (`execution.md` Implementation rule 7 — repo rule overrides
   the default attribution).
8. **Flake gate**: each new spec file green 3 consecutive runs locally before push.
9. **Validation** (QA mode, `execution.md`): report every command and its result; never
   claim a check that did not run.
10. **Docs sync** same change; **graphify closeout** after the last indexed edit
    (`planning.md` "Closeout refresh"), coverage pass check reported.
11. **Completion Gate + exact final report/status block** from `docs/ai/handoff.md`.
12. **Bugs found while testing** (`execution.md`): not pinned as correct. Any new bug
    found during execution is added to the B-list with its evidence and the slice stops
    for the owner; B-items are fixed in this same batch, in their own slices (below).

## Discovery findings (verified)

Engine facts used by the tests:
- CSV: `Papa.parse(text,{header:true,skipEmptyLines:false})`, delimiter auto-guessed, file
  read as UTF-8 only (`procurement-parse.processor.ts:181,251`); only `Quotes` errors fail a
  file (`:256-261`); `sourceRow = index + 2` (`:270`); empty mapped rows filtered (`:275`);
  `lineNumber = index + 1` (`:290`).
- XLSX: first sheet only; `sheet_to_json(sheet,{defval:''})`; re-serialized via
  `Papa.unparse` (`:83-94`). A numeric `5.00` cell is stored as `"5"` (probe).
- Numbers: `validateLineItem` nulls anything failing `DECIMAL_PATTERN`
  (`column-mapping.ts:97,99-101,121-137`); `mapRowToLineItem` keeps raw text.
- Compare: DuckDB `COMPARISON_SQL` (`comparison.service.ts:130-205`), key = trimmed
  lowercase SKU else description (`matchKey` `:313-319`), exact compare, no tolerance.
- Write routes are `@Roles('owner','admin')` (`procurement.controller.ts:108-274`,
  `catalog.controller.ts:94-246`).
- Coverage today: strong procurement unit + API e2e; Playwright lacks three-way,
  dismiss/decide, member read-only discrepancies, XLSX, catalog CSV and catalog matching;
  no XLSX fixture; OpenAI stub has no catalog-compare route (`apps/e2e/stubs/openai-stub.ts:62-76`).

### Confirmed bugs (B-list) — fixed in follow-up slices, never pinned as correct

| # | Bug (fact) | Evidence | User impact |
|---|---|---|---|
| B1 | XLSX rows after a blank row get the wrong `sourceRow`, so a flag cites the wrong spreadsheet row | Probe: sheet rows `[sku,qty],[A1,1],[],[A3,3]` → `sheet_to_json` = `[{"sku":"A1"},{"sku":"A3"}]` (blank skipped) → A3 gets `index+2 = 3`, real row 4 (`processor.ts:92,270`) | Reviewer opens the file at the wrong row; citations are the product's trust promise |
| B2 | A spreadsheet with no recognized headers finishes `done` with 0 rows and no message | `replaceLineItemsAndFinish` writes `status:'done', rowCount: rows.length` with no zero guard (`processor.ts:307-318`); failure appears only at compare: 400 "Both documents must have parsed line items to compare" (`comparison.service.ts:401`). Probe: UTF-16LE file → headers `["��s\u0000k\u0000u\u0000",…]`, no alias matches | Excel "Unicode Text" exports, header-on-row-2 files, empty files look successful |
| B3 | A 2-column semicolon CSV (e.g. `sku;qty`) is read with `,`, so it lands in B2 | Probes: `"sku;qty\nA1;5\nB2;7\nC3;9\n" -> ","`, `"sku;qty\r\nA1;5\r\n" -> ","`; 3+ columns detect `;`. Papa needs avg fields > 1.99 and the trailing empty record counts because `skipEmptyLines:false` (`papaparse.js:1344-1347`) | EU-locale 2-column goods receipts silently empty |
| B4 | Catalog `,,` rows are inserted as blank catalog items | Probe: `Papa.parse("sku,description\nA,x\n,,\n\nB,y\n",{header:true,skipEmptyLines:true})` keeps `{"sku":"","description":""}`; `findValue` returns null for blanks (`catalog-parse.processor.ts:46-56`); no empty filter before `replaceItems` (`:240-258,266-282`) | Junk items in the catalog and its counts |
| B5 | A catalog SKU over 200 characters fails the whole catalog after 3 attempts, with a raw database message as `lastError` | `catalog_items.sku varchar(200)` (`catalogItems.ts:19`); catalog path has no `validateLineItem`; error not in the permanent set (`catalog-parse.processor.ts:146-149`) → retried, final `markFailed(id, message)` with the pg message (drizzle-orm 0.30.10 does not wrap errors) | Whole catalog rejected for one cell; raw DB text shown |
| B6 | One failing model call rejects the whole catalog search; calls that succeeded are still charged | `Promise.all` over candidates (`catalog-match.service.ts:61-80`); each call metered in `CatalogExtractionService` via `usage.metered`; prior open matches survive because the delete+insert transaction is never reached (`:111-130`) | Search fails on one bad candidate; tokens spent for nothing |
| B7 | A catalog whose photo hosts hang can outlive the 5-minute job: Bull times the attempt out but cannot stop it, retries start alongside it, and `replaceItems` is not transactional | Photos fetched sequentially, 20 s each (`catalog-parse.processor.ts:244-248`, `catalog-image.service.ts:7,28`); `PARSE_JOB_TIMEOUT_MS = 5 * 60_000`, `attempts: 3` (`catalog-parse.service.ts:9,77-84`); Bull 4.16.5 `pTimeout(jobPromise, timeoutMs)` only races the promise (`bull/lib/queue.js:1212-1213`); the processor's catch never sees that timeout; `replaceItems` = delete then insert outside a transaction (`:266-282`). 16 hanging photos × 20 s = 320 s > 300 s | Catalog stuck or duplicated items when two attempts interleave |
| B8 | Non-ASCII filenames are stored and shown as mojibake | Probe (busboy 1.6.0 default `defParamCharset` latin1): `"façture-日本.csv" -> "faÃ§ture-æ¥æ¬.csv"`; `name: file.originalname` (`procurement-documents.service.ts:111`), same in catalogs | Filipino/EU/Asian vendor filenames unreadable in the list and downloads |
| B9 | A sub-cent price mismatch is flagged `price_mismatch` but its stored `delta` is `'0'` | DuckDB probe of `COMPARISON_SQL`: PO `0.3333` vs invoice `0.33` → `price_mismatch`, delta `'0'`; `diff()` rounds to cents (`comparison.service.ts:1381-1383`: `Math.round(-0.33)` = `-0`, `String(-0)` = `'0'`) | Flag says "mismatch", its number says "no difference" |
| B10 | Flags on description-keyed lines (no SKU) read "Item (unknown) …", so a reviewer cannot tell which line | Probe: freight and `Bolt M8x20`/`M8x25` flags → reason `'Item (unknown) appears on the invoice but not on the purchase order'`; `buildReason` uses only `sku` (`:1087,:1390,:1398`) | Small vendors without SKUs get unreadable flags |
| B11 | The UOM-mismatch reason prints normalized units (`PO=bx Invoice=ea`) while the flag values keep `BX`/`EA` | Probe confirmed; reason built from `normalizeUom` (`:1423-1427`) vs values (`:1108,:1132`) | Cosmetic inconsistency in the evidence text |
| B12 | "Find catalog matches" from a flag shows an empty list right after "1 match found." | The link carries both `poLineItemId` and `invoiceLineItemId` (`apps/web/app/workspaces/[id]/discrepancies/page.tsx:107-114`); the catalog-matches page sends both; `listMatches` filters on both together (`catalog-match.service.ts:151-156`); a PO-line search stores `queryInvoiceLineItemId = null` (`:120-121`) | The core "check this line against the catalog" journey looks broken |
| B13 | Malformed `:vendorId` / `:catalogId` on 10 catalog routes answers 500 | No `ParseUUIDPipe` on `:vendorId` at `catalog.controller.ts:109,119,127,139,148,158,172,183,190` (+ `:catalogId` :192); each reaches a uuid query (`catalog-documents.service.ts:165-168,178-181`, scrape/vendor-history/price-terms services) → Postgres `22P02`, not an `HttpException` → 500; the controller's own comment at :230-231 documents this failure mode for the route that does have the pipe | 500s on bad links; noisy error logs |
| B14 | A non-member opening another workspace's procurement page sees an error toast, then "No purchase orders yet" and the Compare card | Page `Promise.all` rejects and falls through to the empty state (procurement `page.tsx` :194 toast); no forbidden/not-found state | Misleading screen on a shared or stale link |
| B15 | A catalog-compare failure reports "Model returned malformed catalog extraction JSON" — wrong noun | `CatalogExtractionParseError` default message (`packages/ai/src/chains/catalog-match.ts:40`) reused by the compare path (`:287`) | Misleading error text (fold into B6's fix) |

### Policy decisions pinned (owner decides; tests lock today's behaviour)

D1 thousands separators, currency symbols/codes, parentheses negatives, percent and
decimal commas → null · D2 exact compare, no price/quantity tolerance · D3 UOM compared,
never converted · D4 each invoice compared alone (no cumulative over-billing) · D5
negative (credit) lines compared as quantities · D6 lines with no PO counterpart (freight)
→ missing-on-PO · D7 description fallback exact, no fuzzy · D8 XLSX first sheet only ·
D9 SKU text verbatim (`00501` ≠ `501`, `1.23457E+15` kept) · D10 Windows-1252 bytes decode
to U+FFFD, row kept · D11 duplicate invoice uploads not detected · D12 no magic-byte check;
a text file named `.xlsx` parses as a workbook · D13 `sourceRow` counts records, so a
quoted multi-line cell shifts later rows' physical line numbers (owner may class as bug) ·
D14 over-delivery (accepted > ordered, billed = ordered) raises no flag (CASE has no such
branch, `comparison.service.ts:192-196`) · D15 a re-compare creates a new run whose flags
start `open`; a decision stays on the run it was made on and is not carried forward
(`toFlagValues` sets no status; "No delete" `:548`; default list = current run `:776`).

Latent (not a launch bug; condition stated): `MAX_UPLOAD_BYTES` is computed at import of
`procurement.controller.ts:40`, before `ConfigModule.forRoot()` (`app.module.ts:29`) loads
`.env`, while the 413 message reads `maxUploadMb()` later. They disagree only if
`MAX_UPLOAD_MB` is set solely in a `.env` file loaded by ConfigModule (not in the process
environment). Production is not affected: the API container gets `.env` through compose
`env_file` (`docker-compose.prod.yml:55-56`), i.e. in the process environment before
import, and `.dockerignore:15` keeps `.env*` out of the image, so ConfigModule loads no
file there. CI and local both resolve 25.

## Flowchart

```mermaid
flowchart LR
  A[Clean-path tests only] --> B[Research 52 real-world cases]
  B --> C{Verified behaviour today}
  C -->|correct| D[Pin with tests S1-S4]
  C -->|policy gap| E[Pin + owner decisions D1-D15]
  C -->|proven bug| F[Fix slices B1-B15, RCA first]
  D --> G[Launch with proven core]
  E --> G
  F --> G
```

## Layer 1 — human summary

Four test-only PRs, then the bug-fix slices:
- **S1 Files** — the parser meets real spreadsheets.
- **S2 Matching** — the 2/3-way engine meets real AP situations + HTTP error sweep.
- **S3 Catalogs** — catalog parsing, photo safety and LLM matching under failure.
- **S4 Browser** — what a buyer actually clicks, end to end.
- **B-slices** — one per proven bug; each starts with `/investigate` + owner approval.

**Risk Matrix**

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| New test flaky (Bull polling, parallel Jest workers) | Medium | CI red blocks deploy | existing pollers; assert only on own rows; rule 8 (3× green) | revert the slice PR |
| A literal expected value disagrees at run time | Low | slice stalls | rule 3: stop + report; values proven by probes/existing assertions | none needed |
| OpenAI stub branch alters existing specs | Low | catalog PDF spec breaks | branch keyed on the compare prompt only; `catalog.spec.ts` re-run | revert stub hunk |
| Fixtures exhaust auth rate limits | Medium | 429 cascade | seed helpers only; no `/auth/register` in new cases | n/a |
| CI time grows | High | slower deploys | unit-heavy split; ≤ 5 new Playwright tests per file | trim |

**Backward Compatibility Matrix**

| Changed File / Symbol | Used By (outside this feature) | Breaks? | Handling |
|---|---|---|---|
| `apps/e2e/stubs/openai-stub.ts` `chatCompletion` | every Playwright spec (catalog PDF extraction) | No | additive branch on a prompt the extraction path never sends |
| new `apps/e2e/fixtures/*` | none | No | new files |
| appended `describe` blocks in existing specs | none | No | append-only; existing titles untouched |

Usage search recorded: `grep -rn "chatCompletion\|CATALOG_STUB_ITEMS" apps/e2e` →
only `stubs/openai-stub.ts`; `grep -rn "fixture(" apps/e2e/tests` for fixture consumers.

## Layer 2 — execution spec

### Slice S1 — parser meets real files (`enhancement/no-ticket-core-parse-edges`, Opus 5.5 high)

Files (complete list): `apps/api/src/procurement/column-mapping.spec.ts`,
`apps/api/src/procurement/procurement-parse.processor.spec.ts`, `docs/ai/testing-strategy.md`,
`docs/ai/risk-register.md`, `learnings.md`, `graphify-out/*` (refresh output).
Test layers: unit only — no controller, page or BFF touched, so `check-test-layers.sh`
requires nothing else.

Dropped candidates (already covered, by exact existing title): `1,234.56` → "nulls numeric
cells Postgres numeric would reject or misread"; `-2` → "keeps plain decimal numbers,
including signs and exponents"; `' 7 '` → "trims whitespace from matched values".

**S1.1** `apps/api/src/procurement/column-mapping.spec.ts` — anchor (end of file, verbatim):

```ts
  // The purchase-order and invoice paths must be untouched by all of the above.
  it('leaves the receipt fields null for an ordinary purchase order row', () => {
    const item = validateLineItem(mapRowToLineItem({ SKU: 'A1', Description: 'Widget', Qty: '10', Price: '5.00' }))

    expect(item.quantity).toBe('10')
    expect(item.quantityReceived).toBeNull()
    expect(item.quantityAccepted).toBeNull()
    expect(item.quantityRejected).toBeNull()
  })
})
```

Append after that final `})` (no import change; line 1 already imports both functions):

```ts

// Launch hardening (S1). Cells and headers the way vendor exports actually
// write them. Mapping keeps the text as-is; validateLineItem decides whether
// Postgres numeric can hold it, so the pair is exercised together exactly as
// procurement-parse.processor.ts does. Locale- and currency-formatted numbers
// become null rather than a guessed value (DECIMAL_PATTERN).
describe('real-world cells (launch hardening)', () => {
  it('edge: nulls a European-format price that uses a dot for thousands and a comma for decimals', () => {
    expect(validateLineItem(mapRowToLineItem({ sku: 'A1', 'unit price': '1.234,56' })).unitPrice).toBeNull()
  })

  it('edge: nulls prices that carry a currency symbol or currency code', () => {
    for (const price of ['$12.50', '€12,50', 'PHP 1,200.00']) {
      expect(validateLineItem(mapRowToLineItem({ sku: 'A1', 'unit price': price })).unitPrice).toBeNull()
    }
  })

  it('edge: nulls an accounting-style negative written in parentheses', () => {
    expect(validateLineItem(mapRowToLineItem({ sku: 'A1', 'unit price': '(5.00)' })).unitPrice).toBeNull()
  })

  it('edge: nulls a quantity written as a percentage', () => {
    expect(validateLineItem(mapRowToLineItem({ sku: 'A1', qty: '12%' })).quantity).toBeNull()
  })

  it('edge: maps a header that still carries a UTF-8 byte order mark', () => {
    expect(mapRowToLineItem({ '﻿sku': 'A1' }).sku).toBe('A1')
  })

  it('edge: maps a header padded with spaces', () => {
    expect(mapRowToLineItem({ sku: 'A1', ' Unit Price ': '5.50' }).unitPrice).toBe('5.50')
  })

  it('edge: does not read an Ext Price header as the unit price or the line total', () => {
    const item = mapRowToLineItem({ sku: 'A1', 'Ext Price': '55.00' })

    expect(item.unitPrice).toBeNull()
    expect(item.lineTotal).toBeNull()
  })

  it('edge: keeps the leading zeros of a SKU', () => {
    expect(validateLineItem(mapRowToLineItem({ sku: '00501' })).sku).toBe('00501')
  })

  it('edge: keeps a SKU a spreadsheet rewrote in scientific notation verbatim', () => {
    expect(validateLineItem(mapRowToLineItem({ sku: '1.23457E+15' })).sku).toBe('1.23457E+15')
  })

  it('happy: maps and validates every field of a typical vendor row', () => {
    const row = {
      SKU: 'ABC-123',
      Description: 'Widget, blue',
      Qty: '10',
      'Unit Price': '5.50',
      Total: '55.00',
      UOM: 'box',
    }

    expect(validateLineItem(mapRowToLineItem(row))).toEqual({
      sku: 'ABC-123',
      description: 'Widget, blue',
      quantity: '10',
      unitPrice: '5.50',
      lineTotal: '55.00',
      uom: 'box',
      quantityReceived: null,
      quantityAccepted: null,
      quantityRejected: null,
    })
  })
})
```

Evidence: `DECIMAL_PATTERN` `column-mapping.ts:97,99-101,125-126`; `normalizeHeader` trim
`:65` (probe `JSON.stringify('﻿sku'.trim())` → `"sku"`); aliases `:23-62`; SKU only
length-checked `:123`. Probe outputs via the real module: `price 1.234,56 null`,
`price $12.50 null`, `price €12,50 null`, `price PHP 1,200.00 null`, `price (5.00) null`,
`qty 12% null`, `bom sku "A1"`, `spaced header "5.50"`, `ext price unitPrice:null lineTotal:null`,
`00501 "00501"`, `1.23457E+15 "1.23457E+15"`, full row exactly as the `toEqual` above.

**S1.2** `apps/api/src/procurement/procurement-parse.processor.spec.ts` — anchor (end of
file, verbatim):

```ts
    await expect(
      processor.handleParse(job('job-budget', { kind: 'purchase_order', id: po.id }, 0, 3)),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('Workspace monthly token budget reached')
  })
})
```

Insert between that `  })` and the final `})` (inside `describe('ProcurementParseProcessor')`,
where `seedWorkspace`, `seedPo`, `seedPoBuffer`, `job`, `processor`, `prefix` are in scope;
no import change — `XLSX`, `eq`, `db`, `poLineItems`, `purchaseOrders` imported at lines 6-22):

```ts

  // Launch hardening (S1). Files the way vendors and spreadsheet apps actually
  // save them. Every expected value was observed by replaying this processor's
  // own calls on the same bytes: Papa.parse(text, { header: true,
  // skipEmptyLines: false }), XLSX.read -> sheet_to_json({ defval: '' }) ->
  // Papa.unparse, file read as utf-8, sourceRow = record index + 2.
  describe('real-world files (launch hardening)', () => {
    it('error: fails a truncated .xlsx at once with the spreadsheet message and stores no lines', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-corrupt-xlsx@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 5 }]), 'Sheet1')
      const whole = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      // Half a zip: what an interrupted download or a broken sync leaves behind.
      const po = await seedPoBuffer(whole.subarray(0, Math.floor(whole.length / 2)), workspace.id, 'po.xlsx')

      await expect(
        processor.handleParse(job('job-rw-corrupt', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('failed')
      expect(updated.lastError).toBe('Could not read this spreadsheet — it may be corrupt or password-protected')
      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(0)
    })

    // XLSX.read does not reject text bytes: it reads them as a one-sheet
    // workbook. Pinned so a change to that behaviour is a visible decision.
    it('edge: reads an .xlsx whose bytes are plain CSV text as a one-sheet workbook', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-text-xlsx@example.com`, prefix)
      const po = await seedPoBuffer(Buffer.from(['sku,qty', 'A1,10'].join('\n')), workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-text-xlsx', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        sku: 'A1',
        quantity: '10',
        sourceKind: 'xlsx',
        sourceSheet: 'Sheet1',
        sourceRow: 2,
      })
    })

    it('edge: parses every row of a four-column semicolon-delimited CSV ending in a newline', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-semicolon@example.com`, prefix)
      const po = await seedPo(
        'sku;description;qty;unit price\nA1;Widget;10;5.00\nB2;Gadget;3;9.99\n',
        workspace.id,
      )

      await processor.handleParse(job('job-rw-semicolon', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99', sourceRow: 3 })
    })

    it('edge: parses every row of a tab-delimited file', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-tab@example.com`, prefix)
      const po = await seedPo(
        ['sku\tdescription\tqty\tunit price', 'A1\tWidget\t10\t5.00', 'B2\tGadget\t3\t9.99'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-tab', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00' })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99' })
    })

    it('edge: maps the first column of a CSV saved with a UTF-8 byte order mark', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-bom@example.com`, prefix)
      const po = await seedPo('﻿sku,description,qty,unit price\nA1,Widget,10,5.00', workspace.id)

      await processor.handleParse(job('job-rw-bom', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.sku).toBe('A1')
      // Papa strips the BOM, so the audit copy's header is clean too.
      expect(item.rawRow).toEqual({ sku: 'A1', description: 'Widget', qty: '10', 'unit price': '5.00' })
    })

    // sourceRow counts records, not physical lines: B2 sits on line 4 of the
    // file because A1's description spans two lines, yet it records 3 (D13).
    it('edge: keeps a quoted description with an embedded newline and doubled quotes in a CRLF file', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-crlf@example.com`, prefix)
      const po = await seedPo(
        [
          'sku,description,qty,unit price',
          'A1,"Widget, 10"" blue\nsecond line",10,5.00',
          'B2,Gadget,3,9.99',
          'C3,Gizmo,1,1.00',
        ].join('\r\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-crlf', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget, 10" blue\nsecond line', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', sourceRow: 3 })
      expect(items[2]).toMatchObject({ sku: 'C3', description: 'Gizmo', sourceRow: 4 })
    })

    it('edge: parses rows with trailing commas and rows with missing cells without failing', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-ragged@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,5.00,,', 'B2,Gadget,3'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-ragged', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', unitPrice: '5.00' })
      // Papa files the surplus cells under __parsed_extra; the audit copy keeps them.
      expect(items[0].rawRow).toEqual({
        sku: 'A1',
        description: 'Widget',
        qty: '10',
        'unit price': '5.00',
        __parsed_extra: ['', ''],
      })
      expect(items[1]).toMatchObject({ sku: 'B2', quantity: '3', unitPrice: null })
      expect(items[1].rawRow).toEqual({ sku: 'B2', description: 'Gadget', qty: '3' })
    })

    // The file is read as UTF-8, so a Windows-1252 byte decodes to U+FFFD.
    // Pinned, not endorsed (D10): the line still lands, with a visible replacement.
    it('edge: stores a Windows-1252 accented byte as the Unicode replacement character', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-cp1252@example.com`, prefix)
      const bytes = Buffer.concat([
        Buffer.from('sku,description,qty,unit price\nA1,Caf', 'latin1'),
        Buffer.from([0xe9]),
        Buffer.from(' au lait,10,5.00', 'latin1'),
      ])
      const po = await seedPoBuffer(bytes, workspace.id, 'po.csv')

      await processor.handleParse(job('job-rw-cp1252', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.description).toBe('Caf� au lait')
      expect(item.quantity).toBe('10')
    })

    it('edge: keeps lines whose quantity or unit price is zero', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-zero@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Free sample,0,5.00', 'B2,Widget,5,0'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-zero', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '0', unitPrice: '5.00' })
      expect(items[1]).toMatchObject({ sku: 'B2', quantity: '5', unitPrice: '0' })
    })

    it('edge: keeps two lines with the same SKU as separate rows', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-dup-sku@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,5.00', 'A1,Widget,2,5.00'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-dup-sku', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', lineNumber: 1, sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'A1', quantity: '2', lineNumber: 2, sourceRow: 3 })
    })

    it('edge: parses only the first sheet of a two-sheet workbook', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-two-sheets@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 10 }]), 'Lines')
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'Z9', qty: 99 }]), 'Notes')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-two-sheets', { kind: 'purchase_order', id: po.id }))

      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', sourceSheet: 'Lines', sourceRow: 2 })
    })

    it('edge: stores a numeric SKU cell as its text', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-numeric-sku@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 501, qty: 2 }]), 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-numeric-sku', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.sku).toBe('501')
      expect(item.quantity).toBe('2')
    })

    it('edge: stores the cached value of a formula cell', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-formula@example.com`, prefix)
      const sheet = XLSX.utils.aoa_to_sheet([
        ['sku', 'qty', 'unit price', 'total'],
        ['A1', 3, 5, 0],
      ])
      sheet['D2'] = { t: 'n', v: 15, f: 'B2*C2' }
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-formula', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item).toMatchObject({ sku: 'A1', quantity: '3', unitPrice: '5', lineTotal: '15' })
    })

    it('edge: gives a merged cell value only to the top-left row', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-merged@example.com`, prefix)
      const sheet = XLSX.utils.aoa_to_sheet([
        ['sku', 'description', 'qty', 'unit price'],
        ['A1', 'Widget', 10, 5],
        ['B2', '', 3, 9.99],
      ])
      sheet['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }]
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-merged', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: null, quantity: '3', unitPrice: '9.99', sourceRow: 3 })
      expect(items[1].rawRow).toMatchObject({ description: '' })
    })

    it('happy: yields the same lines from a CSV and an XLSX holding the same rows', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-parity@example.com`, prefix)
      const csvPo = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,9.99', 'B2,Gadget,3,2.5'].join('\n'),
        workspace.id,
      )
      await processor.handleParse(job('job-rw-parity-csv', { kind: 'purchase_order', id: csvPo.id }))

      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet([
          { sku: 'A1', description: 'Widget', qty: 10, 'unit price': 9.99 },
          { sku: 'B2', description: 'Gadget', qty: 3, 'unit price': 2.5 },
        ]),
        'Sheet1',
      )
      const xlsxPo = await seedPoBuffer(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
        workspace.id,
        'po.xlsx',
      )
      await processor.handleParse(job('job-rw-parity-xlsx', { kind: 'purchase_order', id: xlsxPo.id }))

      const fieldsOf = async (purchaseOrderId: string) =>
        (
          await db
            .select()
            .from(poLineItems)
            .where(eq(poLineItems.purchaseOrderId, purchaseOrderId))
            .orderBy(poLineItems.lineNumber)
        ).map(({ sku, description, quantity, unitPrice }) => ({ sku, description, quantity, unitPrice }))

      const expected = [
        { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '9.99' },
        { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '2.5' },
      ]
      expect(await fieldsOf(csvPo.id)).toEqual(expected)
      expect(await fieldsOf(xlsxPo.id)).toEqual(expected)
    })
  })
```

Evidence (probe = a replica of `processor.ts:83-94,246-276` loading the real
`column-mapping.ts`, papaparse 5.5.4, xlsx 0.20.3): truncated zip → `"Unsupported ZIP file"`,
message `processor.ts:88`, permanent → `markFailed` + return (`:69,235-237`); text `.xlsx` →
`{"csv":"sku,qty\r\nA1,10","sheetName":"Sheet1"}`, `sourceKind` `:183`; semicolon → delim `";"`,
sourceRow 2/3; tab → delim `"\t"`, errors `[]`; BOM → Papa strips it (`papaparse.js:243,1238`),
fields clean; CRLF → `"Widget, 10\" blue\nsecond line"`, sourceRow 2/3/4; ragged →
`__parsed_extra:["",""]`, only FieldMismatch errors (tolerated `:256`); cp1252 → code points
`…66,fffd,20…`; zero → `quantity:"0"`, `unitPrice:"0"` (numeric columns read back as strings,
same as existing assertions `spec:196,286-287`); two sheets → only `Lines`; numeric SKU
`501` → `"501"`; formula → `total:15`; merged → B3 cell `{"t":"s","v":""}` → description
null, raw `""`; parity → both arrays identical. Numeric `9.99`/`2.5` chosen because a
numeric `5.00` XLSX cell reads back as `"5"` (probe), which would not equal CSV `"5.00"`.

S1 validation: `cd apps/api && bun run test -- src/procurement/column-mapping.spec.ts
src/procurement/procurement-parse.processor.spec.ts` ×3 green; then full
`cd apps/api && bun run test`; root `bun run type-check`, `bun run lint`.
Commit: `test(procurement): pin real-world spreadsheet parsing (launch hardening S1)`.

### Slice S2 — matching engine meets real AP (`enhancement/no-ticket-core-compare-edges`, base S1 branch, Opus 5.5 high)

Files (complete list): `apps/api/src/procurement/comparison.service.spec.ts`,
`apps/api/test/procurement.e2e-spec.ts`, `docs/ai/testing-strategy.md`,
`docs/ai/risk-register.md`, `learnings.md`, `graphify-out/*`.
Test layers: unit + API e2e (routes exercised; no controller changed, so the guard
requires nothing else).

Dropped candidates (covered, exact existing title): split delivery 6+4 → "sums accepted
quantity across every receipt linked to the purchase order"; no done receipt → two_way →
"stays two_way and classifies exactly as before when no receipt is linked" (+ the two
"ignores a receipt …" titles); BX vs EA → "flags a UOM mismatch and computes no delta when
the two sides state different units" + "prefers the UOM mismatch over comparing quantities
across different units"; PHP vs USD → "flags a currency mismatch once for the run, with no
line references and no delta"; member dismiss/decision 403 → "lets a member read run
history but not decide, and hides other workspaces"; malformed id on dismiss and PO
download → "uploads PO + invoice, parses, compares, lists, and dismisses a flag — isolated
per workspace"; binary `.csv` → not a test, it is bug B2.

**S2.1** `apps/api/src/procurement/comparison.service.spec.ts` — anchor (end of file, verbatim):

```ts
      expect(item.invoiceLine).toMatchObject({ sourceRow: 2, documentId: invoice.id })
      expect(item.receiptLine).toBeNull()
    })
  })
})
```

Insert between the last `  })` and the final `})` (no import change: `db`, `eq`,
`comparisonRuns`, `invoices`, `invoiceLineItems` imported at :1-22; helpers
`seedWorkspace` :24, `seedReadyPoAndInvoice` :57, `seedGoodsReceipt` :126, `service` :43
with a real `DuckDbQueryService` :47, `prefix` :44):

```ts

  // Launch hardening. Shapes real accounts-payable documents take, each pinned
  // to the outcome the engine produces today (COMPARISON_SQL, toFlagValues,
  // diff()) rather than to what a reader might expect.
  describe('real-world AP scenarios (launch hardening)', () => {
    it('error: refuses a purchase order with no parsed lines even when the invoice has some, and records no run', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-empty-po@example.com`, 'AP Empty PO')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )

      const error = await service.compare(workspace.id, po.id, invoice.id).then(
        () => null,
        (caught: unknown) => caught as { status: number; message: string },
      )

      expect(error?.status).toBe(400)
      expect(error?.message).toBe('Both documents must have parsed line items to compare')
      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, po.id))
      expect(runs).toHaveLength(0)
    })

    it('edge: invoice lines in a different order from the purchase order raise no flag', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-reorder@example.com`, 'AP Reorder')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '10', unitPrice: '5.00' },
          { sku: 'B2', quantity: '3', unitPrice: '2.50' },
          { sku: 'C3', quantity: '1', unitPrice: '99.99' },
        ],
        [
          { sku: 'C3', quantity: '1', unitPrice: '99.99' },
          { sku: 'A1', quantity: '10', unitPrice: '5.00' },
          { sku: 'B2', quantity: '3', unitPrice: '2.50' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
    })

    it('edge: a unit price written as 5.0000 on the order and 5.00 on the invoice is one price', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-scale@example.com`, 'AP Scale')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.0000' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
    })

    it('edge: an invoice splitting 0.3 into 0.1 + 0.2 matches the order with no floating-point quantity flag', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-float@example.com`, 'AP Float')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '0.3', unitPrice: '5.00' }],
        [
          { sku: 'A1', quantity: '0.1', unitPrice: '5.00' },
          { sku: 'A1', quantity: '0.2', unitPrice: '5.00' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
    })

    it('edge: a receipt accepting more than was ordered raises no flag when the invoice bills the order quantity', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-over-delivery@example.com`, 'AP Over Delivery')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '12' }])

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(1)
    })

    it('edge: a credit line on the invoice is netted into the billed quantity', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-credit@example.com`, 'AP Credit')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [
          { sku: 'A1', quantity: '10', unitPrice: '5.00' },
          { sku: 'A1', quantity: '-2', unitPrice: '5.00' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('quantity_mismatch')
      expect(flag.poValue).toBe('10')
      expect(flag.invoiceValue).toBe('8')
      expect(flag.delta).toBe('-2')
      expect(flag.reason).toBe('Quantity mismatch for A1: PO=10 Invoice=8 (summed across 2 invoice lines)')
    })

    it('edge: a freight line with no SKU is flagged missing_on_po under its description key, with no SKU', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-freight@example.com`, 'AP Freight')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [
          { sku: 'A1', quantity: '10', unitPrice: '5.00' },
          { description: 'Freight', quantity: '1', unitPrice: '50.00' },
        ],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('missing_on_po')
      expect(flag.sku).toBeNull()
      expect(flag.poLineItemId).toBeNull()
      expect(flag.invoiceLineItemId).not.toBeNull()
      expect(flag.poValue).toBeNull()
      expect(flag.invoiceValue).toBe('1')
      expect(flag.delta).toBe('1')
      expect(flag.poUnitPrice).toBeNull()
      expect(flag.invoiceUnitPrice).toBe('50')
    })

    it('edge: a SKU with surrounding spaces and different case matches its order line', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-sku-trim@example.com`, 'AP Sku Trim')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: ' a1 ', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
    })

    it('edge: a leading-zero SKU and the same digits without zeros are two different items', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-sku-zeros@example.com`, 'AP Sku Zeros')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: '00501', quantity: '10', unitPrice: '5.00' }],
        [{ sku: '501', quantity: '10', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(2)
      const onlyOnPo = result.flags.find((flag) => flag.flagType === 'missing_on_invoice')!
      expect(onlyOnPo.sku).toBe('00501')
      expect(onlyOnPo.poValue).toBe('10')
      expect(onlyOnPo.delta).toBe('-10')
      const onlyOnInvoice = result.flags.find((flag) => flag.flagType === 'missing_on_po')!
      expect(onlyOnInvoice.sku).toBe('501')
      expect(onlyOnInvoice.invoiceValue).toBe('10')
      expect(onlyOnInvoice.delta).toBe('10')
    })

    it('edge: description-only lines that differ by one character are two unmatched items', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-desc-near@example.com`, 'AP Desc Near')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ description: 'Bolt M8x20', quantity: '100', unitPrice: '0.12' }],
        [{ description: 'Bolt M8x25', quantity: '100', unitPrice: '0.12' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(2)
      const onlyOnPo = result.flags.find((flag) => flag.flagType === 'missing_on_invoice')!
      expect(onlyOnPo.sku).toBeNull()
      expect(onlyOnPo.poValue).toBe('100')
      expect(onlyOnPo.delta).toBe('-100')
      const onlyOnInvoice = result.flags.find((flag) => flag.flagType === 'missing_on_po')!
      expect(onlyOnInvoice.sku).toBeNull()
      expect(onlyOnInvoice.invoiceValue).toBe('100')
      expect(onlyOnInvoice.delta).toBe('100')
    })

    it('edge: an item ordered at two prices and invoiced at one is a price flag with no delta', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-two-prices@example.com`, 'AP Two Prices')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '4', unitPrice: '5.00' },
          { sku: 'A1', quantity: '6', unitPrice: '6.00' },
        ],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
      )

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(1)
      const flag = result.flags[0]
      expect(flag.flagType).toBe('price_mismatch')
      expect(flag.poValue).toBeNull()
      expect(flag.invoiceValue).toBe('5')
      expect(flag.poUnitPrice).toBeNull()
      expect(flag.invoiceUnitPrice).toBe('5')
      expect(flag.delta).toBeNull()
      expect(flag.reason).toBe(
        'Unit price mismatch for A1: multiple unit prices on the purchase order (5–6) (summed across 2 purchase order lines)',
      )
    })

    it('edge: a second invoice billing the full order again is compared on its own and raises no flag', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-double-bill@example.com`, 'AP Double Bill')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        [{ sku: 'A1', quantity: '10', unitPrice: '5.00' }],
        true,
      )
      const [second] = await db
        .insert(invoices)
        .values({
          workspaceId: workspace.id,
          name: 'invoice-2.csv',
          status: 'done',
          rowCount: 1,
          purchaseOrderId: po.id,
        })
        .returning()
      await db.insert(invoiceLineItems).values({
        workspaceId: workspace.id,
        invoiceId: second.id,
        lineNumber: 1,
        sku: 'A1',
        quantity: '10',
        unitPrice: '5.00',
      })

      const first = await service.compare(workspace.id, po.id, invoice.id)
      const again = await service.compare(workspace.id, po.id, second.id)

      expect(first.flags).toHaveLength(0)
      expect(again.flags).toHaveLength(0)
      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.purchaseOrderId, po.id))
      expect(runs).toHaveLength(2)
      expect(runs.every((run) => run.status === 'succeeded' && run.flagCount === 0)).toBe(true)
    })

    it('happy: a three-way match across normalized SKUs, units, price scale, line order and split receipts raises nothing', async () => {
      const { workspace } = await seedWorkspace(`${prefix}ap-happy@example.com`, 'AP Happy')
      const { po, invoice } = await seedReadyPoAndInvoice(
        workspace.id,
        [
          { sku: 'A1', quantity: '10', unitPrice: '5.0000', uom: 'EA' },
          { sku: 'B2', quantity: '4', unitPrice: '12.50', uom: 'EA' },
        ],
        [
          { sku: 'b2 ', quantity: '4', unitPrice: '12.5', uom: 'ea' },
          { sku: ' A1', quantity: '10.000', unitPrice: '5.00', uom: ' ea ' },
        ],
        true,
        { po: 'PHP', invoice: 'PHP' },
      )
      await seedGoodsReceipt(
        workspace.id,
        po.id,
        [
          { sku: 'A1', quantityAccepted: '6', uom: 'EA' },
          { sku: 'B2', quantityAccepted: '4', uom: 'EA' },
        ],
        'GRN-1',
      )
      await seedGoodsReceipt(workspace.id, po.id, [{ sku: 'A1', quantityAccepted: '4', uom: 'ea' }], 'GRN-2')

      const result = await service.compare(workspace.id, po.id, invoice.id)

      expect(result.flags).toHaveLength(0)
      expect(result.counts).toEqual({
        quantity_mismatch: 0,
        price_mismatch: 0,
        missing_on_invoice: 0,
        missing_on_po: 0,
        short_receipt: 0,
        invoice_exceeds_received: 0,
        uom_mismatch: 0,
        currency_mismatch: 0,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, result.runId))
      expect(run.status).toBe('succeeded')
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(3)
      expect(run.flagCount).toBe(0)
    })
  })
```

Deliberately NOT asserted here (they are bugs, fixed in B9/B10, never pinned): the
sub-cent case's `delta '0'` and the `"Item (unknown) …"` reason on description-keyed
flags. The `–` in the two-prices reason is U+2013, copied from `comparison.service.ts:1434`.

Evidence (probe = `COMPARISON_SQL` read verbatim from the file at runtime, run in
in-memory DuckDB over CSVs produced by exact copies of `serializeForCsv` /
`serializeGoodsReceiptForCsv` / `matchKey` / `normalizeUom`, rows mapped through copies of
`toFlagValues` / `diff` / `numToStr` / `singlePrice` / `buildReason`): empty PO → status
checks :1036/:1051/:384 then throw :400-401 before the run insert :456; reorder → `rows=0`
(FULL JOIN on `mk` :203); 5.0000/5.00 → `rows=0` (`unit_price` numeric without scale,
DuckDB DOUBLE, `TRY_CAST` :137-140); 0.1+0.2 → `rows=0` (`ROUND(SUM,6)` :136,:152);
over-delivery → `three_way rows=0` (no accepted > ordered branch in CASE :192-196);
credit → `quantity_mismatch '10'/'8'/-2` + summed note :1469; freight → `missing_on_po`,
sku null, `invoiceUnitPrice '50'`; ' a1 ' → `rows=0` (`matchKey` :314); 00501/501 → two
flags ∓10; Bolt → two flags ∓100; two prices → poValue null, delta null (`singlePrice`
:1377, `diff(x,null)` :1381), reason exact; double bill → compare reads one invoice
(:395-398); happy composite → `three_way rows=0`, line count 2+1=3 (:467).

**S2.2** `apps/api/test/procurement.e2e-spec.ts` — anchor (end of file, verbatim):

```ts
      const price = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'price_mismatch')
      expect(typeof price.poLine.extractionConfidence).toBe('number')
      expect(price.poLine.extractionConfidence).toBeCloseTo(0.9)
      expect(price.poLine).toMatchObject({ sourceRow: null, sourceSheet: null })
    })
  })
})
```

Insert between the last `  })` and the final `})` (no import change: `db`, `eq`,
`comparisonRuns`, `purchaseOrders`, `invoices`, `goodsReceipts`, `request` imported at
:1-32; helpers `seedOwnerWithWorkspace` :141, `seedMemberOfWorkspace` :158,
`createVendor` :167, `waitForPoDone` :82, `waitForGoodsReceiptDone` :93,
`waitForInvoiceDone` :119, `app` :182, `prefix` :184, cleanup `afterAll` :273):

```ts

  // Launch hardening. Each answer is the one the route gives today. Guard
  // order is ThrottlerGuard (global) → JwtAuthGuard → WorkspaceMemberGuard →
  // RolesGuard, then FileInterceptor / ParseUUIDPipe / ValidationPipe, then the
  // service. No case here calls /auth/register.
  describe('launch hardening: HTTP error answers', () => {
    // Well-formed ids that name nothing: a 401 must come from the missing
    // token, never from whatever the id points at.
    const anyId = '00000000-0000-4000-8000-000000000000'

    type Method = 'get' | 'post' | 'patch'

    async function answersWithoutToken(routes: [Method, string][]) {
      const answers: { route: string; status: number; message: unknown }[] = []
      for (const [method, path] of routes) {
        const res = await request(app.getHttpServer())[method](`/workspaces/${anyId}/procurement/${path}`)
        answers.push({ route: `${method.toUpperCase()} ${path}`, status: res.status, message: res.body.message })
      }
      return answers
    }

    const unauthorized = (routes: [Method, string][]) =>
      routes.map(([method, path]) => ({ route: `${method.toUpperCase()} ${path}`, status: 401, message: 'Unauthorized' }))

    // `done` with no line items, inserted directly: every refusal below happens
    // before compare() reads a single line.
    async function seedDoneDocs(workspaceId: string) {
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId, name: 'po.csv', status: 'done', rowCount: 0 })
        .returning()
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId, name: 'invoice.csv', status: 'done', rowCount: 0 })
        .returning()
      return { po, invoice }
    }

    it('error: every upload route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['post', 'purchase-orders'],
        ['post', 'invoices'],
        ['post', 'goods-receipts'],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every list route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['get', 'purchase-orders'],
        ['get', 'invoices'],
        ['get', 'goods-receipts'],
        ['get', 'discrepancies'],
        ['get', 'comparison-runs'],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every download route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['get', `purchase-orders/${anyId}/download`],
        ['get', `invoices/${anyId}/download`],
        ['get', `goods-receipts/${anyId}/download`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every discrepancy action answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['post', 'discrepancies/compare'],
        ['patch', `discrepancies/${anyId}/dismiss`],
        ['post', `discrepancies/${anyId}/decisions`],
        ['get', `discrepancies/${anyId}/decisions`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: a malformed id on the invoice and receipt downloads and both decision routes answers 400', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-uuid@example.com`, 'LH Uuid')
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const answers = [
        await request(app.getHttpServer()).get(`${base}/invoices/not-a-uuid/download`).set('Authorization', auth),
        await request(app.getHttpServer()).get(`${base}/goods-receipts/not-a-uuid/download`).set('Authorization', auth),
        // A valid body, so the only thing wrong is the id.
        await request(app.getHttpServer())
          .post(`${base}/discrepancies/not-a-uuid/decisions`)
          .set('Authorization', auth)
          .send({ outcome: 'resolved', note: 'Checked against the source.' }),
        await request(app.getHttpServer()).get(`${base}/discrepancies/not-a-uuid/decisions`).set('Authorization', auth),
      ].map((res) => ({ status: res.status, message: res.body.message }))

      expect(answers).toEqual([
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
      ])
    })

    it('error: compare answers 404 for a purchase order or invoice from another workspace and records no run', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-cross-mine@example.com`, 'LH Cross Mine')
      const stranger = await seedOwnerWithWorkspace(app, `${prefix}lh-cross-other@example.com`, 'LH Cross Other')
      const mine = await seedDoneDocs(owner.workspaceId)
      const theirs = await seedDoneDocs(stranger.workspaceId)

      const foreignPo = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: theirs.po.id, invoiceId: mine.invoice.id })
        .expect(404)
      expect(foreignPo.body.message).toBe('Purchase order not found')

      const foreignInvoice = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: mine.po.id, invoiceId: theirs.invoice.id })
        .expect(404)
      expect(foreignInvoice.body.message).toBe('Invoice not found')

      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, owner.workspaceId))
      expect(runs).toHaveLength(0)
    })

    it('error: a member is refused compare and every upload with 403 on role alone', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-role-owner@example.com`, 'LH Role Owner')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}lh-role-member@example.com`)
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const { po, invoice } = await seedDoneDocs(owner.workspaceId)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${member.accessToken}`
      const lines = 'sku,description,qty,unit price\nA1,Widget,10,5.00'

      const answers = [
        await request(app.getHttpServer())
          .post(`${base}/discrepancies/compare`)
          .set('Authorization', auth)
          .send({ purchaseOrderId: po.id, invoiceId: invoice.id }),
        await request(app.getHttpServer())
          .post(`${base}/purchase-orders`)
          .set('Authorization', auth)
          .field('vendorId', vendorId)
          .field('poNumber', 'PO-LH-MEMBER')
          .field('currency', 'USD')
          .attach('file', Buffer.from(lines), 'po.csv'),
        await request(app.getHttpServer())
          .post(`${base}/invoices`)
          .set('Authorization', auth)
          .field('purchaseOrderId', po.id)
          .field('invoiceNumber', 'INV-LH-MEMBER')
          .field('currency', 'USD')
          .attach('file', Buffer.from(lines), 'invoice.csv'),
        await request(app.getHttpServer())
          .post(`${base}/goods-receipts`)
          .set('Authorization', auth)
          .field('purchaseOrderId', po.id)
          .field('grnNumber', 'GRN-LH-MEMBER')
          .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,10,10'), 'grn.csv'),
      ].map((res) => ({ status: res.status, message: res.body.message }))

      expect(answers).toEqual([
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
      ])
      // Refused before the service ran: nothing was compared or stored.
      expect(await db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, owner.workspaceId))).toHaveLength(0)
      expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: an oversized invoice or goods receipt answers 413 naming the 25MB limit', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-too-big@example.com`, 'LH Too Big')
      const { po } = await seedDoneDocs(owner.workspaceId)
      const tooBig = Buffer.alloc(26 * 1024 * 1024, 'a')

      const invoiceRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.id)
        .field('invoiceNumber', 'INV-LH-BIG')
        .field('currency', 'USD')
        .attach('file', tooBig, 'too-big.csv')
        .expect(413)
      expect(invoiceRes.body).toEqual({ statusCode: 413, message: 'File exceeds 25MB upload limit' })

      const receiptRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.id)
        .field('grnNumber', 'GRN-LH-BIG')
        .attach('file', tooBig, 'too-big.csv')
        .expect(413)
      expect(receiptRes.body).toEqual({ statusCode: 413, message: 'File exceeds 25MB upload limit' })

      // Refused in the interceptor, before the service stored anything.
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('happy: a three-way match over HTTP with the delivery split across two receipts raises no flag', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-split@example.com`, 'LH Split')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const poUpload = await request(app.getHttpServer())
        .post(`${base}/purchase-orders`)
        .set('Authorization', auth)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-LH-SPLIT')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00\nB2,Gadget,4,12.50'), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      const firstReceipt = await request(app.getHttpServer())
        .post(`${base}/goods-receipts`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('grnNumber', 'GRN-LH-1')
        .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,6,6\nB2,4,4'), 'grn-1.csv')
        .expect(201)
      await waitForGoodsReceiptDone(firstReceipt.body.id)

      const secondReceipt = await request(app.getHttpServer())
        .post(`${base}/goods-receipts`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('grnNumber', 'GRN-LH-2')
        .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,4,4'), 'grn-2.csv')
        .expect(201)
      await waitForGoodsReceiptDone(secondReceipt.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`${base}/invoices`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-LH-SPLIT')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nB2,Gadget,4,12.50\nA1,Widget,10,5.00'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      const compareRes = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', auth)
        .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .expect(201)

      expect(compareRes.body.flags).toEqual([])
      expect(compareRes.body.counts).toEqual({
        quantity_mismatch: 0,
        price_mismatch: 0,
        missing_on_invoice: 0,
        missing_on_po: 0,
        short_receipt: 0,
        invoice_exceeds_received: 0,
        uom_mismatch: 0,
        currency_mismatch: 0,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
      // Neither receipt alone covers A1, and a two-way engine also returns no
      // flags for this pair, so the run itself must prove three-way happened.
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, compareRes.body.runId))
      expect(run.status).toBe('succeeded')
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(3)
      expect(run.flagCount).toBe(0)
    })
  })
```

Evidence: 401 — `JwtAuthGuard` first on every route (controller :107-273), passport
`auth.guard.js:60` → `new UnauthorizedException()` default message `'Unauthorized'`
(`unauthorized.exception.js:38`), passed through by `AllExceptionsFilter` :32-36 (the
upload filter does not catch 401, filter :23); 400 — `ParseUUIDPipe` at controller
:198,:208,:277,:288, message `parse-uuid.pipe.js:33`; 404 — `loadReadyPo` :1034,
`loadReadyInvoice` :1049, both before the run insert :456; 403 — `@Roles('owner','admin')`
:108,:130,:152,:233, RolesGuard message `'Insufficient workspace role'`, guards precede the
interceptor; 413 — filter :36 body, `maxUploadMb()` default 25 (`upload-limit.ts:1,12`),
CI runs from `apps/api` with no `.env` (deploy.yml :181-184) → 25, root `.env` and
`.env.example:152` = 25; split three-way → probe `three_way rows=0`, GRN aliases
`qty received`/`qty accepted` (`column-mapping.ts:41-55`). Throttle headroom: global 60/min
per class+handler+IP (`throttler.guard.js:148-149`); hottest handler (PO upload) ≈ 26 per
file. Every `:docId`/`:flagId` route has `ParseUUIDPipe`; `:workspaceId` non-UUID → guard
403 (guard :32-34) — no route answers 500 on a malformed id.

S2 validation: `cd apps/api && bun run test -- src/procurement/comparison.service.spec.ts`
×3; `bun apps/e2e/scripts/prepare-db.ts optra_e2e && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/optra_e2e bun run test:e2e -- test/procurement.e2e-spec.ts`
(cwd `apps/api`) ×3; then full unit + e2e suites; `bun run type-check`, `bun run lint`.
Commits: `test(procurement): pin real-world AP matching outcomes (launch hardening S2)`,
`test(procurement): pin HTTP error answers for every procurement route`.

### Slice S3 — catalogs under failure (`enhancement/no-ticket-core-catalog-edges`, base S2 branch, Opus 5.5 high)

Files (complete list): `apps/api/src/catalog/catalog-parse.processor.spec.ts`,
`apps/api/src/catalog/catalog-image.service.spec.ts`,
`apps/api/src/catalog/catalog-match.service.spec.ts`, `apps/api/test/catalog.e2e-spec.ts`,
`docs/ai/testing-strategy.md`, `docs/ai/risk-register.md`, `learnings.md`, `graphify-out/*`.
Test layers: unit + API e2e.

Dropped candidates (covered, exact existing title): private IP before fetch → "returns
null when the URL is not public"; SVG → the `it.each` "returns null and stores nothing for
%s …"; over-cap body → "returns null when the body exceeds the size cap"; small PNG key →
"stores and returns a key for a valid small image"; match happy path → "searches all
vendors (sourcing) and persists judged matches"; catalog CSV happy over HTTP → "creates a
vendor, uploads a PDF catalog, searches matches, and dismisses one — isolated per
workspace" (it uploads a CSV at :191-251). Not written because it would pin bug B6: "a
model failure on one candidate rejects the search". Malformed `:vendorId`/`:catalogId`
cases not written: they are bug B13 (500 today).

**S3.1** `apps/api/src/catalog/catalog-parse.processor.spec.ts` — insert before the file's
final `})` (line 284), i.e. after the budget test ending at :283, inside
`describe('CatalogParseProcessor')`. No new imports (helpers `seedWorkspaceAndVendor` :73,
`seedCatalog` :81, `processor`, `images`, `storage`, `dir`, `prefix`, `XLSX`, `join`,
`randomUUID`, `writeFileSync` already in scope):

```ts
  describe('real-world catalogs (launch hardening)', () => {
    it('edge: a semicolon-delimited catalog with extra columns parses every item', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}semicolon@example.com`, 'Catalog Semicolon')
      const csv = [
        'Item Code;Item Name;Pack Size;Unit Price',
        'A1;Widget;10;1,50',
        'B2;Gadget;5;12,00',
        'C3;Gizmo, large;1;99,99',
      ].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)

      await processor.handleParse({ id: 'job-semicolon', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items.map((item) => [item.lineNumber, item.sku, item.description])).toEqual([
        [1, 'A1', 'Widget'],
        [2, 'B2', 'Gadget'],
        [3, 'C3', 'Gizmo, large'],
      ])
      expect(items[0].rawRow).toEqual({ 'Item Code': 'A1', 'Item Name': 'Widget', 'Pack Size': '10', 'Unit Price': '1,50' })
      expect(images.fetchAndStore).not.toHaveBeenCalled()
    })

    it('edge: a UTF-8 byte-order mark before the header still maps the sku column', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}bom@example.com`, 'Catalog BOM')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', '﻿sku,description\nA1,Widget\n')

      await processor.handleParse({ id: 'job-bom', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(1)

      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget' })
      expect(items[0].rawRow).toEqual({ sku: 'A1', description: 'Widget' })
    })

    it('edge: an XLSX catalog is read from its first sheet only', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}xlsx-sheets@example.com`, 'Catalog Sheets')
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ sku: 'A1', description: 'Widget' }]), 'Catalog')
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ sku: 'Z9', description: 'Archived item' }]), 'Archive')
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      const filePath = join(dir, `${randomUUID()}.xlsx`)
      writeFileSync(filePath, buffer)
      storage.getToTempFile.mockResolvedValue(filePath)

      const [catalog] = await db
        .insert(catalogs)
        .values({ workspaceId: workspace.id, vendorId: vendor.id, name: 'catalog.xlsx', storageKey: `k/${randomUUID()}`, status: 'pending' })
        .returning()

      await processor.handleParse({ id: 'job-xlsx-sheets', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(1)

      const items = await db.select().from(catalogItems).where(eq(catalogItems.catalogId, catalog.id))
      expect(items.map((item) => item.sku)).toEqual(['A1'])
    })

    it('edge: a row whose photo cannot be fetched is kept with no photo', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}photo-null@example.com`, 'Catalog Photo Null')
      const csv = [
        'sku,description,photo_url',
        'A1,Widget,https://vendor.example.com/a1.png',
        'B2,Gadget,https://vendor.example.com/b2.png',
      ].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)
      images.fetchAndStore
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(`${workspace.id}/catalogs/${catalog.id}/images/b2.png`)

      await processor.handleParse({ id: 'job-photo-null', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      expect(items[0]).toMatchObject({ lineNumber: 1, sku: 'A1', photoStorageKey: null })
      expect(items[1]).toMatchObject({
        lineNumber: 2,
        sku: 'B2',
        photoStorageKey: `${workspace.id}/catalogs/${catalog.id}/images/b2.png`,
      })
      expect(images.fetchAndStore).toHaveBeenNthCalledWith(1, workspace.id, catalog.id, 'https://vendor.example.com/a1.png')
    })

    it('happy: a CSV catalog with sku, description and photo url stores its items in file order, numbered from 1', async () => {
      const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}order@example.com`, 'Catalog Order')
      const urls = [
        'https://vendor.example.com/a1.png',
        'https://vendor.example.com/b2.png',
        'https://vendor.example.com/c3.png',
      ]
      const csv = ['SKU,Description,Photo URL', `A1,Widget,${urls[0]}`, `B2,Gadget,${urls[1]}`, `C3,Gizmo,${urls[2]}`].join('\n')
      const catalog = await seedCatalog(workspace.id, vendor.id, 'catalog.csv', csv)
      images.fetchAndStore.mockImplementation(
        async (workspaceId: string, catalogId: string, url: string) =>
          `${workspaceId}/catalogs/${catalogId}/images/${url.split('/').pop()}`,
      )

      await processor.handleParse({ id: 'job-order', data: { id: catalog.id } } as any)

      const [updated] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)

      const items = await db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.catalogId, catalog.id))
        .orderBy(catalogItems.lineNumber)
      const base = `${workspace.id}/catalogs/${catalog.id}/images`
      expect(items.map((item) => [item.lineNumber, item.sku, item.description, item.photoStorageKey])).toEqual([
        [1, 'A1', 'Widget', `${base}/a1.png`],
        [2, 'B2', 'Gadget', `${base}/b2.png`],
        [3, 'C3', 'Gizmo', `${base}/c3.png`],
      ])
      expect(images.fetchAndStore.mock.calls.map((call) => call[2])).toEqual(urls)
    })
  })
```

Evidence: Papa detects `;` for this 4-column file (probe: delim `;`, 3 rows, `"Unit Price":"1,50"`);
aliases `item code`/`item name` (`catalog-parse.processor.ts:35-36`), options `:238`; BOM bytes
survive `toString('utf-8')` and Papa strips them (probe `fields[0]` = `sku`); first sheet
`:85-87` (probe SheetNames `['Catalog','Archive']` → `sku,description\r\nA1,Widget`); row kept
whatever `fetchAndStore` returns `:246-257`; sequential `await` + `lineNumber += 1` `:242-252`;
`Photo URL` → `photo url` alias `:37,:40`.

**S3.2** `apps/api/src/catalog/catalog-image.service.spec.ts` — insert before the final
`})` (line 115), inside `describe('CatalogImageService')`. No new imports (`fakeResponse`
:9, `fetchMock`, `service`, `storage` in scope):

```ts
  describe('launch hardening', () => {
    it('error: a redirect is not followed and nothing is stored', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 302, contentType: 'image/png', chunks: [new Uint8Array([0x89, 0x50, 0x4e, 0x47])] }),
      )

      const result = await service.fetchAndStore('ws-1', 'cat-1', 'https://vendor.example.com/moved.png')

      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vendor.example.com/moved.png',
        expect.objectContaining({ redirect: 'manual' }),
      )
      expect(storage.save).not.toHaveBeenCalled()
    })
  })
```

Evidence: `redirect: 'manual'`, non-ok → throw → null (`catalog-image.service.ts:27-34,49-52`).

**S3.3** `apps/api/src/catalog/catalog-match.service.spec.ts` — imports: append after line 17:

```ts
import { CatalogExtractionParseError } from '@repo/ai'
import { UsageService, isBudgetExceeded } from '../limits/usage.service'
```

Insert before the final `})` (line 326):

```ts
  describe('launch hardening', () => {
    it('error: an exhausted token budget refuses the search and keeps the previous open match', async () => {
      const workspace = await seedWorkspace(`${prefix}budget@example.com`, 'Budget WS')
      const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
      await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
      await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
      const [previous] = await service.listMatches(workspace.id, { status: 'open' })

      // The real enforcement path, not a mocked compare: CatalogExtractionService.compare
      // -> UsageService.metered -> assertWithinBudget, with this month's counter at the cap.
      const redis = { get: jest.fn().mockResolvedValue('5000000'), incrby: jest.fn(), expire: jest.fn() }
      const config = { get: jest.fn((_key: string, fallback: string) => fallback) }
      const budgeted = new CatalogMatchService(
        storage as unknown as StorageService,
        new CatalogExtractionService(new UsageService(redis as never, config as never)),
      )

      const error = await budgeted
        .search(workspace.id, { purchaseOrderLineItemId: poItem.id })
        .catch((caught: unknown) => caught)

      expect(isBudgetExceeded(error)).toBe(true)
      expect((error as Error).message).toBe('Workspace monthly token budget reached')
      expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^usage:tok:${workspace.id}:\\d{6}$`)))
      expect(redis.incrby).not.toHaveBeenCalled()
      const open = await service.listMatches(workspace.id, { status: 'open' })
      expect(open.map((match) => match.id)).toEqual([previous.id])
    })

    it('error: a malformed model verdict rejects the search and leaves the previous open match untouched', async () => {
      const workspace = await seedWorkspace(`${prefix}malformed@example.com`, 'Malformed WS')
      const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
      await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
      await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
      const [previous] = await service.listMatches(workspace.id, { status: 'open' })
      extraction.compare.mockRejectedValueOnce(new CatalogExtractionParseError())

      await expect(service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })).rejects.toThrow(
        'Model returned malformed catalog extraction JSON',
      )

      const rows = await db.select().from(catalogMatches).where(eq(catalogMatches.queryPoLineItemId, poItem.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: previous.id, status: 'open', reason: 'Same widget.' })
    })

    it('edge: an underscore in a SKU is a literal, not a single-character wildcard', async () => {
      const workspace = await seedWorkspace(`${prefix}underscore@example.com`, 'Underscore WS')
      const poItem = await seedPoLineItem(workspace.id, 'A_1', 'Widget')
      const { catalogItem: literal } = await seedVendorWithCatalogItem(workspace.id, 'Acme', {
        sku: 'A_1',
        description: 'Widget',
      })
      await seedVendorWithCatalogItem(workspace.id, 'Beta', { sku: 'AZ1', description: 'Unrelated part' })

      const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].catalogItemId).toBe(literal.id)
    })

    it('edge: a backslash in a SKU is a literal, not an escape character', async () => {
      const workspace = await seedWorkspace(`${prefix}backslash@example.com`, 'Backslash WS')
      const poItem = await seedPoLineItem(workspace.id, 'A\\1', 'Widget')
      const { catalogItem: literal } = await seedVendorWithCatalogItem(workspace.id, 'Acme', {
        sku: 'A\\1',
        description: 'Widget',
      })
      await seedVendorWithCatalogItem(workspace.id, 'Beta', { sku: 'A1', description: 'Unrelated part' })

      const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].catalogItemId).toBe(literal.id)
    })

    it('edge: a line with no SKU searches by its description', async () => {
      const workspace = await seedWorkspace(`${prefix}desc-only@example.com`, 'Desc Only WS')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'done' })
        .returning()
      const [poItem] = await db
        .insert(poLineItems)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, sku: null, description: 'Stainless Widget' })
        .returning()
      const { catalogItem: byDescription } = await seedVendorWithCatalogItem(workspace.id, 'Acme', {
        sku: 'SW-9',
        description: 'Stainless Widget 40mm',
      })
      await seedVendorWithCatalogItem(workspace.id, 'Beta', { sku: 'GD-1', description: 'Gadget' })

      const result = await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].catalogItemId).toBe(byDescription.id)
      expect(extraction.compare).toHaveBeenCalledWith(
        expect.objectContaining({
          queryText: 'Description: Stainless Widget',
          candidateText: 'SKU: SW-9\nDescription: Stainless Widget 40mm',
        }),
        workspace.id,
      )
    })

    it('regression: an insert that fails after the delete rolls back, so the previous open match survives', async () => {
      const workspace = await seedWorkspace(`${prefix}rollback@example.com`, 'Rollback WS')
      const poItem = await seedPoLineItem(workspace.id, 'A1', 'Widget')
      await seedVendorWithCatalogItem(workspace.id, 'Acme', { sku: 'A1', description: 'Widget' })
      await service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })
      const [previous] = await service.listMatches(workspace.id, { status: 'open' })
      // catalog_matches.reason is NOT NULL, so this verdict fails the insert
      // inside the transaction, after the scoped delete has already run.
      extraction.compare.mockResolvedValueOnce({ isMatch: true, score: 0.9, reason: null })

      await expect(service.search(workspace.id, { purchaseOrderLineItemId: poItem.id })).rejects.toThrow()

      const rows = await db.select().from(catalogMatches).where(eq(catalogMatches.queryPoLineItemId, poItem.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: previous.id, status: 'open' })
    })
  })
```

Evidence: budget — `CatalogExtractionService.compare` wraps `usage.metered`
(`catalog-extraction.service.ts:24-26`), `metered` → `assertWithinBudget` first
(`usage.service.ts:64-65`) → `HttpException('Workspace monthly token budget reached', 402)`
(`:47-48`), key `usage:tok:<ws>:YYYYMM`, default limit `'5000000'` (`:38-41`); malformed
message `catalog-match.ts:40`, thrown `:287`, rethrown `:255-256`; `Promise.all` precedes the
transaction (`catalog-match.service.ts:62` vs `:111`); LIKE escaping `:30-32,:291-296`
(probe `"A_1"` → `%A\_1%`, `A\1` → `%A\\1%`); description fallback `:282`, `lineItemText`
`:338-342`; `catalog_matches.reason` NOT NULL (`packages/db/src/schema/catalogMatches.ts`),
delete+insert in one transaction `:111-130`. The malformed-verdict test asserts today's
single-candidate rejection; the B6 fix slice revisits it explicitly (never silently).

**S3.4** `apps/api/test/catalog.e2e-spec.ts` — this suite already spends the full
`/auth/register` budget (5 calls at :169,:170,:289,:316,:317; limit 5/10 min,
`auth.controller.ts:32-33`), so new cases seed directly.

Imports — after line 2 (`import { Test } …`):

```ts
import { JwtService } from '@nestjs/jwt'
```

After line 4 (`import { mkdtemp, writeFile } …`):

```ts
import { randomUUID } from 'crypto'
```

Helpers — insert after `registerAndVerify` (ends :72), before `waitForCatalogDone`:

```ts
/**
 * A verified owner + workspace inserted directly, with the token minted the way
 * AuthService does. This file already spends the whole `/auth/register` budget
 * (5 per 10 minutes, auth.controller.ts:33); copied from procurement.e2e-spec.ts.
 */
async function seedOwnerWithWorkspace(app: INestApplication, email: string, workspaceName: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, workspaceId: workspace.id, accessToken }
}

/** A real `member` of someone else's workspace, so RolesGuard (not WorkspaceMemberGuard) is what refuses. */
async function seedMemberOfWorkspace(app: INestApplication, workspaceId: string, email: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'member' })
  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, accessToken }
}
```

Describe — insert before the final `})` (line 423), inside `describe('Catalog flow (e2e)')`:

```ts
  describe('launch hardening', () => {
    async function createVendor(token: string, workspaceId: string, name: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/vendors`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
        .expect(201)
      return res.body.id as string
    }

    it('error: a member is refused every catalog write with 403 Insufficient workspace role', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-role-owner@example.com`, 'LH Role Owner')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}lh-role-member@example.com`)
      const vendorId = await createVendor(owner.accessToken, owner.workspaceId, 'LH Role Vendor')
      const ws = `/workspaces/${owner.workspaceId}`
      const auth = `Bearer ${member.accessToken}`

      const upload = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalogs`)
        .set('Authorization', auth)
        .attach('file', Buffer.from('sku,description\nA1,Widget'), 'catalog.csv')
        .expect(403)
      const scrape = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalogs/scrape`)
        .set('Authorization', auth)
        .send({ seedUrl: 'https://vendor.example.com/' })
        .expect(403)
      const search = await request(app.getHttpServer())
        .post(`${ws}/catalog-matches/search`)
        .set('Authorization', auth)
        .send({ purchaseOrderLineItemId: randomUUID() })
        .expect(403)
      const verify = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalog-matches/verify`)
        .set('Authorization', auth)
        .send({ purchaseOrderLineItemId: randomUUID() })
        .expect(403)
      const dismiss = await request(app.getHttpServer())
        .patch(`${ws}/catalog-matches/${randomUUID()}/dismiss`)
        .set('Authorization', auth)
        .expect(403)

      for (const res of [upload, scrape, search, verify, dismiss]) {
        expect(res.body.message).toBe('Insufficient workspace role')
      }
      // Guards run before the file interceptor: nothing reached storage.
      expect(storage.save).not.toHaveBeenCalledWith(
        expect.stringContaining(`${owner.workspaceId}/catalogs/`),
        expect.anything(),
        expect.anything(),
      )
      // Reads stay open to a member.
      await request(app.getHttpServer()).get(`${ws}/vendors/${vendorId}/catalogs`).set('Authorization', auth).expect(200)
    })

    it('error: scraping the cloud metadata address is refused with 400 URL is not allowed and creates no catalog', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-ssrf@example.com`, 'LH SSRF')
      const vendorId = await createVendor(owner.accessToken, owner.workspaceId, 'LH SSRF Vendor')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/vendors/${vendorId}/catalogs/scrape`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seedUrl: 'http://169.254.169.254/' })
        .expect(400)

      expect(res.body.message).toBe('URL is not allowed')
      const rows = await db.select().from(catalogs).where(eq(catalogs.vendorId, vendorId))
      expect(rows).toHaveLength(0)
    })

    it("error: uploading a catalog under another workspace's vendor id is a 404 and stores nothing", async () => {
      const mine = await seedOwnerWithWorkspace(app, `${prefix}lh-vendor-mine@example.com`, 'LH Vendor Mine')
      const other = await seedOwnerWithWorkspace(app, `${prefix}lh-vendor-other@example.com`, 'LH Vendor Other')
      const foreignVendorId = await createVendor(other.accessToken, other.workspaceId, 'LH Foreign Vendor')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${mine.workspaceId}/vendors/${foreignVendorId}/catalogs`)
        .set('Authorization', `Bearer ${mine.accessToken}`)
        .attach('file', Buffer.from('sku,description\nA1,Widget'), 'catalog.csv')
        .expect(404)

      expect(res.body.message).toBe('Vendor not found')
      expect(storage.save).not.toHaveBeenCalledWith(
        expect.stringContaining(`${mine.workspaceId}/catalogs/`),
        expect.anything(),
        expect.anything(),
      )
      const rows = await db.select().from(catalogs).where(eq(catalogs.vendorId, foreignVendorId))
      expect(rows).toHaveLength(0)
    })

    it('error: a malformed item, match or verify-vendor id is a 400 before any query runs', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-malformed@example.com`, 'LH Malformed')
      const ws = `/workspaces/${owner.workspaceId}`
      const auth = `Bearer ${owner.accessToken}`

      const photo = await request(app.getHttpServer())
        .get(`${ws}/catalog-items/not-a-uuid/photo`)
        .set('Authorization', auth)
        .expect(400)
      const dismiss = await request(app.getHttpServer())
        .patch(`${ws}/catalog-matches/not-a-uuid/dismiss`)
        .set('Authorization', auth)
        .expect(400)
      const verify = await request(app.getHttpServer())
        .post(`${ws}/vendors/not-a-uuid/catalog-matches/verify`)
        .set('Authorization', auth)
        .send({})
        .expect(400)

      for (const res of [photo, dismiss, verify]) {
        expect(res.body.message).toBe('Validation failed (uuid is expected)')
      }
    })
  })
```

Evidence: roles message `roles.guard.ts:24`; routes upload :152-155, scrape :167-169,
search :218-220, verify :225-227, dismiss :244-246; guards precede interceptors and pipes;
`isURL('http://169.254.169.254/')` true, `assertPublicUrl` rejects ("Blocked non-public URL:
private IP 169.254.169.254"), mapped to `'URL is not allowed'` before the insert
(`catalog-scrape.service.ts:36-41`); foreign vendor → `'Vendor not found'` before `save`
(`catalog-documents.service.ts:55,63,177-185`); `ParseUUIDPipe` at controller :204,:232,:249.

S3 validation: `cd apps/api && bun run test -- src/catalog` ×3; catalog e2e on a fresh
`optra_e2e` ×3; full unit + e2e; `bun run type-check`, `bun run lint`.
Commits: `test(catalog): pin real-world catalog parsing and photo safety (launch hardening S3)`,
`test(catalog): pin match budget, rollback and prefilter literals`,
`test(catalog): pin role, SSRF, cross-workspace and malformed-id answers over HTTP`.

### Slice S4 — browser flows a buyer clicks (`enhancement/no-ticket-core-browser-flows`, base S3 branch, Opus 5.5 high)

Files (complete list): `apps/e2e/stubs/openai-stub.ts`, `apps/e2e/support/ui.ts`,
`apps/e2e/support/flows.ts`, new `apps/e2e/fixtures/{grn-split-1.csv,grn-split-2.csv,invoice-semicolon.csv,catalog.csv,po.xlsx}`,
new `apps/e2e/tests/procurement-core.spec.ts`, new `apps/e2e/tests/catalog-core.spec.ts`,
`docs/ai/testing-strategy.md`, `docs/ai/file-index/repository-map.md`,
`docs/ai/risk-register.md`, `learnings.md`, `graphify-out/*`.
Test layers: browser e2e only (no page/BFF edited). Not overlapping: member PO upload 403
(`access.spec.ts:76`), member decision 403 (`procurement.e2e-spec.ts:953`).

**S4.1** `apps/e2e/stubs/openai-stub.ts` — Old:

```ts
function chatCompletion(body: any): unknown {
  const prompt = promptText(body.messages ?? [])
  const content = /catalog product entries/i.test(prompt)
    ? JSON.stringify({ items: CATALOG_STUB_ITEMS })
    : 'e2e stub response'
```

New:

```ts
function chatCompletion(body: any): unknown {
  const prompt = promptText(body.messages ?? [])
  // Catalog match comparison: keyed on CATALOG_COMPARE_SYSTEM_PROMPT's own
  // wording (packages/ai/src/chains/catalog-match.ts), which the page-extraction
  // prompt never contains. Checked first so the two can never cross.
  const content = /candidate product from a vendor catalog/i.test(prompt)
    ? JSON.stringify({ isMatch: true, score: 0.9, reason: 'E2E stub match' })
    : /catalog product entries/i.test(prompt)
      ? JSON.stringify({ items: CATALOG_STUB_ITEMS })
      : 'e2e stub response'
```

And the header comment — Old: `// profiling, and chat completions for catalog page extraction. Anything else`
New: `// profiling, and chat completions for catalog page extraction and match comparison. Anything else`
Evidence: probe against the real prompt texts — compare regex true on compare / false on
extraction, extraction regex true on extraction / false on compare; compare uses the same
`llm` (`catalog-match.ts:13-17`, calls :97,:242) → `/v1/chat/completions`
(`@langchain/openai ^0.2.0`, no Responses API path).

**S4.2** `apps/e2e/support/ui.ts` — Old (:14-19):

```ts
const MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
}
```

New:

```ts
const MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
```

**S4.3** `apps/e2e/support/flows.ts` — Old (:4):

```ts
import { chooseFile, fixture, toast, waitForRow } from './ui'
```

New:

```ts
import { chooseFile, fixture, toast, waitForRow, type FilePayload } from './ui'
```

(`expect`, `Page` are imported at :1 and `Owner` at :3; `FilePayload` is exported at
`ui.ts:8`.) Append at end of file:

```ts

type Doc = { id: string; name: string; status: string }

/** Any purchase-order file (CSV, XLSX), through the dialog; resolves once it has parsed. */
export async function uploadPurchaseOrderFile(page: Page, owner: Owner, file: FilePayload, poNumber: string): Promise<string> {
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  await chooseFile(page, 'Upload purchase order', file)
  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(owner.vendorId)
  await dialog.locator('#po-number').fill(poNumber)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Purchase order uploaded')).toBeVisible()
  const row = await waitForRow<Doc>(
    page,
    `/api/workspaces/${owner.workspaceId}/procurement/purchase-orders`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return row.id
}

/** An invoice linked to `purchaseOrderId`, through the dialog; resolves once it has parsed. */
export async function uploadInvoiceFile(
  page: Page,
  owner: Owner,
  purchaseOrderId: string,
  file: FilePayload,
  invoiceNumber: string,
): Promise<string> {
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  await page.getByRole('tab', { name: 'Invoices' }).click()
  await chooseFile(page, 'Upload invoice', file)
  const dialog = page.getByRole('dialog')
  await dialog.locator('#invoice-po').selectOption(purchaseOrderId)
  await dialog.locator('#invoice-number').fill(invoiceNumber)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Invoice uploaded')).toBeVisible()
  const row = await waitForRow<Doc>(
    page,
    `/api/workspaces/${owner.workspaceId}/procurement/invoices`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return row.id
}

/** A goods receipt linked to `purchaseOrderId`, through the dialog; resolves once it has parsed. */
export async function uploadGoodsReceiptFile(
  page: Page,
  owner: Owner,
  purchaseOrderId: string,
  file: FilePayload,
  grnNumber: string,
): Promise<string> {
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  await page.getByRole('tab', { name: 'Goods Receipts' }).click()
  await chooseFile(page, 'Upload goods receipt', file)
  const dialog = page.getByRole('dialog')
  await dialog.locator('#grn-po').selectOption(purchaseOrderId)
  await dialog.locator('#grn-number').fill(grnNumber)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Goods receipt uploaded')).toBeVisible()
  const row = await waitForRow<Doc>(
    page,
    `/api/workspaces/${owner.workspaceId}/procurement/goods-receipts`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return row.id
}
```

**S4.4** New fixtures (exact content):

`apps/e2e/fixtures/grn-split-1.csv`
```
sku,qty received,qty accepted
A1,6,6
B2,2,2
```
`apps/e2e/fixtures/grn-split-2.csv`
```
sku,qty received,qty accepted
A1,4,4
B2,2,1
```
`apps/e2e/fixtures/invoice-semicolon.csv`
```
sku;description;qty;unit price;line total
A1;Widget;10;5.00;50.00
B2;Gadget;4;12.50;50.00
```
`apps/e2e/fixtures/catalog.csv` (no photo URL: the SSRF guard refuses localhost, `catalog.spec.ts:7-10`)
```
sku,description
A1,Widget
B2,Gadget
```
`apps/e2e/fixtures/po.xlsx` — generated, run from the repo root:
```bash
cd apps/api && node -e "const XLSX=require('xlsx');const Papa=require('papaparse');const fs=require('fs');const rows=Papa.parse(fs.readFileSync('../e2e/fixtures/po.csv','utf8'),{header:true,skipEmptyLines:true}).data.map((r)=>({sku:r.sku,description:r.description,qty:Number(r.qty),'unit price':Number(r['unit price'])}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows,{header:['sku','description','qty','unit price']}),'PO');fs.writeFileSync('../e2e/fixtures/po.xlsx',XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true}))"
```
Deterministic (two builds 2.1 s apart: same sha256 prefix `aad7490aa6e53065`, 8714 bytes);
through the processor path it yields A1/Widget/10/5 and B2/Gadget/4/12.5, sheet `PO`.

**S4.5** New `apps/e2e/tests/procurement-core.spec.ts` (full content):

```ts
import { expect, test, type Browser, type Page } from '@playwright/test'
import { uploadGoodsReceiptFile, uploadInvoiceFile, uploadPurchaseOrder, uploadPurchaseOrderFile } from '../support/flows'
import { loadState, storageStateFor, type Role, type SeedState } from '../support/state'
import { bff, fixture, rowFor, toast } from '../support/ui'

// The procurement paths a launch rests on, driven as a person drives them.
// Mutating flows run as owner B in workspace B (docs/ai/testing-strategy.md,
// "The browser harness"). The member probe needs a flag in workspace A - the
// only workspace member A belongs to - so that test seeds A as owner A.

type Flag = {
  id: string
  sku: string | null
  flagType: string
  status: string
  reason: string
  poValue: string | null
  receivedValue: string | null
  invoiceValue: string | null
  comparisonRunId: string | null
  dismissedBy: string | null
}

type Decision = { outcome: string; note: string; actorRole: string; actorEmail: string | null }

let state: SeedState

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

test.beforeAll(() => {
  state = loadState()
})

test.describe('procurement core', () => {
  test('error: a member sees the discrepancy list but no dismiss or decision control', async ({ browser }) => {
    const owner = await pageAs(browser, 'ownerA')
    const ws = state.ownerA.workspaceId
    const purchaseOrderId = await uploadPurchaseOrder(owner, state.ownerA, `core-member-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      owner,
      state.ownerA,
      purchaseOrderId,
      fixture('invoice-mismatch.csv', `core-member-invoice-${state.run}.csv`),
      `INV-CORE-M-${state.run}`,
    )
    const compared = await bff(owner, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    await owner.context().close()

    const page = await pageAs(browser, 'memberA')
    await page.goto(`/workspaces/${ws}/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`)
    // The role badge renders only once membership has loaded, so the absences below are real.
    await expect(page.getByText('member', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review discrepancy A1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dismiss discrepancy A1', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Review discrepancy A1', exact: true }).click()
    const review = page.getByRole('dialog')
    await expect(review.getByText('Only an owner or admin can record a decision on this discrepancy.')).toBeVisible()
    await expect(review.getByRole('button', { name: 'Record decision' })).toHaveCount(0)
    await expect(review.getByRole('textbox', { name: 'Decision note' })).toHaveCount(0)
    await page.context().close()
  })

  test("error: owner B opening workspace A's procurement page is told they are not a member and gets no controls", async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerA.workspaceId
    await page.goto(`/workspaces/${ws}/procurement`)

    await expect(toast(page, 'Failed to load procurement documents')).toBeVisible()
    await expect(page.getByText('Not a member of this workspace', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload purchase order' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Run comparison' })).toHaveCount(0)

    for (const url of [`/api/workspaces/${ws}`, `/api/workspaces/${ws}/procurement/purchase-orders`]) {
      const response = await bff(page, url)
      expect(response.status, url).toBe(403)
      expect(JSON.parse(response.body).message, url).toBe('Not a member of this workspace')
    }
    await page.context().close()
  })

  test('edge: an XLSX purchase order uploads and parses its rows', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId
    const file = fixture('po.xlsx', `core-po-${state.run}.xlsx`)
    const id = await uploadPurchaseOrderFile(page, state.ownerB, file, `PO-CORE-XLSX-${state.run}`)

    const listed = JSON.parse((await bff(page, `/api/workspaces/${ws}/procurement/purchase-orders`)).body) as {
      id: string
      status: string
      rowCount: number | null
    }[]
    expect(listed.find((doc) => doc.id === id)).toMatchObject({ status: 'done', rowCount: 2 })

    await page.reload()
    await expect(rowFor(page, file.name).getByText('Ready')).toBeVisible()
    await page.context().close()
  })

  test('edge: a semicolon-delimited invoice linked to its purchase order parses and compares clean', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId
    const purchaseOrderId = await uploadPurchaseOrder(page, state.ownerB, `core-semi-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('invoice-semicolon.csv', `core-semi-invoice-${state.run}.csv`),
      `INV-CORE-SEMI-${state.run}`,
    )

    const invoices = JSON.parse((await bff(page, `/api/workspaces/${ws}/procurement/invoices`)).body) as {
      id: string
      status: string
      rowCount: number | null
    }[]
    expect(invoices.find((doc) => doc.id === invoiceId)).toMatchObject({ status: 'done', rowCount: 2 })

    // Every quantity and price read correctly through the `;` columns, so the pair agrees exactly.
    const compared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    expect(JSON.parse(compared.body).flags).toEqual([])
    await page.context().close()
  })

  test('happy: PO, invoice and two split receipts compare three-way; a decision with a note dismisses a flag and stays on its run after a re-compare', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId

    const poFile = fixture('po.csv', `core-happy-po-${state.run}.csv`)
    const purchaseOrderId = await uploadPurchaseOrderFile(page, state.ownerB, poFile, `PO-CORE-HAPPY-${state.run}`)
    const invoiceFile = fixture('invoice-mismatch.csv', `core-happy-invoice-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(page, state.ownerB, purchaseOrderId, invoiceFile, `INV-CORE-HAPPY-${state.run}`)
    await uploadGoodsReceiptFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('grn-split-1.csv', `core-grn-1-${state.run}.csv`),
      `GRN-CORE-1-${state.run}`,
    )
    await uploadGoodsReceiptFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('grn-split-2.csv', `core-grn-2-${state.run}.csv`),
      `GRN-CORE-2-${state.run}`,
    )

    // Compare the way a person does: pick the pair, run it, land on its flags.
    await page.goto(`/workspaces/${ws}/procurement`)
    await page.locator('select[aria-label="Purchase order"]').selectOption({ label: poFile.name })
    await page.locator('select[aria-label="Invoice"]').selectOption({ label: invoiceFile.name })
    await page.getByRole('button', { name: 'Run comparison' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${ws}/discrepancies\\?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}$`),
    )

    const rowOf = (sku: string) =>
      page.getByRole('row').filter({ has: page.getByRole('button', { name: `Review discrepancy ${sku}`, exact: true }) })
    await expect(rowOf('A1').getByText('Price mismatch', { exact: true })).toBeVisible()
    await expect(rowOf('B2').getByText('Billed above received', { exact: true })).toBeVisible()

    // A1: accepted 6+4=10 = billed 10 = ordered 10, so only the price (5 vs 6) is flagged.
    // B2: accepted 2+1=3 < billed 4, so it is billed above received.
    const listUrl = `/api/workspaces/${ws}/procurement/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`
    const first = JSON.parse((await bff(page, listUrl)).body) as {
      items: Flag[]
      total: number
      counts: Record<string, number>
    }
    expect(first.total).toBe(2)
    expect(first.counts).toMatchObject({
      price_mismatch: 1,
      invoice_exceeds_received: 1,
      short_receipt: 0,
      quantity_mismatch: 0,
      missing_on_invoice: 0,
      missing_on_po: 0,
    })
    const a1 = first.items.find((flag) => flag.sku === 'A1')!
    const b2 = first.items.find((flag) => flag.sku === 'B2')!
    expect(a1.reason).toBe('Unit price mismatch for A1: PO=5 Invoice=6 (summed across 2 goods receipt lines)')
    expect(b2).toMatchObject({
      flagType: 'invoice_exceeds_received',
      status: 'open',
      poValue: '4',
      receivedValue: '3',
      invoiceValue: '4',
      reason: 'Invoice bills more than was accepted for B2: accepted 3, invoiced 4 (summed across 2 goods receipt lines)',
    })

    // Decide B2 with a note.
    await page.getByRole('button', { name: 'Review discrepancy B2', exact: true }).click()
    const review = page.getByRole('dialog')
    await expect(review.getByText('Three-way', { exact: true })).toBeVisible()
    await review.getByRole('combobox', { name: 'Outcome' }).selectOption('vendor_dispute')
    const note = `Billed 4, accepted 3 across two deliveries (${state.run}).`
    await review.getByRole('textbox', { name: 'Decision note' }).fill(note)
    await review.getByRole('button', { name: 'Record decision' }).click()
    await expect(toast(page, 'Decision recorded')).toBeVisible()
    await expect(review).toHaveCount(0)
    await expect(rowOf('B2').getByRole('button', { name: 'Dismiss discrepancy B2' })).toHaveCount(0)
    await expect(rowOf('A1').getByRole('button', { name: 'Dismiss discrepancy A1' })).toBeVisible()

    // The decision is on the record, attributed to who made it.
    await page.getByRole('button', { name: 'Review discrepancy B2', exact: true }).click()
    const decision = page.getByRole('dialog').getByRole('listitem').filter({ hasText: note })
    await expect(decision.getByText('Vendor dispute', { exact: true })).toBeVisible()
    await expect(decision.getByText(`${state.ownerB.email} (owner)`)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

    // A re-compare appends a run; it never rewrites the one a human decided (D15).
    const recompared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(recompared.status).toBe(201)
    const second = JSON.parse(recompared.body) as { runId: string; flags: Flag[] }
    expect(second.runId).not.toBe(b2.comparisonRunId)
    expect(second.flags).toHaveLength(2)

    const decidedRun = JSON.parse((await bff(page, `${listUrl}&runId=${b2.comparisonRunId}`)).body) as { items: Flag[] }
    expect(decidedRun.items.find((flag) => flag.id === b2.id)).toMatchObject({
      status: 'dismissed',
      dismissedBy: state.ownerB.userId,
    })
    expect(decidedRun.items.find((flag) => flag.id === a1.id)).toMatchObject({ status: 'open' })

    const decisions = JSON.parse(
      (await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/${b2.id}/decisions`)).body,
    ) as Decision[]
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      outcome: 'vendor_dispute',
      note,
      actorRole: 'owner',
      actorEmail: state.ownerB.email,
    })
    await page.context().close()
  })
})
```

Note on the second test: it pins today's toast + absent controls only; B14's fix will add
a forbidden state without breaking it.

**S4.6** New `apps/e2e/tests/catalog-core.spec.ts` (full content):

```ts
import { expect, test, type Browser, type Page } from '@playwright/test'
import { uploadInvoiceFile, uploadPurchaseOrder } from '../support/flows'
import { loadState, storageStateFor, type Role, type SeedState } from '../support/state'
import { bff, chooseFile, fixture, toast, waitForRow } from '../support/ui'

// Catalog upload and match review, driven as a person drives them. The happy
// path runs as owner B in workspace B (docs/ai/testing-strategy.md, "The browser
// harness"). The stub answers the comparison with a fixed verdict
// (stubs/openai-stub.ts), so the reason on screen is the stub's.

let state: SeedState

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

test.beforeAll(() => {
  state = loadState()
})

test.describe('catalog core', () => {
  test('error: a member has no catalog upload or scrape control, and the API refuses the upload', async ({ browser }) => {
    const page = await pageAs(browser, 'memberA')
    const ws = state.memberA.workspaceId
    await page.goto(`/workspaces/${ws}/vendors/${state.ownerA.vendorId}`)
    // The role badge renders only once membership has loaded, so the absences below are real.
    await expect(page.getByText('member', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload catalog' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Scrape website' })).toHaveCount(0)

    // The hidden button is a courtesy; the API is the guard.
    const status = await page.evaluate(async (url) => {
      const form = new FormData()
      form.append('file', new Blob(['sku,description\nA1,Widget\n'], { type: 'text/csv' }), 'member-catalog.csv')
      return (await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' })).status
    }, `/api/workspaces/${ws}/vendors/${state.ownerA.vendorId}/catalogs`)
    expect(status).toBe(403)
    await page.context().close()
  })

  test('happy: a CSV catalog uploads, a PO line search shows the stub verdict with its reason, and dismissing it removes it from the open list', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId

    const catalogFile = fixture('catalog.csv', `catalog-core-${state.run}.csv`)
    await page.goto(`/workspaces/${ws}/vendors/${state.ownerB.vendorId}`)
    await chooseFile(page, 'Upload catalog', catalogFile)
    await expect(toast(page, 'Catalog uploaded')).toBeVisible()
    const catalog = await waitForRow<{ id: string; name: string; status: string; rowCount: number | null }>(
      page,
      `/api/workspaces/${ws}/vendors/${state.ownerB.vendorId}/catalogs`,
      (row) => row.name === catalogFile.name,
      'done',
    )
    expect(catalog.rowCount).toBe(2)

    // A real PO line to search from: its id is only exposed on a discrepancy flag.
    const purchaseOrderId = await uploadPurchaseOrder(page, state.ownerB, `catalog-core-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('invoice-mismatch.csv', `catalog-core-invoice-${state.run}.csv`),
      `INV-CAT-CORE-${state.run}`,
    )
    const compared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    const a1 = (JSON.parse(compared.body).flags as { sku: string | null; poLineItemId: string | null }[]).find(
      (flag) => flag.sku === 'A1',
    )!
    const poLineItemId = a1.poLineItemId!

    // PO-line scope only: the flag row's own link also passes invoiceLineItemId
    // and the list then shows nothing (bug B12, fixed in its own slice).
    await page.goto(`/workspaces/${ws}/catalog-matches?poLineItemId=${poLineItemId}`)
    await page.getByRole('button', { name: 'Search all vendors' }).click()
    await expect(toast(page, 'Search complete')).toBeVisible()
    const summary = await page.getByText(/^\d+ match(es)? found\.$/).textContent()
    const found = Number(summary!.split(' ')[0])
    // 1 on a clean run: catalog.csv holds the only A1 item in workspace B. Kept
    // relative so a CI retry (retries: 1, same database) stays exact.
    expect(found).toBeGreaterThan(0)

    const dismissButtons = page.getByRole('button', { name: /^Dismiss match / })
    await expect(dismissButtons).toHaveCount(found)
    await expect(page.getByText('E2E stub match', { exact: true })).toHaveCount(found)

    const matchId = (await dismissButtons.first().getAttribute('aria-label'))!.replace('Dismiss match ', '')
    await dismissButtons.first().click()
    await expect(toast(page, 'Match dismissed')).toBeVisible()

    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('open')
    await expect(page.getByText('E2E stub match', { exact: true })).toHaveCount(found - 1)
    const open = JSON.parse(
      (await bff(page, `/api/workspaces/${ws}/catalog-matches?status=open&poLineItemId=${poLineItemId}`)).body,
    ) as { id: string }[]
    expect(open.map((match) => match.id)).not.toContain(matchId)
    expect(open).toHaveLength(found - 1)
    await page.context().close()
  })
})
```

Evidence (code read; UI labels exact): procurement page `aria-label` `Purchase order` /
`Invoice`, `Run comparison`, toasts `Purchase order uploaded` / `Invoice uploaded` /
`Goods receipt uploaded` (:257,:300,:338), `Failed to load procurement documents` (:194),
selects `#po-vendor` `#po-number` `#invoice-po` `#invoice-number` `#grn-po` `#grn-number`
(:498-516,:644-688); discrepancies labels `Price mismatch`, `Billed above received`
(:67-78,:329,:341); review modal `Outcome`, `Decision note`, `Record decision`,
`Three-way`, member text (:160,:250-313); vendor page `Upload catalog`, `Scrape website`
(:210,:315-330); catalog-matches `Search all vendors`, `Search complete`,
`${count} match(es) found.`, `Dismiss match ${id}`, `Match dismissed`, `Filter by status`;
`canManage = owner|admin` (procurement :131, discrepancies :137, catalog-matches :87,
vendor :118); `WorkspaceMemberGuard` message (:53) passed through by `proxyJson`. Expected
flags: all `done` receipts summed (`comparison.service.ts:417-431`), mode `three_way`
(:451); A1 accepted 10 = billed 10, price 5 ≠ 6 → `price_mismatch`; B2 4 > 3 →
`invoice_exceeds_received`; reasons `:1408,:1429` + `summedNote` `:1466`; integer
formatting as existing spec `:1695`; `recordDecision` dismisses and sets `dismissedBy`;
re-compare appends (`:548`), list `runId` filter.

S4 validation: `docker compose up -d --wait postgres redis seaweedfs`; root `bun run e2e`
(builds api+web, runs Playwright) ×3; `cd apps/e2e && bunx playwright test
tests/catalog.spec.ts` unchanged and green; `bun run type-check`, `bun run lint`.
Commits: `test(e2e): catalog compare stub route, xlsx MIME and upload helpers`,
`test(e2e): procurement core browser flows (launch hardening S4)`,
`test(e2e): catalog core browser flows`.

### B-slices — confirmed bug fixes (after S4; each its own task)

Per the Canonical Task Flow, a bug never gets code before its RCA is approved
(`docs/ai/prompts/bugfix-rca.md`). For each B-item, in this order (user impact first):
B2+B3 (one slice: zero-row result must fail with a reason), B1, B12, B7, B13, B5, B6+B15,
B8, B9, B10, B14, B4, B11:
1. `/investigate` → RCA doc using the evidence above as the starting repro → STOP for
   owner approval (node `E`).
2. Fix plan per `docs/ai/planning.md` with literal blocks → STOP for approval (node `R`).
3. Branch `fix/no-ticket-<b-name>` from `origin/main` (after S1–S4 merge) →
   RED with `bun run tdd:red` (error/edge/regression first) → fix → all three layers
   where touched → `/review` → handoff.
These are separate approved tasks; nothing in S1–S4 depends on them.

## Validation and acceptance

| Layer | Required? | Files | Cases |
|---|---|---|---|
| unit (Jest api) | yes | column-mapping, procurement-parse.processor, comparison.service, catalog-parse.processor, catalog-image.service, catalog-match.service specs | S1.1, S1.2, S2.1, S3.1, S3.2, S3.3 |
| unit (Vitest web/ui/ai/db) | not required — no code in those packages changes | — | — |
| script tests | not required — tooling unchanged | — | — |
| API e2e | yes | procurement.e2e-spec.ts, catalog.e2e-spec.ts | S2.2, S3.4 |
| browser e2e | yes | procurement-core.spec.ts, catalog-core.spec.ts | S4.5, S4.6 |

Acceptance map:
- Every new title is a literal with a valid prefix, declared in order → per-file review +
  CI `bun run tdd:gate` (titles) on each PR.
- Every D-item has ≥1 pinning test: D1/D9 S1.1; D8/D10/D12/D13 S1.2; D2 S4.5 (A1 5 vs 6 flagged, no tolerance) + S2.1
  (5.0000 = 5.00 is not a difference);
  D4/D5/D6/D7/D14 S2.1; D15 S4.5; D3 existing UOM titles; D11 S2.1 "a second invoice billing
  the full order again …" (an identical second invoice is accepted and compared clean).
- No guarded source in any diff → `git diff --stat` per slice.
- All suites green locally ×3 and on CI → `gh pr checks <number>`.
- B1–B15 recorded in `docs/ai/risk-register.md` with evidence.

**Verified by execution during planning (2026-10-02, live local stack, Node 22.15.0,
throwaway worktree of `origin/main` @ `fd21b75`, blocks applied verbatim from this plan
by script):**
- S1: `column-mapping.spec.ts` + `procurement-parse.processor.spec.ts` → 78/78 passed.
- S2: `comparison.service.spec.ts` → 113/113 passed (13 new, `-t "launch hardening"`);
  `procurement.e2e-spec.ts` on fresh `optra_e2e` → 34/34 passed (9 new).
- S3: three catalog unit specs → 44/44 passed (12 new); `catalog.e2e-spec.ts` → 7/7 (4 new).
- Bug probes on the real DB: B1 → `[["A1",2],["A3",3]]` (A3 is spreadsheet row 4);
  B2/B3 → `utf16.csv`, `semi2.csv`, `header-only.csv`, `empty.csv`, `png.csv` each
  `done 0 null`.
- S4 (Playwright, real Chromium → production web + API builds → Postgres/Redis/SeaweedFS,
  OpenAI stub with the S4.1 branch, fixtures from S4.4 incl. the generated `po.xlsx`,
  sha256 prefix `aad7490aa6e53065` as predicted): `procurement-core.spec.ts` 5/5,
  `catalog-core.spec.ts` 2/2, existing `catalog.spec.ts` 2/2 unchanged + setup → **10/10
  passed** (15.3 s).
- Catalog bug probes on the real stack: B4 → `[[1,"A1","Widget"],[2,null,null],[3,"B2","Gadget"]]`;
  B5 (final attempt) → `failed`, `lastError` = `value too long for type character varying(200)`;
  B13 → `GET vendors/not-a-uuid`, `/catalogs`, `/price-terms`, `/price-history`,
  `/exception-summary` each `500 {"statusCode":500,"message":"Internal server error"}`.
- Not executed by probe (evidence is code + library behaviour, cited in the B-table):
  B6/B15 (`Promise.all` + error text), B7 (Bull `pTimeout` + 20 s × N photos), B8 (busboy
  probe), B9–B11 (DuckDB probe of the real SQL), B12 (UI link trace), B14 (UI trace).
- Every planned test passed on first run; no expected value in this plan had to change.

**Environment blockers found while verifying (execution preflight must handle):**
1. Disk: at 98% full (12 GiB free) a Next build worker exited 1 and the worktree's
   `node_modules` was emptied mid-run; at 94% (27 GiB free) everything built and ran.
2. The primary checkout's `node_modules` predates the lockfile (no `@playwright/test`,
   no `@swc/cli`); and bun's cache extracted some packages empty (`chalk/` with no files).
   Preflight is therefore `bun install --frozen-lockfile --force` (the repair documented in
   `docs/ai/testing-strategy.md`), then confirm `node_modules/.bin/{jest,playwright}` exist.
3. `turbo` appends a "turborepo-agent-rules" block to `AGENTS.md` whenever it detects an
   agent. That file is outside every slice's file list: after any `turbo` command run
   `git diff --stat AGENTS.md` and restore it with `git checkout -- AGENTS.md` before
   committing (opting out via `turbo.json` `agentGuidance` is a config change needing the
   owner's approval, so it is not in this plan).

## Docs, compatibility, scans

- Docs sync (each slice, same change): `docs/ai/testing-strategy.md` dated note listing what
  the slice pins and the spec-file counts (Playwright 10 → 12 after S4);
  `docs/ai/risk-register.md` new row "Real-world input policy (D1–D15)" + "Launch-hardening
  bugs (B1–B15)" with evidence and slice order; `docs/ai/file-index/repository-map.md` (S4:
  `uploadPurchaseOrderFile`, `uploadInvoiceFile`, `uploadGoodsReceiptFile`, stub compare
  route, new fixtures, two specs); `learnings.md` one entry per slice (Predicted line taken
  from this plan: "test-only slices land green with zero guarded-source change").
- Contracts: `No contract impact` (API and DB).
- Backward compatibility: no product code changes; existing tests untouched (append-only).
- Optimisation scan: not worth it, left as-is. Cache scan: not applicable.
- DB/LLM cost: none in production; tests use stubs; no OpenAI spend.
- Approved plan saved to `docs/plans/core-launch-hardening.md` in the S1 branch before any
  test is written.
- Residual risk outside scope: disabled support surfaces' API + BFF stay reachable (risk
  register "Disabled Support Surfaces").
