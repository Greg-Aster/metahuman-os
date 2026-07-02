# Deprecated Architecture Cleanup Plan

This file describes an older cleanup pass and is retained for historical context only.

The active cleanup contract is now:

- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/AUDIT_PROTOCOL.md`
- `scripts/check-architecture.ts`

---

# MetaHuman OS Architecture Cleanup Plan

**Created**: 2025-11-26
**Branch**: `cleanup/architecture-refactor`
**Base Commit**: `b483c28` (functional production build)

## Executive Summary

This document outlines the comprehensive cleanup and architecture refactoring plan for MetaHuman OS. The system has evolved from a legacy operator-based architecture to a modern cognitive graph pipeline, leaving technical debt that needs addressing.

**Three parallel workstreams (all can proceed together):**
1. **Legacy Operator Cleanup** - Remove deprecated operator code replaced by cognitive graphs
2. **API Endpoint Consolidation** - Remove duplicates, unused endpoints, standardize naming
3. **Client/Server Code Separation** - Clean architecture in `apps/site/src/lib/`

---

## Phase 1: Immediate Actions (Safe, Low-Risk)

### 1.1 Remove Documentation-Only Files

These files are not executable code - they're patch templates:

```bash
# Files to delete or move to docs/patches/
apps/site/src/lib/chat_modifications.ts      # Just code snippets
apps/site/src/lib/file_operation_patch.ts    # Just patch template
```

### 1.2 Consolidate Duplicate File Operations (3 → 1)

Three files contain nearly identical logic:

| File | Lines | Status |
|------|-------|--------|
| `file_operations.ts` | ~200 | Keep, refactor |
| `enhanced_file_operations.ts` | ~250 | Merge into above |
| `file_operation_handler.ts` | ~180 | Merge into above |

**Action**: Consolidate into single `lib/server/file-operations.ts`

### 1.3 Remove Duplicate API Endpoint

```bash
# Remove duplicate index endpoint
rm apps/site/src/pages/api/index/index.ts  # Keep /api/index.ts instead
```

### 1.4 Remove Unused Warmup Duplicate

```bash
# /api/warmup appears unused, /api/warmup-model is active
rm apps/site/src/pages/api/warmup.ts
```

---

## Phase 2: lib/ Folder Restructure

### Current State (Mixed Code)

```
src/lib/
├── enhanced_chat_handler.ts     # SERVER - has @metahuman/core imports
├── chat_modifications.ts        # DOCS - not real code
├── file_operations.ts           # SERVER - Node.js fs/path
├── enhanced_file_operations.ts  # SERVER - duplicate
├── file_operation_handler.ts    # SERVER - duplicate
├── file_operation_patch.ts      # DOCS - not real code
├── enhanced_persona_chat_header.ts  # SERVER - API handler misplaced
├── websocket.ts                 # SERVER - Node.js crypto/http
├── logger.ts                    # SERVER - reads from filesystem
├── fetch-timeout.ts             # CLIENT - browser fetch utility
├── useTTS.ts                    # CLIENT - Svelte composable
├── useThinkingTrace.ts          # CLIENT - Svelte composable
├── useMessages.ts               # CLIENT - Svelte composable
├── useMicrophone.ts             # CLIENT - Web Audio API
├── audio-utils.ts               # CLIENT - Web Audio API
├── kokoro-training.ts           # CLIENT - API client
├── sovits-server.ts             # SERVER - child_process
├── rvc-server.ts                # SERVER - child_process
├── stores/
│   └── sleep-status.ts          # CLIENT - Svelte store
└── cognitive-nodes/
    ├── node-schemas.ts          # SHARED - pure types
    ├── node-registry.ts         # CLIENT - litegraph.js
    ├── template-loader.ts       # CLIENT - fetch-based
    └── execution-monitor.ts     # CLIENT - litegraph.js
