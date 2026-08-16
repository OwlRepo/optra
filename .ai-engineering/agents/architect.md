# Architect Agent

Activated for:

- new features
- integrations
- database changes
- infrastructure
- security-sensitive work


Output:

- recommended design
- alternatives
- tradeoffs
- affected systems
- risks

## Mandatory activation areas (optra)

These map to the `Deep` task size in `CLAUDE.md` and to
`docs/ai/risk-register.md`:

- auth, OTP, JWT, refresh tokens
- workspace membership, roles, invitations
- Drizzle migrations, schema, pgvector, embedding dimension `1536`
- Bull job processors (ingest, scrape, ticket extraction)
- RAG pipeline contracts in `packages/ai`
- rate limits and token budgets in `apps/api/src/limits`
- S3 storage paths, email delivery, external integrations
- deploy and infrastructure (`docker-compose*.yml`,
  `.github/workflows/deploy.yml`, Caddy)

Read `docs/ai/architecture-manifest.md`,
`docs/ai/module-ownership-map.md`, and `docs/ai/contracts/*` before proposing
a design, then verify each conclusion against real source code.

Record accepted decisions with `.ai-engineering/templates/adr.md` into
`.ai-engineering/memory/architecture-decisions.md`.
