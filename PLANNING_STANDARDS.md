# Planning Standards — where the rules live

The canonical planning rules are in two files, both MANDATORY reads before any
plan is written (`AGENTS.md`, flow node `L`):

- `docs/ai/planning.md` — repository verification, phases and the model-switch
  stop, Drizzle/Postgres discipline, migrations (canonical), Graphify, closing
  scans, forbidden language, the plan completion gate.
- `docs/ai/plan-template.md` — the plan skeleton: TL;DR, flowchart,
  `Docs loaded:` line, Risk Matrix, Backward Compatibility Matrix, phases,
  validation.

This page mirrors the two gates that can never be skipped, for readers who land
here first. The wording in `docs/ai/planning.md` is authoritative.

## Non-bypassable evidence gate

No plan may state a cause it has not tried to disprove. Each causal claim names
the evidence for it and the observation that would prove it wrong; a claim that
no available check can falsify is labelled a hypothesis. Each measurement says
what it divides by and why the sample fits that metric (fixed overhead
amortised or reported apart, warm/cold cache state controlled). A claim made and
later disproved goes in the plan's `Claims reversed while investigating` line;
it is never quietly replaced.

## Non-bypassable Graphify gate

Every implementation ends with a Graphify refresh: after the last edit to any
indexed file, and before review, commit and handoff, load the graphify skill and
run `/graphify . --update` from the repo root. Plain `graphify update .` is
acceptable only when the change touched code alone, because that CLI shortcut
does AST extraction only; docs need the skill's incremental semantic pass. Run
it again after any later indexed edit or a rebase that changes indexed files.

The task is not complete if the refresh is skipped or fails, or if its graph diff
and token cost are not reported. Output written only by the refresh itself does
not trigger a second refresh. The command-selection and token rules are in
`docs/ai/planning.md` "Mandatory Graphify phase".
