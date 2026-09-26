# Task State Machine

This file owns the legal transitions between task states and the guard each
transition must pass. What each state means lives in `task-lifecycle.md`; it is
not repeated here.

## Transitions

Canonical path:

NEW → TRIAGED → ANALYZING → PLANNED → READY → BUILDING → REVIEW → QA →
PR_READY → WAITING_APPROVAL → MERGED → VERIFIED → REPORTED

Already satisfied:

ANALYZING → SKIPPED_ALREADY_IMPLEMENTED → REPORTED

Back-edges (the only ones allowed):

- PLANNED → ANALYZING — the user asks for a revised plan (`AGENTS.md` node `R`,
  "No / revise").
- BUILDING → ANALYZING — repository evidence contradicts the approved plan
  (`docs/ai/execution.md` "Single-task rule"); a new plan needs a new approval.
- REVIEW → BUILDING and QA → BUILDING — findings to fix inside the approved
  scope.
- Any state → a `BLOCKED_*` state from `task-lifecycle.md`, and back to the
  state it left once the blocker is resolved with evidence.

No other transition is legal. Skipping a state is a defect, not a shortcut.

## Guards

Each transition needs the evidence on the right before it is taken. Flow nodes
refer to the Canonical Task Flow in `AGENTS.md`.

| Transition | Flow node | Guard (evidence required) |
|---|---|---|
| NEW → TRIAGED | `B` | `Task Classification:` block printed (`docs/ai/task-router.md`) |
| TRIAGED → ANALYZING | `D` / `G` | RCA or discovery started from the routed prompt doc |
| ANALYZING → SKIPPED_ALREADY_IMPLEMENTED | `H` | every acceptance criterion proven by existing code and tests, cited by file and symbol; no branch, worktree, plan, commit or PR is created |
| ANALYZING → PLANNED | `E` / `G` → `L` | Deep: the user approved the RCA or discovery. All sizes: no open `UNVERIFIED DEPENDENCY`. Plan follows `docs/ai/plan-template.md` and carries `Docs loaded: planning.md, plan-template.md` |
| PLANNED → READY | `R` | the user approved the plan in chat; `.claude/.plan-ack` records the size and, for Standard/Deep, `plan:"approved"`; plan saved to `docs/plans/<branch-short-name>.md` |
| READY → BUILDING | `S` | fresh branch + worktree from `scripts/new-task-worktree.sh`; `bun install --frozen-lockfile` done |
| BUILDING (RED → green) | `T` | `bun run tdd:red` wrote a valid RED marker before any guarded-source edit (or a stated `--waiver`) |
| BUILDING → REVIEW | `T` → `W` | plan phases done; targeted suites, type-check and lint green |
| REVIEW → QA | `W` | no unresolved review finding |
| QA → PR_READY | `W` | QA commands from `docs/ai/execution.md` "QA mode" run and green; Graphify closeout done (`docs/ai/planning.md` "Closeout refresh"); docs and `learnings.md` synced |
| PR_READY → WAITING_APPROVAL | `W` | PR opened only on the user's instruction, with `docs/ai/pr-evidence.md` evidence; `gh pr checks <number>` green |
| WAITING_APPROVAL → MERGED | — | a human merged it with "Create a merge commit" |
| MERGED → VERIFIED | — | the `deploy` job for that merge commit succeeded and its health checks passed |
| VERIFIED → REPORTED | `W` | final report and status block from `docs/ai/handoff.md` delivered |

While `.ai-engineering/config/autonomous-engineering.yaml` has
`activation: PILOT_FROZEN`, every guard that says "the user" means a message
from the user in chat. No runtime may satisfy it on the user's behalf.
