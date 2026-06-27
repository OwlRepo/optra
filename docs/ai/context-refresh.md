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

## Output Summary

After context refresh, report:

- files refreshed
- drift found and corrected
- new entries added
- entries still marked as TODO
- verification sources used
