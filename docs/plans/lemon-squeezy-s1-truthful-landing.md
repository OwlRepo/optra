# S1 — Truthful landing + legal pages (Lemon Squeezy readiness)

Parent plan: `~/.claude/plans/reply-1-zippy-tulip.md` (approved 2026-10-02).
Branch: `feat/no-ticket-legal-truthful-landing` from `origin/main`. Size: Standard. Web only.

## Facts this slice relies on (verified)

| Fact | Evidence |
|---|---|
| Uploads accept only `.csv`, `.xlsx`, `.pdf` (PO, invoice, GRN, catalog) | `apps/api/src/procurement/procurement.controller.ts:48`, `apps/api/src/catalog/catalog.controller.ts:42` |
| Scanned / image-only PDFs are read through the vision path | `packages/ai/src/chains/procurement-extraction.ts:132-151` |
| Decision outcomes: `false_positive`, `approved_exception`, `vendor_dispute`, `resolved` (4), recorded by a person | `packages/db/src/schema/discrepancyDecisions.ts:12` |
| No workspace / account delete endpoint exists | grep of `apps/api/src/workspaces`, `apps/api/src/auth` |
| OpenAI receives document text, rasterised PDF pages, catalog photos | `procurement-extraction.ts`, `catalog-match.ts:90,233` |
| OpenAI API: not used for training by default; abuse-monitoring logs kept up to 30 days; `/v1/chat/completions` keeps no application state | https://developers.openai.com/api/docs/guides/your-data (fetched 2026-10-02) |
| Cookies: `mnemra_at` (HttpOnly, 15 min), `mnemra_rt` (HttpOnly, 7 days); no ad/tracking cookies; Umami self-hosted | `apps/web/src/lib/http/set-cookie.ts:3-19`, `apps/api/src/auth/auth.controller.ts:24-25,122-127`, `apps/web/app/umami-script.ts` |
| Stored personal data: email, bcrypt password hash, OTP (10 min expiry), refresh-token sha256 hash, IP for rate limiting | `packages/db/src/schema/users.ts`, `otps.ts`, `auth.service.ts:21,57,306` |
| Processors: OpenAI, Resend (email/OTP), Backblaze B2 (files + backups), Hetzner (VPS) | `.env.example`, `DEPLOYMENT.md`, `docker-compose.prod.yml` |
| VPS keeps the 7 newest DB dumps | `scripts/backup.sh:226-234` |
| Fonts self-served (no Google request at runtime) | `apps/web/app/layout.tsx:2` (`next/font/google`) |

Owner preflight confirmed 2026-10-02: hosting country Singapore, B2 backup retention 30 days. LangSmith tracing in prod stays `null` (unverified).

## Single source of truth

New `apps/web/src/lib/legal-facts.ts` exports every business fact the pages use, so footer, legal pages, FAQ and trust rows cannot drift:

```ts
export const SELLER_NAME = 'Romeo Angeles Jr.'
export const SELLER_COUNTRY = 'Philippines'
export const CONTACT_EMAIL = 'romeo@tyvera.app'
export const LEGAL_LAST_UPDATED = '2026-10-02'
export const DELETION_SLA_DAYS = 30
export const VPS_BACKUP_COUNT = 7
export const REFUND_WINDOW_DAYS = 14
export const TRIAL_DAYS = 14
// Owner preflight, confirmed 2026-10-02.
export const HOSTING_COUNTRY: string | null = 'Singapore' // Hetzner Singapore
export const OFFSITE_BACKUP_RETENTION_DAYS: number | null = 30
export const LANGSMITH_TRACING_IN_PROD: boolean | null = null // unverified
```

Null values render honest fallback text ("hosting location on request") — never a guess.

## Changes

1. **Legal pages** — `apps/web/app/terms/page.tsx`, `privacy/page.tsx`, `refund/page.tsx`, shared layout `apps/web/src/components/legal/legal-page.tsx` (h1, "Last updated", prose on DESIGN.md tokens, home link header + `SiteFooter`). Each exports `metadata` (title, description, canonical).
   - Terms: seller identity (name, individual, Philippines, contact). Lemon Squeezy is the Merchant of Record — handles payment, tax, invoices. Subscription + 14-day trial. Plan limits per pricing page (matched line items, photo checks). Acceptable use (lawful documents you have rights to; no attempts to access other workspaces; no abuse/overload/reverse-engineering). AI output: flags are suggestions; a person decides; no warranty that every discrepancy is caught. Customer owns their data; licence to process it only to run the service. Termination. Liability cap = fees paid in previous 12 months. Governing law: Republic of the Philippines.
   - Privacy: controller = seller. Data collected (table from facts). Purpose. Processors table (OpenAI — text, page images, product photos — not used for training, abuse logs up to 30 days; Resend — email, OTP; Backblaze B2 — files, backups; Hetzner — hosting, country from `HOSTING_COUNTRY`; LangSmith row listed unless `LANGSMITH_TRACING_IN_PROD === false`; when `null` it reads "may receive prompts and outputs for debugging traces"). Cookies table (2 cookies, strictly necessary; Umami cookieless, self-hosted). Retention: kept while the workspace exists; deletion on request within `DELETION_SLA_DAYS`; backups: 7 newest on server + off-site per `OFFSITE_BACKUP_RETENTION_DAYS`. Rights under the Philippine Data Privacy Act of 2012 (RA 10173): access, correction, deletion, objection, complaint to the National Privacy Commission. Contact.
   - Refund: cancel anytime, access to period end; full refund on request within 14 days of the first payment; no partial-period refunds after; overage charges non-refundable once used; request via `CONTACT_EMAIL` or the Lemon Squeezy order email.
