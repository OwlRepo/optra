# Learnings

Predict → Verify log, per the Learning Contract in `CLAUDE.md`. One entry per new pattern, library, or design decision: I write a prediction before implementation, Claude implements, then we diff prediction vs. reality here. Appended automatically by Claude — the value is in the "why different" line (the tradeoff), not the diff itself.

Entry format:

```
## [date] — [feature/module]
**Predicted:** [one line]
**Actual:** [one line]
**Why different:** [one line — tradeoff, not just diff]
```

<!-- Entries below, newest first. -->

## 2026-07-08 — F1 frontend/XLSX finish + Docker root-cause chase
**Predicted:** no prediction solicited — user directed "do both now, make sure it's done first."
**Actual:** Frontend + XLSX landed cleanly. The Docker verification chased through FOUR distinct real bugs before revealing a genuine architectural blocker: (1) Alpine musl can't load DuckDB's glibc binary, (2) fixed base image but then discovered `docker compose build` was silently building into a detached buildx builder instance and never loading the result into the local image store (my own exit-code check was also wrong — `cmd | tail` reports tail's exit code, not cmd's, which hid a real build failure for two attempts), (3) once building correctly, Debian's `--no-install-recommends` skipped `ca-certificates`, breaking all HTTPS installs, (4) once THAT was fixed, the real blocker: no Linux ARM64 prebuilt binary exists for `duckdb@1.4.4`, and there's no C++ toolchain to compile from source.
**Why different:** Each layer looked like "the" bug until verified end-to-end — a lesson in not declaring victory on the first plausible-looking fix. Left the two genuine improvements (Debian base, ca-certificates) in place since they're correct regardless; did not attempt a toolchain install or platform-forcing fix without the user's input, since compiling DuckdB from source or changing target architecture materially changes build time/deploy shape and deserves an explicit decision.

## 2026-07-08 — V2 slice S1+F1 (structured CSV querying / DuckDB)
**Predicted:** No user prediction was solicited for this slice specifically — implementation proceeded under a broad "continue autonomously, ensure the plan is implemented correctly" instruction rather than a per-slice Learning Contract prediction. Documenting real discoveries instead.
**Actual:** The approved plan's hardening design (physical isolation + `enable_external_access=false` + keyword filtering) was implemented as designed, but empirically verified with a throwaway spike BEFORE writing the real service, not assumed correct from the plan text alone.
**Why different:** Verification surfaced something better than the plan anticipated — DuckDB doesn't just block filesystem access after lockdown, it refuses to let `enable_external_access` be re-enabled for the connection's lifetime ("Cannot change enable_external_access setting while database is running"), a genuine engine-level one-way lock. That doesn't remove the need for the keyword-based DDL/DML filter (CREATE/DROP/INSERT/etc. still work against the already-loaded in-memory table without needing filesystem access), but it meant one layer of the defense-in-depth design was stronger than assumed. Separately, two real bugs only surfaced under test: (1) DuckDB's Node driver returns aggregate results (`SUM`, etc.) as JS `bigint`, which crashes `JSON.stringify` — sanitized to `Number` before results leave `DuckDbQueryService`; (2) drizzle-kit generates an invalid quoted `"vector(1536)"` type declaration for this pgvector customType in fresh migrations (same issue hit in S3's migration) — now a documented, repeatable fix rather than a surprise each time.

## 2026-07-08 — V2 slice S3 (chat_query_metrics telemetry)
**Predicted:** "New table storing chat query metrics to be used later for related features such as auto FAQ generation."
**Actual:** New additive `chat_query_metrics` table (correct), but the real work was wiring a fire-and-forget-shaped write hook into the three-branch hot chat path without changing existing behavior: exporting `classifyQuery` from the `@repo/ai` barrel (it wasn't public), making `persistAssistant()` return the new message id, skipping embedding on exact-cache hits to avoid extra OpenAI cost on the cheapest path, and hand-fixing a drizzle-kit-generated `"vector(1536)"` (quoted, invalid) to the unquoted form the two existing pgvector migrations use.
**Why different:** A genuinely fire-and-forget (`.catch()`, not awaited) write created a real race — `onComplete` could resolve before the insert landed, invisible in production (nobody observes the timing) but a flaky/failing assertion in tests, and more fragile in general for a per-request Node handler with no background-job supervisor. Switched to `await write().catch(handler)`: still isolates failures from the response (never rejects), but now deterministic. Also decided nullable embeddings over always-embedding, since exact-cache hits are the least interesting rows for the topic-gap clustering this table exists to feed (F7a) — not worth an extra embedding call on every cache hit just for telemetry completeness.
