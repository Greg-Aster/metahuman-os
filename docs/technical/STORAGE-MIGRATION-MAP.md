# Storage System Migration Map

This document maps the legacy path system to the new unified storage router.

## Overview

**Legacy System** (`packages/core/src/paths.ts`):
- `paths.*` proxy - direct property access
- `tryResolveProfilePath(key)` - safe resolution with error handling
- `requireProfilePath(key)` - throws on failure
- ~40+ hardcoded path keys

**New Storage Router** (`brain/services/storage-router.ts`):
- `storageClient.resolvePath({ category, subcategory, relativePath })`
- Category-based routing: `memory`, `voice`, `config`, `output`, `training`, `cache`
- Respects user storage configuration from Storage tab
- Single source of truth for all file I/O

## Path Key to Storage Router Mapping

### Memory Category

| Legacy Key | Storage Router Call |
|------------|---------------------|
| `episodic` | `{ category: 'memory', subcategory: 'episodic' }` |
| `semantic` | `{ category: 'memory', subcategory: 'semantic' }` |
| `procedural` | `{ category: 'memory', subcategory: 'procedural' }` |
| `proceduralOvernight` | `{ category: 'memory', subcategory: 'procedural', relativePath: 'overnight' }` |
| `preferences` | `{ category: 'memory', subcategory: 'preferences' }` |
| `tasks` | `{ category: 'memory', subcategory: 'tasks' }` |
| `inbox` | `{ category: 'memory', subcategory: 'inbox' }` |
| `inboxArchive` | `{ category: 'memory', subcategory: 'inbox', relativePath: '_archive' }` |
| `indexDir` | `{ category: 'memory', subcategory: 'index' }` |
| `audioInbox` | `{ category: 'memory', subcategory: 'audio', relativePath: 'inbox' }` |
| `audioTranscripts` | `{ category: 'memory', subcategory: 'audio', relativePath: 'transcripts' }` |
| `audioArchive` | `{ category: 'memory', subcategory: 'audio', relativePath: 'archive' }` |
| `curiosity` | `{ category: 'memory', subcategory: 'curiosity' }` |
| `curiosityFacts` | `{ category: 'memory', subcategory: 'curiosity', relativePath: 'facts' }` |
| `curiosityResearch` | `{ category: 'memory', subcategory: 'curiosity', relativePath: 'research' }` |
| `functions` | `{ category: 'memory', subcategory: 'functions' }` |
| `functionsVerified` | `{ category: 'memory', subcategory: 'functions', relativePath: 'verified' }` |
| `functionsDrafts` | `{ category: 'memory', subcategory: 'functions', relativePath: 'drafts' }` |

### Config Category

| Legacy Key | Storage Router Call |
|------------|---------------------|
| `persona` | `{ category: 'config', subcategory: 'persona' }` |
| `personaCore` | `{ category: 'config', subcategory: 'persona', relativePath: 'core.json' }` |
| `personaRelationships` | `{ category: 'config', subcategory: 'persona', relativePath: 'relationships.json' }` |
| `personaRoutines` | `{ category: 'config', subcategory: 'persona', relativePath: 'routines.json' }` |
| `personaDecisionRules` | `{ category: 'config', subcategory: 'persona', relativePath: 'decision-rules.json' }` |
| `personaFacets` | `{ category: 'config', subcategory: 'persona', relativePath: 'facets.json' }` |
| `personaFacetsDir` | `{ category: 'config', subcategory: 'persona', relativePath: 'facets' }` |
| `personaInterviews` | `{ category: 'config', subcategory: 'persona', relativePath: 'therapy' }` |
| `personaInterviewsIndex` | `{ category: 'config', subcategory: 'persona', relativePath: 'therapy/index.json' }` |
| `etc` | `{ category: 'config', subcategory: 'etc' }` |
| `curiosityConfig` | `{ category: 'config', subcategory: 'etc', relativePath: 'curiosity.json' }` |
| `voiceConfig` | `{ category: 'config', subcategory: 'etc', relativePath: 'voice.json' }` |

### Voice Category

