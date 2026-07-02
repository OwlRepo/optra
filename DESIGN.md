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
- **One cleanup item:** `apps/web/app/page.tsx:135` uses a raw `rgba()` gradient overlay instead of a token-based value — fix as part of implementation, not a new color decision.

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

## Motion
- **Approach:** minimal-functional — the app currently has near-zero intentional motion; this adds just enough to feel considered, not performed.
- **Additions:** sidebar collapse/expand transition (200ms, `--ease-out`), active-nav-item background transition, subtle content fade-in on route change (reuses the existing `.fade-slide-in` utility already defined in `globals.css:249-251`, currently unused in the sidebar context).
- **Easing/duration tokens:** already defined (`--ease-out`, `--ease-in-out`, `--ease-spring` in `globals.css:70-72`) — no new tokens needed.

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
