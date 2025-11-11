# Reasoning Service Consolidation - Implementation Plan

**Date Created**: 2025-11-11
**Status**: Planning Phase
**Prerequisites**: Operator V2 Refactor Complete (18/18 tests passing)

---

## Executive Summary

This plan consolidates MetaHuman OS's distributed reasoning implementations into a unified, reusable service. The recently completed Operator V2 refactor provides an excellent foundation with production-ready scratchpad logic, error handling, and tool catalog integration.

**Key Objectives**:
1. Extract proven reasoning patterns from Operator V2 into reusable service
2. Standardize SSE event format across all reasoning surfaces
3. Enable reasoning service reuse by multiple agents (reflector, dreamer, CLI)
4. Create unified telemetry and debugging infrastructure
5. Maintain backward compatibility during migration

**Approach**: Phased rollout with feature flags, leveraging existing V2 implementation as the foundation.

---

## Current State Analysis

### Assets Ready for Reuse (From Operator V2)

**From `brain/agents/operator-react.ts`**:
- ✅ Scratchpad types (`ScratchpadEntry`, `PlanningResponse`) - lines 74-95
- ✅ Planner logic with JSON validation + retry - lines 1321-1463
- ✅ Three observation modes (narrative/structured/verbatim) - lines 1481-1600
- ✅ Error analysis with contextual suggestions - lines 1698-1783
- ✅ Failure loop detection - lines 1795-1827
- ✅ Fast-path optimizations (chat detection, completion rules, synthesis skipping)
- ✅ Tool catalog integration via `getCachedCatalog()` - line 1327

**From `packages/core/src/tool-catalog.ts`**:
- ✅ Manifest formatting (LLM-friendly descriptions)
- ✅ Caching with 1-minute TTL

### Pain Points to Address

1. **No Unified Service**: Logic duplicated across operator-react, persona_chat, reflector, dreamer
2. **V2 Not Active**: Feature-complete but behind flag (`reactV2: false`)
3. **Tool Catalog Underused**: operator-react builds inline catalog instead of using service (line 468)
4. **SSE Format Inconsistency**: Different event shapes across agents
5. **Multi-Round Reasoning Separate**: persona_chat's planner/critic not integrated with operator
6. **Scratchpad Not Exposed**: V2 scratchpad exists but no UI visualization

---

## Target Architecture

```
packages/core/src/reasoning/
├── index.ts              # Public API exports
├── engine.ts             # ReasoningEngine class (extracted from operator V2)
├── scratchpad.ts         # Scratchpad types + formatting
├── planner.ts            # Planning logic (LLM + validation)
├── observers.ts          # Observation formatting (3 modes)
├── errors.ts             # Error analysis + suggestions
├── validators.ts         # Failure loop detection
├── telemetry.ts          # Unified event emission (SSE + audit + logs)
├── types.ts              # Shared TypeScript interfaces
└── config.ts             # Reasoning configuration (depth, models, limits)
```

### ReasoningEngine API

```typescript
interface ReasoningEngineConfig {
  // Reasoning depth (from UI slider)
  depth: 'off' | 'quick' | 'focused' | 'deep'; // 0-3

  // Iteration limits by depth
  maxSteps: number; // 5 (quick), 10 (focused), 15 (deep)

  // Tool catalog
  toolCatalog?: ToolCatalog; // Auto-loaded if not provided

  // Models
  planningModel?: string; // 'orchestrator' role
  responseModel?: string; // 'persona' role
  useSingleModel?: boolean; // Use same model for all steps

  // Scratchpad
  scratchpadTrimSize?: number; // Default: 10
  observationMode?: 'narrative' | 'structured' | 'verbatim'; // Auto-detect if not set

  // Error handling
  enableErrorRetry?: boolean; // Default: true
  enableFailureLoopDetection?: boolean; // Default: true

  // Optimizations
  enableFastPath?: boolean; // Chat detection, synthesis skipping
  enableVerbatimShortCircuit?: boolean; // Data query optimization

  // Telemetry
  enableScratchpadDump?: boolean; // Write to logs/run/reasoning/
  verboseErrors?: boolean; // Full stack traces

  // Session tracking
  sessionId?: string;
  conversationId?: string;
  userId?: string;
}

interface ReasoningResult {
  goal: string;
  result: string; // Final response
  scratchpad: ScratchpadEntry[]; // Full reasoning trace
  metadata: {
    stepsExecuted: number;
    fastPathUsed: boolean;
    verbatimShortCircuit: boolean;
    totalDuration: number;
    llmCalls: number;
    errors: number;
  };
}

class ReasoningEngine {
  constructor(config: ReasoningEngineConfig);

  // Main entry point
  async run(
    goal: string,
    context?: ReasoningContext,
    onProgress?: (event: ReasoningEvent) => void
  ): Promise<ReasoningResult>;

  // Utilities
  getCatalog(): ToolCatalog;
  getScratchpad(): ScratchpadEntry[];
  invalidate(): void; // Clear internal caches
}
```

