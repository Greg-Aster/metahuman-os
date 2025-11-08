# Memory Continuity Plan: Cognitive Mode Integration Analysis

**Document Version:** 1.0
**Date:** 2025-11-06
**Status:** Technical Review
**Related:** `memory-continuity-detailed-plan.md`, `COGNITIVE_ARCHITECTURE.md`

---

## Executive Summary

**Key Finding:** The Memory Continuity Plan is **NOT universally compatible** with all cognitive modes. Significant adaptations are required to respect mode boundaries and maintain system integrity.

**Critical Conflicts Identified:**
1. ❌ **Emulation mode** is read-only by design - cannot capture new memories
2. ⚠️ **Agent mode** should filter memories (actions only), but currently saves everything
3. ⚠️ **Operator pipeline** doesn't capture tool invocations yet
4. ⚠️ **Conversation summaries** need mode-specific storage strategies

**Solution:** Implement **mode-aware memory capture** with differentiated behavior per cognitive mode.

---

## Table of Contents

1. [Cognitive Mode Architecture](#cognitive-mode-architecture)
2. [Mode-Aware Helper Surface](#mode-aware-helper-surface)
3. [Cognitive Layers System](#cognitive-layers-system)
4. [Memory Capture Analysis by Mode](#memory-capture-analysis-by-mode)
5. [Operator Pipeline Integration](#operator-pipeline-integration)
6. [Critical Conflicts](#critical-conflicts)
7. [Mode-Aware Implementation Strategy](#mode-aware-implementation-strategy)
8. [Revised Implementation Plan](#revised-implementation-plan)
9. [Testing Strategy](#testing-strategy)

---

## Cognitive Mode Architecture

### Three Operational Modes

MetaHuman OS operates in three distinct cognitive modes, each with different intelligence levels and memory behaviors:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cognitive Mode Spectrum                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Dual Consciousness          Agent              Emulation       │
│  ═══════════════════       ─────────           ···········       │
│  Full Intelligence         Lightweight         Stable Snapshot  │
│  Always Operator           Heuristic Router    Never Operator   │
│  Memory: FULL WRITE        Memory: SELECTIVE   Memory: READ ONLY│
│  Training: ACTIVE          Training: OFF       Training: OFF    │
│  Agents: ENABLED           Agents: OFF         Agents: OFF      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Mode Definitions (from `cognitive-mode.ts`)

#### 1. Dual Consciousness Mode (Default)

**Purpose:** Full-featured intelligence with autonomous agents and continuous learning

**Characteristics:**
```typescript
{
  mode: 'dual',
  memoryWriteLevel: 'full',              // Unrestricted memory writes
  operatorUsage: 'always',               // MANDATORY operator routing
  memoryGrounding: 'mandatory',          // MUST use semantic search
  proactiveAgents: true,                 // Background processes enabled
  trainingPipeline: 'dual_trigger',      // LoRA training enabled
  securityPosture: 'standard'            // Normal security checks
}
```

**Memory Metadata:**
```json
{
  "metadata": {
    "cognitiveMode": "dual",
    "usedOperator": true,
    "reasoning": [...],
    "toolInvocations": [...]
  }
}
```

**Use Cases:**
- Primary operational mode for authenticated owners
- Full reasoning transparency (operator pipeline visible)
- Continuous learning from all interactions
- Proactive reflection and organization

---

#### 2. Agent Mode

**Purpose:** Lightweight assistant for quick tasks without heavy cognitive overhead

**Characteristics:**
```typescript
{
  mode: 'agent',
  memoryWriteLevel: 'command_only',      // Only save meaningful actions
  operatorUsage: 'heuristic',            // Smart routing (chat vs action)
  memoryGrounding: 'optional',           // Lighter context retrieval
  proactiveAgents: false,                // No background processing
  trainingPipeline: null,                // Training disabled
  securityPosture: 'standard'
}
```

**Memory Metadata:**
```json
{
  "metadata": {
    "cognitiveMode": "agent",
    "usedOperator": true,  // Only when action detected
    "actionType": "file_read" | "search" | etc
  }
}
```

**Use Cases:**
- Quick assistant mode with reduced latency
- Command execution without full reasoning overhead
- Less context-heavy interactions
- Reduced proactive behavior (no unsolicited reflections)

**Important:** `command_only` is defined but **NOT currently enforced** - agent mode saves all interactions like dual mode. This needs fixing.

---

#### 3. Emulation Mode

**Purpose:** Stable personality snapshot for demos, testing, and guest access

**Characteristics:**
```typescript
{
  mode: 'emulation',
  memoryWriteLevel: 'read_only',         // NO memory writes allowed
  operatorUsage: 'never',                // Chat-only, no skills
  memoryGrounding: 'read_only',          // Can read existing memories
  proactiveAgents: false,                // No background agents
  trainingPipeline: null,                // Training disabled
  securityPosture: 'high'                // Enhanced restrictions
}
```

**Memory Metadata:**
```json
{
  // NO MEMORIES WRITTEN - read-only mode
}
```

**Use Cases:**
- Guest/anonymous user access (security constraint)
- Demonstration mode (stable responses)
- Testing personality without modifying state
- Frozen snapshot for comparison/benchmarking

**Critical Security Feature:**
```typescript
// From persona_chat.ts line 549-557
const sessionCookie = cookies?.get('mh_session');
const isAuthenticated = !!sessionCookie;

// FORCE emulation mode for unauthenticated users (security)
const cognitiveMode = isAuthenticated
  ? configuredMode
  : 'emulation';  // ← Unauthenticated = read-only always
```

---

### Mode Comparison Matrix

| Feature | Dual Mode | Agent Mode | Emulation Mode |
|---------|-----------|------------|----------------|
| **Authentication Required** | ✅ Yes | ✅ Yes | ❌ No (guest access) |
| **Memory Writes** | ✅ Full | ⚠️ Selective* | ❌ Read-only |
| **Operator Access** | ✅ Always | ⚠️ Heuristic | ❌ Never |
| **Semantic Search** | ✅ Mandatory | ⚠️ Optional | ✅ Read-only |
| **Context Depth** | 🔥 Deep (16 results) | ⚙️ Normal (8 results) | ⚡ Shallow (4 results) |
| **Proactive Agents** | ✅ Enabled | ❌ Disabled | ❌ Disabled |
| **Training Pipeline** | ✅ Active | ❌ Disabled | ❌ Disabled |
| **Tool Invocations** | ✅ All captured | ⚠️ Actions only | ❌ No tools allowed |
| **Conversation Summaries** | ✅ Episodic memory | ✅ Episodic memory | ⚠️ Ephemeral only |
| **Response Latency Target** | ~20s | ~10s | ~8s |
| **Use Case** | Primary intelligence | Quick assistant | Stable demo/guest |

*Currently not enforced - needs implementation

---

## Mode-Aware Helper Surface

Establish `packages/core/src/memory-policy.ts` as the single source of truth for cognitive-mode rules:

| Helper | Description | Mode Behavior |
|--------|-------------|---------------|
| `canWriteMemory(mode, eventType)` | Gate episodic writes per event type. | Dual: true; Agent: true only for action/safety events; Emulation: false. |
| `shouldCaptureTool(mode, toolName)` | Filter tool logs before capture. | Skips conversational tools in agent mode; always false in emulation. |
| `contextDepth(mode, role)` | Determines retrieval depth/tool history length. | Owner+dual = deepest; guest/emulation capped at 2 memories. |
| `conversationVisibility(role)` | Controls which summaries/files appear in UI. | Guests cannot see private summaries or file paths. |

### API Touchpoints Requiring Policy Hooks

| API / Module | Policy Hook(s) | Purpose |
|--------------|----------------|---------|
| `/api/persona_chat` | `canWriteMemory`, `contextDepth`, `conversationVisibility` | Governs chat capture, buffer persistence, prompt assembly, and summary injection. |
| `/api/operator/react` | `canWriteMemory`, `shouldCaptureTool` | Stops emulation tool writes and limits agent logging to action commands. |
| `/api/file_operations` | `canWriteMemory`, `conversationVisibility` | Enforces read-only guests and redacts file paths in guest responses. |
| `/api/approvals`, `/api/code-approvals` | `canWriteMemory`, `contextDepth` | Captures only approved event types and limits history pagination for guests. |
| `/api/voice-settings`, `voice-training.ts` | `canWriteMemory`, `conversationVisibility` | Keeps training data scoped to owners while allowing system-wide TTS voices. |
| `/api/profiles/list`, guest selector UI | `conversationVisibility` | Hides private profiles from unauthenticated visitors. |
| Brain agents (`organizer`, `conversation-summarizer`) | `canWriteMemory` | Forces agents to assume owner context or skip writes entirely. |

---

## Cognitive Layers System

### Three-Layer Architecture

MetaHuman OS processes information through three distinct cognitive layers:

```
┌────────────────────────────────────────────────────────────┐
│                   Input: User Message                       │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 1: Subconscious Processing (Context Builder)        │
│  ─────────────────────────────────────────────────────────  │
│  • Semantic search through episodic memories               │
│  • Pattern recognition (recurring entities/themes)         │
│  • Context package assembly with relevance scoring         │
│  • Caching (5-min TTL) for performance                     │
│  • Fallback to persona summary if index unavailable        │
│                                                             │
│  Output: ContextPackage {                                  │
│    memories: RelevantMemory[],                             │
│    persona: PersonaSummary,                                │
│    activeTasks: string[],                                  │
│    recentTopics: string[],                                 │
│    patterns: DetectedPattern[]                             │
│  }                                                          │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 2: Personality Core (Authentic Voice)               │
│  ─────────────────────────────────────────────────────────  │
│  • LoRA-trained model for authentic communication style    │
│  • Injects persona identity, values, goals                 │
│  • Voice consistency scoring (0-1)                         │
│  • Mode-specific model selection:                          │
│    - Dual: persona.with-lora (authentic)                   │
│    - Agent: default.persona (generic)                      │
│    - Emulation: persona.with-lora (read-only)              │
│                                                             │
│  Output: PersonalityOutput {                               │
│    response: string,                                       │
│    metadata: { voiceConsistency: 0.85 }                    │
│  }                                                          │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 3: Meta-Cognition (Oversight & Safety)             │
│  ─────────────────────────────────────────────────────────  │
│  • Safety validation (non-blocking by default)             │
│  • Response refinement (testing mode)                      │
│  • Audit trail creation                                    │
│  • Mode-specific behavior:                                 │
│    - Dual: Full validation pipeline                        │
│    - Agent: Critical decisions only                        │
│    - Emulation: Disabled (speed optimization)              │
│                                                             │
│  Output: SafeResponse {                                    │
│    finalResponse: string,                                  │
│    safetyIssues: [...],                                    │
│    refinementApplied: boolean                              │
│  }                                                          │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                    Output: Assistant Response               │
└────────────────────────────────────────────────────────────┘
```

### Layer 1: Subconscious Processing

**Implementation:** `packages/core/src/context-builder.ts`

**Purpose:** Background memory retrieval and context preparation (the "subconscious")

**Key Features:**
- Semantic search via vector index
- Pattern recognition from memory tags
- Hybrid search (semantic + metadata filters)
- 5-minute result caching
- Fallback to persona summary when index unavailable

**Mode-Specific Behavior:**

```typescript
// Dual Mode: Deep search
{
  searchDepth: 'deep',           // 16 results
  maxMemories: 5,                // Up to 5 memories in prompt
  maxContextChars: 1500,         // 1.5KB context limit
  forceSemanticSearch: true,     // Semantic index required
  similarityThreshold: 0.62      // Relevance cutoff
}

// Agent Mode: Balanced search
{
  searchDepth: 'normal',         // 8 results
  maxMemories: 3,
  maxContextChars: 900,
  forceSemanticSearch: false,    // Optional index
  similarityThreshold: 0.62
}

// Emulation Mode: Shallow search
{
  searchDepth: 'shallow',        // 4 results
  maxMemories: 2,
  maxContextChars: 600,
  forceSemanticSearch: false,    // Read-only access
  similarityThreshold: 0.65      // Stricter relevance
}
```

**Filters:**
- `filterInnerDialogue: true` - Exclude reflections/dreams from conversation mode
- `filterReflections: true` - Mode-specific reflection filtering
- `metadataFilters` - Hybrid search (e.g., `type: 'dream'`, `tags: ['coding']`)

**Output Structure:**
```typescript
interface ContextPackage {
  memories: RelevantMemory[];           // Semantic search results
  memoryCount: number;                  // Total found
  fallbackUsed: boolean;                // True if index unavailable
  persona: PersonaSummary;              // Identity snapshot
  currentFocus?: string;                // From orchestrator state
  activeTasks: string[];                // Open tasks
  recentTopics: string[];               // Conversation tracking
  patterns: DetectedPattern[];          // Recurring entities/themes
  mode: CognitiveModeId;                // Current mode
  retrievalTime: number;                // Performance metric
  timestamp: string;
  indexStatus: 'available' | 'missing' | 'error';
}
```

---

### Layer 2: Personality Core

**Implementation:** `packages/core/src/cognitive-layers/layers/personality-core-layer.ts`

**Purpose:** Authentic voice generation using LoRA-trained models

**Status:**
- **Feature Flag:** `USE_COGNITIVE_PIPELINE` (off by default in `persona_chat.ts` line 15)
- **Current Behavior:** Direct `callLLM()` to persona model (bypassing layer wrapper)
- **Future:** Full layer activation for voice consistency tracking

**Model Selection:**
```typescript
// Dual Mode: Authentic LoRA-trained voice
model: 'persona.with-lora'
adapter: 'out/adapters/greg-dual-2025-11-06/adapter.gguf'

// Agent Mode: Generic conversational model
model: 'default.persona'
adapter: null  // No LoRA (faster, less authentic)

// Emulation Mode: Frozen authentic voice
model: 'persona.with-lora'
adapter: 'out/adapters/greg-emulation-stable/adapter.gguf'  // Never retrained
```

**Voice Consistency Tracking:**
```typescript
interface PersonalityOutput {
  response: string;
  metadata: {
    modelUsed: string;
    loraAdapter?: string;
    tokensGenerated: number;
    voiceConsistency: number;  // 0-1 score comparing to persona core
  };
}
```

---

### Layer 3: Meta-Cognition

**Implementation:** `packages/core/src/cognitive-layers/layers/meta-cognition-layer.ts`

**Purpose:** Oversight, validation, safety filtering, response refinement

**Phased Rollout:**

**Phase 4.1a** (`USE_COGNITIVE_PIPELINE`): Layer wrapper - DISABLED
**Phase 4.2** (`ENABLE_SAFETY_CHECKS`): Non-blocking validation - ENABLED when pipeline enabled
**Phase 4.3** (`ENABLE_RESPONSE_REFINEMENT`): Auto-sanitization - ENABLED (testing mode)
**Phase 4.4** (`ENABLE_BLOCKING_MODE`): Enforcement - DISABLED (explicit opt-in)

**Mode-Specific Behavior:**
```typescript
// Dual Mode: Full validation
if (mode === 'dual' && ENABLE_SAFETY_CHECKS) {
  const issues = await validateSafety(response);
  if (issues.length > 0) {
    auditSafetyIssues(issues);  // Log but don't block

    if (ENABLE_RESPONSE_REFINEMENT) {
      const refined = await refineResponse(response, issues);

      if (ENABLE_BLOCKING_MODE) {
        return refined;  // Send refined to user
      } else {
        auditRefinement(response, refined);  // Log both versions
        return response;  // Still send original (testing)
      }
    }
  }
}

// Agent Mode: Critical decisions only
if (mode === 'agent' && isCriticalDecision(response)) {
  await validateSafety(response);
}

// Emulation Mode: Disabled for speed
// No Layer 3 processing
```

---

## Memory Capture Analysis by Mode

### Current Memory Writing Behavior

**Code Location:** `persona_chat.ts` lines 1256-1298

#### Dual Mode Memory Capture

```typescript
// Current implementation (line 1256-1278)
if (allowMemoryWrites && cognitiveMode === 'dual') {
  const eventType = mode === 'inner' ? 'inner_dialogue' : 'conversation';

  // Capture user message
  const userPath = captureEvent(`Me: "${message}"`, {
    type: eventType,
    tags: ['chat', mode],
    response: assistantResponse.trim(),
    metadata: {
      cognitiveMode: 'dual',  // ← Tagged for LoRA training
      usedOperator: didUseOperator,
      facet: activeFacet
    }
  });

  // Audit log for tracking
  audit({
    level: 'info',
    category: 'chat',
    event: 'chat_assistant',
    details: {
      cognitiveMode: 'dual',
      usedOperator: didUseOperator,
      memoryPath: userPath
    },
    actor: 'persona_chat'
  });
}
```

**What's Captured:**
- ✅ User messages
- ✅ Assistant responses
- ✅ Operator usage flag
- ✅ Active persona facet
- ❌ **Tool invocations** (NOT captured - this is a gap)
- ❌ **File operations** (NOT captured - gap)
- ❌ **Code approvals** (NOT captured - gap)

---

#### Agent Mode Memory Capture

```typescript
// Current implementation (same code path as dual)
if (allowMemoryWrites && cognitiveMode === 'agent') {
  captureEvent(`Me: "${message}"`, {
    type: 'conversation',
    tags: ['chat', 'agent'],
    metadata: {
      cognitiveMode: 'agent',  // ← Different tag
      usedOperator: didUseOperator
    }
  });
}
```

**Problem:** `memoryWriteLevel: 'command_only'` is defined but **NOT enforced**

**What SHOULD Happen:**
```typescript
// Proposed: Filter casual chat, only save actions
if (allowMemoryWrites && cognitiveMode === 'agent') {
  // Only capture if operator was used (action-oriented)
  if (didUseOperator) {
    captureEvent(`Action: "${message}"`, {
      type: 'action_result',  // ← New type
      tags: ['agent', 'action', toolName],
      metadata: {
        cognitiveMode: 'agent',
        toolInvocations: [...],  // ← From Memory Continuity Plan
        actionType: 'file_read' | 'search' | etc
      }
    });
  }
  // Skip casual greetings, acknowledgments, pure chat
}
```

---

#### Emulation Mode Memory Capture

```typescript
// Current implementation (line 1286-1298)
else if (cognitiveMode === 'emulation') {
  // NO MEMORY WRITES - read-only enforcement
  audit({
    level: 'info',
    category: 'chat',
    event: 'chat_assistant_readonly',
    details: {
      cognitiveMode: 'emulation',
      usedOperator: false,  // Operator disabled in emulation
      memoryWritesBlocked: true
    },
    actor: 'persona_chat'
  });

  // Stream response without save confirmation
  push('answer', {
    response: assistantResponse,
    facet: activeFacet,
    readonly: true
  });
}
```

**Security Feature:**
- ✅ No episodic memory writes
- ✅ No vector index updates
- ✅ No training data generation
- ✅ Read-only semantic search still works (can retrieve existing memories)
- ✅ Unauthenticated users forced into this mode

---

### Memory Metadata Schema

**Current Schema:**
```typescript
interface EpisodicEvent {
  id: string;                           // evt-20251106123456-uuid
  timestamp: string;                    // ISO 8601
  content: string;                      // User message or response
  type: 'conversation' | 'inner_dialogue' | 'observation' | etc;
  response?: string;                    // Assistant reply
  entities?: string[];                  // Extracted entities
  tags?: string[];                      // ['chat', 'dual']
  importance?: number;                  // 0-1 relevance
  links?: string[];                     // Related event IDs
  userId?: string;                      // Multi-user tracking
  metadata?: {
    cognitiveMode?: 'dual' | 'agent' | 'emulation';  // ← For training
    usedOperator?: boolean;
    facet?: string;
    // Memory Continuity additions:
    conversationId?: string;            // ← NEW: Session tracking
    parentEventId?: string;             // ← NEW: Event linking
    toolName?: string;                  // ← NEW: Tool tracking
    toolInputs?: Record<string, any>;   // ← NEW
    toolOutputs?: Record<string, any>;  // ← NEW
    [key: string]: any;
  };
}
```

**Training Data Filtering:**
```bash
# LoRA training can filter by cognitive mode
python train_unsloth.py \
  --filter-mode dual \          # Only use dual-mode memories
  --exclude-emulation \         # Never use emulation (if leaked)
  --min-importance 0.5          # Quality threshold
```

---

## Operator Pipeline Integration

### ReAct Loop Architecture

**Implementation:** `brain/agents/operator-react.ts`

**Purpose:** Unified reasoning layer for action requests (tools, skills, complex queries)

### Mode-Specific Routing

```typescript
// From persona_chat.ts line 574-581
const useOperator = isAuthenticated && cognitiveMode !== 'emulation';

// Routing logic:
if (cognitiveMode === 'dual') {
  // ALWAYS use operator (mandatory reasoning)
  await executeOperator(message, context);
}
else if (cognitiveMode === 'agent') {
  // Heuristic routing: detect if message is action-oriented
  const isAction = detectAction(message);  // Pattern matching
  if (isAction) {
    await executeOperator(message, context);
  } else {
    // Fast path: direct chat (skip operator overhead)
    await directChat(message, context);
  }
}
else if (cognitiveMode === 'emulation') {
  // NEVER use operator (read-only, no skills)
  await directChat(message, context);
}
```

### Tool Invocation Flow

**Current Implementation (Dual Mode):**
```
User: "List files in docs/"
  │
  ▼
Layer 1: buildContextPackage()
  → Semantic search: no relevant memories
  → Context: { memories: [], persona: {...}, ... }
  │
  ▼
Operator: executeOperator()
  → Thought: "I need to list directory contents"
  → Action: fs_list
  → ActionInput: { path: "docs/" }
  │
  ▼
Skill Execution: executeSkill('fs_list', { path: "docs/" })
  → Result: { success: true, outputs: { files: ["doc1.md", "doc2.md"] } }
  │
  ▼
Operator: synthesizeResponse()
  → Observation: "Found 2 files: doc1.md, doc2.md"
  → Final Answer: "I found 2 files in the docs/ directory..."
  │
  ▼
Layer 2: Personality narration
  → "I've checked the docs directory and found 2 markdown files..."
  │
  ▼
Memory Capture (persona_chat.ts line 1261):
  ✅ User message: "Me: List files in docs/"
  ✅ Assistant response: "I've checked the docs directory..."
  ✅ Metadata: { cognitiveMode: 'dual', usedOperator: true }
  ❌ Tool invocation: NOT CAPTURED (gap)
```

**What's Missing:**
- ❌ Which skill was executed (`fs_list`)
- ❌ Skill input parameters (`{ path: "docs/" }`)
- ❌ Raw skill outputs (`{ files: ["doc1.md", "doc2.md"] }`)
- ❌ Execution time (performance tracking)
- ❌ Success/failure status

**Impact:**
- Cannot query "what files did I read yesterday?"
- Cannot query "which tools failed recently?"
- Cannot reconstruct exact action sequence
- Training data lacks tool invocation context

---

### Fast-Path Optimization

**Code:** `operator-react.ts` line 159

```typescript
// Detect pure conversational requests (no action needed)
const conversationalPatterns = [
  /^(hi|hello|hey|good morning)/i,
  /^(thanks|thank you|great)/i,
  /^(how are you|what's up)/i,
  /^(tell me about|explain|what is)/i
];

const isConversational = conversationalPatterns.some(p => p.test(message));

if (isConversational) {
  // Skip ReAct loop, call conversational_response skill directly
  return await executeSkill('conversational_response', {
    message,
    context: contextPackage
  });
  // Saves 2 LLM calls + 200-400ms latency
}
```

**Benefit:** Dual mode stays responsive for simple queries while maintaining operator pipeline for actions.

---

## Critical Conflicts

### Conflict 1: Emulation Mode Isolation

**Issue:** Memory Continuity Plan proposes universal memory capture, but emulation mode is **explicitly read-only by design**.

**Current Behavior:**
```typescript
// Emulation mode NEVER writes memories
if (cognitiveMode === 'emulation') {
  allowMemoryWrites = false;  // Hard block
}
```

**Why This Matters:**
- **Security:** Unauthenticated users are forced into emulation mode
- **Stability:** Emulation mode is a frozen snapshot for demos/testing
- **Training Isolation:** Emulation responses should never contaminate training data

**Proposed Solution:**

**Option A: Maintain Read-Only (Recommended)**
- ✅ Keep emulation mode strictly read-only for security
- ✅ No episodic memory writes
- ✅ No vector index updates
- ✅ No training data generation
- ⚠️ **Conversation summaries stored separately** (not in episodic memory):
  ```
  memory/conversations/
    └── session-{id}.json  ← Ephemeral, not indexed
  ```

**Option B: Ephemeral Capture (Alternative)**
- ⚠️ Allow emulation mode to write to temporary storage
- ⚠️ Memories marked `ephemeral: true` and NOT indexed
- ⚠️ Auto-deleted after session ends (not persisted)
- ❌ **Rejected:** Too complex, violates security principle

**Recommendation:** **Option A** - Maintain strict read-only enforcement.

---

### Conflict 2: Agent Mode Memory Filtering

**Issue:** Agent mode defines `memoryWriteLevel: 'command_only'` but this is **NOT currently enforced**.

**Current Reality:**
```typescript
// Agent mode saves EVERYTHING (same as dual mode)
if (allowMemoryWrites) {
  captureEvent(message, {
    type: 'conversation',
    tags: ['chat', 'agent'],
    metadata: { cognitiveMode: 'agent' }
  });
}
// ❌ No filtering based on memoryWriteLevel
```

**What SHOULD Happen:**
```typescript
// Only save action-oriented interactions
if (allowMemoryWrites && cognitiveMode === 'agent') {
  if (usedOperator) {
    // Operator was used = action performed
    captureEvent(message, {
      type: 'action_result',
      tags: ['agent', 'action'],
      metadata: {
        cognitiveMode: 'agent',
        actionType: determineActionType(toolInvocations)
      }
    });
  } else {
    // Pure chat - skip memory capture
    audit({
      event: 'chat_skipped',
      details: { reason: 'agent_mode_command_only', mode: 'agent' }
    });
  }
}
```

**Impact:**
- **Training Data Quality:** Agent mode memories would be action-focused (better for command training)
- **Memory Bloat:** Prevents cluttering episodic memory with casual chat
- **Mode Differentiation:** Clear separation between dual (everything) and agent (actions only)

**Implementation:** Create `shouldCaptureMemory()` filter function.

---

### Conflict 3: Tool Invocation Capture

**Issue:** Operator executes tools but doesn't capture invocations as memories.

**Current Gap:**
```typescript
// operator-react.ts line ~220
const result = await executeSkill(skillId, inputs);

if (result.success) {
  observation = formatObservation(result);
  // ❌ No captureEvent() call here
}
```

**Memory Continuity Requirement:**
```typescript
// Proposed: Capture after skill execution
if (result.success && allowMemoryWrites) {
  captureEvent(`Tool: ${skillId}`, {
    type: 'tool_invocation',
    tags: ['operator', 'tool', skillId],
    metadata: {
      cognitiveMode: task.mode,
      conversationId: task.sessionId,
      parentEventId: userMessageEventId,  // Link to trigger
      toolName: skillId,
      toolInputs: inputs,
      toolOutputs: result.outputs,
      success: result.success,
      executionTimeMs: result.metadata?.executionTime
    }
  });
}
```

**Mode-Specific Behavior:**
- **Dual Mode:** Capture ALL tool invocations
- **Agent Mode:** Capture only meaningful actions (skip `conversational_response`)
- **Emulation Mode:** No tools allowed (operator disabled)

---

### Conflict 4: Conversation Summaries

**Issue:** Where should conversation summaries be stored in each mode?

**Memory Continuity Proposal:** Auto-summarize long conversations

**Mode-Specific Strategy:**

**Dual Mode:**
```typescript
// Save summaries as episodic memories
captureEvent(summary, {
  type: 'conversation_summary',
  tags: ['summary', 'conversation'],
  metadata: {
    cognitiveMode: 'dual',
    conversationId: sessionId,
    messageCount: 25,
    summarizedRange: { start: 0, end: 15 }
  }
});
// ✅ Indexed for semantic search
// ✅ Used in training data
// ✅ Permanent storage
```

**Agent Mode:**
```typescript
// Save summaries as episodic memories (action-focused)
captureEvent(summary, {
  type: 'conversation_summary',
  tags: ['summary', 'actions'],
  metadata: {
    cognitiveMode: 'agent',
    conversationId: sessionId,
    actionCount: 5  // Summarize tool invocations
  }
});
// ✅ Indexed
// ✅ Training data (command sequences)
```

**Emulation Mode:**
```typescript
// Save summaries SEPARATELY (not episodic memory)
const summaryPath = path.join(
  'memory/conversations',
  `session-${sessionId}.json`
);
fs.writeFileSync(summaryPath, JSON.stringify({
  summary,
  mode: 'emulation',
  messageCount: 25,
  ephemeral: true  // Auto-delete after session
}));
// ❌ NOT indexed
// ❌ NOT in training data
// ⚠️ Ephemeral storage
```

---

### Conflict 5: Context Retrieval Depth

**Issue:** Memory Continuity Plan recommends deeper context, but modes have different performance targets.

**Current Settings:** `context-builder.ts`
```typescript
// Universal defaults (no mode awareness)
searchDepth: options.searchDepth || 'normal',  // 8 results
maxMemories: 2,                                 // Only 2 in prompt
maxContextChars: 900
```

**Mode-Specific Needs:**

| Mode | Latency Target | Search Depth | Max Memories | Max Chars |
|------|---------------|--------------|--------------|-----------|
| **Dual** | ~20s (can afford deep) | 16 results | 5 memories | 1500 chars |
| **Agent** | ~10s (balanced) | 8 results | 3 memories | 900 chars |
| **Emulation** | ~8s (fast) | 4 results | 2 memories | 600 chars |

---

### Guest & Emulation Read-Only Enforcement

1. **Request Layer (Astro middleware):** When `ctx.user` is missing or flagged as guest, force `mode = 'emulation'` and reject any POST/PUT/DELETE request that targets `/api/persona_chat`, `/api/operator/*`, `/api/file_operations`, `/api/voice-settings`, or `/api/approvals`. Return `401/403` with `X-Mode: emulation` header so the UI can surface the constraint.
2. **API Layer:** Inside each handler, call `canWriteMemory(mode, eventType)` before mutating disk. This guarantees that even privileged endpoints (called via scripts) cannot bypass read-only enforcement.
3. **Filesystem Layer:** Route all profile-aware path reads through `paths.get(profilePathKey)`. The proxy now throws when no user context exists; ensure agents call `withUserContext(owner)` during startup so background jobs receive the same guarantees.
4. **Audit Trail:** Log every blocked write attempt (category `security`, event `memory_write_blocked`) to `logs/audit/` so regressions become visible during QA.
5. **UI Feedback:** If the client receives a 401/403 with `X-Mode: emulation`, surface “Guest browsing is read-only” banner and disable write affordances (editor save buttons, approval toggles, etc.).

These steps keep guest browsing safe even if new APIs appear, because the default middleware + `canWriteMemory` combo locks writes by default.

---

**Proposed Solution:**
```typescript
function getModeDefaults(mode: CognitiveModeId): ContextBuilderOptions {
  switch (mode) {
    case 'dual':
      return {
        searchDepth: 'deep',
        maxMemories: 5,
        maxContextChars: 1500,
        forceSemanticSearch: true
      };
    case 'agent':
      return {
        searchDepth: 'normal',
        maxMemories: 3,
        maxContextChars: 900,
        forceSemanticSearch: false
      };
    case 'emulation':
      return {
        searchDepth: 'shallow',
        maxMemories: 2,
        maxContextChars: 600,
        forceSemanticSearch: false
      };
  }
}
```

---

## Mode-Aware Implementation Strategy

### Universal Principles

1. **Respect Mode Boundaries:** Memory Continuity improvements MUST honor cognitive mode constraints
2. **Emulation Isolation:** Keep emulation mode strictly read-only (security)
3. **Performance Targets:** Maintain mode-specific latency goals
4. **Training Differentiation:** Use `metadata.cognitiveMode` to filter training data
5. **Authentication Gate:** Unauthenticated users stay in emulation mode

### Implementation Checklist

#### ✅ Phase 1: Mode-Aware Memory Capture

**Task 1.1: Create Memory Filter Function**

File: `packages/core/src/memory-filter.ts` (NEW)
```typescript
export function shouldCaptureMemory(
  message: string,
  mode: CognitiveModeId,
  usedOperator: boolean
): boolean {
  // Emulation: NEVER capture
  if (mode === 'emulation') return false;

  // Dual: ALWAYS capture
  if (mode === 'dual') return true;

  // Agent: ONLY capture if operator was used (action-oriented)
  if (mode === 'agent') {
    return usedOperator;
  }

  return true; // Default: allow
}
```

**Task 1.2: Enforce Agent Mode Filtering**

File: `apps/site/src/pages/api/persona_chat.ts`
```typescript
import { shouldCaptureMemory } from '@metahuman/core/memory-filter';

// Replace current allowMemoryWrites check
if (allowMemoryWrites && shouldCaptureMemory(message, cognitiveMode, usedOperator)) {
  captureEvent(message, {
    type: cognitiveMode === 'agent' ? 'action_result' : 'conversation',
    tags: ['chat', cognitiveMode],
    metadata: { cognitiveMode, usedOperator }
  });
}
```

**Task 1.3: Add Tool Invocation Capture to Operator**

File: `brain/agents/operator-react.ts`
```typescript
import { getUserContext } from '@metahuman/core/context';
import { captureEvent } from '@metahuman/core/memory';

// After skill execution (line ~220)
if (result.success) {
  const ctx = getUserContext();
  const allowMemoryWrites = ctx && ctx.role !== 'anonymous';
  const mode = task.context?.mode || 'dual';

  // Mode-aware tool capture
  if (allowMemoryWrites && mode !== 'emulation') {
    // Skip conversational_response tool (not a real action)
    if (skillId !== 'conversational_response') {
      captureEvent(`Tool: ${skillId}`, {
        type: 'tool_invocation',
        tags: ['operator', 'tool', skillId],
        metadata: {
          cognitiveMode: mode,
          conversationId: task.sessionId,
          parentEventId: task.userMessageEventId,
          toolName: skillId,
          toolInputs: inputs,
          toolOutputs: result.outputs,
          success: result.success,
          executionTimeMs: Date.now() - startTime
        }
      });
    }
  }
}
```

#### ✅ Phase 2: Mode-Aware Context Retrieval

**Task 2.1: Mode-Specific Search Depth**

File: `packages/core/src/context-builder.ts`
```typescript
// Add mode defaults function
function getModeDefaults(mode: CognitiveModeId): Partial<ContextBuilderOptions> {
  switch (mode) {
    case 'dual':
      return { searchDepth: 'deep', maxMemories: 5, maxContextChars: 1500 };
    case 'agent':
      return { searchDepth: 'normal', maxMemories: 3, maxContextChars: 900 };
    case 'emulation':
      return { searchDepth: 'shallow', maxMemories: 2, maxContextChars: 600 };
  }
}

// Update buildContextPackage
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions = {}
): Promise<ContextPackage> {
  // Merge mode defaults with explicit options
  const modeDefaults = getModeDefaults(mode);
  const finalOptions = { ...modeDefaults, ...options };

  // ... rest of function ...
}
```

**Task 2.2: Add Tool Invocation Memory Retrieval**

File: `packages/core/src/context-builder.ts`
```typescript
// Query recent tool invocations for dual mode
async function queryRecentToolInvocations(
  conversationId: string,
  mode: CognitiveModeId,
  limit: number = 10
): Promise<ToolInvocation[]> {
  // Only query for dual mode (comprehensive context)
  if (mode !== 'dual') return [];

  const results = await searchMemory({
    filters: {
      type: 'tool_invocation',
      'metadata.conversationId': conversationId
    },
    limit,
    sortBy: 'timestamp',
    sortOrder: 'desc'
  });

  return results.map(r => ({
    id: r.id,
    toolName: r.metadata.toolName,
    timestamp: r.timestamp,
    inputs: r.metadata.toolInputs,
    outputs: r.metadata.toolOutputs,
    success: r.metadata.success
  }));
}

// Include in ContextPackage
export interface ContextPackage {
  // ... existing fields ...
  recentTools?: ToolInvocation[];  // Only for dual mode
}
```

### Voice System Behavior by Mode

| Mode | Voice Config Source | Training Status | Notes |
|------|---------------------|-----------------|-------|
| **Dual** | `profiles/<user>/etc/voice.json` + profile-local datasets. | ✅ Enabled (`paths.voiceTraining`, `paths.voiceDataset`). | Captures new recordings, updates LoRA adapters, writes cache per user. |
| **Agent** | System-wide `out/voices/*.onnx` (read-only) with per-user speaking rate overrides. | ❌ Disabled (no training writes). | Shares compiled voices for speed while respecting user cache directories. |
| **Emulation** | Frozen adapter declared in persona config; uses public voices folder only. | ❌ Disabled + read-only. | Voice selection locked to prevent persona drift; training endpoints must return 403. |

Implementation requirements:
1. `/api/voice-settings` must call `conversationVisibility(role)` to hide private datasets from guests and `canWriteMemory(mode, 'voice_training')` before accepting uploads.
2. Voice training CLI/agents must run under `withUserContext(owner)` so `paths.voiceTraining` resolves; falling back to system voices for other users.
3. UI should display badges (“Read-only voice”, “Training disabled in agent/emulation modes”) derived from the current mode to set expectations.

#### ✅ Phase 3: Mode-Aware Conversation Summaries

**Task 3.1: Create Mode-Aware Summarizer**

File: `packages/core/src/conversation-summarizer.ts` (NEW)
```typescript
export async function summarizeConversation(
  history: Message[],
  mode: CognitiveModeId,
  conversationId: string
): Promise<string> {
  const summary = await generateSummary(history);

  if (mode === 'emulation') {
    // Ephemeral storage (not episodic memory)
    const path = `memory/conversations/session-${conversationId}.json`;
    await saveEphemeralSummary(path, {
      summary,
      mode: 'emulation',
      messageCount: history.length,
      ephemeral: true,
      createdAt: new Date().toISOString()
    });
  } else {
    // Permanent episodic memory (dual/agent)
    captureEvent(summary, {
      type: 'conversation_summary',
      tags: ['summary', mode === 'agent' ? 'actions' : 'conversation'],
      metadata: {
        cognitiveMode: mode,
        conversationId,
        messageCount: history.length
      }
    });
  }

  return summary;
}
```

---

## Revised Implementation Plan

### Week 1: Mode-Aware Foundation

**Day 1-2:**
- ✅ Create `memory-filter.ts` with `shouldCaptureMemory()`
- ✅ Enforce agent mode filtering in `persona_chat.ts`
- ✅ Add unit tests for mode-specific filtering

**Day 3-4:**
- ✅ Implement tool invocation capture in `operator-react.ts`
- ✅ Add conversation session ID tracking
- ✅ Test dual vs agent vs emulation tool capture

**Day 5:**
- ✅ Update `context-builder.ts` with mode-specific defaults
- ✅ Integration testing
- ✅ Performance benchmarking (verify latency targets)

### Week 2: Enhanced Context & Summaries

**Day 1-2:**
- ✅ Implement `queryRecentToolInvocations()` for dual mode
- ✅ Add tool context formatting in prompts
- ✅ Test prompt assembly with tools section

**Day 3-4:**
- ✅ Create mode-aware conversation summarizer
- ✅ Implement ephemeral storage for emulation mode
- ✅ Test summarization across all modes

**Day 5:**
- ✅ Integrate summaries into prompt assembly
- ✅ Auto-trigger summarization on buffer overflow
- ✅ Performance testing

### Week 3: Observability & Refinement

**Day 1-2:**
- ✅ Create memory metrics API (mode-aware)
- ✅ Build metrics dashboard widget
- ✅ Add mode-specific metric breakdowns

**Day 3-4:**
- ✅ Implement memory miss detection
- ✅ Create regression test suite
- ✅ Test all modes comprehensively

**Day 5:**
- ✅ Documentation updates
- ✅ Final integration testing
- ✅ Production deployment

---

## Testing Strategy

### Mode-Specific Test Scenarios

#### Dual Mode Tests

```typescript
describe('Dual Mode Memory Capture', () => {
  it('should capture all user messages', async () => {
    await sendMessage('Hello', { mode: 'dual', authenticated: true });
    const memories = await queryMemories({ cognitiveMode: 'dual' });
    expect(memories).toHaveLength(1);
  });

  it('should capture tool invocations', async () => {
    await sendMessage('List files', { mode: 'dual', authenticated: true });
    const tools = await queryMemories({ type: 'tool_invocation' });
    expect(tools).toHaveLength(1);
    expect(tools[0].metadata.toolName).toBe('fs_list');
  });

  it('should use deep context retrieval', async () => {
    const context = await buildContextPackage('test', 'dual');
    expect(context.memories.length).toBeLessThanOrEqual(5);
  });
});
```

#### Agent Mode Tests

```typescript
describe('Agent Mode Memory Capture', () => {
  it('should skip casual chat', async () => {
    await sendMessage('Hello', { mode: 'agent', authenticated: true });
    const memories = await queryMemories({ cognitiveMode: 'agent' });
    expect(memories).toHaveLength(0);  // Casual chat skipped
  });

  it('should capture tool invocations', async () => {
    await sendMessage('Search for ML', { mode: 'agent', authenticated: true });
    const memories = await queryMemories({ type: 'action_result' });
    expect(memories).toHaveLength(1);
  });

  it('should use normal context retrieval', async () => {
    const context = await buildContextPackage('test', 'agent');
    expect(context.memories.length).toBeLessThanOrEqual(3);
  });
});
```

#### Emulation Mode Tests

```typescript
describe('Emulation Mode Memory Capture', () => {
  it('should NOT capture any messages', async () => {
    await sendMessage('Hello', { mode: 'emulation', authenticated: false });
    const memories = await queryMemories({ cognitiveMode: 'emulation' });
    expect(memories).toHaveLength(0);  // Read-only enforcement
  });

  it('should NOT invoke operator', async () => {
    const response = await sendMessage('List files', { mode: 'emulation' });
    expect(response.usedOperator).toBe(false);
  });

  it('should store summaries ephemerally', async () => {
    await generateSummary(history, 'emulation', sessionId);
    const ephemeral = await loadEphemeralSummary(sessionId);
    expect(ephemeral.ephemeral).toBe(true);

    // Should NOT be in episodic memory
    const episodic = await queryMemories({ type: 'conversation_summary' });
    expect(episodic.some(m => m.metadata.sessionId === sessionId)).toBe(false);
  });

  it('should use shallow context retrieval', async () => {
    const context = await buildContextPackage('test', 'emulation');
    expect(context.memories.length).toBeLessThanOrEqual(2);
  });
});
```

### API & Tool Regression Suite

Beyond chat, every API that mutates state needs mode-aware coverage:

```typescript
describe('File Operations API', () => {
  it('allows owner writes in dual mode', async () => {
    const res = await callFileApi('write', { path: 'notes.md', content: 'hi' }, { mode: 'dual', role: 'owner' });
    expect(res.status).toBe(200);
    expect(await memoryExists('file_write', 'notes.md')).toBe(true);
  });

  it('blocks guest writes (emulation)', async () => {
    const res = await callFileApi('write', { path: 'notes.md', content: 'hi' }, { mode: 'emulation', role: 'guest' });
    expect(res.status).toBe(403);
    expect(await memoryExists('file_write', 'notes.md')).toBe(false);
  });
});

describe('Code Approvals API', () => {
  it('captures approvals only when canWriteMemory is true', async () => {
    await approveSkill({ mode: 'dual' });
    expect(await memoryExists('code_approval')).toBe(true);
    await approveSkill({ mode: 'emulation' });
    expect(await memoryExists('code_approval', { mode: 'emulation' })).toBe(false);
  });
});

describe('Voice Settings API', () => {
  it('returns profile voice config for owner, system voices for members', async () => {
    const owner = await getVoiceSettings({ role: 'owner', mode: 'dual' });
    expect(owner.profilePaths.voiceConfig).toContain('/profiles/');
    const guest = await getVoiceSettings({ role: 'guest', mode: 'emulation' });
    expect(guest.voices.every(v => !v.path.includes('/profiles/'))).toBe(true);
  });
});
```

Add integration tests for `/api/approvals`, `/api/tasks/*`, `/api/voice-settings`, and `/api/operator/react` so regressions are caught automatically. Each suite must include at least one read-only enforcement test.

**Vector Index Regression:** After large capture bursts, assert that `profiles/<user>/memory/index` shows the correct number of embeddings and that the queue drains even when `canWriteMemory` returns false (emulation sessions should leave the queue untouched). Include a stress test that enqueues 100 tool events in dual mode and asserts the queue flushes within 30 seconds.

### Performance Benchmarks

```typescript
describe('Mode-Specific Performance', () => {
  it('dual mode should respond within 20s', async () => {
    const start = Date.now();
    await sendMessage('Complex query', { mode: 'dual' });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(20000);
  });

  it('agent mode should respond within 10s', async () => {
    const start = Date.now();
    await sendMessage('Quick action', { mode: 'agent' });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(10000);
  });

  it('emulation mode should respond within 8s', async () => {
    const start = Date.now();
    await sendMessage('Simple question', { mode: 'emulation' });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(8000);
  });
});
```

---

## Summary

### Key Takeaways

1. **NOT Universal:** Memory Continuity improvements are **NOT** universal - they must be mode-aware
2. **Emulation Read-Only:** Emulation mode remains strictly read-only (security constraint)
3. **Agent Filtering:** Agent mode needs implementation of `command_only` memory filtering
4. **Tool Capture:** Operator pipeline needs tool invocation memory capture (all modes)
5. **Performance Tiers:** Context retrieval depth must respect mode-specific latency targets

### Mode Compatibility Matrix

| Feature | Dual | Agent | Emulation |
|---------|------|-------|-----------|
| **Memory Writes** | Full | Actions only | NONE |
| **Tool Capture** | All | Actions only | NONE |
| **Context Depth** | Deep (5) | Normal (3) | Shallow (2) |
| **Summaries** | Episodic | Episodic | Ephemeral |
| **Training Data** | Yes | Yes | No |

### Implementation Priority

Refer back to the three-week plan outlined in [Week 1–3](#week-1-mode-aware-foundation) to stage delivery. Each gate now has explicit validation criteria:
- **Week 1 exit:** `memory-policy.ts` enforced across chat, operator, file ops, approvals; guest/emulation write attempts return 403.
- **Week 2 exit:** Context builder emits mode-aware tool history + summaries guarded by `conversationVisibility()`.
- **Week 3 exit:** Observability dashboards report per-mode metrics and the automated regression suite (chat + file + approvals + voice endpoints) passes.

---

**Related Documents:**
- `memory-continuity-detailed-plan.md` - Full implementation details
- `COGNITIVE_ARCHITECTURE.md` - System design documentation
- `packages/core/src/cognitive-mode.ts` - Mode definitions

---

**End of Cognitive Mode Integration Analysis**
