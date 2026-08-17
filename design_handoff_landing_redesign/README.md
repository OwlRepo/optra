# Handoff: Optra landing page redesign

## Overview
A rebuilt marketing landing page for Optra (vision-verified vendor sourcing / PO ↔ catalog ↔ invoice matching). It replaces the current `apps/web/app/page.tsx` page. Goals: a single conversion goal (**start free trial**), an interactive PO-vs-catalog match demo in the hero, and a denser editorial structure that no longer reads as a stack of identical white cards.

Chosen direction: **Optra Refined** (`Optra Refined.dc.html`) — the file to implement. `Optra Ledger.dc.html` is an alternate exploration kept for reference only.

## Scope of this handoff
One route: `/` in `apps/web`. It replaces `apps/web/app/page.tsx` and the components under `apps/web/src/components/landing/`. Nothing behind auth changes; the only new backend concern raised here is line-item metering for the pricing model (see Pricing).

## About the Design Files
The bundled `.dc.html` files are **design references written in HTML**, not production code. They are self-contained prototypes that show intended layout, styling, copy, and behavior. The task is to **recreate them inside the existing Next.js 14 app** (`apps/web`) using its established patterns: Tailwind v4 with the tokens in `packages/ui/src/globals.css`, the `@repo/ui` components (`Button`, `Badge`, `Card`, `PageSection`, `ConfidenceMeter`, …), `lucide-react` icons, and the existing `next/font` setup (Outfit display / DM Sans body / JetBrains Mono). Do not port the inline styles verbatim — map them onto Tailwind utilities and the existing CSS variables.

## Fidelity
**High-fidelity.** Colors, type sizes, spacing, radii, copy, and interaction timing are final. Recreate closely. Two content items are deliberately placeholder and must be replaced before launch:
- vendor logo slots (dashed boxes labeled "vendor logo") in the metrics strip
- product photos (currently an Unsplash bolt photo used in three places)

## Screens / Views

Single page, `/`, max content width **1200px**, horizontal padding `clamp(20px, 3.4vw, 40px)`, vertical section padding `clamp(48px, 6vw, 80px)`. Sections are separated by 1px hairlines (`oklch(0.913 0.012 255)`) and alternate between page background `oklch(0.985 0.004 255)` and pure white `#fff`. No section uses a gradient.

### 1. Header (sticky)
- Sticky, `z-40`, `border-bottom: 1px solid oklch(0.913 0.012 255)`, background `oklch(0.985 0.004 255 / 0.86)` + `backdrop-filter: blur(16px)`.
- Left: `optra-mark.svg` at 28×28 + wordmark "Optra", Outfit 600, 20px, `letter-spacing: -0.04em`.
- Right nav: `Product · Workflow · Pricing · FAQ` — 15px, `oklch(0.45 0.02 264)`, 8px/14px padding, 10px radius; then the primary CTA **Start free trial** — 10px/18px, radius 12px, background `oklch(0.5 0.09 184)`, white text, hover `oklch(0.44 0.085 184)`, `white-space: nowrap`.
- Row wraps (`flex-wrap`) below ~900px.
- Note: this replaces the current floating rounded "island" header with its duplicated product description — intentional.

### 2. Hero
- Two columns, `grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr))`, gap `clamp(36px, 4.5vw, 64px)`, vertically centered. Collapses to one column below ~840px.
- Eyebrow: 24px teal rule + "VISION-VERIFIED INVOICE MATCHING", JetBrains Mono 11px, `letter-spacing: 0.16em`, uppercase, `oklch(0.5 0.09 184)`.
- H1: "Catch the mismatch / before you pay it." — Outfit 600, `clamp(38px, 5.4vw, 62px)`, `line-height: 1.02`, `letter-spacing: -0.035em`, explicit `<br>` after "mismatch".
- Sub: 19px / 1.65, `oklch(0.46 0.02 264)`, max 44ch.
- Buttons: primary **Start free trial →** (16px/26px, radius 14px, teal, shadow `0 10px 24px oklch(0.5 0.09 184 / 0.22)`); secondary **See how matching works** (white, 1px `oklch(0.9 0.012 255)`, radius 14px, hover border `oklch(0.5 0.09 184 / 0.5)`).
- Reassurance line: 14px `oklch(0.56 0.02 264)` — "14 days free · no card · works with the PDFs you already have".
- Right: the **match demo panel** (see Interactions).

