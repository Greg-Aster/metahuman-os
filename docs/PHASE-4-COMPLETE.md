# Phase 4 Migration Complete

**Date**: 2025-11-20
**Status**: ✅ Complete
**Files Migrated**: 29 endpoints across 5 batches

## Summary

Successfully migrated all remaining mixed read/write endpoints from implicit AsyncLocalStorage authentication (`withUserContext` wrapper) to explicit authentication pattern using `getAuthenticatedUser()` or `getUserOrAnonymous()`.

## Migration Batches

### Phase 4.1: Persona Generator Endpoints (10 files)
- `apps/site/src/pages/api/persona/generator/start.ts`
- `apps/site/src/pages/api/persona/generator/answer.ts`
- `apps/site/src/pages/api/persona/generator/apply.ts`
- `apps/site/src/pages/api/persona/generator/discard.ts`
- `apps/site/src/pages/api/persona/generator/load.ts`
- `apps/site/src/pages/api/persona/generator/finalize.ts`
- `apps/site/src/pages/api/persona/generator/add-notes.ts`
- `apps/site/src/pages/api/persona/generator/purge-sessions.ts`
- `apps/site/src/pages/api/persona/generator/reset-persona.ts`
- `apps/site/src/pages/api/persona/generator/update-answer.ts`

**Pattern Applied**:
```typescript
// Before:
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../middleware/userContext';

const handler: APIRoute = async () => {
  const ctx = getUserContext();
  if (!ctx || ctx.role === 'anonymous') { /* ... */ }
};

export const POST = withUserContext(handler);

// After:
import { getAuthenticatedUser } from '@metahuman/core';

const handler: APIRoute = async ({ cookies }) => {
  const user = getAuthenticatedUser(cookies);
};

export const POST = handler;
```

### Phase 4.2: Function Management Endpoints (5 files)
- `apps/site/src/pages/api/functions.ts`
- `apps/site/src/pages/api/functions/stats.ts`
- `apps/site/src/pages/api/functions/maintenance.ts`
- `apps/site/src/pages/api/functions/[id].ts`
- `apps/site/src/pages/api/functions/[id]/promote.ts`

**Special Handling**: Files with nested security guard wrappers
```typescript
// Before:
export const POST = withUserContext(requireWriteMode(postHandler));

// After:
export const POST = requireWriteMode(postHandler);
```

### Phase 4.3: Onboarding Endpoints (4 files)
- `apps/site/src/pages/api/onboarding/state.ts`
- `apps/site/src/pages/api/onboarding/complete.ts`
- `apps/site/src/pages/api/onboarding/skip.ts`
- `apps/site/src/pages/api/onboarding/extract-persona.ts`

**Batch Migration**: Used sed commands for efficient processing

### Phase 4.4: Configuration Endpoints (6 files)
- `apps/site/src/pages/api/cognitive-mode.ts`
- `apps/site/src/pages/api/chat-settings.ts`
- `apps/site/src/pages/api/conversation-buffer.ts`
- `apps/site/src/pages/api/curiosity-config.ts`
- `apps/site/src/pages/api/approvals.ts`
- `apps/site/src/pages/api/node-pipeline.ts`

**Special Cases**:
- `cognitive-mode.ts`: Nested `requireOwner` wrapper, context parameter passing
- `conversation-buffer.ts`: Inline exports refactored to named handlers
- `node-pipeline.ts`: Inline exports + getUserContext() replacement

### Phase 4.5: Remaining Mixed Endpoints (4 files)
- `apps/site/src/pages/api/tts.ts`
- `apps/site/src/pages/api/kokoro-training.ts`
- `apps/site/src/pages/api/code-approvals/index.ts`
- `apps/site/src/pages/api/operator/react.ts`

**Special Pattern**: Files with inline export patterns requiring manual refactoring

## Technical Challenges Solved

### 1. Nested Security Guard Wrappers
**Problem**: `withUserContext(requireOwner(handler))` patterns
**Solution**: Remove `withUserContext`, keep security guards: `requireOwner(handler)`

### 2. Inline Export Patterns
**Problem**: `export const GET: APIRoute = withUserContext(async ({ request }) => { /* ... */ })`
**Solution**: Refactor to named handlers:
```typescript
const getHandler: APIRoute = async ({ cookies, request }) => { /* ... */ };
export const GET = getHandler;
```

### 3. Context Parameter Passing
**Problem**: Functions expecting `context` object with user info
**Solution**: Pass explicit user object: `getSecurityPolicy({ user })` instead of `getSecurityPolicy(context)`

### 4. Actor Identification
**Problem**: Generic 'web_ui' actor in audit logs
**Solution**: Use actual username: `user.username || 'web_ui'`

## Migration Statistics

- **Total API files**: 141
- **Files needing migration**: ~50 (rest already used explicit pattern)
- **Files migrated in Phase 4**: 29
- **Total migrated (all phases)**: ~74
- **Migration rate**: 100% of identified files

## Verification

All export wrappers removed:
```bash
# No files use withUserContext in exports
grep -rn "export.*withUserContext" apps/site/src/pages/api/ | grep -v "import"
# Returns: 0 results ✅

# All security guards preserved
grep -rn "= requireWriteMode\|= requireOwner\|= requireOperatorMode" apps/site/src/pages/api/
# Returns: 16 files with guards ✅
```

## Remaining withUserContext Usage

**2 files still import withUserContext** (internal utility usage, not export wrappers):
- `apps/site/src/pages/api/conversation/summarize.ts` - Uses `withUserContext()` internally for context switching
- `apps/site/src/pages/api/persona_chat.ts` - Uses `withUserContext()` internally for LLM call context

These are utility usages, not export wrappers, and can be addressed separately if needed.

## Next Steps

Phase 5: Final cleanup and documentation (see [PHASE-5-PLAN.md](./PHASE-5-PLAN.md))
