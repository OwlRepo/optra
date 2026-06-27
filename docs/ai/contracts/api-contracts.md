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
