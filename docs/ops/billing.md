# Billing runbook (Lemon Squeezy)

Lemon Squeezy (LS) is the Merchant of Record: it takes payment, tax and sends invoices.
Optra stores only what the webhook tells it (plan, status, dates, seats) and meters usage
itself. Design: `docs/plans/lemon-squeezy-billing-program.md`. Code: `apps/api/src/billing/`.

Run every SQL line on the VPS from `/home/deploy/apps/optra`:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "<SQL>"'
```

`billing_events.payload` holds the payer's name and email. Do not paste it into tickets or chat.

## 1. Facts to keep straight

| Thing | Value |
|---|---|
| LS store | `Tyvera`, id `394926`. The store is SHARED with another app of the owner |
| Webhook URL | `https://optra.tyvera.app/api/webhooks/lemonsqueezy` (Next.js BFF route; prod Caddy reaches only `web:3000`; the BFF forwards the raw bytes to the API) |
| Webhook events | `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused` (exactly the set in `SUBSCRIPTION_EVENTS`, `billing-webhook.service.ts`; any other event is acknowledged and ignored) |
| Test vs live mode | Separate: API key, products and variant ids, and the webhook entry. Confirm in the dashboard whether the store id is the same in both modes (it should be) |
| Env (VPS `/home/deploy/apps/optra/.env`) | `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID` (numeric), `LEMONSQUEEZY_WEBHOOK_SECRET` (6-40 chars), `LEMONSQUEEZY_VARIANT_SOLO`, `LEMONSQUEEZY_VARIANT_TEAM` (numeric, different), `BILLING_ENFORCEMENT` (`on` or `off`), `OPENAI_PROCUREMENT_EXTRACTION_MODEL` (`gpt-4o`). Optional: `BILLING_AI_CAP_{TRIAL,SOLO,EXEMPT}_USD`, `BILLING_AI_CAP_TEAM_SEAT_USD`. `LEMONSQUEEZY_API_URL` only for tests |
| Guard | `sh scripts/check-prod-env.sh .env .env.example` (prints keys, never values). The deploy runs it before the backup |
| Plans | Solo $29/mo: 400 matched lines + 100 photo checks. Team $69 per buyer/mo: 2,000 + 300 per buyer, pooled. Trial: 14 days, first workspace, Solo allowance. No overage: work stops at the cap. Numbers: `apps/api/src/billing/plans.ts` |

## 2. Set up Lemon Squeezy (test mode first)

1. Dashboard, Test mode on. Products: **Optra Solo** ($29, monthly, no LS trial) and **Optra Team** ($69, monthly, quantity allowed). Note each variant id.
2. Settings, API: create an API key for the mode you are in. Put it in `.env` as `LEMONSQUEEZY_API_KEY`. Never paste it anywhere else.
3. Settings, Webhooks, add: the URL above, a signing secret you invent (6-40 characters), the seven events above. Put the same secret in `.env` as `LEMONSQUEEZY_WEBHOOK_SECRET`.
4. Set `LEMONSQUEEZY_STORE_ID=394926`, `LEMONSQUEEZY_VARIANT_SOLO`, `LEMONSQUEEZY_VARIANT_TEAM`.
5. `sh scripts/check-prod-env.sh .env .env.example` must print `check-prod-env: ok`.
6. Recreate the api (section 5, same command) so it reads the new `.env`.
7. Round trip in test mode with `BILLING_ENFORCEMENT=off`: Billing page, Subscribe, pay with the LS test card, return to the app. The page shows Active within seconds. If not, section 6.

The other app on this store has its own webhook entry and its own secret. Never reuse its URL or secret for Optra.
LS also sends our endpoint the subscription events of that other app. They carry no Optra `workspace_sig` and a variant that is not ours, so Optra answers 200 and records them as processed with `last_error` "foreign event: not an Optra subscription ..." (no retry, nothing changes in Optra). Count them with section 7, query 2.

## 3. Go live (separate owner step, in this order)

0. Before merging the PR that adds the guard: run `sh scripts/check-prod-env.sh .env .env.example` on the VPS. Fix anything it names.
1. Merge and deploy the PR. `BILLING_ENFORCEMENT` stays `off`.
2. Exempt every existing workspace (section 4). A workspace that predates billing has no trial and no subscription; it is paywalled the moment enforcement is on.
3. In LS: for each product use "Copy to Live Mode". Live mode has its own variant ids and its own API key: create a live API key, create the live webhook entry (URL, seven events, a new secret).
4. Edit `.env`: live API key, live webhook secret, live variant ids; confirm `LEMONSQUEEZY_STORE_ID`. Run the guard. Set `BILLING_ENFORCEMENT=on`. Recreate the api (section 5).
5. Only now take a real payment (a small live purchase you refund yourself). The landing page promises a hard cap; do not let a live customer pay while enforcement is `off`.
6. Check section 7 queries, the Billing page of the test workspace, and `/canary`.

