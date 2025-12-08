# Node.js Mobile Integration

**Status**: Phase 2 In Progress (Shared handlers created)
**Date**: 2025-12-07

## Overview

The mobile app now embeds a full Node.js runtime using `nodejs-mobile-cordova`. This allows the same TypeScript/JavaScript code to run on mobile as on the server, enabling a true "full program" mobile experience rather than a thin client.

## Architecture

```
Android App (APK - 58MB)
├── Capacitor WebView (UI Layer)
│   └── Svelte components (same as web)
│   └── node-bridge.ts → routes to local Node.js or server
│
└── nodejs-mobile Worker (Backend Layer)
    └── main.js (entry point)
    └── cordova-bridge (native ↔ JS communication)
    └── [future] @metahuman/core agents
```

## Completed Work

### 1. Plugin Installation
- Added `nodejs-mobile-cordova` to `apps/mobile/package.json`
- Plugin provides full Node.js v12.x runtime (~44MB libnode.so per architecture)

### 2. Node.js Backend (`apps/mobile/nodejs-project/`)

**main.js** - Entry point that:
- Initializes cordova-bridge for communication
- Listens for 'request' events from UI
- Sends 'ready' event when initialized
- Handles API requests and returns responses

**package.json** - Node.js project manifest

### 3. UI Bridge (`apps/site/src/lib/client/node-bridge.ts`)

Functions:
- `isNodejsMobileAvailable()` - Checks if `window.nodejs` exists
- `isNodeReady()` - Returns true when Node.js backend is ready
- `startNodeRuntime()` - Starts Node.js with main.js
- `initNodeBridge()` - Called on app startup from AuthGate
- `nodeBridge(path, init)` - Smart fetch that routes to Node.js or server

### 4. Native Build Setup

**CMakeLists.txt** (in `app/libs/cdvnodejsmobile/`):
- Compiles `nodejs-mobile-cordova-native-lib`
- Links against prebuilt `libnode.so`
- Includes cordova-bridge native code

**Files in cdvnodejsmobile/**:
- `CMakeLists.txt` - Build configuration
- `native-lib.cpp` - JNI bridge
- `cordova-bridge.cpp` / `.h` - Native communication layer
- `libnode/bin/{arch}/libnode.so` - Node.js runtime per architecture
- `libnode/include/node/` - Node.js headers

### 5. Setup Script (`apps/mobile/scripts/setup-nodejs-mobile.sh`)

Must be run after `npx cap sync android`. It:
1. Copies nodejs-project to www folder
2. Sets up native libs in both app and cordova-plugins modules
3. Updates CMakeLists.txt with correct include paths
4. Decompresses libnode.so.gz files
5. Copies nodejs-mobile-cordova-assets (includes builtin_modules)
6. Copies builtin_modules to cordova-plugins assets

## Build Process

```bash
# 1. Build web UI with mobile config
cd apps/site
pnpm build --config astro.config.mobile.mjs

# 2. Sync Capacitor
cd ../mobile
npx cap sync android

# 3. Set up nodejs-mobile (REQUIRED after cap sync)
./scripts/setup-nodejs-mobile.sh

# 4. Build APK
cd android
./gradlew assembleDebug

# APK location: android/app/build/outputs/apk/debug/app-debug.apk
```

Or use the full build script (needs update to include setup-nodejs-mobile.sh):
```bash
cd apps/mobile
./scripts/build-mobile.sh
```

## Verified Working

Logs showing successful initialization:
```
[node-bridge] Starting Node.js runtime...
[node-bridge] Node.js start callback - waiting for ready event
[node-bridge] Node.js runtime ready: [object Object]
[node-bridge] Node.js bridge initialized
```

## File Locations

| File | Purpose |
|------|---------|
| `apps/mobile/nodejs-project/main.js` | Node.js backend entry point |
| `apps/mobile/nodejs-project/package.json` | Node.js project manifest |
| `apps/site/src/lib/client/node-bridge.ts` | UI ↔ Node.js bridge |
| `apps/site/src/components/AuthGate.svelte` | Calls initNodeBridge() |
| `apps/mobile/scripts/setup-nodejs-mobile.sh` | Post-sync setup script |
| `apps/mobile/android/app/libs/cdvnodejsmobile/` | Native libs for app module |
| `apps/mobile/android/capacitor-cordova-android-plugins/libs/cdvnodejsmobile/` | Native libs for plugins module |

## Phase 2: Shared API Handlers (Complete)

### Mobile Handlers Module (`packages/core/src/mobile-handlers/`)

Created a shared handlers module that works in both web server and mobile Node.js contexts.
Uses explicit file operations instead of AsyncLocalStorage context.

**Files:**
- `index.ts` - Module exports
- `types.ts` - Request/response types, helper functions
- `auth.ts` - Session validation, user context resolution
- `memories.ts` - Memory capture, list, search
- `conversation.ts` - Conversation buffer management
- `persona.ts` - Persona loading, cognitive mode
- `tasks.ts` - Task CRUD operations
- `router.ts` - Request routing to handlers

**Key Design:**
- `MobileRequest` / `MobileResponse` types for standardized API
- `resolveUserFromToken(sessionToken)` - Auth without cookies
- `handleMobileRequest(request)` - Main router entry point
- All handlers use `getProfilePaths(username)` with explicit paths
- No AsyncLocalStorage dependency

**Supported Routes:**
| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/auth/me` | User info |
| POST | `/api/capture` | Create memory |
| GET | `/api/memories` | List memories |
| GET | `/api/memories/search` | Search memories |
| GET/POST/DELETE | `/api/conversation-buffer` | Chat buffer |
| GET | `/api/persona` | Persona data |
| GET | `/api/persona/summary` | LLM context summary |
| GET | `/api/cognitive-mode` | Current mode |
| GET/POST/PUT/DELETE | `/api/tasks/*` | Task management |

**Usage in main.js:**
```javascript
const { handleMobileRequest } = require('@metahuman/core/mobile-handlers');

cordova.channel.on('request', async (msg) => {
  const response = await handleMobileRequest(msg);
  cordova.channel.post('response', response);
});
```

## Next Steps (Phase 3)

### 1. Bundle Core for Mobile
Create a mobile-compatible bundle of @metahuman/core:
- Compile TypeScript to JavaScript
- Bundle with esbuild/rollup for single file
- Include in nodejs-project/

### 2. Adapt Scheduler for Mobile
Replace `spawn('tsx', [...])` with direct function calls since agents will run in same Node.js process.

### 3. Local Profile Storage
Set up profile directory on device:
```
/data/data/com.metahuman.os/files/profiles/{username}/
├── persona/
├── memory/
└── etc/
```

### 5. LLM Bridge for Mobile
Route LLM calls to available backends:
1. Main server (when connected)
2. RunPod Serverless
3. Claude API
4. NativeLLM with GGUF (future)

## Known Issues

1. **cap sync removes native libs** - Must run `setup-nodejs-mobile.sh` after every `cap sync`
2. **GL errors in logs** - Harmless graphics-related errors from emulator
3. **APK size** - 58MB due to Node.js runtime (acceptable tradeoff)

## References

- [nodejs-mobile Official](https://nodejs-mobile.github.io/)
- [nodejs-mobile-cordova GitHub](https://github.com/nicklockwood/nodejs-mobile-cordova)
- Plan file: `/home/greggles/.claude/plans/nifty-rolling-seal.md`
- Local-first plan: `/home/greggles/metahuman/plans/local-first-mobile.md`
