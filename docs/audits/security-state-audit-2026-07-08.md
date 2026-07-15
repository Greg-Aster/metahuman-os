# MetaHuman Security State Audit

Date: 2026-07-08

## Scope

This audit reviews the current local web/API security state related to:

- login/session/cookie behavior;
- UI auth failure handling;
- API route authentication and owner guards;
- local-first versus LAN/domain exposure;
- places where the current security model creates poor UX or silent failures.

This was a static and low-risk audit. I did not call mutating unauthenticated routes during the review because several can spawn terminals, run agents, start tunnels, execute graphs, or launch models.

## Short Answer

The system is both overcomplicated and underprotected.

It was overcomplicated because the UI had auth state in both an `HttpOnly` cookie and `localStorage`, there was a separate security-policy store, there were two Astro adapter paths in the tree, and many components made their own partial decisions about failed API calls. This pass simplified those areas by making desktop auth cookie-only, reducing the security-policy store to capability display, deleting the duplicate adapter path, and centralizing auth/action feedback through `apiFetch()` and `AuthGate`.

It is underprotected because a significant number of mutating API routes are not marked `requiresAuth` in the central router. The biggest concern is not that every click has too much security. The bigger concern is that some sensitive process/control routes have too little centralized security.

## Current Auth Model

### Session Storage

Sessions are stored server-side in `logs/run/sessions.json` by `packages/core/src/sessions.ts`.

Current local session inventory at audit time:

- total sessions: 59
- active sessions: 2
- expired sessions: 57
- active owner sessions: 2
- expired owner sessions: 34
- expired guest sessions: 7
- expired standard sessions: 4
- expired legacy anonymous sessions: 12

Expired sessions are removed when validated or when cleanup runs, but they can accumulate in the session file.

### Cookie Behavior

The web login flow sets `mh_session` as a server session cookie:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- 24 hour max age for normal login/register
- 7 day max age for sync-user login

A browser refresh does not reset this cookie. Refresh reuses the same cookie until logout, expiry, deletion, or replacement by a new login.

### Client Session Shadow State

Initial finding: `apps/site/src/components/AuthGate.svelte` also stored `{ sessionId, username }` in `localStorage` under `mh_session`.

For desktop web, the server uses the `HttpOnly` cookie, not the `localStorage` value. That meant desktop web could have two session states that disagree.

Status: resolved for desktop writes in this pass. `AuthGate` now only writes the localStorage session shadow for the mobile app path; desktop web relies on the cookie.

### Auth Failure UX

Before the current patch, many API calls could return `401` or `403` after app load without forcing a visible auth-state transition. That can make buttons appear dead.

Current patch state:

- `apiFetch()` now dispatches `mh:api-auth-failure` on non-auth-route `401`/`403`.
- `AuthGate` listens for that event, clears local session state, calls logout to clear the server cookie, and returns the UI to login with a clear message.
- the router now deletes `mh_session` on auth-required `401` when the request included a session id.

That is the right direction.

## Route Security Findings

### Critical: Mutating Routes Without `requiresAuth`

Static route scan of `packages/core/src/api/router.ts`:

- route definitions scanned: 518
- routes without `requiresAuth`: 190
- mutating routes without `requiresAuth`: 75

Some unauthenticated mutating routes are expected auth entrypoints, for example login/register/logout/guest/reset-password. Many are not.

High-risk examples:

- terminal control:
  - `POST /api/terminal/spawn`
  - `POST /api/terminal/spawn-claude`
  - `DELETE /api/terminal/spawn-claude`
  - `POST /api/terminal/cleanup`
  - `POST /api/terminal/kill/:port`
- active operator:
  - `POST /api/active-operator/config`
  - `POST /api/active-operator/control`
  - `POST /api/active-operator/proposals`
  - `POST /api/active-operator/approvals`
- agent controls:
  - `POST /api/agents/control`
  - `POST /api/agents/run`
- queue/operator execution:
  - `POST /api/unified-queue`
  - `POST /api/unified-queue/control`
  - `POST /api/unified-queue/trigger/:agentId`
  - `POST /api/operator-proposals/respond`
  - `POST /api/operator-proposals/review`
- system/process controls:
  - `POST /api/cloudflare/start`
  - `POST /api/cloudflare/stop`
  - `POST /api/cloudflare/toggle`
  - `POST /api/training/launch`
  - `POST /api/training/load-model`
  - `POST /api/execute`
  - `POST /api/execute-graph`
  - `POST /api/file_operations`

Status: resolved in this pass. The central router now requires authentication for mutating methods by default unless a route is explicitly marked `public: true` with `publicReason`. Process, terminal, agent, model, file, tunnel, code, queue-control, active-operator, training, and system-control routes have been classified as owner-only where appropriate. `scripts/validate-security-routes.ts` now fails the build check if this regresses.

### Important: Local UI Is Not Strictly Loopback-Only

Initial finding: `apps/site/astro.config.mjs` was binding broadly and allowed a baked-in personal domain. `start.sh` printed `http://localhost:4321`, but the site configuration was not purely loopback-oriented.

