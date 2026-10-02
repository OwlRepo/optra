# Fix B9 — a flag's delta is the exact difference

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed.

- **Classification:** BUG_FIX · Standard (one service method, no schema or queue change) · Procurement match engine.
- **Contract areas:**
  - API: `delta` on new flags can carry more than two decimals, for example `-0.0033`; whole-number and cent deltas are unchanged.
  - DB: none. `discrepancy_flags.delta` is unscaled `numeric`.
  - Web: none. The discrepancies page prints `delta` as given.
- **Root cause:** `ComparisonService.diff` returned `Math.round((a - b) * 100) / 100`.
  - A mismatch smaller than half a cent became 0. For `0.33 - 0.3333`, `Math.round(-0.33)` is `-0`, and `String(-0)` is `'0'`.
  - That held for every delta: quantity, price, missing, receipt and contract variance.
  - The engine flags any non-equal price (`IS DISTINCT FROM`), so such a flag claimed a mismatch with delta `0`.
- **Fix:** `diff` returns exact decimal text, so callers no longer go through `numToStr(diff(...))`.
  - Each double is read from its shortest round-trip text, which is the decimal the document stated. Values from `ROUND(SUM, 6)` come back the same way.
  - The values are scaled to BigInt, subtracted and formatted without trailing zeros.
  - Zero prints as `0`, never `-0`.
- **Found while implementing:** Postgres `numeric` stores `1e400` (it passes `DECIMAL_PATTERN`), but DuckDB reads it as `Infinity`, and BigInt conversion threw. A non-finite side now gives a `null` delta. The test was written and seen failing first.
- **Not changed:** flags already written keep their stored deltas, because runs are append-only. A re-compare writes exact ones.
- **Tests first (RED `ff33ddb`: 4 unit + 1 API e2e; the infinity case was added in the fix commit after it was seen failing):**
  - Unit `exact deltas (B9)` (5 in all): `error:` infinite double, `edge:` fractional quantity, `edge:` float noise, `regression:` sub-cent price, `happy:` whole and cent deltas.
  - API e2e (1).
  - No page changed, so no browser test.