### 3. Metrics + vendor strip (white)
- One row, `flex-wrap`, `justify-content: space-between`, 28px vertical padding.
- Three metrics: label 13px `oklch(0.56 0.02 264)`, value Outfit 600 30px; third value (`−42%`) in teal.
- Right: "CATALOGS FROM" mono micro-label + four 96×34 dashed placeholder slots (radius 8px, border `1px dashed oklch(0.88 0.012 255)`) — **replace with real vendor logos**.
- Footnote, 12px `oklch(0.62 0.02 264)`: "Illustrative figures from internal test runs on repeat vendor invoices — not a customer average." Keep this line as long as the numbers are illustrative.

### 4. Product — "Three ways an invoice quietly costs you money" (`#product`)
Three cards, `repeat(auto-fit, minmax(250px, 1fr))`, gap 24px; each: white, 1px `oklch(0.9 0.012 255)`, radius 18px, padding 28px, no shadow.
- Icon in a 38×38 tile, radius 11px, background `oklch(0.5 0.09 184 / 0.1)`, icon 19px teal stroke (lucide `Search`, `ImageCheck`-style rect+check, `ShieldCheck`).
- Title Outfit 600 21px; body 15px / 1.65 `oklch(0.46 0.02 264)`.
- Card 1 footer: mono 11px key/value rows (`po line`, `catalog`, `delta +18.0%` in amber `oklch(0.55 0.13 62)`), separated by a top hairline.
- Card 2 footer: two 76px-tall photos side by side (second bordered teal) + mono caption "ordered ↔ catalog · 92% visual match".
- Card 3 footer: three mono history rows; the first has a 2px teal left border and `oklch(0.5 0.09 184 / 0.07)` background.

### 5. Workspaces (white) — Personal / Team
- Header row: eyebrow + H2 "One buyer or twelve, same vendor history" (left) and a segmented control (right) in a `oklch(0.965 0.008 255)` 12px-radius track with 4px padding; the active tab is white with `0 1px 3px oklch(0.238 0.03 264 / 0.12)` and teal label.
- Body: two columns (`auto-fit, minmax(min(100%,320px),1fr)`), gap 24px. Left panel `oklch(0.978 0.004 255)`, radius 18px, padding 32px: title Outfit 600 26px, description 16px/1.7, mono meta line. Right panel: three bullet rows, each 22px/26px padding, hairline-separated, teal check icon 18px.
- Below: three "core value" cards (Onboarding / Continuity / Efficiency) — mono uppercase eyebrow in teal, 18px title, 14px body, `oklch(0.978 0.004 255)` fill, radius 18px.

### 6. Workflow (`#workflow`)
Three equal columns, gap 32px (no vertical dividers — they broke on wrap).
Each: a numbered 28×28 tile (radius 9px; steps 1–2 teal, step 3 amber `oklch(0.62 0.15 62)`) followed by a hairline rule; Outfit 600 22px title; 15px body; then an 88px-tall visual:
1. dashed drop zone, mono "pdf / xlsx / csv / jpg"
2. three mono-labelled progress bars (extract 100%, catalog 92%, photo 78%), 4px tall, teal fill
3. amber-tinted panel: "2 OF 14 LINES FLAGGED" + "Line 3 · +18% price · Line 7 · item mismatch"

### 7. Why Optra — comparison table (white)
Bordered container, radius 20px, `overflow: hidden`. Header row `oklch(0.968 0.007 255)`: "Today, by hand" (muted) | "With Optra" (teal), 14px semibold. Four body rows, two columns split by hairlines; left cells `oklch(0.982 0.004 255)` with a red `X` (`oklch(0.6 0.18 27)`), right cells white with a teal check. 15px / 1.6.

### 8. Who it's for
Six cards, `auto-fit minmax(250px,1fr)`, gap 16px, radius 16px, white, padding 22px: 17px title + 14px detail. (Procurement teams, AP, multi-vendor sourcing, ops & supply chain, small business buyers, founder-led purchasing.)

### 9. Files & trust (white)
Two columns. Left: eyebrow, H2 "Reads what your vendors already send", 17px body, then seven mono chips (PDF, Scanned PDF, XLSX, CSV, JPG / PNG, Email attachment, Price list) — radius 9px, 1px `oklch(0.9 0.012 255)`, fill `oklch(0.978 0.004 255)`. Right: a 4-row definition table (`140px 1fr`), label column mono uppercase teal on `oklch(0.978 0.004 255)`; rows = Isolation, Citations, Human sign-off, Deletion; closing 13px note "Optra flags. A buyer approves. No line is ever paid on the model's word alone."
Legal note: these claims must stay accurate to the deployment (workspace isolation, per-workspace storage, deletion). Do not add certifications (SOC 2 etc.) that don't exist.