```

### Target State

```
src/lib/
├── client/
│   ├── composables/
│   │   ├── useTTS.ts
│   │   ├── useMicrophone.ts
│   │   ├── useThinkingTrace.ts
│   │   └── useMessages.ts
│   ├── utils/
│   │   ├── audio-utils.ts
│   │   └── fetch-timeout.ts
│   ├── api-clients/
│   │   └── kokoro-training.ts
│   └── visual-editor/
│       ├── node-registry.ts
│       ├── template-loader.ts
│       └── execution-monitor.ts
├── server/
│   ├── file-operations.ts       # Consolidated from 3 files
│   ├── websocket.ts
│   ├── logger.ts
│   ├── sovits-server.ts
│   └── rvc-server.ts
├── shared/
│   └── node-schemas.ts          # Types used by both client & server
└── stores/
    └── sleep-status.ts
```

### Migration Steps

1. Create directory structure:
```bash
mkdir -p apps/site/src/lib/{client/{composables,utils,api-clients,visual-editor},server,shared}
```

2. Move files with import path updates
3. Update all imports across codebase
4. Test build succeeds

---

## Phase 3: Legacy Operator Cleanup

### Current Architecture

```
User Message
    ↓
/api/persona_chat (or /api/execute-graph)
    ↓
[Try Node Pipeline First - PRIORITY 1]
├─ Load cognitive graph (dual-mode.json, etc.)
├─ Execute via graph_executor + node executors
└─ If success → return
    ↓ If failed/disabled
[Fallback to Legacy Operator - PRIORITY 2]
├─ Call runOperatorWithFeatureFlag()
└─ Routes to V1, V2, or ReasoningEngine
    ↓ If operator unavailable