### Event Schema (Unified SSE Format)

```typescript
interface ReasoningEvent {
  type: 'thought' | 'action' | 'observation' | 'completion' | 'error';
  step: number;
  timestamp: string; // ISO 8601
  sessionId: string;

  data: {
    // Thought events
    thought?: string;

    // Action events
    tool?: string;
    args?: Record<string, any>;

    // Observation events
    result?: any;
    mode?: 'narrative' | 'structured' | 'verbatim';
    success?: boolean;

    // Error events
    error?: {
      code: string;
      message: string;
      suggestions?: string[];
      context?: any;
    };

    // Completion events
    finalResponse?: string;
    metadata?: {
      stepsExecuted: number;
      llmCalls: number;
      totalDuration: number;
    };
  };
}
```

---

## Implementation Phases

### Phase 0: Validate V2 Refactor (Prerequisite)

**Goal**: Ensure V2 implementation is production-ready before extraction.

**Tasks**:
1. Enable V2 feature flag in `etc/runtime.json`: `"reactV2": true`
2. Run existing test suite: `node tests/test-operator-v2.mjs`
3. Manual testing:
   - Chat queries (fast-path)
   - Data queries (verbatim mode)
   - Multi-step tasks (full loop)
   - Error scenarios (failure loop detection)
4. Monitor audit logs for V2 events
5. Compare V1 vs V2 performance (latency, LLM calls)

**Success Criteria**:
- ✅ All 18 tests passing
- ✅ V2 produces same or better results than V1
- ✅ No regressions in chat latency
- ✅ Error recovery working (suggestions + failure loop detection)

**Deliverables**:
- V2 validation report
- Performance comparison metrics

---

### Phase 1: Extract Reasoning Service Module

**Goal**: Create reusable reasoning service from Operator V2 implementation.

#### Task 1.1: Create Module Structure

**Files to Create**:
- `packages/core/src/reasoning/index.ts`
- `packages/core/src/reasoning/types.ts`
- `packages/core/src/reasoning/config.ts`
- `packages/core/src/reasoning/scratchpad.ts`
- `packages/core/src/reasoning/planner.ts`
- `packages/core/src/reasoning/observers.ts`
- `packages/core/src/reasoning/errors.ts`
- `packages/core/src/reasoning/validators.ts`
- `packages/core/src/reasoning/telemetry.ts`
- `packages/core/src/reasoning/engine.ts`

**Code to Extract from `brain/agents/operator-react.ts`**:

1. **types.ts** (lines 74-95):
   ```typescript
   export interface ScratchpadEntry {
     step: number;
     thought: string;
     action?: { tool: string; args: Record<string, any> };
     observation?: {
       mode: 'narrative' | 'structured' | 'verbatim';
       content: string;
       success: boolean;
       error?: { code: string; message: string; context: any };
     };
     timestamp: string;
   }

   export interface PlanningResponse {
     thought: string;
     action?: { tool: string; args: Record<string, any> };
     respond?: boolean;
     responseStyle?: 'default' | 'strict' | 'summary';
   }

   export interface ReasoningContext {
     memories: Memory[];
     conversationHistory: Message[];
     cognitiveMode?: string;
     allowMemoryWrites?: boolean;
   }
   ```

2. **scratchpad.ts** (lines 1291-1316):
   ```typescript
   export function formatScratchpadForLLM(
     scratchpad: ScratchpadEntry[],
     trimToLastN: number = 10
   ): string {
     if (scratchpad.length === 0) return '(Empty - this is your first step)';
     const recentSteps = scratchpad.slice(-trimToLastN);
     return recentSteps.map(entry => {
       let text = `Thought ${entry.step}: ${entry.thought}\n`;
       if (entry.action) {
         text += `Action ${entry.step}: ${entry.action.tool}(${JSON.stringify(entry.action.args)})\n`;
       }
       if (entry.observation) {
         text += `Observation ${entry.step}: ${entry.observation.content}`;
       }
       return text;
     }).join('\n\n---\n\n');
   }
   ```

3. **planner.ts** (lines 1321-1463):
   - `planNextStepV2()` function
   - JSON validation logic
   - Retry with schema hints

4. **observers.ts** (lines 1481-1600):
   - `formatObservationV2()` function
   - `formatStructured()` helper
   - `formatNarrative()` helper
   - `detectDataRetrievalIntent()` function
   - `checkVerbatimShortCircuit()` function

5. **errors.ts** (lines 1698-1783):
   - `analyzeError()` function (7 error types)
   - `ErrorAnalysis` interface

6. **validators.ts** (lines 1795-1827):
   - `detectFailureLoop()` function
   - `FailureTracker` type

7. **telemetry.ts**:
   - New file - wraps audit logging + SSE emission
   - `emitReasoningEvent()` function
   - `createReasoningLogger()` factory

8. **engine.ts** (lines 1903-2113):
   - Extract `runReActLoopV2()` → `ReasoningEngine.run()`
   - Convert to class-based API
   - Add configuration support
   - Add onProgress callback

