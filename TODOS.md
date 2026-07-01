# TODOS

## Live Linear API integration for ticket export

**What:** Real OAuth + ticket-create API call to Linear, replacing the v1 manual copy/paste export.

**Why:** Removes manual copy/paste friction for support leads once demand for the ticket-copilot feature is confirmed. Closer to ELID's original literal ask ("auto-generates Linear-like tickets").

**Pros:** Completes the workflow end-to-end without a manual step; matches the original customer ask more literally.

**Cons:** Real external integration surface (OAuth, rate limits, duplicate-ticket detection) — not worth building before demand is proven. Building it before validation risks throwaway work if the pilot doesn't land.

**Context:** Surfaced during `/plan-eng-review` on 2026-07-01 (see `~/.gstack/projects/OwlRepo-mnemra/romeoangelesjr-main-design-20260701-121631.md`, "Engineering Review Amendments"). The v1 default was reversed from "Linear export with JSON fallback" to "manual copy/paste default, Linear as upgrade" per an outside-voice (Codex) challenge that was accepted.

**Depends on / blocked by:** Phase 1 (transcript-to-ticket extraction) must validate with a real ELID support lead confirming they'd use the drafts before this is worth building.

## Create a formal DESIGN.md

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

## Generalize extraction chain for non-transcript inputs

**What:** Design the extraction chain's interface generically enough to eventually accept Slack threads or meeting notes, not just call transcripts.

**Why:** The underlying pattern ("conversation → structured record") is reusable beyond call transcripts, and the office-hours session's original broader vision (institutional memory across sources) could be revisited here if the ticket-copilot wedge proves out.

**Pros:** Avoids a rewrite if a second input type is validated later.

**Cons:** Speculative generalization before any second input type has been requested by a customer — exactly the kind of premature abstraction this whole review process has been pushing back against.

**Context:** Surfaced during `/plan-ceo-review` on 2026-07-01. Worth keeping in mind during the extraction chain's implementation (eng review task T2) without actively designing for it.

**Depends on / blocked by:** A second validated customer ask for a non-transcript input type.
