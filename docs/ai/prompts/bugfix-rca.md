# Bugfix RCA Template

For bug reports, Claude must produce RCA first.

Do not generate implementation steps.

Do not write `Status: IMPLEMENTATION_READY`.

## Task Router Compatibility

This template is loaded when task is classified as Bug RCA.

Before RCA, output Task Classification from `docs/ai/task-router.md`.

Consult `docs/ai/module-ownership-map.md` after task classification to identify likely domain.

If domain is missing, mark `UNMAPPED DOMAIN`.

If map conflicts with source code, mark `CONTEXT DRIFT`.

Verify all domain assumptions against source code.

## Repository Navigation Rule

Use context docs to find likely files:

1. `docs/ai/module-ownership-map.md` for domain
2. `docs/ai/contracts/api-contracts.md` for FE-BE contracts
3. `docs/ai/contracts/db-contracts.md` for DB/model/mutation contracts
4. `docs/ai/risk-register.md` for Deep classification
5. `docs/ai/file-index/repository-map.md` for file locations

Context docs are maps only.

Verify all conclusions against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

## Required RCA Output

### 1. Issue Selected

Restate issue from user input.

### 2. Bug Summary

One-line description.

### 3. Reproduction Flow From Code

Trace execution path through code.

Not user steps.

Verified from source code.

### 4. FE Investigation

Frontend evidence.

Verified from frontend source code.

If FE is not involved, state `Not applicable.`

### 5. BE Investigation

Backend evidence.

Verified from backend source code.

If BE is not involved, state `Not applicable.`

### 6. FE vs BE Contract Check

For FE-BE bugs, contract check is mandatory.

Must document:

- Frontend sends:
- Backend expects:
- Backend returns:
- Frontend expects:
- Mismatch:
- Evidence:

Consult `docs/ai/contracts/api-contracts.md` before contract check.

If contract is missing from map, mark `UNMAPPED CONTRACT`.

If map conflicts with source code, mark `CONTRACT DRIFT`.

Verify contract against real source code.

If FE-BE contract is not involved, state `Not applicable.`

### 7. Root Cause

Single confirmed root cause.

Verified from source code.

### 8. Why Existing Code Allows The Bug

Explain code deficiency.

Verified from source code.

### 9. Eliminated Causes

List ruled-out hypotheses.

With evidence.

### 10. Remaining Uncertainties

List unverified dependencies.

Mark `UNVERIFIED DEPENDENCY` when applicable.

### 11. Confidence Level

High / Medium / Low

### 12. Basic Solution Direction

High-level fix approach.

No implementation steps.

### 13. Planning Handoff

Must include:

- Confirmed Root Cause
- Owning Layer (FE / BE / DB / Integration)
- Primary Affected Files
- Secondary Affected Files
- Confirmed Contract Details
- Files / Causes Ruled Out
- Required Verification Commands (verified from package scripts or repo docs)
- Planning Constraints

## Task Size Classification

After RCA, classify task size:

- Tiny: docs, copy, comments, config
- Express: 1-2 files, single-layer
- Standard: multi-file or FE-BE coordination
- Deep: billing/payments/auth/jobs/webhooks/migrations/transactions or high-risk

Consult `docs/ai/risk-register.md` for Deep classification.

If task touches listed high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

## Evidence Rule

All RCA findings must be verified from source code.

Do not invent behavior.

Do not assume contract details.

If detail is unknown, mark `UNVERIFIED DEPENDENCY`.

## Deep Task Gate

If task is Deep:

- stop after RCA
- human approval required before plan
- do not write `Status: IMPLEMENTATION_READY`
- do not generate implementation steps

## Output Rule

Stop after RCA.

No implementation plan.

No `.ai-scratchpad.md`.

Wait for approval before planning.
