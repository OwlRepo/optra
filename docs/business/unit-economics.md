# Optra unit economics

Last verified: 2026-10-02. Every number below comes from code or a cited price page.
Recompute when a model, a prompt, a candidate cap or a vendor price changes.

## What actually costs money

| Step | LLM? | When it runs | Evidence |
|---|---|---|---|
| PO / invoice extraction, PDF | gpt-4o, once per document (text path, or all pages in one vision call, max `PROCUREMENT_PDF_MAX_PAGES` = 10) | on upload | `packages/ai/src/chains/procurement-extraction.ts` `extractLineItemsFromPdf` |
| PO / invoice / goods-receipt extraction, phone photos (added 2026-10-06) | gpt-4o vision, once per document, all pages (1–5, `MAX_PHOTO_PAGES`) in one call, `detail: 'high'`; output capped at `IMAGE_MAX_OUTPUT_TOKENS` = 8,000 | on upload | `packages/ai/src/chains/procurement-extraction.ts` `extractLineItemsFromImages`; `apps/api/src/procurement/procurement-photo.ts` `MAX_PHOTO_EDGE` |
| PO / invoice extraction, CSV/XLSX | none | on upload | `apps/api/src/procurement/procurement-parse.processor.ts` (CSV/XLSX branch, `sourceKind` `'csv'`/`'xlsx'`) |
| Comparison (PO vs invoice vs GRN) | none — DuckDB | on "Run comparison" | `apps/api/src/procurement/comparison.service.ts:36` |
| Catalog page parse, PDF | gpt-4o vision, once per page (max 10) | on catalog upload | `packages/ai/src/chains/catalog-match.ts:83` |
| Photo check (one PO line vs catalog) | gpt-4o vision, once per candidate, up to `CATALOG_MATCH_MAX_CANDIDATES` = 8 | user-triggered only | `apps/api/src/catalog/catalog-match.service.ts:17,68` |
| Embeddings | none in procurement / catalog paths | — | `packages/ai/src/embeddings/index.ts` (RAG only) |

All four LLM calls go through `UsageService.metered` and count against
`MAX_TOKENS_PER_WORKSPACE_MONTH` (5,000,000). The photo call is metered by
`ProcurementExtractionService.extractFromImages` and shares the
`PROCUREMENT_PDF_EXTRACTION_ENABLED` kill switch with the PDF path.

## Unit costs (gpt-4o $2.50 in / $10 out per 1M tokens)

Image tokens: `detail` is unset (= auto, tiled like high). Pages are rasterised at
scale 2 (`loaders/pdf-render.ts:25`): Letter ≈ 765 tokens, A4 ≈ 1,105 tokens.
Photos are re-encoded server-side to JPEG with the long edge ≤ 2048px and sent at
`detail: 'high'`; the same tiling math applies (scaled so the short side is 768px,
85 + 170 per 512px tile): a 3:4 photo is 768×1024 = 4 tiles ≈ 765 tokens, an
A4-shaped one 768×1086 = 6 tiles ≈ 1,105 tokens.

| Unit | Tokens (in / out) | Cost |
|---|---|---|
| 14-line text PDF extraction | ~1,225 / ~770 | ~$0.011 per document (~$0.0008 per line) |
| Matched line (PDF PO + PDF invoice) | — | **~$0.0016** |
| Matched line (CSV/XLSX) | 0 | **$0** |
| Scanned 10-page A4 extraction (worst case) | ~11,315 / ~770 | ~$0.036 per document |
| Photo page (image input only) | ~765–1,105 / — | ~$0.0019–0.0028 per page |
| Photo document, 1 page (A4-shaped) | ~1,370 / ~770 | ~$0.011 per document |
| Photo document, 5 pages (A4-shaped, max) | ~5,790 / ~770 | ~$0.022 per document; ceiling ~$0.094 if output hits the 8,000 cap |
| Catalog page parse | ~980 / ~420 | ~$0.0067 per page |
| **Photo check**, 8 candidates with page images | ~8,500 / ~480 | **~$0.026 per line** |

The photo-document rows reuse the scanned-PDF row's ~265-token text prompt and
~770-token output (14 lines). The kind-aware photo prompt has not been measured
on its own; re-measure once real photo uploads exist.

## Plans

Lemon Squeezy fee: 5% + $0.50, +0.5% subscriptions, +1.5% international cards
(+1.5% PayPal).

| Plan | Price | Includes | Worst-case variable cost | Margin |
|---|---|---|---|---|
| Solo | $29/mo, 1 buyer | 400 matched lines + 100 photo checks; extra lines $0.04 | $0.64 + $2.60 + LS $2.53 = $5.77 | ~80% |
| Team | $69/buyer/mo | 2,000 lines + 300 photo checks per buyer, pooled; extra lines $0.03 | $3.20 + $7.80 + LS $5.33 = $16.33 | ~76% |
| Scale | custom, annual | from 25,000 lines/mo | committed rate | — |

Photo checks are capped because they are the one unit that can turn a plan's
margin negative. Fixed cost: one shared Hetzner VPS in Singapore. Backblaze B2 is
$6.95/TB/month (first 10 GB free).

## Billing-task prerequisites (Deep, after Lemon Squeezy approval)

- Meter matched lines per comparison run (idempotent per PO/invoice pair) and photo checks per catalog-match call.
- Scale the per-workspace token budget per plan. A 2-buyer Team at full photo quota needs ~6.6M tokens.
- Token usage is Redis-only (`usage.service.ts:80`) and fails open (`:50-57`), so billing needs a durable ledger.
- `OPENAI_PROCUREMENT_EXTRACTION_MODEL` falls back to `gpt-4-turbo` ($10 / $30) when unset (`packages/ai/src/chains/models.ts:25-28`). `scripts/check-prod-env.sh` should require it.

## Sources

- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI vision token formula: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI data usage: https://developers.openai.com/api/docs/guides/your-data
- Lemon Squeezy fees: https://docs.lemonsqueezy.com/help/getting-started/fees
- Backblaze B2: https://www.backblaze.com/cloud-storage/pricing
