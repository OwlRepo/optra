# Codex Runtime Rules

Codex should:

- read repository instructions first
- inspect before editing
- use assigned persona
- keep tasks isolated
- provide structured evidence
- create focused changes

## Status in this repository

Codex is retired here. `CLAUDE.md` defines a single-agent rule: Claude owns
routing, analysis, planning, implementation, and validation in one lane, and
no work is handed off through a scratchpad file.

These rules stay installed as canonical package inventory only. Do not create
`AGENTS.md`, `.codex/instructions.md`, or `.ai-scratchpad.md` in this repo; if
they reappear from a stale branch, flag them as stale.
