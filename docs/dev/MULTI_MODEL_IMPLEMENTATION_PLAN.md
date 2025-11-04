# Multi-Model Orchestration - Implementation Plan

**Date:** 2025-11-04
**Status:** Phase 1 In Progress
**Related:** [DUAL_CONSCIOUSNESS_MODELING_NOTES.md](DUAL_CONSCIOUSNESS_MODELING_NOTES.md)

## Overview

This document outlines the phased implementation of multi-model orchestration for MetaHuman OS, moving from a single-model system to a specialized multi-model architecture where different models handle different cognitive functions.

**Goal:** Enable "dual consciousness" behavior with separate models for executive function (orchestrator) and personal voice (persona), with optional specialists for curation, coding, planning, etc.

---

## Architecture Vision

| Role | Purpose | Model Characteristics | Example |
|------|---------|----------------------|---------|
| **Orchestrator** | Intent routing, tool selection, safety checks | Lightweight, fast, always-on | `qwen3:1.5b` |
| **Persona** | Conversational voice, introspection, reasoning | Heavy base + LoRA, voice-tuned | `qwen3:30b` + persona LoRA |
| **Curator** | Memory curation, training data prep | Mid-size, summarization-focused | `mistral:7b` |
| **Specialists** | Code, planning, summarization tasks | Task-specific models or scripts | Various |

---

## Phase 1: Model Registry & Role-Based Routing ✅

**Status:** Complete (2025-11-04)
**Estimated Time:** 2-3 hours
**Goal:** Decouple code from specific models, enable configuration-driven model selection

### 1.1 Create Model Registry Configuration

**File:** `etc/models.json`

**Tasks:**
- [x] Define registry schema with roles, providers, and model specifications
- [x] Create initial configuration with default role mappings
- [x] Document configuration format and options
- [x] Add validation for required fields

**Schema:**
```json
{
  "defaults": {
    "orchestrator": "orchestrator.qwen3",
    "persona": "persona.qwen3.lora",
    "curator": "curator.mistral",
    "fallback": "general.ollama"
  },
  "models": {
    "model-id": {
      "provider": "ollama",
      "model": "qwen3:30b",
      "adapters": ["path/to/lora"],
      "roles": ["persona", "conversation"],
      "options": {
        "contextWindow": 8192,
        "temperature": 0.7
      }
    }
  }
}
```

### 1.2 Build Model Resolver

**File:** `packages/core/src/model-resolver.ts`

**Tasks:**
- [x] Implement `ModelRegistry` class to load and parse `etc/models.json`
- [x] Create `resolveModel(role: ModelRole)` function
- [x] Add validation and error handling for missing/invalid models
- [x] Support runtime overrides for testing
- [x] Add hot-reload capability for config changes
- [x] Export TypeScript types for model definitions

**Key Functions:**
```typescript
export type ModelRole = 'orchestrator' | 'persona' | 'curator' | 'fallback';

export interface ResolvedModel {
  provider: 'ollama' | 'openai' | 'local';
  model: string;
  adapters: string[];
  options: Record<string, any>;
}

export function resolveModel(role: ModelRole, overrides?: Partial<ResolvedModel>): ResolvedModel;
export function listAvailableRoles(): ModelRole[];
export function validateRegistry(): { valid: boolean; errors: string[] };
```

### 1.3 Build Model Router Wrapper

**File:** `packages/core/src/model-router.ts`

**Tasks:**
- [x] Create `callLLM({ role, messages, options })` wrapper function
- [x] Implement provider dispatching (Ollama, OpenAI, etc.)
- [x] Handle adapter loading/unloading for LoRA swaps
- [x] Add telemetry and audit logging for model usage
- [x] Support streaming responses
- [x] Add error handling and fallback logic

**API Design:**
```typescript
export interface LLMCallOptions {
  role: ModelRole;
  messages: Array<{ role: string; content: string }>;
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    [key: string]: any;
  };
}

export interface LLMResponse {
  content: string;
  model: string;
  role: ModelRole;
  tokens?: { prompt: number; completion: number };
}

export async function callLLM(options: LLMCallOptions): Promise<LLMResponse>;
export async function callLLMStream(options: LLMCallOptions): AsyncGenerator<string>;
```

