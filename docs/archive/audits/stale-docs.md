# Stale Docs Authority Audit

## Scope

Lane: stale docs authority.

Owned files reviewed and updated:

- `README.md`
- `STARTUP.md`
- `docs/technical/README.md`
- `docs/NEXT-STEPS.md`
- `docs/MOBILE-IMPLEMENTATION.md`
- `docs/UNIFIED-API-LAYER.md`
- `docs/REMAINING-WORK.md`
- `docs/OPTIONAL-NEXT-STEPS-STATUS.md`

## Findings

### Public orientation

- `README.md` did not point readers at the tracked architecture/refactor authority before product overview material.
- `README.md` mixed maintained source with runtime/user data in the project structure.
- `STARTUP.md` presented the deprecated `apps/mobile` Capacitor APK flow as an active startup path.
- `docs/technical/README.md` linked to several historical or path-incorrect docs as if they were current technical authority.

### Historical planning/status docs

- `docs/NEXT-STEPS.md` and `docs/MOBILE-IMPLEMENTATION.md` describe the deprecated `apps/mobile` standalone architecture.
- `docs/UNIFIED-API-LAYER.md` describes historical nodejs-mobile adapter work. The active rule is now the blueprint contract: API routes are thin transport, and business logic belongs in `packages/core/src/api/handlers`.
- `docs/REMAINING-WORK.md` and `docs/OPTIONAL-NEXT-STEPS-STATUS.md` are 2025 authentication migration follow-ups with stale file/line references and local log examples.

## Actions Taken

- Added current-authority pointers to `README.md`, `STARTUP.md`, and `docs/technical/README.md`.
- Updated public orientation to state the app/core/brain boundary:
  `apps/*` are interface shells, `packages/core` is the engine, and `brain/*` sits above the engine.
- Clarified that `persona`, `profiles`, `memory`, `logs`, `out`, and local agent data are runtime/user-owned data, not maintained source.
- Removed active `apps/mobile` startup instructions from `STARTUP.md` and pointed mobile work at `apps/react-native`.
- Added archive notices to historical mobile, unified API, and authentication follow-up docs.

## Residual Risk

This lane did not audit or rewrite every archived document under `docs/`. Other stale docs remain in the repository and should be handled through future audit batches or remote-safety cleanup, not broad unscoped churn.
