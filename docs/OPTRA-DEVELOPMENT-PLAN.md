# Optra Development Plan

**Product direction:** evidence-backed accounts-payable control for hardware companies
**Status:** Revision 4. Slices S0a–S2 are implementation-ready. Every later slice is gated on its own approved two-layer plan (CLAUDE.md Plan Contract).
**Prepared:** 2026-09-16 (rev 3) · **Revised:** 2026-09-20 (rev 4)
**Code baseline:** `main` at commit `469317ec9c9d2ca02d4ae0572b5fedc4568af3f2`. Rev 3 of this file was committed on top of it as `bf6d38d8ddb07f9aabe1926bca14b113e53a6c9b` (docs only). Rev 4 was verified against `bf6d38d`, which matched `origin/main` (`git ls-remote`) on 2026-09-20.
**Planning constraint:** this file is a plan. Every code change needs its own slice plan and explicit approval.

**Coverage statement:** rev 4 re-verified every rev 3 claim against source, and ran a second exhaustive pass over procurement, catalog, limits, web, queue, deployment, configuration, and documentation surfaces. Every new finding cites `path:line`. Anything whose outcome depends on runtime engine behavior is labeled **STATIC-ONLY**. Customer workflow truth does not exist for this project (see §0), so rev 3's customer gate is replaced by an owner-set policy (§2).

### What changed in revision 4

- **Gate 0 resolved.** Optra is a personal portfolio project with no external customers (`CLAUDE.md:39`), so the customer, design-partner, and tax/legal evidence that rev 3 required will never arrive. The owner-set **Reference AP Policy v1** (§2) replaces it. Every rule in it is versioned and can be overridden.
- **Factual corrections.** Rev 3 was wrong on the SHA, tracked-file count, table/enum counts (31 tables, 19 enums; `scrape_runs` was missing), the XLSX overwrite rationale, the module list, the flag model, and deploy behavior. See §3 and Appendix A.
- **22 verified defects added** (B1–B22 in §4). Rev 3 did not list them. They include:
  - re-compare deleting human dismissals;
  - silent truncation of comparison output at 500 rows;
  - dead Bull retries;
  - LLM calls that bypass the token budget.
- **Executable slice plan** (§5), in dependency order with size classes, allowed-file seams, and acceptance tests.
- **Disposition ledger filled** (§9). Rev 3 §19.13/§20.4 had required this before implementation could start.
- **Restructured.** The main body is decision-ready.
  - These rev 3 sections are **rewritten in place**, because rev 4 supersedes them: §0–§2, §15 Rollout (now §8.1), §16–§17 (now §10), and the final recommendation.
  - All other rev 3 text is **retained**, with corrections: §3–§14 in §2.4 and §3–§13, and §18–§20 plus the receiving-exceptions section in Appendices A–D.

## 0. Executive summary

Narrow Optra's product spine to:

`PO + receiving evidence + supplier invoice + approved price evidence`
`→ normalize → match → verify evidence → exception queue → human decision → audit trail`

**What works today (FACT):**
- Upload PO/invoice files as CSV, XLSX, or feature-gated PDF.
- Parse them into line items on a Bull queue.
- Run a manual two-way PO↔invoice comparison.
- List and dismiss discrepancy flags.
- Ingest vendor catalogs.
- Manually request catalog matches.

**What does not exist (FACT):**
- receiving/GRN evidence;
- provenance below raw-row granularity;
- versioned pricing;
- persistent UOM;
- comparison runs, meaning result history;
- decision history or audit trail;
- automatic post-upload comparison;
- LLM cost controls on procurement and catalog.

**What is broken today (FACT, §4):**
- Re-running a comparison deletes human dismissals.
- Comparison output is silently capped at 500 rows.
- Delete-then-insert writes are not atomic.
- Parse retries never fire.
- Several LLM paths bypass the monthly token budget that CLAUDE.md declares as an invariant.

**Recommendation.** First fix the verified integrity defects (S0a–S0f). Then build the evidence and decision spine (S1 comparison runs → S2 decisions/audit → S3 provenance/UOM → S4 source evidence → S5 Goods Receipt → S6 three-way → S7 review queue → S8 orchestration). Messaging, tax, ERP, and payment stay deferred, with a recorded reason for each (§9).

**Operational constraint that shapes every slice (FACT, §3.11):**
- Every push to `main` deploys to the production VPS with no test gate.
- The API container applies migrations forward-only on startup.

So each slice must be migration-additive, dark-launched behind a global env flag that defaults off, and pushed only with explicit owner approval.

## 1. Planning rules

This document uses these labels:

- **FACT**: verified from repository source, tests, configuration, or observed command output, with `path:line`.
- **PROPOSED**: a recommended product or engineering decision that is not implemented yet.
- **POLICY v1**: an owner-set business rule adopted in place of unavailable customer evidence (§2). It is binding for implementation. Override it when real customer evidence exists, and treat that override as its own plan revision.
- **STATIC-ONLY**: code behavior was read, but the runtime outcome depends on an engine or library default that was not executed. Confirm it with a test before relying on it.
- **UNVERIFIED DEPENDENCY**: a required input that neither the code nor POLICY v1 settles. Stop and resolve it before implementing.

Hard stops (unchanged from rev 3, with two added):

1. Do not design schema around invented customer document fields. POLICY v1 fields are the declared contract, and nothing beyond them may be assumed.
2. Do not treat an LLM score as an approval decision.
3. Do not claim three-way matching until receiving evidence is modeled and tested (S5 + S6).
4. Do not add tax, messaging, ERP, or payment behavior without validated contracts and acceptance fixtures.
5. Do not run production migrations from `db:push`. Use reviewed Drizzle migrations (`packages/db/package.json:12` still defines `db:push`, and no deploy path calls it).
6. Do not expose raw document contents in logs, URLs, client-visible errors, or model prompts beyond the approved data-processing policy.
7. **(new)** Every schema change must be additive and must not break the previous deploy, because migrations run automatically on API start (`apps/api/Dockerfile:99`) and no down migrations exist.
8. **(new)** No push to `main` without explicit owner approval. `.github/workflows/deploy.yml:4-6` deploys every push.

## 1a. Requirements restated

The requested outcome is a full development plan for the existing Optra codebase, grounded in exhaustive inspection rather than assumptions, delivered as one revisable Markdown file.

The product outcome being planned:

- A hardware-company team uploads procurement evidence (PO, Goods Receipt, supplier invoice).
- Optra extracts structured records and keeps source provenance.
- Optra compares ordered, received, invoiced, and approved-price values.
- Optra surfaces only explainable exceptions.
- A human reviews the evidence, records a decision, and leaves an auditable trail.
- Vendor history and operational insight build up from reviewed outcomes.

## 2. Reference AP Policy v1 (replaces rev 3 Gate 0)

**Why this exists.** Rev 3 §5 blocked all Phase 1 schema work until customer documents, process answers, and professional sign-off arrived. `CLAUDE.md:39` records that Optra is a "personal portfolio project shown to interviewers" with "no external customers". Rev 3 §20.5 noted this but did not resolve it, so every P1 item stayed `BLOCKED BY EXTERNAL INPUT` with no way to exit.

**Decision (owner, 2026-09-20):** the owner sets the business rules below as **POLICY v1**. They are the contract implementation builds against. Each rule is versioned and must be implemented so it can change later, through configuration or an additive schema field rather than a hard-coded assumption. If a real customer's evidence ever arrives, it overrides a rule through a new plan revision.

### 2.1 Policy table (answers rev 3 §5.2)

| # | Rev 3 §5.2 question | POLICY v1 answer | Enforced in |
|---|---|---|---|
| 1 | Receiving artifact | A generic **Goods Receipt (GRN)** document. It is uploaded as CSV/XLSX/PDF through the same intake as PO and invoice. Each line carries SKU, description, qty received, qty accepted, qty rejected, and UOM. | S5 |
| 2 | PO/receipt/invoice linkage | **Explicit only.** When uploading an invoice or GRN, the user selects the PO. A PO number extracted from the header is shown as advisory and never auto-links. No fuzzy auto-linking. | S3, S5 |
| 3 | Vendor identity | The PO header carries an explicit `vendorId` chosen from the workspace's existing `vendors` rows. Invoice and GRN inherit the linked PO's vendor. No alias resolution in v1. | S3 |
| 4 | UOM policy | UOM is **captured, never converted**. If two compared lines have different UOMs, the result is `needs_review` and no delta is computed. | S3, S6 |
| 5 | Authoritative price | The **approved PO unit price**. Catalog prices are discovery evidence only. Versioned contract prices come in S9. | S1, S9 |
| 6 | Tiers/currency/tax/freight/discounts | Out of scope for v1 comparison. A currency mismatch between compared documents gives `needs_review`. Tax, freight, and discount lines compare as ordinary lines only when their match key matches. | S1 |
| 7 | Reviewer decisions | Append-only decisions with outcome `false_positive`, `approved_exception`, `vendor_dispute`, or `resolved`, and a required free-text note. The existing `PATCH …/discrepancies/:flagId/dismiss` is kept and records `false_positive`. | S2 |
| 8 | Audit visibility | Each decision row is immutable and records actor, role, outcome, note, timestamp, and comparison run id. Rows are listed newest first. | S2 |
| 9 | Retention/export/deletion | A procurement document referenced by any comparison run cannot be hard-deleted. `ProcurementDocumentsService.remove()` stays unexposed; its only callers are specs (`procurement-documents.service.spec.ts:141,156`). Export is deferred. | S1, §9 |
| 10 | Messaging | Not required. Deferred with reason (§9). | — |
| 11 | Deployment/runtime | The existing single-VPS Docker Compose topology (`docker-compose.prod.yml`), with processors running inside the API process. A worker split is deferred until B11 is resolved. | S0e, §9 |
| 12 | Tax (BIR/EWT/VAT) | Out of scope. Deferred with reason (§9). | — |
| 13 | Comparison tolerance | **Exact match**, as today (`comparison.service.ts:61-62` uses `IS DISTINCT FROM`). A workspace-level tolerance setting is deferred. | S1 |
| 14 | Multiple receipts per PO | Accepted qty is **summed across every GRN linked to the PO**. With no linked GRN, the run is labeled `two_way`. A missing GRN is never read as zero received. | S6 |
| 15 | Roles | Unchanged. Owner/admin upload, compare, and decide (`procurement.controller.ts:104-105,121-122,138-139,151-152`). Members read (`:115,132,145`). No new roles in v1. | all |

### 2.2 Fixture set (replaces rev 3 §5.1 customer samples and §5.3 benchmark)

**FACT:** the repository tracks no procurement sample documents.
- There are no `.pdf`, `.xlsx`, or `.csv` files under git.
- The seed builds synthetic rows with `storageKey: null` (`scripts/seed/data/procurement.ts`).
- The e2e suite uses inline CSV strings and fake `%PDF-1.4` buffers (`apps/api/test/procurement.e2e-spec.ts`).

POLICY v1 therefore requires a committed, synthetic hardware-supplier fixture set. The first slice that needs a case creates it, and later slices extend it.

- **Document types and formats:** PO, invoice, and GRN, each as CSV, as XLSX (including a multi-sheet workbook), and as a text-layer PDF.
- **Line cases to cover:**
  - exact match
  - quantity short
  - over-billed
  - price variance
  - duplicate SKU
  - SKU on one side only
  - blank SKU with a description
  - blank SKU and blank description
  - leading-zero numeric SKU
  - UOM mismatch
  - currency mismatch
  - more than 500 lines
- **Golden outputs:** every fixture has an expected output, meaning its parsed lines and its comparison result for each mode.
- **Benchmark:** record these metrics on the fixture set before any matching or extraction threshold is adopted: field precision/recall, false and missed discrepancy rate, processing time, and model cost.

### 2.3 Exit criteria (replaces rev 3 "Gate 0 exit criteria")

A slice that depends on a POLICY v1 rule may start when all three hold:
- The rule is written here.
- The fixtures it needs exist, or will be the slice's first failing tests.
- Its implementation is configurable, not hard-coded, wherever §2.1 says the rule can be overridden.

Rev 3's customer-evidence gate is kept as the override path for a future real customer. The original rev 3 Gate 0 text is retained verbatim in §2.4.

### 2.4 Rev 3 Gate 0 text (retained as the override path)

*Retained unchanged from rev 3 §5. It no longer blocks implementation: POLICY v1 (§2.1–§2.3) answers it. Use it only if a real customer engagement starts, as the evidence checklist for overriding POLICY v1.*

No final target schema or external integration should be approved before this gate.

#### 5.1 Required customer evidence

**UNVERIFIED DEPENDENCIES:** obtain representative, redacted or consented samples for:

- PO: CSV, XLSX, text PDF, scanned PDF, and at least one real layout variation.
- Supplier invoice: same variation set.
- Delivery Receipt / Goods Received Note / receiving record: identify which is authoritative per customer.
- Vendor catalog or contract price list: include pricing, UOM, currency, validity, and revision examples.
- Credit/debit note or partial-delivery example if the customer handles them.

Record for each sample:

- page/sheet count;
- line count;
- header and reference fields;
- vendor identity fields;
- PO/invoice/receiving linkage fields;
- quantity and UOM representation;
- tax/freight/discount representation;
- acceptable extraction error tolerance;
- expected human decision.

#### 5.2 Required process answers

Resolve, in writing:

1. Is the receiving artifact a DR, GRN, warehouse receipt, ERP transaction, or another record?
2. Which field links PO, receiving record, and invoice when numbers are absent or inconsistent?
3. How is vendor identity resolved across name changes, branches, and aliases?
4. What is the customer’s UOM policy? Are conversions allowed? Who approves corrections?
5. Which price is authoritative: contract, negotiated net, approved PO, catalog/list, or another source?
6. How are tiered prices, currency, tax, freight, discounts, rebates, and effective dates treated?
7. What decisions can AP make? What requires procurement, receiving, or finance approval?
8. What statuses and reasons must be visible in audit history?
9. What retention, export, deletion, and audit requirements apply to documents and decisions?
10. Is messaging actually required, and which channel is used by real users?
11. What deployment/runtime owns PostgreSQL, object storage, queues, and secrets?
12. Has a tax professional validated any BIR/EWT/VAT workflow?

#### 5.3 Extraction benchmark

Run the current implementation against the agreed sample set before changing it. Capture per document and per line:

- field precision/recall for SKU, description, quantity, UOM, unit price, total, currency, and references;
- missing-field rate;
- incorrect-field rate;
- line association errors;
- duplicate-line errors;
- false discrepancy rate;
- missed discrepancy rate;
- processing time and model cost;
- human correction time.

**Gate 0 exit criteria:**

- representative documents are available;
- target receiving artifact and linkage rules are accepted;
- pricing/UOM/decision semantics are accepted;
- baseline benchmark report exists;
- customer agrees on a small set of golden expected outcomes;
- security/data-processing constraints are documented;
- schema and API design can be reviewed against real evidence.

If any item is missing, mark the dependency unresolved and do not freeze the Phase 1 schema.

## 3. Verified repository baseline

### 3.1 Repository and package structure

**FACT:** the repository is a Bun/Turbo monorepo with workspaces under `apps/*` and `packages/*` (`package.json`).

Relevant packages:

| Area | Location | Verified role |
|---|---|---|
| Web app | `apps/web` | Next.js 14 / React 18 product UI and web BFF proxy routes |
| API | `apps/api` | NestJS API, Bull queues/processors, storage, extraction orchestration |
| Database | `packages/db` | Drizzle schema, migrations, database client |
| AI | `packages/ai` | OpenAI/LangChain extraction, catalog matching, vector/web utilities |
| UI | `packages/ui` | Shared shadcn/Tailwind components |
| Types | `packages/types` | Small shared type surface; no canonical procurement domain model |

**FACT:** root README content is stale and still describes the older “Mnemra” knowledge-management/RAG product. It is not a reliable description of current procurement behavior. Source code, migrations, tests, and relevant Optra documents are stronger evidence.

### 3.2 Current application modules

**FACT:** `apps/api/src/app.module.ts:26-61` imports 19 modules: `ConfigModule`, `BullModule`, `ThrottlerModule`, and 16 feature modules including `AuthModule`, `WorkspacesModule`, `StorageModule`, `ProcurementModule`, and `CatalogModule`. *(Corrected in rev 4. Rev 3 listed "structured query" and "AI" modules. `StructuredQueryModule` is imported only indirectly, via `ProcurementModule` and `ChatModule`. There is no AI module: `@repo/ai` is a package.)* All 15 `@Processor` classes, procurement and catalog included, run in the API process.

**FACT:** current relevant web navigation is defined in `apps/web/src/components/workspace-nav.tsx:13-24` and includes Vendors, Purchase Orders, Discrepancies, and Catalog Matches. The primary mobile tabs remain Overview, Chat, and Knowledge (`:30-32`).

### 3.3 Current procurement workflow

**FACT:** current user flow:

1. Owner/admin uploads a PO or invoice.
2. API stores the file in workspace-scoped object storage and creates a document header.
3. A Bull job parses CSV/XLSX/PDF content into line items.
4. User waits for both documents to become ready.
5. User manually selects one PO and one invoice.
6. User presses compare.
7. DuckDB compares the two exported line-item CSVs.
8. Discrepancy flags appear.
9. User may open Catalog Matches and manually search/verify candidate items.

Evidence:

- Upload/list/compare/dismiss routes: `apps/api/src/procurement/procurement.controller.ts:32-158`.
- Upload/storage/list behavior: `apps/api/src/procurement/procurement-documents.service.ts:22-100`.
- Parse queue lifecycle: `apps/api/src/procurement/procurement-parse.service.ts:29-155`.
- Parse processor and replace behavior: `apps/api/src/procurement/procurement-parse.processor.ts:35-210`.
- Manual comparison: `apps/api/src/procurement/comparison.service.ts:24-280`.
- Manual web selection and compare action: `apps/web/app/workspaces/[id]/procurement/page.tsx:226-251`.

### 3.4 Current extraction behavior

**FACT:** supported procurement upload extensions are `.csv`, `.xlsx`, and `.pdf`; maximum upload size defaults to 25 MB; PDF extraction is feature-gated (`apps/api/src/procurement/procurement.controller.ts:32-93`).

**FACT:** CSV is mapped directly. XLSX is converted from the first sheet. PDF extraction first tries text extraction; if insufficient text exists, it renders up to the configured page limit and sends page images to the model (`packages/ai/src/chains/procurement-extraction.ts:110-143`).

**FACT:** extraction normalizes numeric values and allows nullable fields. Confidence is nullable and bounded to 0–1. It is stored only inside the `rawRow` jsonb, because `procurement-parse.processor.ts:85` spreads the extracted item there; it is not a typed column. Source page and field coordinates are not persisted (`packages/ai/src/chains/procurement-extraction.ts:146-213`).

**FACT:** static column aliases exist for SKU, description, quantity, unit price, and total (`apps/api/src/procurement/column-mapping.ts:9-47`).

**FACT:** the current upload service classifies every non-PDF upload as `sourceKind: 'csv'` (`apps/api/src/procurement/procurement-documents.service.ts:22-31`). During XLSX parsing, the processor converts the first sheet to CSV and overwrites the original object at the same `storageKey` (`apps/api/src/procurement/procurement-parse.processor.ts:89-103`). *(Corrected in rev 4. Rev 3 said this exists because the DuckDB comparison reads CSV. It does not: comparison builds its CSVs from DB rows (`comparison.service.ts:109,121`), and the only storage read is `procurement-parse.processor.ts:71`. The code comment at `:93-94` is stale.)* The overwrite destroys the original XLSX bytes before the parse commits (`:95` runs before `:105`), and it mixes up the source format with the derived parse format. The current implementation therefore cannot support immutable source evidence, original-format download, or revision-safe reprocessing for XLSX without a storage/model change.

**Required fix (S0b):** stop the overwrite. No derived artifact is needed, because nothing reads one. Record the true original format in `sourceKind`. Parser/version provenance comes in S3.

### 3.5 Current comparison behavior

**FACT:** comparison is a fixed two-way DuckDB query. It full-outer-joins on lowercase/trimmed SKU or falls back to description, and flags only:

- quantity mismatch;
- price mismatch;
- missing on invoice;
- missing on PO.

Evidence: `apps/api/src/procurement/comparison.service.ts:24-68` and `:228-280`.

**FACT:** comparison requires both documents to be `done`, writes temporary CSVs, deletes previous flags for the same pair, and inserts new flags (`comparison.service.ts:105-172`). There is no comparison-run entity or historical run result.

**FACT:** mismatch values are based on PO and invoice values only. Receiving quantities, accepted quantities, contract rates, taxes, freight, currency conversion, partial receipts, duplicate lines, and explicit unknown states are not represented.

**FACT:** `ComparisonService` validates each parent document against `workspaceId`, then loads child line items using only `purchaseOrderId` or `invoiceId` (`apps/api/src/procurement/comparison.service.ts:105-110`). The parent checks prevent a normal cross-workspace comparison through the current route, but the child reads do not repeat the denormalized `workspaceId` predicate. This is a defense-in-depth and data-integrity gap, not proof of a current data leak; new code and regression tests must enforce both parent relationship and workspace scope.

### 3.6 Current database model

**FACT:** schema exports are centralized in `packages/db/src/schema/index.ts:22-30`.

| Table | Verified current fields/capability | Material absence for target product |
|---|---|---|
| `purchase_orders` | workspace, name, PO number and currency (columns exist, but only the seed writes them — rev 4), storage key, source kind, parse lifecycle, row count/error | vendor relation, provenance, terms, receiving links |
| `invoices` | workspace, invoice number and currency (columns exist, but only the seed writes them — rev 4), storage key, source kind, parse lifecycle | vendor relation, tax/terms, receiving links, provenance |
| `po_line_items` | SKU, description, quantity, unit price, line total, raw row, source kind | UOM, normalized values, evidence coordinates, extraction confidence, contract reference |
| `invoice_line_items` | SKU, description, quantity, unit price, line total, raw row, source kind | UOM, normalized values, evidence coordinates, extraction confidence, contract reference |
| `discrepancy_flags` | four flag types, open/dismissed status, PO/invoice values, delta, reason, dismiss metadata | receiving/contract deltas, comparison run, evidence, decision, audit, confidence calibration |
| `vendors` | workspace, name, contact info | tax identity, aliases, terms, price history, operational history |
| `catalogs` | vendor, source kind, storage/crawl lifecycle | effective pricing, contract/list semantics, currency/UOM validity |
| `catalog_items` | SKU, description, photo key, source page, raw row | price version, UOM, effective date, source/provenance model |
| `catalog_matches` | query line, catalog item, vendor, score, boolean match, reason, dismissed state | match run, calibrated confidence, evidence type, reviewer decision |

Source files:

- `packages/db/src/schema/purchaseOrders.ts:16-43`
- `packages/db/src/schema/invoices.ts:9-33`
- `packages/db/src/schema/poLineItems.ts:8-32`
- `packages/db/src/schema/invoiceLineItems.ts:5-29`
- `packages/db/src/schema/discrepancyFlags.ts:9-56`
- `packages/db/src/schema/vendors.ts:4-19`
- `packages/db/src/schema/catalogs.ts:12-43`
- `packages/db/src/schema/catalogItems.ts:8-30`
- `packages/db/src/schema/catalogMatches.ts:13-47`

