# Task Router

> Purpose: turn any incoming request into an intent, a workflow, a task size, a domain and a risk level, and name the prompt doc and skill to use.
> Load rule: run this first on every task (flow node `B` in `AGENTS.md`), before touching code.
> Source of truth: this is a MAP. Real code and `docs/ai/risk-register.md` decide what is actually risky. If a map conflicts with code, code wins.

Requests arrive in any form: plain English, a bug report, a feature request, a
refactor request, a QA report, a GitHub issue, an error log or stack trace, a
screenshot description, a production incident note, test failure output, a code
review comment. The user never has to name a lane.

## Routing Table

Intent enums: `BUG_FIX` · `ENHANCEMENT` · `NEW_FEATURE` · `REFACTOR` ·
`PERFORMANCE` · `INFRASTRUCTURE` · `DOCUMENTATION`. Classify each task exactly
once. Sizes are Tiny / Express / Standard / Deep ("Task Size Rules" below); the
plan-gate hook reads them, so no other size vocabulary is used here.

| Intent | Workflow | Prompt doc | Skill |
|---|---|---|---|
| `BUG_FIX` — bug, error, regression, crash, failing test, broken or unexpected behaviour, production incident, QA failure | Bug RCA, then Bug Plan | `docs/ai/prompts/bugfix-rca.md` (RCA first, NO code until approved), then `docs/ai/prompts/bugfix-plan.md` | `/investigate` |
| `ENHANCEMENT` — change to existing behaviour | Feature Plan | `docs/ai/prompts/feature-plan.md` | `ecc:plan` |
| `NEW_FEATURE` — new capability, UI, API or workflow | Feature Plan | `docs/ai/prompts/feature-plan.md` | `ecc:feature-dev` |
| `REFACTOR` — cleanup, rename, restructure, no intended behaviour change | Refactor Plan | `docs/ai/prompts/refactor-plan.md` | — |
| `PERFORMANCE` | Performance Plan | none; "Required analysis" below | — |
| `INFRASTRUCTURE` — Docker, compose, Dockerfile, CI/CD, VPS, deploy scripts, AI workflow tooling | Infra Plan, Deep by default | none; "Required analysis" below, plus the operational checklist in `docs/ai/testing-strategy.md` "Infrastructure / Docker / Deployment Verification" | — |
| `DOCUMENTATION` | Docs change | none; "Required analysis" below | `ecc:update-docs` |
| Question / explanation / review / discovery | Read-only | none; evidence-backed findings, no plan, no file changes | `/review` or `ecc:code-review` for diffs; `/graphify query` for codebase questions |
| QA | QA | — | `/qa` (fixes), `/qa-only` (report), `ecc:test-coverage` |

Other skills: `/plan-eng-review` (architecture plan review), `/autoplan` (full
review pipeline). gstack skills use short names (`/investigate`, `/qa`); never
invent namespaced variants. If a skill fails to load, report the unresolved
mapping instead of substituting an invented command.

### Required analysis for intents without a prompt doc

- `PERFORMANCE`: the measured bottleneck and its evidence, the baseline, the hot
  path, the proposed optimisation, the expected impact, how it will be
  measured, regression risks, observability. Never optimise on speculation.
- `INFRASTRUCTURE`: the current setup (cite `.github/workflows/deploy.yml`,
  `docker-compose*.yml`, `apps/*/Dockerfile`, `scripts/deploy*.sh` as relevant),
  the proposed change, compatibility and deploy impact, secrets and config
  impact, rollback procedure, required validation. Infra files are not guarded
  source for the TDD hook; application code touched along the way (for example
  a health controller) still follows TDD.
- `DOCUMENTATION`: the audience, the current gap, the source-of-truth code or
  config, the exact documents to change, and any examples that need
  verification.

## Ambiguity Rule

When the intent is unclear, pick the safest lane: possible bug → Bug RCA;
possible new behaviour → Feature Plan; possible no-behaviour-change → Refactor
Plan. Anything touching the Deep defaults below is Deep, even when the request
looks small.

