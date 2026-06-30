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
| Workspaces / RBAC      | Tenant boundary, member removal, invite misuse | Deep            | Membership invariants, guard order, tests | Invite/member flow  | Enforce RBAC server-side; keep ≥1 owner per workspace; single-use invite token with expiry |
| Automations            | Background behavior, side effects            | Deep              | Job safety, idempotency, tests         | Automation trigger     | Verify against job queue contracts       |
| Jobs                   | Background processing, retry logic           | Deep              | Queue safety, idempotency, tests       | Job execution          | Verify against job queue contracts       |
| Webhooks               | External integrations, failure handling      | Deep              | Webhook safety, retry, tests           | Webhook flow           | Verify against integration contracts     |
| Database Migrations    | Schema changes, data integrity               | Deep              | Migration safety, rollback, data check | Pre/post migration     | Verify against migration tooling         |
| Transactions           | Data consistency, atomicity                  | Deep              | Transaction boundaries, rollback       | Transactional flow     | Verify against DB contracts              |
| External Integrations  | Third-party dependencies, failure modes      | Deep              | Error handling, retry, tests           | Integration flow       | Verify against integration documentation |
| Production Deployment  | Availability, rollback, monitoring           | Deep              | Deploy safety, rollback plan           | Smoke test             | Verify against deployment docs           |

## Current Notes

- SeaweedFS / S3-compatible storage is a live external-integration risk as of Slice 3A.
  Required checks:
  - container comes up and S3 endpoint responds
  - `StorageService.ensureBucket()` is idempotent
  - save/get/delete round-trip passes against the real endpoint

- Migration `0001_panoramic_spiral.sql` changes document storage semantics.
  Required checks:
  - `documents.storage_key` exists after apply
  - `chunks.document_id` FK includes `ON DELETE CASCADE`
  - rerunning schema generation shows no diff

- Documents / ingest queue is a live jobs risk as of Slice 3B.
  Required checks:
  - upload creates SeaweedFS object + `documents.status='pending'`
  - Bull job uses retry `attempts=3` with exponential backoff
  - processor always cleans temp files in `finally`
  - processor writes terminal `done` or `failed`, never leaves stuck `processing` on handled errors
  - `syncChunks()` receives tenant metadata and document/workspace ids

- OpenAI embeddings are now in the document ingest critical path.
  Required checks:
  - upload path does not require a working OpenAI key to return `201 pending`
  - embed failure isolates to the document row (`status='failed'`) and does not crash the worker
  - retry remains safe because chunk sync is content-hash diff based

- Priority 2 workspace/knowledge-base/document pages now poll document status client-side.
  Required checks:
  - `setInterval` is created only while at least one document is `pending` or `processing`
  - the interval is cleared on unmount/navigation so route changes do not leak background polling
  - 401s from any workspace/KB/document page route back to `/login`

- Web crawling for knowledge-base sources is a live jobs + external-integration + quota risk as of 2026-06-30.
  Required checks:
  - crawler stays same-origin, honors robots.txt, sets explicit User-Agent, throttles requests, and caps depth/pages
  - crawler tests never hit live network (`fetchImpl` injected)
  - `scrape_runs` always reaches terminal `completed` or `failed`, never hangs in `running` on handled errors
  - page-level crawl persistence failures increment `pagesFailed` without aborting whole run
  - workspace doc quota clamps `maxPages` before queueing
  - recrawl of same page upserts one `documents` row by `(knowledge_base_id, source_url)` and reuses ingest safely
  - web page polls crawl runs every 3 seconds only while a run is `queued` or `running`
