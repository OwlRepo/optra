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

Confirmed from `apps/web/package.json` as of 2026-06-29:

- `bun run test` — Vitest, runs once (`apps/web/**/*.spec.ts`, node environment, config at `vitest.config.mts` — must be `.mts` not `.ts`, see note below)
- `bun run test:watch` — Vitest, watch mode

`packages/db`/`packages/ai` still have no test commands — only `type-check`/`build`/`lint`. Playwright e2e for `apps/web` is still a known gap — deferred until there's a real multi-page flow worth driving a browser through (Priority 2 web pages).
Confirmed from `packages/ai/package.json` as of 2026-06-30:

- `bun run test` — Vitest, node environment, crawler coverage at `packages/ai/src/web/crawl.spec.ts`
- `bun run test:watch` — Vitest watch mode
- `bun run type-check` — `tsc --noEmit`

Note: a plain `vitest.config.ts` failed to load in this repo with `ERR_REQUIRE_ESM` (a transitive dep, `std-env`, is ESM-only and the config got loaded as CJS). Fixed by naming it `vitest.config.mts` instead — forces Vite to treat it as ESM regardless of the package's default module type. If `apps/web` ever adds `"type": "module"` to its `package.json`, re-check whether this workaround is still needed.

## Command Discovery Rules

Claude must verify commands from:

1. `package.json` scripts
2. repository documentation
3. CI/CD configuration

Do not claim commands as valid unless verified.

If command does not exist in package scripts or repo docs, mark as unavailable or propose alternative.