| Legacy Key | Storage Router Call |
|------------|---------------------|
| `voiceTraining` | `{ category: 'voice', subcategory: 'training-data' }` |
| `voiceDataset` | `{ category: 'voice', subcategory: 'dataset' }` |
| `sovitsReference` | `{ category: 'voice', subcategory: 'sovits' }` |
| `sovitsModels` | `{ category: 'voice', subcategory: 'sovits-models' }` |
| `rvcReference` | `{ category: 'voice', subcategory: 'rvc' }` |
| `rvcModels` | `{ category: 'voice', subcategory: 'rvc-models' }` |

### Output Category

| Legacy Key | Storage Router Call |
|------------|---------------------|
| `out` | `{ category: 'output' }` |

### System Paths (No Migration Needed)

These paths are system-wide and don't need to go through the storage router:
- `logs` - System logs directory
- `decisions` - Decision logs
- `actions` - Action logs
- `sync` - Sync logs
- `state` - System state

Use `systemPaths.*` from `@metahuman/core` for these.

## Migration Status

### Migrated to Storage Router (15 files)

1. `packages/core/src/persona/session-manager.ts`
2. `apps/site/src/pages/api/sleep-status.ts`
3. `apps/site/src/pages/api/persona-icon.ts`
4. `apps/site/src/pages/api/kokoro-training.ts`
5. `apps/site/src/pages/api/persona/generator/start.ts`
6. `apps/site/src/pages/api/persona/generator/load.ts`
7. `apps/site/src/pages/api/persona/generator/discard.ts`
8. `apps/site/src/pages/api/persona/generator/answer.ts`
9. `apps/site/src/pages/api/persona/generator/update-answer.ts`
10. `apps/site/src/pages/api/persona/generator/purge-sessions.ts`
11. `apps/site/src/pages/api/persona/generator/add-notes.ts`
12. `apps/site/src/pages/api/persona/generator/reset-persona.ts`
13. `apps/site/src/pages/api/persona/generator/apply.ts`
14. `apps/site/src/pages/api/persona/generator/finalize.ts`
15. `apps/site/src/pages/api/onboarding/extract-persona.ts`

### Still Using Legacy `paths.*` (49 files, 163 usages)

Priority files to migrate:
- `packages/core/src/memory.ts` (17 usages)
- `packages/cli/src/commands/persona.ts` (9 usages)
- `packages/core/src/identity.ts` (7 usages)
- `brain/agents/psychoanalyzer.ts` (7 usages)
- `brain/agents/ingestor.ts` (5 usages)
- `brain/agents/ai-dataset-builder.ts` (5 usages)
- `packages/core/src/config.ts` (5 usages)

### Still Importing from `@metahuman/core/paths` (10 source files)

- `apps/site/src/lib/server/file_operations.ts`
- `apps/site/src/pages/api/file_operations.ts`
- `apps/site/src/pages/api/persona-archives.ts`
- `apps/site/src/pages/api/code-approvals/index.ts`
- `apps/site/src/pages/api/code-approvals/[...path].ts`
- `brain/agents/psychoanalyzer.ts`
- `apps/site/src/pages/api/boredom.ts`
- `brain/agents/_bootstrap.ts`
- `apps/site/src/pages/api/profiles/create.ts`
- `apps/site/src/pages/api/voice-models.ts`

## How to Migrate

### Before (Legacy)

```typescript
import { tryResolveProfilePath } from '@metahuman/core/paths';

const result = tryResolveProfilePath('personaCore');
if (!result.ok) {
  return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 });
}
const personaPath = result.path;
```

### After (Storage Router)

```typescript
import { storageClient } from '@metahuman/core';

const result = storageClient.resolvePath({
  category: 'config',
  subcategory: 'persona',
  relativePath: 'core.json',
});
if (!result.success || !result.path) {
  return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 });
}
const personaPath = result.path;
```

### Key Differences

| Legacy | Storage Router |
|--------|----------------|
| `result.ok` | `result.success` |
| Returns `{ ok, path }` or `{ ok: false, error }` | Returns `{ success, path, profileRoot, storageType, error? }` |
| Hardcoded path keys | Category-based routing |
| Can't respect storage config | Respects Storage tab settings |

## Benefits of Migration

1. **Single source of truth** - All file I/O goes through one router
2. **Storage tab integration** - External/network storage works automatically
3. **Better error messages** - Rich error context with storage type info
4. **Future-proof** - Easy to add encryption, caching, or other features
5. **Cleaner API** - Category-based is more intuitive than 40+ magic strings