### 10. Pricing (`#pricing`)
Three plans, `auto-fit minmax(260px,1fr)`, gap 20px, radius 20px, white, padding 28px. Middle plan is emphasised: teal 1px border + `0 20px 44px oklch(0.5 0.09 184 / 0.14)` shadow + a teal "MOST BUYERS" pill.
- Solo — **$29** / "per month · 1 buyer" — 400 matched line items/mo, overage $0.04/line
- Team — **$69** / "per buyer / month" — 2,000 matched line items per buyer, pooled, overage $0.03/line
- Scale — **Talk** / "annual · from 25,000 lines / mo"
Price: Outfit 600 42px, `-0.04em`. Feature rows: 14px with a 15px teal check. CTA: middle = solid teal, others = 1px `oklch(0.9 0.012 255)`, radius 12px, 15px semibold. Section subhead states the model: "Priced per matched line item, not per document."

**Pricing rationale (for the billing implementation).** The unit cost driver is a matched line item, not a seat. `gpt-4o` PDF extraction plus the vision catalog match works out to roughly **$0.01 per line item** at $2.50 / $10 per 1M tokens (≈$0.10–0.15 for a 14-line PO; higher on scanned/image-only PDFs, which rasterize up to `PROCUREMENT_PDF_MAX_PAGES`, default 10). Embeddings (`text-embedding-3-small`) are negligible. Fixed infrastructure is a **$20/mo Hetzner VPS** running the whole stack (api, web, postgres/pgvector, redis, seaweedfs) — so the first Solo subscription covers hosting outright and every plan is variable-cost-dominated after that.

At full quota: Solo ≈ $4 of model spend (≈86% gross margin), Team ≈ $20 per buyer (≈71%). That headroom is why the included volumes are generous rather than tight — but it is also why the earlier "unmetered" Team plan was dropped: unbounded vision matching is the one line item that can invert margin, and a single 10-page scanned catalog run is worth ~50 text-path lines. Metering must count *matched line items* (post-extraction, per comparison run), must not double-charge idempotent re-comparisons of the same PO/invoice pair, and should watch the vision fallback rate as a separate cost signal. Confirm the final numbers with the product owner before launch.

### 11. FAQ (`#faq`, white)
Two columns (`0.7fr / 1.3fr` equivalent): sticky-feeling heading on the left, accordion on the right. Rows separated by hairlines; question Outfit 600 20px; chevron 20px rotates 180° and turns teal when open; answer 16px / 1.7 max 68ch. First item open by default; clicking an open item closes it. Five questions (see the HTML for exact copy).

### 12. Final CTA (`#trial`)
Full-width inset block, radius 24px, background `oklch(0.32 0.045 200)`, text `oklch(0.97 0.01 200)`, padding `clamp(28px,4vw,56px)`, two columns. Eyebrow in `oklch(0.8 0.09 184)`; H2 "Check one purchase order tonight." Outfit 600 44px; body 17px/1.7 `oklch(0.86 0.02 200)`. Two full-width stacked buttons (light solid + outlined) with `justify-content: space-between` and a trailing arrow, plus a 13px fine-print line.

### 13. Footer (white)
`auto-fit minmax(170px,1fr)` grid: brand block (mark + wordmark + 14px description) and three link columns (Product / Company / App). Bottom bar above a hairline: 13px `oklch(0.56 0.02 264)`, left "© 2026 Optra. All rights reserved.", right "Figures on this page are illustrative examples, not customer results."

## Interactions & Behavior

