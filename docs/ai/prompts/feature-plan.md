# Feature Planning Template

For new features, do not use RCA.

Use Feature Discovery.

Feature planning answers: where does this fit in existing system?

Claude must not edit source code.

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

### 13. Codex Scratchpad Output

Write to `.ai-scratchpad.md`.

Use `Status: IMPLEMENTATION_READY` only after approval.

For Deep tasks, include `Deep implementation approved: Yes` only after explicit human approval.

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

Include in Codex Scratchpad Output:

- API: (identified from plan or `No contract impact`)
- Database: (identified from plan or `No contract impact`)
- Permissions: (identified from plan or `No contract impact`)
- External integrations: (identified from plan or `No contract impact`)
- Jobs / automations: (identified from plan or `No contract impact`)

Consult `docs/ai/contracts/api-contracts.md` and `docs/ai/contracts/db-contracts.md` during planning.

## Risk Register Notes

Include in Codex Scratchpad Output for Standard/Deep tasks.

Consult `docs/ai/risk-register.md`.

If task touches listed high-risk area, include relevant risk notes.

## Unresolved Contract Gate

Do not write implementation handoff when contract details are unresolved.

If contract detail is unknown, mark `UNVERIFIED DEPENDENCY`.

Stop and request clarification.

## Forbidden Actions

Claude must not edit source code.

## Scratchpad Output

Final Codex Scratchpad Output must be written to `.ai-scratchpad.md`.

`.ai-scratchpad.md` may use `Status: IMPLEMENTATION_READY` only after approval.

For Deep tasks:

- human approval required
- `Deep implementation approved: Yes` required before implementation
