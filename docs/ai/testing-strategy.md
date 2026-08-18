# Testing Strategy

Purpose:

Map task size and risk to expected verification.

This file is map only.

Commands must be verified from package scripts or repo docs before being listed as valid.

Claude must discover commands from package scripts or repo docs.

Default command candidates may be mentioned but not claimed as valid unless verified.

If verification cannot run due to environment/config, mark blocker.

Deep tasks require rollback/risk notes and manual QA.

Standing rule (overrides "if available" below for any task that touches code): strict TDD required — failing unit test first, then implementation, plus e2e coverage for user-facing/cross-layer flows. Missing test tooling is not a reason to skip — install it. Tiny tasks (docs/copy/config, no behavior change) are exempt since there is no behavior to test.

---

## Verification By Task Size

| Task Size | Minimum Verification                                                   | Extra Verification                                            | Manual QA           | Notes                                          |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| Tiny      | targeted read-through or formatting check                              | none                                                          | visual/read-through | no behavior change                             |
| Express   | targeted type/lint/test if available                                   | related test if available                                     | focused flow        | single-layer change                            |
| Standard  | verified type/lint/test/build commands if available + related tests    | regression test when relevant                                 | affected workflow   | FE-BE or multi-file changes                    |
| Deep      | verified type/lint/test/build commands if available + regression tests | migration/payment/job/webhook/permission checks when relevant | full critical flow  | billing/payments/auth/jobs/schema/transactions |

---

## Verified Commands

Confirmed from `apps/api/package.json` as of 2026-06-28:

- `bun run test` — Jest unit tests (`apps/api/src/**/*.spec.ts`)
- `bun run test:watch` — Jest unit tests, watch mode
- `bun run test:cov` — Jest unit tests with coverage report
- `bun run test:e2e` — Jest e2e tests (`apps/api/test/**/*.e2e-spec.ts`), boots a real `AppModule` instance and hits it with Supertest
- `bun run type-check` — `tsc --noEmit`

