# TODOS

## Live Linear API integration for ticket export

**What:** Real OAuth + ticket-create API call to Linear, replacing the v1 manual copy/paste export.

**Why:** Removes manual copy/paste friction for support leads once demand for the ticket-copilot feature is confirmed. Closer to ELID's original literal ask ("auto-generates Linear-like tickets").

**Pros:** Completes the workflow end-to-end without a manual step; matches the original customer ask more literally.

**Cons:** Real external integration surface (OAuth, rate limits, duplicate-ticket detection) — not worth building before demand is proven. Building it before validation risks throwaway work if the pilot doesn't land.

**Context:** Surfaced during `/plan-eng-review` on 2026-07-01 (see `~/.gstack/projects/OwlRepo-mnemra/romeoangelesjr-main-design-20260701-121631.md`, "Engineering Review Amendments"). The v1 default was reversed from "Linear export with JSON fallback" to "manual copy/paste default, Linear as upgrade" per an outside-voice (Codex) challenge that was accepted.

**Depends on / blocked by:** Phase 1 (transcript-to-ticket extraction) must validate with a real ELID support lead confirming they'd use the drafts before this is worth building.

## Create a formal DESIGN.md

**Done.** `DESIGN.md` was written 2026-07-01 via `/design-consultation` during the sidebar-shell revamp — not by this QA pass, noting here since this file is already open for other updates.

**What:** Document the design system (colors, typography, spacing, component conventions) that currently only exists implicitly across `packages/ui/src/globals.css` and component usage patterns in `apps/web`.

**Why:** Future design reviews (including this one) have to reverse-engineer the system from code instead of reading a spec, costing review time and risking inconsistent interpretation.

**Pros:** Faster and more consistent future design reviews; easier onboarding for anyone adding new UI.

**Cons:** Real effort to write well; not urgent for a single internal pilot screen.

**Context:** Surfaced during `/plan-design-review` on 2026-07-01 while reviewing the ticket-copilot review/edit screen (see `~/.gstack/projects/OwlRepo-mnemra/romeoangelesjr-main-design-20260701-121631.md`). The existing system was reconstructed from `packages/ui/src/globals.css` and `apps/web/app/dashboard/page.tsx`.

**Depends on / blocked by:** Nothing — can be picked up anytime via `/design-consultation`.

## Fuzzy/near-duplicate transcript detection

**What:** Detect near-duplicate transcripts (minor edits, re-pastes with small changes) beyond the exact content-hash match already in v1.

**Why:** Exact-match hashing misses accidental re-pastes with trivial edits (extra whitespace beyond normalization, a typo fix), which would still trigger a redundant extraction.

**Pros:** More robust duplicate protection, saves LLM cost on near-duplicates.

**Cons:** Real complexity (fuzzy matching / similarity threshold tuning) for a low-frequency edge case at pilot scale.

**Context:** Surfaced during `/plan-ceo-review` on 2026-07-01 (see CEO plan `~/.gstack/projects/OwlRepo-mnemra/ceo-plans/2026-07-01-elid-ticket-copilot.md`). Exact-match hashing was explicitly scoped as v1's limit, not an oversight.

**Depends on / blocked by:** Nothing — independent of other work, but low priority until exact-match proves insufficient in practice.

## Full audit history for tickets

**What:** Track every review/edit event on a ticket (multiple reviewedBy/reviewedAt entries), not just the last-touch columns in v1.

**Why:** A single-reviewer pilot doesn't need history, but a multi-reviewer future would want to know who changed what and when across multiple edits.

**Pros:** Real accountability trail if more than one person ever reviews tickets.

**Cons:** A full audit log table is real schema/API work — not justified until there's more than one reviewer per workspace.

**Context:** Surfaced during `/plan-ceo-review` on 2026-07-01. The accepted v1 scope (reviewedBy/reviewedAt as last-touch columns) explicitly excludes this.

