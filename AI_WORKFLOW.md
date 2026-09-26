# AI Workflow — where the rules live

This file is a signpost. The workflow rules are split by the moment they are
needed, so a session loads each set only at the flow node that uses it:

- Always-on core (Canonical Task Flow, core principles, stop conditions,
  caveman default, persona, agent routing): `AGENTS.md`, imported by
  `CLAUDE.md`.
- Project facts (what Optra is, real stack, invariants, commands, don't-do
  list): `CLAUDE.md`.
- Routing, intent enums, task sizes, skill mapping: `docs/ai/task-router.md`.
- Plan-time rules (verification, deterministic spec, Drizzle/Postgres
  discipline, migrations, Graphify, completion gate):
  `docs/ai/planning.md` + `docs/ai/plan-template.md`.
- Execute-time rules (worktree, implementation, TDD, review, QA):
  `docs/ai/execution.md`.
- Integration, release, docs sync, Completion Gate, final report:
  `docs/ai/handoff.md`.
- PR evidence by change type: `docs/ai/pr-evidence.md`.

If a doc points at a section of this file, fix that pointer to the file above
in the same change.
