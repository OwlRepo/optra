# AI Workflow Entry Point

> Purpose: the front door to the `docs/ai/*` tree: what this repo is and how these docs fit together.
> Load rule: read first when you land in the repo and need orientation.
> Source of truth: every file here is a MAP, never proof. Real code, tests, types, schemas, migrations and routes are the truth. If a map conflicts with code, code wins.

Optra is a multi-tenant procurement SaaS (PO / invoice / catalog matching with
cited verdicts) on a multi-tenant RAG core, built as a portfolio project to
production standards. Project facts, the real stack and the invariants are in
`CLAUDE.md`; the always-on workflow (Canonical Task Flow, core principles, stop
conditions, agent routing) is in `AGENTS.md`, which `CLAUDE.md` imports. Do not
restate them here; read them.

## Developer Workflow

The developer pastes raw task details in any form:

```txt
Handle this task:

[paste details]
```

The session routes it through `docs/ai/task-router.md` (flow node `B`) and
follows the `AGENTS.md` flow from there. The developer never names a lane.

- Tiny / Express: implemented after classification.
- Standard: implemented after the plan is approved.
- Deep: RCA or discovery is approved first, then the plan.

Once a plan is approved, phases run automatically while the model and
reasoning pair stays the same (flow node `U`). Two things gate source edits
mechanically: `.claude/hooks/check-plan-gate.sh` (the plan state is recorded in
`.claude/.plan-ack`) and `scripts/hooks/tdd-red-guard.mjs` (a valid RED from
`bun run tdd:red` exists). After implementation, the SDLC Stage Map in
`CLAUDE.md` suggests the next gstack skill (QA → review → PR → canary → release
docs → retro).

## Context Engineering

Context files help Claude locate relevant code quickly.

Context docs are maps only.

Context docs are not proof.

Use context docs to find likely files.

Verify all conclusions against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

If context docs conflict with source code, source code wins.

If context docs are stale, mark `CONTEXT DRIFT`.

If domain is missing from map, mark `UNMAPPED DOMAIN`.

## Contract Engineering

Contract docs help Claude identify system contracts before planning.

Contract docs are maps only.

Contract docs are not proof.

Use contract docs to find likely API, DB, test, and risk areas.

Verify contract conclusions against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

If contract docs conflict with source code, source code wins.

If contract docs are stale, mark `CONTRACT DRIFT`.

If required contract is missing, mark `UNMAPPED CONTRACT`.

Do not convert unverified contract assumptions into implementation steps.

## Context Order

Load in this order for a code-changing task:

1. `AGENTS.md`: workflow core (Canonical Task Flow, core principles, stop conditions).
2. `docs/ai/task-router.md`: classify intent, size, domain and risk; skill mapping.
3. `docs/ai/architecture-manifest.md`: system shape.
4. `docs/ai/module-ownership-map.md`: which areas own the domain you are touching.
5. `docs/ai/agent-orchestration.md`: before dispatching any persona, and always when a spec touches both backend and frontend.
6. `docs/ai/contracts/api-contracts.md`: the API surface.
7. `docs/ai/contracts/db-contracts.md`: tables, invariants, mutation paths.
8. `docs/ai/testing-strategy.md`: how to test at this size, and the Strict TDD rules.
9. `docs/ai/risk-register.md`: is this a Deep-by-default area?
10. Graphify (`/graphify query|path|explain` against `graphify-out/graph.json`), then `docs/ai/file-index/repository-map.md`: exact files and symbols, before any grep.
11. Related test suites (the `*.spec.ts(x)` next to the source, `apps/api/test/`).
12. The target source files.

Phase docs load at their flow node, not up front: `docs/ai/planning.md` +
`docs/ai/plan-template.md` before writing a plan (node `L`);
`docs/ai/execution.md` before creating the worktree or writing code (node `S`);
`docs/ai/handoff.md` before declaring done (node `W`); `docs/ai/pr-evidence.md`
before creating any PR. `docs/ai/dev-environment.md` when a running stack is
needed; `docs/ai/autonomous-engineering.md` only if structured work orders come
up (they are disabled). `docs/ai/operating-contract.md` is a pointer page only.

## Task Router

`docs/ai/task-router.md` classifies raw user requests and routes to appropriate workflow template.

Claude outputs Task Classification before analysis.

## Prompt Route Summary

- Bug reports → `docs/ai/prompts/bugfix-rca.md`
- Approved bug RCA → `docs/ai/prompts/bugfix-plan.md`
- New features → `docs/ai/prompts/feature-plan.md`
- Refactors → `docs/ai/prompts/refactor-plan.md`

## Source Verification Rule

Source of truth = real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

Navigation docs are maps only.

If map conflicts with code, code wins.

Verify all conclusions against source code.

## Context Refresh

When context docs become stale, use `docs/ai/context-refresh.md`.

Context refresh updates only context docs.

Context refresh does not edit source files.

## Populated local environment

`bun run docker:dev:up`, then `bun run db:seed` gives a fully populated demo
tenant (documents, chunks with real embeddings, tickets, chat history, insights
metrics, procurement and catalog data) plus a login. The seeder is idempotent
and scoped to its own workspace — see `scripts/seed/` and the seeder section of
`docs/ai/testing-strategy.md`.