Status: resolved for startup defaults in this pass. The app now has two explicit modes:

- `local`: bind to `127.0.0.1`, simple local session, no remote exposure assumptions.
- `shared`: explicit opt-in for LAN/domain/tunnel, stricter owner auth, origin checks, and visible warning in settings.

`MH_EXPOSURE_MODE` defaults to `local`. Shared mode requires explicit host/origin configuration instead of hardcoded `mh.dndiy.org` or `.dndiy.org` defaults.

### Important: Two Adapter Paths Existed

Current API route files mostly import `astroHandler` from `@metahuman/core/api/adapters/astro`.

There was also `apps/site/src/lib/server/api-adapter.ts`, which had its own `createAstroHandler()` and its own auth/security-policy conversion path.

The older site-local adapter appeared to be legacy or at least not the primary path for most routes. Keeping it around would have increased the chance that some future endpoint got wired through a different auth path.

Status: deleted in this pass after confirming no active route imports it. Keep one request-to-router path.

### Important: Security Policy Is a Secondary Permission System

`packages/core/src/security-policy.ts` combines:

- user role;
- cognitive mode;
- memory permissions;
- operator permissions;
- file/profile access rules.

`apps/site/src/stores/security-policy.ts` fetches `/api/security/policy` for UI gating.

This can be useful for display and disabling controls, but it should not be the primary enforcement point. The router and handlers must be authoritative. UI policy state can be stale or unavailable.

Recommendation: keep security policy as a derived UI/service capability view. Do not rely on it to protect API routes.

### Moderate: Route Guard Semantics Are Thin

Initial finding: `checkGuard()` supported `owner`, `writeMode`, and `operatorMode`, but `writeMode` only checked authentication and `operatorMode` was effectively owner-only.

Status: resolved in this pass. Route guards are now direct route requirements:

- `requiresAuth`
- `guard: 'owner'`

Avoid cognitive-mode dependent route auth unless there is a concrete user-facing need.

### Moderate: CSRF/Origin Controls Are Not Centralized

Initial finding: the app uses cookie auth and `SameSite=Lax`, but there was no obvious central Origin/Host validation for mutating routes.

Status: resolved for protected mutating routes in this pass. The router now has a central local/shared request boundary. Local mode rejects protected mutating requests unless the host/origin is loopback. Shared mode rejects unexpected browser origins unless they match the request host or `MH_ALLOWED_ORIGINS`.

## UX Findings

### Refresh Does Not Reset Security State

Refresh reloads the UI bundle, but it does not clear `mh_session` cookies or `localStorage`. It can appear to fix things when hydration or EventSource connections restart, but it does not reset authentication by itself.

### Silent Button Failures Have More Than One Cause

Likely causes found:

1. stale/invalid auth response after app load was not globally surfaced;
2. component-level API error handling often logs only to console;
3. desktop web had both cookie and localStorage session state;
4. long-lived SSE/EventSource streams can consume browser same-origin connection slots, causing normal `fetch()` actions to feel stuck.

The current auth-failure patch addresses item 1. It does not yet address the connection-slot issue.

## Recommended Security Direction

### Cleanup Contract

Any security code that is simplified, superseded, or replaced must be removed from the system. Do not leave disabled implementations, fallback auth paths, backup adapters, stale route wrappers, or commented-out old security flows in place.

This is a working contract for the simplification:

- one maintained auth/session path;
- one maintained Astro-to-core API adapter path;
- no duplicate security policy enforcement paths pretending to be backups;
- no stale route definitions for retired behavior;
- no UI-side security ceremony when router enforcement is the owner;
- no "disabled for now" code retained unless it is active configuration data with a documented user-facing toggle.

If a fallback is truly required for mobile or remote sync, it must be the active documented implementation for that surface, not an abandoned duplicate.

### Do Not Remove Security

MetaHuman controls personal data, memories, profile files, model settings, agents, process launchers, terminals, cloud tunnels, and local file operations. It needs authentication and owner controls.

### Do Remove Security Theater

Avoid per-component security ceremony. The UI should not need to decide whether a process-control route is safe. The central router should decide, and the UI should show clear results.

### Target Model

1. Local-first default:
   - bind to `127.0.0.1`;
   - one owner session cookie;
   - no HTTPS/certificate requirement for loopback;
   - no per-button auth logic.

2. Explicit remote/shared mode:
   - opt-in only;
   - visible setting and status indicator;
   - owner required for system/process routes;
   - Origin/Host guard for mutating routes;
   - no unauthenticated process, terminal, file, agent, cloudflare, or model-control endpoints.

3. Central API contract:
   - all mutating routes require auth unless allowlisted with a comment and test;
   - owner guard for high-impact actions;
   - public GET routes must be intentionally classified as public status, health, static docs, or auth bootstrap.

4. Client behavior:
   - `apiFetch()` owns global 401/403 handling;
   - every button-triggered action shows a user-visible pending/success/failure state;
   - desktop web should not depend on `localStorage` session state;
   - mobile-only session storage should be clearly separated from desktop web auth.

## Recommended Next Steps

