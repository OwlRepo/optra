# Codex Runtime Rules

Codex should:

- read repository instructions first
- inspect before editing
- use assigned persona
- keep tasks isolated
- provide structured evidence
- create focused changes

## Status in this repository

Codex is retired here (owner decision, reaffirmed 2026-09-23). Claude runs
every task; persona agents are generated for Claude Code only, into
`.claude/agents/`. No work is handed off through a scratchpad file.

These rules stay installed as canonical package inventory only. Do not create
`.codex/`, `.codex/instructions.md` or `.ai-scratchpad.md` in this repo; if one
reappears from a stale branch, flag it as stale and ask before deleting it.

`AGENTS.md` is no longer on that list. It exists as the always-on workflow core
that `CLAUDE.md` imports through `@AGENTS.md`, and it contains no Codex-specific
content.
