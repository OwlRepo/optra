## Reliable before production — flaky unit suites, per-visitor rate limits, catalog reconcile, DOMAIN

The deploy gate must be trustworthy, and three things stand in the way:
- **Some unit tests fail at random.** They share one database with the demo data and with each other, so one test's leftovers can answer another test's question.
- **Every visitor shares one rate limit.** The API sees each request as coming from the web server, not the person.
- **Production's `DOMAIN` is wrong** (`optra`), so invite emails point nowhere.

While checking, I also found a background sweeper that picks up website-scrape jobs it doesn't own. This plan gives tests a clean database per run and passes each visitor's real address through a proven chain. It also fixes the sweeper and the domain, and blocks any deploy whose configuration can't work.

### Flowchart (high-level)

```mermaid
flowchart LR
  A[Unit tests share the dev DB] --> A2[Fresh optra_unit DB per run + UTC + keyed mocks]
  B[API sees only the web server's IP] --> B2[Caddy writes IP → BFF forwards it → API trusts 1 hop]
  C[Parse sweeper grabs scrape jobs] --> C2[Sweeper filtered to uploaded catalogs]
  D[DOMAIN=optra in prod .env] --> D2[Fix on VPS + deploy refuses a bad .env]
  A2 & B2 & C2 & D2 --> E[5-run soak + CI green] --> F[PR → main → deploy → prod smoke]
```

### Task metadata

- Classification: `BUG_FIX` · `Deep` · Limits/Auth, Infrastructure/Deployment, Vendor Catalog (jobs), test infrastructure · risk register: "Site-Wide Rate Limit Behind The BFF" (open), "Production Deployment", "Background Jobs"
- Contract areas:
  - API: no route shape changes. The API starts reading `X-Forwarded-For`, only when `TRUST_PROXY` is set.
  - Database: no schema change, no migration.
  - Permissions: none.
  - External integrations: Caddy (host, read-only), no code.
  - Jobs: `CatalogParseService.reconcile` scope.
- Docs loaded: `planning.md, plan-template.md` (read from `infra/no-ticket-ai-workflow-port` via `git show`; they are not yet on this branch)
- Claims reversed while investigating:
  1. "Delete all ~30 per-spec cleanup helpers." Refined: a static count shows one spec doing 5.8× the next one's round trips (see C2). Only that cleanup is removed; the rest stay (harmless on a fresh DB), with a stop rule in Phase 5.
  2. "`tickets.service.spec.ts:552` is a once-mock hazard." Disproved: it uses `mockResolvedValue(null)`, not a once-queue, so its own rows always get `null`.
  3. "`scrape.service.spec.ts:512` is a hazard." Disproved: the spec's default `getJob` also returns a live job (`:72`), so a stolen answer changes nothing.
  4. "Raise Jest `testTimeout` to 15 s." Dropped: it would hide C2 rather than remove it.
  5. The explorer's "15 API e2e suites" was already corrected; there are 15 now only because `datasets.e2e-spec.ts` was added.
- Root causes (each with its evidence and the observation that would disprove it):
  - **C1 (hypothesis — the failure message was not captured).** `ingest.service.spec.ts` "reconciliation marks stale pending and processing documents failed…" answers `getJob` with `mockResolvedValueOnce(null).mockResolvedValueOnce(null)` (`:151`). `IngestService.reconcileDocuments()` reads every `pending`/`processing` document with no workspace scope and no order. The demo seed has a stale `processing` document with a job id (`scripts/seed/data/documents.ts:400,554`), which can use up a `null`, so the test's own row sees the default live job (`:74`) and stays unfailed. *Disproved if:* on a fresh `optra_unit` database with keyed mocks, this test fails in the 5-run soak.
  - **C2.** GitHub run 36127958024 failed "Exceeded timeout of 5000 ms for a hook" at `comparison.service.spec.ts:76` (`afterAll` → `cleanupFixtures`). `cleanupFixtures` (`:24-48`) issues sequential deletes per workspace. Static upper bound (seed call sites × delete statements per cleanup, an operation count, not a timing): comparison 199 × 12 = 2,388; next highest `procurement-parse.processor.spec.ts` 46 × 9 = 414. *Disproved if:* after removal, any suite's hook exceeds 5 s in the soak.
  - **C3.** `@nestjs/throttler` 6.5.0 `ThrottlerGuard.getTracker` returns `req.ip` (`node_modules/@nestjs/throttler/dist/throttler.guard.js:141-143`). `apps/api/src/main.ts` never sets `trust proxy`. No BFF fetch forwards a client address (`apps/web/src/lib/http/auth-proxy.ts`, the `app/api/auth/*/route.ts` handlers, `middleware.ts tryRefresh`). *Disproved if:* the new API e2e "happy: a second visitor is not throttled…" passes before the fix.
  - **C4.** Host Caddy v2.11.3 (`caddy version` on the VPS) proxies `optra.tyvera.app` → `127.0.0.1:3300`. DNS resolves to the VPS and responses carry `via: 1.1 Caddy`, so there's no CDN. Caddy ≥2.5 replaces a client-sent `X-Forwarded-For` unless `trusted_proxies` is configured, and none is. Next 14 only fills XFF when absent (`node_modules/next/dist/server/base-server.js:530`, `??=`). This is vendor behaviour, so it's labelled a **hypothesis** until Phase 7 step 5. *Disproved if:* after deploy, logins sent with a forged `X-Forwarded-For` do not count against the sender's real-IP bucket.
  - **C5.** `CatalogParseService.reconcile` (`catalog-parse.service.ts`) selects `pending`/`processing` catalogs of every `sourceKind`, while `CatalogScrapeService.reconcile` filters `sourceKind = 'scrape'` (`catalog-scrape.service.ts:90`). For a stale scrape catalog, `reconcileRows` finds no parse job and calls `queueDoc`, pushing it into the **parse** queue. *Disproved if:* the new regression test passes before the fix.
  - **C6.** The VPS `.env` holds `DOMAIN=optra` (read-only SSH). `docker-compose.prod.yml` sets `WEB_URL: https://${DOMAIN}`, and `WorkspacesService` builds `inviteUrl` from `WEB_URL` (`workspaces.service.ts:136`). *Disproved if:* after the fix, a new invite's link host is not `optra.tyvera.app`.
- Detected running model: Claude Opus 5.5 (`claude-opus-5-5`).
- Recommended model: `opus`, high reasoning; confidence high. Fallback: `sonnet`, high reasoning.
- Minimum capability: a model that can apply literal blocks exactly and read Jest/Playwright failures. Security-sensitive trust decisions are all fixed in this plan.
- Branch: continue on `test/storage-e2e-playwright` (the parent storage work; not on `main`). This deviates from "new branch from `origin/main`" because these fixes must ship in the same deploy as their parent. Release path: one PR `test/storage-e2e-playwright` → `main`, "Create a merge commit".
- Required skills: `/review` before the PR; graphify at the end.
- Execution preflight: `git fetch origin`; `git switch test/storage-e2e-playwright`; `git status` shows only `apps/web/tsconfig.tsbuildinfo`; `source ~/.nvm/nvm.sh && nvm use 22`; `docker compose up -d --wait postgres redis seaweedfs`; write `.claude/.plan-ack` `{"size":"deep","plan":"approved","matrices":"present"}` and `.claude/.predict-verify-ack` `{"status":"skipped","matches":"approved plan"}`.
- Follow-up task (separate plan, sequential after this deploys): **PR #2 reconciliation.** Its conflict blocks can only be written from the merged state, so a plan written now would be guesses. It is written as its own plan once `main` contains this work.

### Layer 1 — human summary

**The tests get a clean bench.** Before each run, Jest builds a brand-new `optra_unit` database from the migrations (the same tool the two e2e layers use) and runs in UTC, like production. Tests stop touching your demo data. The two tests that queued answers for "whoever asks first" now answer by job id. The one cleanup that ran ~2,400 deletes is removed: a fresh database needs no cleanup.

**Rate limits count visitors, through a chain of custody:**
1. Caddy writes the visitor's real address, discarding anything the visitor claimed.
2. The web server passes along exactly that one value, and only if it is a real IP.
3. The API believes it only from one hop away (`TRUST_PROXY=1`).
4. The API isn't reachable from anywhere else: no host port, and after this change not even on the `web` network.

`TRUST_PROXY=true` is rejected at boot, because it would let anyone choose their own address.

**The sweeper is scoped:** the parse sweeper only touches uploaded catalogs.

**Deploys refuse a broken `.env`:** a new check runs before anything is built or restarted.

