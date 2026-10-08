# Evidence-trail export + honest pricing copy (one PR)

Docs loaded: planning.md, plan-template.md (re-read verbatim at execution start; full Layer-2 plan written to `docs/plans/evidence-export.md` in the worktree)
Session model: Opus 5.5 (`claude-opus-5-5`). Every phase: Opus tier, high reasoning.

```
Task Classification:
- Intent: NEW_FEATURE (+ copy correction)
- Workflow: Feature Plan
- Task Size: Standard (new read-only API route + BFF + UI + public copy; no schema, no auth/billing logic change)
- Domain: Procurement (discrepancies) + Marketing/Landing + Billing page copy
- Risk: Standard — risk-register "Landing Pricing Copy" (public claims must trace to code)
- Contract Areas: new GET .../procurement/discrepancies/export (xlsx); no type/schema change
- Next Action: owner approves → worktree feat/no-ticket-evidence-export
```

## Context

The live pricing page (`apps/web/src/components/landing/pricing-plans.tsx`) makes claims the code does not back: "Exportable evidence trail" (no flag/evidence export exists — only source-document download), "Priority extraction queue" (no code; Scale is contract-only), "1 buyer" (members are not limited; seats only scale quota), and "Scanned and photo-only PDFs included" shown on Team only though Solo has it. Owner decision 2026-10-08: build the export (a real reason to buy), reword the rest, ship both in ONE PR. Export format: Excel, 2 sheets. Available on ALL plans (no gating), so the claim goes on Solo and Team.

## Design

### API — `GET /workspaces/:workspaceId/procurement/discrepancies/export`
- `apps/api/src/procurement/procurement.controller.ts`: new handler next to `GET discrepancies` (:466), same guards (`JwtAuthGuard`, `WorkspaceMemberGuard` — members can read flags today). Query = existing `ListDiscrepanciesQueryDto` filters (`purchaseOrderId`, `invoiceId`, `status`, `runId`) without pagination; omitting `runId` = current flags via `currentFlagScope()` (`comparison.service.ts:862`), exactly like the list.
- Response: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition` via `attachmentDisposition()` (`apps/api/src/common/http/content-disposition.ts:35`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` — same pattern as `sendSourceDocument` (:261-277). Filename `optra-evidence-trail-YYYY-MM-DD.xlsx` (UTC).
- `ComparisonService.exportFlags(workspaceId, query)`: extract the workspace-pinned flag query + 3 citation LEFT JOINs from `listFlags` (:683-833) into one private builder used by both (no duplicated tenant filter). Read in batches of 1,000 ordered `createdAt, id`; hard cap `EXPORT_MAX_FLAGS = 50_000` → 422 "Too many flags to export at once; narrow the filters". Decisions: one batched query on `discrepancy_decisions` for the flag ids, LEFT JOIN `users.email`, filtered by `workspaceId`. Document names via LEFT JOIN `purchase_orders` / `invoices` / `goods_receipts`, pinned to workspace.
- Workbook built with `xlsx` (SheetJS, already an api dependency — no new dep):
  - Sheet **Flags**: Flag ID · Created (UTC ISO) · Type (human label) · Status · SKU · PO document · PO line · PO source · Invoice document · Invoice line · Invoice source · Goods receipt line · Receipt source · PO value · Invoice value · Received value · Delta · Contract unit price · Reason · Latest decision · Decided by · Decided at · Dismissed by · Dismissed at. "Source" = `row N, sheet X` or `read from PDF, NN% confidence` (same wording as `citationText()` in `discrepancy-review-modal.tsx:91`), plus "edited" when `editedAt` is set.
  - Sheet **Decisions**: Flag ID · SKU · Outcome (false positive / approved exception / vendor dispute / resolved) · Note · By (email) · Role · At (UTC ISO), oldest first.
- New shared helper `apps/api/src/common/spreadsheet/safe-cell.ts`: neutralises formula injection (prefix `'` when a text cell starts with `= + - @` or tab/CR), applied to every user/document-derived string. Flag-type labels: map in `apps/api/src/procurement/evidence-export.ts` with a spec asserting it covers every `flag_type` enum value.
- Not metered, not billed (pure DB read), not gated by plan.