**FACT:** recent schema changes are numbered Drizzle migrations, including `packages/db/drizzle/0020_bumpy_energizer.sql` and `0021_dear_speed_demon.sql`. Future schema changes must preserve this migration convention.

### 3.7 Current catalog and visual-match behavior

**FACT:** catalog upload/scrape/search/verify/dismiss/photo routes exist in `apps/api/src/catalog/catalog.controller.ts:107-208`.

**FACT:** catalog PDF pages are rendered and page images assigned to extracted items; CSV/XLSX rows can fetch `photo_url`. Catalog ingestion currently stores no price model (`apps/api/src/catalog/catalog-parse.processor.ts`).

**FACT:** catalog matching is manual and per query line. The service finds up to `CATALOG_MATCH_MAX_CANDIDATES` candidates, default 8, then runs text/vision judgment in parallel (`apps/api/src/catalog/catalog-match.service.ts:30-80`, `:196-228`).

**FACT:** no automatic post-upload match worker exists. `apps/api/src/catalog/catalog.module.ts:18-19` registers parse and scrape queues, but no match queue.

**FACT:** model output is boolean match, 0–1 score, and reason (`packages/ai/src/chains/catalog-match.ts:177-181`; out-of-range scores become null at `:299-304`). There is no calibration dataset or proven threshold. The current score must not be treated as approval authority.

### 3.8 Current web experience

**FACT:** the procurement page loads unbounded PO/invoice lists and polls every three seconds during processing (`apps/web/app/workspaces/[id]/procurement/page.tsx:62-155`).

**FACT:** current page copy and controls describe “Purchase orders & invoices” and a manual compare-pair flow (`procurement/page.tsx:283-459`).

**FACT:** the discrepancy page displays aggregate stats and a table, supports dismiss, and links to Catalog Matches (`apps/web/app/workspaces/[id]/discrepancies/page.tsx:88-260`). It has no evidence drawer, receiving view, human-decision vocabulary, or review queue.

**FACT:** Catalog Matches receives a query line through URL parameters and provides manual search/verify/dismiss (`apps/web/app/workspaces/[id]/catalog-matches/page.tsx:50-61`, `:157-365`). There is no arbitrary line-picker workflow because the backend does not expose one.

**FACT:** no procurement-specific source-document download/view route exists in `apps/api/src/procurement`, `apps/web/app/api`, or `apps/web/src/lib/api/procurement.ts`. The existing binary download patterns are for generic knowledge-base documents and ticket transcripts, not PO/invoice records. A future evidence drawer cannot be complete until authenticated, workspace-scoped procurement source access is designed.

### 3.9 Auth, tenancy, storage, and jobs

**FACT:** web BFF routes forward the `mnemra_at` cookie as a Bearer token to the API. Procurement and catalog routes use workspace-scoped controller paths.

**FACT:** procurement upload/compare/dismiss require owner/admin; list/read operations allow members (`procurement.controller.ts:103-158`). Catalog follows owner/admin restrictions for mutation and member access for reads (`catalog.controller.ts:97-218`).

**FACT:** services commonly enforce workspace predicates and workspace existence checks. Example: `apps/api/src/catalog/catalog-match.service.ts:118-139` and `apps/api/src/catalog/catalog-documents.service.ts:80-96`.

**FACT:** storage keys are workspace-scoped and use S3-compatible storage (`apps/api/src/storage/storage.service.ts:37-97`).

**FACT:** parse jobs use deterministic IDs, three attempts, exponential backoff, and timeouts; queue reconciliation marks stale jobs failed (`procurement-parse.service.ts:29-155`, `catalog-parse.service.ts:24-128`). These are reusable patterns for later match orchestration.

**FACT:** no Telegram, Viber, procurement webhook, or JWT deep-link implementation was found in repository search on 2026-09-15.

**FACT:** `ProcurementDocumentsService.remove()` can delete a PO/invoice object and header (`apps/api/src/procurement/procurement-documents.service.ts:75-100`), but `ProcurementController` exposes no delete route and the procurement web client exposes no delete function. This is currently unreachable through the procurement API/UI. Before adding audit-bearing financial evidence, decide whether deletion is an approved retention operation, an internal-only seam to revise, or a behavior to retire after import/reference analysis; do not silently expose it.

### 3.10 Existing test and build baseline

Observed during planning on 2026-09-15:

| Check | Result | Interpretation |
|---|---|---|
| `bun run type-check` | PASS, Turbo 6/6 | Current type baseline passes |
| `bun run lint` | PASS, 6/6 | Two existing warnings: conditional hook dependency in catalog-matches page; raw `<img>` in brand mark |
| `bun run build` | PASS, 6/6 | Current production build passes; same warnings |
| `bun run --cwd apps/web test` | PASS, 124 files / 511 tests | Web baseline passes in this environment |
| `bun run --cwd packages/db test` | PASS, 1 file / 12 tests | DB package baseline passes in this environment |
| `bun run --cwd packages/ui test` | PASS, 11 files / 91 tests | UI package baseline passes in this environment |
| `bun run --cwd packages/ai test` | BLOCKED/FAIL | DB-backed tests could not reach `localhost:54322`; crawl tests could not resolve `example.com`; barrel test timed out |
| `bun run --cwd apps/api test` | BLOCKED/FAIL | 40 suites failed / 19 passed; repeated DB connection failures at `localhost:54322`; storage tests also lacked S3 service |
| `docker compose ps` | BLOCKED | Docker daemon socket unavailable in this environment |
| API e2e suite | NOT RUN | Declared in repository docs; service-backed verification remains unverified |

**Important:** the API/AI failures do not prove product regressions. They prove that the required database, S3, and network-backed test dependencies were unavailable for this planning run. Do not claim the complete suite is green. *(Rev 4: the last recorded full-suite green run, 1273 tests on 2026-08-18, is in `docs/ai/testing-strategy.md:66`. See §7.7–§7.8 for the local service setup.)*

Relevant test documentation: `docs/ai/testing-strategy.md`. Relevant production-readiness evidence: `docs/PRODUCTION-READINESS.md`, with source verification required where the document is stale.

### 3.11 Deployment, migration, and flag behavior (new in rev 4)

**FACT:**
- **Deploy trigger.**
  - *(Baseline `469317e`, all four now superseded by S0d — see the corrected list below.)* `deploy.yml:4-6` ran on every push to `main`; `:9-10` set `group: deploy-production` with `cancel-in-progress: true`; it was the only workflow file; it had no `paths-ignore`.
  - **As of S0d (`2058cef`):** `deploy.yml` is still the only workflow file, but it now holds two jobs. The `deploy` job runs only behind `needs: ci` **and** `if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`, so a branch or PR push runs the gate alone and cannot reach the VPS. Concurrency moved to job level: `ci-<ref>` with `cancel-in-progress: true`, `deploy-production` with **`false`** (a cancelled `--force-recreate` can leave the stack half-replaced). `paths-ignore` `**/*.md` and `docs/**` now skips **both** jobs, so a docs-only push neither tests nor deploys — `workflow_dispatch` is the way to force a deploy after one.
- **Deploy steps.** On the VPS it runs, in order:
  1. Auto-stash local edits (`:51` `git stash push --include-untracked`).
  2. Fast-forward (`:53`).
  3. Regenerate the SeaweedFS prod config (`:56`).
  4. `pg_dump` to `/home/deploy/apps/optra-backups` (`:62-67`). The dump is kept 14 days and is **skipped when postgres is not running** (`:61,69`).
  5. Build the API and web images (`:73-74`).
  6. `up -d --remove-orphans --force-recreate` (`:81`).
  7. Health checks (`:84-110`).
  8. An S3 round trip (`:112-177`).
  9. An optional public smoke test (`:179-187`).

  The `deploy` job itself still has no lint, type-check, test, or explicit migrate step — those live in the `ci` job that now gates it (S0d), which runs `db:migrate`, `type-check`, `lint`, and all six unit suites against a compose stack. Migrations still also run on API container start, as below.
- **Migrations.** The production API image runs `bun run db:migrate` and then `exec node dist/main` on every container start (`apps/api/Dockerfile:99`, prod target selected at `docker-compose.prod.yml:65`). `DEPLOYMENT.md:17` says migrations "run automatically from the API container on start". `packages/db/scripts/migrate.ts:29` is the forward-only Drizzle migrator, and no down migrations exist. So a merged migration is applied to production on the next push. A failing migration keeps the new API container from starting, and the previous containers have already been recreated by then.
- **Feature flags.** Every flag is a global env var:
  - `CATALOG_ENABLED` (`catalog.controller.ts:50`)
  - `PROCUREMENT_PDF_EXTRACTION_ENABLED` (`procurement.controller.ts:51`)
  - `EMAIL_OTP_ENABLED` (`notifications.service.ts:13`)

  No per-workspace flag or settings table exists. The only per-workspace settings table is `workspace_digest_settings` (`workspaceDigestSettings.ts:10`), which holds digest columns only. The user-facing error strings still say "for this workspace" (`catalog.controller.ts:62,144`, `procurement.controller.ts:69`).
- **Compiled runtime. Resolved 2026-09-20 (S0e) — and production does not run Node at all.** The CMD is `exec node dist/main` (`apps/api/Dockerfile:99`), but the image base is `oven/bun:1.2.22` (`:10`), where `/usr/local/bun-node-fallback-bin/node` is a **symlink to `/usr/local/bin/bun`**: through it `process.version` reports `v24.3.0` while `typeof Bun !== 'undefined'` is `true`. So production executes `dist/main` on **Bun**, and the Node v25 suspect in the old TODO was never present there. The compiled build was then re-tested on both runtimes with an isolated `BULL_PREFIX`: one `scrape-queue` job and one `ticket-extraction-queue` job both reached `completed` with no `failedReason` and zero stacktrace entries on **Node v22.15.0** and on **Bun 1.2.22**, in each case after real Postgres writes. B11 is retired (`TODOS.md`). Residual, now recorded in `docs/ai/risk-register.md`: tests and CI run on Node 22 while production runs Bun, so no suite exercises the runtime that serves users.
- **Test prerequisites.**
  - `docs/ai/testing-strategy.md:66` records "1273 tests, zero skipped, all green on Node 22 as of 2026-08-18", and `:72` records e2e passing 14/14 "with the dev stack up".
  - There is no root `test` script and no turbo `test` task (`turbo.json:17` tasks: build, dev, lint, type-check).
  - ~~Host-side runs need `REDIS_PORT=6380`. `.env.example:12` says `6379`~~ — **fixed 2026-09-20 (S0e):** the template now sets `6380` with a comment explaining that `6379` is the in-container port.
  - ~~Host-side runs also need S3 credentials matching `docker/seaweedfs/s3.json`. The `.env.example:22` identity `optra-local` is not present in that file.~~ — **fixed 2026-09-20 (S0e):** the template now carries the real local `optra` identity, with `s3.json` named as its source. `DOCKER.md`, `DEPLOYMENT.md` and `SUMMARY.md` host-port lists were corrected in the same slice.

## 4. Defect register (verified current-code issues)

Every row is a FACT with a `path:line`, except where it is marked **STATIC-ONLY**. D1–D10 are rev 3 §20.3 items, corrected where needed. B1–B22 are new in rev 4. The **Slice** column gives the disposition, and "—" means it is recorded in §9.

### 4.1 Carried from rev 3 §20.3 (corrected)

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| D1 | XLSX original is overwritten with converted CSV. **Rev 3's rationale was wrong.** The code comment says a later comparison read needs CSV (`procurement-parse.processor.ts:93-94`), but comparison builds its CSVs from DB rows (`comparison.service.ts:109,121`). The only storage read of a procurement key is `procurement-parse.processor.ts:71`, and the only other use is the delete in `procurement-documents.service.ts:86`. The overwrite serves no current purpose. It also happens **before** the parse commits (`:95` runs before `:105`), so a failed parse has already destroyed the original. Separately, upload sets `sourceKind` to `'csv'` for XLSX (`procurement-documents.service.ts:26`). | cited | S0b — **done 2026-09-20** |
| D1b | **Found 2026-09-20 while planning S0b:** catalog parse overwrote an uploaded XLSX with converted CSV the same way (`catalog-parse.processor.ts`, and its spec asserted it). | cited | S0b — **done 2026-09-20** |
| D2 | Comparison reads child line items without a `workspaceId` predicate (`comparison.service.ts:109-110`), even though both line-item tables have a non-null `workspaceId` (`poLineItems.ts:12`, `invoiceLineItems.ts:9`). The parent documents are workspace-checked first (`:208,219`). This is a hardening gap, not a proven leak. | cited | S0a — **done 2026-09-20** |
| D3 | `remove()` deletes the storage object first and swallows any error (`procurement-documents.service.ts:86`), then deletes the DB row (`:94-96`), with no transaction. Line items and flags cascade (`poLineItems.ts:16`, `invoiceLineItems.ts:13`, `discrepancyFlags.ts:29,32`). No route, BFF, or client calls it. | cited | POLICY v1 #9 (keep unexposed) |
| D4 | There is no procurement source-document download or view route in the API, the BFF, or `apps/web/src/lib/api/procurement.ts`. | cited | S4 |
| D5 | Re-compare deleted the prior flag set before inserting the new one (post-S0a `:209-217`; the `:132-148` citation predates S0a). See B1 for the dismissal loss. | cited | S1 — **done 2026-09-20** (append-only runs; `listFlags` defaults to the latest succeeded run per pair, with pre-S1 NULL-run flags current until their pair is re-compared) |
| D6 | `ProcurementDocumentsService.list()` has no limit (`procurement-documents.service.ts:45-73`), and neither does `listFlags` (`comparison.service.ts:183-187`). The page polls every 3 s while any doc is pending or processing (`procurement/page.tsx:146-155`). | cited | S7 |
| D7 | Catalog match is request-triggered and capped by `CATALOG_MATCH_MAX_CANDIDATES`, default 8 (`catalog-match.service.ts:8`). It has no durable run, calibration, or budget. | cited | S0c (cost/concurrency) — **done 2026-09-20**; S0f (integrity) open |
| D8 | Host and container Redis ports are documented inconsistently (`.env.example:12`, `docker-compose.yml:26`, `scripts/seed/config.ts:30`). | cited | S0e — **done 2026-09-20** (`.env.example` now says `6380`; `DOCKER.md`/`DEPLOYMENT.md`/`SUMMARY.md` host-port lists corrected; the seeder keeps its explicit host defaults on purpose, since a stray `REDIS_PORT` would point a row-deleting script at the wrong Redis) |
| D9 | Rev 3's API/AI "BLOCKED" results were environment failures. The recorded full-suite green run is in `docs/ai/testing-strategy.md:66`. | cited | §7.8 |
| D10 | Documentation drift, including `README.md:1` "# Mnemra" and `docs/ROADMAP.md:1`. Rev 4 adds more (§3 corrections, Appendix A §19.11). | cited | §9 |

### 4.2 New in rev 4

**Procurement data integrity**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B1 | **Re-compare deletes human decisions.** The flag delete filtered only on workspace, PO, and invoice (pre-S0a `:135-139`; post-S0a `:209-217`). No status filter, so `dismissed` flags and their `dismissedBy`/`dismissedAt` were destroyed. | cited | S1 — **done 2026-09-20**: the delete is gone entirely. A re-compare inserts a new `comparison_runs` row and appends its flags; run 1's flags, and every dismissal on them, stay. |
| B2 | **Delete-then-insert is not atomic.** This happens in compare (`comparison.service.ts:132` then `:144`) and in `replaceLineItems` (`procurement-parse.processor.ts:133-135`, `:153-155`). A failed insert leaves an empty set, and concurrent compares can double-insert. The whole API has only five `db.transaction` sites (`workspaces.service.ts:35,165`, `auth.service.ts:89,166,186`). | cited | S0a (compare) — **done 2026-09-20**: test showed 4 concurrent compares writing 3 flag sets before the fix; S0b (parse) — **done 2026-09-20** (delete + chunked insert + `done` in one transaction) |
| B3 | **Comparison output is silently truncated at 500 rows.** `duckdb-query.service.ts:8` sets `MAX_RESULT_ROWS = 500` and `:81` returns `rows.slice(0, MAX_RESULT_ROWS)`. `ComparisonService` calls it at `comparison.service.ts:124` and never detects the cap, so any pair with more than 500 discrepancies persists a partial flag set and partial counts. The same service also applies a 10 s timeout and a 256 MB memory limit (`duckdb-query.service.ts:7,9`). | cited | S0a — **done 2026-09-20** (600-line test persisted 500 before the fix) |
| B4 | **Match-key and CASE logic.** | cited | S0a — **done 2026-09-20** (one-sided SKU split intentionally unchanged) |
| | • The CASE checks `p.mk IS NULL` / `i.mk IS NULL`, not the line id (`comparison.service.ts:59-60`). So a PO row whose key is NULL is labeled `missing_on_po`. | | |
| | • The key is `COALESCE(NULLIF(lower(trim(sku)),''), 'desc::'\|\|lower(trim(description)))` (`:46,52`). A SKU present on only one side gives different keys, which produces a `missing_on_po` + `missing_on_invoice` pair. | | |
| | • The full outer join has no dedupe or aggregation (`:65`), so duplicate keys fan out N×M. | | |
| | • `lineTotal` is never compared, because `serializeForCsv` omits it (`:89-97`). | | |
| | • ~~STATIC-ONLY~~ **Resolved 2026-09-20:** `read_csv_auto` is called with no options (`duckdb-query.service.ts:75`, duckdb 1.4.4). A test showed it reads an empty field as NULL, so a blank-SKU, blank-description PO line was labeled `missing_on_po`. S0a now builds the key in TypeScript, so it is never NULL. | | |
| | • ~~STATIC-ONLY~~ **Did not reproduce 2026-09-20:** a `00123` SKU survived on the old code (the test passed before the fix), because DuckDB infers a leading-zero column as VARCHAR. S0a still takes the flag's `sku` from the stored row, so the answer no longer depends on inference. | | |
| B5 | **Dismiss is unguarded.** It selects by id, compares workspace in JS, then updates by id only (`comparison.service.ts:191-200`). There is no status check, so a re-dismiss overwrites `dismissedAt`/`dismissedBy`, and there is no undismiss route. `flagId` has no `ParseUUIDPipe` (`procurement.controller.ts:155`). A non-UUID reached Postgres and returned **500** (verified by e2e 2026-09-20). | cited | S0a — **done 2026-09-20** (guarded UPDATE, idempotent re-dismiss, `ParseUUIDPipe` → 400); history in S2 |
| B6 | **Inconsistent semantics between upload, seed, and engine.** | cited | S0b (live `sourceKind` truthful) — **done 2026-09-20**; S1 delta/values — **done 2026-09-20, by fixing the ENGINE, not the seed.** The engine computed `delta = PO − invoice` and wrote NULL values on `missing_on_*`; the seed used `invoice − PO` and filled the present side. Neither was tested. The engine now matches the seed: positive delta means the invoice asks for more than was ordered, and a missing-side flag keeps the present side's value with the absent side counted as zero. Both conventions are now pinned by tests. |
| | • PDF header `sourceKind`: upload writes `'pdf'` (`procurement-documents.service.ts:26`), but the seed writes `'pdf-extraction'` (`scripts/seed/data/procurement.ts:143`) and so does the schema comment (`purchaseOrders.ts:14`). The column is `varchar(20)` (`purchaseOrders.ts:27`). | | |
| | • Delta sign: the engine computes po − inv (`comparison.service.ts:253`), but the seed writes inv − po (`scripts/seed/data/procurement.ts:262` `'18','20','2'`). | | |
| | • The seed fills `poValue`/`invoiceValue`/`delta` on `missing_*` flags (`:264-265`), while the engine writes null (`comparison.service.ts:240-246`). | | |
| | • The web renders `delta` as-is (`discrepancies/page.tsx:236`). | | |
| B7 | **Fragile input handling in the parse path.** | cited | S0b — **done 2026-09-20** (upload orphan cleanup, per-row numeric/SKU validation, 1,000-row chunks, Papa quote errors fail as malformed, all-empty rows skipped) |
| | • CSV numeric cells are passed through as trimmed strings (`column-mapping.ts:33`) into `numeric` columns. | | |
| | • SKU is `varchar(200)` (`poLineItems.ts:19`) with no truncation. | | |
| | • The upload saves the object (`procurement-documents.service.ts:24`) before inserting the header (`:30`), with no cleanup, so an over-long filename (`varchar(500)`, `purchaseOrders.ts:23`) leaves an orphaned object. | | |
| | • All line items go in as one unchunked bulk insert (`procurement-parse.processor.ts:135`). **STATIC-ONLY:** Postgres's 65,535 bind-parameter limit caps this at about 6,553 rows × 10 columns. | | |
| | • Papa parse `errors` are ignored (`:100-101`). A `,,,` line is kept as an all-null line item; the PDF path has an all-null filter (`procurement-extraction.ts:230`), and CSV has none. | | |
| B8 | **Re-parse orphans flags.** `discrepancy_flags` line FKs are `onDelete: 'set null'`, and the parse processor deletes and re-inserts lines. | cited | S1 — **made detectable 2026-09-20, not prevented.** The FKs are unchanged (cascade would delete the evidence). `comparison_runs` records `po_line_count`/`invoice_line_count`, so a run whose document has since been re-parsed is identifiable, and the flag's own `sku`/`poValue`/`invoiceValue`/`delta`/`reason` are denormalized so the evidence survives the orphaning. |

**Job reliability**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B9 | **Bull retries never fire for parse failures.** The catch in `procurement-parse.processor.ts:109-112` and in `catalog-parse.processor.ts:118` calls `markFailed` and does not rethrow. So `attempts: 3` (`procurement-parse.service.ts:68`, `catalog-parse.service.ts:58`) applies only to errors thrown outside the try block (`procurement-parse.processor.ts:51,53,56`). The comments claiming retry idempotency (`procurement-parse.processor.ts:120-121`, `catalog-parse.processor.ts:212`) describe behavior that does not happen. | cited | S0b — **done 2026-09-20** (procurement and catalog: document errors fail at once, others rethrown for Bull retry) |
| B10 | **Documents can stay stuck.** | cited | S0b — **done 2026-09-20** (reconcile every 5 min via a repeatable job; requeue under a fresh jobId, max 2; Bull-failed job → row failed) |
| | • Reconcile runs only in `onModuleInit` (`procurement-parse.service.ts:37`). | | |
| | • It skips any row whose job still exists, whatever state the job is in (`:112`). | | |
| | • It only marks rows failed (`:117`) and never re-enqueues. | | |
| | • `removeOnFail: false` (`:72`) keeps failed jobs. | | |
| | • The jobId is fixed per document (`:137`), and Bull's `addJob` returns the existing id without adding a new job (`node_modules/bull/lib/commands/addJob-6.lua:57`). No current code re-enqueues an existing document; the only `queueDoc` caller runs after a fresh insert (`procurement-documents.service.ts:34`). | | |
| | • **STATIC-ONLY:** a Bull timeout does not cancel the running handler (`node_modules/bull/lib/queue.js:1213`). | | |
| B11 | **Production runs the compiled build that `TODOS.md:103-109` says breaks Bull jobs.** See §3.11. Unverified on Node 22. | cited | S0e — **retired 2026-09-20, does not reproduce.** Two findings: (1) production never ran Node — `node` in `oven/bun:1.2.22` is a symlink to `bun` (`process.version` `v24.3.0`, `typeof Bun !== 'undefined'`), so `exec node dist/main` has always been Bun; (2) the compiled build ran both named queues to `completed` with no `failedReason` and zero stacktrace entries on Node v22.15.0 **and** on Bun 1.2.22, after real Postgres writes. The original failure was specific to Node v25.0.0, which nothing in this repo now uses. New residual recorded instead: CI tests on Node 22, production runs Bun |