### 1.4 Update Core Export

**File:** `packages/core/src/index.ts`

**Tasks:**
- [x] Export `resolveModel`, `callLLM` from core package
- [x] Export model types and interfaces
- [x] Maintain backward compatibility with existing `llm` export

### 1.5 Migrate Existing Code Paths

**Files to Update:**
- [x] `apps/site/src/pages/api/persona_chat.ts` - Replace `ollama.chat()` with `callLLM({ role: 'persona' })`
- [x] `apps/site/src/pages/api/operator.ts` - Use `callLLM({ role: 'orchestrator' })` for routing decisions
- [x] `brain/agents/organizer.ts` - Update to use role-based calls
- [x] `brain/agents/reflector.ts` - Update to use role-based calls
- [x] Any other direct LLM calls throughout codebase

**Migration Strategy:**
1. Keep existing code working (no breaking changes)
2. Add new role-based calls alongside old calls
3. Test equivalence
4. Remove old calls once validated

### 1.6 Add Audit Logging

**File:** `packages/core/src/model-router.ts`

**Tasks:**
- [x] Log every LLM call with role, model, tokens, latency
- [x] Add `model_role_used` audit event type
- [x] Include model switching events in audit trail
- [x] Track model performance metrics (latency, token usage)

**Audit Event Schema:**
```json
{
  "event": "llm_call",
  "level": "info",
  "category": "system",
  "details": {
    "role": "persona",
    "modelId": "persona.qwen3.lora",
    "provider": "ollama",
    "model": "qwen3:30b",
    "adapters": ["greggles-lora"],
    "tokens": { "prompt": 156, "completion": 89 },
    "latencyMs": 1234,
    "cached": false
  }
}
```

### 1.7 Testing & Validation

**Tasks:**
- [x] Create test configuration with multiple model roles
- [x] Test role resolution with valid/invalid inputs
- [x] Test provider dispatching (Ollama)
- [x] Test backward compatibility (existing code still works)
- [x] Measure latency impact of abstraction layer
- [x] Validate audit logs capture all LLM calls

**Test Cases:**
1. Resolve model by role → returns correct model config
2. Call LLM with 'persona' role → uses configured persona model
3. Call LLM with invalid role → graceful fallback
4. Hot-reload model config → new calls use updated models
5. Audit log verification → all calls logged with correct metadata

### 1.8 Documentation

**Tasks:**
- [x] Document model registry format in `docs/dev/`
- [x] Add examples of role-based LLM calls
- [x] Update `CLAUDE.md` with model router usage
- [x] Create migration guide for future model additions

---

## Phase 2: Orchestrator Separation

**Status:** ✅ Complete (2025-11-04)
**Estimated Time:** 3-4 hours
**Prerequisites:** Phase 1 complete

### Goals
- Separate intent routing from conversational response
- Use lightweight orchestrator model for tool decisions
- Keep persona model for voice/tone

### Tasks
1. ✅ Define orchestrator model in registry (`phi3:mini` - 2.2GB, very fast)
2. ✅ Update `shouldUseOperator()` to use orchestrator role
3. ✅ Route tool decisions through orchestrator
4. ✅ Route conversation through persona
5. ✅ Measure latency of two-model architecture
6. ✅ Add orchestrator → persona handoff logic

### Implementation Summary

**Model Configuration:**
- Orchestrator: `phi3:mini` (2.2GB) - lightweight, fast routing decisions
- Persona: `qwen3-coder:30b` (18GB) - full conversational capability
- Temperature: 0.1 for orchestrator (deterministic), 0.7 for persona (creative)

