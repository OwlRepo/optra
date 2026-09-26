@AGENTS.md

# Optra — project context

> The workflow (Canonical Task Flow, core principles, stop conditions, agent
> routing, caveman default, persona) is imported above from `AGENTS.md`. This
> file holds project facts only. If anything here contradicts the code, the code
> wins; fix this file in the same change.

## What Optra is

Optra is a multi-tenant procurement SaaS. Buyers connect their own vendor
catalogs, purchase orders and invoices, and Optra matches every PO line against
the catalog entry (price, quantity and product photo) and flags discrepancies
before payment, with a citation behind every verdict. It is built on a
multi-tenant RAG core that still powers grounded chat over a workspace's own
documents, AI ticket extraction and web-source crawling.

**Built to production standards, but not a production service.** Corrected
2026-08-16 on the owner's word: this is a **personal portfolio project shown to
interviewers**. There are no external customers, no billing and nothing to buy.
It is still engineered and deployed like the real thing (multi-tenant
workspaces, JWT + OTP auth, rate limits and token budgets, GitHub Actions CI/CD
auto-deploying to a live VPS with backups), so the engineering discipline
applies in full.

What that distinction changes, and what it does not:

- **Unchanged: keep the rigour.** TDD, workspace-isolation checks, migration
  care, job-status integrity, and the Deep classification for auth, schema,
  queue and RAG work. These are what a reviewer looks at, and they are the point
  of the project.
- **Relaxed: public claims and billing.** Marketing copy that promises a metered
  quota, a certification or a customer relationship is not a launch blocker
  while nothing can be bought and nobody is onboarded. Log such items in
  `docs/ai/risk-register.md` as deferred-with-conditions instead of blocking the
  change. They become blockers the moment real users or payments exist.

> *Naming note (corrected 2026-08-16, 2026-09-20):* the product was renamed
> Mnemra → Optra in the 2026-07-10 repositioning; only prose was updated.
> `mnemra_at` / `mnemra_rt` / `mnemra_session_active` (cookie names) are **live
> production identifiers** (`apps/api/src/auth/auth.controller.ts`,
> `apps/web/middleware.ts`). They still read "mnemra" on purpose; renaming them
> is an auth operation that logs out every session, not a docs fix. This repo
> has no `MNEMRA_*` variables (they became `OPTRA_*`,
> `docs/ai/risk-register.md`). Its prod compose runs `optra-prod-*` containers
> (`docker-compose.prod.yml`, `name: optra-prod`) from `/home/deploy/apps/optra`
> (`.github/workflows/deploy.yml`). `mnemra.tyvera.app`, `mnemra-prod-*` and
> `/home/deploy/apps/mnemra` belong to a separate live app on the same VPS.

## Tech stack REAL

Verified against the files cited:

- **Monorepo:** Turborepo + Bun 1.2.22 workspaces `apps/*`, `packages/*`
  (root `package.json` `packageManager`, `workspaces`; `turbo.json`). Node 22
  for tests and tooling (`.nvmrc`).
- **`apps/web`:** Next.js 14 App Router + React 18 + Tailwind v4 (`apps/web/package.json`),
  shadcn-style UI primitives from `packages/ui` (`@repo/ui`). Route handlers
  under `apps/web/app/api/**` are thin BFF proxies to the API; auth redirects in
  `apps/web/middleware.ts`.
- **`apps/api`:** NestJS 10 REST API (`apps/api/package.json`) with Bull 4 job
  queues on Redis, Passport JWT + email OTP via Resend, S3-compatible storage
  (SeaweedFS locally, `docker-compose.yml`; Backblaze B2 in production, with no
  object-store container in `docker-compose.prod.yml`), DuckDB for sandboxed
  structured queries. Modules live in `apps/api/src/<domain>/`.
