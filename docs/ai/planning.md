# Planning Rules

> Purpose: every rule that governs WRITING a plan. Mandatory read before any plan.
> Load rule: read together with `docs/ai/plan-template.md` at flow node `L` (`AGENTS.md`). A plan written without both is invalid, and its metadata must say `Docs loaded: planning.md, plan-template.md`.
> Source of truth: real code, tests, types, schemas, migrations, routes and `package.json` scripts always beat maps and prose. If a map disagrees with code, code wins and the map is fixed in the same change.

## Docs first, then verify against the repository

Start with what is already written down: `docs/ai/*` (maps, contracts, risk
register, testing strategy), `DESIGN.md`, `DEPLOYMENT.md`, `DOCKER.md`, and
`docs/*.md`. When a doc and the code disagree, trust the code and correct the
doc in the same change (`CONTEXT DRIFT` / `CONTRACT DRIFT`).

Then verify against the code itself:

1. Search exhaustively, not only the files the request names. Find every call
   site, consumer, test, controller route, BFF route under
   `apps/web/app/api/**`, Bull processor, migration and shared type the change
   can reach, and inspect each. Confirm every path and symbol you cite exists.
   An exhaustive search at plan time is what stops a plan from correcting
   itself halfway through execution.
2. List every usage of each symbol that will change (these feed the Backward
   Compatibility Matrix).
3. Check for reusable services, guards, decorators, DTOs, `@repo/ui`
   components, hooks and helpers BEFORE proposing a new file or abstraction. If
   nothing fits, name the candidates you inspected and why each one fails.
4. Never guess file names, symbols, endpoints, columns, env vars or patterns.
   Report what is missing; do not invent a replacement.
5. Every fact in a plan traces to a file and line read in this session. Cite
   the important ones as path + symbol + verified behaviour + why it matters.
6. A task that depends on an unverified schema, permission rule, FE/BE contract
   or external integration is marked `UNVERIFIED DEPENDENCY`; investigate before
   writing code that assumes it.

Discovery order is Graphify, then `docs/ai/file-index/repository-map.md`, then
`grep` (see "Mandatory Graphify phase" below).

## Phases, model detection and the switch stop

Every plan is cut into phases. Each phase names BOTH a model tier and a
reasoning level. First state the model running this session (from its own
system context); `ecc:model-route` can help pick tiers relative to it but
cannot detect the running model.

At the end of each executed phase, compare the next phase's (model tier,
reasoning level) pair with the current one:

- Identical pair → continue automatically. No confirmation stop.
- Different in either dimension → STOP, state the switch needed, and wait for
  the user.

Optra's old "pause after every step" rule is retired; this pair comparison is
the only automatic stop inside an approved plan. The Deep-task approvals
(discovery at `E`/`G`, plan at `R`) still apply before execution starts.
Structured work orders that could resume across a switch are disabled while
`.ai-engineering/config/autonomous-engineering.yaml` says
`activation: PILOT_FROZEN` (`docs/ai/autonomous-engineering.md`).

## Plan format

Use the skeleton in `docs/ai/plan-template.md` exactly. Plans are
deterministic: each step is a literal old-text/new-text block copied from the
file as it is now (or, for a new file, its complete content), never a prose
description of the change. Anchor blocks on symbol names (function, class,
component, test title); line numbers are hints only, because parallel sessions
shift them. The executing model decides nothing that could have been decided at
plan time.

Save the approved plan to `docs/plans/<branch-short-name>.md` before execution
starts. `docs/plans/infra-ai-workflow-port.md` is the first plan saved this way.

Prefer the simplest correct solution: fewer moving parts, fewer new files and
fewer new abstractions win when they solve the same problem. Simple must still
hold long term. A fix that only covers the reported path is a band-aid; name it
as one and plan the durable version. State each fact (a rule, a list, a
canonical value) in exactly ONE step and reference it everywhere else; no step
may restate or contradict an earlier one.

### Forbidden language