## 4. Exempt workspaces (free, unlimited lines and photos, $25 AI runaway guard)

List workspaces:

```sql
SELECT w.id, w.name, u.email AS owner, w.billing_exempt, w.trial_ends_at, w.created_at
FROM workspaces w JOIN users u ON u.id = w.owner_id ORDER BY w.created_at;
```

Exempt one:

```sql
UPDATE workspaces SET billing_exempt = true WHERE id = '<workspace id>';
```

Undo: the same with `false`. Which workspaces to exempt is the owner's call; every one that predates the flip and should keep working free needs the line above. Check one on its Billing page: it shows the exempt note and no meters.

## 5. Switch enforcement on or off

Edit `BILLING_ENFORCEMENT=on` (or `off`) in `.env`, run the guard, then:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

`docker compose restart` does NOT re-read `.env`; only recreating the container does.
`off` records usage and refuses nothing (the Redis token limit still applies). `on` refuses with 402 `SUBSCRIPTION_REQUIRED`, `QUOTA_EXCEEDED` or `AI_BUDGET_EXCEEDED`. Reads and exports stay open either way.

## 6. A webhook failed: replay it

Find failures (section 7, query 1). If `processed_at` is NULL, fix the cause, then in LS: Settings, Webhooks, Recent deliveries, Resend. It works because a delivery that could not be processed is answered non-2xx and its `billing_events` row keeps `processed_at` NULL, so the resend is processed again (an already-processed body is a no-op).

| Symptom (`last_error` or HTTP answer) | Cause | Fix |
|---|---|---|
| HTTP 503, no row | `LEMONSQUEEZY_WEBHOOK_SECRET` missing in the api | set it, recreate the api, Resend |
| 500, `LEMONSQUEEZY_STORE_ID is not configured` | store id missing | set it, recreate, Resend |
| 500, `unknown variant` for an Optra product | variant env wrong or from the other mode | fix `LEMONSQUEEZY_VARIANT_*`, recreate, Resend |
| 200, `foreign event` | the other app's event (section 2) | ignore |
| 401 Invalid signature | webhook secret in LS differs from `.env` | make them equal, Resend |
| `workspace binding signature missing or invalid`, `processed_at` set | the secret was changed between opening and paying a checkout, or custom data was edited | the Resend cannot succeed. Repair by hand: confirm the customer in LS, then insert the subscription via a fresh checkout or ask them to Subscribe again |
| `unknown workspace` / `store_id mismatch` | wrong store or deleted workspace | none; acknowledged by design |

Do not rotate `LEMONSQUEEZY_WEBHOOK_SECRET` while a checkout may be open: it is also the key of the per-workspace binding. After any rotation run query 1 for `workspace binding%` errors.

## 7. Read the books

1. Recent webhook deliveries, failures first:
```sql
SELECT id, event_name, received_at, processed_at, left(last_error, 120) AS last_error
FROM billing_events ORDER BY (processed_at IS NULL) DESC, received_at DESC LIMIT 20;
```
2. How many of the other app's events were ignored:
```sql
SELECT count(*) FROM billing_events WHERE last_error LIKE 'foreign event%';
```
3. One workspace's subscription:
```sql
SELECT plan, status, seats, renews_at, ends_at, ls_updated_at
FROM workspace_subscriptions WHERE workspace_id = '<workspace id>';
```
4. This month's usage for a workspace (kinds: `matched_line`, `photo_check`, `llm_cost` where quantity is micro-USD):
```sql
SELECT kind, sum(quantity) AS quantity, round(sum(quantity)::numeric / 1000000, 4) AS usd_if_llm_cost
FROM usage_events
WHERE workspace_id = '<workspace id>' AND occurred_at >= date_trunc('month', timezone('utc', now()))
GROUP BY kind;
```
`usage_events.occurred_at` is written in UTC by the app. The trial window is not the calendar month; the Billing page shows the real window.

## 8. Roll back

| Problem | Do |
|---|---|
| Customers refused who should not be | `BILLING_ENFORCEMENT=off` in `.env`, recreate the api (section 5). Takes effect for the next request. Migrations stay; they are additive |
| One workspace wrongly paywalled | exempt it (section 4), or fix its subscription row via a LS Resend |
| Bad copy or legal text | revert the PR; the pages are static |
| Back to test mode | restore the test key, secret and variant ids in `.env`, run the guard, recreate the api |

Deletion requests: `billing_events` has no workspace column and keeps the payer's name and email inside `payload`; a workspace deletion must also remove the rows for that customer (`docs/ai/risk-register.md` "Legal Pages Accuracy").
