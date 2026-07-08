# Mnemra — Implementation Roadmap

> Your support team's institutional memory, on demand.
> AI-powered knowledge memory for customer support teams. Ingests past tickets, product docs, runbooks, internal wikis — makes all of it instantly queryable for agents.

---

## What's already built

### packages/ai — Complete
- Loaders: 11 file types (txt, md, pdf, docx, csv, json, html, xlsx, pptx, eml, msg, yaml)
- Chunking: token-aware (tiktoken cl100k_base), recursive + markdown strategies, SHA-256 content hashing, section-aware slot ready
- Embeddings: OpenAI batch embed + query embed, configurable model via env
- Vectorstore: pgvector syncChunks (hash-based diff), similaritySearch with tenantId filter
- Chains: streaming RAG via async generator, grounded system prompt
- Tracing: LangSmith auto-trace via env vars

### packages/db — Working schema foundation
- Auth/workspace/KB/document/chat/scrape schema is live
- `tickets` table now supports transcript-to-ticket copilot drafts, queue lifecycle, feedback, and review audit fields
- Legacy roadmap references to `tenantId` are stale; live code now uses `workspaceId`

### apps/api — Working product backend
- Auth, workspaces, knowledge bases, documents/ingest, chat, scrape, and tickets modules are implemented
- Redis-backed Bull queues live for ingest, scrape, and ticket extraction
- Workspace-scoped guards + e2e coverage enforce tenant isolation across product routes

### apps/web — Working operator surfaces
- Auth pages, workspace pages, knowledge-base documents page, workspace chat, and new ticket-copilot page are implemented
- Dashboard remains mostly placeholder data, but product navigation and feedback surfaces are wired
- Same-origin API proxies front backend auth for workspaces, documents, chat, scrape, and tickets

### packages/ui — 15 components
Button, Input, Card, Badge, Avatar, Separator, Skeleton, ChatBubble, Toast, StatusBanner, AppHeader, PageShell, PageSection, StatCard, EmptyState

---

## What's missing — by priority

---

### Priority 1 — Shipped

Core auth/workspace schema and flows are built. Keep this section as historical context only.

---

### Priority 2 — Shipped core flow

Workspace, KB, document ingest, and corresponding web pages are implemented.

---

### Priority 3 — Make the product work end to end

**Chat (wire RAG):**
- Fix `ChatService` — call `askQuestion(question, tenantId)`, stream response via SSE
- Fix `apps/web/app/api/chat/route.ts` — call backend `/chat`, not OpenAI directly
- Source attribution — return which documents each answer came from
- `chat_sessions` + `chat_messages` tables for history persistence

**Tenant isolation:**
- JWT middleware injects `tenantId` into every request from token
- All DB queries automatically scoped by `tenantId`
- RLS policies on `chunks` and `documents` tables
- *(Drift note 2026-07-08: live code uses `workspaceId`, and RLS is NOT enabled — isolation is app-level `WHERE workspace_id` filters in every query; see `docs/PRODUCTION-READINESS.md` A7.)*

---

### Priority 4 — Quality, polish, growth

- UI components: textarea, select, checkbox, modal, dropdown, tabs, table, breadcrumbs, sidebar nav
- Ingestion monitoring UI — see job status, retry failed jobs
- Conversation history UI
- Workspace settings page
- User profile/settings page
- Section-aware chunking (steel beams already in place, just needs implementation per file type)
- Ticket ingestion flow — support ticket format → KB
- Analytics — answer quality, KB coverage, usage per workspace *(addressed by V2 feature F7a — see below)*

---

### V2 — Structured Query & Insights (approved + shipped 2026-07-08)

Batch of 7 features, all implemented and tested the same day the batch plan was approved: structured CSV querying (DuckDB, S1+F1), ticket trend analysis (F2), scheduler substrate + runbook/doc freshness detector (S2+F3), auto-FAQ from ticket clusters (F4), cross-file comparison queries (F5), confidence/coverage dashboard (F7a), Slack + email digest (F6). Only F7b (RAGAS-dependent quality-score half of the dashboard) remains explicitly out of batch, gated on Stage 2/D1 below — not started. Full dependency, risk, migration, and build-order analysis (plus per-slice status) lives in `docs/ai/planning/v2-features.md` — read that before touching any v2 slice; it is the living status source, this section is a summary only. Respects the gates below: nothing enables or extends the RAG LangGraph.

