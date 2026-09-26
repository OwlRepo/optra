# Context Refresh

Purpose:

Refresh AI navigation and contract docs without changing source code.

## Scope

Context refresh is read-only for source code.

Only context docs may be edited.

No source code changes.

No implementation planning.

No feature work.

All facts must be verified from source code or repo docs.

Stale entries must be marked `CONTEXT DRIFT` or `CONTRACT DRIFT`.

Missing areas must be marked `TODO: Fill after repository analysis. Do not treat as verified.`

## Files To Refresh

- `docs/ai/architecture-manifest.md`
- `docs/ai/module-ownership-map.md`
- `docs/ai/contracts/api-contracts.md`
- `docs/ai/contracts/db-contracts.md`
- `docs/ai/testing-strategy.md`
- `docs/ai/risk-register.md`
- `docs/ai/file-index/repository-map.md`
- `CLAUDE.md` (project facts: stack, invariants, verified commands)
- `DEPLOYMENT.md`
- `DOCKER.md`

Workflow docs, refreshed when their sources change (verify against
`package.json` scripts, `.github/workflows/deploy.yml`,
`.github/workflows/backup.yml`, `.claude/settings.json`, `scripts/ci/`,
`scripts/hooks/`, `scripts/check-*.sh`, `scripts/backup.sh`, `agents/src/`,
`docker-compose*.yml`, `docker/Caddyfile`, `apps/*/Dockerfile`,
`.env.example`, `.ai-engineering/config/autonomous-engineering.yaml`):

- `AGENTS.md` (workflow core; project facts stay in `CLAUDE.md`)
- `docs/ai/task-router.md`
- `docs/ai/planning.md`
- `docs/ai/plan-template.md`
- `docs/ai/execution.md`
- `docs/ai/handoff.md`
- `docs/ai/agent-orchestration.md` (persona roster and `ownedGlobs` must match `agents/src/*.agent.mjs`)
- `docs/ai/pr-evidence.md` and `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/ai/dev-environment.md`
- `docs/ai/autonomous-engineering.md` (must match the yaml's `activation` and `approval` blocks)
- `docs/ai/entry-point.md`
- `.ai-engineering/core/task-state-machine.md`

`docs/ai/operating-contract.md`, `AI_WORKFLOW.md` and `PLANNING_STANDARDS.md`
are pointer pages; refresh only their links.

## Source Verification Rules

Verify facts against:

- real source code
- tests
- types
- schemas
- routes
- controllers
- services
- stores
- components
- API contracts
- database definitions
- package scripts
- repository documentation

Do not invent missing areas.

Mark unknowns as `TODO: Fill after repository analysis. Do not treat as verified.`

## Drift Markers

When verified source code contradicts context docs:

- mark `CONTEXT DRIFT` for architecture/module/file maps
- mark `CONTRACT DRIFT` for API/DB/test/risk contract docs
- mark `UNMAPPED DOMAIN` when domain is missing from module ownership map
- mark `UNMAPPED CONTRACT` when contract is missing from contract map
- mark `UNMAPPED RISK` when risk area is missing from risk register

## Refresh Steps

1. Read current context docs
2. Scan repository structure
3. Read relevant source files, schemas, routes, controllers, services, tests
4. Verify package scripts for verification commands
5. Compare context docs against verified source facts
6. Update stale entries
7. Fill missing entries where verified
8. Mark unknowns as `TODO: Fill after repository analysis. Do not treat as verified.`
9. Report drift found
10. Report updates made
11. Refresh the graph per `docs/ai/planning.md` "Closeout refresh"

## Output Summary

After context refresh, report:

- files refreshed
- drift found and corrected
- new entries added
- entries still marked as TODO
- verification sources used
