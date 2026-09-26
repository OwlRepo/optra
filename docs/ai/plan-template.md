# Plan Template (canonical skeleton)

> Purpose: the one section structure every plan in this repo uses.
> Load rule: read together with `docs/ai/planning.md` at flow node `L`, before writing any plan.
> Source of truth: the deterministic-spec rules in `docs/ai/planning.md`. This skeleton satisfies them by putting literal old/new blocks (or full new-file content) inside each phase step, never prose descriptions of a change.

Save the approved plan to `docs/plans/<branch-short-name>.md` before execution
starts.

Phase-stop rule: execution stops when the next phase's model tier or reasoning
level differs from the current pair; identical pairs continue automatically
(`docs/ai/planning.md` "Phases, model detection and the switch stop").

## Deterministic implementation rule

The plan is the implementation. The executing model applies each literal block
as written and decides nothing that was decidable at plan time. If repository
evidence contradicts a block during execution, stop and report the
contradiction, the evidence and the correction needed; do not improvise
(`docs/ai/execution.md` "Single-task rule").

## Plan Contract by task size

| Size | What the plan must carry |
|---|---|
| Tiny | No plan ceremony (no behaviour change by definition). `.claude/.plan-ack` = `{"size":"tiny","plan":"not-required","blast_radius":"<files or none>"}` |
| Express | One line instead of the matrices: `Blast radius: <files>; external users: none / <list>`. Ack as Tiny with `"size":"express"` |
| Standard / Deep | The full skeleton below, both layers, both matrices. Ack `{"size":"standard|deep","plan":"approved","matrices":"present"}` written only after the user approves |

`.claude/hooks/check-plan-gate.sh` blocks source edits without a fresh ack, and
blocks Standard/Deep edits whose ack lacks `plan:"approved"`. Writing
`approved` without a real approval is a contract violation, as serious as
skipping tests.

## Blast-radius rule (strict)

- The plan lists the exact files implementation may touch. Implementation
  touches only those files.
- Before finalising, search the usages of every changed export or symbol across
  the repo. Every dependent outside the task's scope goes in the Backward
  Compatibility Matrix as "affected, NOT modified", with why it is safe (or why
  it is not).
- If execution needs an unlisted file: STOP, explain why, update both matrices,
  and get re-approval before touching it.

---

## <Plan title>

<TL;DR: 2–4 plain-English sentences a non-technical reader understands. What is
broken or needed (the root cause in one sentence for a bug) and what will be
built. Use an analogy for anything inherently technical.>

### Flowchart (high-level, SVG)

<One high-level flowchart: the problem or goal on the left, the shape of the
solution on the right. Render it inline for review with
`mcp__visualize__show_widget` (English labels) and store it here as a mermaid
block so the saved plan keeps it. Boxes a non-technical reviewer can scan in
seconds; never a per-file breakdown.>

### Task metadata

- Classification: `BUG_FIX|ENHANCEMENT|NEW_FEATURE|REFACTOR|PERFORMANCE|INFRASTRUCTURE|DOCUMENTATION` · `Tiny|Express|Standard|Deep` · <domain from `docs/ai/module-ownership-map.md`> · <risk from `docs/ai/risk-register.md`>
- Contract areas: API · Database · Permissions · External integrations · Jobs — each named or `No contract impact`
- Docs loaded: `planning.md, plan-template.md` (mandatory canary; a plan without this line was written without the planning rules and is invalid)
- Claims reversed while investigating: <each claim asserted and later disproved, and what disproved it, or "none">
- Root cause: <one sentence with file/symbol evidence> (bug fixes only)
- Detected running model: <model running this session>
- Recommended model: `<tier>`, <reasoning>; confidence <level>. Fallback: `<tier>`, <reasoning>.
- Minimum capability: <lowest capability that is still sufficient, and why>
- Branch: `<fix|feat|enhancement|refactor|perf|infra>/no-ticket-<short-name>`, from `origin/main` (or `<parent-branch>` for a stacked slice)
- Release path: one PR into `main`, "Create a merge commit"; a stacked slice's PR targets `<parent-branch>` and is retargeted to `main` after the parent merges (`docs/ai/handoff.md` "Release flow")
- Required skills: <e.g. `/investigate`, `/plan-eng-review`, `/qa`, `/review`>
- Execution preflight: `git fetch origin`; `scripts/new-task-worktree.sh <type> <short-name> [<base-ref>]`; in the worktree `nvm use` and `bun install --frozen-lockfile` (`docs/ai/execution.md`)