**LLM cost invariant**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B12 | **LLM paths bypass the token budget.** `CLAUDE.md:493` declares that rate-limit and token-budget paths "are never bypassed by new chat/refine/extraction code paths". | cited | S0c — **done 2026-09-20** (every listed path budget-checked and charged from provider `usage_metadata` via `UsageService.metered`; catalog match bounded to 3 concurrent) |
| | • `UsageService.assertWithinBudget`/`addUsage` (`usage.service.ts:27,14`; key `usage:tok:{ws}:{yyyymm}` `:56`; budget `MAX_TOKENS_PER_WORKSPACE_MONTH` default 5,000,000 `:30`) is called only at `chat.service.ts:150,172`. | | |
| | • **Unbudgeted:** procurement PDF extraction (`procurement-extraction.service.ts:10`), catalog page extraction and catalog match (`catalog-extraction.service.ts:17,21`), ticket extraction (`ticket-extraction.processor.ts:42`), FAQ drafts (`faq-cluster.processor.ts:75`), topic labels (`topic-gap.processor.ts:49`), chat condense (`chat.service.ts:78`), and the chat structured-query path (`:89`). Condense and structured-query run before the budget check. | | |
| | • No chain returns token usage. `usage_metadata`/`tokenUsage` has 0 hits. Chat estimates with `countTokens` (`chat.service.ts:174`, cl100k in `packages/ai/src/tokens.ts:4`) over the message, answer, and condensed text only. | | |
| | • Catalog match fans out up to 8 vision calls per request through `Promise.all` with no per-candidate catch (`catalog-match.service.ts:35`). The only limit is the global HTTP throttler: 60 requests/min (`app.module.ts:44`). | | |
| | • **Residual after S0c (outside B12 scope, recorded 2026-09-20):** the chat main answer stream is still charged by a local `countTokens` estimate (graph rewrite/grade calls uncounted); `refineMessage` has no workspace id (daily per-user count only); embeddings are not budgeted. | | |

**Catalog**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B13 | **Catalog search deletes prior matches too broadly.** It deletes every prior match for the query line, dismissed and vendor-scoped ones included (`catalog-match.service.ts:49-58`), and it does so even when there are zero candidates (`:78`). The vendor-verify route passes an unvalidated `vendorId` (`catalog.controller.ts:199`). None of this runs in a transaction. | cited | S0f — **done 2026-09-20** (delete scoped to `status='open'` + same `matchType`, and to the same vendor on a compliance verify; delete+insert now in one `db.transaction`; a zero-candidate search deletes nothing; `vendorId` validated against the workspace and given a `ParseUUIDPipe`) |
| B14 | **Candidate prefilter is unstable and unescaped.** It has no `orderBy` (`catalog-match.service.ts:211-222`), so the cap keeps an arbitrary subset. The search term (`:198`) is used in a LIKE without escaping `%`/`_` (`:205`). One failing candidate rejects the whole `Promise.all` (`catalog-match.ts:244` rethrows). | cited | S0f — **partly done 2026-09-20**: stable `orderBy` added, `%`/`_` escaped, `NaN`/non-positive env values no longer widen either cap, and a blank query line now judges nothing instead of sending an arbitrary 8 catalog items to the vision model. **Still open:** the per-candidate catch — one failing candidate still rejects the whole batch. |
| B15 | **Image content types are wrong.** Photo Content-Type is `png` or else `jpeg` (`catalog-documents.service.ts:95`), while the stored extension follows the upstream content type (`catalog-image.service.ts:41`). The compare step labels every candidate image as PNG (`catalog-match.ts:223`). The BFF proxy forwards only `Content-Type`, `Content-Disposition`, and `Content-Length`, so the backend's `Cache-Control` is dropped (`auth-proxy.ts:79`, `catalog.controller.ts:179`). | cited | S0f — **done 2026-09-20**: `StorageService.getObject` (additive) returns the stored Content-Type, and `getItemPhoto` serves it through a raster allowlist — `image/svg+xml` is refused rather than echoed back, since `catalog-image.service.ts:36` accepts any `image/*` and an SVG can carry script. The vision chain takes an optional `candidateImageContentType` (defaults to `image/png`, so the 14 `jest.mock('@repo/ai')` factories are unaffected). `proxyRaw` now forwards `Cache-Control`, which gained its first-ever test. |
| B16 | **Catalog Matches page does not scope to its query.** The page lists every workspace match, not the queried line's (`catalog-matches/page.tsx:113` passes `{}`; the DTO accepts only vendorId and status). The "verify against this vendor" control needs `vendorId` (`:257`), and no in-app link sets it (`discrepancies/page.tsx:56-63`). | cited | S0f — **partly done 2026-09-20**: the list API gained optional `poLineItemId`/`invoiceLineItemId` filters and the page now passes its query params instead of `{}`, so it shows the line the user arrived for. The dead verify control is fixed by driving it from the vendor dropdown already on the page. **Deferred to S3, with evidence:** the plan's "link `vendorId`" is not implementable today — `purchase_orders` has no vendor column at all (`packages/db/src/schema/purchaseOrders.ts:19-34`), so a discrepancy flag has no vendor to pass. |

