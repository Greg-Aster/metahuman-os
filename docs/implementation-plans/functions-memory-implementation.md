# Functions Memory System - Detailed Implementation Plan (REVISED)

**Document Version:** 2.0
**Created:** 2025-11-14
**Revised:** 2025-11-14
**Status:** Ready for Implementation
**Estimated Timeline:** 7-8 weeks

---

## Architectural Review Findings

**Critical Gap Identified:** The original plan (v1.0) assumed the operator pipeline already consumed semantic context via `buildContextPackage()`. In reality:

- `runOperatorWithFeatureFlag` only passes `{ conversationHistory, sessionId, conversationId }` placeholders ([brain/agents/operator-react.ts:2344-2375](brain/agents/operator-react.ts#L2344-L2375))
- Neither inline V2 nor ReasoningEngine receive semantic memories, tool history, or any ContextPackage data
- Planner prompts only include scratchpad + tool catalog ([packages/core/src/reasoning/planner.ts:53-120](packages/core/src/reasoning/planner.ts#L53-L120))
- Storage infrastructure (paths, types, exports) for functions doesn't exist yet

**This wasn't a performance trade-off** - the operator predates the Layer-1 context pipeline, and the refactor was never completed. We must wire `buildContextPackage()` into the operator before functions can influence LLM behavior.

**This revision adds Phase 0** to close that gap and corrects all implementation details to match the actual codebase.

---

## Executive Summary

### Goals
Transform the MetaHuman OS operator from a hardcoded skill-routing system into a learning system that accumulates "how-to" knowledge through persistent functions memory. The system will:

1. **Resolve Ambiguity**: Automatically consult past successful execution patterns when users provide incomplete instructions
2. **Accelerate Execution**: Reduce LLM planning overhead by 30-50% through pattern reuse
3. **Enable Learning**: Capture successful operator runs as reusable function templates
4. **Improve Accuracy**: Leverage domain-specific execution patterns to reduce skill execution errors

### Success Criteria
- ✅ Operator receives full ContextPackage (semantic memories, tool history, persona)
- ✅ Functions stored as first-class memory type with vector indexing
- ✅ Both inline V2 AND ReasoningEngine consult functions during planning
- ✅ Learning pipeline captures successful runs with >2 skill invocations
- ✅ UI provides functions tab with CRUD operations
- ✅ Zero regression in existing chat, operator, or memory flows
- ✅ Smoke test: "make sandwich file" resolves to `out/` without user specifying path

### Scope
**In Scope:**
- **Phase 0 (PREREQUISITE):** Wire `buildContextPackage()` into operator pipeline for both inline V2 and ReasoningEngine
- Profile-specific function storage (`profiles/<user>/memory/functions/`)
- Vector-indexed function retrieval integrated with context builder
- Operator planner prompt modifications (both paths)
- Function learning from successful operator runs
- REST API for function CRUD operations
- Memory browser UI with functions tab

**Out of Scope:**
- Cross-profile function sharing (future enhancement)
- Function versioning/history (V1 stores only latest)
- Automated function optimization (manual editing only)
- Function marketplace/discovery (Phase 2 feature)

---

## Architecture Overview

### Current Operator Flow (Before Phase 0)

```
User Request → /api/operator
  ↓
  Assembles { conversationHistory, sessionId, conversationId }
  ↓
  runOperatorWithFeatureFlag(goal, context, ...)
  ↓
  ┌─────────────────────┬─────────────────────┐
  │ Inline V2           │ ReasoningEngine     │
  │ runReActLoopV2()    │ runWithReasoning()  │
  ├─────────────────────┼─────────────────────┤
  │ planNextStepV2()    │ planNextStepV2()    │
  │ (scratchpad only)   │ (scratchpad only)   │
  └─────────────────────┴─────────────────────┘
```

**Problem:** No semantic memories, tool history, or persona context reach the planner. Function guides would have zero effect.

### Target Operator Flow (After Phase 0)

```
User Request → /api/operator
  ↓
  buildContextPackage(userMessage, mode, options)  ← NEW
  ↓
  ContextPackage {
    memories: EpisodicEvent[]
    relevantFunctions: FunctionMemory[]          ← NEW (Phase 2)
    recentTools: ToolInvocation[]
    persona: PersonaSummary
    activeTasks: Task[]
  }
  ↓
  runOperatorWithFeatureFlag(goal, contextPackage, ...)
  ↓
  ┌─────────────────────┬─────────────────────┐
  │ Inline V2           │ ReasoningEngine     │
  │ runReActLoopV2()    │ runWithReasoning()  │
  ├─────────────────────┼─────────────────────┤
  │ planNextStepV2()    │ planNextStepV2()    │
  │ + formatContext()   │ + formatContext()   │  ← NEW
  └─────────────────────┴─────────────────────┘
```

### Data Model

#### FunctionMemory Schema (V1)
```typescript
// packages/core/src/types/function-memory.ts (NEW FILE)
export interface FunctionMemory {
  // Identity
  id: string                    // "func-20251114-abc123"
  title: string                 // "Create file in out/ directory"
  summary: string               // "How to create a file when user omits path"

  // Execution Pattern
  steps: string[]               // ["Default path to out/<filename>", "Use fs_write with overwrite=true"]
  skillsUsed: string[]          // ["fs_list", "fs_write"]

  // Learning Context
  examples: FunctionExample[]   // Sample invocations that match this pattern

  // Metadata
  createdAt: string             // ISO 8601 timestamp
  updatedAt: string             // ISO 8601 timestamp
  createdBy: string             // User ID who approved/created
  trust: 'verified' | 'draft'   // Promotion status
  tags: string[]                // ["filesystem", "fallback", "out-directory"]

  // Provenance
  sourceConversationId?: string // Original conversation that created this
  sourceOperatorRunId?: string  // Original operator run
  usageCount: number            // How many times referenced
  lastUsedAt?: string           // Last retrieval timestamp
}

export interface FunctionExample {
  prompt: string                // "Make sandwich file"
  resultPath?: string           // "out/sandwich.txt"
  skillSequence?: string[]      // ["fs_write"]
  executionTimeMs?: number      // Performance metric
}
```

#### ContextPackage Extension (Phase 2)
```typescript
// packages/core/src/context-builder.ts (MODIFY EXISTING)
export interface ContextPackage {
  // ... existing fields (memories, persona, tasks, tools, etc.) ...

  // Function patterns (NEW)
  relevantFunctions?: FunctionMemory[]
}
```

#### EpisodicEventMetadata Extension (Phase 3)
```typescript
// packages/core/src/memory.ts (MODIFY EXISTING)
export interface EpisodicEventMetadata {
  // ... existing fields ...

  // Function usage tracking (NEW)
  functionId?: string
  functionTitle?: string
  functionInputs?: Record<string, any>
  functionOutputs?: Record<string, any>
  functionSuccess?: boolean
  functionError?: string
  functionExecutionTimeMs?: number
}
```

### Storage Architecture

#### Directory Layout
```
profiles/<user>/memory/
├── episodic/
│   └── functions/              # NEW: Function invocation history
│       └── YYYY/
│           └── evt-{timestamp}-{slug}.json
├── functions/                  # NEW: Function definitions
│   ├── manifest.json           # Lightweight index for keyword search
│   └── YYYY/
│       └── function-{timestamp}-{slug}.json
├── index/
│   └── embeddings-*.json       # Extended to include functions (type: 'function')
└── tasks/
```

---

## Phase 0: Prerequisites - Operator Context Integration

**Timeline:** Week 1-2
**Dependencies:** None
**Risk:** High (core operator refactor)
**Criticality:** 🔴 **BLOCKER** - Must complete before any function work begins

### 0.1 Wire buildContextPackage Into API Endpoint

**File:** `apps/site/src/pages/api/operator.ts` (MODIFY)

**Current Code** ([lines 97-119](apps/site/src/pages/api/operator.ts#L97-L119)):
```typescript
const conversationHistory = taskContext
  ? [{ role: 'user', content: taskContext }]
  : [];

const operatorContext = {
  conversationHistory,
  allowMemoryWrites: effectiveMemoryWrites,
  sessionId: sessionId ?? policy.sessionId,
  conversationId
};

const userContext = {
  userId: policy.sessionId ?? policy.username,
  cognitiveMode: policy.mode
};

const result = await runOperatorWithFeatureFlag(
  goal,
  operatorContext,  // ← Currently just placeholder data
  undefined,
  userContext,
  reasoningDepth
);
```

**New Code:**
```typescript
// Import context builder (add to imports around line 10)
import { buildContextPackage } from '@metahuman/core';

// ... existing code ...

// NEW: Build semantic context before invoking operator (around line 97)
const contextPackage = await buildContextPackage(
  goal,  // Use goal as semantic query
  policy.mode,  // Cognitive mode
  {
    maxMemories: 10,
    conversationId,
    sessionId: sessionId ?? policy.sessionId,
    userId: policy.sessionId ?? policy.username
  }
);

// Add conversation history to context package (preserve existing behavior)
const enrichedContext = {
  ...contextPackage,
  conversationHistory: taskContext ? [{ role: 'user', content: taskContext }] : [],
  allowMemoryWrites: effectiveMemoryWrites,
  sessionId: sessionId ?? policy.sessionId,
  conversationId
};

const userContext = {
  userId: policy.sessionId ?? policy.username,
  cognitiveMode: policy.mode
};

const result = await runOperatorWithFeatureFlag(
  goal,
  enrichedContext,  // ← Now includes ContextPackage data
  undefined,
  userContext,
  reasoningDepth
);
```

**Testing:**
- [ ] Verify `/api/operator` calls `buildContextPackage()` before invoking operator
- [ ] Confirm context includes memories, persona, tasks (inspect via debugger)
- [ ] Test with both `operator.reactV2=true` and `operator.useReasoningService=true`

---

### 0.2 Update Inline V2 Planner to Accept Context

**File:** `brain/agents/operator-react.ts` (MODIFY)

**Current Signature** ([line 1323](brain/agents/operator-react.ts#L1323)):
```typescript
async function planNextStepV2(
  goal: string,
  state: ReactState,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse>
```

**New Signature:**
```typescript
async function planNextStepV2(
  goal: string,
  state: ReactState,
  contextPackage?: any,  // Add contextPackage parameter
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse>
```

**Modify Prompt** ([lines 1335-1363](brain/agents/operator-react.ts#L1335-L1363)):

```typescript
// Import context formatter (add to imports around line 10)
import { formatContextForPrompt } from '@metahuman/core';

// ... inside planNextStepV2 ...

// Build structured scratchpad prompt
const scratchpadText = formatScratchpadForLLM(state.scratchpad);
const toolCatalog = getCachedCatalog();

// NEW: Format context package if provided
const contextNarrative = contextPackage
  ? `\n## Relevant Context\n\n${formatContextForPrompt(contextPackage)}\n`
  : '';

const systemPrompt = `You are an autonomous agent using a ReAct (Reason-Act-Observe) pattern to help the user.

${toolCatalog}
${contextNarrative}

## Reasoning Process

For each step, provide your reasoning in this JSON format:
{
  "thought": "Your analysis of the current situation and what to do next",
  "action": { "tool": "skill_id", "args": {...} },  // Optional: omit if responding
  "respond": false,  // Set to true when ready to give final response
  "responseStyle": "default"  // Use "strict" for data-only responses, "default" for conversation
}

## Critical Rules

1. **ONLY use data from Observations** - Never invent, assume, or hallucinate information
2. **One action at a time** - Execute one tool, observe result, then plan next step
3. **Cite your sources** - Reference specific observation numbers when making claims
4. **Detect completion** - Set "respond": true when you have enough information to answer
5. **Handle errors gracefully** - If a tool fails, try alternatives or ask for clarification
${contextNarrative ? '6. **Leverage context** - Use relevant memories, function guides, and tool history when applicable\n' : ''}

## Current Scratchpad

${scratchpadText}

## User Goal

${goal}`;

// ... rest unchanged ...
```

**Update Call Sites** (search for `planNextStepV2` calls in same file):

```typescript
// Find all calls like this (around line 1850-2000):
const planning = await planNextStepV2(goal, state, userContext);

// Change to:
const planning = await planNextStepV2(goal, state, contextPackage, userContext);
```

**Update runReActLoopV2 Signature** ([line 1909](brain/agents/operator-react.ts#L1909)):

```typescript
// Current:
async function runReActLoopV2(
  goal: string,
  context?: any,
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<any>

// New: Rename 'context' to 'contextPackage' for clarity
async function runReActLoopV2(
  goal: string,
  contextPackage?: any,  // Renamed from 'context'
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<any> {
  // ... inside function, pass contextPackage to planNextStepV2 ...
}
```

**Testing:**
- [ ] Verify inline V2 planner receives context package
- [ ] Check planner prompts include "Relevant Context" section
- [ ] Test operator with semantic memory: add memory mentioning "out/", ask "make test file"
- [ ] Confirm no regressions when context is empty (`contextPackage = undefined`)

---

### 0.3 Update ReasoningEngine Planner to Accept Context

**File:** `packages/core/src/reasoning/planner.ts` (MODIFY)

**Current Signature** ([line 53](packages/core/src/reasoning/planner.ts#L53)):
```typescript
export async function planNextStepV2(
  goal: string,
  state: ReactState,
  config: Required<ReasoningEngineConfig>,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse>
```

**New Signature:**
```typescript
export async function planNextStepV2(
  goal: string,
  state: ReactState,
  config: Required<ReasoningEngineConfig>,
  contextPackage?: any,  // Add contextPackage parameter
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse>
```

**Modify Prompt** (similar to inline V2, around line 60):

```typescript
// Import context formatter (add to imports around line 10)
import { formatContextForPrompt } from '../context-builder';

// ... inside planNextStepV2 ...

// Build structured scratchpad prompt
const scratchpadText = formatScratchpadForLLM(state.scratchpad, config.scratchpadTrimSize);
const toolCatalog = getCachedCatalog();

// NEW: Format context package if provided
const contextNarrative = contextPackage
  ? `\n## Relevant Context\n\n${formatContextForPrompt(contextPackage)}\n`
  : '';

const systemPrompt = `You are an autonomous agent using a ReAct (Reason-Act-Observe) pattern to help the user.

${toolCatalog}
${contextNarrative}

## Reasoning Process
...
${contextNarrative ? '6. **Leverage context** - Use relevant memories, function guides, and tool history when applicable\n' : ''}

## Current Scratchpad

${scratchpadText}

## User Goal

${goal}`;

// ... rest unchanged ...
```

**Update Call Site in runWithReasoningEngine:**

**File:** `brain/agents/operator-react.ts` (MODIFY)

Find `runWithReasoningEngine` function (around line 2183) and update planner call:

```typescript
// Current (somewhere inside runWithReasoningEngine):
const planning = await planNextStepV2(goal, state, config, userContext);

// New:
const planning = await planNextStepV2(goal, state, config, contextPackage, userContext);
```

Also update `runWithReasoningEngine` signature to accept `contextPackage`:

```typescript
// Current (around line 2183):
async function runWithReasoningEngine(
  goal: string,
  context?: any,
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string },
  reasoningDepth?: number
): Promise<any>

// New:
async function runWithReasoningEngine(
  goal: string,
  contextPackage?: any,  // Renamed from 'context'
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string },
  reasoningDepth?: number
): Promise<any> {
  // ... pass contextPackage to engine ...
}
```

**Testing:**
- [ ] Enable `operator.useReasoningService = true` in `etc/runtime.json`
- [ ] Verify ReasoningEngine planner receives context package
- [ ] Check planner prompts include "Relevant Context" section
- [ ] Test same semantic memory scenario as inline V2
- [ ] Confirm feature flag switching between V2/ReasoningEngine works

---

### 0.4 Feature Flag for Context Integration

**File:** `etc/runtime.json` (MODIFY)

```json
{
  "operator": {
    "reactV2": true,
    "useReasoningService": false,  // Test both paths
    "useContextPackage": true      // NEW: Feature flag to enable/disable context integration
  }
}
```

**Implementation:**

**File:** `apps/site/src/pages/api/operator.ts` (MODIFY)

```typescript
// Import config check (add to imports)
import { loadRuntimeConfig } from '@metahuman/core';

// ... inside POST handler, before buildContextPackage ...

const runtimeConfig = loadRuntimeConfig();
const useContextPackage = runtimeConfig.operator?.useContextPackage ?? true;

let enrichedContext;

if (useContextPackage) {
  // NEW: Build semantic context
  const contextPackage = await buildContextPackage(
    goal,
    policy.mode,
    {
      maxMemories: 10,
      conversationId,
      sessionId: sessionId ?? policy.sessionId,
      userId: policy.sessionId ?? policy.username
    }
  );

  enrichedContext = {
    ...contextPackage,
    conversationHistory: taskContext ? [{ role: 'user', content: taskContext }] : [],
    allowMemoryWrites: effectiveMemoryWrites,
    sessionId: sessionId ?? policy.sessionId,
    conversationId
  };
} else {
  // LEGACY: Use minimal context (backward compatibility)
  enrichedContext = {
    conversationHistory: taskContext ? [{ role: 'user', content: taskContext }] : [],
    allowMemoryWrites: effectiveMemoryWrites,
    sessionId: sessionId ?? policy.sessionId,
    conversationId
  };
}

const result = await runOperatorWithFeatureFlag(
  goal,
  enrichedContext,
  undefined,
  userContext,
  reasoningDepth
);
```

**Testing:**
- [ ] Test with `useContextPackage: true` → operator receives context
- [ ] Test with `useContextPackage: false` → operator receives minimal context (legacy behavior)
- [ ] Verify no crashes when switching between modes
- [ ] Confirm audit logs show `context_package_built` events when enabled

---

### 0.5 Validation Checklist (Phase 0 Complete)

Before proceeding to Phase 1, verify:

- [ ] `/api/operator` calls `buildContextPackage()` when `useContextPackage: true`
- [ ] Inline V2 planner includes "Relevant Context" section in prompts
- [ ] ReasoningEngine planner includes "Relevant Context" section in prompts
- [ ] Feature flag (`useContextPackage`) toggles behavior without crashes
- [ ] Existing operator tests still pass (no regressions)
- [ ] Audit logs capture context building (`context_package_built` event)
- [ ] Manual test: Add episodic memory "Default files to out/" → operator uses it

**🔴 Do NOT proceed to Phase 1 until all checks pass.**

---

## Phase 1: Foundations

**Timeline:** Week 3
**Dependencies:** Phase 0 complete
**Risk:** Low

### 1.1 Extend Path Resolution

**File:** `packages/core/src/paths.ts` (MODIFY)

**Current PathKey** ([line 34](packages/core/src/paths.ts#L34)):
```typescript
export type PathKey =
  | 'root'
  | 'persona'
  | 'personaCore'
  | 'personaRelationships'
  | 'personaRoutines'
  | 'decisionRules'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'curated'
  | 'tasks'
  | 'indexDir'
  | 'inbox'
  | 'inboxArchive'
  | 'brain'
  | 'agents'
  | 'skills'
  | 'logs'
  | 'audit'
  | 'sync'
  | 'out'
```

**Add:**
```typescript
export type PathKey =
  | 'root'
  | 'persona'
  | 'personaCore'
  | 'personaRelationships'
  | 'personaRoutines'
  | 'decisionRules'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'curated'
  | 'functions'  // NEW
  | 'tasks'
  | 'indexDir'
  | 'inbox'
  | 'inboxArchive'
  | 'brain'
  | 'agents'
  | 'skills'
  | 'logs'
  | 'audit'
  | 'sync'
  | 'out'
```

**Add to resolvePath()** ([around line 150, inside switch statement](packages/core/src/paths.ts#L150)):

```typescript
case 'functions': {
  if (!user) {
    throw new Error('Functions path requires authentication');
  }
  return path.join(profileRoot, 'memory', 'functions');
}
```

**File:** `packages/core/src/memory.ts` (MODIFY)

**Add to resolveEventCategory()** ([around line 94](packages/core/src/memory.ts#L94)):

```typescript
export function resolveEventCategory(type: string): string {
  const typeMap: Record<string, string> = {
    conversation: 'episodic',
    observation: 'episodic',
    inner_dialogue: 'reflections',
    reflection: 'reflections',
    dream: 'dreams',
    'audio-dream': 'audio-dreams',
    audio: 'audio',
    tool_invocation: 'episodic',
    action: 'actions',
    curiosity_question: 'curiosity',
    function_usage: 'episodic/functions',  // NEW
  };

  return typeMap[type] || 'episodic';
}
```

**Testing:**
- [ ] `tryResolveProfilePath('functions')` returns correct path
- [ ] Path requires authentication (throws for anonymous users)
- [ ] `resolveEventCategory('function_usage')` returns `'episodic/functions'`

---

### 1.2 Create Type Definitions

**File:** `packages/core/src/types/function-memory.ts` (NEW)

```typescript
/**
 * FunctionMemory - Reusable execution pattern learned from operator runs
 *
 * Stored in: profiles/<user>/memory/functions/YYYY/function-{id}.json
 * Indexed in: memory/index/embeddings-*.json (type: 'function')
 */

export interface FunctionMemory {
  id: string
  title: string
  summary: string
  steps: string[]
  skillsUsed: string[]
  examples: FunctionExample[]
  createdAt: string
  updatedAt: string
  createdBy: string
  trust: FunctionTrustLevel
  tags: string[]
  sourceConversationId?: string
  sourceOperatorRunId?: string
  usageCount: number
  lastUsedAt?: string
}

export type FunctionTrustLevel = 'verified' | 'draft'

export interface FunctionExample {
  prompt: string
  resultPath?: string
  skillSequence?: string[]
  executionTimeMs?: number
}

export interface FunctionManifest {
  version: string
  generatedAt: string
  functions: FunctionManifestEntry[]
  stats: {
    total: number
    verified: number
    draft: number
  }
}

export interface FunctionManifestEntry {
  id: string
  title: string
  keywords: string[]
  skillsUsed: string[]
  trust: FunctionTrustLevel
  path: string
}

export interface FunctionQuery {
  query?: string
  skills?: string[]
  trust?: FunctionTrustLevel
  limit?: number
  userId?: string
}

export interface FunctionMatchResult {
  function: FunctionMemory
  score: number
  matchReason: 'semantic' | 'keyword' | 'skill'
}
```

**File:** `packages/core/src/memory.ts` (MODIFY)

**Extend EpisodicEventMetadata** ([around line 15](packages/core/src/memory.ts#L15)):

```typescript
export interface EpisodicEventMetadata {
  // ... existing fields (conversationId, sessionId, toolName, etc.) ...

  // Function usage tracking (NEW)
  functionId?: string
  functionTitle?: string
  functionInputs?: Record<string, any>
  functionOutputs?: Record<string, any>
  functionSuccess?: boolean
  functionError?: string
  functionExecutionTimeMs?: number
}
```

**File:** `packages/core/src/context-builder.ts` (MODIFY)

**Extend ContextPackage** ([around line 437](packages/core/src/context-builder.ts#L437)):

```typescript
export interface ContextPackage {
  // ... existing fields (memories, persona, tasks, tools, etc.) ...

  // Function patterns (NEW)
  relevantFunctions?: FunctionMemory[]
}
```

**Import type** (add to imports around line 10):

```typescript
import type { FunctionMemory } from './types/function-memory.js'
```

**Testing:**
- [ ] TypeScript compiles without errors
- [ ] FunctionMemory interface is importable from `@metahuman/core/types/function-memory`
- [ ] EpisodicEventMetadata includes function fields
- [ ] ContextPackage includes `relevantFunctions` field

---

### 1.3 CRUD Utilities

**File:** `packages/core/src/function-memory.ts` (NEW)

*(See original implementation plan for full code - 650 lines)*

Key functions to implement:
- `saveFunction(func: FunctionMemory): Promise<string>`
- `loadFunction(functionId: string): Promise<FunctionMemory | null>`
- `listFunctions(filters?: { trust?, skills?, limit? }): Promise<FunctionMemory[]>`
- `updateFunction(functionId: string, updates: Partial<FunctionMemory>): Promise<FunctionMemory | null>`
- `deleteFunction(functionId: string): Promise<boolean>`
- `promoteFunction(functionId: string): Promise<FunctionMemory | null>`
- `recordFunctionUsage(functionId: string): Promise<void>`
- `updateManifest(functionsDir: string): Promise<void>` (internal)

**Testing:**
- [ ] `saveFunction()` creates JSON file in `profiles/<user>/memory/functions/YYYY/`
- [ ] `loadFunction()` retrieves by ID
- [ ] `listFunctions({ trust: 'verified' })` filters correctly
- [ ] `updateFunction()` preserves ID, updates timestamp
- [ ] `deleteFunction()` removes file and updates manifest
- [ ] `manifest.json` generation works
- [ ] Audit logs capture all CRUD operations

---

### 1.4 Exports

**File:** `packages/core/src/index.ts` (MODIFY)

**Add exports** ([around line 55](packages/core/src/index.ts#L55)):

```typescript
// Function Memory (NEW)
export * from './types/function-memory.js'
export * from './function-memory.js'
```

**Testing:**
- [ ] `import { FunctionMemory, saveFunction } from '@metahuman/core'` works
- [ ] TypeScript auto-complete shows function memory helpers

---

## Phase 2: Retrieval & Context Integration

**Timeline:** Week 4
**Dependencies:** Phase 1 complete
**Risk:** Medium

### 2.1 Extend Vector Index

**File:** `packages/core/src/vector-index.ts` (MODIFY)

**Current VectorIndexItem** ([line 14](packages/core/src/vector-index.ts#L14)):
```typescript
export interface VectorIndexItem {
  id: string
  path: string
  type: 'episodic' | 'task'  // ← Limited types
  timestamp: string
  text: string
  vector: number[]
}
```

**New VectorIndexItem:**
```typescript
export interface VectorIndexItem {
  id: string
  path: string
  type: 'episodic' | 'task' | 'curated' | 'function'  // ← Add 'function'
  timestamp: string
  text: string
  vector: number[]
}
```

**Modify buildMemoryIndex()** ([around line 63](packages/core/src/vector-index.ts#L63)):

```typescript
// Add parameter
export async function buildMemoryIndex(options: {
  forceRebuild?: boolean
  includeFunctions?: boolean  // NEW: default true
} = {}): Promise<void> {
  const { forceRebuild = false, includeFunctions = true } = options

  // ... existing episodic/task indexing ...

  // NEW: Index functions (add after curated items)
  if (includeFunctions) {
    const functionsResult = tryResolveProfilePath('functions')
    if (functionsResult.ok && fs.existsSync(functionsResult.path)) {
      const { listFunctions } = await import('./function-memory.js')  // Dynamic import to avoid circular deps
      const functions = await listFunctions()

      for (const func of functions) {
        // Only index verified functions
        if (func.trust !== 'verified') continue

        const text = [
          func.title,
          func.summary,
          ...func.steps,
          `Skills: ${func.skillsUsed.join(', ')}`,
          `Tags: ${func.tags.join(', ')}`
        ].join('\n')

        const vector = await embedText(text)

        indexData.push({
          id: func.id,
          path: `functions/${new Date(func.createdAt).getFullYear()}/function-${func.id}.json`,
          type: 'function',
          timestamp: func.createdAt,
          text,
          vector
        })
      }

      console.log(`Indexed ${indexData.filter(i => i.type === 'function').length} functions`)
    }
  }

  // ... rest unchanged ...
}
```

**Add appendFunctionToIndex()** ([after appendEventToIndex around line 220](packages/core/src/vector-index.ts#L220)):

```typescript
/**
 * Append a function to the vector index (incremental update)
 * @param func Function to index
 */
export async function appendFunctionToIndex(func: FunctionMemory): Promise<void> {
  const result = tryResolveProfilePath('indexDir')
  if (!result.ok) return

  // Only index verified functions
  if (func.trust !== 'verified') return

  const indexPath = path.join(result.path, 'embeddings-nomic-embed-text.json')
  if (!fs.existsSync(indexPath)) {
    // No index yet, skip (will be picked up on next full rebuild)
    return
  }

  const indexFile: VectorIndexFile = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))

  const text = [
    func.title,
    func.summary,
    ...func.steps,
    `Skills: ${func.skillsUsed.join(', ')}`,
    `Tags: ${func.tags.join(', ')}`
  ].join('\n')

  const vector = await embedText(text)

  indexFile.data.push({
    id: func.id,
    path: `functions/${new Date(func.createdAt).getFullYear()}/function-${func.id}.json`,
    type: 'function',
    timestamp: func.createdAt,
    text,
    vector
  })

  indexFile.meta.items = indexFile.data.length

  fs.writeFileSync(indexPath, JSON.stringify(indexFile, null, 2), 'utf-8')
}
```

**Testing:**
- [ ] `./bin/mh index build` includes functions
- [ ] Vector index JSON contains items with `type: 'function'`
- [ ] `appendFunctionToIndex()` adds single function without full rebuild
- [ ] Only verified functions are indexed (drafts skipped)

---

### 2.2 Function Query System

**File:** `packages/core/src/function-query.ts` (NEW)

*(See original implementation plan for full code - 150 lines)*

Key functions:
- `queryFunctions(query: FunctionQuery): Promise<FunctionMatchResult[]>`
  - Semantic search via vector index (filter `type === 'function'`)
  - Keyword search via manifest.json (fallback)
  - Skill-based filtering (boost scores)
- `looksLikeFunctionInvocation(query: string): boolean`
  - Heuristic to detect function-appropriate queries ("make", "create", etc.)

**Testing:**
- [ ] `queryFunctions({ query: 'create file' })` returns matches
- [ ] Semantic search filters `type === 'function'` correctly
- [ ] Keyword search uses manifest.json
- [ ] Skill filtering boosts scores
- [ ] `looksLikeFunctionInvocation('make test file')` returns true

---

### 2.3 Context Builder Integration

**File:** `packages/core/src/context-builder.ts` (MODIFY)

**Add imports** ([around line 10](packages/core/src/context-builder.ts#L10)):

```typescript
import { queryFunctions, looksLikeFunctionInvocation } from './function-query.js'
import type { FunctionMemory } from './types/function-memory.js'
```

**Modify buildContextPackage()** ([around line 517](packages/core/src/context-builder.ts#L517)):

Find the parallel loading section and add function query:

```typescript
// Parallel loading (around line 729)
const [
  personaResult,
  personaCacheResult,
  shortTermStateResult,
  memoryResults,
  functionResults  // NEW
] = await Promise.all([
  loadPersonaSummary(),
  loadPersonaCache(),
  loadShortTermState(),
  queryIndex(userMessage, { limit: options.maxMemories || 10, threshold: 0.3 }),

  // NEW: Query functions if message looks like invocation
  looksLikeFunctionInvocation(userMessage)
    ? queryFunctions({ query: userMessage, trust: 'verified', limit: 3 })
    : Promise.resolve([])
])

// ... existing memory loading ...

// Build context package (around line 850)
const pkg: ContextPackage = {
  memories: filteredMemories,
  persona: personaSummary,
  currentFocus: shortTermState?.focus,
  activeTasks,
  recentTopics,
  patterns,
  recentTools,
  conversationSummary,
  relevantFunctions: functionResults.map(r => r.function)  // NEW
}

// Audit log (add to details)
audit({
  level: 'info',
  category: 'action',
  event: 'context_package_built',
  details: {
    // ... existing fields ...
    functionsCount: functionResults.length,  // NEW
    functionIds: functionResults.map(r => r.function.id)  // NEW
  },
  actor: options.userId || 'system'
})

return pkg
```

**Add formatFunctionsForPrompt()** ([after formatToolsForPrompt around line 980](packages/core/src/context-builder.ts#L980)):

```typescript
/**
 * Format function guides for LLM prompt
 * @param functions Function memories to include
 * @returns Formatted string
 */
export function formatFunctionsForPrompt(functions: FunctionMemory[]): string {
  if (!functions || functions.length === 0) return ''

  const sections = functions.map(func => {
    const examples = func.examples.slice(0, 2).map(ex =>
      `  - "${ex.prompt}" → ${ex.resultPath || 'completed'}`
    ).join('\n')

    return `
### ${func.title}
**Summary:** ${func.summary}
**Skills Used:** ${func.skillsUsed.join(', ')}
**Steps:**
${func.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
${examples ? `**Examples:**\n${examples}` : ''}
`.trim()
  })

  return `
## Function Guides

The following execution patterns have been successful in the past. Adapt these patterns to the current request:

${sections.join('\n\n')}

**Note:** These are guides, not rigid templates. Adapt the steps to fit the specific user request.
`.trim()
}
```

**Modify formatContextForPrompt()** ([around line 1019](packages/core/src/context-builder.ts#L1019)):

```typescript
export function formatContextForPrompt(pkg: ContextPackage): string {
  const sections: string[] = []

  // ... existing sections (persona, focus, tasks, topics, tools) ...

  // NEW: Add function guides section (insert before memories)
  if (pkg.relevantFunctions && pkg.relevantFunctions.length > 0) {
    sections.push(formatFunctionsForPrompt(pkg.relevantFunctions))
  }

  // ... existing memories section ...

  return sections.join('\n\n---\n\n')
}
```

**Testing:**
- [ ] `buildContextPackage('make file')` returns functions in `relevantFunctions`
- [ ] `formatFunctionsForPrompt()` generates correct markdown
- [ ] `formatContextForPrompt()` includes function guides section
- [ ] Functions only queried when `looksLikeFunctionInvocation()` returns true
- [ ] Audit logs show `functionsCount` and `functionIds`

---

### 2.4 Export New Helpers

**File:** `packages/core/src/index.ts` (MODIFY)

```typescript
// Function Query (NEW)
export * from './function-query.js'
export { formatFunctionsForPrompt } from './context-builder.js'
```

---

## Phase 3: Operator Integration

**Timeline:** Week 5
**Dependencies:** Phase 0, 1, 2 complete
**Risk:** Medium

### 3.1 Operator Prompt Already Updated (Phase 0)

✅ **Inline V2 and ReasoningEngine prompts already include context in Phase 0.** No additional changes needed here.

The prompts now include:
```markdown
## Relevant Context

[Function Guides, memories, tools, etc.]
```

### 3.2 Function Usage Tracking

**File:** `brain/agents/operator-react.ts` (MODIFY)

**Add import** ([around line 10](brain/agents/operator-react.ts#L10)):

```typescript
import { recordFunctionUsage } from '@metahuman/core'
```

**Find executeSkillWithErrorHandling()** (search for this function, around line 1850):

Add function tracking before capturing tool invocation:

```typescript
// NEW: Record function usage if function was referenced (add before captureEvent)
if (contextPackage?.relevantFunctions && contextPackage.relevantFunctions.length > 0) {
  // Find function that matches executed skill
  const matchingFunc = contextPackage.relevantFunctions.find(f =>
    f.skillsUsed.includes(step.action?.tool || '')
  )

  if (matchingFunc) {
    await recordFunctionUsage(matchingFunc.id)
  }
}

// Modify captureEvent() call to include function metadata
if (shouldCapture && canWrite) {
  const matchingFunc = contextPackage?.relevantFunctions?.find(f =>
    f.skillsUsed.includes(step.action?.tool || '')
  )

  await captureEvent(`Tool: ${step.action?.tool}`, {
    type: 'tool_invocation',
    metadata: {
      // ... existing metadata (conversationId, toolName, etc.) ...

      // NEW: Function tracking
      functionId: matchingFunc?.id,
      functionTitle: matchingFunc?.title,
      functionInputs: step.action?.args,
      functionOutputs: result.outputs,
      functionSuccess: result.success,
      functionError: result.error,
      functionExecutionTimeMs: Date.now() - execStart
    }
  })
}
```

**Testing:**
- [ ] Create verified function for "create file in out/"
- [ ] Run operator with "make test.txt"
- [ ] Verify `recordFunctionUsage()` increments `usageCount`
- [ ] Check episodic memory includes `functionId` metadata
- [ ] Audit logs show `function_used` event

---

### 3.3 Fallback Function Lookup (Error Recovery)

**File:** `brain/agents/operator-react.ts` (MODIFY)

**Find handleErrorWithRetry()** (search for this function, around line 1700):

Add function lookup suggestion after repeated path failures:

```typescript
// NEW: Check for repeated path validation failures
if (errorCode === 'INVALID_ARGS' && error.includes("Input 'path' failed validation")) {
  // Count path failures in scratchpad
  const pathFailures = scratchpad.filter(entry =>
    entry.observation?.includes("Input 'path' failed validation")
  ).length

  if (pathFailures >= 2 && !contextPackage?.relevantFunctions?.length) {
    // Suggest function lookup
    return {
      shouldRetry: true,
      suggestion: `This task has failed multiple times due to path validation. Consider:
1. Checking if there's a default directory pattern (e.g., out/, memory/)
2. Using fs_list to discover valid paths
3. Asking the user to specify the full path

If this is a common task, we may need to learn a function pattern for it.`
    }
  }
}
```

**Testing:**
- [ ] Trigger repeated path validation failures (no function available)
- [ ] Verify error handler suggests alternatives
- [ ] Confirm retry logic doesn't infinite loop

---

## Phase 4: Learning Pipeline

**Timeline:** Week 6
**Dependencies:** Phase 3 complete
**Risk:** Medium

### 4.1 Function Generator

**File:** `packages/core/src/function-generator.ts` (NEW)

*(See original implementation plan for full code - 460 lines)*

Key functions:
- `shouldLearnFunction(run: OperatorRun): boolean`
  - Must be successful
  - Must have ≥2 skills (exclude trivial 1-step tasks)
  - User must be authenticated
  - Trust level ≥ supervised_auto (check decision rules)

- `generateFunctionFromRun(run: OperatorRun): Promise<FunctionMemory>`
  - Extract skills used
  - Use LLM (curator role) to summarize pattern
  - Create FunctionMemory object with `trust: 'draft'`
  - Check for duplicates (70% title similarity + same skills)
  - Save to `profiles/<user>/memory/functions/`

- `summarizePattern(run: OperatorRun): Promise<{ title, description, steps }>`
  - LLM prompt analyzes scratchpad
  - Extracts generalized pattern
  - Returns JSON structure

**Testing:**
- [ ] `shouldLearnFunction()` returns true for multi-skill successful runs
- [ ] `generateFunctionFromRun()` creates draft function
- [ ] LLM summarizer extracts title, description, steps
- [ ] Duplicate detection prevents redundant functions
- [ ] Audit logs capture `function_learned` events

---

### 4.2 Post-Execution Hook

**File:** `brain/agents/operator-react.ts` (MODIFY)

**Add import** ([around line 10](brain/agents/operator-react.ts#L10)):

```typescript
import { shouldLearnFunction, generateFunctionFromRun } from '@metahuman/core'
```

**Find runReActLoopV2()** (around line 1909):

Add learning hook after successful completion:

```typescript
// After successful completion (around line 2130)
if (finalStep?.respond) {
  const result: OperatorResult = {
    success: true,
    result: finalObservation,
    reasoning: fullScratchpad,
    actions: executedActions,
    scratchpad: fullScratchpad
  }

  // NEW: Attempt to learn function from this run
  try {
    const run = {
      goal,
      context: contextPackage,  // Pass full context package
      scratchpad: fullScratchpad,
      success: true,
      conversationId,
      operatorRunId: `op-${Date.now()}`
    }

    if (shouldLearnFunction(run)) {
      const learnedFunc = await generateFunctionFromRun(run)

      // Attach to result for UI notification
      result.learnedFunction = learnedFunc

      audit({
        level: 'info',
        category: 'action',
        event: 'function_auto_learned',
        details: {
          functionId: learnedFunc.id,
          title: learnedFunc.title,
          goal
        },
        actor: getUserContext()?.username || 'system'
      })
    }
  } catch (err) {
    // Don't fail operator run if learning fails
    audit({
      level: 'warn',
      category: 'action',
      event: 'function_learning_failed',
      details: { error: String(err), goal },
      actor: 'system'
    })
  }

  return result
}
```

**Repeat for runWithReasoningEngine()** (around line 2183):

Add same learning hook in ReasoningEngine path.

**Testing:**
- [ ] Execute multi-skill operator run (e.g., fs_list → fs_write → task_create)
- [ ] Verify draft function is created in `profiles/<user>/memory/functions/YYYY/`
- [ ] Check `result.learnedFunction` is populated
- [ ] Confirm audit logs show `function_auto_learned` event
- [ ] Test with both inline V2 and ReasoningEngine

---

### 4.3 Export Function Generator

**File:** `packages/core/src/index.ts` (MODIFY)

```typescript
// Function Generator (NEW)
export * from './function-generator.js'
```

---

## Phase 5: API Layer

**Timeline:** Week 7
**Dependencies:** Phase 4 complete
**Risk:** Low

### 5.1 Function CRUD Endpoints

**File:** `apps/site/src/pages/api/functions.ts` (NEW)

```typescript
/**
 * GET /api/functions - List all functions for current user
 * Query params:
 *   - trust: 'verified' | 'draft'
 *   - skills: comma-separated skill IDs
 *   - limit: number
 */

import type { APIRoute } from 'astro'
import { listFunctions, getSecurityPolicy } from '@metahuman/core'

export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    const policy = await getSecurityPolicy(cookies)

    if (!policy.canReadMemory) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(request.url)
    const trust = url.searchParams.get('trust') as 'verified' | 'draft' | undefined
    const skillsParam = url.searchParams.get('skills')
    const limit = url.searchParams.get('limit')

    const filters: any = {}
    if (trust) filters.trust = trust
    if (skillsParam) filters.skills = skillsParam.split(',')
    if (limit) filters.limit = parseInt(limit)

    const functions = await listFunctions(filters)

    return new Response(
      JSON.stringify({ functions }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

**File:** `apps/site/src/pages/api/functions/[id].ts` (NEW)

*(See original implementation plan for GET/PUT/DELETE endpoints)*

**File:** `apps/site/src/pages/api/functions/promote.ts` (NEW)

*(See original implementation plan for POST endpoint)*

**Testing:**
- [ ] `GET /api/functions` returns user's functions
- [ ] `GET /api/functions?trust=verified` filters correctly
- [ ] `GET /api/functions/:id` returns function details
- [ ] `PUT /api/functions/:id` updates function
- [ ] `DELETE /api/functions/:id` removes function
- [ ] `POST /api/functions/promote` promotes draft → verified + adds to index
- [ ] Anonymous users get 401
- [ ] Emulation mode users can't write (403)

---

### 5.2 Extend Memories API

**File:** `apps/site/src/pages/api/memories_all.ts` (MODIFY)

**Current code** ([line 1-185](apps/site/src/pages/api/memories_all.ts#L1-L185)):

Only fetches episodic/reflections/dreams/curated/curiosity.

**Add function fetching:**

```typescript
// Add import (around line 10)
import { listFunctions } from '@metahuman/core'

// ... existing code ...

// Parallel fetch (around line 50)
const [
  episodicEvents,
  reflectionEvents,
  dreamEvents,
  curatedEvents,
  taskEvents,
  curiosityQuestions,
  functionMemories  // NEW
] = await Promise.all([
  // ... existing fetches ...
  listFunctions()  // NEW
])

// Return (around line 180)
return new Response(
  JSON.stringify({
    episodic: episodicItems,
    reflections: reflectionItems,
    dreams: dreamItems,
    curated: curatedItems,
    tasks: taskItems,
    curiosity: curiosityQuestions,
    functions: functionMemories  // NEW
  }),
  { status: 200, headers: { 'Content-Type': 'application/json' } }
)
```

**Testing:**
- [ ] `GET /api/memories_all` returns `functions` array
- [ ] Functions filtered by current user (multi-tenant)

---

## Phase 6: UI Components

**Timeline:** Week 8
**Dependencies:** Phase 5 complete
**Risk:** Medium

### 6.1 Extend Memory Tab Enum

**File:** `apps/site/src/components/CenterContent.svelte` (MODIFY)

**Current memoryTab** ([line 46](apps/site/src/components/CenterContent.svelte#L46)):
```typescript
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' = 'episodic'
```

**New memoryTab:**
```typescript
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' | 'functions' = 'episodic'  // Add 'functions'
```

**Add state variable** (around line 60):

```typescript
let functionMemories: FunctionMemory[] = []
```

**Modify loadEvents()** (around line 112):

```typescript
async function loadEvents() {
  try {
    loading = true

    // Fetch all memory types
    const [memoriesRes, functionsRes] = await Promise.all([
      fetch('/api/memories_all'),
      fetch('/api/functions')  // Already included in memories_all, but explicit for clarity
    ])

    if (memoriesRes.ok) {
      const data = await memoriesRes.json()

      // ... existing memory processing ...

      functionMemories = data.functions || []  // NEW
    }

    loading = false
  } catch (err) {
    console.error('Failed to load events:', err)
    loading = false
  }
}
```

**Add tab button** (around line 200):

```svelte
<button
  class:active={memoryTab === 'functions'}
  on:click={() => memoryTab = 'functions'}
>
  Functions ({functionMemories.length})
</button>
```

**Add tab content** (around line 250):

*(See original implementation plan for full Svelte component code - 200 lines)*

Key features:
- Function cards with title, summary, steps, skills, examples
- Trust badges (draft/verified)
- Promote button (drafts only)
- Edit button → opens FunctionEditor modal
- Delete button → removes function
- Empty state message

**Testing:**
- [ ] Functions tab appears in memory browser
- [ ] Tab displays all functions
- [ ] Draft badge shows for drafts
- [ ] Verified badge shows for verified functions
- [ ] Promote button only visible for drafts
- [ ] Edit/delete buttons work
- [ ] Empty state shows when no functions exist

---

### 6.2 Function Editor Modal

**File:** `apps/site/src/components/FunctionEditor.svelte` (NEW)

*(See original implementation plan for full Svelte component code - 240 lines)*

Key features:
- Full-screen modal (80vh × 800px)
- Edit title, summary, steps, tags
- Read-only: skills used, created date, usage count
- Keyboard shortcuts: Ctrl+S (save), Esc (close)
- Unsaved changes warning
- API integration: PUT `/api/functions/:id`

**Testing:**
- [ ] Edit button opens FunctionEditor modal
- [ ] Changes save via PUT endpoint
- [ ] Ctrl+S and Esc shortcuts work
- [ ] Unsaved changes warning appears
- [ ] Read-only fields can't be edited

---

## Testing Strategy

### Unit Tests

**File:** `packages/core/src/__tests__/function-memory.test.ts` (NEW)

*(See original implementation plan for vitest test suite)*

Tests cover:
- `saveFunction()`, `loadFunction()`, `listFunctions()`
- `updateFunction()`, `deleteFunction()`, `promoteFunction()`
- Manifest generation, keyword extraction

---

### Integration Tests

**File:** `tests/test-function-pipeline.mjs` (NEW)

*(See original implementation plan for end-to-end test script)*

Tests full pipeline:
1. Execute multi-skill operator task → function learned
2. Promote function to verified
3. Rebuild vector index
4. Execute similar task → function consulted
5. Verify audit logs show `function_used` event

---

### Smoke Tests Checklist

**Phase 0 (Context Integration):**
- [ ] Operator receives ContextPackage with memories
- [ ] Inline V2 and ReasoningEngine prompts include context
- [ ] Feature flag toggles context integration
- [ ] No regressions in existing operator tests

**Phase 1 (Foundations):**
- [ ] `tryResolveProfilePath('functions')` works
- [ ] CRUD utilities save/load/delete functions
- [ ] TypeScript compiles, exports work

**Phase 2 (Retrieval):**
- [ ] Vector index includes functions (`type: 'function'`)
- [ ] `queryFunctions()` returns semantic matches
- [ ] `buildContextPackage()` includes `relevantFunctions`
- [ ] `formatFunctionsForPrompt()` generates correct markdown

**Phase 3 (Operator):**
- [ ] Operator consults functions during planning
- [ ] Function usage tracked (`recordFunctionUsage()`)
- [ ] Tool invocation metadata includes `functionId`
- [ ] Error recovery suggests function patterns

**Phase 4 (Learning):**
- [ ] Multi-skill runs generate draft functions
- [ ] LLM summarizer extracts patterns
- [ ] Duplicate detection works
- [ ] Audit logs capture learning events

**Phase 5 (API):**
- [ ] All REST endpoints work (GET/PUT/DELETE/POST)
- [ ] Authentication enforced
- [ ] `/api/memories_all` includes functions

**Phase 6 (UI):**
- [ ] Functions tab displays in memory browser
- [ ] Promote/edit/delete actions work
- [ ] FunctionEditor modal functional
- [ ] Empty state shows correctly

**Regression Tests:**
- [ ] Chat still works without operator
- [ ] Operator works when no functions match
- [ ] Anonymous users can't access functions
- [ ] Emulation mode respects read-only policy

---

## Migration & Rollout

### Backward Compatibility

**All changes are additive:**
- Phase 0 uses feature flag (`operator.useContextPackage`)
- Functions system opt-in (only activates when functions exist)
- Vector index extension backward-compatible
- No breaking schema changes

### Migration Steps

1. **Deploy Code** (Phases 0-6)
2. **Enable Context Integration**:
   ```json
   // etc/runtime.json
   { "operator": { "useContextPackage": true } }
   ```
3. **Initialize Directories**:
   ```bash
   mkdir -p profiles/<user>/memory/functions
   echo '{"version":"1.0","generatedAt":"2025-11-14T00:00:00Z","functions":[],"stats":{"total":0,"verified":0,"draft":0}}' > profiles/<user>/memory/functions/manifest.json
   ```
4. **Rebuild Vector Index**:
   ```bash
   ./bin/mh index build
   ```
5. **Monitor Learning**:
   - Watch `logs/audit/` for `function_learned` events
   - Review draft functions via UI
   - Promote useful patterns to verified

### Rollback Plan

**If issues arise:**

1. **Disable Context Integration** (Phase 0):
   ```json
   { "operator": { "useContextPackage": false } }
   ```

2. **Disable Functions** (Phase 2+):
   ```json
   { "operator": { "useFunctions": false } }
   ```

3. **Remove from Vector Index**:
   ```bash
   ./bin/mh index build --exclude-functions
   ```

4. **Archive Function Files** (preserve data):
   ```bash
   mv profiles/<user>/memory/functions profiles/<user>/memory/functions.bak
   ```

---

## Open Questions & Risks

### Open Questions

1. **Function Versioning**: V1 stores only latest; add versioning if needed?
   - **Recommendation**: Start without versioning, add in v2 if requested

2. **Cross-Profile Sharing**: Should verified functions sync between users?
   - **Recommendation**: Start private, add sharing in Phase 2

3. **Conflicting Functions**: Multiple functions for same task?
   - **Recommendation**: Rank by `usageCount` + recency; show top 3

4. **LLM Model for Summarization**: Use curator role (same as memory enrichment)?
   - **Recommendation**: Yes, curator role at temperature 0.3

### Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phase 0 breaks existing operator | High | Feature flag rollback, comprehensive testing |
| Function hallucination (LLM invents steps) | Medium | Store provenance, manual editing via UI |
| Over-learning (too many similar functions) | Low | Deduplication logic (70% similarity threshold) |
| Operator over-relies on functions | Medium | Prompts emphasize "adapt, don't copy" |
| Vector index performance | Low | Functions typically < 100 per user |
| Learning from failed runs | High | Strict filter: `success=true` + ≥2 skills |

---

## Timeline Summary

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 0: Context Integration** | **Week 1-2** | **Wire buildContextPackage into operator (PREREQUISITE)** |
| Phase 1: Foundations | Week 3 | Schemas, storage, CRUD utilities |
| Phase 2: Retrieval & Context | Week 4 | Vector indexing, context builder integration |
| Phase 3: Operator Integration | Week 5 | Function usage tracking, error recovery |
| Phase 4: Learning Pipeline | Week 6 | Function generator, post-execution hook |
| Phase 5: API Layer | Week 7 | REST endpoints, extend memories API |
| Phase 6: UI Components | Week 8 | Functions tab, editor modal |
| **Total** | **7-8 weeks** | **Fully functional learning system** |

---

## Success Metrics

**Quantitative:**
- [ ] 30-50% reduction in operator planning iterations for repeated tasks
- [ ] >80% of multi-skill tasks generate draft functions
- [ ] >50% of draft functions promoted within 1 week
- [ ] Zero regressions in existing chat/operator/memory flows

**Qualitative:**
- [ ] User feedback: "The system learned my workflow"
- [ ] Operator resolves ambiguous commands (e.g., default paths)
- [ ] Functions UI intuitive and useful

---

## Next Steps

1. **Review Phase 0** with team (critical prerequisite)
2. **Implement Phase 0** (context integration)
3. **Validate Phase 0** before proceeding (all smoke tests pass)
4. **Proceed to Phase 1** (foundations)
5. **Create GitHub issues** for each phase

---

**Document prepared by:** Claude Code (MetaHuman OS Architect)
**Review Status:** Revised after architectural review
**Last Updated:** 2025-11-14
**Version:** 2.0 (Corrected)
