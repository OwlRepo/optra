# Autonomous Engineering (structured work orders)

> Purpose: what a structured, pre-authorised work order would change in the `AGENTS.md` flow, and why that is switched off in Optra today.
> Load rule: read only when someone proposes running a task without the user approving each gate in chat.
> Source of truth: `.ai-engineering/config/autonomous-engineering.yaml`. If this page and the yaml disagree, the yaml wins; fix this page in the same change.

## Status: disabled (`activation: PILOT_FROZEN`)

`.ai-engineering/config/autonomous-engineering.yaml` sets
`activation: PILOT_FROZEN` with `autonomy_level: 2` and
`scheduler.activated: false`. No task source (issue tracker, task file or
scheduler) is configured for this repo. While that holds:

- Every task follows the manual flow in `AGENTS.md`, and every approval (RCA or
  discovery for Deep, plan at node `R`, model switches at node `U`, PR creation
  and merge) is given by the user in chat.
- Nothing may resume across a model/reasoning switch, create a PR, or merge on
  its own authority.

## Approval gates (always on, even after activation)

From the yaml's `approval:` block. Each of these needs an explicit human
decision regardless of autonomy level:

| Gate | Yaml key | Where it bites in this repo |
|---|---|---|
| Production | `production` | anything that reaches the VPS; merging to `main` triggers `deploy` |
| Destructive actions | `destructive_actions` | deleting data, force-pushing a reviewed branch, removing worktrees |
| DB migrations | `db_migrations` | any file under `packages/db/drizzle/` or `packages/db/src/schema/` |
| Auth and workspace permissions | `auth_and_workspace_permissions` | `apps/api/src/auth/`, guards, roles, invitations |
| Rate limits and token budgets | `rate_limits_and_token_budgets` | `apps/api/src/limits/`, budget env vars |
| Deploy and infra | `deploy_and_infra` | `.github/workflows/`, `docker-compose*.yml`, Dockerfiles, `scripts/deploy*.sh` |
| New dependencies | `new_dependencies` | any `package.json` dependency change |

## Lifecycle

States and their meanings: `.ai-engineering/core/task-lifecycle.md`. Legal
transitions and the guard on each one: `.ai-engineering/core/task-state-machine.md`.
The manual flow maps onto them the same way whether or not autonomy is on
(`NEW` at flow node `A`, `PLANNED` at `R`, `BUILDING` from `S`, `PR_READY` at
`W`).

## What an activated work order would change

Only these, and nothing else. Every evidence gate, test, review, QA, handoff,
migration and CI rule stays exactly as written.

1. **Repeated approval.** A validated work order (fixed outcome, numbered
   acceptance criteria, cited sources, risk) could stand in for the per-gate
   chat approval on Tiny/Express/Standard work whose plan matches the order
   exactly. Deep work, scope changes, product decisions and breaking changes
   still stop for the user.
2. **Phase-pair continuation.** At node `U` a different model/reasoning pair
   could resume from a validated checkpoint instead of waiting, provided the
   next pair meets the phase's declared minimum capability.
3. **PR creation.** The runtime could open a non-draft PR once
   `docs/ai/pr-evidence.md` is satisfied. Merging to `main` still deploys to
   production, so it keeps the `production` gate.

## Before activation (checklist)

1. Configure a task source and a parser for its work-order shape, and record
   both in the yaml.
2. Keep `pilot.simulation_required: true` and run one simulated work order end
   to end (plan, implement, review, QA, PR as a draft) with no merge.
3. Keep `pilot.first_real_task_merge_blocked: true`: the first real order stops
   before its merge for the owner to review the whole run.
4. The owner changes `activation` in the yaml in a reviewed PR. An agent never
   flips it.

Until all four happen, this page describes a capability that does not exist
here.