**Updates to Existing Files**:
- `packages/core/src/index.ts`: Add `export * from './reasoning';`

#### Task 1.2: Implement ReasoningEngine Class

**New File**: `packages/core/src/reasoning/engine.ts`

```typescript
import { getCachedCatalog, invalidateCatalog } from '../tool-catalog';
import { executeSkill } from '../skills';
import { formatScratchpadForLLM } from './scratchpad';
import { planNextStepV2 } from './planner';
import { formatObservationV2, checkVerbatimShortCircuit } from './observers';
import { analyzeError } from './errors';
import { detectFailureLoop } from './validators';
import { emitReasoningEvent } from './telemetry';
import type {
  ReasoningEngineConfig,
  ReasoningResult,
  ReasoningContext,
  ReasoningEvent,
  ScratchpadEntry
} from './types';

export class ReasoningEngine {
  private config: Required<ReasoningEngineConfig>;
  private scratchpad: ScratchpadEntry[] = [];
  private sessionId: string;

  constructor(config: ReasoningEngineConfig) {
    // Apply defaults
    this.config = {
      depth: config.depth || 'focused',
      maxSteps: config.maxSteps || this.getMaxStepsForDepth(config.depth || 'focused'),
      toolCatalog: config.toolCatalog || getCachedCatalog(),
      planningModel: config.planningModel || 'orchestrator',
      responseModel: config.responseModel || 'persona',
      useSingleModel: config.useSingleModel || false,
      scratchpadTrimSize: config.scratchpadTrimSize || 10,
      observationMode: config.observationMode || 'structured',
      enableErrorRetry: config.enableErrorRetry !== false,
      enableFailureLoopDetection: config.enableFailureLoopDetection !== false,
      enableFastPath: config.enableFastPath !== false,
      enableVerbatimShortCircuit: config.enableVerbatimShortCircuit !== false,
      enableScratchpadDump: config.enableScratchpadDump || false,
      verboseErrors: config.verboseErrors || false,
      sessionId: config.sessionId || `session-${Date.now()}`,
      conversationId: config.conversationId,
      userId: config.userId,
    };

    this.sessionId = this.config.sessionId;
  }

  private getMaxStepsForDepth(depth: string): number {
    switch (depth) {
      case 'off': return 1;
      case 'quick': return 5;
      case 'focused': return 10;
      case 'deep': return 15;
      default: return 10;
    }
  }

  async run(
    goal: string,
    context: ReasoningContext = { memories: [], conversationHistory: [] },
    onProgress?: (event: ReasoningEvent) => void
  ): Promise<ReasoningResult> {
    const startTime = Date.now();
    let llmCalls = 0;
    let errors = 0;

    // Fast-path optimization: Check verbatim short-circuit
    if (this.config.enableVerbatimShortCircuit) {
      const verbatimResult = await checkVerbatimShortCircuit(goal, onProgress);
      if (verbatimResult) {
        return {
          goal,
          result: verbatimResult.result,
          scratchpad: [],
          metadata: {
            stepsExecuted: 0,
            fastPathUsed: true,
            verbatimShortCircuit: true,
            totalDuration: Date.now() - startTime,
            llmCalls: 0,
            errors: 0,
          },
        };
      }
    }

    // Initialize scratchpad
    this.scratchpad = [];

    // Main reasoning loop
    let currentStep = 0;
    let completed = false;
    let finalResponse = '';

    while (currentStep < this.config.maxSteps && !completed) {
      currentStep++;

      // Plan next step
      const planning = await planNextStepV2(
        goal,
        { scratchpad: this.scratchpad, maxSteps: this.config.maxSteps, currentStep, completed: false },
        context,
        this.config
      );
      llmCalls++;

      // Create scratchpad entry
      const entry: ScratchpadEntry = {
        step: currentStep,
        thought: planning.thought,
        timestamp: new Date().toISOString(),
      };

      // Emit thought event
      if (onProgress) {
        emitReasoningEvent(onProgress, {
          type: 'thought',
          step: currentStep,
          timestamp: entry.timestamp,
          sessionId: this.sessionId,
          data: { thought: planning.thought },
        });
      }

      // Execute action if present
      if (planning.action && !planning.respond) {
        // Check failure loop
        if (this.config.enableFailureLoopDetection) {
          const loopCheck = detectFailureLoop(this.scratchpad, planning.action);
          if (loopCheck.isLoop) {
            // Inject warning into scratchpad
            entry.observation = {
              mode: 'narrative',
              content: `⚠️ Failure loop detected: ${loopCheck.suggestion}`,
              success: false,
            };
            errors++;
          }
        }

        // Execute skill
        if (!entry.observation) {
          entry.action = planning.action;

          // Emit action event
          if (onProgress) {
            emitReasoningEvent(onProgress, {
              type: 'action',
              step: currentStep,
              timestamp: new Date().toISOString(),
              sessionId: this.sessionId,
              data: {
                tool: planning.action.tool,
                args: planning.action.args,
              },
            });
          }

          try {
            const result = await executeSkill(
              planning.action.tool,
              planning.action.args,
              { sessionId: this.sessionId }
            );
            llmCalls += result.llmCalls || 0;

            // Format observation
            const observation = formatObservationV2(
              planning.action.tool,
              result,
              this.config.observationMode
            );
            entry.observation = observation;

            // Analyze errors
            if (!result.success && this.config.enableErrorRetry) {
              const errorAnalysis = analyzeError(
                planning.action.tool,
                planning.action.args,
                result.error || 'Unknown error'
              );

              if (entry.observation.error) {
                entry.observation.error.code = errorAnalysis.code;
                entry.observation.error.message = errorAnalysis.message;
              }

              // Append suggestions to observation
              if (errorAnalysis.suggestions.length > 0) {
                entry.observation.content += '\n\nSuggestions:\n' +
                  errorAnalysis.suggestions.map(s => `- ${s}`).join('\n');
              }

              errors++;
            }

            // Emit observation event
            if (onProgress) {
              emitReasoningEvent(onProgress, {
                type: 'observation',
                step: currentStep,
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                data: {
                  result: result.outputs,
                  mode: observation.mode,
                  success: observation.success,
                  error: observation.error,
                },
              });
            }
          } catch (error) {
            const errorMessage = (error as Error).message;
            entry.observation = {
              mode: 'narrative',
              content: `❌ Unexpected error: ${errorMessage}`,
              success: false,
              error: { code: 'UNKNOWN_ERROR', message: errorMessage, context: {} },
            };
            errors++;
          }
        }
      }

      // Add to scratchpad
      this.scratchpad.push(entry);

      // Check if we should respond
      if (planning.respond) {
        completed = true;

        // Generate final response
        const observations = this.scratchpad
          .filter(e => e.observation)
          .map(e => e.observation!.content)
          .join('\n\n');

        const responseResult = await executeSkill('conversational_response', {
          context: observations,
          goal: goal,
          style: planning.responseStyle || 'default',
        });
        llmCalls++;

        finalResponse = responseResult.outputs?.response || 'No response generated.';

        // Emit completion event
        if (onProgress) {
          emitReasoningEvent(onProgress, {
            type: 'completion',
            step: currentStep,
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            data: {
              finalResponse,
              metadata: {
                stepsExecuted: currentStep,
                llmCalls,
                totalDuration: Date.now() - startTime,
              },
            },
          });
        }
      }
    }

    // Dump scratchpad if enabled
    if (this.config.enableScratchpadDump) {
      await this.dumpScratchpad();
    }

    return {
      goal,
      result: finalResponse,
      scratchpad: this.scratchpad,
      metadata: {
        stepsExecuted: currentStep,
        fastPathUsed: false,
        verbatimShortCircuit: false,
        totalDuration: Date.now() - startTime,
        llmCalls,
        errors,
      },
    };
  }

  getCatalog(): string {
    return this.config.toolCatalog;
  }

  getScratchpad(): ScratchpadEntry[] {
    return this.scratchpad;
  }

  invalidate(): void {
    this.scratchpad = [];
    invalidateCatalog();
  }

  private async dumpScratchpad(): Promise<void> {
    // Write scratchpad to logs/run/reasoning/<session>.ndjson
    // Implementation details...
  }
}
```

