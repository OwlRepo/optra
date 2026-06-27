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
