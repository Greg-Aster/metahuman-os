# React Native Migration Plan

## Progress (Updated 2024-12-10)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Setup RN project | **COMPLETE** | Created at `apps/react-native/` with React Native 0.83.0 |
| Phase 2: WebView wrapper | **COMPLETE** | `App.tsx` with WebView, Node.js bridge, loading states |
| Phase 3: Adapt nodejs-project | **COMPLETE** | `main.js` using `rn-bridge`, build scripts created |
| Phase 4: Remove polyfills | **COMPLETE** | `uuid.ts` uses native randomUUID when available |
| Phase 5: Unify providers | **COMPLETE** | `bridge.ts` uses feature detection for Node.js 18+ |
| Phase 6: Build & test | **IN PROGRESS** | Web server verified working, Android build pending |
| Phase 7: Remove Capacitor | PENDING | After React Native app verified |

## Created Files

```
apps/react-native/
├── App.tsx                           # WebView wrapper with Node.js bridge
├── nodejs-assets/
│   └── nodejs-project/
│       ├── main.js                   # Node.js backend (uses rn-bridge)
│       └── package.json
├── scripts/
│   ├── build-handlers.mjs            # Builds @metahuman/core for Node.js 18
│   └── build-mobile.sh               # Full build script
└── android/                          # React Native Android project
```

## Modified Files

- **`packages/core/src/uuid.ts`** - Now uses native `crypto.randomUUID()` when available
- **`packages/core/src/providers/bridge.ts`** - Feature detection for unified code path

## Next Steps

1. Run `./apps/react-native/scripts/build-mobile.sh` to build APK
2. Test on device: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
3. Verify all handlers work (auth, chat, memories)
4. Archive Capacitor app once verified

---

## Overview

Migrate from Capacitor to React Native while keeping **the same unified codebase**. React Native is just a wrapper - all business logic stays in `@metahuman/core`.

## Why Migrate?

| Issue | Capacitor | React Native |
|-------|-----------|--------------|
| Node.js version | 12 (via nodejs-mobile-cordova) | **18** (via nodejs-mobile-react-native) |
| Plugin maintenance | Abandoned | Actively maintained |
| Native fetch | No (polyfills needed) | Yes (native) |
| AbortController | No (polyfills needed) | Yes (native) |
| crypto.randomUUID | No (polyfills needed) | Yes (native) |
| fs/promises | No (shims needed) | Yes (native) |
| Code paths | Separate web/mobile paths | **Truly unified** |

## Architecture: Before vs After

### Current (Capacitor)
```
┌─────────────────────────────────────┐
│  Capacitor Shell                    │
│  ┌───────────────────────────────┐  │
│  │  WebView (Svelte UI)          │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  nodejs-mobile-cordova        │  │
│  │  (Node.js 12)                 │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  mobile-providers.ts    │  │  │
│  │  │  (separate code path)   │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### After (React Native)
```
┌─────────────────────────────────────┐
│  React Native Shell (~100 lines)    │
│  ┌───────────────────────────────┐  │
│  │  react-native-webview         │  │
│  │  (loads Svelte UI unchanged)  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  nodejs-mobile-react-native   │  │
│  │  (Node.js 18)                 │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  @metahuman/core        │  │  │
│  │  │  (SAME as web server!)  │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────────┘
└─────────────────────────────────────┘
```

## What Changes

| Component | Change Required |
|-----------|-----------------|
| Svelte UI | **NONE** - loads in WebView |
| @metahuman/core handlers | **NONE** - same code |
| mobile-providers.ts | **DELETE** - no longer needed |
| Node.js polyfills/shims | **DELETE** - native in Node 18 |
| Native shell | **REWRITE** - Capacitor → RN |
| Bridge communication | **ADAPT** - similar pattern |

## Migration Steps

### Phase 1: Setup React Native Project (Day 1)

```bash
# Create new React Native project
npx react-native init MetaHumanMobile --template react-native-template-typescript