[Final Fallback - Chat Only]
└─ Direct LLM call
```

### Files to Refactor

| File | Size | Action |
|------|------|--------|
| `brain/agents/operator-react.ts` | 2,740 lines | Split into modules |
| `apps/site/src/pages/api/operator.ts` | 325 lines | Keep for skill diagnostics |
| `apps/site/src/pages/api/operator/react.ts` | 310 lines | Deprecate after graph stable |

### Refactoring Plan for operator-react.ts

Split 2,740 line monolith into:

```
brain/agents/
├── operator/
│   ├── index.ts           # Main router (200 lines)
│   ├── v1-loop.ts         # V1 ReAct (300 lines) - DEPRECATE LATER
│   ├── v2-loop.ts         # V2 ReAct (400 lines) - MOVE TO SERVICE
│   ├── reasoning-engine.ts # Modern service (200 lines)
│   └── types.ts           # Shared types (100 lines)
└── operator-react.ts      # Re-export for backward compat
```

### Timeline

1. **Now**: Keep all operator code functional as fallback
2. **Phase 2**: Move V2 logic to ReasoningEngine service
3. **Phase 3**: Remove V1 code path (after V2 battle-tested)
4. **Phase 4**: Archive operator APIs (after 6 months graph stability)

---

## Phase 4: API Endpoint Consolidation

### Endpoints to Remove (57 unused)

**Voice/Addon (unused integrations)**:
- `/api/kokoro-addon`, `/api/kokoro-server`, `/api/kokoro-voices`
- `/api/rvc-addon`, `/api/rvc-server`
- `/api/whisper-server`, `/api/sovits-server`
- `/api/voice-samples/[sampleId]`

**Persona Generator (unused workflow steps)**:
- `/api/persona/generator/load`
- `/api/persona/generator/add-notes`
- `/api/persona/generator/discard`
- `/api/persona/generator/update-answer`
- `/api/persona/generator/reset-persona`
- `/api/persona/generator/purge-sessions`

**Profile Management (inactive)**:
- `/api/profiles/delete`
- `/api/profiles/visibility`
- `/api/recovery-codes`

**Misc Unused**:
- `/api/warmup` (keep `/api/warmup-model`)
- `/api/memories` (keep `/api/memories_all`)
- `/api/code-approvals/*`
- `/api/functions/maintenance`, `/api/functions/stats`

### Naming Standardization

| Current | Proposed | Reason |
|---------|----------|--------|
| `/api/memories_all` | `/api/memory/list` | Consistent naming |
| `/api/memories/delete` | `/api/memory/delete` | Singular noun |
| `/api/memories/validate` | `/api/memory/validate` | Singular noun |
| `/api/conversation/summarize` | `/api/conversation/summary` (POST) | RESTful |
| `/api/conversation/summary` | `/api/conversation/summary` (GET) | Merge endpoints |

### Streaming Endpoints Consolidation

Current (5 separate streams):
- `/api/stream` - Audit stream
- `/api/logs/stream` - Log stream
- `/api/monitor/stream` - Agent monitor stream
- `/api/reflections/stream` - Reflection stream
- `/api/process-stream` - Process stream

Proposed:
- `/api/stream/audit`
- `/api/stream/logs`
- `/api/stream/monitor`
- `/api/stream/reflections`

---

## Phase 5: Node Executor Cleanup

### Double Implementation Issue

ReAct logic exists in TWO places:
1. `brain/agents/operator-react.ts` - Standalone (2,740 lines)
2. `packages/core/src/node-executors/operator-executors.ts` - As nodes (64KB)

### Resolution

1. Keep node executors as primary (cognitive graph system)
2. Refactor standalone operator to call node executors internally
3. Eventually remove duplicate implementation

---

## Implementation Checklist

### Phase 1 (Week 1)
- [ ] Delete `chat_modifications.ts` and `file_operation_patch.ts`
- [ ] Delete `/api/index/index.ts` duplicate
- [ ] Delete `/api/warmup.ts` (keep warmup-model)
- [ ] Consolidate 3 file operation files into 1

### Phase 2 (Week 2)
- [ ] Create lib/ directory structure
- [ ] Move client files to `lib/client/`
- [ ] Move server files to `lib/server/`
- [ ] Update all imports

### Phase 3 (Week 3-4)
- [ ] Split operator-react.ts into modules
- [ ] Add deprecation warnings to legacy paths
- [ ] Monitor graph pipeline success rate

### Phase 4 (Week 5-6)
- [ ] Remove unused voice addon endpoints
- [ ] Remove unused persona generator endpoints
- [ ] Standardize memory endpoint naming
- [ ] Consolidate streaming endpoints

### Phase 5 (Month 2+)
- [ ] Refactor operator to use node executors internally
- [ ] Remove V1 operator code path
- [ ] Archive legacy operator APIs

---

## Git Workflow

```bash
# Current state
git branch
# * cleanup/architecture-refactor

# Work in feature branches
git checkout -b cleanup/phase1-remove-duplicates
# ... make changes ...
git commit -m "phase1: remove documentation-only lib files"
git checkout cleanup/architecture-refactor
git merge cleanup/phase1-remove-duplicates

# When ready for main
git checkout master
git merge cleanup/architecture-refactor
git push origin master
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Delete unused endpoints | LOW | Search for all callers first |
| Restructure lib/ | MEDIUM | Update imports systematically |
| Split operator-react.ts | MEDIUM | Keep backward-compat exports |
| Remove V1 operator | HIGH | Wait for V2 to be battle-tested |
| Archive operator APIs | HIGH | 6-month graph stability first |

---

## Success Metrics

1. **Build time** - Should decrease with fewer files
2. **Bundle size** - Client bundle should shrink (no server code)
3. **API endpoint count** - From 166 to ~100 (40% reduction)
4. **Code duplication** - Zero duplicate implementations
5. **Fallback usage** - Track operator fallback rate → target <5%

---

## Notes

- All architecture options work together, not mutually exclusive
- Maintain backward compatibility during transition
- Monitor audit logs for fallback patterns
- Keep operator as safety net until graph proven stable
