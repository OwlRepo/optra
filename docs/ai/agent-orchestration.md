# Agent Orchestration

> Purpose: how the orchestrating session dispatches Optra's persona agents for one task: who runs when, what each persona may write, and which domain briefing goes into the dispatch prompt.
> Load rule: read before dispatching any persona, and always when a spec touches both backend and frontend (`AGENTS.md` "Automatic agent routing default").
> Source of truth: this is a MAP. `agents/src/*.agent.mjs` is the executable source, generated into `.claude/agents/*.md` by `bun run agents:generate` and checked by `bun run agents:lint` (`scripts/generate-agent-defs.mjs --check`). If this doc and a generated agent file disagree, the generated file wins; fix this doc in the same change. `ownedGlobs` in the sources must match the File Ownership Rule below literally, and the generator's test asserts that.

## Personas

Claude Code only; Codex is retired in this repo, so nothing is generated under
`.codex/`.

| Persona | Role | Writes |
|---|---|---|
| `01-project-manager` | Produces or confirms the spec, locks the contract, runs the rounds below | the spec / plan only |
| `02-db-architect` | Drizzle schema and migrations | `packages/db/src/schema/**`, `packages/db/drizzle/**` |
| `03-nextjs-frontend-dev` | Next.js 14 App Router pages, BFF route handlers, components | `apps/web/app/**`, `apps/web/src/**`, `packages/ui/src/**` |
| `04-ui-ux-designer` | UX and copy review against `DESIGN.md` "Calm Utility" tokens | review findings only |
| `05-code-reviewer` | Diff review | review findings only |
| `06-security-auditor` | Workspace isolation, JWT/OTP, rate limits and token budgets, secrets, SSRF, upload handling | review findings only |
| `07-test-engineer` | RED round (Jest / Vitest / Playwright specs, `bun run tdd:red`) and post-implementation test review | test files only (`*.spec.ts(x)`, `apps/api/test/*.e2e-spec.ts`, `scripts/seed/__tests__/*`, `apps/e2e/tests/**`, `apps/e2e/support/**`). `ownedGlobs`: `apps/e2e/tests/**`, `apps/e2e/support/**` (the Playwright suite, which no implementer owns); spec files inside the implementers' globs it writes only in Round 1b, when it runs alone |
| `08-accessibility-auditor` | Keyboard, focus, labels, contrast on changed UI | review findings only |
| `09-nestjs-backend-dev` | NestJS modules, services, guards, Bull processors, `packages/ai` chains, shared types | `apps/api/src/**`, `packages/ai/src/**`, `packages/types/src/**` |

## Runtime model matrix

Every generated persona uses the Claude `sonnet` model alias. The model is set
only in `agents/src/*.agent.mjs`; after changing it, run `bun run agents:generate`
and commit the regenerated `.claude/agents/*.md`. The orchestrating session's own
model and reasoning level are chosen per phase by the plan
(`docs/ai/planning.md`).

## File Ownership Rule (one worktree, parallel personas)

`09-nestjs-backend-dev` and `03-nextjs-frontend-dev` run in the SAME worktree
during Round 2. To stop concurrent writes to one file:

1. **db-architect** owns `packages/db/src/schema/**` and
   `packages/db/drizzle/**`. It always runs alone, in Round 0, before the
   contract is locked; never in parallel with the implementers.
2. **nestjs-backend-dev** owns `apps/api/src/**`, `packages/ai/src/**` and
   `packages/types/src/**`. The shared types in `packages/types/src/` are the
   locked contract, so the backend persona owns them; the frontend persona may
   import them but never edit them.
3. **nextjs-frontend-dev** owns `apps/web/app/**`, `apps/web/src/**` and
   `packages/ui/src/**`. That includes the route handlers under
   `apps/web/app/api/**`: they are thin BFF proxies that forward to the NestJS
   API with the caller's token, so they belong to the frontend even though they
   run on the server.
4. If the frontend needs a contract change, it asks the orchestrator, which
   re-issues the contract lock and has the backend persona change the type.
5. **test-engineer** owns `apps/e2e/tests/**` and `apps/e2e/support/**`, the
   Playwright browser suite. Spec files beside source inside the implementers'
   globs it writes only in Round 1b, when it runs alone.
6. Files outside these globs (`apps/web/middleware.ts`, `apps/api/test/**`,
   `scripts/**`, Docker and workflow files) are assigned to exactly one persona
   in the spec, or handled by the orchestrator before Round 2. Never a mid-round
   ownership exception.
7. A spec that would have both implementers touch the same file is defective.
   Split it or give the file to one owner before dispatch. The orchestrator
   catches this at contract lock, not after both report done.

## Round structure

Rounds keep the contract-first order explicit, whichever way the orchestrator
dispatches subagents:

- **Round 0** (only when schema or migrations change): `02-db-architect` alone.
  Wait for it to finish. Its migration follows `docs/ai/planning.md`
  "Migrations".
- **Round 1 — contract lock**: the orchestrator (following the
  `project-manager` persona) fixes the shared types in `packages/types/src/` and
  writes the request/response shape into `docs/ai/contracts/api-contracts.md`.
  This is the orchestrator's own step, not a subagent.
