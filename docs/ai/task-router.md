# Task Router

Claude must classify raw user requests.

Raw task details may include:

- plain English request
- bug report
- feature request
- refactor request
- QA report
- issue tracker ticket
- GitHub issue
- Jira ticket
- Linear ticket
- error log
- stack trace
- screenshot description
- user complaint
- production incident note
- test failure output
- code review comment
- support report

Claude must not require user to name a lane.

## Classification Table

| Input Intent                                                                                                                          | Internal Workflow | Template                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------- |
| Bug, error, regression, crash, failing test, broken behavior, unexpected behavior, production incident, QA failure, support complaint | Bug RCA           | `docs/ai/prompts/bugfix-rca.md`    |
| Approved RCA, request for fix plan, request to generate implementation plan after RCA                                                 | Bug Plan          | `docs/ai/prompts/bugfix-plan.md`   |
| New capability, enhancement, new workflow, new UI behavior, new API behavior, product behavior change                                 | Feature Plan      | `docs/ai/prompts/feature-plan.md`  |
| Cleanup, rename, restructure, internal code quality change, no intended behavior change                                               | Refactor Plan     | `docs/ai/prompts/refactor-plan.md` |
| Question, explanation, code review, architecture review, discovery only                                                               | Read-only         | No template — evidence-backed findings only, no source edits |
| Infra, Docker, deployment, CI/CD, VPS, container, compose, Dockerfile, hosting configuration change                                   | Infra Plan        | No dedicated template — treat as Feature Plan discovery depth, but consult `docs/ai/risk-register.md`'s "Production Deployment" row (Deep by default) and `docs/ai/testing-strategy.md`'s operational-verification checklist instead of unit-test-first flow for non-code files |

## Ambiguity Rules

If ambiguous, choose safest workflow:

- possible bug → Bug RCA
- possible product behavior addition → Feature Plan
- possible no-behavior-change cleanup → Refactor Plan
- possible billing/payments/SMS credits/auth/roles/permissions/automations/jobs/webhooks/migrations/transactions → Deep task

## Module Ownership Map Lookup

After classifying task intent, consult `docs/ai/module-ownership-map.md` to determine:

- likely domain
- likely related frontend area
- likely related backend area
- likely database/schema area
- likely tests
- default risk level

If domain is missing, mark `UNMAPPED DOMAIN`.

If map entry is stale or contradicts source code, mark `CONTEXT DRIFT`.

## API Contract Map Lookup

For FE-BE tasks, consult `docs/ai/contracts/api-contracts.md` to find:

- relevant API endpoints
- request/response shapes
- frontend callers
- backend handlers
- auth/permission requirements
- known contract risks

If contract is missing, mark `UNMAPPED CONTRACT`.

If map entry is stale or contradicts source code, mark `CONTRACT DRIFT`.

## DB Contract Map Lookup

For schema/model/mutation tasks, consult `docs/ai/contracts/db-contracts.md` to find:

- relevant models/tables
- important fields
- invariants
- mutation paths
- transaction/idempotency rules
- related APIs/jobs
- known contract risks

If contract is missing, mark `UNMAPPED CONTRACT`.

If map entry is stale or contradicts source code, mark `CONTRACT DRIFT`.

## Testing Strategy Lookup

After classifying task size, consult `docs/ai/testing-strategy.md` to determine:

- minimum verification
- extra verification
- manual QA requirements

## Risk Register Lookup

After initial classification, consult `docs/ai/risk-register.md`.

If task touches listed high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

If risk area is missing, mark `UNMAPPED RISK`.

## Task Size Rules

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

## Deep Defaults

Deep by default:

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
- infrastructure / deployment / CI-CD

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

## Output Classification Block

Claude must output classification before analysis:

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

## Template Selection Rule

After classification:

- Bug RCA → load `docs/ai/prompts/bugfix-rca.md`
- Approved RCA needing plan → load `docs/ai/prompts/bugfix-plan.md`
- New feature → load `docs/ai/prompts/feature-plan.md`
- Refactor → load `docs/ai/prompts/refactor-plan.md`
- Read-only → no template, evidence-backed findings only

## Approval Requirement Rule

For Deep tasks:

- Claude produces RCA/discovery first
- Claude stops after RCA/discovery
- Human approval required before plan
- Human approval required again before implementation

## Implementation Rule

Claude implements directly in the same thread — no handoff artifact, no second agent.

Standard/Deep plans must follow the Plan Contract in `CLAUDE.md` (two layers, Risk Matrix, Backward Compatibility Matrix, symbol + code-block anchors).

- Tiny/Express: implement after classification
- Standard: implement after plan approval
- Deep: implement only after explicit human approval of both RCA/discovery and plan

For read-only tasks:

- evidence-backed findings only
- no source edits
