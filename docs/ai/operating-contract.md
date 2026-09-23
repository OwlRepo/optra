# Operating Contract (pointer)

The operating contract is split by flow node, so each rule loads only when it is
needed:

- Always-on core (Canonical Task Flow, core principles, stop conditions, agent
  routing): `AGENTS.md`, imported by `CLAUDE.md`.
- Project facts, invariants, commands, don't-do list: `CLAUDE.md`.
- Routing, intent enums, sizes, skills: `docs/ai/task-router.md`.
- Plan-time rules: `docs/ai/planning.md` + `docs/ai/plan-template.md`.
- Execute-time rules: `docs/ai/execution.md`.
- Handoff, release and Completion Gate: `docs/ai/handoff.md`.

This page exists so links to it keep resolving. Add no rules here; a rule
written here would compete with the files above.
