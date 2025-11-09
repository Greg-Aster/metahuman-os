# Headless Runtime Mode Implementation

## Goal
Allow MetaHuman to expose the UI through the Cloudflare tunnel without running the owner profile and long-lived agents locally. When “headless mode” (a.k.a. remote-only mode) is enabled, the laptop should:

- keep the tunnel + Astro/CLI HTTP endpoints alive,
- pause any local persona/agent execution loops,
- transfer exclusive runtime control to the first authenticated remote session,
- resume local behavior only when headless mode is disabled again.

## Current Architecture Notes
- Tunnel management lives in `packages/core/src/cloudflare-tunnel.ts` and stores its config in `etc/cloudflare.json`.
- The Network tab (`apps/site/src/components/NetworkSettings.svelte`) drives `/api/cloudflare/*`.
- Runtime/agent orchestration happens inside CLI commands (`packages/cli/src/commands/*`) and the long-running agents under `brain/agents/*`.
- UI state is derived from `statusStore`, `currentMode`, etc. inside `apps/site/src/stores/*`.

## Implementation Steps

### 1. Persist a Runtime Mode Flag
1. Extend the Cloudflare config or create `etc/runtime.json` with:
   ```ts
   interface RuntimeState {
     headless: boolean;   // true = pause local persona workloads
     lastChangedBy: 'local' | 'remote';
     changedAt: string;
   }
   ```
2. Add helpers in `@metahuman/core` (e.g., `packages/core/src/runtime-mode.ts`):
   - `getRuntimeMode(): RuntimeState`
   - `setRuntimeMode(partial: Partial<RuntimeState>)`
   - `isHeadless(): boolean`
3. Export these helpers from `@metahuman/core/index.ts` so both CLI + web API can access them.

### 2. Runtime API
1. Add `apps/site/src/pages/api/runtime/mode.ts` with:
   - `GET` → returns `{ headless, changedAt, lastChangedBy }`.
   - `POST` → body `{ headless: boolean }`, validates owner session, updates file via `setRuntimeMode`.
2. Update `/api/status` logic (wherever `statusStore` is populated) to include `runtime: { headless }`.
3. Wire owner-only authentication using the existing guards (e.g., `isOwner` store / session middleware).

### 3. Network Tab UX
1. In `NetworkSettings.svelte`:
   - Fetch `/api/runtime/mode` alongside tunnel status.
   - Add a “Headless Mode” toggle with copy like: “Keep tunnel + server online but park local agents until a remote session is active.”
   - When the toggle is enabled, call `POST /api/runtime/mode { headless: true }` before `startTunnel()`.
   - Disable the toggle when the tunnel isn’t installed or the user isn’t the owner.
2. Surface state badges (e.g., `🟡 Headless active`) so users know local agents are paused.
3. Optionally warn that the laptop must remain awake even in headless mode.

### 4. CLI / Dev Server Hooks
1. Identify central startup points:
   - `packages/cli/src/commands/dev.ts` (or whichever command launches the local stack).
   - Agent launchers (`./bin/mh agent run …`, scheduler bootstrap).
2. Before starting persona services, check `isHeadless()`:
   ```ts
   if (isHeadless()) {
     logger.info('Headless mode active; skipping local persona boot');
     return;
   }
   ```
3. For commands that must always run (e.g., `mh status`, `mh tunnel`), let them proceed regardless.
4. Emit an audit entry when headless is toggled so there’s a history of state changes.

### 5. Agent Safeguards
1. In each long-lived agent entry (`brain/agents/*.ts`), early exit if `isHeadless()` is true and no remote session requested that agent.
2. Optionally add a lightweight watcher process that:
   - listens for remote session login events (existing auth hooks),
   - flips `headless` off when a remote operator claims the system,
   - or spawns per-profile agents scoped to the remote user context.

### 6. Remote Session Activation
1. When a remote user logs in (see `AuthGate.svelte`, `ProfileSelector.svelte`):
   - call `/api/runtime/mode` to confirm current state;
   - if `headless` is true, show a CTA “Claim runtime” that sets `{ headless: false, lastChangedBy: 'remote' }`.
2. Propagate this change to the CLI layer via the shared config file; any watchers can then resume agents.

### 7. Prevent Sleep / Keepalive
Headless mode alone can’t stop the OS from sleeping. Document recommended host-level steps (e.g., `systemctl mask sleep.target`, `caffeinate`, BIOS settings) and consider shipping helper scripts in `bin/` to keep the process awake while the tunnel is running.

### 8. Testing Checklist
1. Toggle headless mode locally; confirm `/api/runtime/mode` updates and persists across restarts.
2. Start `pnpm dev` → ensure persona workloads skip boot when headless is on.
3. Disable headless and verify agents resume automatically or after remote claim.
4. Run `./bin/mh agent run organizer` manually in headless mode to confirm it exits early.
5. Validate Cloudflare tunnel flow still works (start/stop/toggle).
6. Run `./bin/audit check` after code changes.

## Notes for the Coding Agent
- Avoid running agents while editing this feature; stale processes will mask whether the new guard clauses work.
- Keep new stores/config files inside the repo (`etc/`). These are user-owned but needed for persistence.
- Reuse existing trust/security stores; do not add separate access control paths for the new API endpoints.
- Document the UX in `docs/user-guide` once the implementation lands.