- **`packages/db`:** Drizzle ORM on PostgreSQL 16 + pgvector
  (`pgvector/pgvector:pg16` in `docker-compose.yml`). Schema in
  `packages/db/src/schema/` (37 tables, 21 enums, counted from
  `export const … = pgTable(` / `pgEnum(` on 2026-09-23); SQL migrations in
  `packages/db/drizzle/`.
- **`packages/ai`:** LangChain / LangGraph RAG pipeline on OpenAI
  (`packages/ai/package.json`). Chat/answer models are gpt-4-turbo and
  gpt-4o-mini; procurement extraction and catalog matching use gpt-4o
  (`OPENAI_PROCUREMENT_EXTRACTION_MODEL`, `packages/ai/src/chains/models.ts`).
  Embeddings are `text-embedding-3-small` at 1536 dimensions
  (`.env.example`, `packages/db/src/schema/chunks.ts`).
- **Analytics:** self-hosted Umami (`umami` service in `docker-compose.yml` and
  `docker-compose.prod.yml`, host port 3302) in its own `umami` database on the
  shared Postgres, created by `docker/init-db.sql` and dumped by
  `scripts/backup.sh`.
- **`packages/types`:** shared TypeScript contracts, type-only (no test runner).
- **Tests:** Jest in `apps/api` (unit `*.spec.ts` with `rootDir: src`; e2e
  `apps/api/test/*.e2e-spec.ts`), Vitest in `apps/web`, `packages/ai`,
  `packages/db`, `packages/ui` and `scripts/seed`, `node --test` for
  `scripts/**/*.test.mjs`. Inventory: `docs/ai/testing-strategy.md`.
- **Deploy:** one workflow, `.github/workflows/deploy.yml` ("CI and Deploy"):
  `ci` on every push and PR, `deploy` only for `main` after `ci`, over SSH to a
  single VPS running `docker-compose.prod.yml`. No dev or stg environment.

## How I think about this product

*(inferred, please correct if wrong)*

- **Workspace isolation is the trust boundary.** Every query against tenant
  tables filters by `workspaceId`, and every handler proves the caller is a
  member of the target workspace. Cross-workspace leakage is the worst bug this
  product can have.
- **Answers must be trustworthy and cited.** A confident wrong or uncited answer
  is worse than no answer; source attribution matters as much as retrieval
  quality. The same holds for discrepancy verdicts.
- **LLM cost controls are load-bearing features.** Per-user (20/min) and
  per-workspace (200/min) chat rate limits and the 5M-token monthly workspace
  budget (`.env.example`; `apps/api/src/limits/`) are never bypassed by a new
  chat, refine or extraction path.
- **Async pipeline integrity is user-visible.** Bull jobs (ingest, scrape,
  ticket extraction, procurement and catalog parsing) that fail silently look
  like lost data. `status`, `queueJobId`, `lastError` and timing fields stay
  accurate on every queue-touching change.
- **It is live.** Migrations, env vars and deploy scripts touch a running
  system. Treat schema and infra changes as production operations: backups
  exist, but rollback thinking is required.

## Communication style

- Explanations, teaching and plan summaries are in plain, simple English. When a
  technical term is needed, attach an analogy so it can be pictured. (Status
  updates follow the caveman ultra default from `AGENTS.md`.)
- Explain the "why" behind a change, not only the "what".
- When several approaches are valid, state the tradeoff briefly and recommend one
  with a reason.
- A question in the middle of implementation: stop, answer it fully, then
  continue.
- When the user pushes back, engage with the reasoning instead of agreeing by
  default. Explain if they are wrong; adjust if they are right.
- Never say "for now" about anything with scalability implications.
- Code, paths, commands, API names and error strings are quoted exactly, never
  paraphrased.

## Conventions

- **Source of truth.** Real code, tests, types, schemas, migrations, routes and
  `package.json` scripts. `docs/ai/*` files are maps, never proof. When a map
  conflicts with code, code wins; say so out loud, mark `CONTEXT DRIFT` (or
  `CONTRACT DRIFT` for API/DB/test/risk docs), and fix the doc in the same
  change, touching only the rows the drift affects. Full re-sync procedure:
  `docs/ai/context-refresh.md`.