**Risk Matrix**

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| API trusts a forged XFF → login limits bypassable | Low | High | Hop count `1` only, `true` rejected at boot, API unreachable except from `web`, BFF forwards only a validated single IP; API e2e proves an untrusted peer's XFF is ignored; Phase 7 step 5 proves Caddy overwrites a forged header | Remove `TRUST_PROXY` from compose, redeploy: back to one shared bucket |
| Unit globalSetup cannot create `optra_unit` in CI | Low | Gate red | Same `prepare-db.ts` already creates `optra_e2e`/`optra_pw` in CI; globalSetup throws with the script's exit code | Revert Phase 1 commit |
| A remaining cleanup times out in the soak | Low (C2 bound) | Gate red | Stop rule in Phase 5 | — |
| `check-prod-env.sh` blocks the deploy | Certain until DOMAIN is fixed | Deploy halts before backup/build; nothing changes | Phase 7 step 2 fixes DOMAIN before the merge | Fix `.env`, re-run the deploy workflow |
| DOMAIN change breaks a consumer | Low | Links/metadata | All consumers enumerated (compose WEB_URL/NEXT_PUBLIC_API_URL/Caddy DOMAIN; `main.ts` CORS; `workspaces.service.ts:136`; web layout/page/robots/sitemap); deploy rebuilds web | Restore `.env.bak-<ts>`, redeploy |
| Dropping `api` from the `web` network cuts a path | Low | API unreachable | Consumers of the api host: `web` (`API_URL: http://api:3001`, on `internal`) and deploy health checks run inside `api`; bundled Caddy proxies only `web:3000` | Revert the compose line |
| Middleware runs on the edge runtime, no `node:net` | Certain if `net.isIP` were used | Web crash | `client-ip.ts` uses regex validation only | — |

**Backward Compatibility Matrix** (usage search: `grep` for each changed symbol across `apps/`, `packages/`, `scripts/`)

| Changed File / Symbol | Used By (outside this feature) | Breaks? | Handling |
|---|---|---|---|
| `auth-proxy.ts` `proxyJson`/`proxyMultipart`/`proxyRaw` | ~60 BFF routes; 57 route specs assert exact `fetch` headers (e.g. `app/api/auth/me/route.spec.ts:27-33`) | No | Header spread only when the incoming request has a valid XFF; spec requests carry none |
| `app/api/auth/{login,register,verify-otp,refresh,logout}/route.ts`, `app/api/workspaces/[id]/chat/route.ts` | Browser only | No | Same conditional spread |
| `middleware.ts` `tryRefresh` (module-private) | `middleware` only | No | Signature gains a second parameter; single caller updated |
| `apps/api/src/main.ts` `bootstrap` | Docker `CMD`, Playwright webServer | No | Same pipes/filter/CORS/port; trust proxy off unless env |
| New `configureApp` | `main.ts`, `test/auth-rate-limit.e2e-spec.ts` | — | Other e2e suites keep their own setup (affected, NOT modified: they never set `TRUST_PROXY`) |
| `ThrottlerGuard` tracker behaviour | Every route | Changes only where `TRUST_PROXY` is set (prod, Playwright) | API e2e covers both modes |
| `CatalogParseService.reconcile` | `onModuleInit`, repeatable job `catalog-parse-reconcile` | Stops touching scrape catalogs | Those remain owned by `CatalogScrapeService.reconcile` |
| apps/api Jest config | Every unit suite, CI "Unit tests — apps/api" | Tests stop using `optra` | `UNIT_DATABASE_URL` override documented |
| `apps/e2e/scripts/prepare-db.ts` `ALLOWED` | CI API e2e, Playwright webServer | No | Adds one name |
| `docker-compose.prod.yml` api | Prod stack | Env + one network | Deploy health checks and prod smoke |
| `.github/workflows/deploy.yml` | Every push/deploy | New check step can halt a deploy | DOMAIN fixed first |
| `packages/ai/src/vectorstore/index.spec.ts` cleanup (DB-backed, vitest) | packages/ai tests | Affected, NOT modified | Not observed flaky; out of scope |

**New dependency:** none.

### Layer 2 — execution spec

All phases: `opus`, high reasoning. The pair never changes, so there are no switch stops. Commit subjects are given per phase. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `sh scripts/check-test-layers.sh origin/main HEAD` passes after each commit.

#### Phase 1 — unit tests on their own database, in UTC (`opus`, high)

1. `apps/e2e/scripts/prepare-db.ts`

   Old:
   ```ts
   const ALLOWED = new Set(['optra_pw', 'optra_e2e'])
   ```
   New:
   ```ts
   const ALLOWED = new Set(['optra_pw', 'optra_e2e', 'optra_unit'])
   ```
   Old:
   ```ts
   //   bun apps/e2e/scripts/prepare-db.ts optra_e2e    # apps/api jest e2e (CI)
   ```
   New:
   ```ts
   //   bun apps/e2e/scripts/prepare-db.ts optra_e2e    # apps/api jest e2e (CI)
   //   bun apps/e2e/scripts/prepare-db.ts optra_unit   # apps/api jest unit (globalSetup)
   ```

2. New file `apps/api/test/unit-global-setup.ts` (reuse check: `prepare-db.ts` does the create/migrate, so no new DB code; Jest needs a `globalSetup` module to run it once before workers fork):
   ```ts
   import { spawnSync } from 'node:child_process'
   import { join } from 'node:path'

   // Runs once before any unit worker starts. Gives the unit layer its own
   // database, recreated from the migrations every run - the same tool and the
   // same reason as the two e2e layers: the dev database `optra` holds the demo
   // seed, dev uploads and other runs' leftovers, and services under test sweep
   // tables globally (e.g. IngestService.reconcileDocuments), so a shared
   // database lets unrelated rows answer a test's question.
   //
   // Workers inherit process.env from this process, and dotenv (packages/db)
   // never overrides a variable that is already set, so DATABASE_URL below is
   // what every unit suite connects to. UNIT_DATABASE_URL overrides the base.
   //
   // TZ=UTC: timestamps are stored without a zone and Postgres runs in UTC, so a
   // non-UTC Node reads freshly written rows as hours old. Production runs in
   // UTC; so do the tests.

   const UNIT_DATABASE = 'optra_unit'

   export default function unitGlobalSetup(): void {
     process.env.TZ = 'UTC'

     const base =
       process.env.UNIT_DATABASE_URL ??
       process.env.DATABASE_URL ??
       'postgresql://postgres:postgres@localhost:54322/optra'
     const target = new URL(base)
     target.pathname = `/${UNIT_DATABASE}`
     const admin = new URL(base)
     admin.pathname = '/postgres'

     const prepare = spawnSync(
       'bun',
       [join(__dirname, '..', '..', 'e2e', 'scripts', 'prepare-db.ts'), UNIT_DATABASE],
       { env: { ...process.env, E2E_PG_ADMIN_URL: admin.toString() }, stdio: 'inherit' },
     )
     if (prepare.status !== 0) {
       throw new Error(`could not prepare ${UNIT_DATABASE} (prepare-db.ts exited ${prepare.status})`)
     }

     process.env.DATABASE_URL = target.toString()
   }
   ```

3. `apps/api/package.json`

   Old:
   ```json
       "dev": "nest start --watch",
   ```
   New:
   ```json
       "dev": "TZ=UTC nest start --watch",
   ```
   Old:
   ```json
       "coverageDirectory": "../coverage",
       "testEnvironment": "node"
     }
   ```
   New:
   ```json
       "coverageDirectory": "../coverage",
       "testEnvironment": "node",
       "globalSetup": "<rootDir>/../test/unit-global-setup.ts"
     }
   ```

4. `apps/api/src/procurement/comparison.service.spec.ts`. Remove the helper (only caller: `afterAll`). Every import stays used (verified: `like` at `:2022`, `discrepancyDecisions` `:661`, and the rest in seed helpers and tests).

   Old:
   ```ts
   async function cleanupFixtures(prefix: string) {
     const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
     for (const user of testUsers) {
       const memberships = await db
         .select({ workspaceId: workspaceMembers.workspaceId })
         .from(workspaceMembers)
         .where(eq(workspaceMembers.userId, user.id))
       for (const membership of memberships) {
         await db.delete(discrepancyDecisions).where(eq(discrepancyDecisions.workspaceId, membership.workspaceId))
         await db.delete(discrepancyFlags).where(eq(discrepancyFlags.workspaceId, membership.workspaceId))
         await db.delete(comparisonRuns).where(eq(comparisonRuns.workspaceId, membership.workspaceId))
         await db
           .delete(goodsReceiptLineItems)
           .where(eq(goodsReceiptLineItems.workspaceId, membership.workspaceId))
         await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, membership.workspaceId))
         await db.delete(poLineItems).where(eq(poLineItems.workspaceId, membership.workspaceId))
         await db.delete(invoiceLineItems).where(eq(invoiceLineItems.workspaceId, membership.workspaceId))
         await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
         await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
         await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
         await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
       }
     }
     await db.delete(users).where(like(users.email, `${prefix}%`))
   }

   ```
   New: (nothing; the block and its trailing blank line are removed)

   Old:
   ```ts
     afterAll(async () => {
       await cleanupFixtures(prefix)
       await pool.end()
     })
   ```
   New:
   ```ts
     // No per-suite cleanup: unit tests run on a database recreated every run
     // (test/unit-global-setup.ts). This one issued up to ~2,400 sequential
     // deletes and exceeded Jest's 5 s hook timeout in CI.
     afterAll(async () => {
       await pool.end()
     })
   ```

