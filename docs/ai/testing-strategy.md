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

Storage integration note as of 2026-06-30:
- `apps/api/src/storage/storage.service.spec.ts` is a real integration test against an S3-compatible endpoint.
- Expected local dependency: SeaweedFS at `S3_ENDPOINT=http://localhost:8333`.
- The spec is skipped when `S3_ENDPOINT` is absent so non-storage environments can still run the rest of the API suite.

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
- `apps/web/src/lib/api/scrape.spec.ts` covers reused-run detection from HTTP status, and `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` covers disabled crawl submit + duplicate-run UI feedback plus truthful document-queue summary rendering.

Workspace package sync note as of 2026-07-01:
- After schema changes in `packages/db/src/schema/*`, run `bun run --cwd packages/db build` before API e2e or runtime verification so `@repo/db` `dist/*` stays aligned with the source schema used by Nest runtime and e2e Jest config.

Confirmed from `apps/web/package.json` as of 2026-06-29:

- `bun run test` — Vitest, runs once (`apps/web/**/*.spec.ts`, node environment, config at `vitest.config.mts` — must be `.mts` not `.ts`, see note below)
- `bun run test:watch` — Vitest, watch mode

Chat UI note as of 2026-06-30:
- `apps/web/app/api/workspaces/[id]/chat/**/*.spec.ts` covers streaming proxy + history proxies.
- `apps/web/app/workspaces/[id]/chat/page.spec.ts` covers session list/history loading and source rendering from chat headers/persisted messages.
- `apps/web/app/chat/page.spec.ts` covers legacy `/chat` redirect to first workspace chat.

Chat cache note as of 2026-06-30:
- `apps/api/src/cache/cache.service.spec.ts` covers Redis exact cache versioning + semantic thresholding.
- `apps/api/src/cache/cache.service.spec.ts` now also covers semantic TTL query filtering (`SEMANTIC_CACHE_TTL_HOURS`) and expired-row cleanup-on-write without masking successful inserts.
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

Note: a plain `vitest.config.ts` failed to load in this repo with `ERR_REQUIRE_ESM` (a transitive dep, `std-env`, is ESM-only and the config got loaded as CJS). Fixed by naming it `vitest.config.mts` instead — forces Vite to treat it as ESM regardless of the package's default module type. If `apps/web` ever adds `"type": "module"` to its `package.json`, re-check whether this workaround is still needed.

## Command Discovery Rules

Claude must verify commands from:

1. `package.json` scripts
2. repository documentation
3. CI/CD configuration

Do not claim commands as valid unless verified.

If command does not exist in package scripts or repo docs, mark as unavailable or propose alternative.