#### Task 1.3: Create Supporting Modules

**observers.ts**:
- Extract from operator-react.ts lines 1481-1600
- Add exports for all observation functions

**planner.ts**:
- Extract from operator-react.ts lines 1321-1463
- Make `planNextStepV2` accept config parameter
- Add tool catalog injection

**errors.ts**:
- Extract from operator-react.ts lines 1698-1783
- Export `analyzeError()` function
- Export `ErrorAnalysis` type

**validators.ts**:
- Extract from operator-react.ts lines 1795-1827
- Export `detectFailureLoop()` function
- Export `FailureTracker` type

**telemetry.ts**:
- New unified event emission system
- Wraps audit logging + SSE + optional file logging

**config.ts**:
- Configuration types and defaults
- Depth → maxSteps mapping
- Model selection logic

#### Task 1.4: Unit Tests

**Files to Create**:
- `packages/core/src/reasoning/reasoning.test.ts`

**Test Coverage**:
1. ReasoningEngine instantiation
2. Scratchpad formatting (trim to N)
3. Observation mode selection
4. Error analysis (7 error types)
5. Failure loop detection (2+ failures)
6. Event emission (mocked callback)
7. Configuration overrides
8. Fast-path optimization

**Success Criteria**:
- ✅ 15+ tests passing
- ✅ 80%+ code coverage
- ✅ All exported functions tested

---

### Phase 2: Integrate with Operator

**Goal**: Replace inline operator logic with ReasoningEngine.

#### Task 2.1: Refactor operator-react.ts

**Changes to `brain/agents/operator-react.ts`**:

1. **Import ReasoningEngine** (top of file):
   ```typescript
   import { ReasoningEngine } from '@metahuman/core/reasoning';
   ```