5. `apps/api/test/jest-e2e.setup.ts`

   Old:
   ```ts
   process.env.BULL_PREFIX = `bull-e2e-${process.pid}`
   ```
   New:
   ```ts
   process.env.BULL_PREFIX = `bull-e2e-${process.pid}`

   // Timestamps are stored without a zone and Postgres runs in UTC; production
   // runs in UTC. A non-UTC host would read fresh rows as hours old and let the
   // services' stale-job sweeps act on them.
   process.env.TZ = 'UTC'
   ```

6. `apps/e2e/support/env.ts` (in `apiEnv`)

   Old:
   ```ts
       NODE_ENV: 'test',
       PORT: String(API_PORT),
   ```
   New:
   ```ts
       NODE_ENV: 'test',
       TZ: 'UTC',
       PORT: String(API_PORT),
   ```

7. `.github/workflows/deploy.yml`

   Old:
   ```yaml
         # Unit suites run per workspace rather than through one turbo task: turbo
         # has no `test` task (turbo.json), and a per-workspace step names the
         # failing package in the run summary.
         - name: Unit tests — apps/api
   ```
   New:
   ```yaml
         # Unit suites run per workspace rather than through one turbo task: turbo
         # has no `test` task (turbo.json), and a per-workspace step names the
         # failing package in the run summary. apps/api's Jest globalSetup
         # recreates its own database, optra_unit, from this job's DATABASE_URL.
         - name: Unit tests — apps/api
   ```

Commit: `test(api): unit suites run on their own database, recreated every run`, with the trailer `Test-Layers-Skip: test infrastructure only; the unit suites themselves are the proof`.

Done:
- `cd apps/api && bun run test` passes.
- `psql … -d optra -tAc "select count(*) from users"` returns the same number before and after the run.
- `psql … -d optra_unit -tAc "select 1"` succeeds.

#### Phase 2 — reconcile tests answer only for their own rows (`opus`, high)

1. `apps/api/src/ingest/ingest.service.spec.ts`, test "reconciliation marks stale pending and processing documents failed when the Bull job is missing"

   Old:
   ```ts
       queue.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
   ```
   New:
   ```ts
       // Keyed by job id, never a once-queue: reconcileDocuments() sweeps every
       // stale document in the database in no fixed order, so a queued `null`
       // can be spent on a row this test does not own. Foreign rows get a live
       // job and are left alone.
       const missingJobs = new Set([`ingest:${stalePending.document.id}`, `ingest:${staleProcessing.document.id}`])
       queue.getJob.mockImplementation(async (jobId: string) => (missingJobs.has(jobId) ? null : { id: jobId }))
   ```

2. `apps/api/src/scrape/scrape.service.spec.ts`, test "reconciliation marks stale queued runs failed when the Bull job is missing"

   Old:
   ```ts
       queue.getJob.mockResolvedValueOnce(null)

       await service.reconcileRuns()
   ```
   New:
   ```ts
       // Keyed by job id, never a once-queue: reconcileRuns() sweeps every stale
       // run in the database in no fixed order. Foreign runs get a live job.
       queue.getJob.mockImplementation(async (jobId: string) => (jobId === 'scrape:stale-run' ? null : { id: jobId }))

       await service.reconcileRuns()
   ```

Commit: `test(api): reconcile specs answer only for the rows they own`, with the trailer `Test-Layers-Skip: test-only change; it removes an order dependence, and the soak is the proof`.

Done: both specs pass. `bun run test -- src/ingest src/scrape` passes 5 times in a row.

#### Phase 3 — parse reconciliation leaves scraped catalogs alone (`opus`, high)

1. RED — `apps/api/src/catalog/catalog-parse.service.spec.ts`

   Old:
   ```ts
     it('reconcile leaves a fresh pending row untouched', async () => {
   ```
   New:
   ```ts
     // A scrape catalog is owned by CatalogScrapeService.reconcile. The parse
     // sweeper used to select every stale catalog, find no PARSE job for a
     // scrape's `catalog-scrape:` job id, and push it into the parse queue.
     it('regression: reconcile leaves a stale scraped catalog to the scrape reconciler', async () => {
       const { workspace, vendor } = await seedWorkspaceAndVendor(`${prefix}scrape-owned@example.com`, 'Catalog Scrape Owned')
       const staleSince = new Date(Date.now() - 60 * 60_000)
       const [catalog] = await db
         .insert(catalogs)
         .values({
           workspaceId: workspace.id,
           vendorId: vendor.id,
           name: 'https://vendor.example.com',
           sourceKind: 'scrape',
           status: 'processing',
           queueJobId: 'catalog-scrape:stale',
           enqueuedAt: staleSince,
           processingStartedAt: staleSince,
         })
         .returning()

       await service.reconcile()

       expect(queue.add).not.toHaveBeenCalledWith({ id: catalog.id }, expect.anything())
       const [row] = await db.select().from(catalogs).where(eq(catalogs.id, catalog.id))
       expect(row.status).toBe('processing')
       expect(row.lastError).toBeNull()
     })

     it('reconcile leaves a fresh pending row untouched', async () => {
   ```
   Run `bun run test -- src/catalog/catalog-parse.service.spec.ts`: this test fails (`queue.add` called with `{ id: catalog.id }`).

2. `apps/api/src/catalog/catalog-parse.service.ts`

   Old:
   ```ts
   import { eq, or } from 'drizzle-orm'
   ```
   New:
   ```ts
   import { and, eq, or } from 'drizzle-orm'
   ```
   Old:
   ```ts
     async reconcile(now = new Date()) {
       const rows = await db
         .select()
         .from(catalogs)
         .where(or(eq(catalogs.status, 'pending'), eq(catalogs.status, 'processing')))
       await this.reconcileRows(rows, now)
     }
   ```
   New:
   ```ts
     async reconcile(now = new Date()) {
       // Uploaded catalogs only: scraped ones are owned by
       // CatalogScrapeService.reconcile, and have no parse job to find.
       const rows = await db
         .select()
         .from(catalogs)
         .where(
           and(eq(catalogs.sourceKind, 'upload'), or(eq(catalogs.status, 'pending'), eq(catalogs.status, 'processing'))),
         )
       await this.reconcileRows(rows, now)
     }
   ```

Commit: `fix(catalog): parse reconciliation leaves scraped catalogs to the scraper`, with the trailer `Test-Layers-Skip: no route or page triggers reconciliation; the regression is pinned in the service spec`.

Done: `bun run test -- src/catalog` passes.

#### Phase 4 — rate limits count each visitor (`opus`, high)

RED first: steps 1, 3 and 9–12 are written and run failing before steps 2 and 4–8.

1. New file `apps/web/src/lib/http/client-ip.spec.ts`:
   ```ts
   import { describe, expect, it } from 'vitest'
   import { clientIpHeaders } from './client-ip'

   const headersWith = (value?: string) => new Headers(value === undefined ? {} : { 'x-forwarded-for': value })

   describe('clientIpHeaders', () => {
     it('error: forwards nothing when the value is not an IP address', () => {
       expect(clientIpHeaders(headersWith('not-an-ip'))).toEqual({})
       expect(clientIpHeaders(headersWith('999.1.1.1'))).toEqual({})
     })

     it('edge: forwards nothing when the request carries no X-Forwarded-For', () => {
       expect(clientIpHeaders(headersWith())).toEqual({})
       expect(clientIpHeaders(headersWith(''))).toEqual({})
     })

     it('edge: takes the rightmost entry - the one our own proxy wrote', () => {
       expect(clientIpHeaders(headersWith('6.6.6.6, 203.0.113.7'))).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
     })

     it('happy: forwards a single IPv4 address', () => {
       expect(clientIpHeaders(headersWith('203.0.113.7'))).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
     })

     it('happy: forwards an IPv6 address', () => {
       expect(clientIpHeaders(headersWith('2001:db8::1'))).toEqual({ 'X-Forwarded-For': '2001:db8::1' })
     })
   })
   ```

2. New file `apps/web/src/lib/http/client-ip.ts` (reuse check: no existing XFF/IP handling anywhere in `apps/`, `packages/` or `docker/`; `node:net` `isIP` is unusable because `middleware.ts` runs on the edge runtime):
   ```ts
   // The visitor's address, for the API's per-visitor rate limits.
   //
   // Chain of custody: Caddy (host, v2.11) replaces any client-sent
   // X-Forwarded-For with the peer address it actually saw; Next only fills the
   // header when absent (never appends); this helper forwards exactly one value,
   // the rightmost - the entry our own proxy wrote - and only if it is an IP. The
   // API trusts it from one hop (TRUST_PROXY=1). Regex, not node:net, because
   // middleware.ts runs on the edge runtime.

   const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
   const IPV6 = /^(?=.*:)[0-9a-f:.]{2,45}$/i

   export function clientIpHeaders(headers: Headers): Record<string, string> {
     const chain = headers.get('x-forwarded-for')
     if (!chain) return {}
     const ip = chain.split(',').pop()!.trim()
     return IPV4.test(ip) || IPV6.test(ip) ? { 'X-Forwarded-For': ip } : {}
   }
   ```