These are not plan operations: "update component", "adjust layout", "modify
styles", "preserve behavior" (without naming the behaviour and its proof),
"where needed", "update consumers", "improve implementation", "if necessary",
"etc.", "appropriate files", "relevant modules". The same goes for any prose
paraphrase of a code change ("rename the function", "add a check for X") where a
literal old/new block is possible: read the file (or `git show`) and write the
block. Prose is fine only for content with no prior state, such as a new file's
full body or a directional decision that has no fixed wording yet.

### Plan completion gate

A plan is invalid until every item holds:

- Every file path is explicit, and the file list is the complete set of files
  implementation may touch (blast-radius rule, `docs/ai/plan-template.md`).
- Every modified symbol is named.
- Every code operation is a literal old/new block or full new-file content.
- Every dependency is listed; a new package is flagged with its reason (new
  dependencies need approval, `.ai-engineering/config/autonomous-engineering.yaml`
  `approval.new_dependencies`).
- Every acceptance criterion is traced: criterion → file → symbol → step →
  validation.
- Every test is mapped: exact file, scenario, assertions, with titles prefixed
  `error:` / `edge:` / `regression:` / `happy:` in that order. Never "extend
  tests".
- Every regression risk is mapped: file, symbol, reason, and the validation that
  proves it safe.
- Standard/Deep: the Risk Matrix and Backward Compatibility Matrix are present
  and the usage search behind the second one is recorded.
- Every new file is justified against the reuse candidates that were checked.
- No forbidden language remains.
- No two steps or phases state or contradict the same fact.
- The approach is the simplest correct one; a simpler option that was rejected
  is named with the reason.
- Every causal claim names its evidence AND the observation that would disprove
  it. A claim nobody can falsify with an available check is labelled a
  hypothesis. Ruling a suspect out counts as evidence and is stated, so it is
  not proposed again later.
- Every measurement states what the metric divides by and why the sample is
  valid for it: fixed overhead amortised or reported separately, cache and
  warm-up state controlled. (A timing taken over too small a sample is dominated
  by startup cost and points the investigation the wrong way.)
- No gaps, no unverified items, no guesses, no unsafe steps. Each open question
  is answered with a file/line or listed as a blocker that stops the plan.
- Every edge and error case found during the search is listed with where it is
  handled (file, function, branch), separately from the tests that prove it.
- The plan carries one high-level SVG flowchart of problem → solution
  (`docs/ai/plan-template.md` "Flowchart").

## Batch scheduling (multi-task plans)

Produce Parallel Group A, Parallel Group B, Sequential Tasks and Merge Order.
Run tasks in parallel only when they share no files, symbols, types, schemas,
endpoints or business rules. Merge order: shared foundations → schema and
migrations → shared types / API contracts → backend → frontend consumers →
dependent enhancements → independent fixes. Analyse as a batch; execute each
task in isolation (one branch + worktree each, `docs/ai/execution.md`).

## Drizzle/Postgres discipline

Every step that reads or writes the database states:

- Explicit selected columns in Drizzle queries; no implicit "select everything"
  when only a few columns are used.
- The `workspaceId` filter on every tenant table, and how the handler proved the
  caller is a member of that workspace (`WorkspaceMemberGuard` and roles; see
  `docs/ai/module-ownership-map.md` "Auth / Permissions"). An id from a request
  body proves a row exists, not that it belongs to the caller's workspace
  (`docs/ai/risk-register.md` "Cross-Workspace Ids In Request Bodies").
- Pagination or a `limit` on any list whose size is not bounded by construction
  (`docs/ai/risk-register.md` "Unbounded List Responses").
- No N+1: batch lookups (one `inArray` query or a join) instead of a query per
  row; `Promise.all` for independent reads.
- Transactions for multi-row writes that must succeed or fail together.
- pgvector: similarity queries use the indexed `vector_cosine_ops` path (for
  example `chunks_embedding_hnsw_idx` in `packages/db/drizzle/0011_sticky_scream.sql`)
  and stay inside the workspace filter. The embedding dimension is 1536
  (`packages/db/src/schema/chunks.ts`); changing the model or the dimension is a
  schema + reindex event, never a config tweak.
- LLM cost: any new path that calls OpenAI goes through the existing rate-limit
  and token-budget services in `apps/api/src/limits/`
  (`rate-limit.service.ts`, `usage.service.ts`, `chat-rate-limit.guard.ts`) and
  says which budget it charges. Never bypass them.
