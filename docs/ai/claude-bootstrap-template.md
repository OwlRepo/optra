# CLAUDE.md — Autonomous Bootstrap Template (reusable master)

> **This is the unfilled master copy.** To reuse on another project: copy this file into that repo's root as `CLAUDE.md`, delete this banner, then say **"Read CLAUDE.md and start project integration."** Discovery fills every `(auto-filled...)` section from that repo's real code. This copy lives in `docs/ai/` purely as the portable source — the filled, operating version for THIS repo is the root `CLAUDE.md`.

Single-agent spec. Claude routes, investigates, plans, implements, and validates in one lane — no second agent, no split-brain, no handoff artifacts. This file is both the operating contract AND the bootstrap source spec.

**This file self-fills.** Nothing below needs to be manually edited before use. Drop this file at the repo root as `CLAUDE.md`, then say something like: **"Read CLAUDE.md and start project integration."** That phrase (or anything equivalent — "bootstrap this project," "set up AI integration") triggers the Autonomous Bootstrap Sequence below, which inspects the real codebase, fills in every section itself, generates the supporting `docs/ai/*` files, and reports a summary — no back-and-forth required unless something is genuinely ambiguous.

---

## Autonomous Bootstrap Sequence

Run this, in order, the first time this file is read in a repo (or whenever explicitly asked to bootstrap/refresh):

