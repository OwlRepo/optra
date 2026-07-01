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
| `apps/api/src/cache/cache.module.ts` | Wires singleton Redis client + `CacheService` for chat answer caching | Chat / RAG | Standard | Uses `REDIS_HOST` / `REDIS_PORT` via `ConfigService`; imported by chat/documents/ingest modules |
| `apps/api/src/cache/cache.service.ts` | Workspace-scoped answer cache: exact Redis keys, semantic `chat_cache` lookup, version invalidation, fail-soft behavior | Chat / RAG | Deep | Exact key = `chat:ans:${workspaceId}:${version}:sha256(normalizedMessage)`; semantic hits require score >= env threshold |
| `apps/api/src/limits/limits.module.ts` | Wires Redis-backed chat rate-limit and usage-budget services/guard | Chat / RAG | Standard | Imports `CacheModule` to reuse exported `REDIS_CLIENT` |
| `apps/api/src/limits/rate-limit.service.ts` | Fixed-window per-minute Redis counters for per-user and per-workspace chat POST limits | Chat / RAG | Deep | Fail-open on Redis errors; throws `429` only when counters exceed configured caps |
| `apps/api/src/limits/usage.service.ts` | Monthly Redis token budget tracker for miss-path workspace generations | Chat / RAG | Deep | Fail-open on Redis errors; throws `402` only when monthly counter reaches configured cap |
| `apps/api/src/limits/chat-rate-limit.guard.ts` | Nest guard that enforces chat rate limits from `req.user.userId` + `req.params.workspaceId` | Chat / RAG | Deep | Applied after auth + workspace membership guards on chat POST |
| `apps/api/src/documents/documents.controller.ts` | Nested workspace+KB routes for multipart upload, list, and delete document flows | Documents | Deep | Uses `FileInterceptor('file')` with server-side size limit + supported-type allowlist and maps oversized uploads to `413` |
| `apps/api/src/documents/documents.service.ts` | Saves uploaded bytes to object storage, inserts pending docs, queues ingest, scopes list/delete to workspace+KB, invalidates chat cache on delete | Documents | Deep | Tested in `documents.service.spec.ts` |
| `apps/api/src/documents/documents.module.ts` | Wires documents controller/service with auth guards, storage, and ingest dependencies | Documents | Standard | Imported by `app.module.ts` |
| `apps/api/src/chat/chat.controller.ts` | Workspace-scoped streaming chat endpoint that writes plain-text answer tokens and emits sources via `X-Chat-Sources` | Chat / RAG | Deep | Guarded by `JwtAuthGuard` + `WorkspaceMemberGuard` + `ChatRateLimitGuard`; persists/cache-writes before request completes |
| `apps/api/src/chat/chat.service.ts` | Chat session/message persistence plus answer-cache orchestration for workspace-scoped streamed answers | Chat / RAG | Deep | Creates/reuses owned sessions, inserts user/assistant turns, checks exact then semantic cache, enforces miss-path workspace budget, and stores assistant sources/history identically for hits and misses |
| `apps/api/src/chat/chat.module.ts` | Wires chat controller/service and imports auth + cache + limits dependencies | Chat / RAG | Standard | Imported by `app.module.ts` |
| `apps/api/src/chat/dto/chat.dto.ts` | Validation DTO for `POST /workspaces/:workspaceId/chat` | Chat / RAG | Express | `message` must be non-empty string max 4000; `sessionId` reserved for S2 |
| `apps/api/src/ingest/ingest.processor.ts` | Bull worker for `ingest-queue`: document load, chunk, embed, sync, status transitions, temp cleanup, chat-cache invalidation on success | Documents / Ingestion | Deep | Lazy-imports `@repo/ai` so non-ingest app startup paths do not eagerly load document parsers |
| `apps/api/src/ingest/ingest.service.ts` | Enqueues document ingest jobs with retry/backoff/remove-on-complete policy, clears stale processing markers on requeue, and reconciles missing jobs on startup | Documents / Ingestion | Standard | Retry-safe because `syncChunks()` is content-hash diff based |
| `apps/api/src/ingest/ingest.module.ts` | Registers ingest Bull queue and exposes queueing + processor providers | Documents / Ingestion | Standard | Imports `StorageModule` for worker temp-file fetches |
| `apps/api/src/scrape/scrape.service.ts` | Creates scrape runs, derives default crawl scope, enforces workspace document quota, rejects blocked seed URLs, and enqueues crawl jobs | Web Sources / Scraping | Deep | KB must belong to route workspace; owner/admin only via controller guards |
| `apps/api/src/scrape/scrape.processor.ts` | Bull worker for `scrape-queue`: stream crawl pages, save page text, upsert `documents`, enqueue ingest per page, and persist live run counters/status | Web Sources / Scraping | Deep | Lazy-loads crawler submodule so app bootstrap avoids crawler dependency fan-out in tests |
| `apps/api/src/scrape/scrape.controller.ts` | Nested workspace+KB routes for start-crawl and list-runs endpoints | Web Sources / Scraping | Standard | `POST /scrape` = owner/admin, `GET /scrape-runs` = member |
| `apps/api/src/scrape/scrape.module.ts` | Wires scrape controller/service/processor with Bull queue, auth guards, storage, and ingest | Web Sources / Scraping | Standard | Registers `scrape-queue` |
| `apps/api/src/scrape/dto/scrape.dto.ts` | Validation DTO for crawl requests | Web Sources / Scraping | Express | Validates URL, depth 0..5, pages 1..2000 |
| `apps/api/src/storage/storage.service.ts` | S3-compatible object storage adapter: ensure bucket, save object bytes, download to temp file, delete by key | Storage | Deep | Tested in `storage.service.spec.ts`; SeaweedFS-backed locally |
| `apps/api/src/storage/storage.module.ts` | Exports `StorageService` and boots bucket creation on API startup | Storage | Standard | Imported by `app.module.ts` in Slice 3A |
| `apps/api/src/cache/cache.service.spec.ts` | Unit coverage for exact cache versioning, workspace isolation, and semantic thresholding | Chat / RAG | Standard | Mocks Redis + DB query seam |
| `apps/api/src/documents/documents.service.spec.ts` | Real-DB unit coverage for upload/list/delete document service behavior | Documents | Standard | Mocks `StorageService` and `IngestService` |
| `apps/api/src/ingest/ingest.processor.spec.ts` | Unit coverage for status transitions, metadata injection, sync call shape, and temp cleanup | Documents / Ingestion | Standard | Mocks `@repo/ai` and `StorageService` |
| `apps/api/src/chat/chat.service.spec.ts` | Unit coverage for exact-hit, semantic-hit, miss-to-cache, single-embed chat behavior plus miss-path budget/usage accounting | Chat / RAG | Standard | Mocks `@repo/ai` + `CacheService` + `UsageService` |
| `apps/api/src/limits/rate-limit.service.spec.ts` | Unit coverage for per-user/per-workspace rate-limit counters, minute buckets, and fail-open behavior | Chat / RAG | Standard | Pure Redis mock seam |
| `apps/api/src/limits/usage.service.spec.ts` | Unit coverage for monthly token budget keys, cap enforcement, and fail-open behavior | Chat / RAG | Standard | Pure Redis mock seam |
| `apps/api/test/chat.e2e-spec.ts` | End-to-end RBAC + streaming + session/message history + cache-hit/invalidation + rate-limit coverage for workspace chat endpoints | Chat / RAG | Deep | Mocks `@repo/ai` so no live OpenAI call |
| `apps/api/test/documents.e2e-spec.ts` | End-to-end RBAC/storage verification for document upload/list/delete plus upload limit/type rejection | Documents | Deep | Overrides `IngestService` and `StorageService` so test stays independent of live OpenAI embeddings/S3 |
| `apps/api/tsconfig.json` | API compile/runtime tsconfig for Nest + SWC | Platform Build | Deep | `@repo/*` source-path aliases removed 2026-07-01 so runtime resolves built workspace packages instead of broken `packages/*/src` paths |
| `apps/api/test/jest-e2e.json` | API e2e Jest config | Platform Build | Standard | Maps `@repo/*` to package `dist` and transpiles ESM-only `p-limit`/`yocto-queue` for app-module boot under Jest |
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
| `apps/web/app/api/workspaces/[id]/chat/route.ts` | Same-origin streaming proxy that converts AI SDK `messages` payload into backend `{message, sessionId?}` and passes text stream/headers through | Chat Frontend | Deep | Node runtime; forwards `X-Chat-Sources` + `X-Chat-Session-Id` |
| `apps/web/app/api/workspaces/[id]/chat/sessions/route.ts` | Same-origin proxy for listing owned chat sessions in a workspace | Chat Frontend | Standard | Reuses `proxyJson()` |
| `apps/web/app/api/workspaces/[id]/chat/sessions/[sessionId]/messages/route.ts` | Same-origin proxy for loading owned session history + persisted sources | Chat Frontend | Standard | Reuses `proxyJson()` |
| `apps/web/src/lib/api/client.ts` | Shared browser-side fetch helpers for JSON and file upload against same-origin web proxies | Web API Client | Standard | Reused by auth/workspaces/KB/documents libs |
| `apps/web/src/lib/api/chat.ts` | Client API lib for chat session/message history endpoints | Chat Frontend | Standard | Streaming POST still handled by `useChat` directly |
| `apps/web/src/lib/api/workspaces.ts` | Client API lib for workspace flows | Workspaces Frontend | Standard | Calls `/api/workspaces*` proxies only |
| `apps/web/src/lib/api/knowledge-bases.ts` | Client API lib for knowledge-base flows | Knowledge Bases Frontend | Standard | Calls `/api/workspaces/:id/knowledge-bases*` proxies |
| `apps/web/src/lib/api/documents.ts` | Client API lib for document list/upload/delete flows | Documents Frontend | Standard | Uses `uploadFile()` for multipart |
| `apps/web/src/lib/api/scrape.ts` | Client API lib for crawl-start and run-list flows | Web Sources Frontend | Standard | Calls same-origin scrape proxies only |
| `apps/web/app/workspaces/page.tsx` | Client page for listing accessible workspaces and creating a new workspace through a modal form | Workspaces Frontend | Standard | Redirects to `/login` on proxy 401; uses `Table`, `Modal`, `useToast` |
| `apps/web/app/workspaces/[id]/page.tsx` | Client page for workspace detail, invite form, and knowledge-base create/delete management | Workspaces Frontend | Standard | Derives caller role from `listWorkspaces()` to hide owner/admin controls when known |
| `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.tsx` | Client page for document upload, crawl-run management, live queue summaries, status polling, and delete confirmation within a knowledge base | Documents Frontend / Web Sources | Deep | Polls docs while ingest active and scrape runs while crawl active; sorts active docs first; owner/admin can start crawls via modal |
| `apps/web/app/workspaces/[id]/chat/page.tsx` | Client workspace chat page with streamed answers, source panel, history sidebar, and session reloads | Chat Frontend | Deep | Uses `useChat` against workspace proxy and reloads persisted message history after each answer |
| `apps/web/app/chat/page.tsx` | Legacy `/chat` redirect page that resolves first workspace then forwards user to `/workspaces/:id/chat` | Chat Frontend | Standard | Keeps old links working after workspace-scoped chat launch |
| `packages/db/src/schema/tickets.ts` | Drizzle schema for workspace-scoped transcript ticket drafts, extraction lifecycle, feedback, and review audit fields | Tickets | Deep | Added in migrations `0007_sudden_the_phantom.sql` + `0008_clumsy_pepper_potts.sql`; unique `(workspace_id, transcript_hash)` closes dedup races |
| `apps/api/src/tickets/tickets.service.ts` | Ticket create/list/get/update service plus queue enqueue, stale-job reconciliation, dedup by transcript hash, projected detail reads, and review-confidence merging | Tickets | Deep | Uses Bull queue `ticket-extraction-queue`; any workspace member can create/review |
| `apps/api/src/tickets/ticket-extraction.processor.ts` | Bull worker that runs transcript extraction and writes extracted fields / terminal failure state | Tickets | Deep | Imports `extractTicketFromTranscript` from `@repo/ai`; job payload is `{ticketId}` only; completion write is guarded to avoid clobbering reviewed rows |
| `apps/api/src/tickets/tickets.controller.ts` | Workspace-scoped ticket HTTP routes for create/list/get/update | Tickets | Deep | `POST` returns `202` for new extraction and `200` for exact dedup hit |
| `apps/api/src/tickets/tickets.module.ts` | Wires ticket controller/service/processor with Bull queue and auth guards | Tickets | Standard | Registers `ticket-extraction-queue` |
| `apps/api/src/tickets/dto/{create-ticket,update-ticket}.ts` | Validation DTOs for transcript create and review-save payloads | Tickets | Express | `transcript` max 50k chars; review fields are partial |
| `apps/api/src/tickets/tickets.service.spec.ts` | Real-DB unit coverage for ticket create/dedup/failure/update behavior | Tickets | Standard | Mocks Bull queue only |
| `apps/api/src/tickets/ticket-extraction.processor.spec.ts` | Unit coverage for extraction success/failure status transitions | Tickets | Standard | Mocks `@repo/ai` extraction chain |
| `apps/api/test/tickets.e2e-spec.ts` | End-to-end workspace ticket flow and IDOR coverage | Tickets | Deep | Covers `403` non-member and `404` cross-workspace ticket id |
| `packages/ai/src/chains/ticket-extraction.ts` | Direct transcript-to-ticket extraction chain using `ChatOpenAI`, strict JSON parsing, timeout retry, and typed extraction errors | Tickets | Deep | Separate from chat LangGraph path by design |
| `packages/ai/src/chains/ticket-extraction.spec.ts` | Vitest coverage for extraction happy path, empty/refusal/parse/timeout/injection cases | Tickets | Standard | No live OpenAI call |
| `apps/web/src/lib/api/tickets.ts` | Browser-side client for ticket queue/detail/review endpoints | Tickets Frontend | Standard | Calls same-origin ticket proxies only |
| `apps/web/app/api/workspaces/[id]/tickets/route.ts` | Same-origin proxy for ticket list/create | Tickets Frontend | Standard | Reuses `proxyJson()` |
| `apps/web/app/api/workspaces/[id]/tickets/[ticketId]/route.ts` | Same-origin proxy for ticket detail/update | Tickets Frontend | Standard | Reuses `proxyJson()` |
| `apps/web/app/workspaces/[id]/tickets/page.tsx` | Client workspace ticket-copilot page for transcript intake, polling, review editing, failure banner, and copy-to-clipboard handoff | Tickets Frontend | Deep | Polls every 3 seconds while extraction in flight |
| `apps/web/app/workspaces/[id]/tickets/page.spec.ts` | jsdom coverage for ticket polling, review save, copy, and failure banner | Tickets Frontend | Standard | Mocks ticket client API + clipboard |
| `apps/web/app/api/workspaces/[id]/tickets/**/*.spec.ts` | Vitest coverage for ticket same-origin proxy auth and passthrough | Tickets Frontend | Standard | Collection + detail routes |
| `scripts/eval/extraction-eval-dataset.json` | Seed dataset for transcript-extraction accuracy checks | Tickets | Standard | Includes actionable and non-actionable transcripts |
| `scripts/eval/evaluate_extraction.py` | Manual/live field-accuracy evaluator for extraction chain | Tickets | Standard | Requires `OPENAI_API_KEY`; compares predicted fields against labeled rows |
| `scripts/eval/test_extraction_dataset_schema.py` | Offline schema/import test for extraction eval harness | Tickets | Express | No network required |
| `apps/web/app/invite/[token]/page.tsx` | Client page that accepts a workspace invite token and redirects into the joined workspace | Workspaces Frontend | Standard | Surfaces backend invite error messages directly |
| `apps/web/app/workspaces/page.spec.ts` | jsdom coverage for workspace list/create flows and unauthorized redirect | Workspaces Frontend | Standard | Mocks `next/navigation` and workspace client API |
| `apps/web/app/workspaces/[id]/page.spec.ts` | jsdom coverage for workspace detail invite/create/delete knowledge-base flows | Workspaces Frontend | Standard | Mocks workspace and knowledge-base client APIs |
| `apps/web/app/workspaces/[id]/knowledge-bases/[kbId]/page.spec.ts` | jsdom coverage for document list/upload/poll/delete flows | Documents Frontend | Standard | Uses fake timers to verify polling cleanup |
| `apps/web/app/api/workspaces/[id]/chat/route.spec.ts` | Vitest coverage for streaming workspace chat proxy header/body passthrough and auth enforcement | Chat Frontend | Standard | Validates AI SDK payload normalization |
| `apps/web/app/api/workspaces/[id]/chat/sessions/route.spec.ts` | Vitest coverage for chat session proxy GET path | Chat Frontend | Express | — |
| `apps/web/app/api/workspaces/[id]/chat/sessions/[sessionId]/messages/route.spec.ts` | Vitest coverage for chat message-history proxy GET path | Chat Frontend | Express | — |
| `apps/web/app/workspaces/[id]/chat/page.spec.ts` | jsdom coverage for chat history loading and source rendering | Chat Frontend | Standard | Mocks `useChat` and chat history APIs |
| `apps/web/app/chat/page.spec.ts` | jsdom coverage for `/chat` redirect behavior | Chat Frontend | Express | Redirects to first workspace chat |
| `packages/ai/src/chains/index.ts` | Workspace-scoped RAG answer generation entrypoint; straight-line path by default, conditional LangGraph path behind env flag | Chat / RAG | Deep | `answerQuestion()` return shape unchanged; `askQuestion()` remains back-compat wrapper |
| `packages/ai/src/chains/graph.ts` | Conditional LangGraph miss-path orchestration: retrieve, score-route, rewrite loop, fallback, optional self-grade/regenerate | Chat / RAG | Deep | Uses retrieval score threshold + rewrite cap; feature flag defaults off |
| `packages/ai/src/chains/index.spec.ts` | Unit coverage for deduped source mapping and empty-retrieval fallback in straight-line chat chain | Chat / RAG | Standard | Mocks vector search, DB lookup, and LLM stream |
| `packages/ai/src/chains/graph.spec.ts` | Unit coverage for LangGraph routing: direct generate, rewrite retry, fallback, and self-grade regenerate | Chat / RAG | Standard | Mocks vector search, DB lookup, and LLM calls |
| `packages/ai/src/loaders/pdf.ts` | PDF loader used by ingest/document parsing | Documents / Ingestion | Standard | Switched 2026-07-01 from internal `pdf-parse/lib/pdf-parse.js` require to exported `PDFParse` API so runtime boot works on current Node |
| `packages/ai/src/loaders/pdf.spec.ts` | Unit coverage for PDF loader parser integration seam | Documents / Ingestion | Standard | Mocks `pdf-parse` + `fs/promises`; asserts extracted text/page count mapping |
| `packages/ai/src/tokens.ts` | Token-count helper using `tiktoken` `cl100k_base` for workspace usage estimation | Chat / RAG | Express | Used by API usage accounting only |
| `packages/ai/src/tokens.spec.ts` | Unit coverage for token counting + encoder cleanup | Chat / RAG | Express | Mocks `tiktoken` |
| `scripts/eval/requirements.txt` | Python deps for offline RAGAS evaluation harness | Chat / RAG | Standard | Not loaded by Node runtime |
| `scripts/eval/eval-dataset.json` | Seed offline RAGAS dataset rows with `question/answer/contexts/ground_truth` schema | Chat / RAG | Standard | Expand from templates toward real support cases |
| `scripts/eval/evaluate.py` | Offline weekly RAGAS runner that prints four metrics, lowest metric, and writes timestamped JSON | Chat / RAG | Standard | Requires Python deps + `OPENAI_API_KEY` |
| `scripts/eval/capture_from_langsmith.py` | Optional helper to export recent LangSmith runs into mergeable dataset rows | Chat / RAG | Standard | Emits blank `ground_truth` for manual fill-in |
| `scripts/eval/README.md` | Runbook for offline eval harness setup, cadence, and metric interpretation | Chat / RAG | Express | Documents "fix lowest metric first" loop |
| `scripts/eval/test_dataset_schema.py` | Offline schema/import test for eval dataset + metric list | Chat / RAG | Express | No network required |
| `packages/db/src/schema/chatSessions.ts` | Drizzle schema for `chat_sessions`, `chat_messages`, and `chat_message_role` enum | Chat / RAG | Deep | Added in migration `0003_shallow_iron_patriot.sql`; assistant `sources` stored as jsonb |
| `packages/db/src/schema/chatCache.ts` | Drizzle schema for semantic answer cache rows keyed by workspace + version | Chat / RAG | Deep | Added in migration `0004_exotic_roughhouse.sql`; stores question embedding, answer, and sources |
| `packages/types/src/index.ts` | Shared legacy app types; chat-adjacent document/chunk fields now use `workspaceId` naming | Shared Types | Express | S1 removed remaining `tenantId` fields from live type surface |
| `packages/ai/src/web/ssrf.ts` | Shared SSRF guard for scrape seeds and crawler fetch targets using hostname + IP + DNS-resolution checks | Web Sources / Scraping | Deep | Blocks localhost/internal hostnames, private/link-local/loopback IPs, metadata IP, and DNS rebinding to private addresses |
| `packages/ai/src/web/ssrf.spec.ts` | Vitest coverage for SSRF guard hostname/IP/rebinding rules | Web Sources / Scraping | Standard | No live DNS/network |
| `packages/ai/src/web/crawl.ts` | Production crawler core: canonicalize URLs, enforce same-origin/path scope, block SSRF targets, honor robots, extract main article text, bounded BFS crawl, and stream accepted-page progress callbacks | Web Sources / Scraping | Deep | Tested with injected fetch + lookup mocks only; exports helpers for scope/content/link tests |
| `packages/ai/src/web/crawl.spec.ts` | Vitest coverage for crawler canonicalization, scope, depth/page caps, robots, SSRF blocking, UA, readability extraction, resilience, and live progress callbacks | Web Sources / Scraping | Standard | No live network or DNS |
| `packages/db/src/schema/scrapeRuns.ts` | Drizzle schema for `scrape_runs` and `scrape_run_status` | Web Sources / Scraping | Deep | Added with migration `0002_ordinary_punisher.sql`; `last_progress_at` added in `0006_needy_harrier.sql` |
| `apps/web/app/invite/[token]/page.spec.ts` | jsdom coverage for invite acceptance redirect flow | Workspaces Frontend | Standard | Mocks `acceptInvite()` and router push |
| `apps/web/src/lib/api/handle-unauthorized.spec.ts` | Unit coverage for normalized 401 detection helper | Web API Client | Express | Verifies `statusCode` and `message` paths |
| `apps/web/src/lib/ui/modal.spec.ts` | jsdom render test for `Modal` open/close behavior | UI | Standard | Uses `@testing-library/react` |
| `packages/ui/src/components/ui/modal.tsx` | Minimal accessible dialog primitive with overlay click and Escape close | UI | Standard | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/select.tsx` | Styled native `<select>` primitive matching input styles | UI | Express | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/textarea.tsx` | Styled `<textarea>` primitive matching input styles | UI | Express | Exported from `@repo/ui` |
| `packages/ui/src/components/ui/table.tsx` | Thin table wrapper primitives for headers/body/rows/cells | UI | Express | Exported from `@repo/ui` |
| `docker/seaweedfs/s3.json` | Local SeaweedFS S3 identity file with dev-only credentials matching `.env.example` | Storage Infra | Deep | Never reuse for production secrets |
| `packages/db/src/db/index.ts` | Drizzle client + exported `pg.Pool` (`pool` exported specifically so tests can close the connection cleanly) | DB infra | Standard | — |
