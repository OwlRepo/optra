# Refactor Planning Template

For refactors, preserve behavior unless user explicitly approved behavior change.

No source edits during planning. Implementation begins only after approval.

## Plan Contract

Follow the Plan Contract in `CLAUDE.md`.

Two layers required for Standard/Deep:

- Layer 1: human summary — plain English, Risk Matrix, Backward Compatibility Matrix, visual/analogy as needed, ~1 minute read
- Layer 2: execution spec — exact file paths, symbol + before/after code block anchors, tests per file in TDD order

Line numbers are hints only. Symbols and code blocks are the anchors.

Express: one line instead of matrices — `Blast radius: <files>; external users: none / <list>`.

Implementation touches only the allowed files listed in the plan.

Search usages of every changed export/symbol before finalizing the plan.

Affected-but-not-modified dependents go in the Backward Compatibility Matrix.

## Task Router Compatibility

This template is loaded when task is classified as Refactor Plan.

Before planning, output Task Classification from `docs/ai/task-router.md`.

Identify affected domain from `docs/ai/module-ownership-map.md`.

If map conflicts with source code, mark `CONTEXT DRIFT`.

Verify behavior ownership from source code.

## Task Size Classification

Classify task size:

- Tiny: docs, copy, comments, config
- Express: 1-2 files, single-layer
- Standard: multi-file or FE-BE coordination
- Deep: high-risk refactor or production-critical behavior

Consult `docs/ai/risk-register.md` for Deep Refactor Gate.

If refactor touches billing/payments/auth/jobs/webhooks/migrations/transactions or other high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves refactor is isolated and low-risk.

## Required Sections

### 1. Refactor Selected

Restate refactor request from user input.

### 2. Existing Behavior Proof

Document current behavior to preserve.

Verified from source code.

Include:

- What behavior must not change
- What internal contracts must be preserved
- What external contracts must be preserved

### 3. Public API Surface Check

Identify public APIs at risk.

Include:

- Exported functions
- API endpoints
- Database schema
- Event interfaces
- Webhook contracts

Consult `docs/ai/contracts/api-contracts.md` for API surface.

Consult `docs/ai/contracts/db-contracts.md` for DB surface and invariants.

If contract is missing from map, mark `UNMAPPED CONTRACT`.

If map conflicts with source code, mark `CONTRACT DRIFT`.

Verify contract against real source code.

### 4. Risk Boundaries

Identify risk areas.

Include:

- Dependency boundaries
- Migration or rollout risk
- Regression surface
- Validation scope

### 5. Implementation Steps

Include exact files.

Include exact changes.

Include contract impact.

State behavior preservation explicitly.

### 6. Verification & Testing Plan

Include verification commands verified from package scripts or repo docs.

Include manual QA flow.

Consult `docs/ai/testing-strategy.md` for task size.

Must verify behavior preservation.

### 7. Rollback / Risk Mitigation Plan

For Standard/Deep tasks:

- rollback steps
- risk notes
- data impact
- deployment ordering

For Tiny/Express tasks, state `Low risk. No special rollback required.` if applicable.

### 8. Approval Gate

Present the plan and wait for approval before implementing (Standard/Deep).

For Deep tasks, implementation starts only after explicit human approval of the plan.

## Contract Areas

Include in the plan when relevant:

- API: (identified from plan or `No contract impact`)
- Database: (identified from plan or `No contract impact`)
- Permissions: (identified from plan or `No contract impact`)
- External integrations: (identified from plan or `No contract impact`)
- Jobs / automations: (identified from plan or `No contract impact`)

Consult `docs/ai/contracts/api-contracts.md` and `docs/ai/contracts/db-contracts.md` during planning.

## Deep Refactor Gate

For Deep refactors:

- human approval required before plan
- full regression verification required
- rollback plan required
- explicit human approval required before implementation

## Forbidden Actions

Must forbid broad cleanup.

Must forbid opportunistic changes.

No source edits during planning. Implementation begins only after approval.

## Behavior-Changing Contract Drift

If refactor changes API contract, DB contract, or public behavior:

- mark as behavior change
- require explicit user approval
- do not proceed unless user approved behavior change
- document contract change explicitly

## Implementation Start

After approval, Claude implements directly in the same thread — one step at a time, strict TDD, explaining each step.

For Deep tasks:

- explicit human approval required before implementation
