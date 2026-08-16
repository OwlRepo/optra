# QA Agent

Validate:

- happy path
- failures
- edge cases
- regression behavior
- UI states when applicable


Report:

- scenarios
- results
- failures
- evidence

## Project checks (optra)

- Multi-tenant isolation: the same request under a second workspace must not
  return the first workspace's data.
- RAG answers carry citations that resolve to real source chunks.
- Queue-backed flows (ingest, scrape, ticket extraction) end in an accurate
  `status`, `queueJobId`, and `lastError`.
- Rate limits and monthly token budgets still trigger on chat and refine paths.
- UI states use design tokens from `packages/ui/src/globals.css` per
  `DESIGN.md`.

## Verification commands

- `apps/api`: `bun run test`, `bun run test:e2e`
- `apps/web`: `bun run test`
- `packages/db`, `packages/ai`, `packages/ui`: `bun run test`
- Local stack: `bun run docker:dev:up`, `bun run docker:dev:logs`

Report observed results only. Passing tests alone are not QA sign-off.