## Module Ownership Map Lookup

After classifying, consult `docs/ai/module-ownership-map.md` for the likely
domain, frontend area, backend area, database/schema area, tests and default
risk. Missing domain → `UNMAPPED DOMAIN`. Stale or contradicting code →
`CONTEXT DRIFT`.

## API Contract Map Lookup

For FE-BE tasks, consult `docs/ai/contracts/api-contracts.md` for the endpoints,
request/response shapes, frontend callers (BFF routes under
`apps/web/app/api/**` and `apps/web/src/lib/api/`), backend handlers,
auth/permission requirements and known contract risks. Missing contract →
`UNMAPPED CONTRACT`. Stale → `CONTRACT DRIFT`.

## DB Contract Map Lookup

For schema, model or mutation tasks, consult `docs/ai/contracts/db-contracts.md`
for the tables, important fields, invariants, mutation paths,
transaction/idempotency rules and related APIs/jobs. Missing contract →
`UNMAPPED CONTRACT`. Stale → `CONTRACT DRIFT`.

## Testing Strategy Lookup

After sizing, consult `docs/ai/testing-strategy.md` for the minimum and extra
verification and the manual QA for that size, plus its "Strict TDD" rules.

## Risk Register Lookup

After the first classification, consult `docs/ai/risk-register.md`. If the task
touches a listed high-risk area, it defaults to Deep. Only downgrade Deep when
repository evidence proves the task is isolated and low-risk. Missing area →
`UNMAPPED RISK`.

## Task Size Rules

### Tiny

- docs, copy, comments, config, display-only polish
- no behaviour change
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
- requires approval of that RCA/discovery before a plan is written, then
  approval of the plan
- requires regression tests
- requires manual QA
- requires rollback notes

## Deep Defaults

Deep by default in Optra:

- auth: OTP, JWT, refresh tokens, cookies (`apps/api/src/auth/`,
  `apps/web/middleware.ts`)
- workspace membership and roles (owner/admin/member), invitations, permissions
- DB migrations and schema changes (Drizzle, pgvector)
- Bull job processors (ingest, scrape, ticket extraction, procurement and
  catalog parsing, insights)
- RAG pipeline contract changes (`packages/ai` chains, embedding model or
  dimension)
- rate limits and token budgets (`apps/api/src/limits/`)
- S3 storage paths
- email/OTP delivery (Resend)
- external integrations (OpenAI, LangSmith)
- transactions, webhooks, automations
- deploy/infra (docker-compose, Dockerfiles, GitHub Actions, Caddy, deploy
  scripts) and AI workflow tooling (hooks, CI TDD gate, persona generator)
- billing, payments, credits and plan upgrades (none exist today; a task that
  introduces them is Deep)

Only downgrade Deep when repository evidence proves the task is isolated and
low-risk.

## Mandatory Classification Output

Emit this block before starting work on any non-trivial task:

```
Task Classification:
- Intent:
- Workflow:
- Task Size:
- Domain:
- Risk:
- Contract Areas:
- Next Action:
```

Domain values come from `docs/ai/module-ownership-map.md`; risk values from
`docs/ai/risk-register.md`. The routed prompt doc may add carry-forward lines
(Risk Register Notes, Template Loaded). Plans must then satisfy
`docs/ai/planning.md` using the skeleton in `docs/ai/plan-template.md`.

## Approval Requirement Rule

- Tiny / Express: implement after classification (the plan-gate ack records
  `plan:"not-required"`; Express also states its blast-radius line).
- Standard: implement after the plan is approved.
- Deep: RCA or discovery first, then stop for approval (flow node `E`/`G`);
  then the plan, then stop again for approval (node `R`). Implementation starts
  only after both.
- Read-only: evidence-backed findings, no source edits.

## Who implements

The orchestrating session owns the task from routing to validation. For code
changes it dispatches the persona agents per `AGENTS.md` "Automatic agent
routing default" and `docs/ai/agent-orchestration.md`, and it still owns the
plan, the contract lock and the final validation.
