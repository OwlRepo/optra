# API Contracts

Purpose:

Map important frontend-backend contracts.

This file is map only.

It is not proof of behavior.

Verify all conclusions against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

If this map conflicts with source code, source code wins.

Mark stale or conflicting entries as `CONTRACT DRIFT`.

Mark missing contracts as `UNMAPPED CONTRACT`.

If frontend expectation and backend response differ, mark `CONTRACT MISMATCH`.

Do not invent request or response shapes.

Unknown fields must be marked `TODO: Fill after repository analysis. Do not treat as verified.`

---

## Contract Index

| Domain | Feature | Method | Endpoint / Route | Frontend Caller | Backend Handler | Request Shape | Response Shape | Auth / Permission | Risk | Notes |
| ------ | ------- | ------ | ---------------- | --------------- | --------------- | ------------- | -------------- | ----------------- | ---- | ----- |
| Auth | Register | POST | `/auth/register` | `apps/web/app/api/auth/register/route.ts` (proxy) → `register/page.tsx` | `auth.controller.ts#register` → `auth.service.ts#register` | `{email, password}` | `{message}` or `429` | None (public) | Deep | Email normalized to lowercase before any DB write/read. OTP sent via `NotificationsService` (console log in dev, Resend in prod). Throttled: 5 req / 10 min per caller (`@Throttle`), global default 60/min applies otherwise. Verified via `auth.service.spec.ts`, `test/auth.e2e-spec.ts`, `test/auth-rate-limit.e2e-spec.ts`. |
| Auth | Verify OTP | POST | `/auth/verify-otp` | `.../api/auth/verify-otp/route.ts` → `verify-otp/page.tsx` | `auth.controller.ts#verifyOtp` → `auth.service.ts#verifyOtp` | `{email, code}` | `{accessToken}` + `Set-Cookie: mnemra_rt` (httpOnly), or `429` | None (public) | Deep | Marks `users.isVerified=true`. Code must be unused (`usedAt IS NULL`) and unexpired. Throttled: 5 req / 10 min per caller. Verified live + e2e. |
| Auth | Login | POST | `/auth/login` | `.../api/auth/login/route.ts` → `login/page.tsx` | `auth.controller.ts#login` → `auth.service.ts#login` | `{email, password}` | `{accessToken}` + `Set-Cookie: mnemra_rt`, or `429` | None (public) | Deep | Blocks unverified accounts with 403. Throttled: 10 req / 10 min per caller. Verified live: 10×401 then 429 with `Retry-After: 600`. |
| Auth | Refresh | POST | `/auth/refresh` | `.../api/auth/refresh/route.ts` (must forward `Set-Cookie`, not optional) | `auth.controller.ts#refresh` → `auth.service.ts#refresh` | Cookie `mnemra_rt` | `{accessToken}` + new `Set-Cookie: mnemra_rt` (rotated), or `429`/`401` | Valid, non-revoked refresh cookie | Deep | Rotates on every use: old token revoked, brand-new token issued. Reusing an already-rotated (revoked) token is treated as theft — revokes ALL active refresh tokens for that user, forcing full re-login everywhere. Throttled: 20 req / 10 min per caller. Verified via `auth.service.spec.ts` (unit + theft-cascade case) and `test/auth.e2e-spec.ts` (real HTTP + cookie rotation). |
| Auth | Logout | POST | `/auth/logout` | `.../api/auth/logout/route.ts` | `auth.controller.ts#logout` → `auth.service.ts#logout` | Cookie `mnemra_rt` | `{message}` | Valid refresh cookie (no-op if missing/invalid) | Deep | Revokes the token row (`revokedAt`). No-op, does not throw, if token already revoked or unknown. Verified live. Not throttled — logging out should never be blocked. |