Storage integration note as of 2026-06-30 (CONTEXT DRIFT fix 2026-07-09 — port renamed with the Optra rebrand, see `risk-register.md`'s PO ↔ Invoice Comparison note):
- `apps/api/src/storage/storage.service.spec.ts` is a real integration test against an S3-compatible endpoint.
- Expected local dependency: SeaweedFS at `S3_ENDPOINT=http://localhost:8433` (was `8333` under the legacy `mnemra` local stack).
- The spec is skipped when `S3_ENDPOINT` is absent so non-storage environments can still run the rest of the API suite.

Procurement (PO ↔ Invoice discrepancy) note as of 2026-07-09:
- `apps/api/src/procurement/column-mapping.spec.ts`, `procurement-parse.service.spec.ts`, `procurement-documents.service.spec.ts`, `procurement-parse.processor.spec.ts`, and `comparison.service.spec.ts` (29 tests total) cover header-alias mapping, Bull enqueue/reconcile lifecycle for both `purchase_order`/`invoice` kinds, upload/list/remove with workspace isolation, CSV/XLSX parse + delete-then-insert idempotency, and the DuckDB comparison join (quantity/price mismatch, missing-on-po/invoice, description-fallback matching, re-compare idempotency) — all against a real Postgres + real `DuckDbQueryService`, no mocks on the DB/SQL layer.
- `apps/api/test/procurement.e2e-spec.ts` boots the real `AppModule` (mirrors `documents.e2e-spec.ts`'s pattern) and deliberately does NOT mock `ProcurementParseService` — it exercises the real Bull queue + real processor in-process, polling for `status='done'` before comparing, since the queue lifecycle itself is the Deep-risk surface worth proving end-to-end.
- `procurement-parse.processor.spec.ts` explicitly asserts `embedQuery` (mocked `@repo/ai`) is never called — proves the parse path makes zero OpenAI calls, matching the plan's "no new external integration" requirement.

Every suite in the repo, and how to run them (there is no `turbo test` task and no root `test` script — each package runs its own):

| Command | Runner | Count |
|---|---|---|
| `cd apps/api && bun run test` | Jest, 59 suites | 399 |
| `cd apps/api && bun run test:e2e` | Jest, 14 suites | 40 |
| `cd apps/web && bun run test` | Vitest 4.1.9 | 511 |
| `cd packages/ai && bun run test` | Vitest 3.2.6 | 173 |
| `cd packages/db && bun run test` | Vitest 3.2.6 | 12 |
| `cd packages/ui && bun run test` | Vitest 4.1.9 | 91 |
| `bun run db:seed:test` (root) | Vitest, `scripts/seed` | 47 |

**1273 tests, zero skipped**, all green on Node 22 as of 2026-08-18. `packages/types` has no tests; `scripts/eval` holds two standalone Python scripts outside the bun surface.

- **No suite is env-skipped any more.** `apps/api/src/storage/storage.service.spec.ts` gates on `S3_ENDPOINT` (it is a real S3 round-trip against SeaweedFS) and had therefore **never executed locally** — the var lives in the root `.env`, but the unit Jest config has no `setupFiles`, so nothing loaded dotenv before collection. The spec now loads the root `.env` itself. Doing it there rather than in the shared Jest config is deliberate: a global load would hand all 58 other unit suites live credentials, notably `EMAIL_OTP_ENABLED`, which the e2e setup deliberately forces off to avoid live Resend calls. The gate is kept so the suite still skips cleanly where no object store exists.
- **`packages/ai` concurrency no longer depends on the Node version.** `crawl.ts` used `new Function('specifier','return import(specifier)')` to load ESM-only `p-limit@7` from a CommonJS package. Plain Node runs that fine, but Vitest's module runner supplies no host dynamic-import callback, so 10 `crawlSite` tests failed on Node 22/24 and passed only on Node 25. `p-limit` was removed and replaced by `createLimit` (`packages/ai/src/web/limit.ts`); the suite now passes 173/173 on Node **22, 24 and 25**. The packaging guard in `crawl.spec.ts` was inverted to assert the hack cannot return.
- **`bun install` can silently corrupt native binaries.** An incremental `bun install` left `node_modules/vite/node_modules/esbuild/bin/esbuild` as a valid arm64 Mach-O that was SIGKILLed on exec (exit 137), with no matching `@esbuild/darwin-arm64@0.28.1` platform package installed. Symptom: `packages/ai`, `packages/db` and `scripts/seed` all died at config load with `The service was stopped: write EPIPE` — which reads like a test failure but is not. `bun install --force` re-extracts and repairs it. Same failure class as the DuckDB binding: a platform-specific package that install did not materialise.

E2E suite requirements as of 2026-08-18 (`apps/api/test/jest-e2e.json`) — all three were fixed; e2e now passes 14/14 in parallel with the dev stack up:
- **`testTimeout: 30000`** is load-bearing, not padding. Teardown (`cleanupUsers()` → `app.close()` → `pool.end()`) takes ~6.6s because it shuts down a full Nest app with Bull and Redis clients. Jest's 5s default failed 11 of 14 suites on the `afterAll` hook. Do NOT lower it. It is not a DB problem: `users` has 147 rows and the prefix scan measures 0.051 ms.
- **Queue isolation via `BULL_PREFIX`.** `jest-e2e.setup.ts` sets `BULL_PREFIX=bull-e2e-<pid>`; `app.module.ts` reads `process.env.BULL_PREFIX || 'bull'`. Required because every spec boots the full `AppModule` and therefore registers real Bull consumers — so parallel jest workers, plus any running `optra-api` container, all compete for the same jobs. A stolen job runs against a different in-memory `StorageService` stub and fails with a real S3 `The specified key does not exist`, while the enqueueing spec times out polling for `status='done'`. `'bull'` is Bull's own default, so production Redis keys are unchanged.
- **`globalTeardown` (`jest-e2e.teardown.ts`)** deletes `bull-e2e-*` keys afterwards, scoped so the production `bull:*` namespace is never touched. It loads the root `.env` itself — `globalTeardown` runs outside `setupFiles` and outside Nest's `ConfigModule`, so without that it targets Redis 6379 while this repo publishes 6380.
- **Mock factories must cover the whole import surface.** `chat.e2e-spec.ts`'s `jest.mock('@repo/ai')` was missing `classifyQuery` and `classifyStructuredIntent`. Because `chat.controller.ts` converts any non-`HttpException` into `res.write(...) + res.end()`, the resulting `TypeError` surfaced as **201 with no headers**, so the failure read as `expect(undefined).toContain('text/plain')` rather than as a missing export. When adding a `@repo/ai` call to `ChatService`, update both the unit and e2e factories.

Lint setup as of 2026-08-18 (previously nonexistent — see the correction in `CLAUDE.md`):
- Tooling: ESLint **8** (not 9 — Next 14's `next lint` does not support v9 flat config), `@typescript-eslint/parser` + `/eslint-plugin`, and `eslint-config-next`, all root devDependencies.
- Shared base: `.eslintrc.base.json` at the repo root (`eslint:recommended` + `plugin:@typescript-eslint/recommended`, no type-aware rules so it stays fast). Extended by `apps/api/.eslintrc.json` and each of `packages/{ai,db,types,ui}/.eslintrc.json`. `packages/ui` additionally enables `parserOptions.ecmaFeatures.jsx`.
- `apps/web/.eslintrc.json` extends `next/core-web-vitals` instead, and turns **`react/no-children-prop` off for spec files only**. Reason: those specs are `.ts`, not `.tsx`, so they build elements with `React.createElement`; `ModalProps.children` is REQUIRED, so the typed overload demands `children` INSIDE the props object. Passing it as the third argument to satisfy the rule fails `bun run type-check` with TS2769. Verified both ways — the rule is wrong for this call shape, so it is scoped off rather than the code being bent around it.
- `apps/api`'s lint glob was `{src,apps,libs,test}/**/*.ts`, but `apps/api/apps` and `apps/api/libs` never existed (NestJS generator boilerplate). Corrected to `{src,test}/**/*.ts`.
- Baseline was 28 real violations, all fixed rather than rule-disabled: 19 dead imports/vars, 5 stray semicolons, 3 undocumented stream-drain blocks, and one genuine no-op `try { … } catch (error) { throw error }` wrapper in `tickets.service.ts`.
- Two advisory WARNINGS remain in `apps/web` and do not fail the run: `react-hooks/exhaustive-deps` on `catalog-matches/page.tsx` and `@next/next/no-img-element` on `brand-mark.tsx`.

DuckDB native-binding note as of 2026-08-18 (see `risk-register.md` "Structured SQL Execution"):
- Three suites construct a REAL `DuckDbQueryService` and execute real SQL against real CSVs on disk: `duckdb-query.service.spec.ts`, `structured-query.service.spec.ts`, `comparison.service.spec.ts`. They are the only coverage of the sandbox that gates LLM-generated SQL (`FORBIDDEN_KEYWORDS`, `enable_external_access=false`, the 10s timeout, the 500-row cap). **Do NOT mock `duckdb` in these** — a mock makes them green while deleting the security coverage they exist for.
- `chat.service.spec.ts` needs the binding only as collateral (`chat.service.ts → structured-query.service.ts → duckdb-query.service.ts:2`, a top-level static import). It asserts nothing about DuckDB.
- The binding is fetched per Node ABI at install time. The repo pins Node 22 (ABI 127) via the root `.nvmrc`; run `nvm use` before `bun install`. On an unpinned Node 23/25 the download 404s and all four suites fail at module resolution with `Cannot find module .../duckdb.node`.
- `bash scripts/verify-env.sh` diagnoses this directly (ABI published? binding present? loadable? `.nvmrc` parity?) and prints the recovery command.

Scrape/upload security note as of 2026-07-01:
- `packages/ai/src/web/ssrf.spec.ts` covers blocked hostnames, private/loopback/link-local IP ranges, IPv6 / IPv4-mapped cases, DNS rebinding, and public-host allow path.
- `packages/ai/src/web/crawl.spec.ts` now covers blocked seed rejection and skipping in-scope links whose DNS resolves private.
- `apps/api/src/scrape/scrape.service.spec.ts` now covers API-boundary rejection for non-public scrape seeds before queueing.
- `apps/api/test/documents.e2e-spec.ts` now covers oversized upload rejection, unsupported extension rejection, and allowed small `.txt` upload.

Queue reliability note as of 2026-07-01:
- `apps/api/src/ingest/ingest.service.spec.ts` covers deterministic ingest job ids plus stale `pending`/`processing` reconciliation behavior.
- `apps/api/src/documents/documents.service.spec.ts` covers upload enqueue failure marking the row terminal `failed`.
- `apps/api/src/ingest/ingest.service.spec.ts` now also covers requeue clearing stale `processingStartedAt` and the ingest Bull timeout contract.
- `apps/api/src/scrape/scrape.service.spec.ts` covers scrape enqueue failure, duplicate in-flight reuse, default subtree scope derivation, and stale `queued`/`running` reconciliation.
- `apps/api/src/scrape/scrape.processor.spec.ts` covers live page-count / success / failure counter updates while crawl pages stream in.
- `apps/api/test/scrape.e2e-spec.ts` covers `202` for a new crawl and `200` when the same in-flight crawl is reused.
- `apps/web/src/lib/api/scrape.spec.ts` covers reused-run detection from HTTP status, and `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` covers disabled crawl submit + duplicate-run UI feedback, truthful document-queue summary rendering, and separating run status from labeled page-level counts.

Workspace UX Slice 1 note as of 2026-07-04:
- `apps/api/src/documents/documents.service.spec.ts`, `apps/api/src/documents/documents.controller.spec.ts`, and `apps/api/test/documents.e2e-spec.ts` cover document offset pagination, newest-first ordering, member-readable single download, member-readable bulk zip download, and owner/admin best-effort bulk delete.
- `apps/api/src/scrape/scrape.service.spec.ts` and `apps/api/test/scrape.e2e-spec.ts` cover scrape-run offset pagination, default `pageSize=5`, `q`, and `status`.
- `apps/web/src/lib/api/documents.spec.ts`, `apps/web/src/lib/api/scrape.spec.ts`, route specs under the KB document/scrape proxy folders, and `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` cover query passthrough, raw download proxying, drag/drop upload, search/filter/pagination controls, selected-documents download, and selected-documents delete controls.
- `apps/api/src/storage/storage.service.spec.ts` covers `getBuffer()` when S3 env is available; without `S3_ENDPOINT`, that integration suite intentionally skips.

Workspace package sync note as of 2026-07-01:
- After schema changes in `packages/db/src/schema/*`, run `bun run --cwd packages/db build` before API e2e or runtime verification so `@repo/db` `dist/*` stays aligned with the source schema used by Nest runtime and e2e Jest config.

Confirmed from `apps/web/package.json` as of 2026-06-29:

- `bun run test` — Vitest, runs once (`apps/web/**/*.spec.ts`, node environment, config at `vitest.config.mts` — must be `.mts` not `.ts`, see note below)
- `bun run test:watch` — Vitest, watch mode

Brand asset note as of 2026-07-05, updated 2026-07-06 (folded-page mark → bloom mark):
- `apps/web/src/components/brand-mark.spec.tsx` covers the shared `BrandMark` component (now asserting `data-brand-mark="mnemra-bloom"`) and decorative mode used in already-labelled links.
- `apps/web/app/brand-images.spec.ts` covers the source `public/optra-mark.svg` (asserting `<title>Optra aperture mark</title>` / `data-mark="optra-mark"` — verified 2026-08-16 against `brand-images.spec.ts:13-18`; this line previously named the retired `mnemra-mark.svg` bloom mark), `icon.png` favicon dimensions, `favicon.ico` presence, `apple-icon.png`, and `opengraph-image.png` — dimension/format assertions unchanged.
- `apps/web/app/page.spec.ts`, `apps/web/app/(auth)/*/page.spec.ts`, `apps/web/app/loading.spec.tsx`, and `apps/web/app/chat/loading.spec.tsx` cover that landing, auth, and loading chrome use the shared brand mark (identifier `mnemra-bloom`) instead of the old Sparkles logo.

Chat UI note as of 2026-06-30:
- `apps/web/app/api/workspaces/[id]/chat/**/*.spec.ts` covers streaming proxy + history proxies.
- `apps/web/app/workspaces/[id]/chat/page.spec.ts` covers session list/history loading, source rendering from chat headers/persisted messages, safe Markdown rendering, and full-width bubble layout.
- `apps/web/app/chat/page.spec.ts` covers legacy `/chat` redirect to first workspace chat.

Shared modal/search UX note as of 2026-07-03:
- `apps/web/src/lib/ui/modal.spec.ts` covers rerender focus retention so modal panels do not steal focus back from active inputs on each keystroke.
- `apps/web/src/components/workspace-search.spec.ts` covers `⌘K` autofocus plus no focus loss while typing into workspace search.
- `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` covers scrape-modal autofocus/focus retention and crawl-row labeling (`In progress`, labeled page counts).

Chat cache note as of 2026-06-30:
- `apps/api/src/cache/cache.service.spec.ts` covers Redis exact cache versioning + semantic thresholding.
- `apps/api/src/cache/cache.service.spec.ts` now also covers semantic TTL query filtering (`SEMANTIC_CACHE_TTL_HOURS`) and expired-row cleanup-on-write without masking successful inserts.
- `packages/ai/src/chains/index.spec.ts`, `packages/ai/src/chains/graph.spec.ts`, and `apps/api/src/chat/chat.service.spec.ts` now cover `isFallback` propagation plus the "fallback answers never write exact/semantic cache entries" rule.
- `packages/ai/src/chains/index.spec.ts` and `packages/ai/src/chains/graph.spec.ts` now also assert the partial-context hedge prompt copy stays present while preserving the exact hard no-info sentence, and that partial-context streamed answers remain `isFallback: false` with citations preserved.
- `apps/api/src/chat/chat.service.spec.ts` covers exact-hit, semantic-hit, miss-to-cache, and single-embed behavior.
- `apps/api/test/chat.e2e-spec.ts` covers repeat-question cache hits and version-bump invalidation after KB mutation.

Chat limits note as of 2026-07-01:
- `apps/api/src/limits/rate-limit.service.spec.ts` covers per-user/per-workspace minute buckets and fail-open Redis behavior.
- `apps/api/src/limits/usage.service.spec.ts` covers monthly workspace token budget keys, cap enforcement, and fail-open Redis behavior.
- `apps/api/src/chat/chat.service.spec.ts` now covers miss-path budget check + usage accounting; exact/semantic hits stay usage-exempt.
- `apps/api/test/chat.e2e-spec.ts` now covers `429` after per-user chat rate-limit exhaustion.

Offline eval note as of 2026-07-01:
- `python3 scripts/eval/test_dataset_schema.py` validates `scripts/eval/eval-dataset.json` schema and `evaluate.py` metric list without network.
- `python3 scripts/eval/evaluate.py` is manual/offline verification only; it requires `OPENAI_API_KEY` and Python deps from `scripts/eval/requirements.txt`.

Ticket copilot note as of 2026-07-01:
- `packages/ai/src/chains/ticket-extraction.spec.ts` covers happy path, non-actionable transcript empty result, malformed JSON, refusal, timeout retry, and prompt-injection resistance.
- `apps/api/src/tickets/tickets.service.spec.ts` covers dedup miss/hit, stale deleted-row fallback, unique-violation race fallback, enqueue failure terminal state, pending-stale grace vs timeout, getOne projection, review save audit fields, typed DB insert failure, and cross-workspace 404s.
- `apps/api/src/tickets/ticket-extraction.processor.spec.ts` covers `pending -> processing -> done|failed` transitions plus no-clobber behavior for already-reviewed `done` rows.
- `apps/api/test/tickets.e2e-spec.ts` covers workspace-scoped create/list/get/update flow, PATCH max-length validation, and required IDOR cases (`403` non-member, `404` foreign ticket id).
- `apps/web/app/api/workspaces/[id]/tickets/**/*.spec.ts` covers same-origin ticket proxies, and `apps/web/app/workspaces/[id]/tickets/page.spec.ts` covers pending poll, transcript read-only rendering, confidence summary, low-confidence root-cause affordance, review save, copy-to-clipboard, and failure banner rendering.
- `python3 scripts/eval/test_extraction_dataset_schema.py` validates extraction-eval dataset shape and `evaluate_extraction.py` field list without network.
- `python3 scripts/eval/evaluate_extraction.py` is manual/live verification only; it requires `OPENAI_API_KEY` and Python deps from `scripts/eval/requirements.txt`.

Ticket embedding note as of 2026-07-02:
- `packages/ai/src/vectorstore/index.spec.ts` covers qualifying embed, unchanged skip, content-change re-embed, non-qualifying delete/skip, `backfillTicketEmbeddings()` tallies plus `changedWorkspaceIds`, the live DB `chunks_exactly_one_parent_check`, and `similaritySearchWithTicketSlot()` ticket-slot reservation/floor behavior.
- `apps/api/src/tickets/tickets.service.spec.ts` covers review-save sync trigger, cache-version bump on `embedded`/`deleted`, no bump on `unchanged`/`skipped`, useful→not_useful deletion trigger, non-qualifying no-op, and caught/logged sync failures.
- `packages/ai/src/chains/index.spec.ts` and `packages/ai/src/chains/graph.spec.ts` cover mixed document/ticket citations and ticket-source hydration in both chat paths.
- `apps/web/app/workspaces/[id]/chat/page.spec.ts` covers ticket citation rendering without link plus legacy persisted sources with no `sourceType`.
- `apps/api/test/tickets.e2e-spec.ts` covers PATCH review-save calling the mocked `syncTicketChunk` side effect through the real HTTP path.

`packages/db`/`packages/ai` still have no test commands — only `type-check`/`build`/`lint`. Playwright e2e for `apps/web` is still a known gap — deferred until there's a real multi-page flow worth driving a browser through (Priority 2 web pages).
Confirmed from `packages/ai/package.json` as of 2026-06-30:

- `bun run test` — Vitest, node environment, crawler coverage at `packages/ai/src/web/crawl.spec.ts`
- `bun run test:watch` — Vitest watch mode
- `bun run type-check` — `tsc --noEmit`

LangGraph note as of 2026-07-01:
- `packages/ai/src/chains/graph.spec.ts` covers high-score direct generate, rewrite retry path, fallback after max rewrites, and optional self-grade regenerate.

History-aware chat note as of 2026-07-05:
- `packages/ai/src/chains/history.spec.ts` covers `boundHistory()` token-budget trimming (oldest-first drop, recency preserved, never-exceeds-budget), `toMessages()` role mapping, and the two feature-flag defaults/overrides.
- `packages/ai/src/chains/condense.spec.ts` covers skip-when-no-history, skip-when-`HISTORY_CONDENSE_ENABLED=false`, the condense happy path (prompt contains history + question), fallback to the original question on empty model output, and history bounding before prompt construction.
- `packages/ai/src/chains/models.spec.ts` covers the new `'condense'` role's `OPENAI_CONDENSE_MODEL` → `OPENAI_CHAT_MODEL` → default fallback chain.
- `packages/ai/src/chains/index.spec.ts` and `packages/ai/src/chains/graph.spec.ts` cover history reaching the light-path prompt and all three graph generation call sites (confident-stream, generate, regenerate), the `HISTORY_IN_ANSWER_ENABLED=false` negative case, and that the `isFallback` invariant is unaffected by a non-empty history argument.
- `apps/api/src/chat/chat.service.spec.ts` covers history fetch + condensation on a session with prior turns, cache/embed/generation using the condensed question, the updated `answerQuestion()` call shape, usage accounting including condensed-question tokens only when condensing changed the text, and byte-identical behavior when both flags are disabled.
- `apps/api/test/chat.e2e-spec.ts` extends the existing first-turn test with a same-session follow-up, asserting the second `answerQuestion()` call receives the first turn's content as history while the first call's history argument is empty — the one thing genuinely observable at this layer, since `@repo/ai` is wholesale-mocked in e2e; prompt/condensation content itself is unit-tested only in `packages/ai`.
- DB migration `0013_condemned_silver_surfer.sql` (additive index on `chat_messages(session_id, created_at)`) is verified via `bun run --cwd packages/db build` plus a no-further-diff `drizzle-kit generate:pg` run, per the schema-change verification convention below — not a Jest test, since an index has no application-level correctness behavior to assert.

Note: a plain `vitest.config.ts` failed to load in this repo with `ERR_REQUIRE_ESM` (a transitive dep, `std-env`, is ESM-only and the config got loaded as CJS). Fixed by naming it `vitest.config.mts` instead — forces Vite to treat it as ESM regardless of the package's default module type. If `apps/web` ever adds `"type": "module"` to its `package.json`, re-check whether this workaround is still needed.

## Infrastructure / Docker / Deployment Verification

Infra/config/script changes (Dockerfiles, compose files, CI workflows, deploy shell scripts) are not
Jest-unit-testable in the traditional sense — there is no application behavior inside YAML or a
Dockerfile stage list to assert against. TDD's "failing test first" rule does not apply to these files;
the one exception is `apps/api/src/health/health.controller.ts`, which is real application code
(a NestJS controller) and was TDD'd normally (`health.controller.spec.ts` written first).

For everything else infra-shaped, the pragmatic verification checklist is:

1. Turbo dry graphs must match source imports exactly:
   `bunx turbo run build --filter=@repo/web... --dry=json` includes only `@repo/web` + `@repo/ui`;
   `bunx turbo run build --filter=@repo/api... --dry=json` includes only `@repo/api` + `@repo/ai` + `@repo/db`.
2. Shell/config checks must pass:
   `sh -n docker/api-dev-entrypoint.sh docker/web-dev-entrypoint.sh scripts/deploy.sh scripts/deploy-remote.sh scripts/ensure-seaweedfs-s3-config.sh`,
   `docker compose config --quiet`, and
   `POSTGRES_PASSWORD=postgres DOMAIN=localhost OPENAI_API_KEY=test docker compose -f docker-compose.prod.yml config --quiet`.
3. `docker compose build api web` (dev) and
   `POSTGRES_PASSWORD=postgres DOMAIN=localhost OPENAI_API_KEY=test docker compose -f docker-compose.prod.yml build api web` (prod)
   both succeed with no errors — catches Dockerfile syntax errors, missing COPY paths, lockfile
   mismatches, bad stage targets, and broken filtered workspace installs before ever touching a real VPS.
4. `docker compose up -d` brings up all services; `docker compose ps` shows every service `healthy`
   or `running` with no restart loops.
5. Edit a source file in `apps/api/src` or `apps/web/app` while the dev stack is running; confirm
   the corresponding container's logs show a rebuild/reload (`nest start --watch` recompile log for
   api, Fast Refresh log for web) within a few seconds — this is the hot-reload verification the
   bind-mount + polling setup exists to guarantee.
6. `curl http://localhost:3301/health` returns `200 {"status":"ok"}` (dev) — confirms the endpoint
   and the api container's port mapping both work.
7. `curl http://localhost:3300` returns `200` with the Next.js app HTML (dev).
8. Run each app's existing test suite (`cd apps/api && bun run test`, `cd apps/web && bun run test`,
   plus `packages/db`/`packages/ai`/`packages/ui`'s `bun run test` where defined) to confirm
   infra/rebrand changes did not silently break any test that happened to assert on old
   brand strings or the `support_brain` database name.
9. For prod-readiness without a live VPS: the prod config/build commands above are the required
   pre-flight dry run before trusting an actual Hetzner deploy — this catches lockfile/env-file,
   missing-mount-source, stage-target, and app graph class bugs without needing SSH access. Prod
   `api`/`web` ports are not host-published, so prod smoke checks must use
   `docker compose -f docker-compose.prod.yml exec -T api wget -q -O /dev/null http://127.0.0.1:3001/health`,
   `docker compose -f docker-compose.prod.yml exec -T web wget -q -O /dev/null http://127.0.0.1:3000/`,
   and the deploy-path S3 round-trip Node check inside the `api` container.
   Public HTTPS smoke runs only when `COMPOSE_PROFILES=public` enables bundled Caddy,
   because shared VPS hosts may already have another service bound to `80`/`443`.
10. GitHub Actions workflow (`deploy.yml`) cannot be fully verified without live VPS secrets (by
   design — Claude does not hold VPS SSH credentials). What CAN be verified without secrets: YAML
   syntax validity, `shellcheck` on the embedded script block, and that every command/path/service
   name the script references matches the real `docker-compose.prod.yml` (service names, `/health`
   endpoint, `/opt/mnemra` path).

This is the Deep-task testing strategy for infra changes: no unit tests are force-fitted onto YAML/
Dockerfiles, but the operational checklist above is mandatory before considering infra/Docker/CI
work verified, and is the basis for the manual QA runbook in the implementation plan for any such
change.

## Command Discovery Rules

Claude must verify commands from:

1. `package.json` scripts
2. repository documentation
3. CI/CD configuration

Do not claim commands as valid unless verified.

If command does not exist in package scripts or repo docs, mark as unavailable or propose alternative.

## Demo seeder (`scripts/seed/`)

Populates the local Docker stack with a full demo tenant. Not part of any app's
test suite — it is a developer tool — but it has its own pure-logic coverage
because a silent mistake there produces a broken demo rather than a failure.

- `bun run db:seed` — seed the local database (real, cached embeddings)
- `bun run db:seed --no-embeddings` — skip OpenAI; chunks insert with null vectors
- `bun run db:seed --wipe-only` — remove the demo tenant, insert nothing
- `bun run db:seed:test` — Vitest over `scripts/seed/__tests__/*` (47 tests)

Safety: the seeder refuses to run unless the `DATABASE_URL` host is local
(`localhost`/`127.0.0.1`/`::1`/`postgres`/`optra-db`) — it deletes rows, and
`SEED_ALLOW_REMOTE=true` is required to override. Deletes are always scoped to
`DEMO_WORKSPACE_ID`/`DEMO_USER_ID`; there is no TRUNCATE and no wildcard delete.

Redis defaults to `localhost:6380` (the compose host mapping), not the
`REDIS_PORT=6379` in `.env`, which is only correct inside the container.
Override with `SEED_REDIS_HOST` / `SEED_REDIS_PORT`. The Redis step is
non-fatal: without it only the Insights topic-gaps panel is empty.

### Seeder: production `--once` mode

`bun run db:seed --once` seeds only if the demo workspace does not already
exist, and exits without writing otherwise — no wipe, no re-seed, no overwrite
of a tenant someone has since edited. This is what `docker/seed-demo-if-enabled.sh`
runs from the prod image's CMD when `SEED_DEMO_DATA=true`, so it is safe on
every boot. The script always exits 0: a seeding failure must never stop the API
from starting.

Object storage is required for catalog photos and datasets. If it is
unreachable the seeder logs a warning, skips both, and inserts everything else —
dataset rows in particular are skipped rather than written with a storage key
pointing at a missing object.