### Hero match demo (the main interactive piece)
Panel: white, 1px `oklch(0.9 0.012 255)`, radius 20px, `box-shadow: 0 24px 60px oklch(0.238 0.03 264 / 0.07)`, `overflow: hidden`.
- **Document tabs** (panel header, `oklch(0.975 0.005 255)`): two scenarios — `PO #4417 · Ironclad` (3 lines) and `INV #8820 · Northgate` (4 lines). Active tab = teal fill, white text; inactive = white with `oklch(0.91 0.012 255)` border. Right side shows a mono status: `matching…` while scanning, else `L03 · flagged`.
- **Line rows**: mono line number (34px column), item text 14px, mono price, and a status pill (Matched = teal, Flagged = amber `oklch(0.62 0.15 62)`, Mismatch = red `oklch(0.6 0.18 27)`). The active row gets `background: oklch(0.975 0.005 255)` and `box-shadow: inset 3px 0 0 <tone>`; its pill inverts to a solid fill. Rows are buttons — clicking one re-runs the match for that line.
- **Evidence pane** (min-height 250px, `oklch(0.978 0.004 255)`): mono "CATALOG EVIDENCE" label, a verdict pill (uppercase, solid tone, `rf-pop` 300ms `cubic-bezier(0.34,1.56,0.64,1)` entry), a 92px catalog photo whose border takes the verdict tone (50% opacity + neutral border while scanning), the verdict sentence (14px/1.6) and a mono `src:` citation line.
- **Metric row**: PO price / Catalog / Confidence in three white 12px-radius tiles; values are mono 17px and show `——` while scanning; the Catalog value turns amber on a price flag.
- **Timing**: two phases — `scanning` (1100ms; a 34%-wide teal gradient sweep animates left→right via `rf-sweep`) then `verdict` (dwell, default 3800ms), then it advances to the next line, rolling over into the next document. Clicking a line or tab cancels the timer, plays one scan, then resumes autoplay.
- Prototype exposes two tweaks: `autoplayDemo` (boolean) and `demoDwellMs` (1500–8000). In production, autoplay should pause when the panel is off-screen and respect `prefers-reduced-motion` (skip the sweep, go straight to the verdict).

### Scroll reveal
Elements marked `data-reveal` start at `opacity: 0; translateY(16px)` and transition `700ms cubic-bezier(0.23,1,0.32,1)` when an IntersectionObserver (`rootMargin: -8% 0px -12% 0px`) first intersects them; each element is unobserved after revealing. A 2600ms fallback reveals everything if the observer never fires — keep an equivalent safety net (or render revealed-by-default and add the animation only client-side) so content is never trapped invisible. Honour `prefers-reduced-motion` (the app already has a `prefersReducedMotion()` helper in `apps/web/src/hooks/use-in-view.ts`).

### Other behavior
- Personal/Team tabs and the FAQ accordion are client state; the accordion animates via `grid-template-rows: 0fr → 1fr`, 320ms `cubic-bezier(0.23,1,0.32,1)`.
- All nav/footer links are in-page anchors except Workspace / Live demo, which point at `/workspaces` and `/chat`.
- Hover states: nav links and body links go teal; primary buttons darken to `oklch(0.44 0.085 184)`; secondary buttons take a teal-tinted border.

## State Management
Client component state only, no data fetching:
- `doc: number` — active demo document (0–1)
- `line: number` — active line within the document
- `phase: 'scanning' | 'verdict'`
- `mode: 'personal' | 'team'`
- `openFaq: number | null` (0 initially)
Plus one timer ref for the autoplay loop and one IntersectionObserver for reveals; clear both on unmount.
Demo scenario data is static — put it in a module beside the page (mirroring the existing `apps/web/src/lib/landing-example.ts`) and keep the "PLACEHOLDER METRIC" comments.

## Design Tokens
All values below already exist as CSS variables in `packages/ui/src/globals.css` unless marked NEW.

Colors
- page background `oklch(0.985 0.004 255)` (`--background`)
- surface white `#fff` (`--card`)
- subtle surface `oklch(0.978 0.004 255)`, secondary `oklch(0.968 0.007 255)` (`--secondary`)
- ink `oklch(0.238 0.03 264)` (`--foreground`); body copy `oklch(0.46 0.02 264)`; muted `oklch(0.56 0.02 264)` (`--muted-foreground`)
- hairline `oklch(0.913 0.012 255)` (`--border`); lighter inner rules `oklch(0.93 0.01 255)` / `oklch(0.94 0.01 255)`
- teal primary **`oklch(0.5 0.09 184)`** — NEW, slightly darker than the current `--primary: oklch(0.571 0.098 184)` for AA contrast on white; hover `oklch(0.44 0.085 184)`
- flag amber `oklch(0.62 0.15 62)` (replaces the yellower `--warning`); mismatch red `oklch(0.6 0.18 27)` (`--destructive`)
- dark CTA field `oklch(0.32 0.045 200)` — NEW; its text `oklch(0.97 0.01 200)`, muted text `oklch(0.86 0.02 200)`, eyebrow `oklch(0.8 0.09 184)`

