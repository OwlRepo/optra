# Risk Register

Purpose:

Map high-risk project areas.

This file is map only.

It is not proof of behavior.

If task touches listed high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

Verify risk against source code and related contracts.

If risk area is missing, mark `UNMAPPED RISK`.

---

## Risk Areas

| Risk Area              | Why Risky                                    | Default Task Size | Required Checks                        | Manual QA              | Notes                                    |
| ---------------------- | -------------------------------------------- | ----------------- | -------------------------------------- | ---------------------- | ---------------------------------------- |
| Billing                | Revenue impact, customer trust               | Deep              | DB invariants, mutation paths, tests   | Full billing flow      | Verify against DB contracts              |
| Payments               | Financial transactions, compliance           | Deep              | Transaction safety, rollback, tests    | Full payment flow      | Verify against DB contracts              |
| SMS Credits            | Resource billing, cost control               | Deep              | Credit balance invariants, tests       | Credit flow            | Verify against DB contracts              |
| Plan Upgrades          | Subscription state, feature access           | Deep              | Plan state invariants, tests           | Upgrade/downgrade flow | Verify against DB contracts              |
| Auth / Permissions     | Security, access control                     | Deep              | Auth flows, permission checks, tests   | Full auth flow         | Verify against auth middleware           |
| Automations            | Background behavior, side effects            | Deep              | Job safety, idempotency, tests         | Automation trigger     | Verify against job queue contracts       |
| Jobs                   | Background processing, retry logic           | Deep              | Queue safety, idempotency, tests       | Job execution          | Verify against job queue contracts       |
| Webhooks               | External integrations, failure handling      | Deep              | Webhook safety, retry, tests           | Webhook flow           | Verify against integration contracts     |
| Database Migrations    | Schema changes, data integrity               | Deep              | Migration safety, rollback, data check | Pre/post migration     | Verify against migration tooling         |
| Transactions           | Data consistency, atomicity                  | Deep              | Transaction boundaries, rollback       | Transactional flow     | Verify against DB contracts              |
| External Integrations  | Third-party dependencies, failure modes      | Deep              | Error handling, retry, tests           | Integration flow       | Verify against integration documentation |
| Production Deployment  | Availability, rollback, monitoring           | Deep              | Deploy safety, rollback plan           | Smoke test             | Verify against deployment docs           |
