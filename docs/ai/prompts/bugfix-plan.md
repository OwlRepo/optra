# Bugfix Implementation Plan Template

After RCA approval, Claude may generate bugfix implementation plan.

Every plan step must map to verified RCA facts.

Do not redo RCA unless required to verify implementation detail.

Claude must not edit source code.

## Task Classification Carry-Forward

Carry forward Task Classification from RCA:

- Intent: Bug
- Workflow: Bug Plan
- Task Size: (from RCA)
- Domain: (from RCA)
- Risk: (from RCA)
- Contract Areas: (identified during planning)
- Risk Register Notes: (from risk register)
- Template Loaded: `docs/ai/prompts/bugfix-plan.md`

## Approved RCA Requirement

Bugfix plan requires approved RCA.

If RCA is not approved, stop and request approval.

Do not proceed to planning without RCA approval.

## Plan Steps Mapped To RCA Facts

Every implementation step must reference verified RCA fact.

Do not invent behavior.

Do not assume contract details.

If detail is unknown, mark `UNVERIFIED DEPENDENCY`.

## Required Sections

### 1. Plan Overview & Scope

Reference approved RCA.

State confirmed root cause.

State owning layer.

State primary affected files.

### 2. Database & Schema Changes

State `No schema changes required.` if none.

If schema changes required, answer Migration Danger Gate questions.

### 3. Backend Implementation Steps

Map each step to RCA fact.

Include exact files.

Include exact changes.

Include contract impact.

If BE is not involved, state `Not applicable.`

### 4. Frontend Implementation Steps

Map each step to RCA fact.

Include exact files.

Include exact changes.

Include contract impact.

If FE is not involved, state `Not applicable.`

### 5. Implementation Verification & Testing Plan

Include verification commands verified from package scripts or repo docs.

Include manual QA flow.

Consult `docs/ai/testing-strategy.md` for task size.

### 6. Rollback / Risk Mitigation Plan

For Standard/Deep tasks:

- rollback steps
- risk notes
- data impact
- deployment ordering

For Tiny/Express tasks, state `Low risk. No special rollback required.` if applicable.

### 7. Codex Scratchpad Output

Write to `.ai-scratchpad.md`.

Use `Status: IMPLEMENTATION_READY` only after approval.

For Deep tasks, include `Deep implementation approved: Yes` only after explicit human approval.

## FE-BE Contract Check

For FE-BE bugfix plans, include:

- Frontend sends:
- Backend expects:
- Backend returns:
- Frontend expects:
- Contract change:
- Compatibility risk:

Consult `docs/ai/contracts/api-contracts.md` before planning.

If contract is missing from map, mark `UNMAPPED CONTRACT`.

If map conflicts with source code, mark `CONTRACT DRIFT`.

Verify contract against real source code.

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