- Bull jobs: any queue-touching step keeps `status`, `queueJobId`, `lastError`
  and timing fields accurate on every exit path.
- Flag anything that raises row scans, connection count, Redis traffic or
  OpenAI spend, and reduce it before implementation.

## Migrations (canonical rule)

How migrations work here (verified):

- Schema lives in `packages/db/src/schema/`; SQL migrations live in
  `packages/db/drizzle/` (`packages/db/drizzle.config.ts`: `out: './drizzle'`).
- Generate with `bun run db:generate` inside `packages/db` (drizzle-kit). Some
  constraints drizzle-kit cannot emit and must be hand-written; see
  `docs/ai/risk-register.md` "Schema Constraints drizzle-kit Cannot Emit" and
  "Altering A Postgres Enum".
- Apply with `bun run db:migrate` inside `packages/db`
  (`packages/db/scripts/migrate.ts`). It runs in three places:
  - CI: the "Apply database migrations" step of the `ci` job in
    `.github/workflows/deploy.yml` (fresh, empty database).
  - Local dev container start: `docker/api-dev-entrypoint.sh`.
  - Production API container start: the `CMD` in `apps/api/Dockerfile`, so
    `main` → deploy applies pending migrations on the VPS (`DEPLOYMENT.md`
    "Database Migrations").
- `db:push` is never used against production (`docs/PRODUCTION-READINESS.md`
  row F6).

Any plan with a migration must satisfy ALL of:

- Additive and backward compatible: no modifying or deleting existing data, no
  dropping or renaming tables/columns that code running against the old schema
  still uses, no `NOT NULL` column without a `DEFAULT` (or a backfill in the same
  migration).
- Code that depends on the migration still works before it is applied, and the
  plan says how each dependent path behaves on the old schema. The API applies
  migrations on start, so old and new code briefly share one schema during a
  deploy.
- Destructive operations happen ONLY with explicit approval from the owner
  (Romeo) in chat, recorded in the plan, and with a rollback note.
- Forward-only and idempotent where hand-written (`IF NOT EXISTS` /
  `IF EXISTS`), with the next unused sequence number; two migrations claiming
  the same number break every deploy.
- Verified outside CI as well: the CI job only ever applies migrations to an
  empty database (`docs/ai/testing-strategy.md`, S4 note on `0022`/`0023`), so
  a migration that touches existing rows is also run against a local database
  that already holds data (for example the `bun run db:seed` demo tenant).
