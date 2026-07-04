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
- `apps/web/src/lib/api/scrape.spec.ts` covers reused-run detection from HTTP status, and `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` covers disabled crawl submit + duplicate-run UI feedback, truthful document-queue summary rendering, and separating run status from labeled page-level counts.

Workspace UX Slice 1 note as of 2026-07-04:
- `apps/api/src/documents/documents.service.spec.ts`, `apps/api/src/documents/documents.controller.spec.ts`, and `apps/api/test/documents.e2e-spec.ts` cover document offset pagination, newest-first ordering, member-readable single download, and member-readable bulk zip download.
- `apps/api/src/scrape/scrape.service.spec.ts` and `apps/api/test/scrape.e2e-spec.ts` cover scrape-run offset pagination, default `pageSize=5`, `q`, and `status`.
- `apps/web/src/lib/api/documents.spec.ts`, `apps/web/src/lib/api/scrape.spec.ts`, route specs under the KB document/scrape proxy folders, and `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` cover query passthrough, raw download proxying, drag/drop upload, search/filter/pagination controls, and selected-documents download.
- `apps/api/src/storage/storage.service.spec.ts` covers `getBuffer()` when S3 env is available; without `S3_ENDPOINT`, that integration suite intentionally skips.

Workspace package sync note as of 2026-07-01:
- After schema changes in `packages/db/src/schema/*`, run `bun run --cwd packages/db build` before API e2e or runtime verification so `@repo/db` `dist/*` stays aligned with the source schema used by Nest runtime and e2e Jest config.

Confirmed from `apps/web/package.json` as of 2026-06-29:

- `bun run test` — Vitest, runs once (`apps/web/**/*.spec.ts`, node environment, config at `vitest.config.mts` — must be `.mts` not `.ts`, see note below)
- `bun run test:watch` — Vitest, watch mode

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
6. `curl http://localhost:3101/health` returns `200 {"status":"ok"}` (dev) — confirms the endpoint
   and the api container's port mapping both work.
7. `curl http://localhost:3100` returns `200` with the Next.js app HTML (dev).
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
