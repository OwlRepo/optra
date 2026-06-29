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
| `apps/api/src/auth/guards/workspace-member.guard.ts` | Per-request check: is this user a member of the workspace in the route param; attaches `{workspaceId, role}` to the request | Auth / Workspaces | Deep | Tested in `workspace-member.guard.spec.ts` |
| `apps/api/src/auth/decorators/current-workspace-member.decorator.ts` | Param decorator that reads `req.workspaceMember` for controller handlers | Auth / Workspaces | Express | No tests needed — trivial passthrough |
| `apps/api/src/notifications/notifications.service.ts` | Sends OTP email via Resend, or console-logs in dev when `EMAIL_OTP_ENABLED!=='true'` | Auth | Standard | Covered indirectly via `auth.service.spec.ts` |
| `packages/db/src/db/index.ts` | Drizzle client + exported `pg.Pool` (`pool` exported specifically so tests can close the connection cleanly) | DB infra | Standard | — |