**Security, privacy, dependencies**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B17 | **Raw error text reaches clients.** | cited | S0a, S0b |
| | • The parse error message is stored raw in `lastError` (`procurement-parse.processor.ts:112`), returned by `list()` (`procurement-documents.service.ts:53`), and rendered in the UI (`procurement/page.tsx:269`). | | |
| | • Compare returns the raw engine message (`comparison.service.ts:166`), which contradicts its own comment at `:156`. | | |
| | • The class-level `UploadExceptionFilter` rewrites every `BadRequestException` on the controller to `{statusCode, message}` (`procurement.controller.ts:87,96`), dropping the validation detail that the global filter returns (`all-exceptions.filter.ts:33`). | | |
| | • **STATIC-ONLY:** whether a given engine or DB message contains cell values. | | |
| | • **S0a done 2026-09-20:** the compare path returns `Comparison engine failed. Reference: <id>` and logs ids only, and the upload filter is scoped to the upload handlers. The parse `lastError` path stays open (S0b). | | |
| | • **S0b done 2026-09-20:** parse `lastError` is an authored document message or `Parsing failed. Reference: <id>`; the full error stays in the server log under that reference. Catalog `lastError` is unchanged (out of S0b scope). | | |
| B18 | **Dependency risks.** | cited | S0e |
| | • ~~User-uploaded XLSX is parsed with `xlsx` 0.18.5~~ — **done 2026-09-20 (S0e).** Advisories confirmed: CVE-2023-30533 (prototype pollution, fixed 0.19.3) and CVE-2024-22363 (ReDoS, fixed 0.20.2). The npm package is abandoned at 0.18.5 and fixes ship only from `cdn.sheetjs.com`, so **both** declaring packages — `apps/api` and `packages/ai`, which rev 3 missed — now pin `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (0.20.3 is the newest published; 0.20.4/0.21.x return 404). The three XLSX specs passed unchanged. **New residual:** a URL dependency records no integrity hash in `bun.lock`, and the CDN becomes a build-time dependency — see the risk register. | | |
| | • ~~`papaparse` is imported by `apps/api` but not declared there~~ — **done 2026-09-20 (S0e).** The row understated it: **five** API files import it (`structured-query.service.ts:7`, `catalog-parse.processor.ts:7`, `dataset-profiling.processor.ts:6`, `comparison.service.ts:13`, `procurement-parse.processor.ts:7`), not two. `apps/api/package.json` now declares `papaparse@^5.5.4` and `@types/papaparse@^5.5.2`, matching `packages/ai`; `bun.lock` still resolves a single `papaparse@5.5.4`. | | |
| B19 | **Host-side test environment does not match compose.** The `.env.example` S3 identity `optra-local` (`:22`) is absent from `docker/seaweedfs/s3.json` (single identity `optra`, `:4`). `REDIS_PORT` is 6379 in `.env.example` versus 6380 as published by compose. The in-container API is unaffected, because local compose overrides `S3_*` to match `s3.json` (`docs/ai/risk-register.md:99-102`). The tracked `s3.json` holds credentials for **local SeaweedFS only**. Production uses the gitignored `s3.prod.json` (`.gitignore:20`, `docker-compose.prod.yml:44`), generated from the VPS `.env` (`scripts/ensure-seaweedfs-s3-config.sh:31-46`). Low severity; record it, no rotation needed. | cited | S0e — **done 2026-09-20** (`.env.example` now carries the real local `optra` identity with `docker/seaweedfs/s3.json` named as its source and a note that these unlock nothing but the throwaway local store; the gitignored prod `s3.prod.json` path is untouched) |
| B20 | **PDF gate is enforced only at upload.** The processor branches on the filename alone (`procurement-parse.processor.ts:72`), so PDFs already queued still process after the flag is turned off. The catalog gate likewise covers only upload and scrape (`catalog.controller.ts:62,144`). | cited | S0b — **done 2026-09-20** for procurement (worker re-checks the flag); catalog upload/scrape gate unchanged |

**Operations and tests**

| ID | Defect | Evidence | Slice |
|---|---|---|---|
| B21 | **No CI quality gate.** | cited | S0d — **done 2026-09-20** (`deploy.yml` gained a `ci` job — Node 22 + Bun 1.2.22, compose `postgres`/`redis`/`seaweedfs`, migrate, type-check, lint, all 6 unit suites — and `deploy` now carries `needs: ci`; e2e and its root-`.env` dependency stay open for S0e) |
| | • The only workflow is `deploy.yml`, and it has no lint, type-check, or test step (§3.11). | | |
| | • There is no root `test` script or turbo `test` task. | | |
| | • PDF e2e tests depend on the developer's root `.env`: `packages/db/src/db/index.ts:6` loads `../../.env`, and `jest-e2e.setup.ts` sets only `EMAIL_OTP_ENABLED` and `BULL_PREFIX`. | | |
| | • Procurement e2e has 4 tests (`procurement.e2e-spec.ts:191,289,334,371`). None covers role refusal, 413, XLSX over HTTP, the disabled PDF gate, cross-workspace dismiss, or re-compare. | | |
| B22 | **Backups are weak.** The only backup is the per-deploy `pg_dump`. It sits on the same VPS disk, is skipped when postgres is down, is kept 14 days, and has no restore test (`deploy.yml:61-69`). There is no SeaweedFS object backup. | cited | §9 (DEFER WITH REASON) |

**Also recorded (lower impact, fixed opportunistically inside the owning slice):**
- Stale comments:
  - `procurement.controller.ts:39-40` claims scanned PDFs "fail clearly at parse time", but the chain falls back to vision (`procurement-extraction.ts:121`).
  - The processor spec mocks an error string that no longer matches the real default (`procurement-parse.processor.spec.ts:27` vs `procurement-extraction.ts:72`).
  - The seed header comment says "three pairs" while the seed builds nine.
- `convertXlsxToCsv` is duplicated three times (`procurement-parse.processor.ts:27`, `catalog-parse.processor.ts:65`, `dataset-profiling.processor.ts:20`).
- The discrepancies page removes a dismissed row even under the "All" filter (`discrepancies/page.tsx:135`).
- A catalog SKU over 200 chars fails the whole catalog insert (`catalogItems.ts:19`, `catalog-parse.processor.ts:223`).
- `listCatalogMatches` has no limit (`catalog-match.service.ts:96`).
- **STATIC-ONLY:** PDF text is sent to the model uncapped (`procurement-extraction.ts:118`).

## 5. Execution plan: ordered slices

### 5.1 Rules that apply to every slice

- **Its own plan first.** Each slice gets its own two-layer plan (CLAUDE.md Plan Contract): a Risk Matrix, a Backward Compatibility Matrix, the exact allowed files, and TDD order. Deep slices need explicit approval before implementation. `.claude/.plan-ack` and `.claude/.predict-verify-ack` are written honestly per slice.
- **Migrations are additive.** New tables and nullable columns only. Backfill in a later deploy. Any narrowing (NOT NULL, drop) goes in a separate, later slice, because migrations auto-apply on API start (§3.11).
- **Dark launch.** New behavior sits behind a global env flag that defaults off, following the `process.env.X === 'true'` pattern (§3.11). The flag is enabled first in the seeded demo workspace, locally.
- **Push control.** Each slice ends with the verification in §7 passing locally and the result recorded. Nothing is pushed to `main` without explicit owner approval.
- **Docs in the same change.** Update the matching `docs/ai/*` rows and `docs/ai/file-index/repository-map.md` entries alongside the code, and update this file's §4 and §9 status.

### 5.2 Slice table

| Slice | Size | Scope | Closes | Depends |
|---|---|---|---|---|
| **S0a** Compare integrity ✅ 2026-09-20 | Standard | Add `workspaceId` predicates to the child reads. Wrap delete+insert in `db.transaction` (pattern: `workspaces.service.ts:35`). CASE on line id instead of `mk`. Handle NULL keys explicitly. Aggregate or flag duplicate keys. Detect or lift the 500-row cap for compare. Guard dismiss by `workspaceId` + status in the UPDATE. Add `ParseUUIDPipe` on `flagId`. Return client-safe error messages and log ids only. | D2, B2 (compare), B3, B4, B5, B17 (compare) | — |
| **S0b** Parse integrity ✅ 2026-09-20 | Deep (reclassified: Bull job processors are a Deep-by-default risk area) | Rethrow transient errors and mark permanent errors failed without rethrow. Make reconcile periodic, and re-enqueue with a fresh jobId or remove the failed job. Stop the XLSX overwrite. Record `sourceKind` truthfully: header `'csv'\|'xlsx'\|'pdf'`, line `'csv'\|'xlsx'\|'pdf-extraction'`. Validate numeric and length inputs per row. Chunk inserts inside one transaction. Surface Papa errors and skip all-null rows. Re-check the PDF gate in the processor. Apply the retry and reconcile fixes to catalog parse. Sanitize `lastError`. | D1, D1b, B2 (parse), B7, B9, B10, B17 (parse), B20 | — |
| **S0c** LLM budget coverage ✅ 2026-09-20 | Deep | Return provider token usage from each `@repo/ai` chain. Call `assertWithinBudget` before, and `addUsage` after, every path listed in B12. Bound catalog-match concurrency. | B12, D7 (cost) | — |
| **S0d** CI gate ✅ 2026-09-20 | Deep (infra) | Run type-check, lint, and every unit suite on PR and push, and let `main` deploy only when they pass. **Built as one workflow, not the two files this row first proposed:** a separate `ci.yml` chained by `workflow_run` runs the *default branch's* copy rather than the pushed commit's, so the gate lives in `deploy.yml` as a `ci` job and `deploy` carries `needs: ci` plus `if: github.ref == 'refs/heads/main'`. `paths-ignore` `**/*.md` and `docs/**`. Concurrency is per job: `cancel-in-progress: true` for CI, **`false`** for deploy — a cancelled `up -d --force-recreate` can leave the production stack half-replaced, so a second push queues instead. Verified on throwaway branch `ci/s0d-verify` (since deleted): a deliberately failing test turned `ci` red and `deploy` reported **skipped**; the clean re-run passed every step. The first run also caught a genuine gap the local dry run could not — `@repo/db`/`@repo/ai` resolve through `dist`, which a clean checkout lacks — so the job builds those two packages before `type-check`. | B21 | — |
| **S0e** Env + dependencies ✅ 2026-09-20 | Express (env/docs) + Deep (dependency) | Aligned `.env.example` Redis and S3 values with compose, and corrected the host-port lists in `DOCKER.md`/`DEPLOYMENT.md`/`SUMMARY.md`. Declared `papaparse` + `@types/papaparse` in `apps/api`. Pinned `xlsx` to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` in **both** declaring packages (CVE-2023-30533, CVE-2024-22363; npm is abandoned at 0.18.5). **B11 retired — it does not reproduce**, and the investigation found that production never ran Node: `node` inside `oven/bun:1.2.22` is a symlink to `bun`, so `exec node dist/main` has always executed on Bun. Both named queues completed cleanly on Node 22 and on Bun 1.2.22. | D8, B18, B19, B11 | — |
| **S0f** Catalog integrity ✅ 2026-09-20 | Standard | Search is transactional; the delete is scoped to open rows of the same match type (and the same vendor on a verify), so dismissals and other vendors' results survive; a zero-candidate search deletes nothing. `vendorId` is validated against the workspace and UUID-parsed. Prefilter is ordered and escapes `%`/`_`; a blank query line judges nothing. Photos are served with their stored content type through a raster allowlist (SVG refused), the vision call labels the image truthfully, and `Cache-Control` is forwarded. The matches page is scoped to its query line via new optional list filters. **Two items deliberately not closed:** the per-candidate catch (B14) stays open, and the `vendorId` deep link is blocked on S3 adding `purchase_orders.vendor_id` — the verify control is driven by the page's vendor dropdown instead. | B13–B16 | — |
| **S1** Comparison runs ✅ 2026-09-20 | Deep (schema) | Migration **0022** adds `comparison_runs` (workspace, PO, invoice, `mode`, `strategy_version`, `status`, `initiated_by`, line/flag counts, timestamps, `last_error`) and a nullable `comparison_run_id` on `discrepancy_flags`. A re-run appends; nothing is deleted. "Current" = latest succeeded run per pair, with pre-S1 NULL-run flags current until their pair is re-compared, so no data migration was needed. `remove()` refuses a document referenced by a run (still unexposed, POLICY v1 #9). Seed gained one succeeded run per pair. **Two design notes:** `mode` is `varchar`, not an enum, so S6's `three_way` needs no migration; `comparison_run_status` ships with `'queued'` unused so S8's queueing needs no `ALTER TYPE` — the repo has no precedent for altering an enum. | B1, D5, B6 (delta/values), B8 | S0a |
| **S2** Decisions + audit | Deep (schema) | Add an append-only `discrepancy_decisions` table (flag, run, actor, role, outcome per POLICY v1 #7, note, created_at). `PATCH dismiss` becomes a `false_positive` decision and still updates `status` for backward compatibility. Add a decision-history API. | B5 (history) | S1 |
| **S3** Line-item enrichment | Deep (schema) | Add nullable provenance columns (source sheet, row, page), typed `extraction_confidence`, `extractor_version`, and `uom`. Write header `poNumber`, `invoiceNumber`, `currency` (dead columns today), PO `vendorId`, and invoice→PO link per POLICY v1 #2–#3. | A6 (dead columns), provenance gap | S0b |
| **S4** Source evidence route | Standard | Add a workspace-scoped `GET` that streams the original document. Template: `getItemPhoto` (`catalog-documents.service.ts:80`) plus the `@Res()` route (`catalog.controller.ts:168-181`) plus `proxyRaw` (`auth-proxy.ts:58`). Add the BFF route and client function. | D4 | S0b |
| **S5** Goods Receipt domain | Deep (schema) | Add GRN header and line tables mirroring PO/invoice, including qty received/accepted/rejected and `uom`. Reuse the upload→parse→queue template (`procurement-parse.service.ts:46-80`). Require an explicit PO link. | receiving gap | S3 |
| **S6** Three-way comparison | Deep | Add run mode `three_way`. Sum accepted qty across linked GRNs (POLICY v1 #14). Add new flag types through an additive enum migration. UOM and currency mismatch → `needs_review`. Golden three-way fixtures. | three-way gap | S1, S5 |
| **S7** Review queue UI | Standard | Turn the discrepancies page into a queue with decision actions, run history, and evidence links. Paginate the API and web lists. Match the design tokens (`DESIGN.md`). | D6 | S2, S4 |
| **S8** Auto orchestration | Deep | After parse succeeds and the linked counterpart is ready, enqueue a comparison run with a deterministic jobId. Add procurement event types (additive enum) via `EventsService.record` (`events.service.ts:17`). | orchestration gap | S1, S0c |
| **S9** Price + vendor history | Deep | Versioned price and contract evidence (rev 3 §6 1C), then the vendor intelligence surfaces (rev 3 Phase 3). | price gap | S6 |

### 5.3 Acceptance tests per slice (write the failing test first)

- **S0a** in `apps/api/src/procurement/comparison.service.spec.ts` and `apps/api/test/procurement.e2e-spec.ts`:
  - Child-read queries include `workspaceId`.
  - A simulated insert failure leaves the prior flags intact (transaction).
  - More than 500 mismatching lines either persist completely or fail loudly. No silent truncation.
  - A blank-SKU, blank-description PO row is not labeled `missing_on_po`.
  - Duplicate SKUs produce a defined, non-fan-out result.
  - A cross-workspace dismiss returns 404 and the flag is unchanged.
  - A non-UUID `flagId` returns 400.
  - An engine error returns a generic message.
- **S0b** in `procurement-parse.processor.spec.ts` and `procurement-parse.service.spec.ts`, mirrored for catalog:
  - A transient error rethrows. A permanent error marks failed and does not rethrow.
  - Reconcile re-enqueues a stuck doc.
  - The XLSX original bytes are unchanged after parse.
  - Header and line `sourceKind` match the policy.
  - A non-numeric quantity gives a row-level error, not a failed doc.
  - A 7,000-row CSV parses (chunked).
  - A `,,,` row is skipped.
  - A queued PDF with the flag off does not extract.
- **S0c** in the `packages/ai` chain specs and `usage.service.spec.ts`, plus a spec per call site:
  - Every B12 path calls `assertWithinBudget` before the model call and `addUsage` with the provider's token count after.
  - An over-budget workspace gets HTTP 402 or a failed job, and no model call is made.
- **S0d**:
  - A PR with a failing unit test is blocked.
  - A docs-only push does not rebuild.
  - Verified on a throwaway branch, not `main`.
- **S0e**:
  - A fresh clone with `.env.example` copied runs `apps/api` unit and e2e tests against the dev stack.
  - The B11 reproduction result is recorded in `TODOS.md`.
- **S0f** in `catalog-match.service.spec.ts`, `catalog-documents.service.spec.ts`, and the catalog-matches page spec:
  - Dismissed matches survive a re-search.
  - A zero-candidate search deletes nothing.
  - A foreign `vendorId` returns 404.
  - One failing candidate does not fail the batch.
  - `%` in the search term is literal.
  - A webp photo is served as `image/webp`.
  - The page lists only the queried line's matches.
- **S1**:
  - Migration **0022** applies on a clean DB (verified from scratch on a throwaway database; CI only ever proves a migration against an empty one).
  - Re-run creates a new run and old flags remain.
  - The current-run query returns the latest succeeded run.
  - Deleting a referenced document is refused.
  - Seed flags match engine sign and null semantics.
- **S2**:
  - Decisions are insert-only (no update/delete path).
  - `PATCH dismiss` writes a `false_positive` decision.
  - Role matrix holds (member → 403).
  - History is ordered.
  - Cross-workspace decision reads return 404.
- **S3–S9**: defined in each slice's own plan against the §2.2 fixtures and the rev 3 §10.4 matrix (kept in §7.4).

### 5.4 Product spine (rev 3 §4, retained)

#### 4.1 Target workflow

`intake`
→ `document classification`
→ `extraction with provenance`
→ `canonical normalization`
→ `document/link suggestion`
→ `2-way or 3-way comparison run`
→ `price/UOM/catalog evidence`
→ `exception prioritization`
→ `human decision`
→ `audit + learning signal`
→ `vendor history / insights`

#### 4.2 Target user promise

**PROPOSED:** “Before payment, Optra shows what was ordered, what was received, what was billed, what price was authorized, and why a human should review the difference.”

This promise is narrow enough to test and strong enough to create recurring value for hardware procurement teams.

#### 4.3 Core actors

**PROPOSED; confirm in Gate 0:**

- AP reviewer: owns invoice/payment exception review.
- Receiving/warehouse user: records or confirms received quantity and condition.
- Procurement/buyer: owns PO and supplier terms.
- Workspace owner/admin: manages access and configuration.
- Supplier/vendor: external party; no direct access assumed until validated.

### 5.5 Target capability requirements (rev 3 §6, retained)

*This is the requirement source for slices S1–S9, kept from rev 3. Wherever it says Gate 0 or UNVERIFIED DEPENDENCY for receiving, linkage, price, UOM, decisions, or roles, POLICY v1 (§2.1) now supplies the answer. Phase mapping: 1A→S3, 1B→S5, 1C→S9, 1D→S3/S6, 1E→S1/S6, 1F→S8, 1G→S0c, 1H→S2, Phase 2→S4/S7, Phase 3→S9, Phase 4→deferred (§9).*

#### Dependency graph

```text
Gate 0 documents + contracts
        ↓
canonical evidence/provenance model
        ↓
extraction + normalization + linkage
        ↓
comparison runs (2-way/3-way/contract)
        ↓
idempotent async orchestration
        ↓
review queue + evidence UI
        ↓
human decision + audit trail
        ↓
vendor history + insights
        ↓
validated integrations / tax expansion

Production gates must pass before external customer AP data is used.
```

#### Phase 1 — trustworthy procurement control spine

**Goal:** produce deterministic, explainable comparison results from PO, receiving, invoice, and approved price evidence.

##### 1A. Canonical document and evidence model

**PROPOSED:** introduce a canonical document/evidence layer without destroying current raw rows.

Required properties:

- document type, source kind, workspace, vendor, external/reference numbers;
- original object key and immutable source metadata;
- parse status, error, attempt, timestamps;
- raw extracted value;
- normalized value;
- source location: page, sheet, row, column, and/or bounding box where available;
- extraction method/provider/model/version where applicable;
- nullable confidence with defined meaning;
- correction history or immutable revision strategy.

**Implementation constraint:** exact table names, enums, and relations remain UNVERIFIED until Gate 0 confirms the document taxonomy and retention rules.

Likely code seams:

- CREATE/UPDATE: `packages/db/src/schema/*` and `packages/db/src/schema/index.ts`.
- CREATE: new numbered migration under `packages/db/drizzle/`.
- UPDATE: procurement DTOs, services, processors, and module.
- UPDATE: extraction output types and persistence path.
- TEST: schema/migration round-trip and workspace isolation fixtures.

##### 1B. Receiving domain

**PROPOSED:** add first-class receiving evidence. Support the customer’s confirmed DR/GRN/warehouse artifact rather than assuming one universal document.

Required behavior:

- upload and parse the accepted receiving artifact;
- link it to a PO by explicit reference or reviewable suggestion;
- retain received, accepted, rejected, backordered, and unknown quantities where the source supports them;
- support multiple receipts against one PO;
- support partial deliveries and over/under receipt;
- preserve evidence location and original values;
- never silently interpret missing receiving data as zero received.

**UNVERIFIED DEPENDENCY:** exact receiving states and whether a receipt is authoritative must come from the customer process.

##### 1C. Versioned price and contract evidence

**PROPOSED:** do not add a lone `catalog_price` field. Create a versioned price/term concept that can represent:

- vendor and item identity;
- price type: approved contract, negotiated, PO, list/catalog, or customer-defined type;
- amount, currency, UOM, quantity tier, and tax/freight inclusion;
- effective-from/effective-to or revision;
- source document and source location;
- approval/status and supersession;
- applicability constraints.

**UNVERIFIED DEPENDENCY:** “correct price” semantics vary by customer. The schema must not encode a universal assumption about net/gross, freight, tax, rebates, or tiering.

Catalog scraping may provide discovery evidence. It must not silently become authoritative contract pricing.

##### 1D. Persistent UOM and identity normalization

**PROPOSED:** persist normalization rules in PostgreSQL. DuckDB may execute comparison calculations, but it must not be the only place where business truth exists.

Support, only where validated:

- aliases for SKU, vendor SKU, description, and UOM;
- source/vendor/workspace scope;
- conversion factor and dimensional basis;
- effective dates and review status;
- explicit “unknown/unconvertible” result;
- correction ownership and audit.

**Guardrail:** do not convert `box`, `each`, `set`, `roll`, or weight/length units based on names alone. Require a configured rule or human confirmation.

##### 1E. Comparison runs and matching

**PROPOSED:** replace the implicit “delete old flags and insert current result” concept with an explicit comparison run.

Each run should identify:

- workspace and initiating user/system action;
- source document IDs and their revisions;
- comparison mode: two-way, three-way, or contract-price;
- matching strategy/version;
- started/completed/failed status;
- deterministic result set;
- source and normalized values;
- match state: matched, unmatched, ambiguous, duplicate, insufficient evidence;
- discrepancy type, delta, and reason;
- evidence references.

Matching rules should handle:

- exact and normalized SKU;
- vendor SKU and alias mapping;
- description similarity only as a candidate signal;
- duplicate lines;
- partial receipts;
- missing data;
- one-to-many and many-to-one cases where supported;
- explicit manual resolution.

Do not use a fuzzy description match as silent proof of item identity.

##### 1F. Async orchestration

**PROPOSED:** after parsing an eligible document, enqueue an idempotent comparison/match workflow. Preserve manual trigger support during transition.

Reuse existing queue conventions:

- deterministic job IDs;
- bounded retries and exponential backoff;
- timeouts;
- persisted lifecycle state and last error;
- stale-job reconciliation;
- structured logging with workspace/document/run IDs;
- safe retry without duplicate results.

Add only after the comparison contract is accepted:

- pair/triad/link suggestion job;
- normalization job if asynchronous work is needed;
- comparison-run job;
- catalog/contract candidate job;
- optional visual verification job;
- retry/dead-letter or explicit failed state;
- cost and concurrency controls.

**PROPOSED:** automatic processing should stop at “needs review” when evidence is insufficient. It must not approve payment or close an exception automatically.

##### 1G. Confidence and model controls

**PROPOSED:** treat model scores as triage signals. Establish thresholds from Gate 0 benchmark data.

Required controls:

- score definition and calibration set;
- provider/model/prompt/version recorded where material;
- candidate cap and total model budget;
- timeout/retry behavior;
- prompt-injection handling for vendor-controlled text/images;
- no hardcoded `0.85` approval rule;
- human override and correction capture;
- regression fixtures for known substitutions and lookalikes.

##### 1H. Human decisions and audit

**PROPOSED:** add a decision model separate from raw discrepancy status.

Possible states require Gate 0 confirmation. Candidate vocabulary:

`open → in_review → accepted / disputed / held / needs_information / resolved`

Record:

- actor and role;
- timestamp;
- decision and reason;
- comment/attachment if permitted;
- prior state;
- source comparison run;
- resulting follow-up or owner;
- immutable history.

“Dismissed” is not sufficient for financial control because it loses the distinction between false positive, approved exception, vendor correction, and unresolved risk.

#### Phase 1 acceptance gate

Phase 1 is complete only when all are true:

- migrations apply from current head on a clean test database;
- existing procurement behavior remains covered;
- real sample documents round-trip with raw, normalized, and provenance fields;
- PO/receiving/invoice comparisons produce deterministic golden results;
- unit conversion and price applicability behavior is tested;
- unmatched/ambiguous cases remain visible;
- jobs are idempotent, retryable, bounded, and observable;
- role and workspace isolation tests cover every new read/write route;
- no route creates a payment approval side effect;
- model thresholds are evidence-backed or remain review-only;
- performance and model-cost ceilings are measured on the benchmark set;
- migration, rollback, and data-repair procedures are documented.

#### Phase 2 — intake and review experience

**Goal:** make the verified control spine usable without manual document-pair hunting.

##### 2A. Intake

**PROPOSED:** web-first intake for PO, invoice, and receiving artifacts.

Required UX:

- upload with type/size validation;
- clear parsing state and failure reason;
- suggested links based on explicit reference/vendor signals;
- user confirmation for ambiguous links;
- support multiple receipts and invoice revisions;
- refresh-safe run status.

Current page to evolve: `apps/web/app/workspaces/[id]/procurement/page.tsx`.

##### 2B. Review queue

**PROPOSED:** replace the current discrepancy-only table with a review queue that answers:

- What was ordered?
- What was received?
- What was billed?
- What price was authorized?
- What evidence supports each value?
- What is missing or ambiguous?
- What decision is required, by whom, and why?

Visual states should be explicit:

- green: evidence agrees;
- amber: review or missing evidence;
- red: confirmed/likely discrepancy.

Color alone must not carry meaning; include text labels and accessible status.

##### 2C. Evidence drawer

**PROPOSED:** side-by-side source evidence with line-level provenance. A reviewer should reach the source page/row and see raw versus normalized values.

Current gaps to address:

- no persisted source coordinates;
- no receiving evidence UI;
- no contract-price evidence UI;
- no decision history UI;
- unbounded list loading.

##### 2D. API and BFF contract

Update existing clients/proxies only after backend DTOs are accepted:

- `apps/web/src/lib/api/procurement.ts`;
- `apps/web/src/lib/api/catalog.ts`;
- `apps/web/app/api/workspaces/[id]/procurement/*`;
- relevant new receiving/compare-run/decision routes.

Do not expose internal storage keys as public access mechanisms. Use authenticated, workspace-scoped resource access.

##### Phase 2 acceptance gate

Manual and automated verification must cover:

`upload → parse → link → compare → review evidence → decide → refresh/reopen → audit`

Include successful, failed, partial, ambiguous, unauthorized, empty, large, mobile-width, and expired-resource states.

The repository currently has no Playwright/Cypress suite. Add browser automation only after the flow is stable; until then, combine API tests, web unit/page tests, proxy tests, and documented manual QA.

#### Phase 3 — vendor intelligence

**Goal:** turn reviewed evidence into compounding operational value.

**PROPOSED capabilities:**

- vendor price history by item/UOM/currency/effective date;
- contract-versus-invoice variance;
- approved aliases and substitutions;
- repeated short-ship, overbill, and substitution patterns;
- review-outcome feedback for candidate ranking;
- vendor scorecards with evidence links;
- exportable audit and exception reports.

Rules:

- every scorecard metric traces to source documents and decisions;
- missing data is distinct from good performance;
- vendor benchmarks are scoped by item family, UOM, currency, and period;
- no ranking becomes an automatic vendor penalty without customer approval.

#### Phase 4 — validated expansion

Keep existing knowledge/RAG, structured-query, support-ticket, and insight concepts as expansion surfaces. Do not let them destabilize the procurement control spine.

Potential expansion, each gated by evidence:

- email or other intake channel;
- Telegram/Viber workflows;
- ERP/accounting integrations;
- ticket copilot from field failures;
- procurement dataset SQL and operational trend views;
- tax workflows such as BIR/EWT/VAT.

Tax workflows require professional validation, versioned rules, jurisdiction/date handling, goods-versus-services classification, explicit exemptions, golden fixtures, and human review. Never encode universal “1%/2%” assumptions as product truth.

Messaging, if validated, requires:

- provider webhook authentication/signature checks;
- replay/idempotency protection;
- account-linking state;
- workspace and role authorization;
- file type/size controls;
- rate limits and abuse controls;
- short-lived, resource-scoped, one-time review links;
- no JWT in URL query parameters.

### 5.6 Seam map (rev 3 §9, retained)

*Each slice's own plan narrows these seams to an exact allowed-file list.*

Exact future names are intentionally not frozen before Gate 0. The following is a seam map, not a promise of exact files.

#### Database

- **UPDATE:** `packages/db/src/schema/index.ts`.
- **UPDATE/CREATE:** `packages/db/src/schema/*` for accepted document, receiving, pricing, UOM, run, decision, provenance, and audit models.
- **CREATE:** next numbered Drizzle migration under `packages/db/drizzle/`.
- **UPDATE/VERIFY:** `packages/db/scripts/migrate.ts`, seed/test fixtures, schema tests.

#### API

- **UPDATE:** `apps/api/src/procurement/procurement.controller.ts`.
- **UPDATE:** `procurement-documents.service.ts`, `procurement-parse.service.ts`, `procurement-parse.processor.ts`, `comparison.service.ts`, DTOs, module.
- **CREATE, likely:** receiving/document-link/normalization/comparison-run/decision services and processors after accepted domain model.
- **UPDATE:** `apps/api/src/catalog/catalog-match.service.ts`, catalog DTOs/module, if catalog/contract evidence participates in the accepted run model.
- **UPDATE:** `apps/api/src/app.module.ts` if new modules/queues are approved.
- **UPDATE/CREATE:** API e2e fixtures and route tests.

#### AI/extraction

- **UPDATE:** `packages/ai/src/chains/procurement-extraction.ts` for accepted document types and provenance-compatible output.
- **UPDATE:** `packages/ai/src/chains/catalog-match.ts` only if benchmark results justify visual/text matching.
- **UPDATE:** rendering/loaders only when real sample documents require it.
- **CREATE/UPDATE:** golden fixtures and calibration/evaluation tests.

#### Web

- **UPDATE:** `apps/web/app/workspaces/[id]/procurement/page.tsx`.
- **UPDATE:** `apps/web/app/workspaces/[id]/discrepancies/page.tsx`.
- **UPDATE:** `apps/web/app/workspaces/[id]/catalog-matches/page.tsx` if retained as an evidence surface.
- **UPDATE:** `apps/web/src/lib/api/procurement.ts`, `catalog.ts`, and corresponding BFF proxy routes.
- **CREATE/UPDATE:** receiving, run, evidence, review, decision, and audit components after API contract approval.

#### Operations and documentation

- **UPDATE:** `.env.example` only for approved, documented feature flags/secrets.
- **UPDATE:** testing/operations/security documentation.
- **CREATE/UPDATE:** migration, rollback, data-retention, benchmark, and manual-QA runbooks.

No deletion is proposed. Any file deletion requires a separate review showing no remaining imports, routes, migrations, or user data dependency.

## 6. Technical design constraints

### 6.1 Data integrity

- Preserve raw source values.
- Store normalized values separately.
- Preserve source provenance.
- Make revisions explicit.
- Use foreign keys and workspace predicates.
- Make duplicate/retry behavior deterministic.
- Prefer append-only decision history.
- Keep business truth in PostgreSQL; use DuckDB for bounded analytical execution.

### 6.2 Workspace isolation and permissions

Every new query and mutation must be checked for:

- workspace ownership;
- workspace membership;
- role permission;
- object/document/line/run relationship;
- direct-object-reference attacks;
- cross-tenant storage access;
- audit visibility.

Current app-level workspace checks are useful but should be complemented by defense-in-depth production controls where supported. `docs/PRODUCTION-READINESS.md` identifies missing PostgreSQL RLS, export/delete, and audit capabilities; verify current deployment posture before relying on documentation.

### 6.3 File and model safety

- Keep upload allowlists and size limits.
- Validate content, not only filename/MIME.
- Keep PDF/image rendering limits.
- Preserve SSRF protections for remote catalog images.
- Treat vendor text and images as untrusted prompt content.
- Never log full documents, invoices, credentials, or personal data.
- Track model/provider/version when outputs influence a decision.
- Add cost limits before automatic background matching.

### 6.4 API behavior

Follow existing Nest conventions:

- DTO validation with whitelist behavior;
- Nest exceptions for request/domain errors;
- workspace-scoped service checks;
- persisted processor error state;
- structured logs using IDs and counts;
- bounded list/pagination behavior.

Do not make list endpoints unbounded as new data volumes grow. Existing unbounded list behavior should be addressed as part of the review-queue work.

### 6.5 Queue behavior

Follow current procurement/catalog patterns:

- queue names scoped by domain;
- deterministic job IDs;
- retry/backoff/timeout;
- persisted status and error;
- stale-job reconciliation;
- idempotent writes;
- explicit partial failure;
- observable queue depth and duration.

Before production scale, evaluate worker separation. All 15 `@Processor` classes live in `apps/api/src` and run in the API process, and neither compose file declares a worker service. `docs/PRODUCTION-READINESS.md:39` (C4) lists this as an operational risk.

### 6.6 Existing code patterns to preserve (rev 3 §8)

| Concern | Current pattern | Evidence | Plan implication |
|---|---|---|---|
| Naming | `Procurement...Service`, `...Processor`, `...Controller`; domain queue names | `apps/api/src/procurement/procurement-parse.service.ts:29-155`; `apps/api/src/catalog/catalog-parse.service.ts:24-128` | Mirror names after domain contract is accepted |
| Errors | Nest exceptions; upload filter; persisted processor errors | `procurement.controller.ts:76-93`; `comparison.service.ts:155-168`; `catalog-image.service.ts:46-50` | Keep client-safe errors and durable job diagnostics |
| Logging | Nest `Logger`; IDs/counts rather than raw contents | `comparison.service.ts:155-163` and queue services | Preserve privacy-conscious structured context |
| Data access | Direct Drizzle queries with explicit workspace predicates | `catalog-match.service.ts:118-139`; `catalog-documents.service.ts:80-95` | Require workspace scope on every new query |
| Migrations | Numbered Drizzle SQL migrations | `packages/db/drizzle/0020_bumpy_energizer.sql`, `0021_dear_speed_demon.sql` | Add reviewed forward migration; test from current head |
| API tests | Adjacent Jest specs plus API e2e directory | `apps/api/src/procurement/*.spec.ts`; `apps/api/src/catalog/*.spec.ts`; `apps/api/test` | Add domain regression tests beside implementation and e2e for critical flows |
| Web tests | Vitest page/client/proxy tests | `apps/web/app/workspaces/[id]/*/*.spec.ts`; `apps/web/src` specs | Extend current behavior tests; add browser tests when flow stabilizes |
| Queue idempotency | Deterministic IDs, retries, timeout, reconciliation | procurement/catalog parse services | Reuse for comparison/match orchestration |

### 6.7 Deploy and migration constraints (new in rev 4)

- **One migration per slice.** Each migration is generated by `bun run --cwd packages/db db:generate` and reviewed as SQL. It must be additive: new tables, nullable columns, new enum values added through `ALTER TYPE … ADD VALUE`. Never drop, rename, or change a column type in the same deploy that stops using it.
- **Before any schema slice merges:**
  - Apply the migration to a disposable copy of the dev DB, from the current head.
  - Run the full API unit and e2e suites.
  - Record the backup path produced by `deploy.yml:62-67` for the deploy that will carry it.
- **Rollback is forward-fix plus flag-off.** There are no down migrations (`packages/db/scripts/migrate.ts`). The last resort is to restore the pre-deploy `pg_dump` (B22). That dump is on the same host and is skipped if postgres is down, so check that it exists before pushing.
- **Processors run in the API process.** New queues run in the same process as the 15 existing `@Processor` classes. Set explicit `concurrency` for any LLM-calling queue. Today only `catalog-scrape` sets it.

## 7. Verification strategy

### 7.1 Baseline preservation

Before each implementation slice, rerun the relevant baseline and record:

- command;
- environment/services available;
- pass/fail;
- failure classification;
- changed behavior;
- evidence artifact.

Minimum deep-task checks, aligned with `docs/ai/testing-strategy.md`:

```text
bun run type-check
bun run lint
bun run build
bun run --cwd apps/web test
bun run --cwd apps/api test
bun run --cwd packages/ai test
bun run --cwd packages/db test
bun run --cwd packages/ui test
API e2e suite with required services
seed/fixture verification where affected
```

Service-backed checks require a reachable PostgreSQL, object storage, queue runtime, and any explicitly used external/network fixture. A failed service-backed test must be classified as environment, fixture, or product failure—not silently ignored.

### 7.2 Database and migration tests

- Apply migration from current head to clean test database.
- Apply migration twice where tooling permits; verify safe behavior.
- Verify rollback/data-repair procedure on a disposable database.
- Verify foreign keys, indexes, uniqueness, nullable semantics, and workspace predicates.
- Verify existing seed and current procurement tests remain valid.
- Verify raw values survive normalization/reprocessing.
- Verify revisions do not corrupt prior comparison runs.

### 7.3 Extraction tests

For each document type and format:

- text PDF;
- scanned/image PDF;
- CSV;
- XLSX with supported sheet behavior;
- malformed/empty file;
- oversized/unsupported file;
- ambiguous/missing fields;
- duplicate lines;
- currency/UOM variants.

Assert exact expected values, null semantics, provenance, error states, and bounded behavior. Model evaluations must use fixed fixtures and explicit tolerance, not visual inspection alone.

### 7.4 Matching/comparison matrix

Required golden cases:

| Case | Expected result |
|---|---|
| Exact SKU, same quantity/price | matched; no exception |
| Quantity short receipt | receiving exception with delta |
| Invoice quantity exceeds received | invoice/receiving exception |
| Invoice quantity exceeds PO | PO/invoice exception |
| Unit-price variance | price exception with authoritative-price source |
| Contract price expired | price applicability exception, not silent match |
| Currency mismatch | needs review unless configured conversion exists |
| UOM convertible by approved rule | compare normalized quantity |
| UOM unknown | needs review; no guessed conversion |
| Same description, different SKU | ambiguous/unmatched |
| Duplicate lines | explicit duplicate/aggregation state |
| Missing receiving document | two-way result clearly labeled; no false three-way claim |
| Partial receipt across multiple records | aggregate only under accepted policy |
| Re-run same sources | idempotent, no duplicate decision/flags |
| Reprocess revised document | new revision/run; old audit history preserved |

### 7.5 Security and tenancy tests

- owner/admin/member matrix for every route;
- cross-workspace document ID;
- cross-workspace line/run/decision ID;
- storage key traversal and unauthorized object read;
- expired/one-time evidence link;
- malformed upload and content-type mismatch;
- oversized document and page limits;
- SSRF regression for any remote image/catalog source;
- prompt injection fixture in vendor-controlled content;
- rate/cost limit behavior;
- audit log immutability and visibility.

### 7.6 Critical-flow QA

At each phase gate, test the complete user flow with a real or consented fixture set:

`upload → parse → link → compare → inspect evidence → decision → reload → audit/export`

Include network interruption, queue delay, processor retry, partial failure, duplicate upload, stale page, unauthorized user, and mobile layout.

### 7.7 Local service-backed test environment (new in rev 4)

From `docs/ai/testing-strategy.md` and the repository configuration:

1. Use Node 22 (`.nvmrc`). The testing notes record that Node 25 breaks duckdb.
2. Run `bun install`.
3. Run `cp .env.example .env`. For host-side test runs, set `REDIS_PORT=6380` and use the S3 identity from `docker/seaweedfs/s3.json` (B19). S0e will remove this manual step.
4. Run `bun run docker:dev:up`, which starts postgres, redis, seaweedfs, api, and web. The API container applies migrations on start (`docker/api-dev-entrypoint.sh:64-65`).
5. Build the packages that e2e imports from `dist`: `bun run build`, or build `@repo/db` and `@repo/ai`.
6. Run `bun run --cwd apps/api test` and `bun run --cwd apps/api test:e2e`. Then run `bun run test` in `apps/web`, `packages/ai`, `packages/db`, and `packages/ui`. Finish with root `bun run lint` and `bun run type-check`.

Tests share the dev `optra` database. There is no separate test database or test compose file.

### 7.8 Test baseline (corrected)

| Source | Result |
|---|---|
| `docs/ai/testing-strategy.md:58-66` (2026-08-18, Node 22, dev stack up) | api 59 suites / 399 tests; e2e 14 suites / 40 tests; web 511; ai 173; db 12; ui 91; seed 47. Total **1273, zero skipped, all green**. |
| Rev 3 run (2026-09-15, no DB/S3/Docker available) | Web, DB, and UI passed. API and AI were blocked by missing services. That was an environment limitation, not a product regression. |

A slice may not claim green until it reruns the full set under §7.7 and records the result.

## 8. Rollout, rollback, and production gates

### 8.1 Rollout (replaces rev 3 §15 Rollout)

Rev 3 proposed rollout "by workspace and feature flag" with a design-partner workspace. Neither exists (§3.11, §2). Rollout per slice is:

1. Local fixtures and the seeded demo workspace, with the flag on locally.
2. Push to `main`, with owner approval, and the flag **off** in the VPS `.env`. The migration applies, and behavior is unchanged.
3. Turn the flag on in the VPS `.env` and recreate the stack. Verify with the S0/S-slice acceptance checks against the demo workspace.
4. Remove the flag in a later cleanup slice, once the behavior has been stable across at least one further deploy.

No step alters payment or ERP state. None exists (§4, rev 3 §20.5).

### 8.2 Rollback (rev 3 §15, retained)

Every migration/feature must document:

- flag-off behavior;
- worker pause behavior;
- how to preserve source documents and decisions;
- how to revert API/UI behavior without deleting data;
- how to replay a failed run;
- how to repair partial writes;
- how to identify affected workspace/run IDs;
- owner and approval for data repair.

Do not roll back by destructive database reset in a customer environment.

Rev 4 addition: there are no down migrations, so rollback means flag-off plus forward-fix. Restoring the pre-deploy `pg_dump` is the last resort (§6.7, B22).

### 8.3 Production readiness gates (rev 3 §11, retained)

These are not optional polish if real financial documents will be processed.

**FACT from `docs/PRODUCTION-READINESS.md`; verify current source/deployment state before execution:**

- production secret validation;
- backups and restore drill;
- error monitoring;
- worker/process separation and queue durability;
- graceful shutdown;
- database pool sizing;
- CI quality gates and staging environment;
- PII/data-processing/DPA/no-training/redaction policy;
- encryption-at-rest posture;
- tenant export and deletion;
- audit logging;
- LLM cost visibility and limits;
- production rate limits.

The source already installs a global exception filter at `apps/api/src/main.ts:11`. Rev 4 reconciled the `docs/PRODUCTION-READINESS.md` rows A6 and C1 that disagreed (§9.3). Per §9.1, these gates are deferred with reason until real user data exists, and they become blocking at that point.

**Production gate exit:** no external customer AP data until security, restore, observability, tenancy, retention, and incident-response checks are signed off.

## 9. Disposition ledger (fills rev 3 §19.13 and §20.4)

The allowed values are `IMPLEMENT NOW`, `DEFER WITH REASON`, `ACCEPT AS-IS WITH EVIDENCE`, `BLOCKED BY EXTERNAL INPUT`, and `RETIRE AFTER DEPENDENCY CHECK`. "Now" means in slice order (§5).

### 9.1 Rev 3 §19.12 backlog

| Item (rev 3 §19.12) | Disposition | Reason / slice |
|---|---|---|
| Resolve Gate 0 customer documents and process answers | IMPLEMENT NOW | Replaced by POLICY v1 (§2) and the fixture set (§2.2) |
| Benchmark current extraction and two-way comparison | IMPLEMENT NOW | On the §2.2 fixtures, in S0a/S0b tests |
| Receiving artifact, linkage, price, UOM, decision states, role matrix | IMPLEMENT NOW | POLICY v1 #1–#15 |
| XLSX source preservation | IMPLEMENT NOW | S0b (D1) |
| Procurement source-document access and retention | IMPLEMENT NOW | S4; retention per POLICY v1 #9 |
| Defense-in-depth workspace predicates + IDOR tests | IMPLEMENT NOW | S0a, then every slice |
| Source-of-truth hierarchy and doc drift | IMPLEMENT NOW | Rev 4 drift fixes (this change); rest per §9.3 |
| Configuration inventory, Redis port contract, production env validation | IMPLEMENT NOW (inventory/ports) · DEFER WITH REASON (env profiles) | S0e fixes the ports. The 33 undocumented keys (Appendix A §19.9) get documented in S0e. Env-profile validation is deferred: `scripts/verify-env.sh` covers the prod-critical subset, and there are no external users. |
| DB/Redis/S3/model test prerequisites | IMPLEMENT NOW | §7.7, S0e |
| CI quality gates and staging | IMPLEMENT NOW (CI) · DEFER WITH REASON (staging) | S0d. Staging is deferred: single-owner portfolio project, and the dark-launch flags (§8.1) stand in for it. |
| Backup/restore, retention/export/delete, PII processing, incident response | DEFER WITH REASON | No external user data (`CLAUDE.md:39`). B22 is recorded. It becomes blocking before any real user data is accepted. |
| Deployment runtime, Node/Bun compatibility, compiled worker behavior, graceful shutdown | IMPLEMENT NOW (B11 check) · DEFER WITH REASON (worker split, graceful shutdown) | S0e reproduces B11. The worker split waits on that result. |
| P1 control spine (canonical model, receiving, vendor/link, price, UOM, runs, states, provenance, decisions, orchestration, calibration, events, API/BFF) | IMPLEMENT NOW | S1–S8. Versioned price in S9. |
| P1 review surface (intake, link suggestions, queue, drawer, raw vs normalized, decisions, pagination, a11y/mobile, browser tests) | IMPLEMENT NOW (S7) · DEFER WITH REASON (browser suite) | No Playwright/Cypress exists. Add it after S7 stabilizes (rev 3 §6 Phase 2 note). |
| P1 verification and security (runbooks, golden fixtures, e2e, IDOR, upload/SSRF/prompt-injection, queue, observability, telemetry) | IMPLEMENT NOW | Inside each slice's acceptance tests. Model/cost telemetry in S0c. |
| `ProcurementDocumentsService.remove()` disposition | ACCEPT AS-IS WITH EVIDENCE | No production caller (only `procurement-documents.service.spec.ts:141,156`). Keep it unexposed per POLICY v1 #9. Re-review in S1. |
| Destructive comparison refresh | IMPLEMENT NOW | S1 |
| Line-item provenance | IMPLEMENT NOW | S3 |
| Catalog match as triage only | IMPLEMENT NOW | S0c, S0f. It stays triage evidence; no score is used as approval. |
| P2 vendor intelligence | IMPLEMENT NOW (after S6) | S9 |
| Seven BFF routes without adjacent specs | IMPLEMENT NOW (opportunistic) | Add each spec when its route is touched. The catalog photo route is touched in S0f. |
| API/AI/UI adjacent-spec gaps (Appendix A §19.8) | ACCEPT AS-IS WITH EVIDENCE | Mostly modules, DTOs, and barrels, covered by e2e or shared specs. Behavior-risk items are covered per slice. Owner re-review: after S2. |
| Retrieval fallback/cache TODOs (`TODOS.md:3,17`) | DEFER WITH REASON | RAG surface, not on the procurement spine. `TODOS.md:17` says threshold 0.45 but `.env.example:80` sets `0.78`; the drift is recorded. |
| Full ticket audit history (`TODOS.md:75`) | DEFER WITH REASON | Single-reviewer use. The S2 decision table pattern can be reused later. |
| Compiled API + Bull runtime failure (`TODOS.md:103`) | IMPLEMENT NOW | S0e (B11) |
| Mnemra/Optra naming drift | IMPLEMENT NOW (docs) · ACCEPT AS-IS WITH EVIDENCE (cookies) | Docs are fixed in rev 4. The `mnemra_*` cookie names are live auth identifiers (`auth.controller.ts:23`, `middleware.ts:28-29`), and renaming them logs out every session. |
| Email intake, Telegram/Viber, ERP, Linear, field-failure copilot, dataset exports, BIR/EWT/VAT | DEFER WITH REASON | POLICY v1 #10, #12. No validated demand, and a portfolio scope. |
| Receiving-exception extension (Appendix B): damage media, vendor notice, bot channel, offline capture, 48 h window | DEFER WITH REASON | Depends on S5 and S6. Shortage and partial acceptance are covered by S5/S6 quantity fields. Damage media, notice send, bot, and offline are deferred for the same reason as messaging. |

### 9.2 Rev 3 §20.4 workstreams

| Workstream | Disposition |
|---|---|
| Intake and documents | S0b, S3, S4 |
| Receiving reality | S5, S6 (shortage, partial, multi-receipt). Damage, late report, and media are deferred (Appendix B). |
| Financial truth | POLICY v1 #3–#6. Price versions in S9. Exposure estimates are deferred. |
| Comparison | S0a, S1, S6 |
| AI controls | S0c. Calibration uses the §2.2 benchmark before any threshold is adopted. |
| AP control | S2, S7. SLA/owner assignment is deferred (single-reviewer). |
| Vendor resolution | DEFER WITH REASON (Appendix B §6) |
| Messaging and offline | DEFER WITH REASON |
| API and tenancy | Every slice (S0a sets the pattern) |
| Web product | S7 |
| Data and operations | §6.7, S0d, S0e. Restore drill is deferred (B22). |
| Verification | §7 and per-slice tests |

### 9.3 Documentation drift fixed in rev 4

| File | Drift | Fix |
|---|---|---|
| `CLAUDE.md:47,383` | "16 tables", "15 e2e suites" | 31 tables; 14 e2e suites |
| `CLAUDE.md:45` | Listed `mnemra.tyvera.app`, `MNEMRA_*` env vars, and `mnemra-prod*` containers as this project's live identifiers | This repo has no `MNEMRA_*` variables (renamed to `OPTRA_*`, `docs/ai/risk-register.md:409`), and its prod compose names containers `optra-prod-*` (`docker-compose.prod.yml:1`). `mnemra.tyvera.app`, `mnemra-prod-*`, and `/home/deploy/apps/mnemra` belong to a separate live app on the same VPS (`risk-register.md:403,410`). The `mnemra_*` cookie names stay live. |
| `docs/ai/testing-strategy.md:170` | "`packages/db`/`packages/ai` still have no test commands" | Both have tests (`:61-62`) |
| `docs/ai/risk-register.md:114,122` | Pre-rename `OwlRepo/mnemra` / `mnemra.tyvera.app` deploy notes | Annotated as historical. `:410` was already accurate: it records that the `mnemra` path belongs to a separate live app, and this repo deploys from `/home/deploy/apps/optra` (`deploy.yml:28`). Four new risk rows were added: token budget, client-visible errors, parser dependencies, backup. |
| `docs/PRODUCTION-READINESS.md:18,36,42` | A6 "no exception filter"; C1 "no Postgres backup"; C7 names `mnemra.tyvera.app` as this deploy | `main.ts:11` installs `AllExceptionsFilter`. A per-deploy `pg_dump` exists (`deploy.yml:65`) but is weak (B22). C7's domain was corrected per `risk-register.md:403,410`. |

Remaining drift is left to its owning slice: `README.md`, `SUMMARY.md`, `docs/ROADMAP.md` (Mnemra-era), and `DOCKER.md:25-26` (ports 3100/3101 vs compose default 3300/3301).

## 10. Decision log and approval checklist

### 10.1 Decision log (rev 3 §16, resolved)

| Decision | Status | Resolution |
|---|---|---|
| Primary target segment | POLICY v1 | Hardware companies, as a portfolio reference product |
| Authoritative receiving artifact | POLICY v1 | Generic Goods Receipt (§2.1 #1) |
| PO/invoice/receiving linkage | POLICY v1 | Explicit user-selected link (#2) |
| Price authority | POLICY v1 | Approved PO unit price (#5) |
| UOM conversion | POLICY v1 | Capture only, never convert (#4) |
| Review/decision vocabulary | POLICY v1 | `false_positive` / `approved_exception` / `vendor_dispute` / `resolved` (#7) |
| Role permissions | POLICY v1 | Existing owner/admin/member (#15) |
| Intake channels | POLICY v1 | Web upload only (#10) |
| Tax scope | POLICY v1 | Out of scope (#12) |
| Retention/export/deletion | POLICY v1 | No hard delete once referenced; export deferred (#9) |
| Deployment topology | FACT + POLICY v1 | Single-VPS compose, processors in API (§3.11, #11) |

### 10.2 Approval checklist (rev 3 §17, updated)

- [x] Replacement for customer evidence recorded (§2 POLICY v1, owner decision 2026-09-20).
- [x] Document taxonomy accepted (PO, invoice, Goods Receipt).
- [x] Receiving source and linkage accepted (§2.1 #1–#2).
- [x] Price/UOM semantics accepted (§2.1 #4–#6).
- [x] Decision states and role matrix accepted (§2.1 #7, #15).
- [x] Retention/deletion stance accepted (§2.1 #9). Export is deferred.
- [ ] PII/model-processing posture: deferred until real user data (§9.1).
- [ ] Golden extraction and comparison fixtures created (§2.2). Each slice creates them as its first failing tests.
- [ ] Migration strategy reviewed per slice (§6.7).
- [ ] Queue/idempotency/retry behavior reviewed (S0b, S8).
- [ ] API contracts reviewed per slice.
- [ ] UI states and evidence requirements reviewed (S7).
- [ ] Security/IDOR test matrix (§7.5), exercised per slice.
- [x] Production-readiness blockers assigned (§9.1).
- [ ] Each slice's own two-layer plan approved before its implementation starts.

## 11. Risks and mitigations

| Risk | Why it is real in current code | Mitigation |
|---|---|---|
| Wrong “three-way” claim | Current comparison is PO/invoice only | Model receiving evidence first; label two-way results honestly |
| Price leakage | Catalog items have no versioned price/terms | Use source-backed effective-dated pricing model |
| False visual matches | Current score is uncalibrated model output | Benchmark; use for triage; require human decision |
| UOM errors | Current line items have no persistent UOM | Customer-approved rules; unknown state; audit corrections |
| Silent data loss on reprocess | Current parse/comparison replace current rows/flags | Introduce revisions/runs before historical controls are promised |
| Manual workflow does not scale | User selects document pair and triggers match | Add link suggestions and automatic orchestration after contracts stabilize |
| Tenant data exposure | App-level predicates are primary current defense | IDOR tests; storage checks; defense-in-depth deployment controls |
| Queue coupling | Processors run in API process | Measure; separate workers before scale |
| Model cost explosion | Candidate verification runs in parallel; no match queue/cost budget | Candidate cap, budgets, concurrency, telemetry |
| Prompt injection | Vendor-controlled text/images enter extraction/match prompts | Treat all supplier content as untrusted; isolate instructions; test fixtures |
| Unsupported integrations | No messaging/webhook implementation found | Validate demand and provider contracts before building |
| Tax liability | BIR/EWT semantics are jurisdiction and fact dependent | Tax-professional review; versioned rules; explicit human control |
| Stale docs mislead execution | Root README and parts of readiness docs conflict with source | Maintain source-of-truth register; update docs during implementation |
| Silent truncation / data loss in current compare | `MAX_RESULT_ROWS = 500` (B3); delete-then-insert without a transaction (B2); dismissals deleted on re-run (B1) | S0a, S1 |
| LLM spend outside the budget | B12: only chat is budgeted | S0c |
| Unreviewed code reaching production | Closed by S0d (2026-09-20): a push to `main` deploys only after the `ci` job passes. Residual — CI proves type-check, lint, and the unit suites, **not** e2e, and a docs-only push still skips both jobs, so a `workflow_dispatch` is the way to force a deploy after one. | S0d. Owner-approved pushes only. |
| Irreversible schema change | Migrations auto-apply on start; no down migrations (§3.11) | Additive migrations, flag-off rollout (§6.7, §8.1) |
| Background jobs failing silently | B9 retries never fire, B10 stuck docs, B11 compiled build | S0b, S0e |

## 12. Explicit non-goals until validated

- automatic payment approval;
- automatic supplier payment release;
- universal `0.85` model threshold;
- claim that every line is matched;
- catalog scrape as authoritative price truth;
- a single `catalog_price` field as contract model;
- universal UOM conversion;
- BIR form generation or universal EWT rates;
- production Telegram/Viber workflow;
- direct ERP/accounting integration;
- broad AI-operations positioning as the first product;
- eight-week delivery guarantee before sample size and contracts are known;
- destructive removal of current routes or tables without migration/use analysis.

## 13. Metrics and observability

### Product metrics

**PROPOSED north-star metric:** verified financial risk prevented per customer per month.

Supporting metrics:

- documents uploaded and successfully parsed;
- line items processed;
- percentage with source provenance;
- percentage auto-classified as matched/ambiguous/needs review;
- discrepancy value by type;
- human review minutes per exception;
- decision turnaround time;
- false-positive and missed-discrepancy rates on labeled fixtures;
- confirmed prevented leakage;
- repeat vendor issue rate;
- model cost per document/line/reviewed exception.

### Operational telemetry

- queue depth, age, retry count, dead/failure count;
- parse duration by format/page count;
- comparison duration by line count;
- model latency, token/cost estimate, timeout rate;
- storage read/write failures;
- evidence-link authorization failures;
- database connection saturation;
- audit write failures.

Never calculate financial savings from unreviewed model flags alone. Use reviewed outcomes and clearly label estimates.

## Final recommendation

1. Treat POLICY v1 (§2) as the product contract. Stop waiting for customer evidence that this project will never have.
2. Fix the verified integrity defects first (S0a–S0f). They affect the correctness of today's data: truncation, dismissal loss, non-atomic writes, dead retries, and unbudgeted LLM calls.
3. Build the evidence and decision spine in slice order: S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8, then S9.
4. Use AI to extract, rank, and explain. It never authorizes money.
5. Ship every slice additive and dark-launched, and push only with owner approval (§3.11, §6.7, §8.1).
6. Keep this file as the living plan. Update §4 and §9 status with each slice, and revise §2 if real customer evidence ever appears.

## Appendix A — Repository-wide coverage audit (rev 3 §19, corrected in rev 4)

*Rev 3 subsection numbers (§19.x) are kept so that existing cross-references still resolve.*

### 19.1 What “100% coverage” can defensibly mean

**FACT:** every tracked repository path was inventoried by `git ls-files` and categorized. High-value runtime surfaces were then inspected through source, route, schema, queue, test, configuration, deployment, seed, evaluation, and documentation searches.

**FACT:** at rev 4 (`bf6d38d`) the repository has 917 tracked files. Rev 3 counted 916 at `469317e`, before this plan was committed. The following top-level inventory is disjoint and reconciles exactly (rev 4 counts):

| Top-level tracked scope | Files | Notes |
|---|---:|---|
| `apps` | 505 | Includes API, web, tests, package configs, and app assets |
| `packages` | 204 | Includes AI, DB, UI, types, migrations, configs, and package assets |
| `scripts` | 35 | Seed, evaluation, deployment, and maintenance scripts |
| `docs` | 23 | Product, operations, design, and AI engineering docs (includes this plan) |
| `.ai-engineering` | 44 | Engineering workflow/configuration material |
| `.claude` | 70 | Tracked hooks/settings plus symlink entries listed below |
| `graphify-out` | 9 | Generated graph artifacts; supporting evidence only |
| `docker` | 7 | Container and SeaweedFS configuration |
| `.github` | 1 | Deployment workflow |
| root files | 19 | Root manifests, env template, compose, and project docs |
| **Total** | **917** | Exact `git ls-files` count at `bf6d38d` |

Detailed source/test counts within the top-level totals:

| Source/test surface | Tracked files |
|---|---:|
| `apps/api/src` | 195 |
| `apps/api/test` | 17 |
| `apps/web/app` | 176 |
| `apps/web/src` | 95 |
| `packages/ai/src` | 64 |
| `packages/db/src` | 35 |
| `packages/ui/src` | 41 |
| `packages/types/src` | 1 |

The remaining `apps` and `packages` files are configuration, manifests, migrations, snapshots, public assets, and other tracked non-runtime files; they are included in the disjoint top-level totals and were separately classified.

Tracked file-type totals:

- 528 `.ts`
- 116 `.tsx`
- 4 `.mts`
- 2 `.js`
- 6 `.py`
- 10 `.sh`
- 23 `.sql`
- 132 `.md` (131 at rev 3)
- 60 `.json`
- remaining assets/configuration/data files

**Boundary:** this is 100% inventory coverage, not a claim that every line is semantically correct or that unavailable external dependencies have been executed. Static analysis cannot verify customer policy, provider behavior, deployment state, or real document accuracy.

**FACT:** 64 tracked `.claude/skills` entries are symlinks whose targets are outside this repository. They are counted as repository paths, but their external targets are not application source and were not treated as part of the product code corpus. The tracked `graphify-out/COVERAGE_REPORT.md` reports 752 detected/represented source files, 39 semantic files, 9,853 raw relationships, and 31 zero-symbol files; graph output was used as a relationship cross-check only. Current source paths, routes, schemas, and tests remain authoritative.

### 19.2 Complete runtime domain map

| Domain | Verified implementation | Status against hardware-company target | Required action |
|---|---|---|---|
| Auth | Registration, OTP verification, login, access/refresh tokens, logout, current-user, change-password; `apps/api/src/auth`, `apps/web/app/(auth)`, `apps/web/app/api/auth` | Existing platform foundation | Verify production secret/session/email policy; decide password recovery and account-management scope; preserve role/tenant tests |
| Workspaces/RBAC | Workspace create/list/get/rename, invitations, accept-invite, members list/remove; `apps/api/src/workspaces` | Existing tenant foundation; only owner/admin/member roles | Confirm finance/procurement role matrix; decide whether role editing, deactivation, and ownership transfer are required |
| Workspace events | Activity feed, unread count, mark-seen; terminal events from ingest/scrape/ticket flows | Existing operational feedback; procurement/catalog events absent from enum | Add procurement/control-run events after run model; make event failure policy observable |
| Knowledge bases | Create/list/delete workspace knowledge bases | Existing RAG container | Decide whether AP evidence is isolated from support knowledge; define retention and access boundary |
| Documents/ingest | Upload/list/download/delete, bulk download/delete, queued ingestion, chunking/embedding path | Existing generic document ingestion; not procurement evidence | Reuse only where safe; add procurement-specific provenance/revision semantics; verify deletion/retention behavior |
| Web scraping | Crawl start/list, robots/SSRF/limits, scrape queue, document creation | Existing support/web-source capability; not contract truth | Keep discovery-only; define legal/robots policy; do not use scraped values as authoritative pricing |
| Search | Grouped document/ticket/chat search | Existing support search; no procurement review search | Add review/run/vendor/PO/invoice search only if customer workflow requires it; preserve workspace scoping |
| Chat/RAG | Streaming answer, retrieval, graph path, citations, history, cache, structured query, rate/usage limits | Existing support assistant; not financial authority | Keep separate from deterministic procurement decisions; calibrate retrieval; resolve open fallback/cache TODOs |
| Refine | Message rewrite, save/list refined messages, daily limit/status | Existing convenience feature; not procurement core | Retain/defer decision; document supported model role and limit configuration |
| Tickets | Transcript intake, deduplication, async extraction, editable review fields, usefulness/indexing, transcript PDF | Existing support-ticket copilot foundation | Validate hardware field-failure use case; add full history only if multi-reviewer need is proven; keep Linear integration deferred until demand |
| Datasets | CSV/XLSX upload, profiling queue, list/delete, semantic dataset selection | Existing structured analytics surface | Keep separate from canonical procurement truth; add normalized procurement exports later if useful |
| Structured query | Sandboxed DuckDB read-only SQL, ticket/dataset flows, candidate selection, result verbalization | Existing analytics surface with safety controls | Reuse for reporting only; never make ephemeral DuckDB state the source of UOM/contract truth |
| Insights | Freshness flags, coverage dashboard, FAQ clustering/drafts, digest settings/preview/email, scheduled jobs | Existing support/RAG quality loop | Add procurement metrics only after reviewed decisions exist; do not mix support quality with financial-control KPIs |
| Notifications | Resend/console fallback for OTP, invites, digest email | Existing email-only delivery | Verify sender/domain, failure monitoring, data-processing policy; messaging channels not implemented |
| Storage | S3-compatible save/read/temp/delete/bucket setup | Existing object-storage seam | Add retention/lifecycle/export/delete policy; verify object authorization and backup/restore |
| Vendor/catalog | Vendor CRUD, catalog PDF/CSV/XLSX parse, site scrape, image fetch, manual catalog matching | Existing manual sourcing/compliance evidence | Add versioned price/UOM/alias/contract model; calibrate matching; keep catalog scrape non-authoritative |
| Procurement | PO/invoice upload/parse, manual two-way compare, discrepancy list/dismiss | Existing narrow prototype | Build receiving evidence, provenance, normalization, comparison runs, decisions, audit, queue orchestration, review UI |
| Platform | Nest bootstrap, global validation/filter/throttle, Bull/Redis, Docker, Caddy, deployment scripts, health endpoint | Runnable foundation with production gaps | Reconcile config/docs; prove service topology, restore, monitoring, CI gates, and worker behavior before customer data |
| Product process | `.ai-engineering`, `.claude`, `CLAUDE.md`, planning/evidence templates | Process/control material, not runtime product | Preserve as operating policy; reconcile stale generated maps; do not treat maps as source truth |

### 19.3 Complete API controller inventory

**FACT:** 17 API controller files exist. Current route groups and endpoints:

| Controller/base | Current endpoints |
|---|---|
| `/auth` | `POST register`, `POST verify-otp`, `POST login`, `POST refresh`, `POST logout`, `GET me`, `POST change-password` |
| `/health` | `GET` |
| `/workspaces` | `POST`, `GET me`, `POST accept-invite/:token`, `GET :workspaceId`, `POST :workspaceId/invite`, `PATCH :workspaceId`, `GET :workspaceId/members`, `DELETE :workspaceId/members/:userId` |
| `/workspaces/:workspaceId/events` | `GET`, `GET unread-count`, `POST mark-seen` |
| `/workspaces/:workspaceId/knowledge-bases` | `POST`, `GET`, `DELETE :kbId` |
| `/workspaces/:workspaceId/knowledge-bases/:kbId/documents` | `POST`, `GET`, `POST download`, `POST delete`, `GET :documentId/download`, `DELETE :documentId` |
| `/workspaces/:workspaceId/knowledge-bases/:kbId` | `POST scrape`, `GET scrape-runs` |
| `/workspaces/:workspaceId/search` | `GET` |
| `/workspaces/:workspaceId/chat` | `POST`, `GET sessions`, `GET sessions/:sessionId/messages` |
| `/workspaces/:workspaceId/refine` | `POST`, `GET status`, `POST saved`, `GET saved` |
| `/workspaces/:workspaceId/tickets` | `POST`, `GET`, `GET :ticketId/transcript.pdf`, `GET :ticketId`, `PATCH :ticketId` |
| `/workspaces/:workspaceId/datasets` | `POST`, `GET`, `DELETE :datasetId` |
| `/workspaces/:workspaceId/insights` | `GET freshness-flags`, `GET coverage`, `PATCH freshness-flags/:flagId/dismiss` |
| `/workspaces/:workspaceId/insights/faq-drafts` | `GET`, `PATCH :draftId/approve`, `PATCH :draftId/reject` |
| `/workspaces/:workspaceId/digest-settings` | `GET`, `PATCH`, `GET preview` |
| `/workspaces/:workspaceId/procurement` | `POST/GET purchase-orders`, `POST/GET invoices`, `POST discrepancies/compare`, `GET discrepancies`, `PATCH discrepancies/:flagId/dismiss` |
| `/workspaces/:workspaceId` catalog surface | `POST/GET vendors`, `POST/GET vendors/:vendorId/catalogs`, `POST vendors/:vendorId/catalogs/scrape`, `GET vendors/:vendorId/catalogs/:catalogId/items`, `GET catalog-items/:itemId/photo`, `POST catalog-matches/search`, `POST vendors/:vendorId/catalog-matches/verify`, `GET catalog-matches`, `PATCH catalog-matches/:matchId/dismiss` |

**Required API work:** every new receiving, price, UOM, comparison-run, evidence, decision, audit, export, and integration endpoint must be added to the route inventory, DTO validation, BFF mapping, RBAC matrix, API contract, e2e matrix, and rate/cost policy before implementation approval.

### 19.4 Complete web surface inventory

**FACT:** current user-visible page files:

```text
/(auth)/login
/(auth)/register
/(auth)/verify-otp
/chat
/invite/[token]
/workspaces
/workspaces/[id]
/workspaces/[id]/chat
/workspaces/[id]/catalog-matches
/workspaces/[id]/datasets
/workspaces/[id]/discrepancies
/workspaces/[id]/insights
/workspaces/[id]/knowledge-bases
/workspaces/[id]/knowledge-bases/[kbId]
/workspaces/[id]/members
/workspaces/[id]/procurement
/workspaces/[id]/settings
/workspaces/[id]/tickets
/workspaces/[id]/vendors
/workspaces/[id]/vendors/[vendorId]
```

Shared frontend surfaces include the app shell, workspace navigation/search, mobile navigation, chat streaming/thinking/jump controls, landing-page sections, comparison table, brand assets, and shared UI primitives under `apps/web/src` and `packages/ui/src`.

**FACT:** 59 same-origin BFF route files exist under `apps/web/app/api`; 52 have adjacent route specs. Seven BFF route files have no adjacent route spec:

```text
apps/web/app/api/invitations/accept/[token]/route.ts
apps/web/app/api/workspaces/[id]/catalog-items/[itemId]/photo/route.ts
apps/web/app/api/workspaces/[id]/invite/route.ts
apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/documents/[docId]/route.ts
apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/route.ts
apps/web/app/api/workspaces/[id]/knowledge-bases/route.ts
apps/web/app/api/workspaces/[id]/members/[userId]/route.ts
```

**Required web work:** add the intake/review/evidence/decision route surfaces only after API contracts are fixed; add specs for the seven current BFF gaps and for every new proxy; add browser-level critical-flow coverage when the review flow stabilizes.

### 19.5 Complete database inventory

**FACT:** `packages/db/src/schema` has 31 files: 30 table files plus `index.ts`. They define **31** PostgreSQL tables, because `chatSessions.ts` defines both `chat_sessions` and `chat_messages`. There are 22 numbered SQL migrations (`0000`–`0021`) with 22 snapshots. The schema has **19** `pgEnum` declarations. *(Corrected in rev 4. Rev 3 said 30 tables and 18 enums, and its table list left out `scrape_runs`.)*

Tables grouped by responsibility:

- **Identity/tenancy:** `users`, `workspaces`, `workspace_members`, `invitations`, `otps`, `refresh_tokens`.
- **Knowledge/RAG:** `knowledge_bases`, `documents`, `chunks`, `scrape_runs`, `chat_sessions`, `chat_messages`, `chat_cache`, `chat_query_metrics`, `saved_refined_messages`.
- **Support/quality:** `tickets`, `document_review_flags`, `faq_drafts`, `background_runs`, `workspace_digest_settings`, `workspace_events`.
- **Analytics:** `datasets`.
- **Procurement:** `purchase_orders`, `invoices`, `po_line_items`, `invoice_line_items`, `discrepancy_flags`.
- **Catalog/vendor:** `vendors`, `catalogs`, `catalog_items`, `catalog_matches`.

Enums:

```text
workspace_member_role: owner, admin, member
document_status: pending, processing, done, failed
scrape_run_status: queued, running, completed, failed
chat_message_role: user, assistant
ticket_edit_state: accepted, heavily_edited
ticket_severity: low, medium, high
ticket_status: pending, processing, done, failed
ticket_usefulness: useful, not_useful
workspace_event_type: document_ingested, document_failed, scrape_completed, scrape_failed, ticket_extracted, ticket_failed
background_run_status: queued, running, succeeded, failed
document_review_flag_status: open, dismissed
faq_draft_status: pending, approved, rejected
dataset_status: pending, processing, done, failed
procurement_doc_status: pending, processing, done, failed
discrepancy_flag_status: open, dismissed
discrepancy_flag_type: quantity_mismatch, price_mismatch, missing_on_invoice, missing_on_po
catalog_doc_status: pending, processing, done, failed
catalog_match_type: sourcing, compliance
catalog_match_status: open, dismissed
```

**Required database work:** extend the procurement area additively only after Gate 0. Do not repurpose support tables for financial evidence without an accepted ownership/retention model. Add indexes for workspace, source linkage, status, run, vendor, effective date, and review queue access based on real query plans.

### 19.6 Complete asynchronous-job inventory

**FACT:** 15 Bull queues and 15 processor classes exist:

```text
ingest-queue
scrape-queue
ticket-extraction-queue
dataset-profiling-queue
freshness-tick-queue
freshness-check-queue
faq-cluster-tick-queue
faq-cluster-queue
topic-gap-tick-queue
topic-gap-queue
digest-tick-queue
digest-queue
procurement-parse-queue
catalog-parse-queue
catalog-scrape-queue
```

Scheduled tick processors currently drive freshness checks, FAQ clustering, topic-gap analysis, and digest generation. Parse/extraction processors handle documents, tickets, procurement files, catalogs, datasets, and scrapes.

**FACT:** there is no procurement comparison/match queue and no catalog-match queue. Current catalog matching is request-triggered/manual. Current processors are registered in the API process; no separate worker service is declared in the current application module/compose topology.

**Required async work:** add run orchestration only after the canonical model exists; define idempotency, retry, timeout, cost, partial failure, reconciliation, and worker separation behavior for each new job.

### 19.7 Complete AI and data-processing inventory

AI chain surfaces:

```text
answer / graph / classify / condense / context / history / models
text-to-sql / refine / ticket-extraction / procurement-extraction
catalog-match / faq-draft / topic-label
```

Data-processing surfaces:

```text
loaders: csv, docx, eml, html, json, msg, pdf, pptx, txt, xlsx, yaml
pdf-render
chunking
embeddings
vectorstore
tracing
web crawl + SSRF validation
token accounting
```

**FACT:** the current shared model resolver supports role-specific environment names for answer, rewrite, grade, extraction, refine, condense, SQL, FAQ, and procurement, with fallback to `OPENAI_CHAT_MODEL` and then `gpt-4-turbo` (`packages/ai/src/chains/models.ts`).

**Required AI work:**

- add procurement golden fixtures and line-level evaluation;
- calibrate matching/threshold behavior from labeled examples;
- record provider/model/version where output affects review;
- separate extraction confidence, match confidence, and decision state;
- enforce prompt-injection and untrusted-supplier-content controls;
- measure cost/latency/error rates;
- close or explicitly accept the open retrieval fallback/cache TODOs in `TODOS.md`;
- test every loader actually supported by product claims, not merely exported by the package.

### 19.8 Complete test inventory and test gaps

**FACT:** tracked test files:

| Area | Test files |
|---|---:|
| API unit | 59 |
| API e2e | 14 |
| Web | 124 |
| AI | 25 |
| DB | 1 |
| UI | 11 |
| Seed | 2 |

**FACT:** adjacent-spec pairing found these current candidate gaps. Lack of an adjacent spec is not proof that a behavior has zero coverage; some behavior is covered by e2e or shared tests. It is a reliable inventory of files requiring explicit coverage review.

API source files without adjacent `*.spec.ts`:

```text
apps/api/src/app.module.ts
apps/api/src/auth/auth.controller.ts
apps/api/src/auth/auth.module.ts
apps/api/src/auth/decorators/current-user.decorator.ts
apps/api/src/auth/decorators/current-workspace-member.decorator.ts
apps/api/src/auth/decorators/roles.decorator.ts
apps/api/src/auth/dto/change-password.dto.ts
apps/api/src/auth/dto/login.dto.ts
apps/api/src/auth/dto/register.dto.ts
apps/api/src/auth/dto/verify-otp.dto.ts
apps/api/src/auth/guards/jwt-auth.guard.ts
apps/api/src/auth/strategies/jwt.strategy.ts
apps/api/src/cache/cache.module.ts
apps/api/src/catalog/catalog.controller.ts
apps/api/src/catalog/catalog.module.ts
apps/api/src/catalog/dto/catalog-match.dto.ts
apps/api/src/catalog/dto/create-vendor.dto.ts
apps/api/src/catalog/dto/list-catalog-matches-query.dto.ts
apps/api/src/catalog/dto/scrape-catalog.dto.ts
apps/api/src/chat/chat.controller.ts
apps/api/src/chat/chat.module.ts
apps/api/src/chat/dto/chat.dto.ts
apps/api/src/chat/dto/list-chat-sessions-query.dto.ts
apps/api/src/datasets/dataset-profiling.service.ts
apps/api/src/datasets/datasets.controller.ts
apps/api/src/datasets/datasets.module.ts
apps/api/src/documents/documents.module.ts
apps/api/src/documents/dto/delete-many.dto.ts
apps/api/src/documents/dto/download-many.dto.ts
apps/api/src/documents/dto/list-documents-query.dto.ts
apps/api/src/events/dto/list-events-query.dto.ts
apps/api/src/events/events.controller.ts
apps/api/src/events/events.module.ts
apps/api/src/ingest/ingest.module.ts
apps/api/src/insights/background-runs.service.ts
apps/api/src/insights/digest-settings.controller.ts
apps/api/src/insights/digest-tick.processor.ts
apps/api/src/insights/dto/update-digest-settings.dto.ts
apps/api/src/insights/faq-cluster-tick.processor.ts
apps/api/src/insights/faq-drafts.controller.ts
apps/api/src/insights/freshness-tick.processor.ts
apps/api/src/insights/insights.controller.ts
apps/api/src/insights/insights.module.ts
apps/api/src/insights/topic-gap-tick.processor.ts
apps/api/src/knowledge-bases/dto/create-knowledge-base.dto.ts
apps/api/src/knowledge-bases/knowledge-bases.controller.ts
apps/api/src/knowledge-bases/knowledge-bases.module.ts
apps/api/src/limits/chat-rate-limit.guard.ts
apps/api/src/limits/limits.module.ts
apps/api/src/main.ts
apps/api/src/notifications/notifications.module.ts
apps/api/src/procurement/dto/compare-documents.dto.ts
apps/api/src/procurement/dto/list-discrepancies-query.dto.ts
apps/api/src/procurement/procurement.controller.ts
apps/api/src/procurement/procurement.module.ts
apps/api/src/refine/dto/refine.dto.ts
apps/api/src/refine/dto/save-refined-message.dto.ts
apps/api/src/refine/refine.controller.ts
apps/api/src/refine/refine.module.ts
apps/api/src/refine/refine.rate-limit.guard.ts
apps/api/src/scrape/dto/list-scrape-runs-query.dto.ts
apps/api/src/scrape/dto/scrape.dto.ts
apps/api/src/scrape/scrape.controller.ts
apps/api/src/scrape/scrape.module.ts
apps/api/src/search/search.controller.ts
apps/api/src/search/search.module.ts
apps/api/src/storage/storage.module.ts
apps/api/src/structured-query/structured-query.module.ts
apps/api/src/tickets/dto/create-ticket.dto.ts
apps/api/src/tickets/dto/list-tickets-query.dto.ts
apps/api/src/tickets/dto/update-ticket.dto.ts
apps/api/src/tickets/tickets.module.ts
apps/api/src/workspaces/dto/create-workspace.dto.ts
apps/api/src/workspaces/dto/invite-member.dto.ts
apps/api/src/workspaces/dto/list-members-query.dto.ts
apps/api/src/workspaces/dto/update-workspace.dto.ts
apps/api/src/workspaces/workspaces.controller.ts
apps/api/src/workspaces/workspaces.module.ts
```

AI source files without adjacent specs:

```text
packages/ai/src/chunking/index.ts
packages/ai/src/chunking/types.ts
packages/ai/src/embeddings/index.ts
packages/ai/src/embeddings/types.ts
packages/ai/src/loaders/csv.ts
packages/ai/src/loaders/docx.ts
packages/ai/src/loaders/eml.ts
packages/ai/src/loaders/html.ts
packages/ai/src/loaders/index.ts
packages/ai/src/loaders/json.ts
packages/ai/src/loaders/msg.ts
packages/ai/src/loaders/pptx.ts
packages/ai/src/loaders/txt.ts
packages/ai/src/loaders/types.ts
packages/ai/src/loaders/xlsx.ts
packages/ai/src/loaders/yaml.ts
packages/ai/src/tracing/index.ts
```

UI source files without adjacent specs:

```text
packages/ui/src/components/ui/avatar.tsx
packages/ui/src/components/ui/badge.tsx
packages/ui/src/components/ui/button.tsx
packages/ui/src/components/ui/card.tsx
packages/ui/src/components/ui/chat-bubble.tsx
packages/ui/src/components/ui/empty-state.tsx
packages/ui/src/components/ui/input.tsx
packages/ui/src/components/ui/page-section.tsx
packages/ui/src/components/ui/page-shell.tsx
packages/ui/src/components/ui/select.tsx
packages/ui/src/components/ui/separator.tsx
packages/ui/src/components/ui/skeleton.tsx
packages/ui/src/components/ui/stat-card.tsx
packages/ui/src/components/ui/status-banner.tsx
packages/ui/src/components/ui/table.tsx
packages/ui/src/components/ui/textarea.tsx
packages/ui/src/index.ts
packages/ui/src/lib/utils.ts
```

**Required test work:** prioritize behavior and risk, not blind one-spec-per-file counting:

1. API controller/RBAC/IDOR coverage for every new and existing financial route.
2. Migration and database isolation tests.
3. Queue idempotency/retry/reconciliation tests.
4. Golden procurement extraction/comparison/UOM/price fixtures.
5. BFF auth forwarding and binary-resource authorization.
6. Browser critical-flow coverage for the review queue.
7. AI loader and model-failure tests for every claimed input format.
8. UI accessibility/state tests for evidence and decision components.

### 19.9 Configuration and environment audit

**FACT:** configuration is read through both `process.env` and Nest `ConfigService`. The source supports operational/configuration keys beyond the minimum product keys documented in `.env.example`.

Keys requiring reconciliation between source, `.env.example`, docs, local compose, production compose, and validation scripts:

```text
BULL_PREFIX
COVERAGE_LOW_SCORE_THRESHOLD
COVERAGE_SUMMARY_WINDOW_DAYS
DIGEST_CRON
DIGEST_WINDOW_DAYS
FAQ_CLUSTER_CRON
FAQ_CLUSTER_SIMILARITY_THRESHOLD
FAQ_MIN_CLUSTER_SIZE
FRESHNESS_CHECK_CRON
FRESHNESS_LOOKBACK_DAYS
FRESHNESS_MIN_SCORE
LANGCHAIN_TRACING_V2
LANGSMITH_TRACING
NODE_ENV
OPENAI_TIMEOUT_MS
REFINE_DAILY_LIMIT_PER_USER
SEED_ALLOW_REMOTE
SEED_REDIS_HOST
SEED_REDIS_PORT
SEED_S3_ENDPOINT
SEMANTIC_CACHE_TTL_HOURS
STRUCTURED_QUERY_AMBIGUOUS_GAP
STRUCTURED_QUERY_COMPARISON_MIN_SCORE
STRUCTURED_QUERY_MIN_SCORE
TICKET_SLOT_MIN_SCORE
TICKET_SLOT_RESERVE
TOPIC_GAP_CRON
TOPIC_GAP_LOOKBACK_DAYS
TOPIC_GAP_MAX_CANDIDATES
TOPIC_GAP_MAX_LABELED_CLUSTERS
OPENAI_REFINE_MODEL
OPENAI_SQL_MODEL
OPENAI_FAQ_MODEL
```

Some are defaults, test-only overrides, seed-only controls, or dynamically resolved optional model roles—not automatically defects. They must nevertheless be classified as required, optional, internal, test-only, or deprecated.

**FACT:** `scripts/verify-env.sh` checks only a subset of runtime requirements. **Required:** replace subset-only validation with environment profiles that fail clearly for missing/unsafe production secrets and validate cross-service URL/port compatibility.

**FACT:** local host/container Redis ports are intentionally different but documented inconsistently across surfaces: `.env.example` sets `REDIS_PORT=6379`, local `docker-compose.yml` publishes host `6380:6379`, and `scripts/seed/config.ts` explicitly defaults host-side seed access to `6380` while noting the mismatch (`.env.example:12`, `docker-compose.yml:24-27,71`, `scripts/seed/config.ts:24-30`). Inside the Compose network, the API correctly uses Redis port `6379`; this is a topology/documentation distinction, not by itself proof of an in-network failure. It must be made explicit in the environment contract before service-backed development or test execution.

**FACT:** `apps/api/src/main.ts:16` hardcodes the API listen port to `3001`; local and production Compose expose/map that internal port separately (`docker-compose.yml`, `docker-compose.prod.yml`). Preserve this internal/external distinction in any deployment or health-check change rather than introducing a second port source without verification.

Configuration tasks:

- define one canonical variable inventory;
- remove stale names or document compatibility aliases;
- validate JWT, database, Redis, S3, OpenAI, Resend, public/API URLs, and production domain settings;
- separate build-time web variables from runtime API variables;
- define safe defaults only for local/test values;
- prohibit seed remote writes unless explicitly authorized;
- document cron ownership and duplicate-scheduler behavior;
- record model role resolution and effective values without logging secrets.

### 19.10 Deployment, CI, and operations audit

**FACT:** local compose declares PostgreSQL, Redis, SeaweedFS, API, and web. Production compose adds Caddy and persistent volumes. Current API and web Dockerfiles build/run the application; queue processors remain within the API process.

**FACT:** `.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatch. It SSHes to the VPS, checks out code, creates a PostgreSQL dump backup, builds API/web images, recreates the stack, runs health checks, and prints logs on failure. It is not a pull-request quality gate. *(Rev 4: §3.11 has the full step list. It includes the auto-stash, `cancel-in-progress`, and the S3 round trip, and it has no migrate or test step. Migrations run from the API container start command, `apps/api/Dockerfile:99`.)*