2. **`site-footer.tsx`** — new "Legal" column: Terms `/terms`, Privacy `/privacy`, Refunds `/refund`; "Contact" `mailto:romeo@tyvera.app`. Bottom line: `© 2026 Romeo Angeles Jr. · Optra · Philippines`. Disclaimer becomes "Product screens on this page show sample data."
3. **`metrics-strip.tsx`** — replace placeholders with facts; remove the PLACEHOLDER comment, the "Catalogs from" row and `VENDORS`:
   - `Formats read` → `PDF · CSV · XLSX`
   - `Lines checked` → `Every line`
   - `Final call` → `A person` (4 recorded outcomes)
4. **`files-trust.tsx`** — chips `['PDF', 'Scanned PDF', 'CSV', 'XLSX']`. Deletion row: "Email us and we delete the workspace, its files, matches and history within 30 days."
5. **`pricing-plans.tsx`** — Solo adds `100 photo checks / month`; Team adds `300 photo checks per buyer, pooled`; Scale CTA `Contact sales` → `mailto:romeo@tyvera.app?subject=Optra%20Scale`; subhead "Priced per matched line item, not per document. Every plan starts with a 14-day trial." (drop "no card, no onboarding call"). Comment explains photo check = one PO line verified against up to 8 catalog photos.
6. **`hero.tsx:45`** → `14-day free trial · reads the PDFs, CSVs and spreadsheets you already have`.
7. **`final-cta.tsx:38`** → `14-day free trial · ask and we delete your workspace and every file`.
8. **FAQ in `apps/web/app/page.tsx`** — #2 answer: "Vendor catalogs with product photos, purchase orders, invoices and goods receipts — as PDF (scanned too), CSV or XLSX." #5 answer: "They live in your workspace and are used only to run your matches. To read line items and compare product photos, document text and page images are sent to OpenAI's API, which does not train on them. Email us and we delete the workspace, its files, matches and history within 30 days."
9. **`sitemap.ts`** — add `/terms`, `/privacy`, `/refund` (monthly, priority 0.3).
10. **Docs** — `docs/ai/risk-register.md` landing rows; `CLAUDE.md` "What Optra is" (commercial from 2026-10-02); `docs/business/unit-economics.md`; `docs/ai/file-index/repository-map.md` entries for legal pages + `legal-facts.ts`.

## Tests (RED first; titles ordered error: > edge: > regression: > happy:)

- `apps/web/src/lib/legal-facts.spec.ts` — constants exact.
- `apps/web/app/terms/page.spec.tsx`, `privacy/page.spec.tsx`, `refund/page.spec.tsx` — h1; seller name + country; `mailto:romeo@tyvera.app`; Privacy names OpenAI, Resend, Backblaze B2, Hetzner, `mnemra_at`, `mnemra_rt`, "RA 10173"; edge: null `HOSTING_COUNTRY` renders fallback, no "undefined"/"null" text; Terms names "Merchant of Record" and "Philippines"; Refund states "14 days".
- `site-footer.spec.tsx` — Legal links + hrefs, contact mailto, seller line; regression: old "Figures on this page are illustrative" gone.
- `metrics-strip.spec.tsx` — regression: no `<10s`, `94%`, `−42%`, no "Vendor logo"; happy: three facts.
- `files-trust.spec.tsx` — regression: no "JPG / PNG", "Email attachment"; deletion copy says "within 30 days".
- `pricing-plans.spec.tsx` — photo-check rows; Scale CTA href mailto; regression: no "no card".
- `hero.spec.tsx`, `final-cta.spec.tsx` — regression: no "no card".
- `apps/web/app/page.spec.ts` — FAQ #5 mentions OpenAI; regression: no "or image"; disclaimer assertion updated.
- `apps/web/app/sitemap.spec.ts` — 4 entries.
- Playwright `apps/e2e/tests/legal.spec.ts` — from `/`, footer links open `/terms`, `/privacy`, `/refund` (200, h1, seller line); error: unknown `/terms/x` renders not-found.
