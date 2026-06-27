# Refactor Planning Template

For refactors, preserve behavior unless user explicitly approved behavior change.

Claude must not edit source code.

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

### 8. Codex Scratchpad Output

Write to `.ai-scratchpad.md`.

Use `Status: IMPLEMENTATION_READY` only after approval.

For Deep tasks, include `Deep implementation approved: Yes` only after explicit human approval.

## Contract Areas

Include in Codex Scratchpad Output when relevant:

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
- `Deep implementation approved: Yes` required before implementation

## Forbidden Actions

Must forbid broad cleanup.

Must forbid opportunistic changes.

Claude must not edit source code.

## Behavior-Changing Contract Drift

If refactor changes API contract, DB contract, or public behavior:

- mark as behavior change
- require explicit user approval
- do not proceed unless user approved behavior change
- document contract change explicitly

## Scratchpad Output

Final Codex Scratchpad Output must be written to `.ai-scratchpad.md`.

`.ai-scratchpad.md` may use `Status: IMPLEMENTATION_READY` only after approval.

For Deep tasks:

- human approval required
- `Deep implementation approved: Yes` required before implementation
