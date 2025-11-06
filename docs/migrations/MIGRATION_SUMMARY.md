# agent.json → models.json Migration Summary

## ✅ COMPLETED

**Date**: 2025-11-05
**Status**: All files migrated successfully

## What Changed

### Before (agent.json):
```json
{
  "model": "qwen3-coder:30b",
  "baseModel": "Qwen/Qwen3-14B",
  "useAdapter": false,
  "adapterModel": "greg-dual-2025-10-21",
  "includePersonaSummary": true,
  "adapterMeta": { ... }
}
```

### After (models.json globalSettings):
```json
{
  "globalSettings": {
    "includePersonaSummary": true,
    "useAdapter": false,
    "activeAdapter": null
  },
  "defaults": {
    "fallback": "default.fallback",
    ...
  },
  "models": {
    "default.fallback": {
      "model": "qwen3-coder:30b",
      ...
    }
  }
}
```

## Files Updated

### Core Package (`packages/core/src/`)
1. **llm.ts** - Constructor now reads from models.json
2. **adapters.ts** - `getActiveAdapter()` and `setActiveAdapter()` use globalSettings
3. **model-resolver.ts** - Extended `ModelRegistry` interface with `globalSettings`

### API Endpoints (`apps/site/src/pages/api/`)
1. **status.ts** - Reads globalSettings for status info
2. **persona_chat.ts** - Gets fallback model from registry
3. **agent-config.ts** - CRUD operations on globalSettings
4. **models.ts** - Registry-based model management
5. **boot.ts** - Gets boot model from registry
6. **adapters/index.ts** - Config from globalSettings
7. **model-info.ts** - Base model from registry
8. **lora-toggle.ts** - Toggles useAdapter in globalSettings
9. **reset-factory.ts** - Removed agent.json reference

## Key Benefits

1. **Centralized Configuration** - All model settings in one place
2. **Role-Based Models** - Support for orchestrator, persona, curator, etc.
3. **Better Organization** - Global settings separate from model definitions
4. **Future-Proof** - Easier to add new model roles and providers

## Testing Checklist

- [ ] Start dev server: `pnpm dev`
- [ ] Test adapter toggling in UI
- [ ] Test chat functionality
- [ ] Test adapter activation
- [ ] Verify boot message shows correct model
- [ ] Check status API returns correct data
- [ ] Test model switching
- [ ] Verify audit logs still work

## Backward Compatibility

The system will continue to work with existing `etc/agent.json` files for a short period (legacy upgrade path in adapters.ts), but `agent.json` is now deprecated and should be removed after confirming the migration works.

## Next Steps

1. **Test thoroughly** - Run through the testing checklist above
2. **Remove agent.json** - Once confirmed working: `rm etc/agent.json`
3. **Update documentation** - Document the new globalSettings structure
4. **Optional**: Create migration script to auto-convert old agent.json files on startup

## Rollback Plan

If issues occur:
1. The old `agent.json` format is still supported via legacy upgrade code
2. Restore from git: `git checkout HEAD -- packages/ apps/`
3. File an issue with details of what broke

---

**Migration completed by**: Claude (Sonnet 4.5)
**No TypeScript errors introduced** - All compilation errors pre-existed