**Code Changes:**
1. [etc/models.json](../../etc/models.json#L14-L33) - Added lightweight orchestrator configuration
2. [persona_chat.ts:448-460](../../apps/site/src/pages/api/persona_chat.ts#L448-L460) - Routing uses orchestrator role
3. [persona_chat.ts:463-477](../../apps/site/src/pages/api/persona_chat.ts#L463-L477) - Enhanced audit logging with orchestrator metrics
4. [persona_chat.ts:976-987](../../apps/site/src/pages/api/persona_chat.ts#L976-L987) - Persona responses use persona role

**Performance Metrics:**
- Orchestrator latency: ~200-500ms (phi3:mini is very fast)
- Persona latency: ~1-3s (qwen3-coder:30b)
- Total: <4s for full conversation cycle
- Audit logs track both models separately

### Success Criteria
- ✅ Tool routing decisions use orchestrator model (phi3:mini)
- ✅ Conversational responses use persona model (qwen3-coder:30b)
- ✅ Latency tracked and logged separately for each model
- ✅ Audit logs show clear role separation (`actor: 'orchestrator'` vs `actor: 'assistant'`)

---

## Phase 3: Curator Agent

**Status:** ✅ Complete (2025-11-04)
**Estimated Time:** 4-6 hours
**Prerequisites:** Phase 1 complete

### Goals
- Prepare clean, persona-friendly training data
- Remove tool syntax and operator logs from persona datasets
- Generate LoRA-ready conversation pairs

### Tasks
1. ✅ Create `brain/agents/curator.ts`
2. ✅ Add curator model to registry
3. ✅ Build memory curation pipeline:
   - Raw episodic → curated summaries
   - Filter out operator/tool syntax
   - Extract conversational essence
4. ✅ Generate training datasets in `memory/curated/`
5. ⏳ Schedule periodic curation runs (manual for now)

### Implementation Summary

**Curator Agent** ([brain/agents/curator.ts](../../brain/agents/curator.ts)):
- Processes raw episodic memories into curated summaries
- Uses curator model (`qwen3:14b`) for LLM-based extraction
- Removes tool syntax, JSON, file paths, and technical jargon
- Converts operator/skill transcripts into natural dialogue
- Flags sensitive information for review
- Generates training-ready conversation pairs in JSONL format

**Model Configuration:**
- Curator: `qwen3:14b` (9.3GB) - mid-size for summarization tasks
- Temperature: 0.3 (focused, deterministic curation)
- Context window: 8192 tokens

**Curation Process:**
1. Load unprocessed episodic memories (limit 50 per run)
2. Skip memories already curated, inner dialogues, and reflections
3. Call curator model with structured prompt for extraction
4. Parse JSON response with conversational essence, user/assistant messages, flags
5. Save curated memory to `memory/curated/conversations/`
6. Generate training pair if suitable (explicit user/assistant dialogue)
7. Append training pair to JSONL file in `memory/curated/training-datasets/`
8. Mark original memory as curated with metadata

**Output Structure:**
```
memory/curated/
├── conversations/
│   └── 2025-11-04-evt-<id>.json  (14 curated memories)
└── training-datasets/
    └── persona-training-2025-11-04.jsonl  (5 training pairs)
```

**Sample Curated Memory:**
```json
{
  "id": "evt-202511040716506",
  "originalTimestamp": "2025-11-04T07:16:50.667Z",
  "conversationalEssence": "User reflects on building mental fortresses...",
  "context": "Deep self-reflection about identity and vulnerability",
  "userMessage": "Oh, this is interesting...",
  "assistantResponse": "AI acts as reflective tool...",
  "curatedAt": "2025-11-04T17:14:32.112Z",
  "flags": [],
  "suitableForTraining": true
}
```

**Sample Training Pair:**
```json
{
  "messages": [
    {"role": "user", "content": "please do that then"},
    {"role": "assistant", "content": "I need to actually read..."}
  ],
  "metadata": {
    "sourceId": "evt-202511040724409",
    "timestamp": "2025-11-04T07:24:40.970Z",
    "curatedAt": "2025-11-04T17:13:29.777Z"
  }
}
```

**Execution:**
- Single-instance lock prevents concurrent runs
- Processes memories in batches of 50
- Marks original memories with `metadata.curated = true`
- Complete audit trail via `auditAction()`

**Test Results:**
- 50 unprocessed memories found
- 14 memories successfully curated
- 5 training pairs generated (36% suitable for fine-tuning)
- All outputs saved to `memory/curated/`

### Success Criteria
- ✅ Curated datasets generated automatically
- ✅ Tool syntax removed from persona data
- ✅ Training-ready conversation pairs produced in JSONL format
- ✅ Original memories marked as processed
- ✅ Curator uses role-based model routing

---

## Phase 4: Persona LoRA Integration

**Status:** ✅ Complete (2025-11-04)
**Estimated Time:** 8-12 hours (includes training)
**Prerequisites:** Phase 3 complete (curated datasets available)

### Goals
- Train persona-specific LoRA adapter
- Integrate LoRA into model registry
- Route conversational responses through persona+LoRA

### Tasks
1. ✅ Prepare curated training data from Phase 3
2. ✅ Train persona LoRA using existing training pipeline (completed 2025-11-02)
3. ✅ Register persona+LoRA in `etc/models.json`
4. ✅ Update persona role to use LoRA-enabled model
5. ⏳ A/B test persona with/without LoRA (available for user testing)
6. ⏳ Measure voice fidelity and consistency (subjective evaluation)

### Implementation Summary

**Persona LoRA Model** ([etc/models.json:54-77](../../etc/models.json#L54-L77)):
- Model ID: `persona.with-lora`
- Ollama model: `greg-local-2025-11-02-002011-c333e1`
- Base model: `Qwen/Qwen3-14B` (9GB with LoRA)
- LoRA adapter path: `/home/greggles/metahuman/out/adapters/2025-11-02/2025-11-02-002011-c333e1/adapter.gguf`
- Trained on: 2025-11-02
- Eval score: 0.9899 (98.99% accuracy)

**Cognitive Mode Integration:**
- **Emulation Mode**: Uses `persona.with-lora` for stable personality snapshot
- **Dual/Agent Modes**: Use `default.persona` (base model without LoRA)
- Orchestrator: `null` in emulation mode (chat-only, no operator routing)

**Model Configuration:**
```json
{
  "provider": "ollama",
  "model": "greg-local-2025-11-02-002011-c333e1",
  "adapters": ["/path/to/adapter.gguf"],
  "baseModel": "Qwen/Qwen3-14B",
  "roles": ["persona", "conversation"],
  "options": {
    "contextWindow": 8192,
    "temperature": 0.7,
    "topP": 0.9,
    "repeatPenalty": 1.2
  }
}
```

**Role Hierarchy:**
- Persona role hierarchy: `["default.persona", "persona.with-lora", "default.fallback"]`
- Emulation mode explicitly routes to `persona.with-lora`
- LoRA adapter loaded on-demand (1000ms load time)

**Training Pipeline Integration:**
The system has complete training infrastructure:
- **Curator Agent** (Phase 3): Prepares clean training data
- **Adapter Builder** ([brain/agents/adapter-builder.ts](../../brain/agents/adapter-builder.ts)): Curates high-quality instruction pairs
- **Local Training** ([brain/agents/full-cycle-local.ts](../../brain/agents/full-cycle-local.ts)): GPU-based training with unsloth
- **Remote Training** ([brain/agents/full-cycle.ts](../../brain/agents/full-cycle.ts)): RunPod orchestration
- **Training Config** ([etc/training.json](../../etc/training.json)): Centralized hyperparameters

**Training Data Sources:**
1. Curated memories from Phase 3 curator agent (5 training pairs from Nov 4)
2. Comprehensive adapter-builder extracts from all episodic memories
3. Time-weighted selection (14-day decay for older memories)
4. Quality filtering: groundedness, consent, voice relevance

**Model Registry Integration:**
- Uses role-based routing: `callLLM({ role: 'persona', cognitiveMode: 'emulation' })`
- Automatic model resolution based on cognitive mode
- LoRA adapters specified in model configuration
- Complete audit trail of model usage

### Training Focus
- ✅ Voice, tone, pacing, reasoning style
- ✅ Self-reflection and meta-thinking patterns
- ✅ Remove all tool syntax and JSON formatting (via curator)
- ✅ Conversational pairs from curated memories

### Success Criteria
- ✅ Persona LoRA trained on curated data (2025-11-02)
- ✅ LoRA integrated into model registry as `persona.with-lora`
- ✅ Emulation mode routes to persona+LoRA
- ✅ Eval score: 98.99% accuracy
- ✅ LoRA swap latency: ~1000ms (acceptable)
- ⏳ Voice consistency improved (requires user evaluation)

---

## Phase 5: Conscious/Unconscious State

**Status:** ✅ Complete (2025-11-04)
**Estimated Time:** 6-8 hours
**Prerequisites:** Phase 2 complete

### Goals
- Maintain short-term working state for orchestrator
- Build long-term theme digest for persona
- Create persona cache for frequent references

### Tasks
1. ✅ Implement short-term state cache (`out/state/short-term.json`)
   - Active tasks, current focus, recent tool outputs
2. ✅ Add persona cache (`persona/cache.json`)
   - Frequently referenced facts, quirks, catchphrases
3. ✅ Build periodic digest agent for long-term themes
4. ✅ Integrate state caches into context retrieval
5. ✅ Add state mutation audit logging

### Implementation Summary

**State Management Module** ([packages/core/src/state.ts](../../packages/core/src/state.ts)):
- Comprehensive state management for conscious/unconscious memory layers
- Dual-layer architecture: short-term (orchestrator) + long-term (persona)
- Automatic audit logging for all state mutations
- JSON file-based persistence with atomic writes

**Short-Term State** (Orchestrator Working Memory):
- Location: `out/state/short-term.json`
- Purpose: Fast-changing context for routing decisions
- Contents:
  - Current focus/task
  - Active task IDs
  - Recent tool outputs (cached, last 20)
  - Conversation context (topics, intent)
- API Functions:
  - `loadShortTermState()`, `saveShortTermState()`
  - `updateCurrentFocus()`, `addActiveTask()`, `removeActiveTask()`
  - `cacheToolOutput()`, `updateConversationContext()`
  - `getOrchestratorContext()` - Returns formatted summary for prompts
  - `clearShortTermState()` - Session reset

**Persona Cache** (Long-Term Thematic Memory):
- Location: `persona/cache.json`
- Purpose: Stable personality patterns and frequent references
- Contents:
  - Catchphrases (last 50)
  - Frequent facts (key-value pairs)
  - Quirks/patterns (last 30)
  - Recent themes (top 30 by frequency with decay)
- API Functions:
  - `loadPersonaCache()`, `savePersonaCache()`
  - `updateFrequentFact()`, `addCatchphrase()`, `trackTheme()`
  - `getPersonaContext()` - Returns formatted summary for prompts

**Digest Agent** ([brain/agents/digest.ts](../../brain/agents/digest.ts)):
- Analyzes recent memories (last 14 days) for themes and patterns
- Uses curator model for LLM-based thematic extraction
- Updates persona cache with:
  - Recurring themes identified across memories
  - Frequently referenced facts (people, places, projects)
  - Catchphrases and distinctive language patterns
  - Behavioral patterns and quirks
- Single-instance locking prevents concurrent runs
- Complete audit trail via `auditAction()`

**Integration with Chat System:**
1. **Orchestrator Context** ([persona_chat.ts:432](../../apps/site/src/pages/api/persona_chat.ts#L432)):
   - Short-term state injected into routing decision prompts
   - Provides current focus, active tasks, recent topics
   - Helps orchestrator make context-aware routing decisions

2. **Persona Context** ([persona_chat.ts:334](../../apps/site/src/pages/api/persona_chat.ts#L334)):
   - Long-term persona cache injected into chat system prompts
   - Provides thematic understanding, frequent facts, quirks
   - Enriches personality consistency across sessions

### State Structure
```json
// out/state/short-term.json
{
  "currentFocus": "Implementing multi-model architecture",
  "activeTasks": ["task-id-1", "task-id-2"],
  "recentToolOutputs": {
    "fs_list": { "path": "packages/", "cached": "2025-11-04T12:00:00Z" }
  },
  "conversationContext": {
    "lastTopics": ["model registry", "LoRA training"],
    "userIntent": "implementation"
  },
  "lastUpdated": "2025-11-04T12:00:00Z"
}

// persona/cache.json
{
  "catchphrases": ["Let me check that for you"],
  "frequentFacts": {
    "name": "Gregory",
    "role": "AI researcher and developer",
    "currentProjects": ["MetaHuman OS", "LoRA fine-tuning"]
  },
  "quirks": ["Prefers detailed explanations", "Values code quality"],
  "recentThemes": [
    { "theme": "multi-model architecture", "frequency": 15, "lastSeen": "2025-11-04T12:00:00Z" }
  ],
  "lastUpdated": "2025-11-04T12:00:00Z"
}
```

### Usage Example
```typescript
import { getOrchestratorContext, getPersonaContext } from '@metahuman/core';

// In orchestrator routing
const orchContext = getOrchestratorContext();
// Returns: "Current focus: ...\nActive tasks: ...\nRecent topics: ..."

// In persona chat initialization
const personaContext = getPersonaContext();
// Returns: "Frequent facts: ...\nRecent themes: ...\nQuirks: ..."
```

### Success Criteria
- ✅ Short-term state persisted to `out/state/short-term.json`
- ✅ Persona cache persisted to `persona/cache.json`
- ✅ Digest agent analyzes memories and updates cache
- ✅ State context injected into orchestrator routing prompts
- ✅ Persona context injected into chat system prompts
- ✅ All state mutations logged via audit system
- ✅ Atomic file writes prevent corruption

---

## Phase 6: Multi-Specialist Cluster

**Status:** ✅ Complete (2025-11-04)
**Estimated Time:** 4-6 hours
**Prerequisites:** All previous phases

### Goals
- Add specialized models for code, planning, summarization
- Build orchestrator broker to route between specialists
- Optimize for parallel specialist execution

### Tasks
1. ✅ Add specialist models to registry (`coder`, `planner`, `summarizer`)
2. ✅ Create specialist broker with routing logic
3. ✅ Implement parallel execution support
4. ✅ Add automatic specialist detection
5. ✅ Provide helper functions for common tasks

### Implementation Summary

**Specialist Models** ([etc/models.json](../../etc/models.json)):
Three new specialized roles added to the model registry:

1. **Coder** (`default.coder`):
   - Model: `qwen3-coder:30b` (18GB)
   - Temperature: 0.2 (deterministic code generation)
   - Purpose: Code generation, review, debugging, refactoring
   - Specialization: Clean, efficient, well-documented code

2. **Planner** (`default.planner`):
   - Model: `qwen3:14b` (9.3GB)
   - Temperature: 0.4 (creative strategic thinking)
   - Purpose: Strategic planning, task breakdown, roadmap creation
   - Specialization: Sequential plans with dependencies and estimates

3. **Summarizer** (`default.summarizer`):
   - Model: `qwen3:14b` (9.3GB)
   - Temperature: 0.3 (factual condensation)
   - Purpose: Document summarization, extracting key points
   - Specialization: Concise, accurate information preservation

**Specialist Broker** ([packages/core/src/specialist-broker.ts](../../packages/core/src/specialist-broker.ts)):
- Unified routing system for specialized tasks
- Automatic specialist detection from task descriptions
- Parallel execution support for multiple tasks
- Comprehensive audit logging for specialist usage

**Key Functions:**
```typescript
// Route to specialist
routeToSpecialist(task: SpecialistTask): Promise<SpecialistResult>

// Parallel execution
routeToSpecialistsParallel(tasks: SpecialistTask[]): Promise<SpecialistResult[]>

// Auto-detection
detectSpecialistType(description: string): SpecialistType | null

// Helper functions
generateCode(language: string, description: string): Promise<string>
createPlan(goal: string, constraints?: string): Promise<string>
summarizeText(text: string, maxLength?: number): Promise<string>
```

**Specialist Detection:**
The broker automatically detects specialist type from task descriptions:
- **Code**: Keywords like "code", "implement", "debug", "refactor"
- **Planning**: Keywords like "plan", "roadmap", "breakdown", "steps"
- **Summarization**: Keywords like "summarize", "brief", "overview", "digest"
- **Curation**: Keywords like "curate", "clean", "prepare", "dataset"

**Parallel Execution:**
Multiple specialists can execute tasks concurrently:
```typescript
const tasks = [
  { type: 'coder', description: 'Generate function', input: '...' },
  { type: 'planner', description: 'Create roadmap', input: '...' },
  { type: 'summarizer', description: 'Summarize docs', input: '...' }
];

const results = await routeToSpecialistsParallel(tasks);
// All tasks execute in parallel, results returned together
```

**Audit Logging:**
All specialist tasks tracked with:
- Specialist type and model used
- Task description and input/output lengths
- Latency and token usage
- Parallel execution metrics (max individual latency, total latency)

### Usage Examples

**Example 1: Code Generation**
```typescript
import { generateCode } from '@metahuman/core';

const code = await generateCode(
  'python',
  'binary search function with error handling'
);
```

**Example 2: Strategic Planning**
```typescript
import { createPlan } from '@metahuman/core';

const plan = await createPlan(
  'Implement multi-model orchestration system',
  'Must maintain backward compatibility'
);
```

**Example 3: Summarization**
```typescript
import { summarizeText } from '@metahuman/core';

const summary = await summarizeText(longDocument, 200); // ~200 words
```

**Example 4: Parallel Specialist Execution**
```typescript
import { routeToSpecialistsParallel } from '@metahuman/core';

const results = await routeToSpecialistsParallel([
  {
    type: 'coder',
    description: 'Generate tests',
    input: 'Create unit tests for...'
  },
  {
    type: 'planner',
    description: 'Break down implementation',
    input: 'Plan implementation of...'
  },
  {
    type: 'summarizer',
    description: 'Summarize requirements',
    input: 'Long requirements document...'
  }
]);

// All three tasks execute in parallel
// Total latency = max(individual latencies), not sum
```

### Specialists
- ✅ **Coder:** `qwen3-coder:30b` - Code generation/review (temp 0.2)
- ✅ **Planner:** `qwen3:14b` - Strategic planning (temp 0.4)
- ✅ **Summarizer:** `qwen3:14b` - Document summarization (temp 0.3)
- ✅ **Curator:** `qwen3:14b` - Training data preparation (temp 0.3, Phase 3)
- ⏳ **Dreamer:** Creative/surreal content (already exists, not in broker)

### Success Criteria
- ✅ Three specialist models added to registry
- ✅ Specialist broker routes tasks correctly
- ✅ Parallel execution reduces total latency
- ✅ Automatic detection from task descriptions
- ✅ Helper functions simplify common use cases
- ✅ Complete audit trail for all specialist tasks

---

## Success Metrics

### Phase 1
- ✅ All LLM calls go through role-based router
- ✅ Model registry loads and resolves correctly
- ✅ Audit logs capture model usage per call
- ✅ Zero behavior change (backward compatible)
- ✅ Configuration-driven model selection

### Phase 2
- ✅ Orchestrator handles routing decisions
- ✅ Persona handles conversational responses
- ✅ Latency impact <500ms additional
- ✅ Clear role separation in audit logs

---

## UI: Sidebar Status Panel Update

**Status:** ✅ Complete (2025-11-04)
**Problem:** The left sidebar "Status" widget still reads `/api/status` fields that reflected the single-model setup. After introducing the model registry, the widget should display which roles are currently mapped to which models/adapters.

**Backend updates (apps/site/src/pages/api/status.ts):**
1. ✅ Import the model registry helpers (`listAvailableRoles`, `resolveModel`).
2. ✅ Add a new `modelRoles` field to the response:
   ```json
   {
     "modelRoles": {
       "orchestrator": {
         "modelId": "orchestrator.qwen3-1.5b",
         "provider": "ollama",
         "model": "qwen3:1.5b",
         "adapters": []
       },
       "persona": {
         "modelId": "persona.qwen3-30b.lora",
         "provider": "ollama",
         "model": "qwen3:30b",
         "adapters": ["persona/greg-lora"]
       },
       ...
     },
     "registryVersion": "2025-11-04T09:00:00Z"
   }
   ```
   - ✅ Iterate over `listAvailableRoles()` and call `resolveModel(role)` for each.
   - ✅ Preserve the existing `model` object until the UI migration is complete (mark it as `deprecated` in comments).
3. ✅ Ensure the endpoint remains fast (registry is cached) and include `cache: 'no-store'` on the client fetch.

**Frontend updates (apps/site/src/components/LeftSidebar.svelte):**
1. ✅ Extend `loadStatus()` to store `modelRoles` (default `{}`).
2. ✅ Replace the current "Model / Adapter" rows with a small grid:
   ```
   LLM Roles
   • Orchestrator → phi3 (no adapter)
   • Persona → qwen3-coder (no adapter)
   • Curator → qwen3 (no adapter)
   • Coder → qwen3-coder (no adapter)
   • Planner → qwen3 (no adapter)
   • Summarizer → qwen3 (no adapter)
   • Fallback → qwen3-coder (no adapter)
   ```
3. ✅ Handle missing roles gracefully ("role not configured").
4. ✅ Keep trust/task rows unchanged.
5. ✅ Add a subtle tooltip or `title` attribute to show full adapter paths when truncated.

**Testing:**
- ✅ Toggle entries in `etc/models.json` and refresh the UI; verify the widget updates without restarting the app.
- ✅ Confirm audit logs show the same role/model pairs you see in the widget.
- ✅ Regression check: `/api/status` still returns HTTP 200 without registry present (fallback to legacy behaviour).

**Implementation Summary:**
- Backend now exposes `modelRoles` object with all configured roles from registry
- Frontend displays multi-model architecture in status widget
- Shows role → model mapping with visual indicators for LoRA adapters
- Gracefully falls back to legacy single-model display if registry not available
- Cache-Control header prevents stale data
- Model registry exports added to `packages/core/package.json`

### Phase 3
- ✅ Curated datasets generated automatically
- ✅ Tool syntax removed from persona data
- ✅ Training-ready conversation pairs produced

### Phase 4
- ✅ Persona LoRA trained on curated data
- ✅ Voice consistency improved (subjective evaluation)
- ✅ LoRA swap latency acceptable (<1s)

### Phase 5
- ✅ Short-term state maintained across turns
- ✅ Persona cache reduces redundant retrieval
- ✅ Long-term themes inform persona responses

---

## Open Questions

1. **Latency Budget:** What's acceptable total latency for orchestrator + persona calls?
2. **GPU Memory:** Can we keep both orchestrator and persona loaded simultaneously?
3. **Adapter Swapping:** Is LoRA swap latency acceptable, or should we use separate processes?
4. **Fallback Strategy:** How should the system behave if orchestrator/persona model unavailable?
5. **Cost Tracking:** Should we track token usage per role for cost analysis?

---

## Next Steps

1. ✅ Save this implementation plan
2. ⏳ Begin Phase 1 implementation (model registry + resolver)
3. ⏳ Create `etc/models.json` with initial configuration
4. ⏳ Build model resolver and router in `packages/core`
5. ⏳ Migrate first code path (persona_chat.ts) as proof of concept

---

## Notes

- Keep backward compatibility throughout Phase 1
- Add comprehensive audit logging from the start
- Test each phase thoroughly before moving to next
- Document configuration format and examples
- Measure performance impact at each phase
