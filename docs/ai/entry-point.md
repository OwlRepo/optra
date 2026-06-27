# AI Workflow Entry Point

## Developer Workflow

Developer provides raw task details:

```txt
Handle this task:

[paste details]
```

Claude routes, investigates, plans.

After Claude RCA/discovery/plan is approved:

```txt
Approved. Create implementation handoff.
```

For Codex implementation:

```txt
Implement from `.ai-scratchpad.md`.
```

For Codex validation:

```txt
Validate from `.ai-scratchpad.md`.
```

Developer does not need to name internal lanes.

Claude auto-routes through `docs/ai/task-router.md`.

Codex implements/validates only from `.ai-scratchpad.md`.

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

## Load Order

Before analysis:

1. `docs/ai/task-router.md` - task classification and template routing
2. `docs/ai/architecture-manifest.md` - architecture map
3. `docs/ai/module-ownership-map.md` - business/domain ownership map
4. `docs/ai/contracts/api-contracts.md` - FE-BE contract map
5. `docs/ai/contracts/db-contracts.md` - DB/model invariant map
6. `docs/ai/testing-strategy.md` - verification strategy map
7. `docs/ai/risk-register.md` - high-risk area map
8. `docs/ai/file-index/repository-map.md` - repository map
9. related test suites
10. target source files

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
