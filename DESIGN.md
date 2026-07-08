# Design System — Mnemra

## Product Context
- **What this is:** Workspace-based RAG/knowledge-base SaaS — grounded chat assistant, ticket-extraction copilot, web-source crawling.
- **Who it's for:** Customer support teams who need instant, cited answers from their own docs instead of digging through tabs.
- **Space/industry:** Support tooling, adjacent to Zendesk/Intercom (ticketing) and Linear/Notion/claude.ai (workspace IA).
- **Project type:** Authenticated web app (Next.js) + REST API (NestJS).
- **Memorable thing:** *Serious tool for serious support work.* Calm, competent, no-nonsense — every design choice should serve that, not decoration for its own sake.

## Aesthetic Direction
- **Direction:** Calm Utility — restrained, content-first, minimal decoration.
- **Decoration level:** Minimal. Typography, spacing, and layout do the work. No icon-in-colored-circle decoration, no gradient hero treatments in the app shell.
- **Mood:** The product should feel like it gets out of the way of the actual work — grounded answers, documents, tickets — not like it's performing "designed-ness" at the user.
- **Reference points:** claude.ai's IA (persistent sidebar, calm focused content pane), Linear's 2026 UI refresh (sidebar dimmed relative to main content, reduced icon density) — [Linear UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh), [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui). Not copying colors from any reference — see Color section, unchanged from the existing system.

## Typography
- **Display/Hero:** Outfit (`--font-display`, `apps/web/app/layout.tsx`) — already in place, not a default stack, no change.
- **Body:** DM Sans (`--font-body`) — already in place, no change.
- **Data/Tables:** DM Sans with `.tabular-nums` utility (`globals.css:156-159`) for numeric columns — no change.
- **Code/Mono:** JetBrains Mono (`--font-mono`) — no change.
- **Scale:** existing Tailwind type scale, no change — headings use `text-wrap: balance`, body uses `text-wrap: pretty` (`globals.css:143,153`).

## Color
- **Approach:** Balanced — primary + accent + semantic colors (unchanged).
- **Source of truth:** `packages/ui/src/globals.css:42-103` — full oklch token set, light + dark variants. **Not modified by this consultation.** Confirmed by design review as already disciplined and consumed correctly via Tailwind semantic classes almost everywhere.
- **One cleanup item:** `apps/web/app/page.tsx:135` uses a raw `rgba()` gradient overlay instead of a token-based value — fix as part of implementation, not a new color decision. (Resolved 2026-07-04 — replaced with `bg-gradient-to-br ... via-white/40 ...` Tailwind utilities as part of the landing-page copy rewrite.)

## Spacing
- **Base unit:** existing Tailwind 4px scale — confirmed clean, no arbitrary pixel values found in design review. No change.
- **Density:** slightly more breathing room in the new sidebar shell specifically (matches the Linear 2026 refresh direction) — the rest of the app's density is unchanged.
- **Radius/shadow tokens:** `--radius-2xl` (`calc(var(--radius) + 0.5rem)`) and `--shadow-md` already exist (`globals.css:29-37`) — use the token classes (`rounded-2xl`, `shadow-md`) directly. Do not write `rounded-[calc(var(--radius)+0.5rem)]` or `shadow-[var(--shadow-md)]` literals (found repeated across 6+ files, cleanup item, not a new rule).

## Layout — Sidebar Shell (the actual outcome of this consultation)

Replaces the current pattern where every one of the 6 authenticated pages (dashboard, workspaces list, workspace detail, knowledge-base detail, chat, tickets) independently builds its own `AppHeader` with bespoke `navigation` links.

- **Structure:** persistent, collapsible left sidebar (248px expanded, icon-only collapsed) containing:
  1. Workspace switcher at top (avatar + name, links back to `/workspaces` to switch — no inline dropdown-menu primitive exists in `packages/ui` yet, deferred)
  2. Search entry point (`⌘K` style — ties to the "Search" proactive API feature)
  3. Primary nav: Overview, Knowledge Bases, Members, Chat, Tickets, Settings — one shared nav-items model, not per-page ad-hoc links
  4. Active section indicated by a filled dot + lighter card-colored background — not a color change
  5. Collapse toggle + current-user chip pinned to the bottom