### Layer 1 — human summary (Standard/Deep)

What changes and why, in plain English; a mermaid/ASCII sketch or analogy when
it helps. Keep it readable in about a minute; if it would feel like a chore to
read, cut it rather than compress it into jargon.

**Risk Matrix**

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|

**Backward Compatibility Matrix**

| Changed File / Symbol | Used By (outside this feature) | Breaks? | Handling |
|---|---|---|---|

### Layer 2 — execution spec

#### Phase 1 — RED (`<model>`, <reasoning>)

Write every test in the Test Matrix below. Titles are prefixed and ordered
`error:` > `edge:` > `regression:` > `happy:`. Run `bun run tdd:red` (with
`TDD_RED_BASE=<parent-branch>` for a stacked slice) and paste the failing
output. Commit the tests alone as `test(<scope>): …`. No guarded source changes
in this phase.

1. <Path to the spec file, then its complete content (new file) or a literal
   Old/New block (existing file).>

Done: <`bun run tdd:red` reports a valid RED and wrote the marker.>

#### Phase 2 — <title> (`<model>`, <reasoning>)

1. <Path to the file. Then a literal "Old:" fenced block with the exact current
   text (from the real file or `git show`, anchored on a symbol) and a literal
   "New:" fenced block with the exact replacement, or one fenced block with the
   full content of a new file. No prose description of the change.>
2. …

Done: <objective, observable completion condition.>

#### Phase N — <title> (`<model>`, <reasoning>)

…one section per phase. Phases never conflict with each other.

### Validation and acceptance

- **Test Matrix (mandatory table):** one row per layer in
  `docs/ai/testing-strategy.md` "Strict TDD" → "Test kinds":
  `layer | required / not required + reason | file | cases` with cases listed
  `error:` > `edge:` > `regression:` > `happy:`.
- Acceptance map: criterion → file → symbol → step → validation.
- Seed / fixture data: <per-scenario fixtures; for manual checks, the local
  demo tenant from `bun run db:seed`. Never point the seeder at a remote
  database (`docs/ai/dev-environment.md`).>
- Run (real scripts only, from `CLAUDE.md` "Verified commands"):
  `bun run type-check`, `bun run lint`, the touched packages' `bun run test`,
  `bun run test:e2e` in `apps/api` when an endpoint flow changed,
  `bun run db:seed:test` when `scripts/seed` changed, `bun run test:scripts` and
  `bun run agents:lint` when workflow tooling changed, `bun run build` for
  deployable changes. Infra files follow the operational checklist in
  `docs/ai/testing-strategy.md` "Infrastructure / Docker / Deployment
  Verification".
- Graphify gate (MANDATORY after every implementation): `/graphify . --update`,
  then `scripts/graphify-complete.py`, after the final indexed edit, again after
  a corpus-changing rebase; report the coverage check, graph diff and semantic
  input/output tokens (procedure: `docs/ai/planning.md` "Closeout refresh").

### Compatibility, docs and scans

- <Behaviour preserved, and the proof. Migration backward-compatibility
  statement per `docs/ai/planning.md` "Migrations" when a migration exists.>
- <`docs/ai/*` files and `docs/ai/file-index/repository-map.md` entries
  updated in the same change (`docs/ai/handoff.md` "Docs and learning sync").>
- <No forbidden language (`docs/ai/planning.md`): every step above is a literal
  old/new block or full new-file content.>
- Optimisation scan: <opportunity or "not worth it, left as-is">.
- Cache scan (chat semantic cache / `CacheService`): <opportunity or "not worth it, left as-is">.
- Database and LLM cost impact: <columns, limits, round-trips, workspace filter, token-budget path; flag any increase>.
- UI states (when UI is touched): <loading / empty / success / error per `docs/ai/planning.md` "UI steps">.