- **`UNVERIFIED DEPENDENCY`.** If a migration, schema, contract, permission or
  integration detail is unknown, mark it and stop. No implementation until it is
  resolved. Never guess schema, the isolation/permission model, or a public API
  shape.
- **Docs sync.** Every change updates the matching `docs/ai/*` entries in the
  same change. A touched area with no entry gets one instead of being left
  `UNMAPPED`.
- **Repository map.** `docs/ai/file-index/repository-map.md` maps significant
  symbols (exported functions, public types, services, routes, schema
  definitions, key components, workflow scripts) to files. Discovery order is
  Graphify, then this map, then grep (`AGENTS.md` node `K`). Add or fix an entry
  in the same change whenever a significant symbol is created, moved or found
  stale.
- **Shared contracts.** Request/response and domain types shared by web and api
  live in `packages/types/src/` and match `docs/ai/contracts/api-contracts.md`.
- **UI.** Consume the design tokens in `packages/ui/src/globals.css` per
  `DESIGN.md`; no arbitrary colours or spacing (see "Design System" below).
- **Map formats.** `docs/ai/module-ownership-map.md` and
  `docs/ai/risk-register.md` keep their existing column sets; the risk values
  are Tiny / Express / Standard / Deep. Unknown cells read
  `TODO: Fill after repository analysis. Do not treat as verified.`

## DB rules

- Every tenant-table query filters by `workspaceId`; ids from a request body are
  proven to belong to the caller's workspace before use.
- Migrations are Drizzle SQL in `packages/db/drizzle/`, generated with
  `bun run db:generate` and applied with `bun run db:migrate` (both in
  `packages/db`). The API container applies them on start in dev and prod, and
  CI applies them before the tests. They are additive and backward compatible,
  destructive steps need the owner's explicit approval, and `db:push` is never
  run against production. Canonical rule: `docs/ai/planning.md` "Migrations".
- The embedding dimension stays 1536 (`text-embedding-3-small`). Changing the
  embedding model or dimension is a schema + reindex event, not a config tweak.
- No schema or migration change without explicit confirmation; every one is
  Deep.

## How agents operate

- **One task, one worktree.** `git fetch origin`, then
  `scripts/new-task-worktree.sh <type> <short-name> [<base-ref>]`. Branch name
  `<fix|feat|enhancement|refactor|perf|infra>/no-ticket-<short-name>`. Base is
  `origin/main`, or the parent slice's branch for a stacked slice. Details:
  `docs/ai/execution.md`.
- **Never commit to `main`.** `scripts/git-hooks/pre-commit` blocks it. Work
  lands as one PR into `main`, merged with "Create a merge commit"; a stacked
  slice's PR targets its parent and is retargeted to `main` after the parent
  merges (`docs/ai/handoff.md` "Release flow"). Check PR status with
  `gh pr checks <number>`; never assume green.
- **Plan gate.** `.claude/hooks/check-plan-gate.sh` blocks source edits unless
  `.claude/.plan-ack` records the task size (and `plan:"approved"` for
  Standard/Deep). Formats: `docs/ai/plan-template.md`.
- **TDD gate.** `scripts/hooks/tdd-red-guard.mjs` blocks guarded-source edits
  until `bun run tdd:red` records a valid RED; CI re-checks with
  `bun run tdd:gate`. Rule: `docs/ai/testing-strategy.md` "Strict TDD".
- **Personas.** Generated from `agents/src/*.agent.mjs` into `.claude/agents/`
  by `bun run agents:generate`; routing and file ownership in
  `docs/ai/agent-orchestration.md`.
- **Learnings.** `learnings.md` gets one entry per new pattern, library or
  design decision at handoff; the Predicted line comes from the approved plan
  (`docs/ai/handoff.md`).
- **gstack `check-gstack.sh`** still gates Skill calls
  (`.claude/settings.json`).

## Three test layers

