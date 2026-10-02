# Finalize: restore pre-B8 file names; fix the two flaky tests

Owner instructions 2026-10-03: "lets fix all on this PR to finalize everything". Data rewrite approved explicitly ("Approve migration").

- **Migration `0035_white_ricochet.sql`.** Classification: Deep (production data). It is not additive: the repo rule allows a data rewrite only with the owner's explicit approval, which was given.
  - It rewrites `name` in `purchase_orders`, `invoices`, `goods_receipts` and `catalogs`.
  - A row is changed only when every character is at most U+00FF, at least one is above U+007F, and the bytes re-read as valid UTF-8. That is the `decodeUploadFilename` rule.
  - Correct names fail that test, so the migration is idempotent.
  - Storage keys and objects are untouched.
  - It raises a NOTICE with the count of restored rows per table.
  - Rollback per row: `convert_from(convert_to(name, 'UTF8'), 'LATIN1')`.
  - Tests (RED `2aeabee`): a parity spec that runs the migration file, plus an idempotence check.
- **Flake 1, `socket hang up` in API e2e.**
  - Root cause: supertest closes the server after every request, and Node 19+'s keep-alive agent reused a socket on a recycled ephemeral port.
  - Fix: the e2e harness turns keep-alive off (`jest-e2e.setup.ts`). A guard case lives in `auth.e2e-spec.ts` (RED `3287e63`).
- **Flake 2, catalog reconcile unit test.**
  - Root cause: the scrape reconciler correctly sweeps the whole shared database, and a parallel worker running its spec failed this spec's fixture.
  - Fix: the test asserts only the parse reconciler's own outcomes.
