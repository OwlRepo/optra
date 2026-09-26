# Pull Request Evidence

> Purpose: the evidence a PR must carry before it is ready for review, by change type.
> Load rule: read before creating any PR (`docs/ai/handoff.md` "Integration sequence", step 7).
> Source of truth: this is a MAP. Where it asks for facts another doc governs (migrations, tests, refactor safety, performance), that doc wins; this file only says the PR must report them.

A PR is ready only when its evidence matches its Change Type and was actually
produced. Nothing is claimed without having been run.

## Change Type

One or more of: `UI / user-facing` · `Backend / API` · `Database` · `Bug fix` ·
`Refactor` · `Performance` · `Infrastructure` · `Workflow tooling`.

This tags the diff for the reviewer. It is separate from the routing
classification in `docs/ai/task-router.md`, which says why the task started. One
`ENHANCEMENT` task can carry several Change Types.

## Evidence by Change Type

### 1. UI / user-facing

Triggers: new or changed screens, flows, navigation, forms, modals, tables,
responsive layout, visual bug fixes.

Attach a short screen recording showing the starting state, the user actions,
the result, and the relevant loading / empty / error / responsive states. Use a
screenshot only when the reviewer asks for one.

How to produce it: walk the flow in the Browser pane against the dev stack
(`docs/ai/dev-environment.md`) and record it. The Playwright suite
(`apps/e2e`, run in CI) proves the flow works; the recording shows a reviewer
what it looks like, so it stays manual.

GitHub has no CLI or API for attaching a video to a PR body; it is drag-and-drop
in the web UI only. Hand the file to the user to attach. If the PR is opened
before the recording is attached, open it as a draft (`gh pr create --draft`)
and give the exact file path.

### 2. Backend, API, database or logic-only

No recording unless the change has visible behaviour. Include:

- The exact previous and new behaviour.
- Tests added or changed, the exact commands run, and their results.
- An example request and response for endpoint changes (and the contract row in
  `docs/ai/contracts/api-contracts.md`).
- Workspace-isolation proof for tenant endpoints: the test showing a caller from
  another workspace is refused.
- Logs or output when they help.
- Known risks and rollback steps.

Never paste secrets, tokens, `.env` values, real customer data or production
credentials.

### 3. Bug fixes without meaningful UI change

A regression test that fails before the fix and passes after it (the RED from
`bun run tdd:red`, reported as evidence). State how the bug was reproduced, the
root cause, why the fix resolves it, and which test prevents it returning.
Attach a recording only if it makes the bug easier to understand.

### 4. Refactors

No recording. Report the results of `docs/ai/prompts/refactor-plan.md`
"Existing Behavior Proof" and its verification plan: what was refactored and
why, confirmation that external behaviour did not change, the tests covering the
affected behaviour, any gain, and any new risk. A refactor-only PR uses
`TDD-Waiver: refactor <reason>`, which makes the CI gate require the tests to
pass on the base as well.

### 5. Database migrations

Report the facts `docs/ai/planning.md` "Migrations" requires: purpose, schema
changes, backfill, reversibility and rollback, impact on existing rows, how the
currently deployed code behaves before and after the migration (the API applies
it on start), and the tests or verification queries. A destructive migration
also records the owner's approval.

### 6. Performance changes

Report the fields `docs/ai/task-router.md` requires for `PERFORMANCE`: measured
baseline, result after the change, measurement method, environment, metrics and
tradeoffs. No improvement is claimed without a measurement.

### 7. Infrastructure and workflow tooling

Docker, compose, workflow and deploy-script changes report the operational
checklist from `docs/ai/testing-strategy.md` "Infrastructure / Docker /
Deployment Verification". Workflow-tooling changes (`scripts/ci/`,
`scripts/hooks/`, `agents/src/`, `.claude/settings*.json`) report
`bun run test:scripts` and `bun run agents:lint`.

## Required PR structure

`.github/PULL_REQUEST_TEMPLATE.md` puts a plain-language summary first, in
Spanish then English, for a non-technical reviewer. Keep it plain; no jargon
there. The technical evidence follows:

```
## Change Type
- <one or more from the list above>

## Evidence
<the evidence this Change Type requires>

## Testing
- Commands executed
- Tests passed
- Manual verification performed
- Important cases covered

## TDD evidence
- Test Matrix (layer | required / not required | file)
- RED run: the `bun run tdd:red` output from before implementing
- Waiver lines, if any, each on its own line: `TDD-Waiver: <reason>`,
  `E2E-Waiver: <reason>`, `Migration-Waiver: <reason>` (CI's `tdd:gate` reads
  them from the PR body)

## Risk
- Possible regressions
- Backward-compatibility concerns
- Data impact
- Security impact

## Rollback
- Exact steps to revert safely
```

## Rules

- No screen recording for a backend-only change with no visible behaviour.
- No test is reported as passing unless it ran.
- A recording never replaces an automated test that could exist.
- No secrets or private data in PR evidence.
- A PR is not marked ready until its evidence matches its Change Type.
- If required evidence cannot be produced, keep the PR as a draft
  (`gh pr create --draft`) and report the exact blocker. Never merge or mark
  ready around missing evidence.
- PR title and body: Spanish and English, plain language, no `Co-Authored-By`
  trailer.