- Tested: a `packages/db` spec, an `apps/api` e2e spec, or a
  `Migration-Waiver:` line in the PR (`docs/ai/testing-strategy.md` "Strict
  TDD").

Every migration and schema change is Deep (`docs/ai/risk-register.md`
"Database Migrations").

## UI steps

Any step that renders data names its loading, empty, success and error states
as acceptance criteria, not polish. Use the existing `@repo/ui` primitives
(`packages/ui/src/components/ui/`: `skeleton`, `empty-state`, `status-banner`,
`toaster`, …) and the design tokens in `packages/ui/src/globals.css`, per
`DESIGN.md`. No arbitrary colours or spacing. A background failure must surface
to the user, never fail silently.

## Mandatory Graphify phase (every implementation plan)

### Graphify is the discovery tool

Finding things (where a symbol is used, what calls what, which module owns a
file) goes through Graphify against the committed `graphify-out/graph.json`:
`/graphify query "<question>"`, `/graphify path "<a>" "<b>"`,
`/graphify explain "<symbol>"`. The CLI is installed at `~/.local/bin/graphify`.
Next is `docs/ai/file-index/repository-map.md`. `grep`/`Grep`/`rg` is the
fallback for literal strings, unindexed file types, or a stale or empty graph,
and a plan that used it names the graphify query that failed and why.

Copying a file's exact current text into an old/new block is not discovery;
read the file (or `git show`), because the graph does not store literal text.

### Closeout refresh

Every implementation plan ends with a Graphify maintenance step. After the last
edit to any indexed source or doc, and before review, commit and handoff, run
the procedure below from the repo root. Repeat it after any later indexed edit
or a rebase that changes indexed files. This section is the one canonical
statement of the refresh; other docs link here instead of restating it.

1. `/graphify . --update` (load the graphify skill; incremental, with the
   semantic pass only on uncached docs). Plain `graphify update .` is AST-only
   and never refreshes docs, so it does not replace this step.
2. `$(cat graphify-out/.graphify_python) scripts/graphify-complete.py`. This is
   a full deterministic rebuild from the AST plus the live semantic cache (one
   entry per doc, resolved by its current content hash across prompt
   namespaces). It adds the `scripts/graphify/ci_workflows.py` nodes and edges
   for `.github/workflows/*.yml`, materializes zero-symbol files and unresolved
   references as explicit nodes, and rewrites `graphify-out/graph.json` (with a
   `coverage` block), `GRAPH_REPORT.md`, `COVERAGE_REPORT.md`,
   `collapsed-edge-variants.json` and `graph.html`. It raises if any doc lacks
   a live cache entry; rerun step 1, then step 2.
3. Pass check: in `graphify-out/COVERAGE_REPORT.md`, "Detected source files"
   equals "Source files represented by graph nodes" and the Integrity counts
   show 0 missing and 0 dangling endpoint edges; `graphify-out/graph.json` has
   a top-level `coverage` key. Review the graph diff after step 2, not before.
4. In a task worktree, `graphify-out/cache/` is gitignored
   (`graphify-out/.gitignore`). Before step 1, copy it and
   `graphify-out/.graphify_python` from the primary checkout, and write the
   worktree's absolute path into `graphify-out/.graphify_root`. After step 2,
   copy the cache back to the primary checkout, or the next refresh re-bills
   semantic extraction.
5. Tooling unit tests (run when `scripts/graphify-complete.py` or
   `scripts/graphify/` changes):
   `$(cat graphify-out/.graphify_python) -m unittest discover -s scripts/graphify -p 'test_*.py'`.
   They are not in CI, because graphify is not installed there.

The task is incomplete if the refresh is skipped or fails, or its graph diff and
token cost are not reviewed. Output written only by the refresh does not trigger
another refresh. Files under `graphify-out/memory/` are deliberate feedback
inputs, processed once through manifest and content hashes; do not suppress
them or loop on them.

Pick commands by need; check `graphify --help` first and report anything
unsupported instead of emulating it. Examples, not an allowlist:

```bash
/graphify . --update
/graphify ./docs --update
/graphify . --cluster-only
/graphify . --no-viz
/graphify query "what connects auth to the database?"
/graphify path "ChatService" "UsageService"
/graphify explain "WorkspaceMemberGuard"
graphify merge-graphs a.json b.json
```

Token rules:

- Prefer the existing graph and `--update`. A full extraction needs a missing,
  corrupt or deliberately replaced baseline, with the reason stated.
- Use `query --budget`, `path` or `explain` for narrow questions instead of
  broad traversal.
- Use `--cluster-only` when extraction is unchanged and `--no-viz` unless a
  visualisation is needed.
- Extract only changed or uncached files; semantic extraction sees only changed
  docs.
- Run only the exports and analyses the task uses.
- Report the exact command/mode, changed-file count, graph diff, and semantic
  input/output tokens. Use real runtime counters when available; otherwise give
  a clearly labelled bounded estimate and its method. Report zero only when no
  semantic extraction ran.

## Closing scans (every plan)

- Optimisation scan, limited to what the plan touches: backward-compatible
  only, with how behaviour is re-verified. "Not worth it, left as-is" is a valid
  answer.
- Cache scan: before proposing a new cache, check the existing ones: the chat
  semantic cache (`packages/db/src/schema/chatCache.ts`,
  `SEMANTIC_CACHE_THRESHOLD` / `CHAT_CACHE_TTL_SECONDS` in `.env.example`) and
  the Redis-backed `apps/api/src/cache/cache.service.ts`. Same honesty rule.
- Good practice without widening scope: separation of concerns, reuse before
  new code, workspace isolation, and TDD for testable logic.