### Web
- BFF `apps/web/app/api/workspaces/[id]/procurement/discrepancies/export/route.ts` via existing `proxyRaw` (forwards query + Content-Disposition; pattern = `.../invoices/[docId]/download/route.ts`).
- `apps/web/src/lib/api/procurement.ts`: `exportEvidenceTrail(workspaceId, filters)` using `fetchDownload` (`lib/http/download.ts:31`).
- `apps/web/app/workspaces/[id]/discrepancies/page.tsx`: "Export evidence" button on the right of the filter bar (:327-350), exports the current filter scope; loading state, error toast, disabled when there are no flags. DESIGN.md tokens, `@repo/ui` Button.

### Copy (public claims must trace to code)
- `pricing-plans.tsx`: Solo unit `per month · 1 buyer` → `per month · sized for 1 buyer`; add `Scanned and photo-only PDFs included` and `Exportable evidence trail` to Solo; keep both on Team; remove `Priority extraction queue` from Scale.
- `apps/web/app/workspaces/[id]/billing/page.tsx:235` `$29 per month, 1 buyer` → `$29 per month, sized for 1 buyer`.

## Tests (RED first, three layers; titles error > edge > regression > happy)
- **Unit**: `comparison.service.spec.ts` (export scope = list scope incl. current-run default and filters; another workspace's flags/decisions/documents never included; 50,001 flags → 422; decisions joined), `evidence-export.spec.ts` (labels cover enum; source wording; sheet names/headers), `common/spreadsheet/safe-cell.spec.ts`, BFF `route.spec.ts`, `procurement.spec.ts` (api fn), discrepancies `page.spec.tsx` (button, disabled at 0, error toast), `pricing-plans.spec.tsx` (every listed feature asserted; no "Priority extraction queue"; "sized for 1 buyer"; export + scanned on both paid plans), billing page spec.
- **API e2e** `apps/api/test/procurement.e2e-spec.ts`: 401 unauthenticated, 403 outsider, member 200, bad uuid filter 400, xlsx parsed with SheetJS (2 sheets, headers, citation row/sheet, decision row with actor email), `=HYPERLINK(...)` SKU arrives neutralised, filename header.
- **Playwright** (`procurement-core.spec.ts` or new `evidence-export.spec.ts`): click Export → `download()` helper (`apps/e2e/support/ui.ts:119`) → filename + parse sheets.

## Files (blast radius)
api: `procurement.controller.ts`, `comparison.service.ts`, new `procurement/evidence-export.ts`, new `common/spreadsheet/safe-cell.ts` (+ specs), `test/procurement.e2e-spec.ts` · web: new BFF route (+spec), `lib/api/procurement.ts`, `discrepancies/page.tsx`, `pricing-plans.tsx`, `billing/page.tsx` (+specs) · e2e: one spec · docs: `api-contracts.md` row, `repository-map.md`, `testing-strategy.md`, `risk-register.md` (Landing Pricing Copy: every claim backed), `learnings.md`, graphify refresh.

## Risk / compatibility
- No schema; no change to existing route contracts (shared query-builder refactor guarded by existing `listFlags` specs + e2e).
- Tenant isolation: every joined table filtered by `workspaceId`; e2e proves outsider 403 and that another workspace's PO id as a filter returns nothing.
- Memory bounded by the 50k cap and batched reads.
- Rollback: revert the merge commit (no migration).

## Execution
Worktree `feat/no-ticket-evidence-export` from `origin/main`; PM writes `docs/plans/evidence-export.md` → test-engineer RED (`bun run tdd:red`) → nestjs-backend-dev + nextjs-frontend-dev in parallel → full suites + Playwright → code-reviewer + security-auditor + accessibility-auditor → docs + graphify → one PR → merge on green CI → watch deploy → smoke live page and an export.

## Verification
`bun run test` (api, web), fresh `optra_e2e` + `bun run test:e2e`, `bun run e2e`, `bun run lint`, `bun run type-check`, `sh scripts/check-test-layers.sh origin/main`; after deploy: open `/` pricing (no unbacked claim) and download an export from the Helio Labs demo workspace, opening both sheets.
