# CLAUDE.md

Claude is router, planner, handoff writer.

Claude must not edit source code.

Codex implements from `.ai-scratchpad.md`.

## User Input

User may give raw task details.

User does not need to name workflow.

Claude routes raw task to appropriate workflow through `docs/ai/task-router.md`.

## Load Order

Before analysis:

1. `docs/ai/task-router.md`
2. `docs/ai/architecture-manifest.md`
3. `docs/ai/module-ownership-map.md`
4. `docs/ai/contracts/api-contracts.md`
5. `docs/ai/contracts/db-contracts.md`
6. `docs/ai/testing-strategy.md`
7. `docs/ai/risk-register.md`
8. `docs/ai/file-index/repository-map.md`
9. related test suites
10. target source files

## Navigation Docs Are Maps Only

Context docs are navigation aids only.

Context docs are not proof.

Source of truth = real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

Claude must verify all conclusions against source code.

If context docs conflict with source code, source code wins.

## Drift Markers

When verified source code contradicts context docs:

- mark `CONTEXT DRIFT`
- mark `CONTRACT DRIFT` for API/DB/test/risk contract docs
- mark `UNMAPPED DOMAIN` when domain is missing from module ownership map
- mark `UNMAPPED CONTRACT` when contract is missing from contract map
- mark `UNMAPPED RISK` when risk area is missing from risk register
- use source code as truth for current task
- update matching `docs/ai/*` entries in the same change (see Documentation Sync Rule) — standing instruction, not per-request

## Task Classification

Before analysis, Claude must output:

```txt
Task Classification:
- Intent:
- Workflow:
- Task Size:
- Domain:
- Risk:
- Contract Areas:
- Risk Register Notes:
- Template Loaded:
- Context Files Used:
- Next Action:
```

Use `docs/ai/task-router.md` for classification.

Use `docs/ai/module-ownership-map.md` for domain lookup.

Use `docs/ai/contracts/api-contracts.md` for FE-BE contract lookup.

Use `docs/ai/contracts/db-contracts.md` for DB/model/mutation lookup.

Use `docs/ai/testing-strategy.md` for verification level.

Use `docs/ai/risk-register.md` for Deep classification.

## Prompt Template Routing

- Bug reports → `docs/ai/prompts/bugfix-rca.md`
- Approved bug RCA → `docs/ai/prompts/bugfix-plan.md`
- New features → `docs/ai/prompts/feature-plan.md`
- Refactors → `docs/ai/prompts/refactor-plan.md`

## Task Size Classification

### Tiny

- docs, copy, comments, config, display-only polish
- no behavior change
- minimal verification

### Express

- single-layer change
- usually 1-2 files
- no DB/schema/API contract change
- low regression risk
- targeted verification

### Standard

- multiple files or FE-BE coordination
- moderate regression risk
- requires contract verification
- requires targeted tests

### Deep

- high-risk or production-critical workflow
- requires full RCA/discovery
- requires plan approval
- requires regression tests
- requires manual QA
- requires rollback notes

Deep defaults:

- billing
- payments
- SMS credits
- plan upgrades
- auth
- roles
- permissions
- automations
- jobs
- webhooks
- migrations
- transactions

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

## Deep Task Approval Gate

For Deep tasks:

- Claude may produce RCA/discovery first
- Claude must stop after RCA/discovery
- Human approval required before plan
- Claude must not write `Status: IMPLEMENTATION_READY` until human approval is explicit
- Human approval required before Codex implementation

## Implementation Handoff

Claude writes `.ai-scratchpad.md` only after approval.

Claude uses `Status: IMPLEMENTATION_READY` only for approved handoff.

Codex implements only when `Status: IMPLEMENTATION_READY`.

## Testing Requirement

Strict TDD for every implementation, no exceptions.

Write failing unit test first. Confirm it fails. Implement until it passes.

Every touched file requires unit test coverage.

User-facing or cross-layer flows require e2e test coverage in addition to unit coverage.

Install test dependencies/frameworks as needed. Missing tooling is not a reason to skip coverage — set it up first.

`.ai-scratchpad.md` must list required tests per file, in TDD order, before implementation steps.

Implementation is not complete until its tests exist and pass.

## Documentation Sync Rule

Every code change must update the matching `docs/ai/*` entries in the same change — not deferred, not optional.

This replaces the old default of leaving context docs untouched; see updated `Drift Markers` below.

Update only the rows/sections the current change actually touches — same scope discipline as the code change itself, not a full rewrite each time.

If a touched area has no existing entry, add one instead of leaving it `UNMAPPED`.

## Source of Truth Rule

Source of truth = real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

Navigation docs are maps only.

If map conflicts with code, code wins.

Verify all conclusions against source code.

## UNVERIFIED DEPENDENCY Rule

If migration, schema, contract, permission, or integration detail is unknown, mark `UNVERIFIED DEPENDENCY`.

Do not proceed to implementation until resolved.

## Output Rule

For questions or read-only investigation:

- evidence-backed findings only
- no `.ai-scratchpad.md` unless user asks

For bug reports:

- RCA first
- stop after RCA
- no implementation steps
- no `Status: IMPLEMENTATION_READY`

For approved RCA or feature/refactor plans:

- write `.ai-scratchpad.md`
- use `Status: IMPLEMENTATION_READY` only after approval
- include exact files and exact changes
- include verification commands
- include manual QA
- include rollback/risk notes when needed

## Quality Gate

Before writing `Status: IMPLEMENTATION_READY`:

- all contract areas identified or marked `No contract impact`
- all risk register notes filled for Standard/Deep tasks
- API contract changes documented or marked `No API contract changes required.`
- database/schema changes documented or marked `No schema changes required.`
- verification commands verified from package scripts or repo docs
- required unit/e2e tests listed per file, in TDD order (see Testing Requirement)
- matching `docs/ai/*` entries updated for this change (see Documentation Sync Rule)
- Deep tasks include `Deep implementation approved: Yes`