2. **Update runReActLoopV2()** (lines 1903-2113):
   ```typescript
   async function runReActLoopV2(
     goal: string,
     context: OperatorContext,
     onProgress?: (update: any) => void,
     userContext?: { userId?: string; cognitiveMode?: string }
   ): Promise<any> {
     // Create reasoning engine
     const engine = new ReasoningEngine({
       depth: 'focused', // Could map from reasoningDepth parameter
       sessionId: context.sessionId,
       conversationId: context.conversationId,
       userId: userContext?.userId,
       enableFastPath: true,
       enableVerbatimShortCircuit: true,
       enableErrorRetry: true,
       enableFailureLoopDetection: true,
     });

     // Run reasoning
     const result = await engine.run(
       goal,
       {
         memories: context.memories || [],
         conversationHistory: context.conversationHistory || [],
         cognitiveMode: userContext?.cognitiveMode,
       },
       (event) => {
         // Convert reasoning events to operator progress format
         if (onProgress) {
           onProgress({
             type: event.type,
             data: event.data,
           });
         }
       }
     );

     return {
       goal,
       result: result.result,
       scratchpad: result.scratchpad,
       metadata: result.metadata,
     };
   }
   ```

3. **Update runOperatorWithFeatureFlag()** (lines 2126-2176):
   - Keep feature flag logic
   - Route to new engine-based V2 implementation

4. **Remove Duplicate Code**:
   - Lines 1286-1900 (V2 inline implementation) → replaced by service
   - Keep V1 implementation for now (feature flag fallback)

#### Task 2.2: Update API Endpoints

**Changes to `apps/site/src/pages/api/operator/react.ts`**:

1. Add `reasoningDepth` parameter mapping:
   ```typescript
   const depthMap = {
     0: 'off',
     1: 'quick',
     2: 'focused',
     3: 'deep',
   };
   const depth = depthMap[reasoningDepth] || 'focused';
   ```

2. Pass depth to engine config via operator

**Changes to `apps/site/src/pages/api/persona_chat.ts`**:

1. Map reasoning slider to engine config (lines 534-540)
2. Use unified SSE event format
3. Replace multi-round planner/critic with reasoning engine (optional - Phase 3)

#### Task 2.3: Integration Tests

**Files to Create**:
- `tests/test-reasoning-integration.mjs`

**Test Cases**:
1. Chat query (fast-path)
2. Data query (verbatim mode)
3. Multi-step task (full loop)
4. Error recovery (with suggestions)
5. Failure loop detection
6. Reasoning depth variants (quick/focused/deep)
7. SSE event emission

**Success Criteria**:
- ✅ All integration tests passing
- ✅ V2 + ReasoningEngine produces same results as V2 inline
- ✅ No performance regression

---

### Phase 3: Standardize SSE Events

**Goal**: Unified event format across all reasoning surfaces.

#### Task 3.1: Define Event Schema

**New File**: `packages/core/src/reasoning/events.ts`

```typescript
export interface ReasoningEvent {
  type: 'thought' | 'action' | 'observation' | 'completion' | 'error';
  step: number;
  timestamp: string; // ISO 8601
  sessionId: string;
  conversationId?: string;

  data: {
    // Thought events
    thought?: string;

    // Action events
    tool?: string;
    args?: Record<string, any>;

    // Observation events
    result?: any;
    mode?: 'narrative' | 'structured' | 'verbatim';
    success?: boolean;

    // Error events
    error?: {
      code: string;
      message: string;
      suggestions?: string[];
      context?: any;
    };

    // Completion events
    finalResponse?: string;
    metadata?: {
      stepsExecuted: number;
      llmCalls: number;
      totalDuration: number;
    };
  };
}

export function formatSSE(event: ReasoningEvent): string {
  return `event: reasoning\ndata: ${JSON.stringify(event)}\n\n`;
}
```

#### Task 3.2: Update Telemetry Module

**Changes to `packages/core/src/reasoning/telemetry.ts`**:

1. Implement `emitReasoningEvent()`:
   ```typescript
   export function emitReasoningEvent(
     callback: (event: ReasoningEvent) => void,
     event: ReasoningEvent
   ): void {
     // Send to callback (SSE)
     callback(event);

     // Log to audit trail
     audit({
       level: 'info',
       category: 'action',
       event: `reasoning_${event.type}`,
       details: {
         step: event.step,
         sessionId: event.sessionId,
         ...event.data,
       },
       actor: 'reasoning_engine',
     });

     // Optional: Write to reasoning-specific log
     // logs/run/reasoning/<session>.ndjson
   }
   ```

#### Task 3.3: Update UI Components

**Changes to `apps/site/src/components/ChatInterface.svelte`**:

1. Update SSE event handler (lines 628-660):
   ```typescript
   if (event.type === 'reasoning') {
     const reasoningEvent = JSON.parse(event.data) as ReasoningEvent;

     // Display based on event type
     switch (reasoningEvent.type) {
       case 'thought':
         thinkingStages.push({
           stage: 'Thinking',
           content: reasoningEvent.data.thought,
           round: reasoningEvent.step,
         });
         break;
       case 'action':
         thinkingStages.push({
           stage: 'Acting',
           content: `Using ${reasoningEvent.data.tool}`,
           round: reasoningEvent.step,
         });
         break;
       case 'observation':
         thinkingStages.push({
           stage: 'Observing',
           content: reasoningEvent.data.success ? 'Success' : 'Error',
           round: reasoningEvent.step,
         });
         break;
       case 'completion':
         thinkingStages.push({
           stage: 'Complete',
           content: `${reasoningEvent.data.metadata?.stepsExecuted} steps`,
           round: reasoningEvent.step,
         });
         break;
     }
   }
   ```

2. Add scratchpad visualization option:
   - Toggle to show full thought/action/observation trace
   - Display structured scratchpad (not just stages)

**Changes to `apps/site/src/components/Thinking.svelte`**:
- Update to handle new event format
- Show more detail (tool names, error suggestions)

#### Task 3.4: Testing

**Test Cases**:
1. SSE events match schema
2. All event types emitted correctly
3. UI displays events properly
4. Audit logs contain reasoning events
5. Reasoning log files created (if enabled)

**Success Criteria**:
- ✅ Unified event format across all agents
- ✅ UI displays reasoning stages correctly
- ✅ Audit trail includes all reasoning events

---

### Phase 4: Extend to Other Agents (Optional)

**Goal**: Enable reasoning service reuse by reflector, dreamer, and CLI.

#### Task 4.1: Reflector Integration (Optional)

**Changes to `brain/agents/reflector.ts`**:

Option 1: **Minimal Integration** (Just Tool Catalog)
- Use `getCachedCatalog()` for keyword extraction
- Keep existing associative chain logic
- No ReasoningEngine dependency

Option 2: **Full Integration** (ReasoningEngine for Reflection)
- Use ReasoningEngine for multi-step reflection generation
- Tool: `keyword_extract`, `memory_search`, `reflection_generate`
- Benefit: Structured reasoning for reflection steps

**Recommendation**: Start with Option 1 (minimal), evaluate Option 2 later.

#### Task 4.2: Dreamer Integration (Optional)

**Changes to `brain/agents/dreamer.ts`**:

Option 1: **Planner for Extraction**
- Use ReasoningEngine for learning extraction (lines 229-293)
- Replace ad-hoc JSON prompts with structured planner
- Benefit: Automatic retry on invalid JSON

Option 2: **Full Integration**
- Use ReasoningEngine for entire dream cycle
- Tools: `memory_curate`, `dream_generate`, `learning_extract`

**Recommendation**: Start with Option 1 (extraction only).

#### Task 4.3: CLI Integration

**New CLI Command**: `mh task diagnose <task-id>`

Uses ReasoningEngine to:
1. Load task details
2. Search for related memories
3. Identify blockers
4. Suggest next steps

**Implementation**:
```typescript
import { ReasoningEngine } from '@metahuman/core/reasoning';

export async function diagnoseTask(taskId: string): Promise<void> {
  const engine = new ReasoningEngine({
    depth: 'focused',
    enableVerbatimShortCircuit: false,
  });

  const result = await engine.run(
    `Diagnose task ${taskId} and suggest next steps`,
    { memories: [], conversationHistory: [] },
    (event) => {
      // Show progress in terminal
      if (event.type === 'thought') {
        console.log(`🤔 ${event.data.thought}`);
      } else if (event.type === 'action') {
        console.log(`⚡ ${event.data.tool}`);
      }
    }
  );

  console.log('\n' + result.result);
}
```

**Success Criteria**:
- ✅ CLI can use reasoning engine
- ✅ Progress shown in terminal
- ✅ Diagnostic results useful

---

### Phase 5: Cleanup and Deprecation

**Goal**: Remove legacy code and consolidate to single implementation.

#### Task 5.1: Remove Legacy Operator Code

**Files to Delete**:
- `brain/agents/operator.ts` (if exists)
- `brain/agents/operator-legacy.ts` (if exists)

**Files to Update**:
- `brain/agents/operator-react.ts`: Remove V1 implementation (lines 203-1285)
- Remove feature flag routing (lines 2126-2176)
- Update exports to only expose engine-based API

#### Task 5.2: Deprecate Ad-Hoc Reasoning

**Changes to `apps/site/src/pages/api/persona_chat.ts`**:
- Remove multi-round planner/critic (lines 1139-1264)
- Replace with ReasoningEngine
- Map reasoning depth to engine config

**Changes to Agents**:
- Standardize all reasoning on ReasoningEngine
- Remove duplicate prompt logic

#### Task 5.3: Documentation Updates

**Files to Update**:
- `CLAUDE.md`: Add reasoning service section
- `docs/implementation-plans/reasoning-service.md`: Mark as complete
- Create `docs/user-guide/reasoning-system.md`: User-facing guide