- **Visual weight:** sidebar background uses `--secondary` (dimmer than `--card`), deliberately less prominent than the main content pane — the risk called out in the consultation: users' eyes should land on the actual work, not the chrome.
- **Top bar:** shrinks to page title + contextual actions + user avatar menu (logout lives here, unchanged from the existing `AppHeader.onLogout` prop).
- **No icon-in-colored-circle decoration anywhere in the shell.**
- **Reference implementation:** `~/.gstack/projects/OwlRepo-mnemra/designs/design-system-20260701/sidebar-shell-preview.html` — self-contained HTML preview, light + dark, built from the actual tokens above.

### Responsive Behavior
The sidebar shell above had zero mobile treatment until this pass — a real gap, not an intentional omission.

- **Breakpoints:** unmodified Tailwind v4 defaults (no `--breakpoint-*` override in `globals.css`), now treated as this project's canonical breakpoints: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px.
- **Sidebar / drawer cutover at `lg` (1024px), not `md`.** Below `lg`, the persistent sidebar (`AppShell`'s `<aside>`) is not rendered at all (`hidden lg:flex`) and is replaced by an off-canvas drawer (`packages/ui/src/components/ui/mobile-nav-drawer.tsx`), triggered by a hamburger button in a new `lg:hidden` top strip. At `lg` and above, the drawer never renders and the existing manual expand(248px)/collapse(icon-only) toggle (above) is the only sidebar-density control. The two are mutually exclusive by breakpoint, not by user choice. Rationale for `lg` over `md`: tablet-portrait width (768–1023px) is already cramped for the 3–4 column tables in Members/Tickets/Knowledge Bases, so it gets the simpler mobile-drawer treatment instead of a third "squeezed" in-between state.
- **Drawer component:** hand-rolled, no Radix dependency — `packages/ui` has no Sheet/Dialog primitive, so `MobileNavDrawer` follows the same overlay conventions already established by `Modal` (`packages/ui/src/components/ui/modal.tsx`): `role="dialog" aria-modal`, Escape-to-close, overlay-click-to-close, body scroll lock. It renders the exact same `sidebarHeader`/`navigation`/`userFooter` slot content `AppShell` already receives — no new nav content authored for mobile.
- **Tables:** the shared `Table` component's built-in `overflow-x-auto` wrapper (`packages/ui/src/components/ui/table.tsx:6`) is the sanctioned mobile table pattern. Do not build a second pattern (e.g. a card-list transform) without updating this doc first.
- **Dialogs:** `Modal` already degrades acceptably on narrow screens via `max-h-[85vh]` + internal scroll + per-instance `max-w-*` sizing — verified padding-only, no structural change needed.
- **Touch targets:** nav items and interactive controls target the WCAG 2.5.8 minimum (24×24px) as the baseline; bumped to 2.5.5's 44×44px in the mobile drawer specifically if live verification finds tap targets too tight (desktop density is unchanged either way).

## Motion
- **Approach:** minimal-functional — the app currently has near-zero intentional motion; this adds just enough to feel considered, not performed.
- **Additions:** sidebar collapse/expand transition (200ms, `--ease-out`), active-nav-item background transition, subtle content fade-in on route change (reuses the existing `.fade-slide-in` utility already defined in `globals.css:249-251`, currently unused in the sidebar context).
- **Easing/duration tokens:** already defined (`--ease-out`, `--ease-in-out`, `--ease-spring` in `globals.css:70-72`) — no new tokens needed.
- **Landing page exception (2026-07-06):** the public marketing page (`apps/web/app/page.tsx`) intentionally carries more motion than the "near-zero" app-shell baseline above — scroll-reveal on every section, animated metric counters, a typing-effect answer preview, mouse-spotlight hover on feature cards, a marquee for use cases, and floating hero gradient blobs. Scope is the landing page only; authenticated app screens keep the Calm Utility / near-zero-motion direction unchanged. No new colors were introduced — all effects reuse existing oklch tokens (`--primary`, `--secondary`, etc.) via the same `oklch(from var(--x) l c h / alpha)` pattern already used in `globals.css`. All CSS-driven animation (reveal, marquee, floating blobs, button shine) is automatically disabled by the existing global `prefers-reduced-motion: reduce` rule (`globals.css:175-184`); the two JS-driven effects (count-up, typing text) check `prefers-reduced-motion` directly and render their end state immediately when set. New reusable pieces: `apps/web/src/components/motion/{reveal,count-up,spotlight-card,marquee,typing-text}.tsx` and `apps/web/src/hooks/use-in-view.ts`. New global keyframes added to `packages/ui/src/globals.css`: `marquee`, `float-slow`, `float-slow-reverse`, `shine-sweep` (and matching `.animate-marquee` / `.animate-float-slow` / `.animate-float-slower` / `.btn-shine` utilities).

## Proactive `apps/api` Features (approved for sizing, not yet built)
1. **Search** (documents/tickets/chat history) — surfaces as the `⌘K` entry point in the sidebar shell above.
2. **Real activity feed** — replaces the dashboard's fake "Recent activity" card with real ingest/crawl/ticket completions.
3. **Async-work notifications** — notify when ingest/crawl/ticket-extraction finishes, replacing today's silent 3-second polling.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-01 | Sidebar shell replaces per-page headers | Design review found no shared nav model across 6 pages — critical structural gap, not a polish item |
| 2026-07-01 | Colors, typography, spacing scale kept unchanged | Design review confirmed the existing oklch token system is already disciplined; user explicitly did not want a new color system |
| 2026-07-01 | Icon-in-colored-circle decoration dropped, not reduced | Design review flagged 13 repeated instances as the strongest AI-slop signal in the app. Implemented 2026-07-02 across the 6 live instances found in the current codebase (landing page hero/pillars/features, workspace Overview quick-links/activity feed, chat Sources panel); brand/logo marks and identity avatars were intentionally excluded because they are identity, not decorative filler. |
| 2026-07-01 | Sidebar dimmed relative to main content | Deliberate risk — reinforces "efficient tool, not a dashboard you admire," matches the "serious tool for serious support work" memorable-thing answer |
| 2026-07-01 | Workspace detail split into Overview/Knowledge Bases/Members/Settings routes | Nav model needs real destinations per item; extracted from one overloaded page rather than inventing new backend endpoints |
| 2026-07-01 | `/dashboard` retired, folded into workspace Overview | Had zero workspace-specific data; `/workspaces` already served as the picker, so a separate global landing page was redundant |
| 2026-07-02 | Landing page copy rewritten, dead `/dashboard` links fixed | Design audit flagged 4 sections describing the UI/design process instead of the product; E1's dashboard retirement made the old links a real 404, not just stale copy |
| 2026-07-02 | Auth pages restyled with @repo/ui primitives | QA and design-review both flagged unstyled auth pages as the most visibly unfinished part of the app; zero logic changed, pure component swap |
| 2026-07-02 | Activity feed and notifications share one `workspace_events` system | Same 6 processor terminal transitions drive both features, so one append-only event log + per-member seen marker avoids building duplicate infrastructure with divergent truth |
| 2026-07-04 | Landing page copy rewritten to lead with support-team pain points; added Personal/Team workspace positioning section | Design-review session found hero/pillars/features copy was feature-first and self-referential (hero subhead repeated the exact self-praising pattern the 2026-07-02 audit already flagged and removed elsewhere on this page); workspace model already supports 1..N members, so individual/team framing needed no new capability, pure copy |
| 2026-07-06 | Landing page given a dedicated motion/animation pass (scroll reveals, count-up metrics, typing preview, spotlight cards, use-case marquee, floating hero blobs), scoped to `apps/web/app/page.tsx` only | Explicit user request to modernize the marketing page toward a more animated feel (reference: caveman.so) while keeping the existing oklch color tokens unchanged; authenticated app screens are out of scope and keep the Calm Utility / near-zero-motion direction from the 2026-07-01 consultation |
| 2026-07-08 | Sidebar shell gets a responsive drawer at `lg` (1024px) cutover, hand-rolled to match `Modal`'s existing no-Radix pattern | Whole-app mobile-responsive pass; DESIGN.md previously had zero mobile/breakpoint spec — genuine gap, not a prior decision being reversed. `lg` chosen over `md` because tablet-portrait width is already cramped for the app's 3–4 column tables |
