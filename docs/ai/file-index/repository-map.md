# Repository Map

Purpose:

Dense file ledger.

This file is map only.

It is not proof of behavior.

Verify all conclusions against real source code.

If this map conflicts with source code, source code wins.

Mark stale or conflicting entries as `CONTEXT DRIFT`.

---

## File Index

TODO: Fill after repository analysis. Do not treat as verified. (Auth rows below are verified; everything else still TODO.)

| Path | Purpose | Domain | Risk | Notes |
| ---- | ------- | ------ | ---- | ----- |
| `apps/api/src/auth/auth.service.ts` | Core auth logic: register/verifyOtp/login/refresh/logout, email normalization, bcrypt hashing, JWT + refresh token issuance | Auth | Deep | Tested in `auth.service.spec.ts` |
| `apps/api/src/auth/auth.controller.ts` | HTTP routes for `/auth/*`, sets/clears the `mnemra_rt` httpOnly cookie | Auth | Deep | Tested in `test/auth.e2e-spec.ts` |
| `apps/api/src/auth/decorators/current-user.decorator.ts` | Param decorator that reads `req.user` as `{userId, email}` for authenticated handlers | Auth / Workspaces | Express | Used by `workspaces.controller.ts` |
| `apps/api/src/auth/guards/workspace-member.guard.ts` | Per-request check: is this user a member of the workspace in the route param; attaches `{workspaceId, role}` to the request | Auth / Workspaces | Deep | Tested in `workspace-member.guard.spec.ts` |
| `apps/api/src/auth/guards/roles.guard.ts` | RBAC guard that enforces `@Roles(...)` against `req.workspaceMember.role` after membership lookup | Auth / Workspaces | Deep | Tested in `roles.guard.spec.ts`; must run after `WorkspaceMemberGuard` |
| `apps/api/src/auth/decorators/roles.decorator.ts` | Metadata decorator for workspace RBAC (`owner`, `admin`, `member`) | Auth / Workspaces | Express | Consumed by `RolesGuard` |
| `apps/api/src/auth/decorators/current-workspace-member.decorator.ts` | Param decorator that reads `req.workspaceMember` for controller handlers | Auth / Workspaces | Express | No tests needed — trivial passthrough |
| `apps/api/src/workspaces/workspaces.controller.ts` | HTTP routes for create/list/get/invite/accept/remove workspace flows | Workspaces | Deep | Guard order matters: `JwtAuthGuard`, `WorkspaceMemberGuard`, then `RolesGuard` where applicable |
| `apps/api/src/workspaces/workspaces.service.ts` | Workspace creation, member listing, invite issuance/acceptance, and last-owner enforcement | Workspaces | Deep | Tested in `workspaces.service.spec.ts` |
| `apps/api/src/workspaces/workspaces.module.ts` | Wires workspaces controller/service plus auth/notification guard dependencies | Workspaces | Standard | Imported by `app.module.ts` |
| `apps/api/src/workspaces/dto/create-workspace.dto.ts` | Validation DTO for `POST /workspaces` | Workspaces | Express | `name` length 1..255 |
| `apps/api/src/workspaces/dto/invite-member.dto.ts` | Validation DTO for `POST /workspaces/:workspaceId/invite` | Workspaces | Express | Validates invitee email |
| `apps/api/src/knowledge-bases/knowledge-bases.controller.ts` | Nested workspace routes for create/list/delete knowledge bases | Knowledge Bases | Standard | Reuses `JwtAuthGuard`, `WorkspaceMemberGuard`, `RolesGuard` |
| `apps/api/src/knowledge-bases/knowledge-bases.service.ts` | KB create/list/delete logic, including non-empty delete guard via `documents` count | Knowledge Bases | Standard | Tested in `knowledge-bases.service.spec.ts` |
| `apps/api/src/knowledge-bases/knowledge-bases.module.ts` | Wires KB controller/service and auth guard dependencies | Knowledge Bases | Standard | Imported by `app.module.ts` |
| `apps/api/src/knowledge-bases/dto/create-knowledge-base.dto.ts` | Validation DTO for `POST /workspaces/:workspaceId/knowledge-bases` | Knowledge Bases | Express | `name` length 1..255 |
| `apps/api/src/documents/documents.controller.ts` | Nested workspace+KB routes for multipart upload, list, and delete document flows | Documents | Deep | Uses `FileInterceptor('file')`; guard order matches workspace/KB patterns |
| `apps/api/src/documents/documents.service.ts` | Saves uploaded bytes to object storage, inserts pending docs, queues ingest, scopes list/delete to workspace+KB | Documents | Deep | Tested in `documents.service.spec.ts` |
| `apps/api/src/documents/documents.module.ts` | Wires documents controller/service with auth guards, storage, and ingest dependencies | Documents | Standard | Imported by `app.module.ts` |
| `apps/api/src/ingest/ingest.processor.ts` | Bull worker for `ingest-queue`: document load, chunk, embed, sync, status transitions, temp cleanup | Documents / Ingestion | Deep | Lazy-imports `@repo/ai` so non-ingest app startup paths do not eagerly load document parsers |
| `apps/api/src/ingest/ingest.service.ts` | Enqueues document ingest jobs with retry/backoff/remove-on-complete policy | Documents / Ingestion | Standard | Retry-safe because `syncChunks()` is content-hash diff based |
| `apps/api/src/ingest/ingest.module.ts` | Registers ingest Bull queue and exposes queueing + processor providers | Documents / Ingestion | Standard | Imports `StorageModule` for worker temp-file fetches |
| `apps/api/src/scrape/scrape.service.ts` | Creates scrape runs, enforces workspace document quota, and enqueues crawl jobs | Web Sources / Scraping | Deep | KB must belong to route workspace; owner/admin only via controller guards |
| `apps/api/src/scrape/scrape.processor.ts` | Bull worker for `scrape-queue`: crawl site, save page text, upsert `documents`, enqueue ingest per page, update run counters/status | Web Sources / Scraping | Deep | Lazy-loads crawler submodule so app bootstrap avoids crawler dependency fan-out in tests |
| `apps/api/src/scrape/scrape.controller.ts` | Nested workspace+KB routes for start-crawl and list-runs endpoints | Web Sources / Scraping | Standard | `POST /scrape` = owner/admin, `GET /scrape-runs` = member |
| `apps/api/src/scrape/scrape.module.ts` | Wires scrape controller/service/processor with Bull queue, auth guards, storage, and ingest | Web Sources / Scraping | Standard | Registers `scrape-queue` |
| `apps/api/src/scrape/dto/scrape.dto.ts` | Validation DTO for crawl requests | Web Sources / Scraping | Express | Validates URL, depth 0..5, pages 1..2000 |
| `apps/api/src/storage/storage.service.ts` | S3-compatible object storage adapter: ensure bucket, save object bytes, download to temp file, delete by key | Storage | Deep | Tested in `storage.service.spec.ts`; SeaweedFS-backed locally |
| `apps/api/src/storage/storage.module.ts` | Exports `StorageService` and boots bucket creation on API startup | Storage | Standard | Imported by `app.module.ts` in Slice 3A |
| `apps/api/src/documents/documents.service.spec.ts` | Real-DB unit coverage for upload/list/delete document service behavior | Documents | Standard | Mocks `StorageService` and `IngestService` |
| `apps/api/src/ingest/ingest.processor.spec.ts` | Unit coverage for status transitions, metadata injection, sync call shape, and temp cleanup | Documents / Ingestion | Standard | Mocks `@repo/ai` and `StorageService` |
| `apps/api/test/documents.e2e-spec.ts` | End-to-end RBAC/storage verification for document upload/list/delete | Documents | Deep | Overrides `IngestService` so test stays independent of live OpenAI embeddings |
| `apps/api/src/notifications/notifications.service.ts` | Sends OTP and invite email via Resend, or console-logs in dev when `EMAIL_OTP_ENABLED!=='true'` | Auth / Workspaces | Standard | Covered by `auth.service.spec.ts`, `workspaces.service.spec.ts`, `test/workspaces.e2e-spec.ts` |
| `apps/web/src/lib/http/auth-proxy.ts` | Shared Next proxy helper that converts `mnemra_at` cookie into backend `Authorization: Bearer` and handles JSON/multipart passthrough | Web API Proxy | Deep | Returns 401 when access-token cookie is missing; never exposes token to client JS |
| `apps/web/src/lib/api/handle-unauthorized.ts` | Small client helper that normalizes 401 detection from parsed proxy errors | Web API Client | Express | Covered by `handle-unauthorized.spec.ts` and reused by workspace/document pages |
| `apps/web/app/api/workspaces/route.ts` | Same-origin proxy for list-my-workspaces and create-workspace web calls | Workspaces Frontend | Standard | Covered by `app/api/workspaces/route.spec.ts` |
| `apps/web/app/api/workspaces/[id]/route.ts` | Same-origin proxy for get-workspace | Workspaces Frontend | Standard | — |
| `apps/web/app/api/workspaces/[id]/invite/route.ts` | Same-origin proxy for invite-member | Workspaces Frontend | Standard | — |
| `apps/web/app/api/workspaces/[id]/members/[userId]/route.ts` | Same-origin proxy for remove-member | Workspaces Frontend | Standard | — |
| `apps/web/app/api/invitations/accept/[token]/route.ts` | Same-origin proxy for accept-invite | Workspaces Frontend | Standard | — |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/route.ts` | Same-origin proxy for list/create knowledge bases | Knowledge Bases Frontend | Standard | — |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/route.ts` | Same-origin proxy for delete knowledge base | Knowledge Bases Frontend | Standard | — |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/documents/route.ts` | Same-origin proxy for list/upload documents, including multipart passthrough | Documents Frontend | Deep | Covered by `documents/route.spec.ts` for multipart behavior |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/scrape/route.ts` | Same-origin proxy for starting a scrape run | Web Sources Frontend | Standard | Covered by `scrape/route.spec.ts`; forwards JSON body + Bearer |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/scrape-runs/route.ts` | Same-origin proxy for listing scrape runs | Web Sources Frontend | Standard | Covered by `scrape-runs/route.spec.ts` |
| `apps/web/app/api/workspaces/[id]/knowledge-bases/[kbId]/documents/[docId]/route.ts` | Same-origin proxy for delete document | Documents Frontend | Standard | — |
| `apps/web/src/lib/api/client.ts` | Shared browser-side fetch helpers for JSON and file upload against same-origin web proxies | Web API Client | Standard | Reused by auth/workspaces/KB/documents libs |
| `apps/web/src/lib/api/workspaces.ts` | Client API lib for workspace flows | Workspaces Frontend | Standard | Calls `/api/workspaces*` proxies only |
| `apps/web/src/lib/api/knowledge-bases.ts` | Client API lib for knowledge-base flows | Knowledge Bases Frontend | Standard | Calls `/api/workspaces/:id/knowledge-bases*` proxies |
| `apps/web/src/lib/api/documents.ts` | Client API lib for document list/upload/delete flows | Documents Frontend | Standard | Uses `uploadFile()` for multipart |
| `apps/web/src/lib/api/scrape.ts` | Client API lib for crawl-start and run-list flows | Web Sources Frontend | Standard | Calls same-origin scrape proxies only |
| `apps/web/app/workspaces/page.tsx` | Client page for listing accessible workspaces and creating a new workspace through a modal form | Workspaces Frontend | Standard | Redirects to `/login` on proxy 401; uses `Table`, `Modal`, `useToast` |
| `apps/web/app/workspaces/[id]/page.tsx` | Client page for workspace detail, invite form, and knowledge-base create/delete management | Workspaces Frontend | Standard | Derives caller role from `listWorkspaces()` to hide owner/admin controls when known |
| `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.tsx` | Client page for document upload, crawl-run management, status polling, and delete confirmation within a knowledge base | Documents Frontend / Web Sources | Deep | Polls docs while ingest active and scrape runs while crawl active; owner/admin can start crawls via modal |
| `apps/web/app/invite/[token]/page.tsx` | Client page that accepts a workspace invite token and redirects into the joined workspace | Workspaces Frontend | Standard | Surfaces backend invite error messages directly |
| `apps/web/app/workspaces/page.spec.ts` | jsdom coverage for workspace list/create flows and unauthorized redirect | Workspaces Frontend | Standard | Mocks `next/navigation` and workspace client API |
| `apps/web/app/workspaces/[id]/page.spec.ts` | jsdom coverage for workspace detail invite/create/delete knowledge-base flows | Workspaces Frontend | Standard | Mocks workspace and knowledge-base client APIs |
| `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` | jsdom coverage for document list/upload/poll/delete flows | Documents Frontend | Standard | Uses fake timers to verify polling cleanup |
| `packages/ai/src/web/crawl.ts` | Production crawler core: canonicalize URLs, enforce same-origin/path scope, honor robots, extract main article text, bounded BFS crawl | Web Sources / Scraping | Deep | Tested with injected fetch mocks only; exports helpers for scope/content/link tests |
| `packages/ai/src/web/crawl.spec.ts` | Vitest coverage for crawler canonicalization, scope, depth/page caps, robots, UA, readability extraction, resilience | Web Sources / Scraping | Standard | No live network |
| `packages/db/src/schema/scrapeRuns.ts` | Drizzle schema for `scrape_runs` and `scrape_run_status` | Web Sources / Scraping | Deep | Added with migration `0002_ordinary_punisher.sql` |
| `apps/web/app/invite/[token]/page.spec.ts` | jsdom coverage for invite acceptance redirect flow | Workspaces Frontend | Standard | Mocks `acceptInvite()` and router push |
| `apps/web/src/lib/api/handle-unauthorized.spec.ts` | Unit coverage for normalized 401 detection helper | Web API Client | Express | Verifies `statusCode` and `message` paths |
| `apps/web/src/lib/ui/modal.spec.ts` | jsdom render test for `Modal` open/close behavior | UI | Standard | Uses `@testing-library/react` |
| `packages/ui/src/components/ui/modal.tsx` | Minimal accessible dialog primitive with overlay click and Escape close | UI | Standard | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/select.tsx` | Styled native `<select>` primitive matching input styles | UI | Express | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/textarea.tsx` | Styled `<textarea>` primitive matching input styles | UI | Express | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/table.tsx` | Thin table wrapper primitives for headers/body/rows/cells | UI | Express | Exported from `@repo/ui` |
| `docker/seaweedfs/s3.json` | Local SeaweedFS S3 identity file with dev-only credentials matching `.env.example` | Storage Infra | Deep | Never reuse for production secrets |
| `packages/db/src/db/index.ts` | Drizzle client + exported `pg.Pool` (`pool` exported specifically so tests can close the connection cleanly) | DB infra | Standard | — |
