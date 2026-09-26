# Handoff and Integration

> Purpose: everything between "code validated" and "task done": reconcile, push, PR, docs and learnings sync, final report.
> Load rule: read at flow node `W` (`AGENTS.md`), before declaring any task done. The Completion Gate below is mandatory.
> Source of truth: `.github/workflows/deploy.yml`, git history and `package.json` beat this map.

## Integration sequence (the one list)

1. Confirm the worktree and branch belong to this task and the diff contains
   nothing unrelated.
2. Commit every validated change with focused messages
   (`<type>(<scope>): <description>`, no `Co-Authored-By` trailer).
3. `git fetch origin`, then reconcile with the PR's target base: `origin/main`,
   or the parent slice's branch for a stacked slice ("Release flow" below).
   Rebase only a branch that has never been pushed for review; once a PR is
   open, merge the target into the branch instead of rebasing.
4. Resolve conflicts from both sides' intent, never blanket ours/theirs. If a
   conflict forces a choice between two product behaviours, stop and ask.
5. Re-run all required validation after reconciling, and review the
   post-reconcile diff.
6. Push: `git push --set-upstream origin <branch>` the first time. After
   rebasing an already-pushed branch (only allowed before review, step 3):
   `git push --force-with-lease origin <branch>`, and only then. The remote URL
   must use the SSH alias for the repo owner's GitHub identity; run
   `gh auth switch` to that identity before any `gh` command.
7. Do NOT create, approve, merge or close a pull request unless the user
   explicitly asks in chat. (Structured work orders could authorise this, but
   they are disabled while `activation: PILOT_FROZEN`,
   `docs/ai/autonomous-engineering.md`.) Read `docs/ai/pr-evidence.md` before
   creating any PR; a PR without the evidence its Change Type needs stays a
   draft. Never push to `main`; never delete the branch or worktree
   automatically.
8. After a PR merges, every dependent or overlapping branch reconciles with the
   new base before its own merge. Never merge several completed worktrees at the
   same time without coordinating the order.

Manual testing happens in the task worktree against the running dev stack
(`docs/ai/dev-environment.md`). From another checkout:
`git fetch origin && git switch --track origin/<branch>`.

## Release flow (task branch → main)

Optra has one deployed environment. No dev or stg branch or environment exists
(`docs/PRODUCTION-READINESS.md` row F4, "Staging env: None").

1. One task branch → ONE PR into `main`.
2. The PR runs the `ci` job ("Quality gate") of `.github/workflows/deploy.yml`:
   the test-layer guard (`scripts/check-test-layers.spec.sh`,
   `scripts/check-test-layers.sh`) and `scripts/check-prod-env.spec.sh` first,
   then the PR-only TDD gate, script tests, agent-definition lint, type-check,
   lint, every unit suite, API e2e (`apps/api` `bun run test:e2e`) and the
   Playwright suite (`apps/e2e` `bun run test:e2e`).
3. Merge with **"Create a merge commit"**, which is how history lands here
   (`Merge pull request #…` commits in `git log`). Do not squash a branch that
   has stacked slices built on it: squashing rewrites the history the child
   branches share, and their PRs then show the parent's whole diff again.
4. The push to `main` runs `ci` again and then `deploy` (`needs: ci`), which
   SSHes to the VPS and runs, in order: `scripts/check-prod-env.sh .env
   .env.example`; `scripts/backup.sh --reason=deploy` (dumps the `optra`
   database, and `umami` when it exists, and proves each dump restores before
   continuing); `build api` and `build web`; `up -d --remove-orphans
   --force-recreate`; api and web health checks; a production S3 round trip;
   and, only with `COMPOSE_PROFILES=public`, a public HTTPS smoke. The API
   container applies pending migrations on start (`apps/api/Dockerfile` `CMD`).

Traps (from `docs/ai/risk-register.md` "CI Quality Gate"): the workflow ignores
pushes and PRs that only change `**/*.md` or `docs/**`, so a docs-only merge
does not redeploy (use `workflow_dispatch`), and a docs-only PR shows no checks
at all. Both e2e layers (`apps/api` API e2e and `apps/e2e` Playwright) are CI
steps that gate deploy, so a red e2e run blocks the release.