**Documentation Topics**:
1. Reasoning depth explained (off/quick/focused/deep)
2. When to use each depth
3. How to interpret reasoning traces
4. Configuration options
5. CLI commands using reasoning
6. Troubleshooting

#### Task 5.4: Performance Benchmarking

**Metrics to Collect**:
1. Average latency by depth (quick/focused/deep)
2. LLM calls per query
3. Fast-path hit rate
4. Verbatim short-circuit rate
5. Error recovery success rate

**Tools**:
- Create `tests/benchmark-reasoning.sh`
- Run on 100 sample queries
- Compare V1 vs V2 vs ReasoningEngine

**Success Criteria**:
- ✅ ReasoningEngine ≤ 5% slower than inline V2
- ✅ Fast-path saves ≥ 30% of LLM calls
- ✅ Error recovery works in ≥ 70% of cases

---

## Migration Strategy

### Feature Flags

**New Flag**: `reasoning.useService` (in `etc/runtime.json`)

```json
{
  "reasoning": {
    "useService": false,  // Toggle to enable new service
    "depth": "focused",   // Default depth
    "enableFastPath": true,
    "enableVerbatimShortCircuit": true
  }
}
```

### Rollout Plan

**Week 1**: Phase 0 + Phase 1
- Validate V2 implementation
- Extract reasoning service
- Create unit tests

**Week 2**: Phase 2
- Integrate with operator
- Run integration tests
- Monitor for regressions

**Week 3**: Phase 3
- Standardize SSE events
- Update UI components
- Test event flow

**Week 4**: Phase 4 (Optional)
- Extend to other agents
- CLI integration

**Week 5**: Phase 5
- Cleanup legacy code
- Documentation
- Performance benchmarking

### Rollback Plan

If issues arise:
1. Set `reasoning.useService: false` in config
2. Falls back to inline V2 implementation
3. No code changes required

---

## Testing Strategy

### Unit Tests

**Module**: `packages/core/src/reasoning/`
- Test each function in isolation
- Mock LLM calls
- Mock skill execution
- Coverage: 80%+

**Files**:
- `reasoning.test.ts` (engine)
- `scratchpad.test.ts` (formatting)
- `planner.test.ts` (JSON validation)
- `observers.test.ts` (observation modes)
- `errors.test.ts` (error analysis)
- `validators.test.ts` (failure detection)

### Integration Tests

**Module**: `tests/`
- Test end-to-end reasoning flows
- Real LLM calls (with mocked responses for speed)
- Real skill execution

**Files**:
- `test-reasoning-integration.mjs` (15+ tests)
- `test-reasoning-operator.mjs` (operator-specific)
- `test-reasoning-events.mjs` (SSE events)

### Manual Testing

**Test Cases**:
1. Chat queries (fast-path)
2. Data queries (verbatim)
3. Multi-step tasks
4. Error scenarios
5. Failure loops
6. Reasoning depth variants
7. UI reasoning slider
8. SSE event display

**Environments**:
- Development (localhost)
- Production (with feature flag)

### Performance Testing

**Benchmarks**:
- Latency: P50, P95, P99
- LLM calls per query
- Token usage
- Fast-path hit rate
- Error recovery rate

**Tools**:
- `tests/benchmark-reasoning.sh`
- 100 sample queries
- Compare before/after

---

## Success Criteria

### Phase 0: V2 Validation
- ✅ All 18 tests passing
- ✅ V2 produces same or better results than V1
- ✅ No regressions in performance

### Phase 1: Service Extraction
- ✅ Reasoning service module created
- ✅ 15+ unit tests passing
- ✅ 80%+ code coverage
- ✅ All V2 features preserved

### Phase 2: Operator Integration
- ✅ Operator uses ReasoningEngine
- ✅ Integration tests passing (15+)
- ✅ Feature flag works (toggle V1/V2/Service)
- ✅ No performance regression

### Phase 3: Event Standardization
- ✅ Unified SSE event schema
- ✅ UI displays reasoning correctly
- ✅ Audit logs complete
- ✅ Event tests passing

### Phase 4: Agent Extension (Optional)
- ✅ At least 1 other agent uses service (dreamer or reflector)
- ✅ CLI reasoning command works
- ✅ No regressions in agent behavior

### Phase 5: Cleanup
- ✅ Legacy code removed
- ✅ Documentation complete
- ✅ Performance benchmarks meet targets
- ✅ All tests passing (40+ total)

---

## Risk Mitigation

### Risk 1: Performance Regression

**Mitigation**:
- Feature flag for easy rollback
- Continuous benchmarking
- Fast-path optimizations preserved
- Monitor latency in production

### Risk 2: Breaking Changes

**Mitigation**:
- Keep V1 code intact during migration
- Feature flag toggle
- Comprehensive integration tests
- Gradual rollout (per-user or percentage)

### Risk 3: Event Format Incompatibility

**Mitigation**:
- Version SSE events (`version: '2.0'`)
- Support legacy format during transition
- Update UI components incrementally