**FACT:** `scripts/deploy.sh` and `scripts/deploy-remote.sh` implement direct VPS deployment. `scripts/verify-env.sh` performs preflight checks. `docker/Caddyfile` handles reverse-proxy/HTTPS concerns.

Required production work before customer AP data:

- CI checks on pull requests: type-check, lint, build, relevant tests, migration validation;
- staging environment matching production topology;
- PostgreSQL backup retention and tested restore, not only dump creation;
- object-storage backup/restore and lifecycle policy;
- error/queue/database/storage monitoring and alerting;
- worker/API separation decision and graceful shutdown;
- database pool and concurrency limits;
- secret rotation and incident response;
- PII/model-processing/DPA/no-training/redaction decision;
- tenant export/delete and retention execution;
- immutable procurement decision/audit storage;
- deployment rollback and migration compatibility procedure;
- health endpoint checks that prove dependencies, not only process liveness.

### 19.11 Documentation/source-of-truth audit

**FACT:** several documents are historical or generated context, not authoritative behavior:

- `README.md` and `SUMMARY.md` retain older Mnemra/RAG setup and TODO claims that conflict with current Optra code.
- `docs/ai/module-ownership-map.md` explicitly says it is a map, not proof; it contains stale/context-drift entries.
- `docs/PRODUCTION-READINESS.md` contains useful gap evidence but some rows conflict with current source; `apps/api/src/main.ts` currently installs `AllExceptionsFilter`.
- `docs/ai/contracts/*`, architecture maps, and planning docs require source verification.
- `CLAUDE.md` is the operating constraint for deep work and requires unknown schema/permission/integration details to remain unverified.
- *(Rev 4)* Verified drift was found in `CLAUDE.md:45,47,383`, `docs/ai/testing-strategy.md:170`, `docs/ai/risk-register.md:114,122`, `docs/PRODUCTION-READINESS.md:18,36,42`, and `DOCKER.md:25-26`. See §9.3.