---

## AI Quality Roadmap — RAG → Evaluation → Agentic

This is the progression after the product shell is working. Do not start any of these until Priority 1-3 above are shipped and real users are using the product.

---

### Stage 1 — Wire RAG to API + FE (Priority 2-3 above)

Before measuring quality, make the product work end to end:
- `IngestProcessor` fully wired to `packages/ai` pipeline
- `ChatService` calling `askQuestion()` with streaming
- Web chat page calling backend, not OpenAI directly
- Source attribution showing which documents answers came from

**You are here after Priority 3 is done.**

---

### Stage 2 — Add RAGAS evaluation

**What RAGAS is:**
RAGAS is an evaluation framework that scores your RAG pipeline on 4 metrics using an LLM judge:

| Metric | What it measures | Red flag if low |
|---|---|---|
| `faithfulness` | Answer only uses info from retrieved chunks | Hallucinating outside context |
| `answer_relevancy` | Answer actually addresses the question | Retrieving wrong chunks |
| `context_precision` | Retrieved chunks are relevant to the question | Too many noise chunks retrieved |
| `context_recall` | All necessary chunks were retrieved | Chunk size too large, missing splits |

**How to implement:**
1. Install `ragas` Python package (RAGAS is Python-native — run as a separate evaluation script, not in the Node.js app)
2. Build an evaluation dataset — 20-50 question/answer/context triples from real Mnemra usage
3. Pull traces from LangSmith (LangSmith stores inputs/outputs/retrieved chunks per run)
4. Run RAGAS against those traces
5. Score baseline, identify which metric is lowest

**Clues for implementation:**
- LangSmith has a RAGAS integration — can pull run data directly via SDK
- Evaluation dataset can be bootstrapped: take 20 real questions agents asked, manually write ideal answers, note which docs they came from
- Run evaluation on a schedule (weekly) not per-request — too expensive to evaluate every query
- Store scores in a simple table or LangSmith dataset for tracking over time

**New env vars needed:**
```bash
# RAGAS uses OpenAI as judge by default
# Already have OPENAI_API_KEY so nothing new needed
# Optionally point to a different judge model:
RAGAS_JUDGE_MODEL=gpt-4-turbo
```

**Files to create:**
- `scripts/evaluate.py` — RAGAS evaluation script
- `scripts/eval-dataset.json` — question/answer/context evaluation set

---

### Stage 3 — Identify failure patterns from real usage

After 2-4 weeks of real usage + RAGAS scores, look for patterns:

**Common RAG failure patterns and what causes them:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Low faithfulness | System prompt not strict enough | Tighten grounding instruction |
| Low context_precision | Chunk size too large, retrieval too broad | Reduce chunkSize, reduce limit in similaritySearch |
| Low context_recall | Chunk size too small, missing relevant sections | Increase chunkSize or overlap |
| Good scores but agents say answers are wrong | Evaluation dataset not representative | Rebuild eval dataset from real failure cases |
| Answers good for simple questions, bad for complex | Single-step retrieval insufficient | → Stage 4: LangGraph |

**How to surface patterns:**
- LangSmith dashboard — filter by low-score runs, read the traces
- Add user feedback to chat UI — thumbs up/down per answer, store in DB
- Weekly RAGAS report — track score trends over time

**New DB table when you get here:**
```sql
chat_feedback (
  id, chat_message_id, rating (positive|negative), comment, createdAt
)
```

---

### Stage 4 — LangGraph for agentic multi-step reasoning

**What LangGraph is:**
LangGraph lets you build stateful AI workflows as a graph — nodes are steps, edges are decisions. The AI can loop, branch, and retry instead of just going straight line.

**Current straight-line RAG:**
```
query → retrieve → answer
```

**LangGraph enables:**
```
query
  → retrieve chunks
  → grade: are chunks relevant?
      NO → rewrite query → retrieve again (loop up to 3x)
      YES → generate answer
  → grade: is answer grounded in chunks?
      NO → regenerate with stricter prompt
      YES → return answer + sources
```

**Specific use cases for Mnemra where LangGraph helps:**

