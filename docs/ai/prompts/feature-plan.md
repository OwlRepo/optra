# Feature Planning Template

> Purpose: plan a new capability or an enhancement end to end.
> When to use: intent `NEW_FEATURE` or `ENHANCEMENT` (`docs/ai/task-router.md`).
> Source of truth: this is a MAP of the process. The real code, contracts and tests win.
> Deterministic implementation rule: read `docs/ai/planning.md` and `docs/ai/plan-template.md` first (flow node `L`) and expand this plan per their rules. Every path, symbol, operation, dependency, test, acceptance mapping and regression risk is explicit, and every code change is a literal old/new block (`docs/ai/plan-template.md` "Deterministic implementation rule").

For new features, do not use RCA.

Use Feature Discovery.

Feature planning answers: where does this fit in existing system?

No source edits during planning. Implementation begins only after approval.

## Plan Contract

Follow the Plan Contract in `docs/ai/plan-template.md` ("Plan Contract by task size", "Blast-radius rule").

Two layers required for Standard/Deep:

- Layer 1: human summary — plain English, Risk Matrix, Backward Compatibility Matrix, visual/analogy as needed, ~1 minute read
- Layer 2: execution spec — exact file paths, symbol + before/after code block anchors, tests per file in TDD order

Line numbers are hints only. Symbols and code blocks are the anchors.

Express: one line instead of matrices — `Blast radius: <files>; external users: none / <list>`.

Implementation touches only the allowed files listed in the plan.

Search usages of every changed export/symbol before finalizing the plan.

Affected-but-not-modified dependents go in the Backward Compatibility Matrix.

## Task Router Compatibility

This template is loaded when task is classified as Feature Plan.

Before planning, output Task Classification from `docs/ai/task-router.md`.

Consult `docs/ai/module-ownership-map.md` after task classification to identify existing domain or propose new domain.

If feature does not map cleanly to existing domain, mark `UNMAPPED DOMAIN`.

If map conflicts with source code, mark `CONTEXT DRIFT`.

Verify all domain assumptions against source code.

Reuse existing domain patterns when verified from source code.

## Task Size Classification

Classify task size:

- Tiny: docs, copy, comments, config
- Express: 1-2 files, single-layer
- Standard: multi-file or FE-BE coordination
- Deep: billing/payments/auth/jobs/webhooks/migrations/transactions or high-risk

Consult `docs/ai/risk-register.md` before finalizing task size.

If task touches listed high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

## Required Sections

### 1. Feature Selected

Restate feature request from user input.

### 2. Existing System Discovery

Answer:

- Does feature already partially exist?
- What existing similar patterns can be reused?
- Where do they live?

Verify from source code.

Search with Graphify first (`/graphify query|path|explain` against `graphify-out/graph.json`), then `docs/ai/file-index/repository-map.md`, then `grep` as a fallback; name the graphify query that failed if grep was needed. Reuse candidates to check before proposing anything new: existing NestJS services, guards and DTOs in `apps/api/src/<domain>/`, `packages/ai` chains, shared types in `packages/types/src/`, `@repo/ui` components, and BFF helpers in `apps/web/src/lib/api/`.

Consult `docs/ai/module-ownership-map.md` for domain.

Consult `docs/ai/file-index/repository-map.md` for file locations.

### 3. Current Data / Control Flow

Trace existing relevant flows.

Verified from source code.

### 4. Feature Gap Analysis

What is missing?

What needs to change?

What needs to be created?

### 5. API Contract Plan

State `No API contract changes required.` if none.

If FE-BE contract changes required:

- Frontend will send:
- Backend should expect:
- Backend should return:
- Frontend should consume:
- Compatibility risk:

Consult `docs/ai/contracts/api-contracts.md` before API planning.

If contract is missing from map, mark `UNMAPPED CONTRACT`.

If map conflicts with source code, mark `CONTRACT DRIFT`.

Verify contract against real source code.

### 6. Database & Schema Changes

State `No schema changes required.` if none.

If schema changes required, answer Migration Danger Gate questions.

Consult `docs/ai/contracts/db-contracts.md` before schema planning.

If contract is missing from map, mark `UNMAPPED CONTRACT`.

If map conflicts with source code, mark `CONTRACT DRIFT`.

Verify contract against schema and migrations.

### 7. Backend Implementation Steps

Include exact files.

Include exact changes.

Include contract impact.

If BE is not involved, state `Not applicable.`

### 8. Frontend Implementation Steps

Include exact files.

Include exact changes.

Include contract impact.

If FE is not involved, state `Not applicable.`

### 9. External Integration / Background Job Steps

State `Not applicable.` if none.

If external integrations or background jobs required, include:

- Integration points
- Job queue usage
- Idempotency requirements
- Error handling
- Retry logic

### 10. Implementation Sequence

Order steps to minimize risk.

Consider deployment ordering.

### 11. Verification & Testing Plan

Tests first. Phase 1 of the plan is RED: the Test Matrix (`docs/ai/plan-template.md`) with exact spec files and cases titled and ordered `error:` > `edge:` > `regression:` > `happy:`, covering workspace isolation and, for LLM paths, the rate-limit / token-budget behaviour. Run `bun run tdd:red` and paste the failing output (`docs/ai/testing-strategy.md` "Strict TDD").

Include verification commands verified from package scripts or repo docs.

Include manual QA flow.

Consult `docs/ai/testing-strategy.md` for task size.

### 12. Rollback / Risk Mitigation Plan

For Standard/Deep tasks:

- rollback steps
- risk notes
- data impact
- deployment ordering

For Tiny/Express tasks, state `Low risk. No special rollback required.` if applicable.

### 13. Approval Gate

Present the plan and wait for approval before implementing (Standard/Deep). Record the approval in `.claude/.plan-ack` only after it is given (flow node `R`).

For Deep tasks, implementation starts only after explicit human approval of the plan.

## Migration Danger Gate

If schema changes are involved, answer before implementation planning:

- Migration required?
- Backfill required?
- Default/nullability?
- Index or constraint impact?
- Existing data impact?
- Rollback possible?
- Deployment ordering risk?

If any answer is unknown, mark `UNVERIFIED DEPENDENCY`.

Do not proceed to implementation until resolved.

## Contract Areas

Include in the plan:

- API: (identified from plan or `No contract impact`)
- Database: (identified from plan or `No contract impact`)
- Permissions: (identified from plan or `No contract impact`)
- External integrations: (identified from plan or `No contract impact`)
- Jobs / automations: (identified from plan or `No contract impact`)

Consult `docs/ai/contracts/api-contracts.md` and `docs/ai/contracts/db-contracts.md` during planning.

## Risk Register Notes

Include in the plan for Standard/Deep tasks.

Consult `docs/ai/risk-register.md`.

If task touches listed high-risk area, include relevant risk notes.

## Unresolved Contract Gate

Do not begin implementation when contract details are unresolved.

If contract detail is unknown, mark `UNVERIFIED DEPENDENCY`.

Stop and request clarification.

## Forbidden Actions

No source edits during planning. Implementation begins only after approval.

## Implementation Start

After approval, execution follows `AGENTS.md` from node `S`: read `docs/ai/execution.md`, create the task worktree, then run the rounds in `docs/ai/agent-orchestration.md` (db-architect if schema changes, contract lock, RED, backend + frontend, verify, QA fan-out). Phases continue automatically while the model/reasoning pair is unchanged.

For Deep tasks:

- explicit human approval required before implementation
