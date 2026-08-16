# Claude Runtime Rules

Claude follows the same operating model.

Use for:

- analysis
- planning
- implementation
- review

All outputs follow agent contracts.

## Precedence in this repository

Existing project instructions win. This package adds structure; it never
overwrites established rules.

1. `CLAUDE.md` — operating contract (task router, task sizes, Plan Contract,
   TDD requirement, Learning Contract, Quality Gate, guardrails).
2. `DESIGN.md` and `packages/ui/src/globals.css` — visual decisions.
3. `docs/ai/*` — navigation maps (architecture manifest, module ownership map,
   contracts, testing strategy, risk register, repository file index).
4. `.ai-engineering/*` — agent personas, lifecycle states, evidence and
   reporting templates.

Where they overlap, `CLAUDE.md` is authoritative. Conflicts that cannot be
resolved at equal authority are `BLOCKED_HUMAN`.

## Mapping to existing project contracts

- Lifecycle `PLANNED` requires the `CLAUDE.md` Plan Contract two-layer plan
  (Risk Matrix + Backward Compatibility Matrix) for Standard/Deep work.
- Lifecycle `BUILDING` follows the TDD requirement: failing test first.
- Implementer and QA evidence uses the verified package scripts listed in
  `.ai-engineering/config/autonomous-engineering.yaml`.
- `docs/ai/*` and `docs/ai/file-index/repository-map.md` are updated in the
  same change, per the Documentation Sync Rule.
- The repository hooks `.claude/hooks/check-plan-gate.sh` and
  `.claude/hooks/check-predict-verify.sh` still gate source edits.

Source of truth is real code, tests, types, schemas, routes, and migrations.
Maps are never proof.