# Install required packages
cd MetaHumanMobile
npm install react-native-webview
npm install nodejs-mobile-react-native
npm install @react-native-async-storage/async-storage
```

**Directory structure:**
```
apps/
├── mobile/              # Current Capacitor (keep during migration)
├── react-native/        # New React Native app
│   ├── android/
│   ├── ios/
│   ├── src/
│   │   ├── App.tsx           # Main app with WebView
│   │   ├── NodeBridge.ts     # Communication with Node.js
│   │   └── hooks/
│   └── nodejs-project/       # Copy from current mobile
│       └── main.js           # Same handlers
└── site/                # Web app (unchanged)
```

### Phase 2: Create React Native Wrapper (Day 1-2)

**App.tsx** - Main component wrapping WebView:
```tsx
import React, { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import nodejs from 'nodejs-mobile-react-native';

export default function App() {
  const webviewRef = useRef<WebView>(null);

  useEffect(() => {
    // Start Node.js backend
    nodejs.start('main.js');

    // Listen for messages from Node.js
    nodejs.channel.addListener('message', (msg) => {
      // Forward to WebView
      webviewRef.current?.postMessage(JSON.stringify(msg));
    });

    return () => {
      nodejs.channel.removeAllListeners('message');
    };
  }, []);

  const handleMessage = (event: any) => {
    // Forward WebView messages to Node.js
    const data = JSON.parse(event.nativeEvent.data);
    nodejs.channel.send(data);
  };

  return (
    <WebView
      ref={webviewRef}
      source={{ uri: 'file:///android_asset/www/index.html' }}
      onMessage={handleMessage}
      javaScriptEnabled={true}
      domStorageEnabled={true}
    />
  );
}
```

### Phase 3: Adapt nodejs-project (Day 2)

**Changes to main.js:**
```javascript
// OLD (Capacitor): cordova-bridge
const cordova = require('cordova-bridge');

// NEW (React Native): nodejs-mobile-react-native channel
const rn_bridge = require('rn-bridge');

// Message handling stays the same pattern
rn_bridge.channel.on('message', async (msg) => {
  const { id, method, path, body, headers } = msg;

  // Same handler routing as before
  const result = await router.handleRequest(method, path, body, headers);

  rn_bridge.channel.send({ id, ...result });
});
```

### Phase 4: Remove Polyfills (Day 2)

With Node.js 18, delete these files:
- `apps/mobile/nodejs-project/shims/abort-controller.js`
- `apps/mobile/nodejs-project/shims/fs-promises.js`
- `packages/core/src/uuid.ts` (use native `crypto.randomUUID()`)

Update code that uses polyfills:
```typescript
// OLD
import { generateUUID } from './uuid.js';
const id = generateUUID();

// NEW (Node.js 18 native)
import { randomUUID } from 'crypto';
const id = randomUUID();
```

### Phase 5: Unify Provider Code (Day 3)

With Node.js 18 having native fetch, we can truly unify:

```typescript
// packages/core/src/providers/bridge.ts

// DELETE the mobile-specific branch entirely
// Both web and mobile now use the same callCloudProvider()
// which uses @metahuman/server with native fetch

if (isCloudProvider(providerName)) {
  // UNIFIED: Same code for web AND mobile
  return callCloudProvider(providerName, messages, options, config, onProgress);
}
```

**Delete these files:**
- `packages/core/src/mobile-providers.ts` - No longer needed

### Phase 6: Build & Test (Day 3-4)

```bash
# Build Svelte UI for mobile
cd apps/site
pnpm build:mobile  # Outputs to apps/react-native/android/app/src/main/assets/www/

# Build Android app
cd apps/react-native
npx react-native run-android

# Test on device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Phase 7: Remove Capacitor (Day 4)

Once React Native app works:
```bash
# Archive old Capacitor app
mv apps/mobile apps/mobile-capacitor-archive

# Or delete entirely
rm -rf apps/mobile
```

Update CLAUDE.md to reflect new mobile architecture.

## File Changes Summary

### Files to CREATE
| File | Purpose |
|------|---------|
| `apps/react-native/` | New React Native project |
| `apps/react-native/src/App.tsx` | WebView wrapper |
| `apps/react-native/src/NodeBridge.ts` | RN ↔ Node.js communication |
| `apps/react-native/nodejs-project/main.js` | Adapted from current |

### Files to DELETE
| File | Reason |
|------|--------|
| `apps/mobile/` | Replaced by react-native |
| `packages/core/src/mobile-providers.ts` | Node 18 has fetch |
| `apps/mobile/nodejs-project/shims/*` | Node 18 native APIs |
| `packages/core/src/uuid.ts` | Use crypto.randomUUID() |

### Files to MODIFY
| File | Change |
|------|--------|
| `packages/core/src/providers/bridge.ts` | Remove mobile branch |
| `apps/site/astro.config.mobile.mjs` | Update output path |
| `CLAUDE.md` | Update mobile docs |

## Risk Mitigation

1. **Keep Capacitor app during migration** - Don't delete until RN works
2. **Test incrementally** - WebView first, then Node.js, then handlers
3. **Same nodejs-project structure** - Minimize handler changes
4. **Feature parity checklist** before removing Capacitor

## Timeline Estimate

| Phase | Duration | Effort |
|-------|----------|--------|
| Setup RN project | 2-3 hours | Low |
| WebView wrapper | 2-3 hours | Low |
| Adapt nodejs-project | 3-4 hours | Medium |
| Remove polyfills | 1-2 hours | Low |
| Unify providers | 2-3 hours | Medium |
| Build & test | 4-6 hours | Medium |
| Documentation | 1-2 hours | Low |
| **Total** | **~2-3 days** | Medium |

## Success Criteria

- [ ] React Native app launches
- [ ] WebView loads Svelte UI
- [ ] Node.js 18 starts correctly
- [ ] WebView ↔ Node.js communication works
- [ ] Chat sends and receives messages
- [ ] All handlers work (auth, memories, persona, etc.)
- [ ] No polyfills or shims needed
- [ ] Single code path for cloud providers
- [ ] APK size similar or smaller than Capacitor

## Post-Migration Benefits

1. **True unified codebase** - Same `@metahuman/core` everywhere
2. **Modern Node.js** - Native fetch, AbortController, crypto, fs/promises
3. **Better maintenance** - nodejs-mobile-react-native is actively maintained
4. **Cleaner code** - No more mobile-specific branches
5. **Future-proof** - Can upgrade Node.js as new versions release
