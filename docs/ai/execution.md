# Execution Rules

> Purpose: every rule that governs IMPLEMENTING an approved plan: worktree, code, tests, review, QA.
> Load rule: read at flow node `S` (`AGENTS.md`), before creating the worktree or writing any code.
> Source of truth: real code and `package.json` scripts beat this map. If they disagree, fix this file in the same change.

## Worktree and branch isolation

Planning, investigation and review-only sessions need no worktree. Any session
that changes code or docs for a task works in its own branch and worktree:

1. `git fetch origin`, then create a NEW branch + worktree with
   `scripts/new-task-worktree.sh <type> <short-name> [<base-ref>]`.
   - `<base-ref>` defaults to `origin/main`.
   - For a stacked slice (work that builds on an unmerged parent slice), pass
     the parent slice's branch as `<base-ref>`, and set
     `TDD_RED_BASE=<parent-branch>` when running `bun run tdd:red`.
   - The script resolves the main checkout even when run from inside a
     worktree, so worktrees are never nested. `.claude/worktrees/` is
     gitignored.
2. Branch naming: `<fix|feat|enhancement|refactor|perf|infra>/no-ticket-<short-name>`.
   Optra has no ticket tracker, so the ticket slot is always `no-ticket`.
3. Prepare the worktree:
   - `nvm use` (`.nvmrc` pins Node 22; Node 25 cannot load duckdb's native
     binding, `docs/ai/testing-strategy.md`).
   - `bun install --frozen-lockfile`. Never change `bun.lock` unless the plan
     adds a dependency.
   - Copy the untracked root `.env` from the primary checkout (or
     `cp .env.example .env`); tests and the seeder read it.
   - Reuse the primary checkout's running compose stack. Container names are
     fixed (`optra-db`, `optra-redis`, `optra-seaweedfs`, …), so a second stack
     from a worktree would collide (`docs/ai/dev-environment.md`).
4. Never edit the primary checkout for a task. Never reuse another task's
   worktree, never create two worktrees for one branch, never delete a worktree
   automatically. One branch + worktree per logical task.
5. Never commit to `main`. `scripts/git-hooks/pre-commit` (enabled by the root
   `prepare` script via `core.hooksPath`) blocks it, and also runs
   `bun run agents:lint` when persona files are staged.
6. If a safe worktree cannot be created, stop before changing code and report
   the exact command that is needed.

## Single-task rule

When implementing one task from a batch plan, implement ONLY that task; the rest
of the plan is read-only context. No partial work on later tasks, no speculative
code, no touching files "because a later task will need them". Follow the
approved plan unless repository evidence proves it wrong; then stop and report
the contradicted assumption, the evidence and the correction needed.

## Implementation rules

1. One logical change at a time; minimal diff; no unrelated clean-up; no
   speculative abstractions.
2. Keep existing naming and architecture conventions: NestJS modules / services
   / guards in `apps/api/src/<domain>/`, thin BFF route handlers in
   `apps/web/app/api/**`, shared shapes in `packages/types/src/`, UI from
   `@repo/ui` with `DESIGN.md` tokens.
3. Behaviour changes come with tests. Never weaken, skip or delete a test to
   make it pass.
4. Fix type, lint and runtime errors; never suppress them.
5. No breaking API, schema or behaviour change without approval. No dependency
   or lockfile change unless the plan requires it. No destructive database
   operation without the owner's explicit approval.
6. Touch only the files the plan lists (blast-radius rule,
   `docs/ai/plan-template.md`).
7. After each validated logical unit, make a focused commit:
   `<type>(<scope>): <concise description>`. Never mix unrelated changes in one
   commit. No `Co-Authored-By` trailer in this repo.

## Mandatory Graphify closeout

After the last edit to any indexed source or doc, load the graphify skill and
run `/graphify . --update` from the repo root, before review, commit and
handoff. Repeat after a later indexed edit or a rebase that changes indexed
files. A failed or skipped refresh, or unreviewed graph/token evidence, blocks
completion. Output written only by the refresh does not trigger another one.
Command choice and token rules: `docs/ai/planning.md` "Mandatory Graphify
phase".

## Testing requirements

The runners differ per workspace: Jest in `apps/api` (`*.spec.ts`, and
`test/*.e2e-spec.ts` for e2e), Vitest in `apps/web`, `packages/ai`,
`packages/db`, `packages/ui` and `scripts/seed`, and `node --test` for
`scripts/**/*.test.mjs`. `packages/types` has no runner; `bun run type-check`
covers it. Full inventory: `docs/ai/testing-strategy.md`.

- RED first, always. Write every test in the plan's Test Matrix, titles ordered
  `error:` > `edge:` > `regression:` > `happy:`, run `bun run tdd:red`, see it
  fail, and commit the tests alone as `test(<scope>): …` BEFORE touching
  guarded source. The Claude hook `scripts/hooks/tdd-red-guard.mjs` blocks
  guarded-source edits until then, and CI's `bun run tdd:gate` re-proves the RED
  against the PR's base. Escape hatch: `bun run tdd:red -- --waiver "<reason>"`,
  copied into the PR body as `TDD-Waiver: <reason>`. Full rule:
  `docs/ai/testing-strategy.md` "Strict TDD".
- Cover the happy path, error cases, loading states and edge cases. Backend
  changes also cover boundary and performance-relevant behaviour, workspace
  isolation (a caller from another workspace is refused), and rate-limit /
  token-budget paths when an LLM call is involved.
- Bugs found while testing are fixed in the same task, never deferred.
- Run targeted tests while iterating (one spec file or one package), then the
  touched packages' full suites before handoff.
- Manual scenarios use the local demo tenant from `bun run db:seed`. The seeder
  refuses non-local database hosts; never override that against a shared
  database (`docs/ai/dev-environment.md`).

## Review mode

Review runs separately from implementation (fresh session, or a different
persona via the QA fan-out in `docs/ai/agent-orchestration.md`). Use `/review`
(gstack pre-landing pass) or `ecc:code-review`, and read the actual diff, not
just the final files. Check acceptance criteria, root-cause correctness, scope
creep, hidden regressions, breaking changes, architecture violations, duplicate
logic, dead code, security (workspace isolation, auth, secrets), performance,
missing or weak tests, error handling and compatibility. Passing tests alone is
never a reason to approve.

## QA mode

Use `/qa` (test and fix) or `/qa-only` (report only). Run the validation the
plan defines; the standard set, stated once for every phase:

- targeted `bun run test` in each touched workspace, then its full suite
- `bun run type-check` (root)
- `bun run lint` (root)
- `bun run test:e2e` in `apps/api` when an endpoint flow changed
- `bun run db:seed:test` when `scripts/seed/` changed
- `bun run test:scripts` and `bun run agents:lint` when workflow tooling
  changed
- `bun run build` for deployable changes; the infra checklist in
  `docs/ai/testing-strategy.md` for Docker / workflow / shell changes
- UI changes: walk the flow in the Browser pane against the dev stack

Report each command and its result. Never claim a check that did not run.
Validation is complete only when acceptance criteria pass, required tests pass,
review findings are resolved, and the diff contains nothing unrelated. Then go to
`docs/ai/handoff.md`.