Required documentation work:

1. Declare source hierarchy: runtime code/tests/migrations first; contracts/docs second; historical summaries last.
2. Reconcile stale README/SUMMARY/roadmap claims.
3. Mark context drift and unverified entries in generated maps.
4. Add the accepted procurement domain contract, data dictionary, permission matrix, event catalog, queue catalog, and configuration catalog.
5. Keep this plan as the implementation dependency map; link each completed task to code/tests/evidence.

### 19.12 Complete “things that actually need to be done” inventory

The following is the executable backlog derived from the audit. “Required” means necessary for the target product or production safety. “Conditional” means only after evidence proves demand/need.

#### P0 — unblock trustworthy execution

- Resolve Gate 0 customer documents and process answers.
- Benchmark current extraction and two-way comparison on representative hardware-company documents.
- Decide authoritative receiving artifact, linkage fields, price semantics, UOM semantics, decision states, and role matrix.
- Decide and correct the current XLSX source-preservation behavior: `sourceKind` collapses XLSX into `csv`, and parsing overwrites the uploaded object with derived CSV. Provenance/evidence work cannot safely build on that behavior unchanged.
- Decide procurement source-document access and retention. No procurement download/view endpoint or client/BFF path currently exists; generic knowledge-base document downloads are not interchangeable.
- Add defense-in-depth workspace predicates and relational-integrity/IDOR tests for procurement child reads, writes, deletes, and future evidence links. Current parent checks are useful, but `ComparisonService` child reads use parent IDs without repeating `workspaceId`.
- Freeze source-of-truth hierarchy and reconcile documentation drift.
- Reconcile configuration inventory, the host/container Redis-port contract, and production environment validation.
- Establish database, Redis, object storage, and model test prerequisites.
- Add CI quality gates and staging before customer data.
- Define backup/restore, retention/export/delete, PII processing, and incident response.
- Verify deployment runtime, Node/Bun compatibility, compiled API worker behavior, and graceful shutdown.