3. `apps/web/app/api/auth/login/route.spec.ts`

   Old:
   ```ts
   describe('POST /api/auth/login proxy', () => {
     afterEach(() => {
       vi.unstubAllGlobals()
     })
   ```
   New:
   ```ts
   describe('POST /api/auth/login proxy', () => {
     afterEach(() => {
       vi.unstubAllGlobals()
     })

     it('edge: sends no X-Forwarded-For when the request carries none', async () => {
       const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid credentials' }))
       vi.stubGlobal('fetch', fetchMock)

       await POST(
         new NextRequest('http://localhost:3000/api/auth/login', {
           method: 'POST',
           body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
         }),
       )

       expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
     })

     it('happy: forwards the visitor address so the API limits each visitor separately', async () => {
       const fetchMock = vi.fn().mockResolvedValue(mockBackendResponse(401, { message: 'Invalid credentials' }))
       vi.stubGlobal('fetch', fetchMock)

       await POST(
         new NextRequest('http://localhost:3000/api/auth/login', {
           method: 'POST',
           headers: { 'x-forwarded-for': '203.0.113.7' },
           body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
         }),
       )

       expect(fetchMock.mock.calls[0][1].headers).toEqual({
         'Content-Type': 'application/json',
         'X-Forwarded-For': '203.0.113.7',
       })
     })
   ```