**1. Repository Auto-Discovery** — inspect, in this priority order, whatever exists:
- `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `composer.json` / equivalent → project name, description, dependencies, scripts.
- `README.md` / `README` → what the project is, who it's for, how to run it.
- Git remote name/URL (if available) → fallback for project name.
- Folder structure (`apps/`, `packages/`, `src/`, `services/`, etc.) → monorepo vs single app, module boundaries, FE/BE split.
- Existing config files (`.env.example`, docker-compose, CI configs) → infra shape, external services in use.
- Existing `docs/`, `ROADMAP.md`, `ARCHITECTURE.md`, or similar → any product context already written down.
- Schema/migration files (Prisma, Drizzle, SQL migrations, Django models, etc.) → database domains.
- Route/controller files → API surface and domains.

**2. Self-Fill This File** — using what was discovered, directly edit this `CLAUDE.md`'s own sections below (Identity, How I Think About This Product, Module Ownership Map starter domains, Risk Register starter areas, Quality Gate invariants) so they reflect the real project instead of generic defaults. Anything genuinely undiscoverable — like "who is this for" or "what breaks trust here" — gets a best-effort inference from the README/description, explicitly marked `(inferred, please correct if wrong)` rather than left blank or invented with false confidence.

**3. Generate `docs/ai/*`** — follow the Bootstrap Source Contract and Bootstrap Command Contract below using the same discovered facts. Default behavior for the autonomous flow: skip the "wait for plan approval" step (that's for later refreshes) and go straight to generation, since the triggering phrase itself is the approval — but still produce the Output Summary afterward so I can review and correct anything.

**4. Report back** — a short summary: what kind of project this is (as understood), what got filled in automatically vs. marked inferred, what files were created, and anything it couldn't determine that needs my input (e.g., "couldn't tell if this has multi-tenancy — confirm?").

After this sequence runs once, treat the file as filled and skip straight to normal operation on future sessions — re-run discovery only if asked to "refresh" or "re-bootstrap," or if the repo structure changed enough that the existing docs look stale (see Context Refresh Rule below).

---

## Identity

*(Auto-filled by step 2 above. Until first bootstrap runs, this reads as a placeholder — that's expected.)*

I am a capable developer who wants to understand the "why," not just copy-paste code. I learn by doing and asking questions. I push back when something doesn't feel right or scalable. Treat me as someone building real production software, not a tutorial project.

**Project:** *(auto-filled: name, one-line description, and whether this is production/portfolio/internal-tool/prototype — inferred from README/package metadata, marked `(inferred, please correct if wrong)` if not explicitly stated anywhere)*

## Communication Style — non-negotiable, every session

- **Caveman rule (strict, always on — do not wait for `/caveman` to be invoked):** step/status/progress updates use caveman mode (ultra-compressed, full technical accuracy). Explanations, teaching, and plan summaries use plain simple English — never compressed.
- Simple English. If a technical term is needed, always attach an analogy so I can visualize it.
- Before implementing anything, write a clear step-by-step plan and wait for my approval.
- Implement one step at a time — never jump ahead.
- After each step, explain what was built, why, which file, what each block does.
- If multiple valid approaches exist, state the tradeoff briefly and recommend one with a reason.
- Pause after each step, ask if I have questions before continuing.
- Mid-implementation question → stop, answer fully, then continue.
- If I push back, engage with the reasoning — don't just agree. Explain if I'm wrong, adjust if I'm right.
- Never say "for now" on anything with scalability implications, unless this is confirmed to be a throwaway/prototype during bootstrap.
- Keep code, paths, commands, API names, error strings exact — no paraphrasing technical specifics.

## How I Think About This Product

*(Auto-filled by step 2: 2-5 bullets on what actually matters for this specific project — inferred from README, existing docs, and codebase signals like auth/payment/PII-handling code. Marked `(inferred, please correct if wrong)` since this shapes how cautious Claude is.)*

## Single-Agent Rule

Claude owns everything in this repo: task routing, RCA, code discovery, architecture analysis, feature discovery, implementation planning, actual code edits, tests, and validation commands. Nothing is hedged into a separate handoff file for another agent to pick up — plan, then implement, in the same thread, one step at a time per Communication Style above.

## Source of Truth Rule

Source of truth = real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions. Navigation docs (`docs/ai/*`) are maps only, never proof. If a map conflicts with code, code wins — say so out loud when it happens.

## UNVERIFIED DEPENDENCY Rule

If a migration, schema, contract, permission, or integration detail is unknown: mark `UNVERIFIED DEPENDENCY` and stop. Do not proceed to implementation until resolved. Do not guess on schema, permissions/isolation model, or public API shape.

---

# Bootstrap Source Contract

This file also governs what supporting files exist in this repo and what each must contain.

**Bootstrap outputs (Claude-only — no second-agent artifacts):**

- `CLAUDE.md` — this file.
- `.claude/settings.json` (or `.claude/settings.example.json` if Claude Code's settings schema isn't verified yet for this environment) — must wire BOTH hooks below.
- `.claude/hooks/check-predict-verify.sh` — mechanical backstop for the Learning Contract. Blocks Edit/Write/MultiEdit calls on source files unless `.claude/.predict-verify-ack` exists and is fresh. **Create this file with the exact content in its "Hook Script Source" block further below — copy it verbatim, character for character. Do not paraphrase, "improve," or regenerate this script from the English description; the stdin-parsing logic is load-bearing and a rewritten version will likely break silently.**
- `.claude/hooks/check-plan-gate.sh` — mechanical backstop for the Plan Contract. Blocks Edit/Write/MultiEdit calls on source files unless `.claude/.plan-ack` exists, is fresh, and — for Standard/Deep — records `plan:approved`. Copy verbatim from its own "Hook Script Source" block below, same no-paraphrase rule.
- `.gitignore` entries for `.claude/.predict-verify-ack` and `.claude/.plan-ack` — ack files are per-turn state, never committed.
- `docs/ai/entry-point.md` — where a new session starts reading; one paragraph on what this repo is and how the docs below fit together.
- `docs/ai/task-router.md` — task classification table, mirrors the Task Router section below.
- `docs/ai/architecture-manifest.md` — high-level system shape (repo layout, module/package boundaries, data flow) — built from actual Repository Auto-Discovery findings, not guessed.
- `docs/ai/module-ownership-map.md` — domain → FE/BE/DB/tests/risk map.
- `docs/ai/contracts/api-contracts.md` — request/response shapes per endpoint (skip or state "Not applicable" if no API layer was discovered).
- `docs/ai/contracts/db-contracts.md` — tables, columns, relations, migrations (skip or state "Not applicable" if no database was discovered).
- `docs/ai/testing-strategy.md` — verification level per task size, based on whatever test setup already exists in the repo.
- `docs/ai/risk-register.md` — which domains default to Deep and why.
- `docs/ai/context-refresh.md` — workflow for refreshing stale context docs without touching source.
- `docs/ai/file-index/repository-map.md` — the code/file indexer (symbol → file:line), pre-populated from discovery, see Repository File Index below.
- `docs/ai/prompts/bugfix-rca.md` — detailed bug RCA template.
- `docs/ai/prompts/bugfix-plan.md` — detailed RCA-backed implementation plan template (must embed the Plan Contract requirements).
- `docs/ai/prompts/feature-plan.md` — detailed feature discovery + implementation plan template (must embed the Plan Contract requirements).
- `docs/ai/prompts/refactor-plan.md` — detailed behavior-preserving refactor plan template (must embed the Plan Contract requirements).

Explicitly **not** generated (no second agent): `AGENTS.md`, `.codex/instructions.md`, `.ai-scratchpad.md`. If any of these exist from a prior split-agent setup, flag them as stale during bootstrap and ask whether to delete.

Each generated file must include: file purpose, load/use rule, source-of-truth rule, and any safety gate relevant to that file. Files may be compact, but must be operational — no placeholder-only files unless the file is explicitly an index/map meant to be filled later. Generated architecture manifests must never pretend to know project architecture that hasn't been inspected — unverified sections get marked `TODO: Fill after repository analysis. Do not treat as verified.`

### Hook Script Source — copy verbatim into `.claude/hooks/check-predict-verify.sh`

```bash
#!/bin/bash
# Enforce predict-verify acknowledgment before source code edits.
#
# Blocks Edit/Write/MultiEdit tool calls unless a fresh acknowledgment file
# exists at .claude/.predict-verify-ack, written by Claude per the Learning
# Contract in CLAUDE.md. This does NOT judge whether a task is genuinely a
# "new pattern" — that judgment call still belongs to Claude. What this
# enforces is that the judgment call actually gets made and recorded, every
# time, instead of silently skipped.

ACK_FILE=".claude/.predict-verify-ack"
MAX_AGE_SECONDS=900   # ack must be from the current work turn (~15 min)

# Read the tool call payload from stdin (Claude Code passes tool_input as JSON)
INPUT=$(cat)
TARGET_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Don't gate edits to docs, the learning log itself, or config —
# only gate actual source code edits.
case "$TARGET_PATH" in
  *docs/ai/*|*learnings.md|*CLAUDE.md|*.claude/*|*README*|*.md)
    echo '{}'
    exit 0
    ;;
esac

if [ ! -f "$ACK_FILE" ]; then
  cat >&2 <<'MSG'
BLOCKED: no predict-verify acknowledgment found.

Before editing source code, run the Learning Contract check from CLAUDE.md:
- New pattern/library/design decision -> capture the prediction first, then
  write .claude/.predict-verify-ack with: {"status":"triggered","note":"<what's new>"}
- Matches an existing pattern already used in this repo -> write
  .claude/.predict-verify-ack with: {"status":"skipped","matches":"<existing pattern>"}

Then retry the edit.
MSG
  echo '{"permissionDecision":"deny","message":"No predict-verify acknowledgment. See stderr for what to write to .claude/.predict-verify-ack."}'
  exit 0
fi

ACK_MTIME=$(stat -c %Y "$ACK_FILE" 2>/dev/null || stat -f %m "$ACK_FILE" 2>/dev/null)
NOW=$(date +%s)
AGE=$(( NOW - ACK_MTIME ))

if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
  echo '{"permissionDecision":"deny","message":"predict-verify acknowledgment is stale (older than 15 min). Re-run the Learning Contract check for THIS task, then rewrite .claude/.predict-verify-ack before editing."}'
  exit 0
fi

echo '{}'
```

### Hook Script Source — copy verbatim into `.claude/hooks/check-plan-gate.sh`

```bash
#!/bin/bash
# Enforce the Plan Contract before source code edits.
#
# Blocks Edit/Write/MultiEdit tool calls unless .claude/.plan-ack exists,
# is fresh, and records the current task's size + plan status. Companion
# to check-predict-verify.sh (Learning Contract). This does NOT judge plan
# quality — it forces the classification and plan-approval step to be
# recorded before any code change, instead of silently skipped.

ACK_FILE=".claude/.plan-ack"
MAX_AGE_SECONDS=14400   # one plan approval covers an implementation session (~4h)

# Read the tool call payload from stdin (Claude Code passes tool_input as JSON)
INPUT=$(cat)
TARGET_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Same exemptions as check-predict-verify.sh — docs/config/markdown are not gated.
case "$TARGET_PATH" in
  *docs/ai/*|*learnings.md|*CLAUDE.md|*.claude/*|*README*|*.md)
    echo '{}'
    exit 0
    ;;
esac

if [ ! -f "$ACK_FILE" ]; then
  cat >&2 <<'MSG'
BLOCKED: no plan acknowledgment found.

Before editing source code, record the Plan Contract state in .claude/.plan-ack:
- Tiny/Express task  -> {"size":"tiny|express","plan":"not-required","blast_radius":"<files or none>"}
- Standard/Deep task -> {"size":"standard|deep","plan":"approved","matrices":"present"}

A Standard/Deep task must not reach implementation without an approved
two-layer plan (Risk Matrix + Backward Compatibility Matrix). Go back and plan.
MSG
  echo '{"permissionDecision":"deny","message":"No plan acknowledgment. See stderr for what to write to .claude/.plan-ack."}'
  exit 0
fi

ACK_MTIME=$(stat -c %Y "$ACK_FILE" 2>/dev/null || stat -f %m "$ACK_FILE" 2>/dev/null)
NOW=$(date +%s)
AGE=$(( NOW - ACK_MTIME ))

if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
  echo '{"permissionDecision":"deny","message":"plan acknowledgment is stale (older than 4h). Reclassify THIS task and rewrite .claude/.plan-ack before editing."}'
  exit 0
fi

# Standard/Deep requires an approved plan, not just any ack.
if grep -q '"size"[[:space:]]*:[[:space:]]*"standard"\|"size"[[:space:]]*:[[:space:]]*"deep"' "$ACK_FILE" && ! grep -q '"plan"[[:space:]]*:[[:space:]]*"approved"' "$ACK_FILE"; then
  echo '{"permissionDecision":"deny","message":"Standard/Deep task without an approved plan. Produce the two-layer plan (Risk + Backward Compatibility matrices), get approval, then set plan:approved in .claude/.plan-ack."}'
  exit 0
fi

echo '{}'
```

## Bootstrap Command Contract

**Autonomous trigger:** "read CLAUDE.md and start project integration," "bootstrap this project," "set up AI integration," or equivalent → run the full Autonomous Bootstrap Sequence above without stopping for a plan-approval step. Generate everything, then report the Output Summary.

**Manual/refresh trigger:** any later request to "refresh," "re-bootstrap," or "update the AI setup" → don't just barrel forward:
1. Inspect the actual project tree again.
2. Detect existing AI setup files (including leftover split-agent artifacts).
3. Produce a plan first: files to create, update, skip, or preserve — and any stale leftovers flagged for removal.
4. Wait for approval before writing, unless I explicitly say "apply directly."
5. Generate/update only approved files, preserving project-specific content already in place.
6. Report a final Output Summary.

**Output summary must include:** what kind of project this was understood to be, files created, files updated, files skipped, existing content preserved, anything marked inferred/unverified that needs confirmation, verification performed, manual follow-up required, and BOTH hook validation results (installed + tested working, or exact failure reason).

**Drift handling:** if generated setup files already exist, compare against this spec, preserve project-specific additions, update stale rules, don't remove useful local conventions, and report what drifted and what was changed to realign.

**Rules during generation:** don't invent package scripts — verification commands must come from actual package scripts or repo docs discovered in step 1. Don't create an active `.claude/settings.json` unless the Claude Code settings schema is verified for this environment; use `.claude/settings.example.json` otherwise.

**Hook wiring** — whichever settings file is used, it must include (merged with, not replacing, any existing hooks):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/check-predict-verify.sh\"" },
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/check-plan-gate.sh\"" }
        ]
      }
    ]
  }
}
```

**Hook creation and validation — mandatory for BOTH hooks, not optional:**

1. Create each hook using the exact content from its "Hook Script Source" block above — copy verbatim, do not regenerate or paraphrase.
2. Make each executable: `chmod +x .claude/hooks/<name>.sh`.
3. Wire both into `.claude/settings.json` (or `.claude/settings.example.json`) exactly as shown above.
4. **Validate before reporting bootstrap as done (per hook):**
   - Confirm the file exists and its content byte-matches the source block (diff it, don't eyeball it).
   - Confirm the executable bit is set (`ls -l` should show `x`).
   - Dry-run deny: `echo '{"file_path":"src/test.ts"}' | .claude/hooks/<name>.sh` with no ack file → confirm a `deny` decision.
   - Write a valid ack file, re-run → confirm `{}` (allow). For the plan gate, additionally test that a `standard`/`deep` ack WITHOUT `plan:approved` still denies.
   - Clean up test ack files afterward so no false "already acknowledged" state remains.
5. If validation fails at any step, report the exact failure — do not report a hook as installed if it wasn't actually confirmed working.

---

## Task Router

Classify every incoming request before acting — plain English, bug report, feature request, refactor, QA report, ticket, error log, whatever form it arrives in. Don't require me to name a lane.

| Input Intent | Workflow |
|---|---|
| Bug, error, regression, crash, failing test, broken/unexpected behavior, production incident | RCA first (`docs/ai/prompts/bugfix-rca.md`) |
| Approved RCA, request for fix plan | Bugfix Plan (`docs/ai/prompts/bugfix-plan.md`) |
| New capability, enhancement, new UI/API/product behavior | Feature Plan (`docs/ai/prompts/feature-plan.md`) |
| Cleanup, rename, restructure, no intended behavior change | Refactor Plan (`docs/ai/prompts/refactor-plan.md`) |
| Question, explanation, code review, architecture review, discovery only | Read-only — no plan needed |
| Docker, CI/CD, hosting/deployment config | Infra Plan — Deep by default, operational-verification checklist instead of unit-test-first |

**Ambiguity rule:** if unsure, pick the safest lane — possible bug → RCA, possible new behavior → Feature Plan, possible no-behavior-change → Refactor Plan, possible billing/auth/roles/permissions/automations/jobs/webhooks/migrations/transactions → Deep by default.

After classifying, consult `docs/ai/module-ownership-map.md` for domain, likely FE/BE/DB areas, tests, and default risk. Missing → `UNMAPPED DOMAIN`. Stale or contradicts code → `CONTEXT DRIFT`.

Output classification before analysis:
```
Task Classification:
- Intent:
- Workflow:
- Task Size:
- Domain:
- Risk:
- Contract Areas:
- Next Action:
```

## Task Size Classification

- **Tiny** — docs, copy, comments, config, display-only. No behavior change. Minimal verification.
- **Express** — single-layer, 1-2 files, no DB/schema/API contract change, low regression risk.
- **Standard** — multiple files or FE-BE coordination. Requires contract verification + targeted tests.
- **Deep** — high-risk/production-critical: auth, roles, permissions, billing/payments, automations, jobs, webhooks, migrations, transactions, schema changes, core domain logic unique to this project *(filled in during bootstrap from discovery)*, external integrations. Requires full RCA/discovery, my explicit approval before plan, regression tests, manual QA, rollback notes.

Only downgrade Deep if repo evidence proves the task is isolated and low-risk.

## Output Modes

**Read-only findings** — question, review, explanation, discovery. Evidence-backed only. No source edits.

**RCA / Discovery** — bug RCA or risky investigation. No implementation. Stop after RCA, wait for my approval before planning.

**Implementation** — after plan approval (Standard/Deep) or directly for Tiny/Express. Include exact files, exact changes, verification commands, manual QA, rollback/risk notes when relevant.

## Plan Contract — deterministic, two-layer, strict

Every Standard/Deep plan (feature, bugfix, refactor) has exactly two layers. Neither is optional.

**Layer 1 — Human summary (readable in ~1 minute):**
- What & why in plain simple English; attach a visual (mermaid/ASCII diagram) or analogy whenever it makes the plan easier to grasp.
- **Risk Matrix** (mandatory Standard/Deep):

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|

- **Backward Compatibility Matrix** (mandatory Standard/Deep):

| Changed File / Symbol | Used By (outside this feature) | Breaks? | Handling |
|---|---|---|---|

- Keep Layer 1 short. If the reader would feel lazy seeing it, it failed — cut, don't compress into jargon.

**Layer 2 — Execution spec (the implementing model follows this exactly — zero improvisation):**
- Exact file paths for every touched file.
- Anchors = symbol names (function/class/component) + exact before/after code blocks. Line numbers are hints only, never the primary anchor — files drift between plan and execution.
- Required tests per file, in TDD order (failing test first).
- Verification commands from real package scripts only.

**Narrow Spec / Blast Radius Rule (strict):**
- The plan lists the exact allowed files. Implementation touches ONLY those files.
- Before finalizing any plan: search usages of every changed export/symbol across the repo. Anything outside the feature's scope that depends on a changed file goes in the Backward Compatibility Matrix as "affected, NOT modified — why it's safe (or why it isn't)."
- Mid-implementation need to touch an unlisted file → STOP, explain why, get re-approval, update both matrices first.

**By task size:**
- **Tiny** — no plan ceremony (no behavior change by definition).
- **Express** — one line instead of matrices: `Blast radius: <files>; external users: none / <list>`.
- **Standard/Deep** — full two-layer plan with both matrices.

**Mechanically enforced.** A hook at `.claude/hooks/check-plan-gate.sh` blocks source-file edits unless `.claude/.plan-ack` exists and is fresh (~4h — one approval covers an implementation session):
- Tiny/Express → write `{"size":"tiny|express","plan":"not-required","blast_radius":"<files or none>"}`
- Standard/Deep → write `{"size":"standard|deep","plan":"approved","matrices":"present"}` — only after the two-layer plan is actually approved. Writing `plan:"approved"` without a real approval is a contract violation, same severity as skipping tests.
The hook denies Standard/Deep edits when the ack lacks `plan:approved`. Like the predict-verify hook, it forces the decision to be recorded — the honesty of the recording is still on Claude.

## Bugfix RCA Contract

For bug reports, RCA first, no implementation steps yet. Required sections: Issue Selected, Bug Summary, Reproduction Flow From Code, FE/BE Investigation, FE-BE Contract Check (if applicable), Root Cause, Why Existing Code Allows The Bug, Eliminated Causes, Remaining Uncertainties, Confidence Level, Basic Solution Direction. Stop after RCA — wait for approval before planning implementation.

## Testing Requirement

Strict TDD, no exceptions, unless the project is confirmed during bootstrap to be a throwaway/prototype (in which case say so explicitly rather than silently skipping coverage). Write the failing test first, confirm it fails, implement until it passes. Every touched file needs unit coverage; user-facing or cross-layer flows also need e2e coverage. Missing tooling is not a reason to skip coverage — set it up first. Implementation isn't complete until its tests exist and pass.

**Verified test/verification commands:** *(auto-filled during bootstrap from actual package scripts — never invented)*

---

## docs/ai — Navigation Map

Purpose: a fast map so Claude can find the right code without re-deriving architecture from scratch every session. These are maps, not truth — see Source of Truth Rule above.

### Context Order — consult before broad search

1. `docs/ai/task-router.md`
2. `docs/ai/architecture-manifest.md`
3. `docs/ai/module-ownership-map.md`
4. `docs/ai/contracts/api-contracts.md`
5. `docs/ai/contracts/db-contracts.md`
6. `docs/ai/testing-strategy.md`
7. `docs/ai/risk-register.md`
8. `docs/ai/file-index/repository-map.md`
9. related test suites
10. target source files

All of the above are maps only, never proof. Final conclusions must be verified against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, and database definitions.

### Module Ownership Map Contract

`docs/ai/module-ownership-map.md` maps product/business domains to implementation areas. Map only — not proof of behavior.

Required columns:

| Domain | Frontend | Backend | Database / Schema | Jobs / Automations | Integrations | Tests | Risk | Notes |
|---|---|---|---|---|---|---|---|---|

**Starter domains:** *(auto-filled during bootstrap step 2/3 from actual folder structure, route files, and schema — real domains derived from discovery, not assumed from a generic SaaS template.)*

Risk values: Tiny / Express / Standard / Deep.

**Default Deep domains:** *(auto-filled: whatever discovery flagged as genuinely high-stakes — auth code, payment integration code, migration files, anything touching production data directly.)*

Unknown implementation areas → `TODO: Fill after repository analysis. Do not treat as verified.` Claude uses this map before broad search when a task references a business/domain area, but still verifies all domain conclusions against real source code.

### Risk Register Contract

`docs/ai/risk-register.md` maps high-risk project areas so Claude classifies risky work as Deep and plans safer verification. Map only, not proof.

Required columns:

| Risk Area | Why Risky | Default Task Size | Required Checks | Manual QA | Notes |
|---|---|---|---|---|---|

**Starter risk areas:** *(auto-filled during bootstrap from discovery — common candidates: Auth/Permissions, Billing/Payments, Database Migrations, External Integrations, Background Jobs/Queues, Production Deployment. Only include the ones actually present in this repo; don't pad with irrelevant categories.)*

If a task touches a listed high-risk area, default to Deep. Only downgrade if repo evidence proves the task is isolated and low-risk.

### Repository File Index (grep-avoidance rule)

`docs/ai/file-index/repository-map.md` exists specifically so Claude does not repeatedly grep/search the same symbols across sessions. It maps:

```
[symbol/function/class/component name] → path/to/file.ext:LINE — one-line purpose
```

organized by module/package. During bootstrap, pre-populate this with the actual exported functions/classes/components/routes found in step 1 — don't leave it empty for a "fill later" excuse when the discovery pass already had the information.

**Rule:** before running grep/glob/broad search over the repo, check `docs/ai/file-index/repository-map.md` first. If the symbol is indexed there, jump straight to the file:line — no search needed. If it's stale (line number no longer matches, or symbol moved/renamed), fall back to search, find the real location, and correct the index entry in the same turn — don't leave it wrong for the next session.

**Rule:** any time a new significant file, exported function, class, or component is created or moved, add/update its index entry in the same change — same discipline as the Documentation Sync Rule below, not deferred.

**What counts as "significant":** anything another session would plausibly need to find again — exported functions, public types, service classes, API routes, DB schema definitions, key UI components. Skip trivial internals (private helpers, one-off variables).

This index is a map, not proof — always verify the actual file:line still matches before relying on it for anything beyond navigation. If it's wrong, that's `CONTEXT DRIFT` — fix it, don't just work around it silently.

### Context Refresh Rule

Context docs go stale. When Claude discovers verified source-code facts that contradict a generated context doc: mark `CONTEXT DRIFT` (or `CONTRACT DRIFT` for API/DB/test/risk docs), say which file and section is stale, use source code as truth for the current task, **and fix the matching `docs/ai/*` entries in the same change** — drift fixes are not deferred. Scope discipline applies — touch only the rows/sections the drift actually affects.

For a full re-sync, use `docs/ai/context-refresh.md`:
- Read-only for source code — only context docs may be edited.
- No implementation planning, no feature work during a refresh.
- Verify every fact against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.
- Update architecture manifest, module ownership map, repository map, API contracts, DB contracts, testing strategy, and risk register from verified evidence.
- Don't invent missing areas — mark unknowns `TODO: Fill after repository analysis. Do not treat as verified.`

`docs/ai/context-refresh.md` itself needs these sections: Scope, Files To Refresh, Source Verification Rules, Drift Markers, Refresh Steps, Output Summary.

## Documentation Sync Rule

Every code change updates the matching `docs/ai/*` entries in the same change — not deferred. Touch only the rows/sections the change actually affects. No existing entry for a touched area → add one instead of leaving `UNMAPPED`.

## Quality Gate

Before calling anything done:
- Contract areas identified or marked `No contract impact`.
- Risk register notes filled for Standard/Deep.
- API and DB/schema changes documented, or explicitly marked "none required."
- Verification commands confirmed from package scripts or repo docs (never assumed).
- Required unit/e2e tests listed and passing, TDD order.
- Matching `docs/ai/*` entries updated.
- New/moved significant symbols reflected in `docs/ai/file-index/repository-map.md`.
- Plan followed the Plan Contract: two layers, Risk + Backward Compatibility matrices present per task size, blast radius searched and recorded, only allowed files touched.
- If this task matched the Learning Contract trigger (new pattern/library/design decision): prediction was captured BEFORE implementation and `learnings.md` was updated after. If it was skipped, the skip was stated explicitly with which existing pattern it matched — not silently bypassed.
- Deep tasks: explicit approval confirmed before implementation.
- Types match established shared contracts.
- *(Auto-filled: any project-specific invariant that must always hold, discovered from the codebase — e.g. tenant isolation if multi-tenancy code was found, currency handling if payment code was found, idempotency if job/queue code was found.)*
- The "why" was explained, with an analogy, not just the "what."

## Guardrails

- No speculative architecture beyond the current step.
- No unrelated refactors bundled into a feature change.
- No new dependency without flagging it and stating why.
- No schema/migration change without explicit confirmation.
- Do not modify unlisted files. Do not rename public APIs unless explicitly discussed.

---

## Learning Contract (Predict → Verify) — mechanically enforced

Standalone contract — does not assume any external "learn" skill exists. If this project has a `/learn` or similar skill installed later, reconcile the two then; until confirmed, this section is the only source of truth for the learning loop.

A hook at `.claude/hooks/check-predict-verify.sh` blocks source-file edits unless `.claude/.predict-verify-ack` exists and is fresh (written within the current work turn). This forces the trigger decision below to actually happen every time — it can't be silently skipped, only explicitly logged as skipped.

**Trigger:** any new pattern, library, or design decision not already established elsewhere in this repo.

When triggered:
1. Stop before writing implementation code.
2. Ask me to write my prediction first — function signature guess, what could break it, expected approach.
3. Wait for my prediction.
4. Write `.claude/.predict-verify-ack` with `{"status":"triggered","note":"<what's new>"}`.
5. Implement.
6. Diff explicitly: where the real implementation differs from my prediction, and *why* (tradeoff, not just difference).
7. Append one entry to `learnings.md` at repo root, automatically, without being asked:
```
## [date] — [feature/module]
**Predicted:** [one line]
**Actual:** [one line]
**Why different:** [one line — tradeoff, not just diff]
```

**Skip trigger** for repetitive work matching an already-established pattern in this repo. Write `.claude/.predict-verify-ack` with `{"status":"skipped","matches":"<existing pattern>"}` and state explicitly: "skipping predict-verify — matches [existing pattern]." When unsure whether something counts as new, default to triggering — cheap to ask, expensive to skip real learning.

---

## gstack

Check `~/.claude/skills/gstack` during bootstrap step 1. If it doesn't exist, delete this section, the SDLC Stage Map skill column, and the Skill Routing section below — don't leave dead references to skills that aren't installed (keep the Stage Map itself with "manual" in place of skills).

If it does exist: use `/browse` for all web browsing, never `mcp__claude-in-chrome__*` tools directly. Read the actual installed skill list from that directory rather than trusting any hardcoded list, and use it for routing below.

## SDLC Stage Map — maximize gstack

The full lifecycle, one default skill per stage. Use the matching skill by default — don't hand-roll a stage a skill already owns. Proactively suggest the next stage when the current one finishes (e.g. implementation done → offer `/qa` then `/review` then `/ship`). On repos without gstack, run the stage manually and say so.

| Stage | Default skill | When |
|---|---|---|
| Idea / scope | `/office-hours`, `/plan-ceo-review` | fuzzy product idea → sharpened scope |
| Spec | `/spec` | vague intent → backlog-ready spec |
| Bug RCA | `/investigate` | bugs/errors — feeds the RCA template |
| Plan review | `/plan-eng-review`, `/plan-design-review`, or `/autoplan` (full pipeline) | Standard/Deep plans, before approval |
| Implement | this contract (Plan Contract + TDD + Learning Contract) | after plan approval |
| QA | `/qa` (test + fix) or `/qa-only` (report only) | after implementation |
| Code review | `/review` | pre-landing diff check |
| Visual polish | `/design-review` | any UI-touching change |
| Ship | `/ship` or `/land-and-deploy` | tests green + review clean |
| Post-deploy | `/canary` | after production deploy |
| Release docs | `/document-release` | after ship |
| Code health | `/health` | periodic quality dashboard |
| Retro / learning | `/retro` + Learning Contract | weekly, and after Deep tasks |
| Save / resume context | `/context-save` / `/context-restore` | long-running or multi-session work |

## Skill Routing *(only if gstack section above wasn't deleted)*

Stage Map above = proactive (lifecycle order). This list = reactive (match the request as it arrives). Invoke the matching skill when a request fits. When in doubt, invoke it.

- Product ideas/brainstorming → `/office-hours`
- Strategy/scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system/plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs/errors → `/investigate`
- QA/testing site behavior → `/qa` or `/qa-only`
- Code review/diff check → `/review`
- Visual polish → `/design-review`
- Ship/deploy/PR → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
- Backlog-ready spec/issue → `/spec`
- New pattern/design decision worth internalizing → run the Learning Contract above

## Design System

During bootstrap, check for `DESIGN.md` or equivalent (Storybook config, design tokens file, style guide). If found, read it before any visual/UI decision — font, color, spacing, aesthetic direction all live there, no deviation without explicit approval, flag anything that doesn't match. If nothing like this exists, delete this section rather than referencing a file that isn't there.
