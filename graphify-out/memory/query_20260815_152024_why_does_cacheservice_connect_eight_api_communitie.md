---
type: "query"
date: "2026-08-15T15:20:24.070708+00:00"
question: "Why does CacheService connect eight API communities?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["CacheService", "CacheModule", "ChatService", "DocumentsService", "IngestProcessor", "TicketsService"]
---

# Q: Why does CacheService connect eight API communities?

## Answer

Expanded from original query via graph vocab: [cache, service, limits, usage, chat, events, ingest, common, documents, tickets, module]. CacheService is the shared NestJS cache abstraction at apps/api/src/cache/cache.service.ts:L14. CacheModule imports it; runtime references come from ChatService at apps/api/src/chat/chat.service.ts:L25, DocumentsService at apps/api/src/documents/documents.service.ts:L14, IngestProcessor at apps/api/src/ingest/ingest.processor.ts:L15, and TicketsService at apps/api/src/tickets/tickets.service.ts:L84. Remaining cross-community links come from module/file imports and specs whose clustered community names differ, including API Limits Usage Service and API Events Service. Therefore the eight-community bridge is partly real shared caching/invalidation infrastructure and partly a clustering artifact, not eight independent production callers.

## Outcome

- Signal: useful

## Source Nodes

- CacheService
- CacheModule
- ChatService
- DocumentsService
- IngestProcessor
- TicketsService