Typography — Outfit (display/headings), DM Sans (body, 17px base), JetBrains Mono (all data, labels, eyebrows, prices)
- H1 `clamp(38px, 5.4vw, 62px)` / 1.02 / -0.035em / 600
- H2 `clamp(30px, 3.6vw, 42px)` / 1.06; smaller H2 `clamp(28px, 3.2vw, 38px)` / 1.08
- H3 21–26px 600; H4 18px 600
- body 19px (hero), 17px, 15px, 14px — line-height 1.6–1.7
- mono labels 10–11px, `letter-spacing: 0.14–0.16em`, uppercase

Spacing — section padding `clamp(48px, 6vw, 80px)`; gutters `clamp(20px, 3.4vw, 40px)`; grid gaps 16 / 20 / 24 / 32px; card padding 22 / 28 / 32px.

Radii — 8, 9, 11, 12, 14, 16, 18, 20, 24px, and 999px for pills. (The prototype hard-codes these rather than deriving from `--radius`.)

Shadows — only three in the whole page: demo panel `0 24px 60px oklch(0.238 0.03 264 / 0.07)`, primary button `0 10px 24px oklch(0.5 0.09 184 / 0.22)`, featured plan `0 20px 44px oklch(0.5 0.09 184 / 0.14)`. Cards are borders-only by design; don't reintroduce `--shadow-sm` on every card.

Motion — `rf-sweep` (1100ms, `cubic-bezier(0.4,0,0.6,1)`), `rf-pop` (300ms, `cubic-bezier(0.34,1.56,0.64,1)`), reveal 700ms `cubic-bezier(0.23,1,0.32,1)`, accordion 320ms same easing, hover transitions 200ms.

## Responsive behavior
No media queries — the layout is intrinsically responsive via `clamp()` type/padding and `repeat(auto-fit, minmax(min(100%, Npx), 1fr))` grids, plus `flex-wrap` on the header, metrics strip, and heading/CTA rows. When rebuilding with Tailwind you may prefer explicit `md:` / `lg:` breakpoints; if so, verify these collapse points: hero and all two-column sections stack ~840px; three-column grids go 2-up then 1-up; the header nav wraps ~900px. Mobile: keep hit targets ≥44px (the demo line rows and nav links currently sit near that floor at 320px — bump their padding).

## Assets
- `assets/optra-mark.svg` — the existing aperture mark, copied unchanged from `apps/web/public/optra-mark.svg`. Use the app's `BrandMark` component instead of a raw `<img>`.
- Product photo placeholder: `https://images.unsplash.com/photo-1564226591723-659ff3852b2a` (the same illustrative bolt photo already referenced by `apps/web/src/lib/landing-example.ts`). Used in the hero evidence pane and twice in Product card 2. **Replace with real catalog photography before launch.**
- Vendor logo slots: dashed placeholder boxes, no asset. **Replace or remove the strip if no real vendor logos can be shown.**
- Icons: lucide (`Search`, `ShieldCheck`, `CheckCircle2`, `ChevronDown`, `X`, an image/compare glyph) — inlined as raw SVG in the prototype; use `lucide-react` in the app.

## Files
- `Optra Refined.dc.html` — **the design to implement.** Self-contained; open it in a browser. Markup is in the `<x-dc>` block, all interaction logic in the `class Component` script at the bottom.
- `Optra Ledger.dc.html` — rejected alternate direction (paper/ink audit aesthetic, Archivo + mono). Reference only.
- `Optra Landing Current.dc.html` — a faithful HTML recreation of the page as it exists today, rebuilt from `apps/web/app/page.tsx` and `@repo/ui`. Useful for before/after comparison and for seeing which existing components carry over.
- `assets/optra-mark.svg` — logo mark.
- Source files the design replaces / draws from: `apps/web/app/page.tsx`, `apps/web/src/components/landing/*`, `apps/web/src/components/{landing-header,comparison-table,accordion,workspace-tabs,brand-mark}.tsx`, `packages/ui/src/globals.css`, `packages/ui/src/components/ui/*`.

## Copy status
All copy in the prototype is new and sharper than the current page; treat it as approved-pending-review. The three headline metrics (`<10s`, `94%`, `−42%`) stay illustrative by decision — keep the "illustrative figures" footnote and the footer disclaimer as long as that is true. Pricing is now derived from real unit economics (see Pricing above) but the final numbers still need product-owner sign-off.
