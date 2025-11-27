# Production Build Debug Scratchpad

## The Problem
Production build causes "Component is not a constructor" error for Svelte components (AuthGate, ChatLayout, etc.)

## Root Cause Analysis

### Why does this happen?
Svelte compiles components in TWO different formats:
1. **DOM format**: Class-based components with constructor (for client-side rendering)
2. **SSR format**: Function-based with `create_ssr_component` (for server rendering)

When Astro tries to hydrate a component on the client, it expects DOM format. If the bundle contains SSR format, hydration fails with "Component is not a constructor".

### What controls which format is used?
The `build.ssr: true` option in Vite config forces ALL bundles to compile in SSR format, including client bundles that need DOM format.

## Attempts Made

### Attempt 1: Use `client:only="svelte"` directive
**Theory**: Skip SSR entirely, render only on client
**Result**: FAILED - Still got "Component is not a constructor"
**Why**: Even with `client:only`, the client bundle was compiled with `build.ssr: true`, so it's still SSR format

### Attempt 2: Remove `build.ssr: true`
**Theory**: Let Vite build client bundles in DOM format
**Result**: BUILD FAILS
**Error**: `"fileURLToPath" is not exported by "__vite-browser-external"`
**Why**: Without `build.ssr: true`, `@metahuman/core` (Node.js-only code) leaks into client bundles

### Attempt 3: Dynamic import of NodeEditorLayout in ChatLayout.svelte
**Theory**: Prevent @metahuman/core from being statically imported
**Result**: Partial - reduced some imports but core issue remains
**Why**: The import chain is complex; other files may still pull in @metahuman/core

### Attempt 4: Configure rollup external function
**Theory**: Externalize @metahuman/core only in client builds
**Status**: NOT YET TESTED

## Key Files

### Config Files
- `/home/greggles/metahuman/apps/site/astro.config.mjs` - Main build config
- `/home/greggles/metahuman/apps/site/svelte.config.js` - Svelte compiler options

### Entry Points
- `/home/greggles/metahuman/apps/site/src/pages/index.astro` - Main page with Svelte components

### Import Chain Causing Issues
```
index.astro
├── AuthGate.svelte (client:only="svelte")
├── ChatLayout.svelte (client:only="svelte")
│   └── NodeEditorLayout.svelte (NOW DYNAMIC IMPORT)
│       ├── NodeEditor.svelte
│       │   └── node-registry.ts → @metahuman/core/* (DYNAMIC)
│       └── NodePalette.svelte
│           └── node-registry.ts → @metahuman/core/* (DYNAMIC)
├── LeftSidebar.svelte
├── CenterContent.svelte
└── RightSidebar.svelte
```

### Files with Static @metahuman/core Imports (lib/)
- `file_operations.ts` - @metahuman/core/skills, @metahuman/core/paths
- `enhanced_file_operations.ts` - @metahuman/core/skills, @metahuman/core/paths
- `file_operation_handler.ts` - @metahuman/core/skills, @metahuman/core/paths
- `enhanced_persona_chat_header.ts` - MANY @metahuman/core imports

### Are these lib files imported by components?
- `chat_modifications.ts` imports `file_operation_handler.ts`
- `enhanced_chat_handler.ts` imports `file_operations.ts`
- BUT: No direct Svelte component imports of these files found

## Current Configuration State

### astro.config.mjs
```javascript
build: {
  // Currently has build.ssr: true which causes the problem
  ssr: true,
  rollupOptions: {}
}

ssr: {
  noExternal: ['@metahuman/core', /^@metahuman\//],  // Bundle for SSR
  external: [/^node:/, 'async_hooks'],  // Externalize Node.js built-ins
  target: 'node'
}
```

### index.astro
All Svelte components now use `client:only="svelte"`:
- AuthGate, ChatLayout, LeftSidebar, CenterContent, RightSidebar

## Possible Solutions

### Option A: Fix without refactoring
1. Remove `build.ssr: true`
2. Add rollup external function to externalize @metahuman/core in client builds
3. Ensure NodeEditorLayout dynamic import works correctly

### Option B: Proper architecture refactor
1. Create clean separation: `lib/client/` and `lib/server/`
2. Move all @metahuman/core imports to server-only files
3. Components call API endpoints instead of importing server code directly

### Option C: Use Astro's hybrid rendering
1. Keep `build.ssr: true` for server rendering
2. Use `client:only` components that don't need @metahuman/core at all
3. All @metahuman/core functionality accessed via API calls

## Attempt Results

### Attempt 4: Rollup external function
**Result**: FAILED - function didn't prevent bundling, same `fileURLToPath` error

### Attempt 5: Rollup external with regex pattern
**Result**: FAILED - externalized for ALL builds including SSR
**Error**: `Unknown file extension ".ts"` - SSR can't load un-transpiled TypeScript

