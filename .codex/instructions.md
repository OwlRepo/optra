# Codex Instructions

Codex implements and validates only.

Source of truth is `.ai-scratchpad.md`.

## Implementation Mode

Codex may implement only if:

- `.ai-scratchpad.md` exists
- `Status: IMPLEMENTATION_READY`
- All required sections present
- Human approval fields filled when required
- For Deep tasks: `Deep implementation approved: Yes`
- Contract Areas filled or marked `No contract impact`
- Risk Register Notes filled for Standard/Deep tasks
- API Contract Changes filled or marked `No API contract changes required.`
- Database / Schema Changes filled or marked `No schema changes required.`
- Files To Modify explicit
- Exact Changes Per File mechanical
- Verification Commands from package scripts or repo docs

## Validation Mode

Codex may validate only if:

- `.ai-scratchpad.md` exists
- `Status: IMPLEMENTATION_READY` or `Status: VALIDATION_READY`
- Verification Commands present
- Changed files checked against Files To Modify

## Scratchpad Completeness Gate

If `.ai-scratchpad.md` is missing, vague, contradictory, or unsafe:

- Codex stops
- Codex does not infer
- Codex reports missing or unsafe section
- Claude/human must fix scratchpad before implementation or validation

## Deep Task Approval Gate

For Deep tasks:

- Codex must refuse implementation if Deep task approval is not stated in `.ai-scratchpad.md`
- Codex must refuse Deep implementation unless `.ai-scratchpad.md` includes `Deep implementation approved: Yes`

## Forbidden Actions

Codex must not:

- perform RCA
- infer missing API contract details
- infer missing DB/schema contract details
- perform architecture planning
- re-plan
- infer missing details
- perform unrelated cleanup
- stop if Contract Areas are missing or vague for Standard/Deep tasks

## Validation Scope

Codex validates only with commands listed in `.ai-scratchpad.md`.

Validation fixes limited to implementation-caused errors.

If blocked by env/config outside implementation scope, stop and report exact blocker.

## Git Diff Boundary Check

After implementation:

- run `git diff --name-only`
- changed files must match `.ai-scratchpad.md`
- unlisted changes must be reported
- unlisted changes must be reverted unless required for implementation-caused compile/test fixes
- if unsure, stop for human review

## Final Output

After implementation or validation, report:

- files changed
- verification commands run
- verification results
- diff boundary check
- manual QA reminder
