# Authentication Request Path Cleanup Audit

Date: 2026-07-17

Scope: maintained authentication/session handling, owner-only UI initialization, and the legacy `/api/boot` route. Deprecated `apps/code-oss`, generated bundles, and unrelated agency/queue work are excluded.

## Findings

### Web authentication is resolved twice

- `apps/site/src/middleware.ts` validates `mh_session`, reloads the current user, and establishes `UserContext` for every API request.
- `packages/core/src/api/adapters/astro.ts` then forwards only the cookie to `packages/core/src/api/adapters/http.ts`.
- The HTTP adapter validates the same session, reloads the same user, and establishes the same `UserContext` again.

The middleware context is still required by custom Astro routes, while the unified HTTP adapter remains the authentication owner for non-Astro callers. The safe consolidation is an explicit resolved-user handoff from Astro middleware to the unified adapter. An absent handoff must retain cookie resolution for mobile and direct adapter callers.

### Session activity persistence is write-amplified

`validateSession()` synchronously reads `sessions.json` and then rewrites the complete store merely to advance `lastActivity`, even though session expiry is currently absolute. A burst of API calls therefore creates a burst of redundant filesystem writes. Expiry and deletion writes are security-relevant and must remain immediate; activity timestamps can be coalesced to a bounded interval.

### Owner-only UI work starts before capability checks

The API router correctly enforces owner authorization for runtime mode, trigger manager, monitor, trust, terminal management, and Big Brother configuration routes. Several shared client components nevertheless start those requests or SSE connections during mount for every authenticated role. This produces predictable `403` responses and can trigger reconnect traffic.

The client already has a browser-only security-policy store. It should be initialized by the authentication gate before the application shell mounts, then used to suppress known-forbidden owner operations. These UI checks are load/UX controls only; router authorization remains the security boundary.

### `/api/boot` no longer has a coherent owner

The maintained server starts work coordination from the server entrypoint, and the existing boot handler itself states that agents are started by the startup scripts. Despite that, `/api/boot` also attempts local-model and Big Brother process management while returning persona, backend, and version data.

Maintained callers use it only for:

- a splash-screen icon that already has a static fallback;
- connection/version probing, which `/api/app-info` can serve without side effects;
- server-tier availability, which `/api/status` can serve without side effects.

After migrating those callers, the route and handler have no maintained source owner and should be deleted. Historical documentation and generated/deprecated client bundles are records or build products, not maintained callers.

## Intended cleanup

1. Pass middleware-resolved user state into the Astro adapter and avoid duplicate cookie resolution there.
2. Coalesce `lastActivity` persistence while preserving immediate expiry/deletion writes.
3. Initialize the existing security-policy store before rendering authenticated UI and gate owner-only startup calls/streams.
4. Replace maintained `/api/boot` callers with `/api/app-info` or `/api/status`, remove the route, and delete its obsolete handler code.

## Acceptance checks

- Direct/mobile `handleHttpRequest()` calls still authenticate from the session cookie.
- Astro requests use the pre-resolved middleware user and preserve current-role lookup behavior.
- `401` remains the only response that invalidates the browser session; `403` remains an authorization result.
- Standard users do not open the audited owner-only requests or streams during normal shell initialization.
- Owner users retain access to owner controls.
- No maintained source references `/api/boot` or `handleBoot`.
- Focused adapter/session/client contracts, architecture checks, and the site build pass.