1. Done in this pass: add a route security audit test that fails on any mutating route without either `requiresAuth: true` or an explicit allowlist reason.

2. Done in this pass: add `requiresAuth: true, guard: 'owner'` to terminal, agent process, active-operator control/config, cloudflare, execute, file operation, training launch, and model-control routes.

3. Done in this pass: review public GET routes and classify them as:
   - public health/status;
   - public static metadata;
   - authenticated user data;
   - owner-only system data.

4. Done in this pass: remove `apps/site/src/lib/server/api-adapter.ts` because no active route imports it.

5. Done in this pass: split local and shared exposure modes:
   - local mode binds loopback;
   - shared mode requires explicit configuration and stronger checks.

6. Partly done in this pass: continue the UI reliability work:
   - done: keep the global auth-failure handling;
   - done: add visible action-result messages for non-chat mutating `apiFetch()` calls;
   - remaining: audit EventSource connection usage if buttons still hang after auth state is fixed.

## Implementation Plan

This plan is binding for the current simplification pass:

1. Make the central router the owner of auth enforcement.
2. Add validation that prevents unauthenticated mutating routes unless explicitly public with a reason.
3. Mark process, terminal, agent, file, tunnel, model, and operator-control routes as owner-only.
4. Preserve only intentional public bootstrap/bridge routes.
5. Delete duplicate or superseded auth/adapter code instead of disabling it.
6. Keep UI auth behavior centralized in `apiFetch()` and `AuthGate`.
7. After router hardening, audit route groups that are still public GET endpoints and classify them.
8. Done in this pass: split local/shared exposure into explicit runtime modes.

## Implementation Log

- Added the cleanup contract above: simplified or superseded security code must be removed, not retained as disabled fallback.
- Changed the central router rule so mutating methods require authentication by default unless a route explicitly sets `public: true` with `publicReason`.
- Added explicit public reasons to auth bootstrap, password recovery, cross-device sync credential flows, and environment bridge ingestion callbacks.
- Added owner guards to high-risk terminal, active-operator, agent-process, queue-control, cloudflare, training launch/load, lifeline, execute, and file-operation routes.
- Classified high-risk GET route groups so system, process, queue, model, training, graph, memory, and config reads now require auth or owner access as appropriate.
- Added explicit local/shared exposure handling in `apps/site/astro.config.mjs`, `start.sh`, and the central router request boundary.
- Added `scripts/validate-security-routes.ts` and the `pnpm validate:security-routes` script to enforce the route contract.
- Deleted the unused duplicate site-local Astro API adapter at `apps/site/src/lib/server/api-adapter.ts`; the maintained adapter path is `@metahuman/core/api/adapters/astro`.
- Removed the unused `startPolicyPolling()` helper from `apps/site/src/stores/security-policy.ts`.
- Updated stale unified API documentation and maintained-source inventory references to stop pointing developers at the deleted site-local adapter.
- Removed the unused `createAstroHandler()` helper from the maintained core Astro adapter; the web route path is now the exported `astroHandler` path.
- Removed the baked-in `mh.dndiy.org` sync default and examples from the maintained web client surface; profile sync now starts unconfigured and requires explicit user input.
- Updated middleware comments and unified API docs so they no longer describe the deleted site-local adapter or retired `writeMode`/`operatorMode` guards as active behavior.
- Expanded `scripts/validate-security-routes.ts` to fail if the maintained web API config reintroduces the personal sync domain or if the Astro adapter reintroduces the removed helper path.
- Made browser `localStorage` session writes mobile-only in `AuthGate`; desktop web now relies on the `HttpOnly` cookie instead of writing a duplicate `mh_session` shadow value.
- Added global UI action feedback for non-chat mutating `apiFetch()` calls so protected button actions show visible pending/success/failure state.
- Tightened site middleware CORS handling so credentialed cross-origin API responses are only emitted for same-host, explicit allowed origins, or safe local loopback cases.
- Simplified the security-policy store into a capability display helper; failed policy fetches no longer install a restrictive fake policy that can silently disable controls.
- Ran a focused stale-reference scan across maintained site/core/docs/security files; only the validator's own forbidden-string checks and this audit's historical notes still mention the retired terms/domains/adapter paths.
- Ran `pnpm validate:security-routes`; the sandboxed run failed on the known `tsx` `/tmp/tsx-1000/*.pipe` permission issue, then the escalated rerun passed `12/12` checks.
- Ran a focused router behavior check: unauthenticated `POST /api/terminal/spawn` returns `401 Authentication required`; public `POST /api/auth/login` still reaches the auth handler and returns `400 Username and password are required` for an empty body.
- Ran `pnpm --dir apps/site build`; build completed successfully after the UI feedback, session-storage, CORS, and policy-store cleanup, with existing Svelte/Rollup warnings.

## Bottom Line

The right move is not "more security everywhere." The right move is less security code in the UI and stricter, simpler enforcement at the router boundary.

Protect user data and process-control routes centrally. Make local mode easy. Make remote/shared mode explicit. Treat silent button failure as a product bug, not as an acceptable security side effect.
