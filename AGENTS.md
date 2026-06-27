# AGENTS.md

Loader pointer for AI agents.

## Load Order

Agents must load:

1. `CLAUDE.md`
2. `docs/ai/entry-point.md`
3. `docs/ai/task-router.md`
4. `docs/ai/architecture-manifest.md`
5. `docs/ai/module-ownership-map.md`
6. `docs/ai/contracts/api-contracts.md`
7. `docs/ai/contracts/db-contracts.md`
8. `docs/ai/testing-strategy.md`
9. `docs/ai/risk-register.md`
10. `docs/ai/file-index/repository-map.md`

## Split-Brain Rule

Claude owns:

- task routing
- RCA
- code discovery
- architecture analysis
- feature discovery
- implementation planning
- `.ai-scratchpad.md` handoff

Codex owns:

- code edits
- mechanical implementation
- validation commands
- implementation-caused syntax/type/test fixes
- diff boundary enforcement

Claude must not edit source code.

Codex must not perform RCA or architecture planning.

## Implementation Contract

Codex implements and validates only from `.ai-scratchpad.md`.

Codex may implement only if `Status: IMPLEMENTATION_READY`.

Codex may validate only if `Status: IMPLEMENTATION_READY` or `Status: VALIDATION_READY`.

## Context Contract

Context docs are maps only.

Context docs are not proof.

Source of truth = real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

Verify all conclusions against source code.