Owner decision 2026-09-25: every change ships with the tests for each layer it
touches, written first.

| Layer | Where | Required when the change touches |
|---|---|---|
| **Unit** | `*.spec.ts` beside the code (Jest in `apps/api`, Vitest elsewhere) | any service, controller, processor, guard, filter, helper, component or BFF route |
| **API e2e** | `apps/api/test/*.e2e-spec.ts` (real Nest app, real Postgres + Redis/Bull) | any API route: its status codes, guards, pipes, filters, and what it writes |
| **Browser e2e** | `apps/e2e/tests/*.spec.ts` (Playwright: real browser → Next.js BFF → API → Postgres/Redis/SeaweedFS) | any page or BFF route, and any flow a person clicks through |

Cover the happy path **and** the error paths a user can hit: wrong input, too
large, not a member, another workspace's id, the thing gone. A layer is skipped
only when the change genuinely cannot be observed there, and then the commit
says so with a `Test-Layers-Skip: <reason>` trailer (one line, in the message's
final paragraph). **Enforced:** `scripts/check-test-layers.sh` runs first in CI
and fails a push whose commits change a service/controller/processor/guard/
filter/pipe/interceptor, a shared helper under `apps/api/src/common/`, the web
middleware or a BFF helper without a sibling spec, a controller without an API
e2e change, or a page/BFF route without a Playwright change. Both e2e layers
gate deploy. This complements the TDD gate above: that one proves the tests
fail first, this one proves every layer has them. Detail:
`docs/ai/testing-strategy.md` → *Required test layers*.

## Verified commands

From real `package.json` scripts; never invent others. Each package runs its own
tests (no root `test` script, no turbo `test` task).

- Root: `bun run lint`, `bun run type-check`, `bun run build`, `bun run dev`
  (turbo); `bun run db:seed`, `bun run db:seed:test`;
  `bun run docker:dev:up` / `docker:dev:build` / `docker:dev:logs` /
  `docker:dev:down`; `bun run docker:prod:build` / `docker:prod:up`;
  `bun run deploy` / `deploy:remote`.
- Root workflow tooling: `bun run tdd:red`, `bun run tdd:gate`,
  `bun run test:scripts`, `bun run agents:generate`, `bun run agents:lint`;
  `prepare` sets `core.hooksPath` on install.
- `apps/api`: `bun run test` (Jest; runs on its own `optra_unit` database
  recreated each run, in UTC — never the dev DB), `bun run test:watch`,
  `bun run test:cov`, `bun run test:e2e` (16 Jest e2e suites in `apps/api/test/`,
  part of the CI gate; locally on a fresh database:
  `bun apps/e2e/scripts/prepare-db.ts optra_e2e`, then
  `DATABASE_URL=…/optra_e2e bun run test:e2e`).
- `apps/e2e` (Playwright, part of the CI gate): `bun run test:e2e` (browser
  suite against the local stack — needs
  `docker compose up -d --wait postgres redis seaweedfs` and built apps),
  `bun run test:smoke` (production smoke, by hand — `docs/ops/prod-smoke.md`);
  root `bun run e2e` builds api+web then runs the browser suite.
- Guards: `sh scripts/check-test-layers.sh <base-sha>` (self-test
  `sh scripts/check-test-layers.spec.sh`); `sh scripts/check-prod-env.sh`
  (self-test `sh scripts/check-prod-env.spec.sh`; the deploy runs it before
  backup and build).
- `apps/web`, `packages/ai`, `packages/db`, `packages/ui`: `bun run test`
  (Vitest); `apps/web` also `bun run test:watch`.
- `packages/db`: `bun run db:generate`, `bun run db:migrate`, `bun run db:push`
  (never against production), `bun run db:studio`.
- `bun run lint` correction (2026-08-18): it used to be listed without ever
  having run to completion (no ESLint installed, no config). It now works: ESLint
  8 + `@typescript-eslint` + `eslint-config-next` at the root, a shared
  `.eslintrc.base.json`, `next/core-web-vitals` for `apps/web`, and a `lint`
  script in all six packages. Details: `docs/ai/testing-strategy.md`.

