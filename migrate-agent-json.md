# Migration from agent.json to models.json

## Progress So Far

### ✅ Completed:
1. Added `globalSettings` to `models.json` schema with:
   - `includePersonaSummary` (boolean)
   - `useAdapter` (boolean)
   - `activeAdapter` (object with adapter metadata)

2. Updated core packages:
   - ✅ `packages/core/src/llm.ts` - Now reads from `models.json`
   - ✅ `packages/core/src/adapters.ts` - Uses `getModelRegistry()` and `writeModelRegistry()`
   - ✅ `packages/core/src/model-resolver.ts` - Extended `ModelRegistry` interface with `globalSettings`

3. Updated API endpoints:
   - ✅ `apps/site/src/pages/api/lora-toggle.ts` - Migrated to models.json

### 🔄 Remaining API Endpoints to Update:

The following files still reference `agent.json` and need to be updated:

1. **`apps/site/src/pages/api/status.ts`** (line 58)
   - Reads `includePersonaSummary` from agent.json
   - Change to: `registry.globalSettings?.includePersonaSummary`

2. **`apps/site/src/pages/api/persona_chat.ts`** (lines 578-585)
   - Reads default model from agent.json
   - Change to use `loadModelRegistry()` and get fallback model

3. **`apps/site/src/pages/api/agent-config.ts`** (line 8)
   - Full CRUD operations on agent.json
   - Change to operate on `models.json` globalSettings

4. **`apps/site/src/pages/api/models.ts`** (lines 10, 16)
   - Read/write agent config
   - Change to models.json

5. **`apps/site/src/pages/api/boot.ts`** (line 121)
   - Reads adapter info for boot message
   - Change to read from registry.globalSettings

6. **`apps/site/src/pages/api/adapters/index.ts`** (lines 257-266)
   - Returns adapter config
   - Change to read from registry.globalSettings

7. **`apps/site/src/pages/api/model-info.ts`** (line 15)
   - Reads base model
   - Change to use `loadModelRegistry()`

8. **`apps/site/src/pages/api/reset-factory.ts`** (line 11)
   - References AGENT_PATH for factory reset
   - May need to keep for backward compat or remove

## Migration Pattern

For most files, the pattern is:

**Before:**
```typescript
const agentConfigPath = path.join(paths.root, 'etc', 'agent.json');
const config = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
const value = config.someField;
```

**After:**
```typescript
import { loadModelRegistry } from '@metahuman/core';
const registry = loadModelRegistry();
const value = registry.globalSettings?.someField;
```

**For writes:**
```typescript
const modelsPath = path.join(paths.root, 'etc', 'models.json');
const registry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
if (!registry.globalSettings) {
  registry.globalSettings = { includePersonaSummary: true, useAdapter: false, activeAdapter: null };
}
registry.globalSettings.someField = newValue;
fs.writeFileSync(modelsPath, JSON.stringify(registry, null, 2));
```

## Testing Steps

After migration:
1. Start the dev server: `pnpm dev`
2. Test adapter toggling in UI
3. Test chat functionality
4. Test adapter activation
5. Check boot message shows correct model info
6. Verify status API returns correct data

## Deprecation Steps

After successful migration:
1. Add `etc/agent.json` to `.gitignore`
2. Optionally: Add migration script to auto-convert old agent.json to models.json on startup
3. Document the change in CHANGELOG.md

