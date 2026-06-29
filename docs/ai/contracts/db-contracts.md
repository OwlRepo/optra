# Database Contracts

Purpose:

Map important database models, ownership, and invariants.

This file is map only.

It is not proof of behavior.

Verify all conclusions against schema, migrations, services, jobs, and tests.

If this map conflicts with source code, source code wins.

Mark stale or conflicting entries as `CONTRACT DRIFT`.

Mark missing contracts as `UNMAPPED CONTRACT`.

If mutation path bypasses required invariant, mark `CONTRACT MISMATCH`.

Do not invent invariants.

Unknown fields must be marked `TODO: Fill after repository analysis. Do not treat as verified.`

---

## Contract Index

| Domain | Model / Table | Owner Module | Important Fields | Invariants | Mutation Paths | Transaction / Idempotency Rules | Related APIs / Jobs | Risk | Notes |
| ------ | ------------- | ------------ | ---------------- | ---------- | -------------- | ------------------------------- | ------------------- | ---- | ----- |
| Auth | `users` | `apps/api/src/auth` | `id`, `email` (unique), `passwordHash`, `isVerified` | `email` always stored lowercase+trimmed — enforced in `auth.service.ts#normalizeEmail`, not a DB constraint | insert via `register()`; update `isVerified` via `verifyOtp()` | none (single-row writes) | `POST /auth/register`, `/auth/verify-otp`, `/auth/login` | Deep | UNVERIFIED DEPENDENCY: no DB-level case-insensitive unique index — relies entirely on the app-layer normalization. Verified via `auth.service.spec.ts`. |
| Auth | `otps` | `apps/api/src/auth` | `userId` (FK), `code`, `expiresAt`, `usedAt` | one-time use: valid only if `usedAt IS NULL` and `expiresAt > now` | insert via `register()`; `usedAt` set via `verifyOtp()` | none | `POST /auth/register`, `/auth/verify-otp` | Deep | No rate limit on guess attempts yet — Task #2 (rate limiting) pending. |
| Auth | `refresh_tokens` | `apps/api/src/auth` | `userId` (FK), `tokenHash` (SHA-256, raw token never stored), `expiresAt`, `revokedAt` | valid only if `revokedAt IS NULL` and `expiresAt > now` | insert via `issueTokens()`; `revokedAt` set via `logout()` AND via `refresh()` (rotation revokes the old row every time) | `refresh()` rotation (revoke-old + insert-new) runs inside `db.transaction()` as of 2026-06-29 — atomic, a crash mid-rotation rolls back instead of leaving a dead-end session | `POST /auth/login`, `/verify-otp`, `/refresh`, `/logout` | Deep | Reuse of an already-revoked token triggers `refresh()` to revoke every other active token for that `userId` (theft response). Verified in `auth.service.spec.ts`. |
| Workspaces | `workspace_members` | `apps/api/src/auth/guards` (read), Priority 2 workspaces module (write, not yet built) | `workspaceId` (FK), `userId` (FK), `role` (`owner`\|`admin`\|`member`) | `(workspaceId, userId)` pair determines access; checked fresh per-request, never cached in the JWT | read via `WorkspaceMemberGuard`; no insert path exists yet | none | future workspace-scoped routes (Priority 2) | Deep | `WorkspaceMemberGuard` built and tested (`workspace-member.guard.spec.ts`) but nothing creates membership rows yet. |