### Stacked slices

When a slice builds on an unmerged parent slice:

- Branch from the parent: `scripts/new-task-worktree.sh <type> <name> <parent-branch>`.
- The PR targets the parent branch, so its diff shows only this slice.
- Run RED against the parent: `TDD_RED_BASE=<parent-branch> bun run tdd:red`.
  (CI's gate compares against the PR's base branch automatically.)
- When the parent merges into `main`, merge `origin/main` into the child branch,
  retarget its PR to `main`, and confirm the diff still contains only the
  child's commits before it merges.

## Docs and learning sync (same change, mandatory)

- Update `docs/ai/file-index/repository-map.md` for every new or moved
  significant symbol (exported functions, services, controllers and routes,
  schema definitions, key components, workflow scripts), and the matching
  `docs/ai/*` contract, ownership, risk, architecture or testing entry. Scope it
  to what changed; never a blanket re-index. Stale entries found along the way
  are fixed in the same change (`CONTEXT DRIFT`).
- API or DB contract changes are written into
  `docs/ai/contracts/api-contracts.md` / `docs/ai/contracts/db-contracts.md`,
  or the plan states `No contract impact`.
- Append one entry to `learnings.md` for any new pattern, library or design
  decision, in its existing format (`Predicted` / `Actual` / `Why different`).
  The **Predicted** line is taken from the approved plan; nobody is asked for a
  live prediction. **Why different** names the tradeoff, not just the diff.

## Final integration gate (multi-task batches)

After every task in a batch has merged: the full relevant test suites,
type-check, lint, production build, migration check against a database that
holds data, browser QA of the affected flows, and cross-task regression checks.
Changes that are each correct must also work together.

## Completion Gate

A task is not complete until ALL of these hold:

- Changes committed; branch reconciled with its target base; validation re-run
  green afterwards; branch pushed.
- Exact branch and latest commit SHA reported; the remote branch is ready for
  manual testing, or the evidence says why manual testing is not required.
- No PR created or merged without the user's explicit instruction.
- Docs and learning sync done (section above), including the `learnings.md`
  entry when the task introduced something new.
- Graphify: `/graphify . --update`, then `scripts/graphify-complete.py`, ran
  after the final indexed edit (and again after any corpus-changing rebase or
  edit), per `docs/ai/planning.md` "Closeout refresh"; its coverage pass check
  held, and its graph diff and semantic token evidence were reviewed. A
  skipped or failed refresh blocks completion.
- If a PR exists: its checks are green, verified with `gh pr checks <number>`,
  never assumed. Whether GitHub branch protection is enforced on `main` is
  UNVERIFIED, so assume a red PR can still be merged; checking by hand is part
  of the gate, not a formality. If `gh pr checks` shows no checks (docs-only
  PR, `paths-ignore`), say so explicitly.
- Any `TDD-Waiver:`, `E2E-Waiver:` or `Migration-Waiver:` used is listed in the
  PR body and in the final report.

## Required final report

- Task summary, implemented behaviour, files changed and created.
- Compatibility: behaviour preserved, public contract impact, migration and
  rollout impact.
- Validation: each command run and its result (tests per workspace, type-check,
  lint, build, e2e, `tdd:red` output). Never claim a check that did not run.
- Graphify evidence: exact command/mode, changed-file count, graph diff,
  semantic input/output tokens (actual, or a labelled bounded estimate and its
  method), the coverage check (`graphify-out/COVERAGE_REPORT.md` detected ==
  represented source files, 0 missing/dangling endpoint edges,
  `graph.json` has `coverage`), and any integrity warning.
- Review findings: resolved, and remaining risks.
- Git state: worktree path, local branch, remote branch, target base, latest
  commit SHA, commits created, reconcile status.
- Manual test scenarios plus the commands to switch to the branch and start the
  stack, or `NOT REQUIRED` with evidence.

End with this exact status block:

```text
Ready for manual testing: YES/NO/NOT REQUIRED
Ready for PR creation: YES/NO
PR created: YES/NO
Merged: YES/NO
Production verified: YES/NO/NOT APPLICABLE
```
