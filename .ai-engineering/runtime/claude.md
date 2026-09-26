# Claude Runtime Rules

Claude follows the same operating model.

Use for:

- analysis
- planning
- implementation (directly, or through the generated personas in
  `.claude/agents/`)
- review

All outputs follow agent contracts.

## Precedence in this repository

Existing project instructions win. This package adds structure; it never
overwrites established rules.

1. `AGENTS.md`, imported by `CLAUDE.md` through `@AGENTS.md` — the always-on
   workflow core (Canonical Task Flow, core principles, stop conditions, agent
   routing). `CLAUDE.md` itself holds the project facts, invariants, verified
   commands and don't-do list.
2. `DESIGN.md` and `packages/ui/src/globals.css` — visual decisions.
3. `docs/ai/*` — phase docs loaded at their flow node (`task-router.md`,
   `planning.md`, `plan-template.md`, `execution.md`, `handoff.md`,
   `pr-evidence.md`) and navigation maps (architecture manifest, module
   ownership map, contracts, testing strategy, risk register, repository map).
4. `.ai-engineering/*` — agent roles, lifecycle states, evidence and reporting
   templates.

Where they overlap, the higher entry is authoritative. Conflicts that cannot be
resolved at equal authority are `BLOCKED_HUMAN`.

## Mapping to existing project contracts

- Lifecycle `PLANNED` requires a plan built from `docs/ai/plan-template.md`
  (Risk Matrix + Backward Compatibility Matrix for Standard/Deep), approved by
  the user; Deep work also needs its RCA or discovery approved first.
- Lifecycle `BUILDING` follows Strict TDD: `bun run tdd:red` records a valid RED
  before guarded source changes (`docs/ai/testing-strategy.md`).
- Legal transitions and their guards: `.ai-engineering/core/task-state-machine.md`.
- Implementer and QA evidence uses the verified package scripts listed in
  `.ai-engineering/config/autonomous-engineering.yaml`.
- `docs/ai/*`, `docs/ai/file-index/repository-map.md` and `learnings.md` are
  updated in the same change (`docs/ai/handoff.md`).
- Source edits are gated by `.claude/hooks/check-plan-gate.sh` (plan state) and
  `scripts/hooks/tdd-red-guard.mjs` (RED marker), both wired in
  `.claude/settings.json`.
- Structured autonomous work orders are disabled while the yaml says
  `activation: PILOT_FROZEN` (`docs/ai/autonomous-engineering.md`).

Source of truth is real code, tests, types, schemas, routes, and migrations.
Maps are never proof.