### Risk 4: Agent Behavior Changes

**Mitigation**:
- Extensive testing before migration
- Monitor audit logs for anomalies
- User feedback loop (beta users)
- A/B testing (V1 vs V2 vs Service)

---

## Open Questions

1. **Should we migrate persona_chat's multi-round planner/critic to ReasoningEngine?**
   - Pro: Unified reasoning across all surfaces
   - Con: More complex, higher risk
   - **Decision**: Phase 3 optional task, evaluate after Phase 2

2. **Should reflector/dreamer use full ReasoningEngine or just parts?**
   - Pro (full): Structured reasoning for all agents
   - Con (full): Overhead, may not fit agent patterns
   - **Decision**: Start with partial (tool catalog), evaluate later

3. **Should reasoning logs be separate from audit logs?**
   - Pro: Cleaner separation, easier to analyze
   - Con: More complexity, duplicate info
   - **Decision**: Unified telemetry module handles both

4. **Should we support multiple reasoning models (small/large)?**
   - Pro: Optimize cost/latency per depth
   - Con: More complexity, model management
   - **Decision**: Phase 5 enhancement (not MVP)

---

## Next Steps

1. **Review and Approve Plan**: Share with team, get feedback
2. **Create Tickets**: Break down into GitHub issues
3. **Phase 0: Validate V2**: Enable feature flag, run tests
4. **Phase 1: Extract Service**: Create reasoning module
5. **Phase 2: Operator Integration**: Replace inline logic
6. **Phase 3: Standardize Events**: Unified SSE format
7. **Phase 4: Extend Agents** (optional): Reflector/Dreamer/CLI
8. **Phase 5: Cleanup**: Remove legacy, document, benchmark

---

## Appendix A: File Structure

```
packages/core/src/reasoning/
├── index.ts              # Public API exports
├── types.ts              # TypeScript interfaces
├── config.ts             # Configuration management
├── engine.ts             # ReasoningEngine class
├── scratchpad.ts         # Scratchpad formatting
├── planner.ts            # Planning logic (LLM + validation)
├── observers.ts          # Observation formatting (3 modes)
├── errors.ts             # Error analysis + suggestions
├── validators.ts         # Failure loop detection
├── telemetry.ts          # Event emission (SSE + audit + logs)
├── events.ts             # SSE event schema
├── reasoning.test.ts     # Unit tests (engine)
├── scratchpad.test.ts    # Unit tests (scratchpad)
├── planner.test.ts       # Unit tests (planner)
├── observers.test.ts     # Unit tests (observers)
├── errors.test.ts        # Unit tests (errors)
└── validators.test.ts    # Unit tests (validators)

tests/
├── test-reasoning-integration.mjs      # Integration tests (15+)
├── test-reasoning-operator.mjs         # Operator-specific tests
├── test-reasoning-events.mjs           # SSE event tests
└── benchmark-reasoning.sh              # Performance benchmarks

docs/
├── implementation-plans/
│   ├── reasoning-service.md            # Original plan (now reference)
│   └── reasoning-service-consolidation-PLAN.md  # This file
└── user-guide/
    └── reasoning-system.md             # User-facing guide
```

---

## Appendix B: Code Size Estimates

| Module | Lines of Code | Complexity |
|--------|---------------|------------|
| types.ts | 150 | Low |
| config.ts | 100 | Low |
| scratchpad.ts | 80 | Low |
| planner.ts | 200 | Medium |
| observers.ts | 250 | Medium |
| errors.ts | 150 | Low |
| validators.ts | 100 | Low |
| telemetry.ts | 150 | Medium |
| events.ts | 80 | Low |
| engine.ts | 400 | High |
| **Total Core** | **1,660** | - |
| Unit tests | 600 | - |
| Integration tests | 400 | - |
| **Total Tests** | **1,000** | - |
| **Grand Total** | **2,660** | - |

**Comparison**: Operator V2 refactor was ~1,250 LOC. Reasoning service consolidation is ~2x larger due to:
- Extraction + generalization (not just operator)
- Comprehensive testing
- Event standardization
- Documentation

---

## Appendix C: Performance Targets

| Metric | Current (V2 Inline) | Target (Service) | Tolerance |
|--------|---------------------|------------------|-----------|
| Chat latency (P50) | 200ms | 210ms | +5% |
| Data query latency (P50) | 150ms | 160ms | +7% |
| Multi-step latency (P50) | 2.5s | 2.6s | +4% |
| LLM calls (chat) | 1 | 1 | 0% |
| LLM calls (data) | 0 | 0 | 0% |
| LLM calls (multi-step) | 5 | 5 | 0% |
| Fast-path hit rate | 60% | 60% | ±5% |
| Error recovery rate | 70% | 75% | +5% |

**Notes**:
- Service should be ≤5% slower than inline implementation
- Fast-path optimizations must be preserved
- Error recovery should improve (better suggestions)

---

**End of Plan**

**Next Action**: Review with team, create GitHub issues, begin Phase 0 validation.