4. `apps/web/app/api/auth/login/route.ts`, `register/route.ts`, `verify-otp/route.ts`. The same two edits in each file.

   Old (in `login/route.ts` and `verify-otp/route.ts`):
   ```ts
   import { accessCookie, forwardSetCookies } from '../../../../src/lib/http/set-cookie'
   ```
   New:
   ```ts
   import { accessCookie, forwardSetCookies } from '../../../../src/lib/http/set-cookie'
   import { clientIpHeaders } from '../../../../src/lib/http/client-ip'
   ```
   Old (in `register/route.ts`):
   ```ts
   import { NextRequest, NextResponse } from 'next/server'

   const API_URL = process.env.API_URL || 'http://localhost:3001'
   ```
   New:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'
   import { clientIpHeaders } from '../../../../src/lib/http/client-ip'

   const API_URL = process.env.API_URL || 'http://localhost:3001'
   ```
   Old (in all three):
   ```ts
       headers: { 'Content-Type': 'application/json' },
   ```
   New:
   ```ts
       headers: { 'Content-Type': 'application/json', ...clientIpHeaders(request.headers) },
   ```

5. `apps/web/app/api/auth/refresh/route.ts`

   Old:
   ```ts
   import { accessCookie, forwardSetCookies } from '../../../../src/lib/http/set-cookie'
   ```
   New:
   ```ts
   import { accessCookie, forwardSetCookies } from '../../../../src/lib/http/set-cookie'
   import { clientIpHeaders } from '../../../../src/lib/http/client-ip'
   ```
   Old:
   ```ts
         'Content-Type': 'application/json',
         ...(rtCookie ? { Cookie: `mnemra_rt=${rtCookie.value}` } : {}),
   ```
   New:
   ```ts
         'Content-Type': 'application/json',
         ...(rtCookie ? { Cookie: `mnemra_rt=${rtCookie.value}` } : {}),
         ...clientIpHeaders(request.headers),
   ```

6. `apps/web/app/api/auth/logout/route.ts`

   Old:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'

   const API_URL = process.env.API_URL || 'http://localhost:3001'
   ```
   New:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'
   import { clientIpHeaders } from '../../../../src/lib/http/client-ip'

   const API_URL = process.env.API_URL || 'http://localhost:3001'
   ```
   Old:
   ```ts
           Cookie: `mnemra_rt=${rtCookie.value}`,
         },
   ```
   New:
   ```ts
           Cookie: `mnemra_rt=${rtCookie.value}`,
           ...clientIpHeaders(request.headers),
         },
   ```

7. `apps/web/src/lib/http/auth-proxy.ts`

   Old:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'
   ```
   New:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'
   import { clientIpHeaders } from './client-ip'
   ```
   Old (`proxyJson`):
   ```ts
     const url = `${API_URL}${backendPath}${request.nextUrl.search}`
     const response = await fetch(url, {
       method: options.method,
       headers: {
         Authorization: `Bearer ${bearer}`,
         ...(options.body ? { 'Content-Type': 'application/json' } : {}),
       },
   ```
   New:
   ```ts
     const url = `${API_URL}${backendPath}${request.nextUrl.search}`
     const response = await fetch(url, {
       method: options.method,
       headers: {
         Authorization: `Bearer ${bearer}`,
         ...(options.body ? { 'Content-Type': 'application/json' } : {}),
         ...clientIpHeaders(request.headers),
       },
   ```
   Old (`proxyMultipart`):
   ```ts
       headers: {
         Authorization: `Bearer ${bearer}`,
       },
       body: form,
   ```
   New:
   ```ts
       headers: {
         Authorization: `Bearer ${bearer}`,
         ...clientIpHeaders(request.headers),
       },
       body: form,
   ```
   Old (`proxyRaw`):
   ```ts
     const response = await fetch(`${API_URL}${backendPath}${request.nextUrl.search}`, {
       method: options.method,
       headers: {
         Authorization: `Bearer ${bearer}`,
         ...(options.body ? { 'Content-Type': 'application/json' } : {}),
       },
   ```
   New:
   ```ts
     const response = await fetch(`${API_URL}${backendPath}${request.nextUrl.search}`, {
       method: options.method,
       headers: {
         Authorization: `Bearer ${bearer}`,
         ...(options.body ? { 'Content-Type': 'application/json' } : {}),
         ...clientIpHeaders(request.headers),
       },
   ```

8. `apps/web/app/api/workspaces/[id]/chat/route.ts`

   Old:
   ```ts
   import { getBearer } from '@/lib/http/auth-proxy'
   ```
   New:
   ```ts
   import { getBearer } from '@/lib/http/auth-proxy'
   import { clientIpHeaders } from '@/lib/http/client-ip'
   ```
   Old:
   ```ts
       headers: {
         Authorization: `Bearer ${bearer}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify(payload),
   ```
   New:
   ```ts
       headers: {
         Authorization: `Bearer ${bearer}`,
         'Content-Type': 'application/json',
         ...clientIpHeaders(request.headers),
       },
       body: JSON.stringify(payload),
   ```

   And `apps/web/middleware.ts`:

   Old:
   ```ts
   import { accessCookie } from './src/lib/http/set-cookie'
   ```
   New:
   ```ts
   import { accessCookie } from './src/lib/http/set-cookie'
   import { clientIpHeaders } from './src/lib/http/client-ip'
   ```
   Old:
   ```ts
   async function tryRefresh(
     rtValue: string,
   ): Promise<{ accessToken: string; rtSetCookie: string | null } | null> {
     try {
       const res = await fetch(`${API_URL}/auth/refresh`, {
         method: 'POST',
         headers: { Cookie: `mnemra_rt=${rtValue}` },
       })
   ```
   New:
   ```ts
   async function tryRefresh(
     rtValue: string,
     forwarded: Record<string, string>,
   ): Promise<{ accessToken: string; rtSetCookie: string | null } | null> {
     try {
       const res = await fetch(`${API_URL}/auth/refresh`, {
         method: 'POST',
         headers: { Cookie: `mnemra_rt=${rtValue}`, ...forwarded },
       })
   ```
   Old:
   ```ts
       const refreshed = await tryRefresh(rt.value)
   ```
   New:
   ```ts
       const refreshed = await tryRefresh(rt.value, clientIpHeaders(request.headers))
   ```

9. New file `apps/api/src/common/trust-proxy.spec.ts`:
   ```ts
   import { trustProxySetting } from './trust-proxy'

   describe('trustProxySetting', () => {
     const original = process.env.TRUST_PROXY

     afterEach(() => {
       if (original === undefined) delete process.env.TRUST_PROXY
       else process.env.TRUST_PROXY = original
     })

     it.each(['true', 'yes', '0', '-1', '1.5', 'loopback'])(
       'error: refuses %p - only a positive hop count is safe',
       (value) => {
         process.env.TRUST_PROXY = value
         expect(() => trustProxySetting()).toThrow('TRUST_PROXY must be a positive hop count')
       },
     )

     it('edge: is off when TRUST_PROXY is unset or empty', () => {
       delete process.env.TRUST_PROXY
       expect(trustProxySetting()).toBe(false)
       process.env.TRUST_PROXY = ''
       expect(trustProxySetting()).toBe(false)
     })

     it('happy: returns the hop count', () => {
       process.env.TRUST_PROXY = '1'
       expect(trustProxySetting()).toBe(1)
     })
   })
   ```

10. New file `apps/api/src/common/trust-proxy.ts` (reuse check: `throttle.ts` parses a different variable with a different failure mode — a bad limit falls back, while a bad trust setting must refuse to boot):
    ```ts
    /**
     * Express `trust proxy` for the API: how many hops in front of it may set
     * X-Forwarded-For. Off unless TRUST_PROXY is a positive hop count.
     *
     * In production the only hop is the web app's BFF, which forwards the one
     * address Caddy wrote (apps/web/src/lib/http/client-ip.ts). `true` - trust
     * every hop - would let any client pick its own address and walk around
     * every rate limit, so anything but a positive integer refuses to boot
     * rather than falling back.
     */
    export function trustProxySetting(): number | false {
      const raw = process.env.TRUST_PROXY
      if (raw === undefined || raw === '') return false
      if (/^[1-9]\d*$/.test(raw)) return Number(raw)
      throw new Error(`TRUST_PROXY must be a positive hop count (e.g. 1), got "${raw}"`)
    }
    ```

11. New file `apps/api/src/bootstrap.ts` (reuse check: the setup lived inline in `main.ts`, and e2e suites copy parts of it; one function lets the rate-limit e2e boot the app exactly as production does):
    ```ts
    import { ValidationPipe } from '@nestjs/common'
    import type { NestExpressApplication } from '@nestjs/platform-express'
    import cookieParser from 'cookie-parser'
    import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
    import { trustProxySetting } from './common/trust-proxy'

    /** Everything main.ts applies to the app, shared with the e2e suites that need production behaviour. */
    export function configureApp(app: NestExpressApplication): void {
      app.use(cookieParser())
      app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
      app.useGlobalFilters(new AllExceptionsFilter())
      app.enableCors({
        origin: process.env.WEB_URL || 'http://localhost:3000',
        credentials: true,
      })
      // req.ip - what the throttler keys on - becomes the visitor's address only
      // behind a trusted hop; see common/trust-proxy.ts.
      app.set('trust proxy', trustProxySetting())
    }
    ```
    `apps/api/src/main.ts`, full replacement:

    Old:
    ```ts
    import { NestFactory } from '@nestjs/core'
    import { ValidationPipe } from '@nestjs/common'
    import cookieParser from 'cookie-parser'
    import { AppModule } from './app.module'
    import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

    async function bootstrap() {
      const app = await NestFactory.create(AppModule)
      app.use(cookieParser())
      app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
      app.useGlobalFilters(new AllExceptionsFilter())
      app.enableCors({
        origin: process.env.WEB_URL || 'http://localhost:3000',
        credentials: true,
      })
    ```
    New:
    ```ts
    import { NestFactory } from '@nestjs/core'
    import type { NestExpressApplication } from '@nestjs/platform-express'
    import { AppModule } from './app.module'
    import { configureApp } from './bootstrap'

    async function bootstrap() {
      const app = await NestFactory.create<NestExpressApplication>(AppModule)
      configureApp(app)
    ```

12. `apps/api/test/auth-rate-limit.e2e-spec.ts`

    Old:
    ```ts
    import { INestApplication, ValidationPipe } from '@nestjs/common'
    import { Test } from '@nestjs/testing'
    import cookieParser from 'cookie-parser'
    import { eq, like } from 'drizzle-orm'
    import request from 'supertest'
    import { db, otps, pool, refreshTokens, users } from '@repo/db'
    import { AppModule } from '../src/app.module'
    ```
    New:
    ```ts
    import { INestApplication, ValidationPipe } from '@nestjs/common'
    import type { NestExpressApplication } from '@nestjs/platform-express'
    import { Test } from '@nestjs/testing'
    import cookieParser from 'cookie-parser'
    import { eq, like } from 'drizzle-orm'
    import request from 'supertest'
    import { db, otps, pool, refreshTokens, users } from '@repo/db'
    import { AppModule } from '../src/app.module'
    import { configureApp } from '../src/bootstrap'
    ```
    Old:
    ```ts
      it('throttles /auth/refresh with 429 after too many attempts', async () => {
        const statuses = await fireSequentially(app, 21, () => request(app.getHttpServer()).post('/auth/refresh'))

        expect(statuses).toContain(429)
      })
    })
    ```
    New:
    ```ts
      it('throttles /auth/refresh with 429 after too many attempts', async () => {
        const statuses = await fireSequentially(app, 21, () => request(app.getHttpServer()).post('/auth/refresh'))

        expect(statuses).toContain(429)
      })

      // TRUST_PROXY unset (this app): a client-sent X-Forwarded-For is ignored,
      // so rotating it cannot open a fresh bucket.
      it('error: without a trusted proxy a client cannot choose its own bucket', async () => {
        const email = `rate-limit-spoof-${Date.now()}@example.com`
        const statuses = await fireSequentially(app, 11, (i) =>
          request(app.getHttpServer())
            .post('/auth/login')
            .set('X-Forwarded-For', `198.51.100.${i + 1}`)
            .send({ email, password: 'wrong-password' }),
        )

        expect(statuses).toContain(429)
      })
    })

    // Production: the web app's BFF is the one trusted hop and forwards the
    // visitor's address (apps/web/src/lib/http/client-ip.ts). Booted through
    // configureApp, exactly as main.ts does, with its own throttler storage.
    describe('Auth rate limiting behind one trusted proxy (e2e)', () => {
      let app: NestExpressApplication
      const originalTrustProxy = process.env.TRUST_PROXY

      beforeAll(async () => {
        process.env.TRUST_PROXY = '1'
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
        app = moduleRef.createNestApplication<NestExpressApplication>()
        configureApp(app)
        await app.init()
      })

      afterAll(async () => {
        if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
        else process.env.TRUST_PROXY = originalTrustProxy
        await app.close()
      })

      it('error: the same visitor is still throttled after too many logins', async () => {
        const email = `rate-limit-visitor-a-${Date.now()}@example.com`
        const statuses = await fireSequentially(app, 11, () =>
          request(app.getHttpServer())
            .post('/auth/login')
            .set('X-Forwarded-For', '203.0.113.10')
            .send({ email, password: 'wrong-password' }),
        )

        expect(statuses).toContain(429)
      })

      it("happy: a second visitor is not throttled by the first visitor's attempts", async () => {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .set('X-Forwarded-For', '203.0.113.11')
          .send({ email: `rate-limit-visitor-b-${Date.now()}@example.com`, password: 'wrong-password' })

        expect(res.status).toBe(401)
      })
    })
    ```
    The first describe's `afterAll` ends the shared `pool`. Jest runs it as soon as that describe's tests finish, before the second describe starts, so the new describe's logins would hit a closed pool. The pool therefore moves to a file-level `afterAll`, which runs after both describes.

    Old (first describe's `afterAll`):
    ```ts
        await db.delete(users).where(like(users.email, 'rate-limit-%'))
        await app.close()
        await pool.end()
      })
    ```
    New:
    ```ts
        await db.delete(users).where(like(users.email, 'rate-limit-%'))
        await app.close()
      })
    ```
    And at the very end of the file, after the second describe's closing `})`, append:
    ```ts

    // One pool for the whole file: each describe closes its own app; the pool
    // ends only after both have run.
    afterAll(async () => {
      await pool.end()
    })
    ```

13. New file `apps/e2e/tests/rate-limit.spec.ts`:
    ```ts
    import { expect, test } from '@playwright/test'
    import { loadState, type SeedState } from '../support/state'

    // Per-visitor rate limiting through the real browser, BFF and API. Each
    // context sends its own X-Forwarded-For, standing in for the host Caddy,
    // which writes the visitor's address in production. The API runs with
    // TRUST_PROXY=1 (support/env.ts). Setup's own logins carry no header and so
    // count against 127.0.0.1, a separate bucket.

    let state: SeedState
    test.beforeAll(() => {
      state = loadState()
    })

    test('error: a visitor who keeps failing to sign in is stopped, while another visitor signs in', async ({ browser }) => {
      const attacker = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.10' } })
      const attackerPage = await attacker.newPage()
      await attackerPage.goto('/login')
      let lastStatus = 0
      for (let attempt = 0; attempt < 11; attempt++) {
        await attackerPage.locator('#email').fill(state.ownerA.email)
        await attackerPage.locator('#password').fill('not-the-password')
        const response = attackerPage.waitForResponse((r) => r.url().endsWith('/api/auth/login'))
        await attackerPage.getByRole('button', { name: 'Sign in' }).click()
        lastStatus = (await response).status()
      }
      expect(lastStatus).toBe(429)
      await attacker.close()

      const visitor = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.11' } })
      const visitorPage = await visitor.newPage()
      await visitorPage.goto('/login')
      await visitorPage.locator('#email').fill(state.ownerA.email)
      await visitorPage.locator('#password').fill(state.ownerA.password)
      await visitorPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(visitorPage).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/`))
      await visitor.close()
    })
    ```
    `apps/e2e/support/env.ts` (in `apiEnv`, after Phase 1 step 6):

    Old:
    ```ts
        THROTTLE_DEFAULT_LIMIT: '100000',
    ```
    New:
    ```ts
        THROTTLE_DEFAULT_LIMIT: '100000',
        // The BFF is this API's one trusted hop, as in production.
        TRUST_PROXY: '1',
    ```

14. `docker-compose.prod.yml` (api service)

    Old:
    ```yaml
          LANGSMITH_PROJECT: ${LANGSMITH_PROJECT:-optra-prod}
        networks:
          - internal
          - web
        healthcheck:
          test:
            ["CMD", "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:3001/health"]
    ```
    New:
    ```yaml
          LANGSMITH_PROJECT: ${LANGSMITH_PROJECT:-optra-prod}
          # One trusted hop: the web app's BFF, which forwards the visitor address
          # the host Caddy wrote. Never `true` - the API refuses to boot with it.
          TRUST_PROXY: "1"
        # `internal` only: the BFF (`web`) is the only thing that talks to the
        # API, so nothing else can present a forwarded address to it.
        networks:
          - internal
        healthcheck:
          test:
            ["CMD", "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:3001/health"]
    ```

Commit: `fix(auth): rate limits count each visitor, not the web server`. No skip trailer: the commit carries unit (web + api), API e2e and Playwright changes.

Done:
- `apps/web` and `apps/api` unit tests pass.
- API e2e `auth-rate-limit` passes (5 tests).
- `bun run e2e` passes including `rate-limit.spec.ts`.

#### Phase 5 — deploys refuse a production `.env` that cannot work (`opus`, high)

1. New file `scripts/check-prod-env.sh` (reuse check: `scripts/check-test-layers.sh` is the house shape for a POSIX guard plus self-test; nothing validates the VPS `.env` today):
   ```sh
   #!/bin/sh
   # Refuse a production .env that cannot work, before anything is built.
   #
   #   sh scripts/check-prod-env.sh [path-to-.env] [path-to-.env.example]
   #
   # Reads the file without sourcing it (values may hold shell metacharacters).
   # Prints every problem, never a value, and exits 1 if there is any.
   set -eu

   ENV_FILE="${1:-.env}"
   EXAMPLE_FILE="${2:-.env.example}"
   problems=0

   value_of() {
       grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
   }

   fail() {
       echo "  $1"
       problems=$((problems + 1))
   }

   if [ ! -f "$ENV_FILE" ]; then
       echo "check-prod-env: $ENV_FILE not found" >&2
       exit 1
   fi

   echo "check-prod-env: $ENV_FILE"

   domain="$(value_of DOMAIN "$ENV_FILE")"
   if ! printf '%s' "$domain" | grep -Eq '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'; then
       fail "DOMAIN must be the site's hostname, e.g. optra.tyvera.app (no scheme, at least one dot)"
   fi

   if ! value_of S3_ENDPOINT "$ENV_FILE" | grep -Eq '^https://'; then
       fail "S3_ENDPOINT must be an https:// endpoint"
   fi

   for key in POSTGRES_PASSWORD OPENAI_API_KEY JWT_SECRET; do
       actual="$(value_of "$key" "$ENV_FILE")"
       example="$(value_of "$key" "$EXAMPLE_FILE")"
       if [ -z "$actual" ]; then
           fail "$key is empty"
       elif [ -n "$example" ] && [ "$actual" = "$example" ]; then
           fail "$key is still the .env.example placeholder"
       fi
   done

   trust="$(value_of TRUST_PROXY "$ENV_FILE")"
   if [ -n "$trust" ] && ! printf '%s' "$trust" | grep -Eq '^[1-9][0-9]*$'; then
       fail "TRUST_PROXY, if set, must be a positive hop count"
   fi

   if [ "$problems" -gt 0 ]; then
       echo "check-prod-env: $problems problem(s) - nothing was built or restarted"
       exit 1
   fi
   echo "check-prod-env: ok"
   ```

2. New file `scripts/check-prod-env.spec.sh`:
   ```sh
   #!/bin/sh
   # Self-test for scripts/check-prod-env.sh.
   #
   #   sh scripts/check-prod-env.spec.sh
   set -eu

   GUARD="$(cd "$(dirname "$0")" && pwd)/check-prod-env.sh"
   WORK="$(mktemp -d)"
   trap 'rm -rf "$WORK"' EXIT

   printf 'JWT_SECRET=example-secret\nOPENAI_API_KEY=sk-example\n' > "$WORK/example"
   GOOD='DOMAIN=optra.tyvera.app
   S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
   POSTGRES_PASSWORD=real-password
   OPENAI_API_KEY=sk-real
   JWT_SECRET=real-secret'

   passed=0
   failed=0

   # case <name> <expected-exit> <env-file-content>
   case_() {
       printf '%s\n' "$3" > "$WORK/env"
       set +e
       sh "$GUARD" "$WORK/env" "$WORK/example" > "$WORK/out" 2>&1
       actual=$?
       set -e
       if [ "$actual" -eq "$2" ]; then passed=$((passed + 1)); echo "ok   $1"
       else failed=$((failed + 1)); echo "FAIL $1 (expected $2, got $actual)"; sed 's/^/     /' "$WORK/out"; fi
   }

   case_ 'error: a bare DOMAIN is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^DOMAIN=.*/DOMAIN=optra/')"
   case_ 'error: a DOMAIN with a scheme is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^DOMAIN=.*|DOMAIN=https://optra.tyvera.app|')"
   case_ 'error: an http S3 endpoint is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's|^S3_ENDPOINT=.*|S3_ENDPOINT=http://seaweedfs:8333|')"
   case_ 'error: a placeholder JWT secret is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^JWT_SECRET=.*/JWT_SECRET=example-secret/')"
   case_ 'error: an empty POSTGRES_PASSWORD is refused' 1 "$(printf '%s\n' "$GOOD" | sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=/')"
   case_ 'error: TRUST_PROXY=true is refused' 1 "$(printf '%s\nTRUST_PROXY=true' "$GOOD")"
   case_ 'edge: TRUST_PROXY unset is fine' 0 "$GOOD"
   case_ 'happy: a complete production .env passes' 0 "$(printf '%s\nTRUST_PROXY=1' "$GOOD")"

   echo ""
   echo "$passed passed, $failed failed"
   [ "$failed" -eq 0 ]
   ```

3. `.github/workflows/deploy.yml` (deploy script)

   Old:
   ```yaml
               git merge --ff-only origin/main
               echo "checked out $(git rev-parse --short HEAD)"
   ```
   New:
   ```yaml
               git merge --ff-only origin/main
               echo "checked out $(git rev-parse --short HEAD)"

               # Before the backup and before any build: a .env that cannot work
               # stops the deploy here, with nothing changed.
               sh scripts/check-prod-env.sh .env .env.example
   ```
   `.github/workflows/deploy.yml` (ci job)

   Old:
   ```yaml
           run: |
             sh scripts/check-test-layers.spec.sh
             sh scripts/check-test-layers.sh "$BASE_SHA" HEAD
   ```
   New:
   ```yaml
           run: |
             sh scripts/check-test-layers.spec.sh
             sh scripts/check-test-layers.sh "$BASE_SHA" HEAD
             sh scripts/check-prod-env.spec.sh
   ```

4. `DEPLOYMENT.md`

   Old:
   ```md
   Production does not publish the `api` or `web` ports on the host. The bundled Caddy service is opt-in via `COMPOSE_PROFILES=public`; leave it unset on a shared VPS where another service already owns ports `80`/`443`.
   ```
   New:
   ```md
   Production publishes `web` on `127.0.0.1:3300` only (for the host's Caddy) and never publishes `api`; the API sits on the `internal` network alone, reachable only from `web`. The bundled Caddy service is opt-in via `COMPOSE_PROFILES=public`; leave it unset on a shared VPS where another service already owns ports `80`/`443`.

   **Visitor addresses and rate limits.** The host Caddy writes each visitor's address into `X-Forwarded-For` (replacing anything the visitor sent); the web app forwards exactly that one value; the API trusts it from one hop because `docker-compose.prod.yml` sets `TRUST_PROXY: "1"`. Never set it to `true` (the API refuses to boot). If a CDN is ever put in front of the domain, configure `trusted_proxies` in Caddy for it, or every CDN edge becomes one shared bucket.

   **Deploys check `.env` first.** `scripts/check-prod-env.sh` runs before the backup and the build: `DOMAIN` must be the hostname (e.g. `optra.tyvera.app`), `S3_ENDPOINT` https, the secrets non-empty and not `.env.example` placeholders.
   ```

Commit: `feat(deploy): refuse to deploy with a production .env that cannot work`, with the trailer `Test-Layers-Skip: deploy tooling; proven by scripts/check-prod-env.spec.sh`.

Done: `sh scripts/check-prod-env.spec.sh` shows 8 passed; `shellcheck scripts/check-prod-env.sh scripts/check-prod-env.spec.sh` is clean.

#### Phase 6 — docs and learning sync (`opus`, high)

1. `docs/ai/risk-register.md`: replace the whole row that starts `| Site-Wide Rate Limit Behind The BFF |` with:
   ```md
   | Forwarded Visitor Address (Rate Limits) | Per-visitor limits depend on a chain of custody: host Caddy (v2.11.3, no `trusted_proxies`) replaces any client-sent `X-Forwarded-For` with the peer address; Next never appends to it; `apps/web/src/lib/http/client-ip.ts` forwards only the rightmost value and only if it is an IP; the API trusts one hop (`TRUST_PROXY: "1"`, `apps/api/src/common/trust-proxy.ts`, which refuses `true`) and sits on the `internal` network only. Break any link - `trust proxy: true`, the API on a shared network, a CDN without `trusted_proxies` - and limits are either bypassable or shared again. | Deep | Any new server-side fetch from `apps/web` to the API spreads `clientIpHeaders(request.headers)`; any ingress change re-checks Caddy's XFF handling | `auth-rate-limit.e2e-spec.ts` (both modes) and `apps/e2e/tests/rate-limit.spec.ts` | Fixed 2026-09-26; was "Site-Wide Rate Limit Behind The BFF" (open since 2026-09-25). |
   ```
   Then, directly after the row that starts `| Test-Layer Requirement (Canonical Workflow) |`, insert:
   ```md
   | Timestamps Without Time Zone | All 86 timestamp columns are `timestamp` without zone; Postgres runs in UTC. A Node process in another zone reads freshly written rows as hours old, and the stale-job sweeps (ingest, scrape, tickets, catalogs, procurement) then act on live rows. Production, CI and tests run in UTC (`TZ=UTC` in `apps/api` `dev`, Jest global setup, e2e setup, Playwright API env). | Deep | Keep every runtime in UTC; converting to `timestamptz` is its own migration slice | — | Deferred 2026-09-26. Condition: do the migration before any non-UTC host runs the API. |
   | Unindexed Foreign-Key Columns | Several child FK columns have no index (e.g. `workspace_members.workspace_id`, `discrepancy_flags.po_line_item_id`, `comparison_runs.invoice_id`, `chunks.document_id`), so deleting a parent scans the child. Harmless at today's size and with no workspace-delete route. | Standard | Add indexes in a migration slice before a workspace/account delete route ships | — | Deferred 2026-09-26. |
   | Reconciler Ownership | Each stale-job sweeper must select only the rows its own queue owns. `CatalogParseService.reconcile` selected scrape catalogs too and pushed them into the parse queue; it now filters `sourceKind = 'upload'`, matching `CatalogScrapeService.reconcile`'s `'scrape'`. Specs exercising a sweep answer `getJob` by job id, never with a once-queue - a sweep reads rows it does not own. | Deep | New reconciler: filter to owned rows; new spec: keyed `getJob` mocks | — | Added 2026-09-26. |
   ```

2. `docs/ai/testing-strategy.md`

   Old:
   ```md
   - `bun run test` — Jest unit tests (`apps/api/src/**/*.spec.ts`)
   ```
   New:
   ```md
   - `bun run test` — Jest unit tests (`apps/api/src/**/*.spec.ts`). Since 2026-09-26 they run on their own database, `optra_unit`, recreated from the migrations by Jest's `globalSetup` (`apps/api/test/unit-global-setup.ts`, via `apps/e2e/scripts/prepare-db.ts`) and in `TZ=UTC`; they never touch the dev database `optra`. Base connection from `DATABASE_URL`, overridable with `UNIT_DATABASE_URL`. No per-suite cleanup is needed.
   ```

3. `CLAUDE.md`

   Old:
   ```md
   - `apps/api`: `bun run test` (jest), `bun run test:watch`, `bun run test:cov`, `bun run test:e2e` (15 e2e suites in `apps/api/test/`; run on a fresh database: `bun apps/e2e/scripts/prepare-db.ts optra_e2e`, then `DATABASE_URL=…/optra_e2e bun run test:e2e`)
   ```
   New:
   ```md
   - `apps/api`: `bun run test` (jest; runs on its own `optra_unit` database recreated each run, in UTC — never the dev DB), `bun run test:watch`, `bun run test:cov`, `bun run test:e2e` (15 e2e suites in `apps/api/test/`; run on a fresh database: `bun apps/e2e/scripts/prepare-db.ts optra_e2e`, then `DATABASE_URL=…/optra_e2e bun run test:e2e`)
   ```

4. `docs/ai/file-index/repository-map.md`: directly after the row that starts `| \`scripts/check-test-layers.sh\` + \`.spec.sh\` |`, insert:
   ```md
   | `scripts/check-prod-env.sh` + `.spec.sh` | Deploy guard: refuses a production `.env` whose DOMAIN is not a hostname, whose S3 endpoint is not https, whose secrets are empty or placeholders, or whose TRUST_PROXY is not a hop count; prints problems, never values | CI / Deployment | Standard | Added 2026-09-26. Runs in the deploy script before backup/build; self-test in the ci job. |
   | `apps/web/src/lib/http/client-ip.ts` | `clientIpHeaders(headers)` — the rightmost `X-Forwarded-For` entry, forwarded only if it is an IP; spread into every server-side fetch to the API | Limits / BFF | Deep | Added 2026-09-26. Regex, not `node:net` (middleware runs on the edge runtime). |
   | `apps/api/src/bootstrap.ts` + `common/trust-proxy.ts` | `configureApp(app)` (cookie parser, validation, exception filter, CORS, trust proxy) used by `main.ts` and the rate-limit e2e; `trustProxySetting()` accepts only a positive hop count and refuses `true` | Limits / API | Deep | Added 2026-09-26. |
   | `apps/api/test/unit-global-setup.ts` | Jest unit `globalSetup`: recreates `optra_unit` via `prepare-db.ts`, sets `DATABASE_URL` and `TZ=UTC` before workers start | Test infrastructure | Standard | Added 2026-09-26. |
   ```

5. `learnings.md`: append:
   ```md

   ## 2026-09-26 — A test that queues answers for "whoever asks first"
   *Learning Contract: the plan's design is the prediction; the diff is below. No live prediction solicited.*

   **Predicted (from the approved plan):** the two flaky suites shared one cause - a dev database full of other people's rows - and a fresh database per run would end both.

   **Actual:** to be filled at handoff with what the soak showed.

   **Why different:** to be filled at handoff.
   ```
   At handoff, the two "to be filled" lines are replaced with the observed result. This is the one step whose text depends on execution output, which is why it is last.

Commit: `docs: close the reliability risks before production`.

Done: the docs diff contains only the blocks above.

#### Phase 7 — soak, production fix, deploy (`opus`, high)

1. **Soak.** Run five times in a row, stopping at the first failure. A failure stops the plan and is reported with its output.
   ```bash
   for i in 1 2 3 4 5; do
     (cd apps/api && bun run test) && \
     bun apps/e2e/scripts/prepare-db.ts optra_e2e && \
     (cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/optra_e2e bun run test:e2e) && \
     (cd apps/web && bun run test) && \
     bun run e2e || { echo "soak failed on run $i"; break; }
   done
   ```
   - **Stop rule for C2:** if any suite reports "Exceeded timeout … for a hook", stop and re-plan.
   - **Stop rule for C1:** if `ingest.service.spec.ts` fails, C1 was wrong; stop.
   - Then push the branch, and re-run the branch's CI twice with `gh run rerun <id>`; all three runs must be green.
2. **Fix production DOMAIN** (SSH write — ask for approval at this step):
   ```bash
   ssh -o IdentitiesOnly=yes -i ~/.ssh/id_owlrepo deploy@5.223.64.177 'cd /home/deploy/apps/optra && cp .env .env.bak-$(date -u +%Y%m%d%H%M%S) && sed -i "s/^DOMAIN=optra$/DOMAIN=optra.tyvera.app/" .env && grep -c "^DOMAIN=optra.tyvera.app$" .env'
   ```
   The last command prints `1`. The branch's `scripts/check-prod-env.sh` can't run on the VPS until it is merged, so the deploy's own run of it is the check.
3. **Open the PR** (ask for approval): `gh pr create --base main --head test/storage-e2e-playwright`, with the PR body summarising the storage work plus this plan. After CI is green, merge with "Create a merge commit" (ask for approval), which deploys.
4. **After the deploy:**
   - `curl -s https://optra.tyvera.app/sitemap.xml | grep -c 'https://optra.tyvera.app'` is ≥1.
   - Read-only: `docker compose -f docker-compose.prod.yml exec -T api printenv TRUST_PROXY` prints `1`.
   - `docker inspect optra-prod-api --format '{{json .NetworkSettings.Networks}}'` lists only `optra-prod_internal`.
5. **Prove C4 (ask for approval — it spends one login bucket on production):**
   - Send 11 wrong-password logins with a forged header:
     `for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://optra.tyvera.app/api/auth/login -H 'Content-Type: application/json' -H "X-Forwarded-For: 198.51.100.$i" -d '{"email":"c4-probe@example.invalid","password":"x"}'; done | tail -1`
     Expect `429`: Caddy discarded the forged values, so all 11 landed in the sender's real bucket.
   - A `401` instead disproves C4. Stop, and set `trusted_proxies`/`header_up` in the host Caddyfile under a separate approval.
6. **You run the production smoke:** `docs/ops/prod-smoke.md`.
7. **Graphify gate:** load the graphify skill and run `/graphify . --update` from the repo root after the final edit. Report the graph diff and token counts.

### Amendment 1 (approved 2026-09-26, during Phase 7 step 1)

CI run 2 of 3 failed: `procurement-parse.processor.spec.ts` › "parses a 7,000-row CSV (inserts are chunked under the bind-parameter limit)" exceeded Jest's 5 s default. Measured: 1.5 s alone (n=3, warm local DB), 2.9 s in a full parallel local run (slowest of 678, 2.4× the next), >5 s on the 4-vCPU CI runner. It is a deterministic volume test, not a race; 7,000 rows is what crosses the Postgres bind-parameter limit, so it cannot shrink. Owner decision: an explicit per-test timeout on that one test only.

`apps/api/src/procurement/procurement-parse.processor.spec.ts`

Old:
```ts
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(7000)
  })
```
New:
```ts
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(7000)
    // A volume test, not a unit test: 7,000 rows is what crosses the bind-
    // parameter limit, so it cannot shrink. 1.5 s alone, ~3 s under a full
    // local run, over the 5 s default on the CI runner. Its own budget only.
  }, 30_000)
```
The three-run CI check restarts on the commit carrying this change.

### Amendment 2 (approved 2026-09-25, pre-PR /review, owner answers D1/D2/D4)

The pre-merge `/review` (Claude specialists + adversarial pass; Codex retired) found test gaps and latent production footguns. None is live today: the production `.env` has no `PORT`, `THROTTLE_*`, `TRUST_PROXY` or duplicate keys (checked read-only). Owner decisions: D1 fix now, D2 fix now, D3 per-account auth limits get their own Deep plan after this deploy (logged open in the risk register), D4 fix the orphan comment and log the rest.

Allowed files (the diff of the Amendment 2 commits is the literal record):

| File | Change | Decision |
|---|---|---|
| `apps/api/src/datasets/datasets.service.spec.ts`, `apps/api/src/documents/documents.service.spec.ts` | Cleanup tests stub `storage.delete`, assert the insert's own error (`/too long/`) instead of any error; new `error:` case - cleanup itself fails, insert error still surfaces | D1 |
| `apps/api/src/catalog/catalog-documents.service.spec.ts` | Same assertion tightened to `/too long/` | D1 |
| `apps/web/middleware.spec.ts` | `happy:` silent refresh forwards `X-Forwarded-For`; `edge:` non-IP forwards nothing | D1 |
| `apps/web/src/lib/http/auth-proxy.spec.ts` | `it.each` over `proxyJson`/`proxyRaw`/`proxyMultipart`: forwards the address; forwards none when absent | D1 |
| `apps/web/app/api/auth/register/route.spec.ts`, `.../verify-otp/route.spec.ts` | `happy:` forwards the visitor address (IPv4 / IPv6) | D1 |
| `apps/api/test/auth-rate-limit.e2e-spec.ts` | Untrusted describe boots through `configureApp` with `TRUST_PROXY` deleted, so the spoofing test proves the production bootstrap | D1 |
| `apps/api/src/storage/storage.service.ts` + `.spec.ts` | `isMissingObjectError`: only `NoSuchKey`/`NotFound`; a bare 404 stays a configuration fault (500, retryable). RED first: bare-404 case moved to "leaves untouched" | D2 |
| `scripts/check-prod-env.sh` + `.spec.sh` | Last assignment wins, surrounding quotes stripped, commented `.env.example` placeholders count, `THROTTLE_DEFAULT_LIMIT` refused; `TRUST_PROXY` check dropped (compose pins it). 11 cases | D2 |
| `docker-compose.prod.yml` | api `environment:` pins `PORT: "3001"` | D2 |
| `apps/api/src/catalog/catalog-documents.service.ts` | Orphan comment moved onto the `SERVABLE_PHOTO_TYPES` check | D4 |
| `DEPLOYMENT.md`, `docs/ai/file-index/repository-map.md`, `docs/ai/risk-register.md` | Describe the stricter check; add "Per-Account Auth Limits" (open, Deep) and "Deferred Review Items (2026-09-25)" rows | D3/D4 |

Validation: touched unit suites; `sh scripts/check-prod-env.spec.sh` (11 passed); `shellcheck`; the live prod `.env` still passes the stricter check (read-only); API e2e `auth-rate-limit`; then CI green once on the new head before the PR.

### Validation and acceptance

**Test Matrix**

| Layer | Required | File | Cases (in order) |
|---|---|---|---|
| Unit (api) | required | `src/common/trust-proxy.spec.ts` | error: refuses `true`/`yes`/`0`/`-1`/`1.5`/`loopback`; edge: unset or empty is off; happy: returns the hop count |
| Unit (api) | required | `src/catalog/catalog-parse.service.spec.ts` | regression: reconcile leaves a stale scraped catalog to the scrape reconciler |
| Unit (api) | required (test fix) | `src/ingest/ingest.service.spec.ts`, `src/scrape/scrape.service.spec.ts` | existing reconcile tests, keyed mocks |
| Unit (web) | required | `src/lib/http/client-ip.spec.ts` | error: non-IP forwards nothing; edge: absent/empty forwards nothing; edge: rightmost entry; happy: IPv4; happy: IPv6 |
| Unit (web) | required | `app/api/auth/login/route.spec.ts` | edge: no XFF sends none; happy: forwards the visitor address |
| API e2e | required | `test/auth-rate-limit.e2e-spec.ts` | error: untrusted app ignores rotating XFF; error: same visitor throttled; happy: second visitor not throttled |
| Browser e2e | required | `apps/e2e/tests/rate-limit.spec.ts` | error: failing visitor gets 429 while another visitor signs in |
| Deploy guard | required | `scripts/check-prod-env.spec.sh` | 6 error, 1 edge, 1 happy (Phase 5 step 2) |
| Browser e2e | not required for Phases 1–3 | — | test infrastructure and a reconciler with no UI trigger (skip trailers state it) |

**Acceptance map**

| Criterion | File | Symbol | Step | Validation |
|---|---|---|---|---|
| Unit tests never touch `optra` | `apps/api/test/unit-global-setup.ts` | `unitGlobalSetup` | 1.2–1.3 | Row count in `optra` unchanged across a run |
| No hook timeout | `comparison.service.spec.ts` | `afterAll` | 1.4 | 5-run soak + 3 CI runs |
| Reconcile tests order-independent | ingest/scrape specs | reconcile tests | 2.1–2.2 | Soak |
| Scrape catalogs not re-queued into parse | `catalog-parse.service.ts` | `reconcile` | 3.2 | Regression test |
| Each visitor has its own limit | `client-ip.ts`, `bootstrap.ts`, compose | `clientIpHeaders`, `configureApp` | 4.1–4.14 | API e2e + Playwright + C4 probe |
| A spoofed header cannot open a bucket | `trust-proxy.ts`, compose networks | `trustProxySetting` | 4.10, 4.14 | API e2e "error: without a trusted proxy…" + C4 probe |
| A broken `.env` cannot deploy | `check-prod-env.sh`, `deploy.yml` | — | 5.1–5.3 | Self-test; deploy step |
| Invite links use the real host | VPS `.env` | `DOMAIN` | 7.2 | sitemap check (7.4) |

**Edge and error cases found, and where they are handled**
- An invalid or absent XFF: `clientIpHeaders` returns `{}` (`client-ip.ts`).
- A spoofed chain: the rightmost entry is taken (`client-ip.ts`); Caddy replaces client XFF (C4 probe).
- `TRUST_PROXY=true`: `trustProxySetting` throws at boot.
- A direct peer sending XFF with trust off: ignored (Express default; API e2e).
- Middleware on the edge runtime: regex validation (`client-ip.ts`).
- A scrape catalog stale for >threshold: skipped by the parse sweep (`catalog-parse.service.ts reconcile`); still failed by the scrape sweep (`catalog-scrape.service.ts:85-90`).
- `optra_unit` cannot be created: `unitGlobalSetup` throws with the exit code.
- A bad prod `.env`: the deploy halts before backup/build (`deploy.yml`).

**Seed / fixtures:** Phase 4 Playwright uses the seeded owner A (`tests/auth.setup.ts`). No new fixtures.

**Run** (real scripts):
- `bun run type-check`, `bun run lint`
- `cd apps/api && bun run test`
- `bun apps/e2e/scripts/prepare-db.ts optra_e2e && cd apps/api && DATABASE_URL=…/optra_e2e bun run test:e2e`
- `cd apps/web && bun run test`
- `bun run e2e`
- `sh scripts/check-test-layers.spec.sh`, `sh scripts/check-prod-env.spec.sh`, `shellcheck scripts/*.sh`
- `docker compose -f docker-compose.prod.yml config -q` (with `DOMAIN`, `POSTGRES_PASSWORD`, `OPENAI_API_KEY`, `S3_ENDPOINT` set)
- `docker compose -f docker-compose.prod.yml build api web`
- Graphify gate (Phase 7 step 7).

### Compatibility, docs and scans

- Behaviour preserved:
  - With `TRUST_PROXY` unset, the API behaves exactly as today. The existing `auth-rate-limit` tests stay unchanged and green.
  - Route specs that send no XFF see identical fetch headers (Phase 4 step 3, "edge" test).
  - `main.ts` applies the same cookie parser, pipes, filter, CORS and port.
- No migration.
- Docs updated in Phase 6: risk register, testing strategy, CLAUDE.md, repository map, learnings.
- Optimisation scan: removing the comparison cleanup cuts up to ~2,400 sequential queries per unit run. Nothing else is worth it here.
- Cache scan: not applicable.
- Database and LLM cost impact: none in production. Tests gain one `CREATE DATABASE` plus migrations per unit run (the same cost the e2e layers already pay).
- UI states: the login page's existing error banner shows the 429 message. No new UI.
