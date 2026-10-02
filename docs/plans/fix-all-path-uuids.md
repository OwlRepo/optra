# Fix B16 — every path id answers 400 when malformed

Owner instruction 2026-10-03: "just finish the whole plan now" (B16 was the open decision; recommended default taken: fix).

- **Classification:** BUG_FIX · Standard (pipes on seven controllers; no service, schema or auth change). Contract areas: API — a malformed id on these routes answers 400 `Validation failed (uuid is expected)` where it answered 500. DB — none.
- **Root cause:** the B13 failure mode on eleven routes outside catalogs. Each took an id from the path with no pipe, the id reached a `uuid` query, and Postgres `22P02` became a 500. The routes were:
  - remove-member `:userId` (live);
  - chat `:sessionId`;
  - FAQ draft `:draftId` ×2;
  - freshness flag `:flagId`;
  - knowledge base `:kbId`;
  - scrape `:kbId` ×2;
  - ticket `:ticketId` ×3.
- **Fix:** `new ParseUUIDPipe()` on each. `:workspaceId` stays with `WorkspaceMemberGuard`, which answers 403 first.
- **Tests first (RED `433c8d0`):**
  - `common/path-ids.spec.ts` walks every controller.
  - The API e2e sweep covers all eleven routes.
  - No page changed, so no browser test.