**Depends on / blocked by:** Relevant only once a workspace has multiple ticket reviewers.

## Keyboard shortcut for accept-and-copy

**What:** A single keystroke that accepts the current draft and copies it to clipboard in one action, instead of two separate clicks.

**Why:** Small friction reduction for a support lead processing multiple tickets in a session.

**Pros:** Cheap, nice-to-have speed improvement.

**Cons:** Not essential for validating the core hypothesis with ELID.

**Context:** Surfaced during `/plan-ceo-review` on 2026-07-01 as a lower-priority expansion candidate, deferred rather than cherry-picked into v1 scope.

**Depends on / blocked by:** Nothing.

## apps/api must run via `bun run dev`, not the compiled build

**What:** Running the API as `node dist/main` (the compiled production build, `nest build` output) causes scrape-queue and ticket-extraction-queue jobs to crash instantly with `Cannot read properties of undefined (reading 'Socket')` — Bull records the job as failed (empty stack trace, ~20-30ms runtime), but the crash happens before the processor's own first DB write, so the source row is left stuck in a non-terminal state (`pending`/`queued`) forever, with no `last_error` to explain why. The ingest-queue is unaffected. Running the exact same code via `nest start --watch` (what `bun run dev` runs) works correctly — verified live: a scrape and a ticket extraction both completed their full pipeline (including a legitimate model-validation failure reaching `status='failed'` with a real error message) with zero errors.

**Why:** This is a real trap for local dev — nothing prevents someone from running `bun run build && node dist/main` instead of `bun run dev`, and the failure mode (silently stuck `pending` rows, no error surfaced anywhere in the UI) is confusing to debug without checking Bull's own job records directly in Redis.

**Root cause not found.** Isolated repros (a bare `db.update()` call, and `db.update()` after importing `@repo/ai`) both succeeded standalone — the failure only reproduces inside the actual long-running NestJS+Bull worker process, and only under the compiled build. Candidate angle for a future investigation: Node v25.0.0 + the compiled CommonJS output (SWC/tsc via `nest build`) vs. `nest start --watch`'s transpilation — something in that specific combination breaks a fresh low-level socket creation (likely inside `pg`'s connection-open path) the first time a queue job needs one, but only reachable through the compiled bundle's module resolution.

**Pros of fixing properly:** Removes a silent-failure trap; compiled builds should behave identically to dev mode.

**Cons:** Real investigation effort into build-tooling internals (SWC/tsc output differences, Node version compatibility) for a bug that has a trivial workaround (use `bun run dev`).

**Context:** Found during `/qa` on 2026-07-02 while investigating a stuck-pending ticket the user reported (`.gstack/qa-reports/qa-report-localhost-2026-07-02.md`). Confirmed reproducible on 2 separate runs against 2 separate queues (scrape, ticket-extraction) under the compiled build, and confirmed NOT reproducing under `bun run dev` on the same code.

**Depends on / blocked by:** Nothing — can be picked up anytime. Start by getting a real stack trace via `node --enable-source-maps --stack-trace-limit=100 dist/main`, since Bull's own stored `failedReason` has an empty `stacktrace` array.

## Generalize extraction chain for non-transcript inputs

**What:** Design the extraction chain's interface generically enough to eventually accept Slack threads or meeting notes, not just call transcripts.

**Why:** The underlying pattern ("conversation → structured record") is reusable beyond call transcripts, and the office-hours session's original broader vision (institutional memory across sources) could be revisited here if the ticket-copilot wedge proves out.

**Pros:** Avoids a rewrite if a second input type is validated later.

**Cons:** Speculative generalization before any second input type has been requested by a customer — exactly the kind of premature abstraction this whole review process has been pushing back against.

**Context:** Surfaced during `/plan-ceo-review` on 2026-07-01. Worth keeping in mind during the extraction chain's implementation (eng review task T2) without actively designing for it.

**Depends on / blocked by:** A second validated customer ask for a non-transcript input type.
