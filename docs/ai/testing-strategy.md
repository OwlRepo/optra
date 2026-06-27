# Testing Strategy

Purpose:

Map task size and risk to expected verification.

This file is map only.

Commands must be verified from package scripts or repo docs before being listed as valid.

Claude must discover commands from package scripts or repo docs.

Default command candidates may be mentioned but not claimed as valid unless verified.

If verification cannot run due to environment/config, mark blocker.

Deep tasks require rollback/risk notes and manual QA.

---

## Verification By Task Size

| Task Size | Minimum Verification                                                   | Extra Verification                                            | Manual QA           | Notes                                          |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| Tiny      | targeted read-through or formatting check                              | none                                                          | visual/read-through | no behavior change                             |
| Express   | targeted type/lint/test if available                                   | related test if available                                     | focused flow        | single-layer change                            |
| Standard  | verified type/lint/test/build commands if available + related tests    | regression test when relevant                                 | affected workflow   | FE-BE or multi-file changes                    |
| Deep      | verified type/lint/test/build commands if available + regression tests | migration/payment/job/webhook/permission checks when relevant | full critical flow  | billing/payments/auth/jobs/schema/transactions |

---

## Command Discovery Rules

Claude must verify commands from:

1. `package.json` scripts
2. repository documentation
3. CI/CD configuration

Do not claim commands as valid unless verified.

If command does not exist in package scripts or repo docs, mark as unavailable or propose alternative.