#### P1 — procurement control spine

- Canonical document/evidence/revision model.
- Receiving/DR/GRN domain and multiple-receipt support.
- Vendor identity and document-link resolution.
- Versioned price/contract evidence.
- Persistent UOM/alias/conversion rules.
- Comparison-run model and deterministic result lifecycle.
- Explicit matched/unmatched/ambiguous/duplicate/insufficient-evidence states.
- Provenance from source page/sheet/row/field to every material value.
- Human decision and immutable audit history.
- Automatic post-parse orchestration with idempotent jobs.
- Model confidence calibration and cost/latency limits.
- Procurement/catalog/workspace event coverage.
- API/BFF contracts and workspace/role enforcement.

#### P1 — review product surface

- Intake workspace for PO/invoice/receiving files.
- Link suggestions with human confirmation.
- Review queue with evidence, blocking reasons, owner, and SLA state.
- Side-by-side evidence drawer.
- Raw-versus-normalized display.
- Decision actions and history.
- Pagination, filtering, refresh-safe status, partial-failure UX.
- Accessibility and mobile behavior.
- Critical browser-flow tests.

#### P1 — verification and security

- Migration/rollback and data-repair runbooks.
- Golden extraction/comparison/UOM/price fixtures.
- API e2e with real service dependencies.
- IDOR/cross-workspace/storage authorization tests.
- Upload/content/page/SSRF/prompt-injection tests.
- Queue retry/reconciliation/duplicate tests.
- Production observability and audit-write failure handling.
- Model/provider/version/cost telemetry.

#### P1 — verified current seams that require an explicit disposition

- `ProcurementDocumentsService.remove()` exists but is not exposed by the current controller or web client. Mark it `IMPLEMENT NOW`, `RETIRE AFTER DEPENDENCY CHECK`, or `ACCEPT AS-IS WITH EVIDENCE`; never expose deletion casually once decisions/evidence depend on the record.
- Current comparison deletes prior flags for a PO/invoice pair before inserting the next result. Implement comparison runs/revisions before promising historical audit or reproducible prior decisions.
- Current line-item rows contain `rawRow` but no source page/sheet/row/field coordinates or extraction-provider/version metadata. Implement provenance at the persistence seam, not only in UI labels.
- Current catalog matching is request-triggered and capped to eight candidates, but has no durable run, calibration, price, UOM, or reviewer-decision model. Keep it evidence/triage-only until those contracts exist.

#### P2 — vendor intelligence

- Price history and applicability queries.
- Approved aliases/substitutions.
- Review-outcome feedback loop.
- Evidence-backed vendor scorecards.
- Exception exports and audit reports.
- Historical recalculation/version behavior.

#### P2 — current platform gaps to close or explicitly accept

- Seven BFF routes without adjacent specs.
- API controller/module/DTO/guard coverage gaps listed above.
- AI loader/chunking/embedding/tracing coverage gaps listed above.
- UI primitive coverage gaps listed above.
- Retrieval fallback/cache TODOs in `TODOS.md`.
- Lack of full ticket audit history if multiple reviewers become real.
- Compiled API + Bull runtime failure documented in `TODOS.md`; investigate before production worker use.
- Source/config/docs naming drift between Mnemra and Optra.

#### Conditional expansion

- Email intake or other inbound channel.
- Telegram/Viber workflows.
- ERP/accounting integration.
- Linear ticket integration.
- Hardware field-failure Ticket Copilot extensions.
- Procurement dataset exports and operational insights.
- BIR/EWT/VAT/tax workflows after professional validation.

### 19.13 Final completeness gate

Before implementation begins, every item above must be assigned one of:

`IMPLEMENT NOW` · `DEFER WITH REASON` · `ACCEPT AS-IS WITH EVIDENCE` · `BLOCKED BY EXTERNAL INPUT` · `RETIRE AFTER DEPENDENCY CHECK`

No item may remain silently omitted. For every item marked `ACCEPT AS-IS`, record the risk, evidence, owner, and review date. For every `BLOCKED` item, record the exact missing input and the safe fallback behavior.

*Rev 4: these dispositions are now assigned in §9.*

## Appendix B — Receiving exceptions and edge-case workflows (deferred extension)