## Key Insight
The conflict is fundamental:
- **SSR builds** need @metahuman/core BUNDLED (TypeScript needs transpilation)
- **Client builds** need @metahuman/core EXTERNALIZED (Node.js code can't run in browser)

Vite/Rollup's `build.rollupOptions.external` affects BOTH builds.
The `ssr.noExternal` setting should override for SSR, but it's not working.

## SMOKING GUN FOUND

**Evidence**: Client bundle `dist/client/_astro/AuthGate.*.js` contains:
```javascript
import { c as create_ssr_component } from './ssr.CjU8Op2g.js';
```

This PROVES that `build.ssr: true` forces Svelte to compile ALL bundles (including client) in SSR format.

## Root Cause Confirmed

`build.ssr: true` in Vite config:
- Intended: Prevent Node.js code from leaking into client
- Side effect: Forces ALL Svelte components into SSR compilation mode
- Result: Client bundles use `create_ssr_component` instead of class constructors
- Consequence: "Component is not a constructor" error during hydration

## The Dilemma

| Config | SSR Build | Client Build | @metahuman/core |
|--------|-----------|--------------|-----------------|
| `build.ssr: true` | ✅ Works | ❌ SSR format (broken) | ✅ Externalized |
| `build.ssr: false` | ✅ Works | ✅ DOM format | ❌ Leaks into client |

## Possible Solutions

### Solution 1: Vite Plugin to Separate Builds
Create a custom Vite plugin that:
- Detects client vs SSR builds
- Only externalizes @metahuman/core for client builds
- Allows normal bundling for SSR

### Solution 2: Remove @metahuman/core from Client Code Path
Trace and eliminate ALL import chains that pull @metahuman/core into client components.
Current status:
- NodeEditorLayout: ✅ Dynamic import added
- node-registry.ts: ✅ Uses dynamic imports
- BUT: Something else is still pulling it in

### Solution 3: Architecture Refactor
Create clean separation:
- `lib/client/` - Pure client code (no @metahuman/core)
- `lib/server/` - Server code (uses @metahuman/core)
- Components call API endpoints instead of importing server code

## SOLUTION FOUND ✅

### Custom Vite Plugin: `externalizeMetahumanCoreForClient`

Added to `astro.config.mjs`:
```javascript
function externalizeMetahumanCoreForClient() {
  return {
    name: 'externalize-metahuman-core-for-client',
    enforce: 'pre',
    resolveId(id, _importer, options) {
      // Only externalize for non-SSR (client) builds
      if (!options?.ssr && (id.startsWith('@metahuman/core') || id.startsWith('@metahuman/'))) {
        return { id, external: true };
      }
      return null;
    },
  };
}
```

### How It Works
- The `options.ssr` parameter tells us if this is an SSR build
- For SSR builds (`options.ssr === true`): Allow normal bundling (TypeScript gets transpiled)
- For client builds (`options.ssr === false`): Mark @metahuman/core as external

### Verification
- Before: Client bundle had `import { c as create_ssr_component } from './ssr.*.js'`
- After: Client bundle has `class xt extends ht{constructor(e){...}}`

### Result
- Build succeeds ✅
- SSR works (TypeScript bundled and transpiled) ✅
- Client bundles use DOM format (class constructors) ✅
- No Node.js code leaks into browser ✅

---

## Template-Watch API Fix (2025-11-26)

### Problem
The `/api/template-watch` SSE endpoint was repeatedly failing with ENOENT errors:
```
[TemplateWatch] Error setting up watcher: Error: ENOENT: no such file or directory, stat '/home/greggles/metahuman/apps/site/dist/server/lib/cognitive-nodes/templates'
```

This happened every ~15 seconds as clients reconnected, causing:
- Excessive error logging
- CPU overhead from retry loops
- Potential contribution to perceived slow performance

### Root Cause
The API used relative path resolution from `__dirname`:
```typescript
const TEMPLATES_DIR = path.resolve(__dirname, '../../lib/cognitive-nodes/templates');
```

In production, `__dirname` resolves to `dist/server/pages/api/`, so the path pointed to a non-existent directory in the dist folder instead of the actual templates.

### Solution
Changed to use `ROOT` from `@metahuman/core` which always resolves to the repo root:
```typescript
import { ROOT } from '@metahuman/core';
const TEMPLATES_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');
```

Also added a check to ensure the directory exists before attempting to watch:
```typescript
if (!fs.existsSync(TEMPLATES_DIR)) {
  console.warn(`[TemplateWatch] Templates directory not found: ${TEMPLATES_DIR}`);
  sendEvent('info', { message: 'Template watching disabled - directory not found' });
  return;
}
```

### Result
- No more ENOENT error loops ✅
- Clean server startup logs ✅
- Template watching works correctly when directory exists ✅
