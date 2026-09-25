# Production smoke test

Proves the storage paths on the **live site**, through the real UI, against the real
object store (Backblaze B2). CI cannot: it runs everything against local SeaweedFS.
Run it by hand after a deploy, or whenever storage configuration changes (a key
rotation, a bucket move).

It is a separate Playwright config (`apps/e2e/playwright.prod.config.ts`, `testDir
./smoke`), so the local suite can never run it and it can never run the local suite.
It refuses to start unless `SMOKE_BASE_URL` is an `https://` address.

## What it checks

| Test | Proves |
|---|---|
| wrong file type | refused with the reason, nothing stored |
| knowledge-base document | upload → ingest → download byte-for-byte, `application/octet-stream` + `nosniff` through Caddy and the BFF → delete → download is a 404 |
| dataset | upload → profiled → delete |
| purchase order | CSV upload → parsed → Source download byte-for-byte |
| catalog photo | served from B2 as a raster image with `nosniff` — **only if** `SMOKE_CATALOG_ITEM_ID` is set |
| no session | every stored-file route is a 401 |

Knowledge-base ingest and dataset profiling call OpenAI for real here: a few hundred
tokens per run, charged to the smoke account's workspace budget.

## One-time setup

1. **A dedicated account.** Register it through the site as any user would
   (`/register`) and verify it with the emailed code. Use it for nothing else:
   the smoke run creates and deletes files in its workspace.
2. **Optional — a catalog photo to read back.** Upload a small PDF catalog to any
   vendor in that workspace, open *View items*, and copy one item's id from the
   photo's URL (`/api/workspaces/<ws>/catalog-items/<itemId>/photo`). Without it the
   photo test is skipped, not failed — a PDF catalog per run would cost model tokens
   for no extra evidence.

Keep the credentials in your password manager. They are passed as environment
variables for one command and never written to a file.

## Run

```bash
cd apps/e2e
SMOKE_BASE_URL=https://<your-domain> \
SMOKE_EMAIL=<smoke account email> \
SMOKE_PASSWORD=<smoke account password> \
SMOKE_CATALOG_ITEM_ID=<optional item id> \
bun run test:smoke
```

It signs in **once** (the login limit is shared by the whole site — see
`docs/ai/risk-register.md`), uses one worker and never retries: a smoke failure is a
signal to look at, not to retry into a pass. The report lands in
`apps/e2e/playwright-report-smoke/`, with a trace for anything that failed.

## What a run leaves behind

Everything it creates it deletes, **except one purchase order per run** named
`smoke-<run>.csv`: the product has no delete for procurement documents. It is a
two-line CSV. To clear them out now and then, on the server:

```sql
-- the smoke account's workspace only
delete from po_line_items where purchase_order_id in (
  select id from purchase_orders
   where workspace_id = '<smoke workspace id>' and name like 'smoke-%.csv');
delete from purchase_orders
 where workspace_id = '<smoke workspace id>' and name like 'smoke-%.csv';
```

Their objects sit under `<smoke workspace id>/procurement/purchase_order/` in
`optra-prod-objects`; deleting those in the B2 console is optional (a few bytes each).
A comparison run that references one of those purchase orders will block the delete —
the smoke test never runs comparisons, so none should.