1. **Query rewriting** — agent asked a vague question like "refund thing", initial retrieval finds weak chunks, LangGraph rewrites to "refund policy steps" and retries
2. **Multi-hop retrieval** — "compare our SLA to our refund timeline" needs two separate retrievals then synthesis
3. **Fallback routing** — if KB has no relevant chunks (score below threshold), route to a different knowledge source or reply "I don't know" with confidence
4. **Self-grading** — after generating answer, LLM grades its own faithfulness before returning to user

**Only add LangGraph when RAGAS shows:**
- `faithfulness` consistently below 0.7 (hallucinating)
- `context_recall` consistently below 0.6 (missing relevant chunks)
- Agents reporting multi-part questions getting partial answers

**How to implement when ready:**
1. Install `@langchain/langgraph` (Node.js package)
2. Replace `askQuestion()` async generator in `packages/ai/src/chains/index.ts` with a LangGraph `StateGraph`
3. Nodes: `retrieve`, `gradeChunks`, `rewriteQuery`, `generateAnswer`, `gradeAnswer`
4. Edges: conditional — grade output decides next node
5. Keep same external interface — `askQuestion()` still returns `AsyncGenerator<string>` — LangGraph is an internal implementation detail

**New env vars when implementing:**
```bash
# LangGraph uses LangSmith automatically — already have those
# No new vars needed
```

**Files to touch:**
- `packages/ai/src/chains/index.ts` — replace async generator internals with LangGraph StateGraph
- `packages/ai/src/chains/graph.ts` — new file, define nodes and edges
- `packages/ai/src/chains/nodes/` — separate file per node for clarity

---

### Summary: the order matters

```
1. Ship working product (P1-P3)
   → Real users, real questions, real failures

2. Add RAGAS + LangSmith evaluation
   → Baseline scores, identify weakest metric

3. Fix the weakest metric first
   → Chunk size? Prompt? Retrieval limit? Fix the simple thing first.

4. Only add LangGraph if failure pattern requires it
   → Multi-step questions, low recall after simpler fixes exhausted
```

Don't skip steps. Adding LangGraph to a RAG that isn't wired to real users yet
is solving a problem you haven't measured. RAGAS before LangGraph, always.

---

## Architecture decisions already made

| Decision | Choice | Reason |
|---|---|---|
| Vector storage | pgvector (single table + RLS) | Scales to thousands of tenants, no table-per-tenant complexity |
| Chunk dedup | SHA-256 per chunk, diff on re-ingest | Only re-embeds changed chunks, not full re-ingestion |
| Token counting | tiktoken cl100k_base | Matches OpenAI embedding model exactly |
| Chunk size | 512 tokens, 50 overlap | Fits embedding model limits with context preservation |
| Embedding model | text-embedding-3-small (configurable) | Cost-efficient, 1536 dimensions |
| Chat model | gpt-4-turbo (configurable) | Deterministic (temp=0), grounded system prompt |
| Streaming | AsyncGenerator yield | Tokens flow to FE as OpenAI sends them |
| Queue | Bull + Redis | Background ingestion, retry on failure |
| Auth | JWT access + refresh token | Stateless API, revokable sessions |
| OTP email | Resend | Simple API, good deliverability |

---

## Env vars needed

```bash
# DB
DATABASE_URL=postgresql://...

# Redis (for Bull queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# OpenAI
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small   # optional
OPENAI_CHAT_MODEL=gpt-4-turbo                   # optional

# LangSmith tracing
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=mnemra

# Auth
JWT_SECRET=
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Email
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@mnemra.com
```

---

## Prompt to resume with Claude Code

Paste this at the start of a new session:

```
You are a senior engineer and mentor helping me build Mnemra — an AI-powered support knowledge base SaaS (RAG-based). Mnemra is your support team's institutional memory on demand. It ingests past tickets, product docs, runbooks, and internal wikis, then makes all of that knowledge instantly queryable for support agents.

This is both a real product and a portfolio/learning project. Help me implement correctly AND understand what I'm building.

## Who I am
I am a capable developer who wants to understand the "why", not just copy-paste code. I learn by doing and asking questions. I push back when something doesn't feel right or scalable. Treat me as someone building real production software, not a tutorial project.

## Communication style — non-negotiable, retain every session
- Always invoke /caveman skill at the start — terse, no fluff, full technical substance, no pleasantries
- Use simple English words and be on point. If tech terms are needed, always add an analogy so I can visualize it
- Before implementing anything, create a clear step-by-step plan and wait for my approval
- Implement one step at a time — never jump ahead
- After each step, explain what was built and why those decisions were made, including which file and what each block does
- If there are multiple valid approaches, briefly explain the tradeoff and recommend one with a reason
- Pause after each step and ask if I have questions before moving on
- If I ask a question mid-implementation, stop and answer it fully before continuing
- If I push back on a decision, engage with the reasoning — don't just agree. If my pushback is wrong, explain why. If it's right, acknowledge it and adjust.
- Never say "for now" on decisions that have scalability implications — always consider future growth from the start, like building a house with steel beams for future floors
- When explaining removed or added code, be specific about which file, which block, and why

## How I think about the product
- Mnemra is a real SaaS with real clients. Every decision has to be correct from day one — not "good enough for now"
- Multi-tenancy is a core requirement. Every feature must respect tenant isolation. No shortcuts.
- The RAG pipeline is the core value. Ingestion quality = answer quality = product value.
- Support agents use this under pressure. Answers must be fast, accurate, and sourced. Hallucinations are trust-killers.
- The flywheel: more usage → more ingested data → smarter answers → more usage.

## What I've learned so far (don't re-explain these)
- Why single pgvector table + RLS beats per-tenant tables
- Why SHA-256 chunk-level dedup beats full re-ingestion
- Why tiktoken beats character counting for chunk sizing
- Why tenantId lives in chunk metadata but tenantName does not
- Why contentHash lives on documents AND chunks (two-level dedup)
- Why sectionId/sectionTitle are steel beams for future section-aware splitting
- Why embedDocuments and embedQuery are separate functions
- Why the ingestion pipeline (not the chunker) injects tenantId into chunks
- Why RLS throws an error (not silent empty results) when tenantId is missing
- Why LangGraph comes AFTER RAGAS evaluation, not before
- The difference between LangSmith (observability) and RAGAS (evaluation)

## Architecture context
Turborepo monorepo with Bun workspaces:
- apps/api — NestJS backend (port 3001), Bull queue with Redis
- apps/web — Next.js 14 frontend
- packages/ai — complete AI pipeline (loaders → chunking → embeddings → vectorstore → chains)
- packages/db — Drizzle ORM + pgvector schema
- packages/ui — 15 shared UI components

## What's already built
- packages/ai: fully implemented (loaders, chunking with SHA-256 dedup + section-aware steel beams, embeddings, vectorstore with hash-based sync, streaming RAG chain, LangSmith tracing)
- packages/db: tenants, documents, chunks tables with pgvector, contentHash, sectionId, sectionTitle
- apps/api: NestJS skeleton, Bull queue wired, all services are stubs
- apps/web: landing page, dashboard shell, chat shell (calls OpenAI directly, NOT wired to RAG)
- packages/ui: 15 polished components

## Key decisions already made — do not re-litigate
- Single pgvector table + RLS for multi-tenancy (not separate tables per tenant)
- SHA-256 chunk-level dedup — only re-embeds changed chunks on re-ingestion
- tiktoken cl100k_base for real token counting (not character approximation)
- 512 tokens chunk size, 50 overlap
- text-embedding-3-small as default embedding model (configurable via env)
- gpt-4-turbo as default chat model (configurable via env), temperature=0
- Streaming via AsyncGenerator yield
- JWT access token (15m) + refresh token (7d)
- OTP verification via Resend on registration
- Bull + Redis for background ingestion jobs
- RAGAS evaluation before LangGraph — measure before optimizing

## What to build next
Read docs/ROADMAP.md for the full prioritized list. Start with Priority 1:
1. DB schema additions — users, otps, refresh_tokens, workspaces, workspace_members, invitations, knowledge_bases. Add status + knowledgeBaseId to documents.
2. Auth module in NestJS — register, verify-otp, login, refresh, logout, JWT guard
3. Auth pages in Next.js — /register, /login, /verify-otp

Before writing any code, read the existing files first, create a full plan, and wait for approval.
```