**Status:** proposed product extension; not implemented in the current repository. **Rev 4 disposition:** DEFER WITH REASON (§9.1). The exception is shortage and partial acceptance, which S5 and S6 cover through the GRN quantity fields (POLICY v1 #1, #14).

### 1. The operational reality

**PROPOSED:** job-site receivers and warehouse clerks must be able to record physical exceptions at receipt: damaged packaging, damaged goods, missing quantities, rejected substitutions, and other acceptance conditions. Site evidence closes the gap between physical receipt and AP authorization.

**FACT:** the current repository has PO and invoice intake, but no receiving/DR/GRN schema, receiving controller, receiving processor, or receiving UI. The existing `workspace_events` enum also has no receiving-exception event type.

**UNVERIFIED DEPENDENCY:** confirm the customer’s authoritative receiving artifact and terminology: Delivery Receipt, Goods Received Note, warehouse receipt, ERP receipt, or another record. Do not freeze `dr_item_id` until real samples confirm the identifier and line structure.

### 2. Core exception-ingestion workflows

#### A. Damaged goods reporting — visual evidence flow

**PROPOSED trigger:** receiver identifies damaged or defective packaging/items during unloading and captures photo/video evidence.

Proposed flow:

1. Receiver submits the receiving document and damaged-item media through the approved intake channel.
2. Optra asks the receiver to select the affected receiving line or enter the supplier SKU.
3. Optra asks for affected quantity and an optional text or voice-note remark, such as “box arrived crushed from freight carrier.”
4. Optra confirms the receiving document, line, quantity, timestamp, and evidence before saving.
5. AP receives an exception requiring review; the system does not independently authorize a deduction.

Example status label:

`DAMAGED_ON_RECEIPT`

Proposed core-engine behavior:

- store media in workspace-scoped object storage;
- link evidence to a receiving line/revision, not only a free-form document ID;
- retain capture time, reporter, source channel, and notes;
- calculate an estimated exposure from an accepted price source when available;
- present a recommended action such as “hold review for possible credit memo,” not an executed credit memo;
- preserve human confirmation and vendor-resolution outcome.

Illustrative message:

`Potential exposure: 5 damaged units × ₱840 = ₱4,200. AP review required before any payment hold or credit request.`

**UNVERIFIED DEPENDENCIES:** damage classification, video retention/size limits, whether voice notes are supported, who can report after receipt, and whether damage is carrier-, supplier-, or site-attributed.

#### B. Short deliveries and partial acceptance

**PROPOSED trigger:** physical accepted quantity is less than the ordered or delivered quantity.

Proposed flow:

1. Receiver selects a short-delivery action or submits a receiving image containing annotations/strikethroughs.
2. Optra asks for the confirmed physically accepted quantity for the receiving line.
3. Receiver confirms the quantity and, where applicable, missing/backordered/rejected quantities separately.
4. Optra records the receipt as a new revision/event; it must not overwrite the original source evidence.
5. When an invoice arrives, the comparison run evaluates ordered, accepted, and billed quantities.

Illustrative result:

`PO: 24 pcs · accepted: 18 pcs · missing/backordered: 6 pcs · invoice: 24 pcs`

Proposed exception label:

`SHORT_DELIVERY_OVERBILLING_RISK`

Proposed core-engine behavior:

- support multiple receiving records against one PO;
- distinguish accepted, rejected, missing, backordered, and unknown quantities;
- aggregate receipts only under an accepted customer policy;
- flag an invoice billed above accepted quantity;
- show the source evidence and calculation in the AP review surface;
- never interpret missing receiving evidence as zero accepted quantity.

**FACT:** current comparison only joins PO and invoice lines and cannot make this determination. Three-way matching becomes a valid product claim only after receiving data, linkage, aggregation, and golden fixtures exist.

#### C. Rejected component substitutions

**PROPOSED trigger:** a supplier delivers an unapproved alternative, wrong brand, wrong specification, or visually mismatched component.

Proposed flow:

1. Receiver selects a rejection action on the receiving packet.
2. Optra captures a rejection category, for example `WRONG_BRAND`, `UNAPPROVED_SPEC`, or `VISUAL_MISMATCH`.
3. Receiver attaches received-item evidence and, where available, the approved specification/catalog/contract evidence.
4. Optra presents candidate comparison evidence and asks a human reviewer to confirm identity/substitution status.
5. The receiving line becomes a rejected-substitution exception pending resolution.

Proposed line label:

`REJECTED_SUBSTITUTION`

Proposed core-engine behavior:

- use catalog/specification matching as evidence and candidate ranking;
- require explicit human confirmation for a substitution or rejection;
- associate the accepted/rejected decision with the receiving line, item identity, and comparison run;
- surface a recommended payment-review state for the related invoice line;
- record supplier response, replacement, return, credit, or approved-substitution outcome.

**Guardrail:** “hard payment hold” is a business-side effect, not a safe default. The current code has no payment system or payment-hold route. Optra may recommend or queue a hold for AP review; it must not execute one without an explicitly integrated payment authority, permission model, idempotency policy, and customer approval.

### 3. Bot/channel workflow — Viber and Telegram

**CONDITIONAL PROPOSAL:** use Viber/Telegram only if Gate 0 confirms that receivers actually use one of these channels and the provider/security contract is accepted.

**FACT:** no Telegram, Viber, webhook, bot-account-linking, or messaging implementation was found in the repository. Therefore the following is a future channel adapter contract, not current behavior.

Proposed channel sequence:

```text
authenticated account link
→ receiving document/line selection
→ text/photo/video/voice capture
→ quantity/category confirmation
→ evidence upload + idempotent receipt
→ acknowledgement with reference ID
→ AP review queue
```

Candidate command names such as `/short_delivery` and `/reject_item`, and the handle `@OptraBot`, are **PROPOSED channel vocabulary only**. No command parser, bot handle, webhook, or channel adapter exists in the current code. Final syntax must follow the selected provider and the customer’s receiving workflow.

Required channel controls:

- webhook signature/secret validation;
- sender-to-user/workspace account linking;
- explicit authorization for the receiving role;
- replay/idempotency key per message/media submission;
- file type, size, duration, and page limits;
- malware/content validation where available;
- rate limiting and abuse controls;
- redacted/privacy-safe logs;
- retry and provider outage behavior;
- no raw JWT or broad bearer token in a chat URL;
- short-lived, resource-scoped, one-time review links only if deep links are required.

Bot confirmations must show what was recorded:

`DR/GRN reference · line/SKU · quantity · category · reporter · timestamp · evidence count · AP review status`

### 4. Architecture and data-schema requirements

**PROPOSED:** introduce a receiving exception model, but do not freeze the exact table/column contract before Gate 0.

A candidate `receiving_exceptions` model may include:

| Candidate field | Required meaning |
|---|---|
| exception ID | Stable identifier for the exception/revision |
| workspace ID | Current repository tenancy convention; user request calls this `tenant_id` |
| receiving document/line ID | Link to the authoritative DR/GRN/receipt line; exact name unverified |
| exception type | Damage, shortage, rejection, or customer-approved additional type |
| affected quantities | Structured affected/accepted/rejected/missing values with UOM |
| evidence references | Workspace-scoped S3 object keys plus source-channel metadata; avoid public URL-only truth |
| reported-by user | Authenticated reporter identity |
| notes | Text/voice transcription or note, subject to retention policy |
| estimated financial impact | Calculation plus price source/currency/UOM and confidence; never an unqualified financial fact |
| status/decision | Open, needs review, accepted, disputed, resolved, or accepted customer vocabulary |
| timestamps | Capture, received, reviewed, resolved |
| audit/revision references | Immutable history and comparison/run provenance |

The user-requested `exception_type` values `DAMAGE | SHORTAGE | REJECTION` are a **PROPOSED starting vocabulary**, not an accepted schema enum. Exact casing and additional types require customer review.

Required relational behavior:

- multiple receiving records can link to one PO;
- one receiving line can have multiple evidence items and exception events;
- invoice lines can reference the comparison result without being owned by the exception table;
- source revisions remain inspectable;
- vendor, PO, invoice, catalog/spec, and receiving links are workspace-scoped;
- deletion/retention behavior is explicit;
- duplicate bot submissions are idempotent;
- financial estimates are recomputable from versioned price evidence;
- human decisions are append-only or revisioned, not silently overwritten.

### 5. AP dashboard exception queue

**PROPOSED:** extend the review queue so AP sees receiving exceptions beside PO, invoice, and approved-price evidence.

Each queue row should answer:

- which invoice and line are affected;
- what was ordered;
- what was received/accepted/rejected;
- what was billed;
- what price source was used;
- what exception is active;
- how much exposure is estimated;
- which evidence supports the result;
- who must decide and by when;
- what has already been resolved.

Illustrative display:

`Invoice SI-009921 bills ₱486,200; DR/GRN DR-7782 has 1 active damage report; estimated ₱11,100 pending credit-memo review.`

The phrase “pending credit memo” must mean an unresolved recommendation, not an issued accounting document, unless a validated accounting integration exists.

Required UX states:

- active damage/shortage/rejection;
- missing receiving evidence;
- ambiguous line linkage;
- waiting for receiver/procurement/vendor;
- AP accepted/disputed/held/resolved;
- provider/media upload failure;
- expired reporting window;
- duplicate submission.

### 6. Vendor discrepancy notice export

**CONDITIONAL PROPOSAL:** provide a one-click “prepare vendor discrepancy notice” action after AP review confirms the evidence.

Candidate output:

- vendor and customer identifiers;
- PO/invoice/DR/GRN references;
- affected lines and quantities;
- exception category and notes;
- site evidence references/images where policy permits;
- timestamps and reporter/reviewer identities;
- requested action: replacement, credit, return, clarification, or customer-approved option;
- generated-document version and audit ID.

**UNVERIFIED DEPENDENCIES:** PDF layout, signature meaning, legal notice language, vendor email destination, sender authority, attachment redaction, and whether the customer wants automatic email or draft-only output.

Safe sequence:

`AP confirms evidence → Optra generates draft PDF → AP reviews/edits → AP explicitly sends/export-downloads → delivery result is recorded`

Do not email a supplier automatically from a model-generated exception without human confirmation and an auditable send action.

### 7. Edge-case guardrails

#### Time-bound reporting window

**PROPOSED default to validate:** exception reporting within 48 hours of the authoritative receiving-record creation time.

Required behavior:

- calculate from the customer’s authoritative timestamp, not the browser clock alone;
- display the deadline and current status;
- allow late reports only through an explicit late-report path;
- record why a late report was accepted or rejected;
- never silently discard late evidence;
- support customer-specific windows and timezone policy.

**UNVERIFIED DEPENDENCY:** 48 hours is a proposed policy, not a universal supply-chain rule. Customer/legal/finance owners must approve it.

#### Low-bandwidth fallback

**PROPOSED:** allow text/quantity/category capture first, then upload media when connectivity recovers.

Required design questions:

- native mobile bot behavior versus browser/PWA capability;
- what “local queue” means for the chosen channel;
- encryption and device-loss behavior for locally cached media;
- maximum offline queue size and retention;
- duplicate/replay reconciliation;
- user acknowledgement when evidence is pending upload;
- behavior when the receiving window expires before media arrives.

**FACT:** no current repository implementation provides a local media queue or offline sync. This is a separate product/platform dependency, not a small UI flag.

#### Human-in-the-loop AP control

**REQUIRED GUARDRAIL:** the bot captures evidence and flags risk. AP retains sole authority to approve a payment hold, request a credit note, accept a substitution, or close the exception—unless a future customer-approved policy explicitly delegates a bounded action.

The system must separate:

`evidence captured` · `risk detected` · `recommendation generated` · `human decision` · `external accounting/payment effect`

No status transition may imply an external payment effect unless an integrated system confirms the effect and records an idempotent external reference.

### 8. Implementation dependency order

```text
real DR/GRN samples + exception policy
→ receiving document/line model
→ evidence/provenance/media lifecycle
→ exception capture API and permissions
→ receiving exception queue
→ PO/receiving/invoice comparison-run support
→ AP evidence/decision UI
→ vendor notice draft/export
→ validated bot adapter
→ optional accounting/payment integration
```

Do not start with the bot. The bot is an intake adapter; it depends on an authoritative receiving model, evidence lifecycle, identity/linking, decision/audit model, and review queue.

### 9. Acceptance criteria for this extension

- [ ] Real damaged, short-delivery, and substitution examples are available and redacted/consented.
- [ ] Customer confirms DR/GRN terminology, line identifiers, linkage fields, UOMs, and reporting window.
- [ ] Exception types and affected-quantity semantics are accepted.
- [ ] Workspace/role permissions for receivers, AP, procurement, and admins are accepted.
- [ ] Evidence storage, retention, deletion, offline/media policy, and privacy rules are accepted.
- [ ] Repeated receipts, partial acceptance, rejected quantity, and late reporting have golden fixtures.
- [ ] Comparison run distinguishes ordered, accepted, rejected, missing, billed, and unknown values.
- [ ] AP decision is separate from model score and exception capture.
- [ ] Credit-memo/payment-hold behavior is recommendation-only unless an approved integration exists.
- [ ] Vendor notice is draft-first, human-sent, and audit-recorded.
- [ ] Viber/Telegram provider contracts and webhook security are accepted before channel work.
- [ ] Low-bandwidth behavior is proven on the selected client/channel.
- [ ] API, e2e, browser, security, queue, storage, and regression tests pass with required services.

## Appendix C — Code-facts coverage closure (rev 3 §20, 2026-09-16, corrected in rev 4)

This section is the final repository audit for the current plan. It records what was actually found, why the existing seam exists, what the target work must change, and what still cannot be verified from this repository. It is intentionally conservative: a missing implementation is recorded as missing, and an external business rule is never promoted to a code fact.

### 20.1 Audit boundary and method

**FACT:** the rev 3 audit ran against `main` at commit `469317ec9c9d2ca02d4ae0572b5fedc4568af3f2`. *(Rev 3 printed a truncated 39-character SHA here; corrected in rev 4.)* No application source, schema, migration, test, configuration, or deployment file changed during that audit. *(Rev 3 called this plan untracked. It was later committed as `bf6d38d`.)*

**FACT:** `git ls-files` returned 916 tracked paths before this plan is added to version control. The top-level inventory is disjoint: `apps` 505, `packages` 204, `scripts` 35, `docs` 22, `.ai-engineering` 44, `.claude` 70, `graphify-out` 9, `docker` 7, `.github` 1, and 19 root files. *(Rev 3 values. At rev 4 the total is 917 and `docs` is 23; see Appendix A §19.1.)*

**FACT:** the audit used all of the following evidence classes:

- tracked-path and extension inventory;
- API controller, route, DTO, guard, module, service, processor, and queue searches;
- web page, BFF route, API client, proxy, and download-path searches;
- database schema, enum, migration, snapshot, foreign-key, and index inspection;
- AI chain, loader, renderer, model resolver, storage, SSRF, and token/cost inspection;
- seed data, evaluation data, deployment scripts, Docker Compose, environment template, CI workflow, and operational-doc inspection;
- adjacent-spec inventory, existing e2e coverage, and the recorded test/build baseline;
- graph relationship query as a cross-check only. `graphify-out` is generated/supporting output; source code, tests, migrations, and routes remain authoritative.

**FACT:** 64 tracked `.claude/skills` entries are external symlinks. They are counted as paths but are not application code. Ignored build output, `node_modules`, local `.env`, caches, and the ignored nested worktree were not treated as current product source. They cannot silently expand the product scope.

**Defensible meaning of 100% coverage:** every tracked repository path is accounted for; every proposed target capability is mapped to a verified existing seam or an explicit absence; every planned implementation has a stated intent, data/security invariant, validation requirement, and blocker. This is not a claim that static inspection proves external provider behavior, customer policy, model accuracy, deployment state, or business correctness.

### 20.2 Target-capability traceability ledger

| Target capability | Verified current seam and purpose | Required implementation or fix | Validation/blocker |
|---|---|---|---|
| PO/invoice intake | `ProcurementController` accepts owner/admin uploads; `ProcurementDocumentsService` stores an object and creates a header; `ProcurementParseService` queues parsing; the processor creates line rows. This is the current structured-input foundation. | Preserve the working upload/parse contract while adding canonical document identity, revisions, provenance, and accepted document links. | Existing API procurement tests and e2e remain green; Gate 0 samples required for schema changes. |
| Original source and derived parse | Non-PDF uploads are marked `sourceKind: 'csv'`; XLSX is converted from its first sheet and written back to the same storage key. *(Rev 4 correction: nothing reads the converted object, because comparison builds its CSVs from DB rows. See §4 D1.)* | Stop the overwrite (S0b) and record the true original format. Parser/version provenance comes in S3. | Required before evidence/revision claims; retention and reprocessing contract is UNVERIFIED. |
| Source provenance | `rawRow` exists on current line rows, but page/sheet/row/column/field coordinates and extraction provider/model/version are not persisted. This makes current rows inspectable only at coarse raw-row granularity. | Persist line/field provenance and show it in the evidence drawer. | Golden fixtures must assert exact provenance; real document layouts are UNVERIFIED. |
| Receiving, DR/GRN, and physical exceptions | No executable receiving table, DR/GRN model, controller, processor, BFF route, client API, or receiving UI exists. The only relevant hits are comments/demo text. | Add an authoritative receiving-document/line model, exception events, evidence media, permissions, deadlines, and resolution history. | BLOCKED BY EXTERNAL INPUT: real DR/GRN artifact, identifiers, quantities, UOM, timestamps, roles, retention, and policy. |
| Damage reporting | No current damage status, media-to-receiving-line relation, or credit-memo workflow exists. Existing storage can save objects but has no receiving evidence contract. | Capture affected quantity, media, notes, reporter, timestamp, source channel, and a review recommendation; never execute a credit or deduction implicitly. | Fixtures for damage/cause/late evidence; AP/finance policy required. |
| Short delivery and partial acceptance | Current comparison sees only PO quantity versus invoice quantity. It cannot distinguish accepted, rejected, missing, backordered, or unknown quantities. | Support multiple receipt revisions and explicit quantity states; compare ordered, accepted, and billed quantities without treating missing evidence as zero. | BLOCKED BY EXTERNAL INPUT: aggregation and acceptance policy; golden multi-receipt fixtures required. |
| Rejected substitution | Catalog matching is a manual candidate-ranking service with boolean/score/reason output; it is not a receiving rejection or payment decision. | Link received-item evidence to approved spec/catalog/contract evidence; require human confirmation and record replacement/return/credit outcome. | Labeled lookalike/substitution fixtures and reviewer policy required. |
| Two-way/three-way comparison | `ComparisonService` runs a fixed DuckDB full outer join of PO and invoice rows and writes four flag types. It deletes prior flags for the pair before inserting the current result. | Introduce explicit comparison runs, source revisions, match states, receiving inputs, deterministic result history, and non-destructive rerun behavior. | Do not claim three-way matching until receiving linkage, aggregation, and golden results pass. |
| Price and contract authority | Catalog tables contain vendor/catalog/item identity and photos but no price, currency/UOM validity, effective dates, or contract applicability model. | Add versioned, source-backed price/term evidence with applicability, supersession, currency, UOM, and approval state. | BLOCKED BY EXTERNAL INPUT: authoritative price semantics, tax/freight/discount/tier rules, and contract samples. |
| UOM and identity normalization | Current matching uses trimmed/lowercase SKU or description fallback; line schemas have no UOM or persistent conversion rules. | Add approved aliases/conversions, normalized values, unknown/unconvertible states, and correction history. | BLOCKED BY EXTERNAL INPUT: customer UOM vocabulary and conversion authority; never infer from names alone. |
| Document/link resolution | Current UI requires a human to select one PO and one invoice; there is no receiving/PO/invoice link model or automatic link worker. | Add explicit reference/vendor/link suggestions with human confirmation and ambiguity states. | Fixtures for missing/inconsistent references, duplicates, one-to-many, and many-to-one cases. |
| Automatic orchestration | Fifteen Bull queues/processors exist, including procurement parse and catalog parse/scrape. There is no comparison-run or catalog-match queue; catalog matching is request-triggered. | Add idempotent link/normalization/comparison/match jobs only after data contracts; persist lifecycle, retries, timeout, cost, and reconciliation. | Worker topology, queue concurrency, and provider limits must be verified. |
| AP review queue and decision | Current discrepancies have `open`/`dismissed` state and owner/admin dismissal; the page has stats/table only. There is no decision history, evidence drawer, reviewer assignment, or payment authority. | Build evidence-first queue with explicit risk/recommendation/decision/external-effect states and append-only decision history. | BLOCKED BY EXTERNAL INPUT: AP role matrix, allowed decisions, approval thresholds, and audit requirements. |
| Payment hold / credit memo | No payment system, accounting integration, payment-hold route, credit-memo route, or executable side effect exists. | Keep model output and field evidence as recommendations; add an integration only with approved authority, permissions, idempotency, external reference, and human control. | Never describe a recommendation as an issued hold, deduction, or credit memo. |
| Procurement source evidence access | Generic knowledge-base documents and ticket transcripts have binary download patterns; procurement has no source download/view controller, BFF route, or client function. | Add authenticated, workspace-scoped original/derived evidence access and line-level source navigation. | Test cross-workspace object access, expired links, retention, redaction, and original-format preservation. |
| Vendor discrepancy notice | `TicketsService` can render a transcript PDF with `pdf-lib`; no procurement vendor notice/export/send path exists. The ticket PDF is a reusable rendering pattern, not a business contract. | Generate a draft-first discrepancy PDF, human review/edit/send or download, delivery result, and audit record. | BLOCKED BY EXTERNAL INPUT: legal language, signatures, sender authority, email destination, redaction, and automatic-send policy. |
| Viber/Telegram intake | No provider SDK, webhook, bot, account-linking, message idempotency, or channel route exists. | Implement an adapter only after the receiving core exists; authenticate webhooks and bind sender to user/workspace/role. | BLOCKED BY EXTERNAL INPUT: actual channel/provider, webhook contract, media limits, privacy, and outage policy. |
| Low-bandwidth/offline capture | Current web client performs fetch/upload and shared 401 refresh; no procurement offline queue, durable local media cache, or sync/replay layer exists. | Design text/quantity-first capture, encrypted pending media, retry/replay reconciliation, and user acknowledgement for pending evidence. | BLOCKED BY EXTERNAL INPUT: selected client/channel, device-loss policy, encryption/retention, queue size, and expiry behavior. |
| Tenancy and authorization | JWT, `WorkspaceMemberGuard`, `RolesGuard`, workspace-scoped storage keys, and many service predicates exist. Some current reads first select by object ID then compare workspace in application code; procurement child reads use parent ID without repeating workspace predicate. | Make workspace scope part of every new query and mutation, add defense-in-depth predicates, and test cross-workspace document/line/evidence/run/decision IDs. | No current leak is proven by this finding; it is a verified hardening/test requirement. |
| Web/BFF/review UI | Existing pages, same-origin BFF routes, shared client, upload helper, polling, and proxyRaw download pattern cover current surfaces. There are 59 BFF routes; seven lack adjacent route specs. | Add receiving/intake/evidence/review/decision/export pages, clients, BFF routes, accessible states, pagination, and browser critical-flow coverage. | API DTO/role contracts must be accepted first; browser suite does not currently exist. |
| Configuration and operations | Compose runs Postgres, Redis, SeaweedFS, API, and web; processors run inside API. CI deploys on main/manual but is not a PR quality gate. Host/container Redis ports differ by topology and are documented inconsistently. | Canonicalize environment profiles, staging, worker decision, health/dependency checks, observability, backup/restore, migration/rollback, and retention. | Service-backed tests and Docker were unavailable during the recorded baseline; production state is UNVERIFIED. |
| Tests and fixtures | Current inventory is 59 API unit specs, 14 API e2e specs, 124 web specs, 25 AI specs, 1 DB spec, 11 UI specs, and 2 seed specs. Web/DB/UI passed in the recorded run; API/AI service-backed checks were blocked. | Add receiving, provenance, source-download, price/UOM, run, decision, queue, security, media, PDF, channel, and browser fixtures/tests. | Required services must be available; failures must be classified, not ignored. |

### 20.3 Verified current-code issues that must not be silently carried forward

These are not speculative feature ideas. They are concrete behaviors or absences found in the current code and therefore need an explicit disposition in the implementation backlog.

1. **XLSX source mutation:** `apps/api/src/procurement/procurement-documents.service.ts:22-31` collapses `.xlsx` into `sourceKind: 'csv'`; `apps/api/src/procurement/procurement-parse.processor.ts:89-103` overwrites the uploaded object with converted CSV. *(Rev 4 correction: rev 3 gave downstream DuckDB compatibility as the reason, but comparison does not read the stored object. See §4 D1.)* The fix is to stop the overwrite (S0b), not to relabel it in the UI.
2. **Child-query workspace hardening:** `apps/api/src/procurement/comparison.service.ts:105-110` checks parent workspace ownership, then reads line items by parent ID only. The current FK and parent validation make this different from a demonstrated leak, but the query does not use the denormalized workspace field that the schema comments describe as the isolation shape. Add workspace predicates and regression tests before expanding the relation graph.
3. **Deletion semantics:** `ProcurementDocumentsService.remove()` deletes the source object and parent row, while foreign keys cascade to line items and discrepancy flags; no procurement controller route, BFF route, or client function exposes it. Decide retention/audit behavior before any new evidence or decision records can depend on deletion.
4. **No procurement evidence viewer:** the review product cannot currently retrieve the original PO/invoice from the procurement surface. Reusing the generic document download path without a domain authorization check would be unsafe because procurement headers and generic knowledge-base documents are different ownership models.
5. **Destructive comparison refresh:** a rerun deletes the current flag set for a PO/invoice pair and inserts a new set. This was sufficient for the prototype’s idempotent current-state behavior; it is insufficient for historical audit, source revision comparison, or reproducing a prior decision. *(Rev 4: the delete also removes `dismissed` flags. See §4 B1.)*
6. **Unbounded current procurement surface:** `ProcurementDocumentsService.list()` returns all workspace PO/invoice rows and the procurement page polls every three seconds while processing. Add pagination/status cursors and refresh-safe lifecycle behavior before customer-scale document volume.
7. **Manual-only match orchestration:** `CatalogMatchService.search()` prefilters at most `CATALOG_MATCH_MAX_CANDIDATES` (default 8) and judges candidates in parallel. The cap bounds one request’s candidate count, but there is no durable match run, global cost budget, calibration, or background queue. Keep it triage evidence, not approval.
8. **Environment topology drift:** `.env.example` says host Redis `6379`, local Compose publishes host `6380` to container `6379`, and seed configuration defaults host access to `6380`. Internal Compose API access is `6379`; the plan must preserve this distinction and eliminate ambiguous operator instructions.
9. **Verification environment limitation:** the recorded API/AI failures were connection/service/fixture failures, not proof of product regression. Before implementation claims are accepted, rerun the service-backed suite with Postgres, Redis, SeaweedFS, and explicitly needed network/model fixtures available.
10. **Documentation drift:** `README.md`, `SUMMARY.md`, portions of `docs/ROADMAP.md`, and parts of readiness/context maps still contain Mnemra-era or historical claims. `CLAUDE.md` and current source establish the stronger source hierarchy. No implementation task may use a stale document as proof without source verification.

### 20.4 No-silent-gap implementation ledger

Before a feature branch is approved, mark every applicable row below with `IMPLEMENT NOW`, `DEFER WITH REASON`, `ACCEPT AS-IS WITH EVIDENCE`, `BLOCKED BY EXTERNAL INPUT`, or `RETIRE AFTER DEPENDENCY CHECK`.

| Workstream | Must explicitly cover |
|---|---|
| Intake and documents | accepted file types; content validation; original bytes; derived parse; headers; line identity; revisions; duplicate uploads; failed/partial parse; download/view; retention/deletion |
| Receiving reality | authoritative DR/GRN/receipt; multiple receipts; partial acceptance; damage; shortage; rejection; substitution; missing/backordered/unknown quantity; late report; duplicate report; media/text/voice; source timestamp |
| Financial truth | vendor identity; PO/invoice/receipt linkage; price authority; effective dates; currency; tax/freight/discount/tier semantics; UOM and conversion; estimated exposure versus actual accounting effect |
| Comparison | two-way versus three-way mode; matching keys; aliases; duplicates; one-to-many; ambiguous/unmatched; insufficient evidence; deterministic run; rerun/revision history; explainable deltas |
| AI controls | extraction versus match confidence; calibration; model/provider/prompt version; prompt injection; candidate and total cost limits; timeout/retry; human override; no score-as-approval |
| AP control | queue priority; reviewer/owner; SLA/deadline; evidence drawer; decision vocabulary; approval authority; append-only audit; external effect reference; notification behavior |
| Vendor resolution | dispute draft; PDF evidence; timestamps; signatures; redaction; edit history; send/download choice; delivery failure/retry; vendor response/replacement/return/credit outcome |
| Messaging and offline | provider contract; webhook signature; account linking; role authorization; replay/idempotency; media limits; outage/retry; encryption; local queue; device loss; pending upload; expiry reconciliation |
| API and tenancy | DTO whitelist validation; route inventory; role matrix; workspace predicates; object authorization; BFF forwarding; rate/cost limits; safe errors; redacted logs |
| Web product | intake state; parse state; empty/error/partial/ambiguous states; evidence loading; decision confirmation; pagination; mobile/low-bandwidth behavior; accessibility; browser critical path |
| Data and operations | migrations from current head; foreign keys/indexes; backfill; rollback/data repair; queue reconciliation; worker topology; observability; backup/restore; export/delete; retention; incident response |
| Verification | unit; database/migration; real-storage; queue; API e2e; BFF; browser; IDOR; upload/content; model/golden; PDF/media; regression; manual QA with service prerequisites |

### 20.5 Remaining unverified facts and non-claims

The following are intentionally not resolved by code inspection:

- The repository’s `CLAUDE.md` states this is currently a personal portfolio project with no external customers or billing. A hardware-company workflow is the strategic target, not a customer-validated production requirement.
- No real customer PO, invoice, DR/GRN, catalog, contract, credit/debit note, or exception policy was present in the repository.
- No authoritative meaning for `dr_item_id`, `tenant_id`, accepted quantity, damaged quantity, rejected quantity, backorder, UOM conversion, price applicability, or 48-hour reporting exists in code.
- No Viber/Telegram provider, webhook, bot identity, channel media behavior, or messaging privacy contract is present.
- No accounting/payment integration exists; no current code can issue a payment hold, deduction, credit memo, supplier email, or tax filing.
- No model accuracy or threshold is proven by the repository. Existing scores are model outputs and candidate-ranking evidence.
- No static audit proves production VPS state, backup restore success, external S3 durability, Redis durability, SMTP delivery, OpenAI behavior, or Docker availability.
- The recorded service-backed test failures leave API/AI e2e and integration behavior unverified until dependencies are started and the suites are rerun.

These are not gaps to hide in implementation detail. They are explicit gates. If any one becomes known through customer evidence or an infrastructure decision, revise this file before freezing the affected schema, route, job, or acceptance test.

### 20.6 Final implementation-readiness verdict (rev 3)

*Superseded in rev 4 by §0 and §2: POLICY v1 replaces Gate 0, and §5 defines the start point.*

**Verdict:** the repository is fully inventoried and the proposed target work is now mapped to code facts, intent, tests, and blockers. The plan is reliable as a source-grounded implementation map. It is **not** evidence that the full receiving/AP product is already implemented or that external assumptions are settled.

The safe start point is Gate 0 and baseline preservation. Feature implementation should begin only after the receiving artifact, linkage, price, UOM, roles, evidence retention, and decision contracts are accepted. Every implementation task must update this document with:

`source location → current intent → accepted change → invariant → test evidence → rollback/repair behavior`

If a proposed change cannot fill that chain from repository facts or an explicitly recorded external decision, it remains `UNVERIFIED DEPENDENCY` and is not implementation-ready.

## Appendix D — Evidence register

Primary source files inspected:

- `package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/main.ts`
- `apps/api/src/procurement/procurement.controller.ts`
- `apps/api/src/procurement/procurement-documents.service.ts`
- `apps/api/src/procurement/procurement-parse.service.ts`
- `apps/api/src/procurement/procurement-parse.processor.ts`
- `apps/api/src/procurement/comparison.service.ts`
- `apps/api/src/procurement/column-mapping.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/catalog-documents.service.ts`
- `apps/api/src/catalog/catalog-parse.service.ts`
- `apps/api/src/catalog/catalog-parse.processor.ts`
- `apps/api/src/catalog/catalog-match.service.ts`
- `apps/api/src/catalog/catalog-image.service.ts`
- `apps/api/src/catalog/catalog-scrape.processor.ts`
- `apps/api/src/catalog/catalog.module.ts`
- `apps/api/src/storage/storage.service.ts`
- `apps/api/src/structured-query/duckdb-query.service.ts`
- `packages/ai/src/chains/procurement-extraction.ts`
- `packages/ai/src/chains/catalog-match.ts`
- `packages/ai/src/web/crawl.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/purchaseOrders.ts`
- `packages/db/src/schema/invoices.ts`
- `packages/db/src/schema/poLineItems.ts`
- `packages/db/src/schema/invoiceLineItems.ts`
- `packages/db/src/schema/discrepancyFlags.ts`
- `packages/db/src/schema/vendors.ts`
- `packages/db/src/schema/catalogs.ts`
- `packages/db/src/schema/catalogItems.ts`
- `packages/db/src/schema/catalogMatches.ts`
- `packages/db/drizzle/0020_bumpy_energizer.sql`
- `packages/db/drizzle/0021_dear_speed_demon.sql`
- `apps/web/app/workspaces/[id]/procurement/page.tsx`
- `apps/web/app/workspaces/[id]/discrepancies/page.tsx`
- `apps/web/app/workspaces/[id]/catalog-matches/page.tsx`
- `apps/web/src/lib/api/procurement.ts`
- `apps/web/src/lib/api/catalog.ts`
- `apps/web/src/lib/api/client.ts`
- `apps/web/src/lib/http/auth-proxy.ts`
- `apps/web/src/lib/http/download.ts`
- `apps/web/src/components/workspace-nav.tsx`
- `apps/api/src/tickets/tickets.controller.ts`
- `apps/api/src/tickets/tickets.service.ts`
- `apps/web/app/api/workspaces/[id]/tickets/[ticketId]/transcript.pdf/route.ts`
- `packages/db/drizzle.config.ts`
- `packages/db/scripts/migrate.ts`
- `scripts/seed/config.ts`
- `scripts/seed/index.ts`
- `scripts/verify-env.sh`
- `.env.example`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `.github/workflows/deploy.yml`
- `docs/ai/testing-strategy.md`
- `docs/PRODUCTION-READINESS.md`
- user-provided product architecture and execution roadmap attachments.
Additional sources inspected in rev 4 (2026-09-20):

- `apps/api/src/limits/usage.service.ts`, `apps/api/src/limits/rate-limit.service.ts`, `apps/api/src/limits/chat-rate-limit.guard.ts`
- `apps/api/src/chat/chat.service.ts`, `apps/api/src/refine/refine.rate-limit.guard.ts`
- `apps/api/src/procurement/procurement-extraction.service.ts`, `apps/api/src/procurement/procurement.module.ts`, `apps/api/src/procurement/*.spec.ts`
- `apps/api/src/catalog/catalog-extraction.service.ts`, `apps/api/src/catalog/catalog-parse.service.ts`, `apps/api/src/catalog/dto/list-catalog-matches-query.dto.ts`
- `apps/api/src/tickets/ticket-extraction.processor.ts`, `apps/api/src/insights/faq-cluster.processor.ts`, `apps/api/src/insights/topic-gap.processor.ts`
- `apps/api/src/events/events.service.ts`, `apps/api/src/insights/background-runs.service.ts`, `apps/api/src/insights/insights.module.ts`
- `apps/api/src/workspaces/workspaces.service.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/common/filters/all-exceptions.filter.ts`, `apps/api/src/notifications/notifications.service.ts`
- `apps/api/test/procurement.e2e-spec.ts`, `apps/api/test/catalog.e2e-spec.ts`, `apps/api/test/jest-e2e.setup.ts`
- `packages/ai/src/tokens.ts`, `packages/ai/src/chains/models.ts`
- `packages/db/src/schema/scrapeRuns.ts`, `packages/db/src/schema/workspaceEvents.ts`, `packages/db/src/schema/workspaceDigestSettings.ts`, `packages/db/src/db/index.ts`
- `scripts/seed/data/procurement.ts`, `scripts/ensure-seaweedfs-s3-config.sh`
- `apps/api/Dockerfile`, `docker/api-dev-entrypoint.sh`, `docker/seaweedfs/s3.json`, `DEPLOYMENT.md`, `DOCKER.md`, `TODOS.md`, `turbo.json`, `.nvmrc`, `.gitignore`
- `apps/web/middleware.ts`, `apps/web/app/workspaces/[id]/catalog-matches/page.tsx`
- Installed-dependency behavior (untracked, read for STATIC-ONLY analysis): `node_modules/bull/lib/queue.js`, `node_modules/bull/lib/commands/addJob-6.lua`, `node_modules/papaparse/papaparse.js`, `node_modules/xlsx/package.json`
