# Unified API Layer

## Overview

The Unified API Layer provides a single, framework-agnostic API that works for both the web app (Astro) and mobile app (nodejs-mobile). This eliminates code duplication and ensures consistent behavior across platforms.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Request                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Adapters                                │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │   Astro Adapter     │    │      Mobile Adapter             │ │
│  │  (HTTP → Unified)   │    │  (Message Bridge → Unified)     │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Unified Router                              │
│  - Path matching (exact + regex)                                │
│  - Security guards (owner, writeMode, operatorMode)             │
│  - Parameter extraction                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Unified Handlers                             │
│  - Pure functions, no framework dependencies                    │
│  - Use withUserContext() for user-specific operations           │
│  - Call core functions from @metahuman/core                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Functions                               │
│  - captureEvent(), searchMemory(), createTask(), etc.           │
│  - User context resolved via AsyncLocalStorage                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
packages/core/src/api/
├── index.ts              # Main exports
├── types.ts              # UnifiedRequest, UnifiedResponse, helpers
├── router.ts             # Request routing and security
├── handlers/
│   ├── index.ts          # Handler exports
│   ├── system.ts         # /api/status, /api/boot
│   ├── memories.ts       # /api/capture, /api/memories
│   ├── tasks.ts          # /api/tasks CRUD
│   ├── auth.ts           # /api/auth/me
│   ├── persona.ts        # /api/persona endpoints
│   ├── cognitive-mode.ts # /api/cognitive-mode
│   └── conversation.ts   # /api/conversation-buffer
└── adapters/
    └── mobile.ts         # Mobile message bridge adapter

apps/site/src/lib/server/
└── api-adapter.ts        # Astro HTTP adapter
```

## Types

### UnifiedRequest

```typescript
interface UnifiedRequest {
  path: string;                           // e.g., '/api/capture'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;                             // Parsed JSON body
  query?: Record<string, string>;         // Query parameters
  headers?: Record<string, string>;       // Request headers
  user: UnifiedUser;                      // Resolved by adapter
  params?: Record<string, string>;        // Path parameters
  signal?: AbortSignal;                   // For cancellation
  metadata?: Record<string, any>;         // Custom adapter data
}
```

### UnifiedResponse

```typescript
interface UnifiedResponse {
  status: number;                         // HTTP status code
  data?: any;                             // Response data (JSON)
  error?: string;                         // Error message
  headers?: Record<string, string>;       // Response headers
  stream?: AsyncIterable<string>;         // For SSE streaming
  cookies?: CookieOperation[];            // Cookie operations
}
```

### UnifiedUser

```typescript
interface UnifiedUser {
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  isAuthenticated: boolean;
}
```

## Response Helpers

```typescript
import {
  successResponse,      // (data, status=200) → UnifiedResponse
  errorResponse,        // (error, status=500) → UnifiedResponse
  unauthorizedResponse, // (message?) → 401 response
  forbiddenResponse,    // (message?) → 403 response
  notFoundResponse,     // (message?) → 404 response
  badRequestResponse,   // (message?) → 400 response
  streamResponse,       // (stream) → SSE response
  responseWithCookie,   // (data, cookie) → response with Set-Cookie
} from '@metahuman/core/api';
```

## Usage

### Creating an Astro Route (Simple)

```typescript
// apps/site/src/pages/api/capture.ts
import { createAstroHandler } from '../../lib/server/api-adapter';

// requiresAuth = true means 401 if not authenticated
export const POST = createAstroHandler(true);
```

### Creating an Astro Route (Multiple Methods)

```typescript
// apps/site/src/pages/api/tasks.ts
import { createAstroHandlers } from '../../lib/server/api-adapter';

export const { GET, POST } = createAstroHandlers({
  GET: false,   // Public
  POST: true,   // Requires auth
});
```

### Catch-All Route

```typescript
// apps/site/src/pages/api/[...path].ts
import { createCatchAllHandler } from '../../lib/server/api-adapter';

// Routes all requests through unified router
export const ALL = createCatchAllHandler();
```

### Adding a New Unified Handler

1. Create handler in `packages/core/src/api/handlers/`:

```typescript
// packages/core/src/api/handlers/my-feature.ts
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { myCoreFn } from '../../my-module.js';

export async function handleMyFeature(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { param } = req.body || {};

  if (!param) {
    return badRequestResponse('param is required');
  }

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => myCoreFn(param)
  );

  return successResponse({ success: true, result });
}
```

2. Export from `handlers/index.ts`:

```typescript
export * from './my-feature.js';
```

3. Register in `router.ts`:

```typescript
import { handleMyFeature } from './handlers/my-feature.js';

const routes: RouteDefinition[] = [
  // ... existing routes
  { method: 'POST', pattern: '/api/my-feature', handler: handleMyFeature, requiresAuth: true },
];
```

## Security Guards

Routes can specify security guards:

```typescript
{
  method: 'POST',
  pattern: '/api/cognitive-mode',
  handler: handleSetCognitiveMode,
  requiresAuth: true,
  guard: 'owner',  // Only owners can access
}
```

Available guards:
- `owner` - User must have role 'owner'
- `writeMode` - Blocks in emulation mode
- `operatorMode` - Blocks in emulation mode and for non-owners

## Mobile Adapter

The mobile adapter converts nodejs-mobile message bridge format:

```typescript
// Mobile request format
interface MobileRequest {
  id: string;           // Request ID for response correlation
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  sessionToken?: string;
}

