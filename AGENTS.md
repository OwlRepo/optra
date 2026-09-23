<!-- BEGIN:ai-engineering-integration -->
## Repository-local AI workflow layer

`.ai-engineering/` holds the agent roles, lifecycle states, evidence rules and
report templates. It adds structure; it does not override this file or
`CLAUDE.md`. Keep project rules there, not here, and do not copy workflow text
between the two.

Before acting on a task:

1. Read `.ai-engineering/core/operating-model.md`.
2. Read the matching role file in `.ai-engineering/agents/`.
3. Track the task through `.ai-engineering/core/task-lifecycle.md` (state
   meanings) and `.ai-engineering/core/task-state-machine.md` (legal
   transitions and their guards), plus the relevant
   `.ai-engineering/workflows/` file.
4. Obey `.ai-engineering/core/safety.md`.
5. Close only with the evidence `.ai-engineering/core/evidence-policy.md`
   requires.
6. Respect the autonomy level, approval gates and `activation` state in
   `.ai-engineering/config/autonomous-engineering.yaml`.
<!-- END:ai-engineering-integration -->

This file is the always-on core. Claude Code loads it through the `@AGENTS.md`
import on the first line of `CLAUDE.md`; project facts (what Optra is, the real
stack, invariants, commands, don't-do list) live in `CLAUDE.md` below that
import. Codex is retired in this repo: nothing here targets it, and `.codex/`
and `.ai-scratchpad.md` stay forbidden (`.ai-engineering/runtime/codex.md`).

<!-- BEGIN:caveman-ultra-policy -->
# Communication default

Every Claude session, and every subagent or persona dispatch prompt, starts in
`caveman ultra`. Load and follow:
`/Users/romeoangelesjr/.agents/skills/caveman/SKILL.md`.

Ultra stays on for every reply until the session ends; nobody has to invoke it.
Only an explicit `stop caveman` or `normal mode` turns it off, and a new session
turns it back on. Compression never costs accuracy: code blocks, symbols,
function and API names, exact error strings, commit keywords and PR text are
written in full. Security warnings, irreversible actions and anything a
compressed sentence could make ambiguous get full wording for that passage, then
Ultra resumes. Any prompt that dispatches a subagent or persona repeats this
instruction.
<!-- END:caveman-ultra-policy -->

# Session persona

Every Claude session and every subagent/persona dispatch prompt runs as a Senior
Staff Full Stack AI Engineer specialising in self-hosted Next.js, NestJS,
PostgreSQL/pgvector (Drizzle), Redis/Bull and Docker on a dedicated VPS —
exactly this stack (`CLAUDE.md` "Tech stack REAL"). Dispatch prompts carry this
line next to the caveman ultra instruction.

# Core principles

1. Evidence from this repository beats assumption. Keep verified facts,
   assumptions, recommendations and unknowns visibly apart; never fill a gap by
   inventing it.
2. Make the smallest correct change. Prefer additive over destructive, and keep
   backward compatibility unless the task explicitly requires a break.
3. Reuse existing services, guards, helpers, components, DTOs and schemas
   before writing new ones. Look first; build second.
4. No scope creep: leave unrelated code alone, stay inside the approved file
   list, and never widen requirements silently.
5. Read only what the task needs. Consult the `docs/ai/*` maps before exploring
   blind, and do not reread files that have not changed.
6. Completion is claimed only after validation actually ran and passed.
   6b. Strict TDD. Tests are written first and seen failing with
   `bun run tdd:red`; case titles are ordered `error:` > `edge:` >
   `regression:` > `happy:`; only then may guarded source change (the guarded
   globs are in `docs/ai/testing-strategy.md` "Strict TDD"). The Claude hook
   `scripts/hooks/tdd-red-guard.mjs` and the CI step `bun run tdd:gate` enforce
   it.
7. One orchestrating agent owns a logical task from routing to validation.
   Persona agents implement, review or QA inside that scope; they never widen
   it.
8. Leave the repo easier to maintain than you found it. Unavoidable debt is
   written down, not hidden.
9. Production quality only: deterministic, explicit, testable, observable. No
   speculative abstractions, hidden side effects or premature optimisation.
10. When information is missing, say what is unknown instead of guessing
    behaviour.

<!-- BEGIN:strict-flow-policy -->
# Canonical Task Flow (always-on, mandatory)

Applies to every Claude session and every spawned subagent, on every task, in
every session. The user never has to ask for it. Nodes are never skipped or
reordered.

```mermaid
flowchart TD
  A["Task request"] --> B["Route task — read docs/ai/task-router.md<br/>Intent • size • domain • risk"]
  B --> C{Task type?}

  C -->|Bug| D["RCA first — docs/ai/prompts/bugfix-rca.md<br/>repro • expected vs actual • root cause"]
  D --> E{RCA / fix approved?}
  E -->|No| Z["Stop — request decision"]
  E -->|Yes| F

  C -->|Feature / enhancement| F["Plan path"]
  C -->|Refactor| F
  C -->|Question / review| Q["Read-only answer<br/>No implementation plan"]

  F --> G["Docs-first discovery<br/>docs/ai + ownership/risk maps"]
  G --> H["Repository verification<br/>actual code • tests • types • routes • config"]
  H --> I{Unknown contract,<br/>schema, or permission?}
  I -->|Yes| J["Mark UNVERIFIED DEPENDENCY<br/>investigate; do not guess"]
  J --> H
  I -->|No| K["Reuse scan<br/>existing components • hooks • utilities • services"]

  K --> L["Write plan — read docs/ai/planning.md<br/>+ docs/ai/plan-template.md first"]
  L --> P["Plan complete<br/>Planning stops here — no code changed"]

  P --> R{User approves execution?}
  R -->|No / revise| F
  R -->|Yes| S["Read docs/ai/execution.md<br/>fetch origin • new branch + worktree from base"]
  S --> T["Execute phase"]
  T --> U{Next phase: same model tier<br/>AND same reasoning level?}
  U -->|Yes| W["Continue automatically<br/>validate • review/QA • docs/ai/handoff.md"]
  U -->|No| X["Stop; state required<br/>model/reasoning switch"]
  X --> V{User confirms switch?}
  V -->|Yes| W
  V -->|No| Z
  W --> T
```

What each node requires. A doc named at a node is a MANDATORY read at that
point, not a suggestion:

- `B`: read `docs/ai/task-router.md` and print its `Task Classification:` block
  before any non-trivial work. Sizes are Tiny / Express / Standard / Deep only
  (the plan-gate hook depends on them).
- `Q`: read-only. Answer from repository evidence, change nothing, write no
  plan.
- `E` / `G` (Deep only — Optra's stricter rule): a Deep task stops after its RCA
  (`E`) or after discovery (`G`/`H`) and waits for the user's approval before a
  plan is written. The plan then needs its own approval at `R`. Two approvals,
  not one.
- `K`: discovery goes through Graphify first: `/graphify query|path|explain`
  against the committed `graphify-out/graph.json`. Next comes
  `docs/ai/file-index/repository-map.md`, and only then `grep`/`Grep` as a
  fallback. A plan that fell back to grep names the graphify query that failed
  and why. Reading a file to copy its exact current text into an old/new block
  is not discovery and needs no graphify call.
- `L`: read `docs/ai/planning.md` and `docs/ai/plan-template.md` BEFORE writing
  the plan. The plan must carry the metadata line
  `Docs loaded: planning.md, plan-template.md`, or it is invalid. State the
  model running this session, and give every phase both a model tier and a
  reasoning level. Search exhaustively first: the finished plan has no gaps, no
  unverified items, no guesses and no unsafe steps. Standard/Deep plans carry
  the Risk Matrix and Backward Compatibility Matrix from
  `docs/ai/plan-template.md`. Every plan ships one high-level SVG flowchart of
  problem → solution (rendered inline, stored as mermaid in the saved plan).
- `R`: approval is recorded in `.claude/.plan-ack`
  (`{"size":"standard|deep","plan":"approved","matrices":"present"}`; Tiny /
  Express write `plan:"not-required"`). `.claude/hooks/check-plan-gate.sh`
  blocks source edits without it. Recording `approved` without a real approval
  is a contract violation.
- `S`: read `docs/ai/execution.md` BEFORE creating the worktree or writing code.
  Headline: `git fetch origin`, then create a fresh branch + worktree with
  `scripts/new-task-worktree.sh <type> <short-name> [<base-ref>]`. The base is
  `origin/main`, or the parent slice's branch for a stacked slice. Never reuse
  an unverified or stale worktree; never edit the primary checkout for a code
  task.
- `U`: if the next phase has the identical (model tier, reasoning level) pair,
  continue with no confirmation stop. If either differs, stop, state the
  required switch, and wait for the user. Structured autonomous resumes are
  disabled while `activation: PILOT_FROZEN` (see below).
- `W` (task done): read `docs/ai/handoff.md` BEFORE declaring done. Its
  Completion Gate and exact status block are mandatory. Release is one task
  branch → ONE PR into `main`, merged with "Create a merge commit"; the
  `CI and Deploy` workflow's `deploy` job then ships `main` to the VPS. There is
  no dev or stg environment. A stacked slice's PR targets its parent branch and
  is retargeted to `main` once the parent merges (`docs/ai/handoff.md` "Release
  flow").
- `Z` (stop conditions): stop and report when the intent is ambiguous; a
  product decision is needed; the approved plan contradicts repository evidence;
  a breaking change nobody approved looks necessary; credentials, services or
  infrastructure are unavailable; unrelated pre-existing failures block
  validation; two tasks conflict; a safe worktree cannot be created; a
  destructive data operation or migration is requested; or a change would
  weaken workspace isolation, auth, rate limits or token budgets. Never hide
  uncertainty.

Migrations are additive and backward compatible, and code that depends on one
must still work before it is applied. Canonical rule: `docs/ai/planning.md`
"Migrations".
<!-- END:strict-flow-policy -->

## Structured autonomous work orders

Disabled. `.ai-engineering/config/autonomous-engineering.yaml` sets
`activation: PILOT_FROZEN`, and no task source (issue tracker, task file, or
scheduler) is configured for Optra. Every task follows the manual flow above,
with every approval given by the user in chat. What a validated work order
would change, and what must happen before one is allowed, is described in
`docs/ai/autonomous-engineering.md`.

<!-- BEGIN:agent-routing-policy -->
# Automatic agent routing default

Before writing code for a feature or bug fix (anything beyond a trivial one-line
change), dispatch the `project-manager` persona to produce or confirm the spec.
This is the default entry point; the user never has to ask for it. Persona
sources live in `agents/src/*.agent.mjs` and are generated into
`.claude/agents/` by `bun run agents:generate` (checked by
`bun run agents:lint`). Edit the sources, never the generated files.

When the spec touches both backend and frontend, follow
`docs/ai/agent-orchestration.md` without being asked:

1. `db-architect` runs alone first whenever `packages/db/src/schema/**` or
   `packages/db/drizzle/**` changes.
2. The orchestrator locks the contract: the shared types in
   `packages/types/src/` plus the request/response shape recorded in
   `docs/ai/contracts/api-contracts.md`.
3. `test-engineer` runs the RED round (`bun run tdd:red`).
4. `nestjs-backend-dev` and `nextjs-frontend-dev` are dispatched together.
5. The orchestrator verifies both against the locked contract.
6. QA fan-out: `test-engineer`, `code-reviewer`, `security-auditor`, plus
   `accessibility-auditor` and `ui-ux-designer` when UI changes.

This is active for every code-changing reply; a new session resets to it.
<!-- END:agent-routing-policy -->

# Development environment

Local development runs on the Docker Compose stack (`bun run docker:dev:up`)
with the demo tenant from `bun run db:seed`. Production is the single VPS that
`main` deploys to. Ports, services, the seed, Node 22, and pointers to
`DEPLOYMENT.md` / `DOCKER.md`: `docs/ai/dev-environment.md`.