- **Round 1b — RED**: `07-test-engineer` alone, with the locked contract and the
  plan's Test Matrix. It writes every required spec (titles `error:` > `edge:` >
  `regression:` > `happy:`), runs `bun run tdd:red`, commits the tests as
  `test(<scope>): …`, and reports the failing output. Round 2 does not start
  until that RED is recorded (`docs/ai/testing-strategy.md` "Strict TDD").
- **Round 2**: `09-nestjs-backend-dev` and `03-nextjs-frontend-dev` dispatched
  together, in parallel.
- **Round 3**: the orchestrator verifies both outputs against the locked
  contract and the acceptance criteria itself: runs the suites, type-check and
  lint.
- **Round 4 — QA fan-out**: `07-test-engineer`, `05-code-reviewer` and
  `06-security-auditor` together, on every feature. Add
  `08-accessibility-auditor` when the diff touches user-facing UI and
  `04-ui-ux-designer` when it touches UI copy or UX. This is the one canonical
  QA roster; persona prompts point here instead of restating it. Browser QA
  (`/qa`, `/qa-only`) is a skill the orchestrator runs directly, not a persona.

Never merge Round 0/1, Round 2 and Round 3 into one dispatch. Backend-only or
frontend-only specs skip the persona that has nothing to do, but keep the order
0 → 1 → 1b → 2 → 3 → 4.

## Domain briefings

The orchestrator copies the matching briefing(s) verbatim into a
"## Domain Briefing" block of each Round 1b and Round 2 dispatch prompt, chosen by which paths the spec touches.
Facts come from `docs/ai/module-ownership-map.md` and
`docs/ai/risk-register.md`; do not invent new ones here. A domain not listed
here: do not improvise a briefing; ask the user.

### Auth / Permissions — Deep
JWT access token (`mnemra_at`, 15 min) + refresh token (`mnemra_rt`) cookies and
email OTP via Resend (`apps/api/src/auth/`, `apps/api/src/notifications/`,
`apps/web/middleware.ts`). The cookie names are live identifiers; renaming them
logs everyone out. The JWT carries only `{sub, email}`; workspace access is
checked per request by `WorkspaceMemberGuard` and `RolesGuard`.

### Workspaces / Members / Invitations — Deep
Tenant boundary. `apps/api/src/workspaces/`, roles owner/admin/member. Every
tenant query filters by `workspaceId`; ids arriving in a request body must be
proven to belong to the caller's workspace.

### Documents / Ingestion, Knowledge Bases, Web Sources / Scraping — Deep (KB: Standard)
Upload → S3-compatible storage (SeaweedFS locally) → Bull ingest job → chunks
with 1536-dim embeddings. Job `status`, `queueJobId` and `lastError` must stay
accurate. Scraping goes through `packages/ai/src/web/{crawl,ssrf}.ts`; SSRF
protection is not optional.

### Chat / RAG — Deep
`apps/api/src/chat/`, `apps/api/src/cache/`, `apps/api/src/limits/`,
`packages/ai/src/chains/`. Answers must cite their sources. Per-user and
per-workspace rate limits and the monthly token budget are never bypassed.

### Tickets — Deep
AI ticket extraction (`packages/ai/src/chains/ticket-extraction.ts`) in a Bull
job; same job-status and budget rules as ingestion.

### Procurement / Discrepancy — Deep
PO / invoice / goods-receipt upload, parsing (CSV, XLSX, PDF extraction) and the
comparison that produces discrepancy flags (`apps/api/src/procurement/`).
Comparison runs and decisions are append-only evidence; see the risk-register
rows "Comparison Run Integrity" and "Decision Audit Trail".

### Vendor Catalog (price and vision matching) — Deep
`apps/api/src/catalog/`: vendor catalogs, agreed prices (single writer, one
transaction), price history, image storage and vision matching. Photos are
served through the web auth proxy, scoped by `workspaceId`.

### Datasets / Structured Query — Deep
`apps/api/src/datasets/`, `apps/api/src/structured-query/`: LLM-generated SQL
runs in a DuckDB sandbox. Never mock DuckDB in its security specs
(`docs/ai/testing-strategy.md`).

### Insights / Scheduler — Deep
`apps/api/src/insights/`: scheduled background work; job-status integrity rules
apply.

### Search, Workspace Events — Standard
`apps/api/src/search/`, `apps/api/src/events/`: workspace-scoped retrieval and
the activity feed with per-member unread state.

### Marketing / Landing — Tiny
`apps/web/app/page.tsx` and `apps/web/src/components/landing/`: public, no data
fetching. Portfolio-scope copy items are deferred in the risk register, not
blockers.

## Global policy block

`scripts/generate-agent-defs.mjs` appends one shared `GLOBAL_POLICY` block to
every persona prompt: caveman ultra replies, the session persona line, Graphify
first for discovery, adherence to the `AGENTS.md` Canonical Task Flow with its
phase-doc loads (`docs/ai/planning.md`, `docs/ai/execution.md`), reading
`.ai-engineering/core/operating-model.md` before acting, Strict TDD via
`bun run tdd:red`, the workspace-isolation rule, and the Drizzle migration rule
pointer. Edit
the policy in the generator, never in the generated `.claude/agents/*.md`, then
run `bun run agents:generate`.