// Mobile response format
interface MobileResponse {
  id: string;           // Matches request ID
  status: number;
  data?: any;
  error?: string;
}
```

Usage in nodejs-mobile main.js:

```javascript
import { handleMobileRequest } from '@metahuman/core/api/adapters/mobile';

// Handle message from WebView
bridge.channel.on('api-request', async (msg) => {
  const response = await handleMobileRequest(msg);
  bridge.channel.send('api-response', response);
});
```

## Migration Guide

### Migrating an Existing Astro Route

**Before (Astro-specific):**
```typescript
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, captureEvent } from '@metahuman/core';

const handler: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);
  const body = await request.json();
  const { content } = body;

  const eventId = captureEvent(content, { type: 'observation' });

  return new Response(JSON.stringify({ success: true, eventId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const POST = handler;
```

**After (Unified):**
```typescript
import { createAstroHandler } from '../../lib/server/api-adapter';
export const POST = createAstroHandler(true);
```

The handler logic moves to `packages/core/src/api/handlers/memories.ts`.

## Current Implementation Status

### Migrated Routes (10)

| Route | Method | Handler |
|-------|--------|---------|
| /api/status | GET | handleStatus |
| /api/boot | GET | handleBoot |
| /api/capture | POST | handleCapture |
| /api/memories | GET | handleListMemories |
| /api/memories/search | GET | handleSearchMemories |
| /api/tasks | GET | handleListTasks |
| /api/tasks | POST | handleCreateTask |
| /api/tasks/:id | PUT/PATCH | handleUpdateTask |
| /api/tasks/:id | DELETE | handleDeleteTask |
| /api/auth/me | GET | handleGetMe |
| /api/persona | GET | handleGetPersona |
| /api/persona/summary | GET | handleGetPersonaSummary |
| /api/cognitive-mode | GET | handleGetCognitiveMode |
| /api/cognitive-mode | POST | handleSetCognitiveMode |
| /api/conversation-buffer | GET | handleGetBuffer |
| /api/conversation-buffer | POST | handleAppendBuffer |
| /api/conversation-buffer | DELETE | handleClearBuffer |

### Pending Migration (~199 routes)

The remaining Astro routes in `apps/site/src/pages/api/` need to be migrated incrementally.

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Code duplication | Web + Mobile handlers | Single handlers |
| Maintenance | Update 2 places | Update 1 place |
| Testing | Test 2 implementations | Test once |
| New routes | Create in 2 places | Create once, works everywhere |
| Bug fixes | Fix in 2 places | Fix once |

## Mobile Handler Build Process

The mobile handlers are bundled using esbuild for nodejs-mobile:

```bash
# Build mobile handlers
node apps/mobile/scripts/build-handlers.mjs
```

This creates:
- `apps/mobile/nodejs-project/dist/handlers.js` - Bundled handlers (~170KB)
- `apps/mobile/nodejs-project/dist/handlers.js.map` - Source maps

The build process:
1. Entry point: `packages/core/src/mobile-handlers/index.ts`
2. Re-exports from `packages/core/src/api/adapters/mobile.ts`
3. Bundles all dependencies except `cordova-bridge`
4. Outputs CommonJS format for Node.js v12 compatibility

Bundle contents (as of latest build):
- Unified API router and handlers
- Core functions (memory, tasks, auth, etc.)
- Authentication (bcryptjs for password hashing)
- Mobile scheduler (for local agent execution)

## Integration Status

### Completed

- [x] Unified API types and interfaces
- [x] Unified router with security guards
- [x] 17 proof-of-concept handlers migrated
- [x] Astro adapter for web
- [x] Mobile adapter for nodejs-mobile
- [x] Mobile handlers re-export unified API
- [x] Handler bundle build process
- [x] Mobile agent scheduler (in-process execution)
- [x] Mobile agents (organizer, ingestor) with LLM queue
- [x] Agent lifecycle management (init/stop/pause/resume)
- [x] main.js integration with agent channels

### In Progress

- [ ] Migrate remaining ~199 Astro routes to unified handlers
- [ ] Test unified layer with mobile emulator
- [ ] Test mobile agents on device

## Next Steps

1. **Phase 3B**: Migrate remaining routes incrementally
   - Start with simple routes (status, tasks, memories)
   - Then moderate routes (persona, agency)
   - Finally complex routes (persona_chat, training)

2. **Phase 3C**: Update Astro routes
   - Replace individual route files with catch-all or thin wrappers
   - Keep security middleware (guards)

3. ~~**Phase 4**: Run agents locally on mobile~~ ✅ COMPLETE
   - ~~Review legacy agents for mobile compatibility~~
   - ~~Adapt scheduler for direct function calls (no spawn)~~
   - Mobile agents: organizer, ingestor
   - LLM queue serialization for GPU-bound agents
   - Pause/resume on app lifecycle events

4. **Phase 5**: Local storage + optional sync
   - Profile data stored on device
   - Background sync when connected