## Don't do this

- No speculative architecture beyond the current step; no unrelated refactors
  bundled into a change.
- No new dependency without flagging it, saying why, and getting approval.
- No schema or migration change without explicit confirmation.
- Do not touch files outside the plan's file list; do not rename public APIs
  unless it was discussed. The `mnemra_*` cookie names are public, live
  identifiers.
- Never weaken, skip or delete a test to make a suite pass; never mock DuckDB in
  the specs that exist to test its sandbox.
- Never bypass rate limits or token budgets in a new LLM path.
- No Codex artifacts: no `.codex/`, `.codex/instructions.md` or
  `.ai-scratchpad.md`. If one reappears from an old branch, flag it as stale and
  ask before deleting. `AGENTS.md` is allowed; it is the core this file imports.
- Never hand-edit `.claude/agents/*.md`; edit `agents/src/` and run
  `bun run agents:generate`.
- Never flip `activation` in `.ai-engineering/config/autonomous-engineering.yaml`;
  only the owner does that, in a reviewed PR.
- Never touch the separate `mnemra` app on the shared VPS.

## gstack

gstack is installed at `~/.claude/skills/gstack`. Use `/browse` for all web
browsing, never `mcp__claude-in-chrome__*` tools directly. Read the installed
skill list from that directory rather than trusting a hardcoded list. gstack
also ships a `/codex` skill; nothing in this repo routes to it.

## SDLC Stage Map — maximize gstack

One default skill per lifecycle stage. Use it rather than hand-rolling a stage a
skill already owns, and offer the next stage when one finishes (for example,
implementation done → `/qa`, then `/review`, then PR per `docs/ai/handoff.md`).

| Stage | Default skill | When |
|---|---|---|
| Idea / scope | `/office-hours`, `/plan-ceo-review` | fuzzy product idea → sharpened scope |
| Spec | `/spec` | vague intent → backlog-ready spec |
| Bug RCA | `/investigate` | bugs/errors; feeds `docs/ai/prompts/bugfix-rca.md` |
| Plan review | `/plan-eng-review`, `/plan-design-review`, or `/autoplan` | Standard/Deep plans, before approval |
| Implement | `AGENTS.md` flow + `docs/ai/execution.md` (TDD, personas) | after plan approval |
| QA | `/qa` (test + fix) or `/qa-only` (report only) | after implementation |
| Code review | `/review` | pre-landing diff check |
| Visual polish | `/design-review` | any UI-touching change |
| Ship | `/ship` or `/land-and-deploy`, within `docs/ai/handoff.md` | tests green + review clean |
| Post-deploy | `/canary` | after a production deploy |
| Release docs | `/document-release` | after ship |
| Code health | `/health` | periodic quality dashboard |
| Retro / learning | `/retro` + `learnings.md` entry | weekly, and after Deep tasks |
| Save / resume context | `/context-save` / `/context-restore` | long-running or multi-session work |

## Skill Routing

The stage map is proactive (lifecycle order); this list is reactive (match the
request as it arrives). When a request fits, invoke the skill.

- Product ideas / brainstorming → `/office-hours`
- Strategy / scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system / plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs / errors → `/investigate`
- QA / testing site behaviour → `/qa` or `/qa-only`
- Code review / diff check → `/review`
- Visual polish → `/design-review`
- Ship / deploy / PR → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
- Backlog-ready spec / issue → `/spec`
- Codebase questions and discovery → `/graphify query|path|explain`

## Design System

`DESIGN.md` defines the "Calm Utility" design system: Outfit / DM Sans /
JetBrains Mono type stack, oklch colour tokens (source of truth:
`packages/ui/src/globals.css`), Tailwind 4px spacing, sidebar-shell layout,
minimal functional motion. Read it before any visual or UI decision. No
deviation without explicit approval; flag anything that does not match.
