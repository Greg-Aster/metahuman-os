# Reactive Operator Refactor - Complete Implementation Plan

**Status**: Ready for Implementation
**Estimated Timeline**: 15-20 working days (3-4 weeks)
**Last Updated**: 2025-11-11

---

## Executive Summary

This document provides a comprehensive, step-by-step implementation plan for refactoring the MetaHuman OS reactive operator system. The refactor addresses three critical goals:

1. **Eliminate hallucinated responses** by forcing strict citation of tool outputs
2. **Enable intelligent tool chaining** with structured ReAct scratchpad
3. **Implement error-aware retries** with automatic recovery suggestions

The plan is organized into 9 phases with clear dependencies, concrete tasks, and success criteria for each phase.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architecture Overview](#architecture-overview)
3. [Phase-by-Phase Implementation](#phase-by-phase-implementation)
4. [Testing Strategy](#testing-strategy)
5. [Risk Mitigation](#risk-mitigation)
6. [Success Criteria](#success-criteria)
7. [Appendix](#appendix)

---

## Current State Analysis

### What Exists Today

**Operator Implementation** (`brain/agents/operator-react.ts`)
- ✅ Basic ReAct loop with max 10 iterations
- ✅ Fast-path optimization for pure conversation
- ✅ Skill execution with trust level checks
- ✅ Observation formatting (narrative style)
- ✅ Streaming progress to web UI
- ✅ Multi-user context support via `withUserContext()`
- ✅ Cognitive mode integration

**Skills System** (`packages/core/src/skills.ts`, `brain/skills/`)
- ✅ 25 registered skills across 6 categories
- ✅ Manifest-based skill discovery
- ✅ Approval queue for high-risk operations
- ✅ Trust level filtering

**LLM Integration** (`packages/core/src/model-router.ts`)
- ✅ Role-based model selection (orchestrator, persona, curator, etc.)
- ✅ Cognitive mode routing
- ✅ Comprehensive audit logging
- ✅ LoRA adapter support

### What's Missing (Gaps to Address)

**Operator Gaps**
- ❌ No tool catalog caching - skills listed ad-hoc in prompts
- ❌ Weak scratchpad structure - narrative observations, not structured reasoning
- ❌ No verbatim response mode - always synthesizes via LLM
- ❌ No error retry logic - fails after max iterations
- ❌ No scratchpad trimming - can hit token limits on long chains

**Skills Gaps**
- ❌ No standardized observation templates (verbatim vs narrative)
- ❌ No response style parameter for `conversational_response`

**Configuration Gaps**
- ❌ No feature flags for gradual rollout
- ❌ No operator-specific configuration file
- ❌ No debug scratchpad logging

---

## Architecture Overview

### New Component: Tool Catalog

```typescript
// packages/core/src/tool-catalog.ts

interface ToolCatalogEntry {
  skill: string;
  description: string;
  inputs: string; // Concise input schema
  outputs: string; // Expected output format
  category: string;
  notes: string; // Usage hints
}

function buildToolCatalog(): string;
function getCachedCatalog(): string; // 1-minute TTL
```

**Purpose**: Generate LLM-friendly skill documentation from manifests, cached per process.

### Enhanced Scratchpad Structure

```typescript
interface ScratchpadEntry {
  step: number;
  thought: string; // LLM reasoning
  action?: {
    tool: string;
    args: Record<string, any>;
  };
  observation?: {
    mode: 'narrative' | 'structured' | 'verbatim';
    content: string;
    success: boolean;
    error?: { code: string; message: string; context: any };
  };
  timestamp: string;
}

interface PlanningResponse {
  thought: string; // Required reasoning step
  action?: { tool: string; args: Record<string, any> }; // Optional tool call
  respond?: boolean; // Signal completion
  responseStyle?: 'default' | 'strict' | 'summary'; // How to format final response
}
```

### Observation Modes

1. **Narrative** (default): Human-readable summary with counts/previews
2. **Structured**: Bullet list or JSON using only tool outputs (no embellishment)
3. **Verbatim**: Raw pretty-printed tool payload (for "list tasks" type queries)

### Error Recovery Flow

```
1. Skill execution fails
   ↓
2. Record error in scratchpad with full context
   ↓
3. Check for repeated failures (same action 2+ times)
   ↓
4. If repeated: Surface alternative suggestions
   ↓
5. LLM sees error + suggestions, plans next step
   ↓
6. Retry with new approach or ask user for guidance
```

---

## Phase-by-Phase Implementation

### Phase 1: Tool Catalog Builder

**Goal**: Create reusable, cached skill documentation for LLM prompts

**Duration**: 2-3 days

#### Tasks

**1.1 Create Tool Catalog Module**

File: `packages/core/src/tool-catalog.ts`

```typescript
import { listSkills } from './skills.js';
import type { SkillManifest } from './types/skills.js';

interface ToolCatalogEntry {
  skill: string;
  description: string;
  inputs: string;
  outputs: string;
  category: string;
  notes: string;
}

// Cache with 1-minute TTL
let catalogCache: { text: string; timestamp: number } | null = null;
const CACHE_TTL_MS = 60000;

/**
 * Format a single skill manifest for LLM consumption
 */
function formatSkillForLLM(manifest: SkillManifest): string {
  const inputDesc = Object.entries(manifest.inputs)
    .map(([name, def]) => `${name}${def.required ? '*' : ''}: ${def.type}`)
    .join(', ');

  const outputDesc = Object.entries(manifest.outputs)
    .map(([name, def]) => `${name}: ${def.type}`)
    .join(', ');

  return `Skill: ${manifest.id}
Description: ${manifest.description}
Inputs: ${inputDesc || 'none'}
Outputs: ${outputDesc || 'generic result'}
Category: ${manifest.category}
Risk: ${manifest.risk} | Cost: ${manifest.cost}
Notes: Requires ${manifest.minTrustLevel} trust level${manifest.requiresApproval ? ' (approval required)' : ''}`;
}

/**
 * Build complete tool catalog from all registered skills
 */
export function buildToolCatalog(): string {
  const skills = listSkills();
  const entries = skills.map(formatSkillForLLM);

  return `# Available Tools

You have access to ${skills.length} skills across these categories:

${entries.join('\n\n---\n\n')}

IMPORTANT: Only use data from tool observations. Never invent or assume outputs.`;
}

/**
 * Get cached catalog (1-minute TTL)
 */
export function getCachedCatalog(): string {
  const now = Date.now();

  if (catalogCache && (now - catalogCache.timestamp) < CACHE_TTL_MS) {
    return catalogCache.text;
  }

  const text = buildToolCatalog();
  catalogCache = { text, timestamp: now };
  return text;
}

/**
 * Force catalog rebuild (for testing/development)
 */
export function invalidateCatalog(): void {
  catalogCache = null;
}
```

**1.2 Update Core Exports**

File: `packages/core/src/index.ts`

```typescript
// Add to exports:
export { buildToolCatalog, getCachedCatalog, invalidateCatalog } from './tool-catalog.js';
```

**1.3 Add Unit Tests**

File: `packages/core/src/tool-catalog.spec.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCatalog, getCachedCatalog, invalidateCatalog } from './tool-catalog.js';

describe('Tool Catalog', () => {
  beforeEach(() => {
    invalidateCatalog();
  });

  it('should build catalog with all skills', () => {
    const catalog = buildToolCatalog();
    expect(catalog).toContain('# Available Tools');
    expect(catalog).toContain('Skill: task_list');
    expect(catalog).toContain('Skill: fs_read');
  });

  it('should cache catalog for 1 minute', () => {
    const first = getCachedCatalog();
    const second = getCachedCatalog();
    expect(first).toBe(second); // Same instance
  });

  it('should include required field markers', () => {
    const catalog = buildToolCatalog();
    expect(catalog).toMatch(/\w+\*:/); // Required fields marked with *
  });
});
```

#### Success Criteria
- ✅ Tool catalog generates successfully from all 25 skills
- ✅ Catalog includes all required fields (inputs, outputs, notes)
- ✅ Caching works (second call returns same instance within 1 minute)
- ✅ Unit tests pass

#### Files Modified
- **New**: `packages/core/src/tool-catalog.ts`
- **New**: `packages/core/src/tool-catalog.spec.ts`
- **Modified**: `packages/core/src/index.ts`

---

### Phase 2: Scratchpad Structure & Planning

**Goal**: Implement structured ReAct scratchpad with explicit Thought→Action→Observation blocks

**Duration**: 3-4 days

#### Tasks

**2.1 Add Scratchpad Types**

File: `brain/agents/operator-react.ts`

```typescript
// Add near top of file (after imports)

interface ScratchpadEntry {
  step: number;
  thought: string;
  action?: {
    tool: string;
    args: Record<string, any>;
  };
  observation?: {
    mode: 'narrative' | 'structured' | 'verbatim';
    content: string;
    success: boolean;
    error?: {
      code: string;
      message: string;
      context: any;
    };
  };
  timestamp: string;
}

interface PlanningResponse {
  thought: string; // Required reasoning about current state
  action?: {
    tool: string;
    args: Record<string, any>;
  }; // Optional tool to invoke
  respond?: boolean; // True when ready to respond to user
  responseStyle?: 'default' | 'strict' | 'summary'; // How to format response
}

interface ReactState {
  scratchpad: ScratchpadEntry[];
  maxSteps: number;
  currentStep: number;
  completed: boolean;
  finalResponse?: string;
}
```

**2.2 Refactor planNextStep() Function**

Replace existing `planNextStep()` (lines 388-506) with enhanced version:

```typescript
import { getCachedCatalog } from '@metahuman/core';

async function planNextStep(
  goal: string,
  state: ReactState,
  context: OperatorContext,
  userContext: UserContext
): Promise<PlanningResponse> {
  // Build structured scratchpad prompt
  const scratchpadText = formatScratchpadForLLM(state.scratchpad);
  const toolCatalog = getCachedCatalog();

  const systemPrompt = `You are an autonomous agent using a ReAct (Reason-Act-Observe) pattern to help the user.

${toolCatalog}

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

## Current Scratchpad

${scratchpadText}

## User Goal

${goal}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Plan the next step. Return valid JSON only.' }
  ];

  // Use orchestrator model for planning
  const response = await callLLM({
    role: 'orchestrator',
    messages,
    options: {
      temperature: 0.1,
      format: 'json' // Enforce JSON mode
    },
    cognitiveMode: userContext.cognitiveMode,
    userId: userContext.userId
  });

  // Parse and validate response
  try {
    const planning = JSON.parse(response.content) as PlanningResponse;

    // Validate required fields
    if (!planning.thought) {
      throw new Error('Planning response missing required "thought" field');
    }

    if (planning.action && (!planning.action.tool || !planning.action.args)) {
      throw new Error('Planning action missing "tool" or "args" field');
    }

    return planning;
  } catch (parseError) {
    // Retry once with schema hint
    audit({
      category: 'system',
      level: 'warn',
      message: 'Planning JSON parse failed, retrying with schema hint',
      metadata: { error: parseError.message, response: response.content }
    });

    return retryPlanningWithHint(goal, state, context, userContext, response.content);
  }
}

/**
 * Format scratchpad for LLM consumption
 */
function formatScratchpadForLLM(scratchpad: ScratchpadEntry[]): string {
  if (scratchpad.length === 0) {
    return '(Empty - this is your first step)';
  }

  // Trim to last 10 steps to manage token limits
  const recentSteps = scratchpad.slice(-10);

  return recentSteps.map(entry => {
    let text = `Thought ${entry.step}: ${entry.thought}\n`;

    if (entry.action) {
      text += `Action ${entry.step}: ${entry.action.tool}(${JSON.stringify(entry.action.args)})\n`;
    }

    if (entry.observation) {
      if (entry.observation.success) {
        text += `Observation ${entry.step}: ${entry.observation.content}`;
      } else {
        text += `Observation ${entry.step}: ❌ ERROR - ${entry.observation.error?.message}`;
      }
    }

    return text;
  }).join('\n\n---\n\n');
}

/**
 * Retry planning with explicit schema hint
 */
async function retryPlanningWithHint(
  goal: string,
  state: ReactState,
  context: OperatorContext,
  userContext: UserContext,
  invalidResponse: string
): Promise<PlanningResponse> {
  const messages = [
    {
      role: 'system',
      content: `Your previous response was invalid JSON. Please provide a response matching this exact schema:

{
  "thought": "string - your reasoning",
  "action": { "tool": "string", "args": {} },  // Optional
  "respond": boolean,  // Optional, default false
  "responseStyle": "default" | "strict" | "summary"  // Optional
}

Previous invalid response:
${invalidResponse}`
    },
    { role: 'user', content: `Goal: ${goal}\n\nProvide valid JSON following the schema above.` }
  ];

  const response = await callLLM({
    role: 'orchestrator',
    messages,
    options: { temperature: 0.05, format: 'json' }
  });

  const planning = JSON.parse(response.content) as PlanningResponse;

  if (!planning.thought) {
    throw new Error('Retry failed: still missing "thought" field');
  }

  return planning;
}
```

**2.3 Update Main ReAct Loop**

Refactor `runReActLoop()` to use new scratchpad structure:

```typescript
async function runReActLoop(
  goal: string,
  context: OperatorContext,
  onProgress?: (update: OperatorUpdate) => void,
  userContext: UserContext = {}
): Promise<OperatorResult> {
  const state: ReactState = {
    scratchpad: [],
    maxSteps: 10,
    currentStep: 0,
    completed: false
  };

  // Check for fast-path pure conversation (preserve existing logic)
  const fastPath = await checkFastPath(goal, context, userContext);
  if (fastPath) {
    return fastPath;
  }

  while (state.currentStep < state.maxSteps && !state.completed) {
    state.currentStep++;

    // Plan next step
    const planning = await planNextStep(goal, state, context, userContext);

    // Create scratchpad entry
    const entry: ScratchpadEntry = {
      step: state.currentStep,
      thought: planning.thought,
      timestamp: new Date().toISOString()
    };

    // Stream thought to UI
    onProgress?.({
      type: 'thought',
      content: planning.thought,
      step: state.currentStep
    });

    // Execute action if present
    if (planning.action && !planning.respond) {
      entry.action = planning.action;

      const result = await executeSkillWithErrorHandling(
        planning.action.tool,
        planning.action.args,
        userContext
      );

      entry.observation = {
        mode: 'narrative', // Will be enhanced in Phase 3
        content: result.content,
        success: result.success,
        error: result.error
      };

      // Stream action + observation to UI
      onProgress?.({
        type: 'action',
        tool: planning.action.tool,
        args: planning.action.args,
        step: state.currentStep
      });

      onProgress?.({
        type: 'observation',
        content: result.content,
        success: result.success,
        step: state.currentStep
      });
    }

    state.scratchpad.push(entry);

    // Check for completion
    if (planning.respond) {
      state.completed = true;

      // Generate final response (will be enhanced in Phase 3)
      const finalResponse = await generateFinalResponse(
        goal,
        state,
        planning.responseStyle || 'default',
        userContext
      );

      state.finalResponse = finalResponse;

      onProgress?.({
        type: 'completion',
        content: finalResponse,
        step: state.currentStep
      });
    }
  }

  return {
    goal,
    result: state.finalResponse || 'Max iterations reached without completion',
    reasoning: state.scratchpad.map(e => e.thought).join(' → '),
    actions: state.scratchpad.filter(e => e.action).map(e => e.action!.tool),
    scratchpad: state.scratchpad // Include for debugging
  };
}
```

#### Success Criteria
- ✅ Tool catalog injected into planning prompts
- ✅ Scratchpad formatted with explicit Thought/Action/Observation blocks
- ✅ JSON validation with retry logic works
- ✅ Scratchpad trimmed to last 10 steps
- ✅ Planning uses `orchestrator` model
- ✅ Existing fast-path logic preserved

#### Files Modified
- **Modified**: `brain/agents/operator-react.ts` (major refactor)

---

### Phase 3: Observation Modes

**Goal**: Add verbatim and structured observation formatting to enable raw data responses

**Duration**: 2-3 days

#### Tasks

**3.1 Enhance formatObservation() Function**

```typescript
type ObservationMode = 'narrative' | 'structured' | 'verbatim';

interface ObservationResult {
  mode: ObservationMode;
  content: string;
  success: boolean;
  error?: { code: string; message: string; context: any };
}

/**
 * Format tool execution result based on mode
 */
function formatObservation(
  tool: string,
  result: SkillResult,
  mode: ObservationMode = 'narrative'
): ObservationResult {
  if (!result.success) {
    return {
      mode,
      content: `Error executing ${tool}: ${result.error || 'Unknown error'}`,
      success: false,
      error: {
        code: 'SKILL_ERROR',
        message: result.error || 'Unknown error',
        context: { tool, result }
      }
    };
  }

  switch (mode) {
    case 'verbatim':
      return {
        mode,
        content: JSON.stringify(result.outputs, null, 2),
        success: true
      };

    case 'structured':
      return {
        mode,
        content: formatStructured(tool, result),
        success: true
      };

    case 'narrative':
    default:
      return {
        mode,
        content: formatNarrative(tool, result),
        success: true
      };
  }
}

/**
 * Format observation as structured data (bullet lists/JSON)
 */
function formatStructured(tool: string, result: SkillResult): string {
  switch (tool) {
    case 'task_list': {
      const tasks = result.outputs.tasks || [];
      if (tasks.length === 0) return '• No tasks found';

      return tasks.map((t: any) =>
        `• [${t.status}] ${t.title} (${t.priority})`
      ).join('\n');
    }

    case 'fs_list': {
      const files = result.outputs.files || [];
      const dirs = result.outputs.directories || [];

      let text = '';
      if (dirs.length > 0) text += `Directories (${dirs.length}):\n${dirs.map((d: string) => `  📁 ${d}`).join('\n')}\n`;
      if (files.length > 0) text += `Files (${files.length}):\n${files.map((f: string) => `  📄 ${f}`).join('\n')}`;

      return text || '(empty directory)';
    }

    case 'fs_read': {
      const content = result.outputs.content || '';
      return `File size: ${content.length} chars\n\nContent:\n${content}`;
    }

    default:
      // Generic structured format
      return Object.entries(result.outputs)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
  }
}

/**
 * Format observation as narrative (existing logic)
 */
function formatNarrative(tool: string, result: SkillResult): string {
  // Keep existing narrative formatting logic from current implementation
  // (Lines 789-888 in current operator-react.ts)
  // ... existing code ...
}
```

**3.2 Add Intent Detection for Data Queries**

```typescript
/**
 * Detect if query is purely data retrieval (should use verbatim mode)
 */
function detectDataRetrievalIntent(goal: string): boolean {
  const dataKeywords = [
    'list', 'show', 'what tasks', 'display', 'read file',
    'get', 'fetch', 'retrieve', 'search for', 'find all'
  ];

  const goalLower = goal.toLowerCase();
  return dataKeywords.some(keyword => goalLower.includes(keyword));
}

/**
 * Check if we can short-circuit with verbatim response
 */
async function checkVerbatimShortCircuit(
  goal: string,
  context: OperatorContext,
  userContext: UserContext
): Promise<OperatorResult | null> {
  if (!detectDataRetrievalIntent(goal)) {
    return null; // Not a data query
  }

  // Simple heuristic: if goal mentions "tasks", try task_list
  if (goal.toLowerCase().includes('task')) {
    const result = await executeSkill('task_list', { includeCompleted: false }, userContext);

    if (result.success) {
      const observation = formatObservation('task_list', result, 'structured');

      return {
        goal,
        result: observation.content,
        reasoning: 'Direct task list retrieval (verbatim mode)',
        actions: ['task_list'],
        verbatim: true
      };
    }
  }

  // Could add more heuristics for other common queries
  return null;
}
```

**3.3 Integrate into Main Loop**

```typescript
async function runReActLoop(
  goal: string,
  context: OperatorContext,
  onProgress?: (update: OperatorUpdate) => void,
  userContext: UserContext = {}
): Promise<OperatorResult> {
  // Check for verbatim short-circuit FIRST
  const verbatimResult = await checkVerbatimShortCircuit(goal, context, userContext);
  if (verbatimResult) {
    onProgress?.({ type: 'completion', content: verbatimResult.result, step: 0 });
    return verbatimResult;
  }

  // Check fast-path pure conversation
  const fastPath = await checkFastPath(goal, context, userContext);
  if (fastPath) {
    return fastPath;
  }

  // Continue with full ReAct loop...
  // (rest of loop logic from Phase 2)
}
```

#### Success Criteria
- ✅ `formatObservation()` supports all three modes
- ✅ Structured mode produces clean bullet lists (no embellishment)
- ✅ Verbatim mode returns raw JSON
- ✅ Intent detection catches "list tasks" type queries
- ✅ Short-circuit path works for common data queries
- ✅ Narrative mode preserves existing behavior

#### Files Modified
- **Modified**: `brain/agents/operator-react.ts`

---

### Phase 4: Conversational Response Enhancement

**Goal**: Add response style parameter to prevent hallucinations in final synthesis

**Duration**: 1 day

#### Tasks

**4.1 Update conversational_response Skill**

File: `brain/skills/conversational_response.ts`

```typescript
// Update manifest
export const manifest: SkillManifest = {
  id: 'conversational_response',
  name: 'Conversational Response',
  description: 'Synthesize a conversational response based on gathered information',
  category: 'agent',
  inputs: {
    context: {
      type: 'string',
      description: 'The information gathered from tool executions',
      required: true
    },
    goal: {
      type: 'string',
      description: 'The original user goal/question',
      required: true
    },
    style: {
      type: 'string',
      description: 'Response style: "default" (conversational), "strict" (data only, no embellishment), "summary" (brief overview)',
      required: false,
      default: 'default'
    }
  },
  outputs: {
    response: {
      type: 'string',
      description: 'The synthesized response'
    }
  },
  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'suggest',
  requiresApproval: false
};

// Update execute function
export async function execute(inputs: {
  context: string;
  goal: string;
  style?: 'default' | 'strict' | 'summary';
}): Promise<SkillResult> {
  const style = inputs.style || 'default';

  let systemPrompt: string;

  switch (style) {
    case 'strict':
      systemPrompt = `You are responding to a user query. You must:

1. ONLY use information from the provided context
2. DO NOT add commentary, interpretation, or embellishment
3. DO NOT invent or assume any information
4. Repeat the data EXACTLY as provided
5. Use clear formatting (bullet lists, tables) but no extra text

If the context doesn't contain enough information, say exactly: "The available information shows: [data]"`;
      break;

    case 'summary':
      systemPrompt = `Provide a brief, high-level summary of the information. Be concise (2-3 sentences max).`;
      break;

    case 'default':
    default:
      systemPrompt = `You are a helpful assistant responding naturally. Use the context to provide an informative, conversational response.`;
      break;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Goal: ${inputs.goal}\n\nContext:\n${inputs.context}\n\nRespond ${style === 'strict' ? 'with data only (no embellishment)' : 'naturally'}.`
    }
  ];

  const response = await callLLM({
    role: 'persona',
    messages,
    options: { temperature: style === 'strict' ? 0.0 : 0.7 }
  });

  return {
    success: true,
    outputs: { response: response.content }
  };
}
```

**4.2 Update Final Response Generation**

File: `brain/agents/operator-react.ts`

```typescript
async function generateFinalResponse(
  goal: string,
  state: ReactState,
  responseStyle: 'default' | 'strict' | 'summary',
  userContext: UserContext
): Promise<string> {
  // Gather all observations
  const observations = state.scratchpad
    .filter(entry => entry.observation?.success)
    .map((entry, i) => `Observation ${i + 1}: ${entry.observation!.content}`)
    .join('\n\n');

  if (!observations) {
    return 'No information was gathered to answer your question.';
  }

  // Use conversational_response skill with style parameter
  const result = await executeSkill(
    'conversational_response',
    {
      context: observations,
      goal,
      style: responseStyle
    },
    userContext
  );

  return result.success
    ? result.outputs.response
    : 'Failed to generate response';
}
```

#### Success Criteria
- ✅ `conversational_response` accepts `style` parameter
- ✅ Strict mode produces data-only responses (no embellishment)
- ✅ Summary mode is concise (2-3 sentences)
- ✅ Default mode remains conversational
- ✅ Strict mode uses temperature 0.0
- ✅ Integration with operator works

#### Files Modified
- **Modified**: `brain/skills/conversational_response.ts`
- **Modified**: `brain/agents/operator-react.ts`

---

### Phase 5: Error-Aware Retries

**Goal**: Add intelligent error handling and retry suggestions

**Duration**: 2-3 days

#### Tasks

**5.1 Enhanced Skill Execution with Error Capture**

File: `brain/agents/operator-react.ts`

```typescript
interface SkillExecutionResult {
  success: boolean;
  content: string; // Formatted observation
  outputs?: any; // Raw outputs
  error?: {
    code: string;
    message: string;
    context: any;
    suggestions?: string[]; // Recommended next actions
  };
}

async function executeSkillWithErrorHandling(
  tool: string,
  args: Record<string, any>,
  userContext: UserContext
): Promise<SkillExecutionResult> {
  try {
    const result = await executeSkill(tool, args, userContext);

    if (!result.success) {
      // Analyze error and provide suggestions
      const errorAnalysis = analyzeError(tool, args, result.error);

      return {
        success: false,
        content: `❌ ${tool} failed: ${result.error}`,
        error: {
          code: errorAnalysis.code,
          message: result.error || 'Unknown error',
          context: { tool, args, result },
          suggestions: errorAnalysis.suggestions
        }
      };
    }

    // Success - format observation
    const observation = formatObservation(tool, result, 'narrative');

    return {
      success: true,
      content: observation.content,
      outputs: result.outputs
    };

  } catch (error) {
    return {
      success: false,
      content: `❌ Unexpected error executing ${tool}: ${error.message}`,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: error.message,
        context: { tool, args, stack: error.stack }
      }
    };
  }
}
```

**5.2 Error Analysis & Suggestions**

```typescript
interface ErrorAnalysis {
  code: string;
  suggestions: string[];
}

function analyzeError(tool: string, args: any, errorMessage: string): ErrorAnalysis {
  const errorLower = errorMessage.toLowerCase();

  // File not found errors
  if (errorLower.includes('not found') || errorLower.includes('enoent')) {
    if (tool === 'fs_read') {
      return {
        code: 'FILE_NOT_FOUND',
        suggestions: [
          'Use fs_list to check what files exist in the directory',
          'Verify the file path is correct',
          'Check if the file was recently deleted'
        ]
      };
    }

    if (tool === 'task_find' || tool === 'task_list') {
      return {
        code: 'TASK_NOT_FOUND',
        suggestions: [
          'Use task_list to see all available tasks',
          'Check if the task was already completed',
          'Verify the task ID is correct'
        ]
      };
    }
  }

  // Permission errors
  if (errorLower.includes('permission') || errorLower.includes('eacces')) {
    return {
      code: 'PERMISSION_DENIED',
      suggestions: [
        'Check file permissions',
        'Verify you have access to this directory',
        'Try a different file or directory'
      ]
    };
  }

  // Invalid arguments
  if (errorLower.includes('invalid') || errorLower.includes('validation')) {
    return {
      code: 'INVALID_ARGS',
      suggestions: [
        'Check the skill manifest for correct input format',
        'Verify all required fields are provided',
        'Check data types match the schema'
      ]
    };
  }

  // Network errors
  if (errorLower.includes('network') || errorLower.includes('timeout')) {
    return {
      code: 'NETWORK_ERROR',
      suggestions: [
        'Check network connectivity',
        'Try again in a moment',
        'Verify the URL or endpoint is correct'
      ]
    };
  }

  // Generic error
  return {
    code: 'UNKNOWN_ERROR',
    suggestions: [
      'Try a different approach',
      'Ask the user for clarification',
      'Check the logs for more details'
    ]
  };
}
```

**5.3 Retry Loop Detection**

```typescript
interface FailureTracker {
  [actionKey: string]: {
    count: number;
    lastError: string;
  };
}

function detectFailureLoop(
  scratchpad: ScratchpadEntry[],
  currentAction: { tool: string; args: any }
): { isLoop: boolean; suggestion: string } {
  const failures: FailureTracker = {};

  // Count failures for each unique action
  for (const entry of scratchpad) {
    if (entry.observation && !entry.observation.success && entry.action) {
      const key = `${entry.action.tool}:${JSON.stringify(entry.action.args)}`;

      if (!failures[key]) {
        failures[key] = { count: 0, lastError: '' };
      }

      failures[key].count++;
      failures[key].lastError = entry.observation.error?.message || '';
    }
  }

  // Check if current action has already failed
  const currentKey = `${currentAction.tool}:${JSON.stringify(currentAction.args)}`;
  const currentFailures = failures[currentKey];

  if (currentFailures && currentFailures.count >= 2) {
    return {
      isLoop: true,
      suggestion: `⚠️ This action (${currentAction.tool}) has already failed ${currentFailures.count} times. Consider trying a different approach. Last error: ${currentFailures.lastError}`
    };
  }

  return { isLoop: false, suggestion: '' };
}
```

**5.4 Integrate Error Handling into Loop**

```typescript
async function runReActLoop(
  goal: string,
  context: OperatorContext,
  onProgress?: (update: OperatorUpdate) => void,
  userContext: UserContext = {}
): Promise<OperatorResult> {
  // ... initialization ...

  while (state.currentStep < state.maxSteps && !state.completed) {
    state.currentStep++;

    // Plan next step
    const planning = await planNextStep(goal, state, context, userContext);

    // Check for failure loops BEFORE executing
    if (planning.action) {
      const loopCheck = detectFailureLoop(state.scratchpad, planning.action);

      if (loopCheck.isLoop) {
        // Inject warning into scratchpad
        const warningEntry: ScratchpadEntry = {
          step: state.currentStep,
          thought: `${planning.thought}\n\n${loopCheck.suggestion}`,
          timestamp: new Date().toISOString()
        };

        state.scratchpad.push(warningEntry);

        onProgress?.({
          type: 'warning',
          content: loopCheck.suggestion,
          step: state.currentStep
        });

        // Give LLM one more chance to adjust
        continue;
      }
    }

    // Create scratchpad entry
    const entry: ScratchpadEntry = {
      step: state.currentStep,
      thought: planning.thought,
      timestamp: new Date().toISOString()
    };

    // Execute action with enhanced error handling
    if (planning.action && !planning.respond) {
      entry.action = planning.action;

      const result = await executeSkillWithErrorHandling(
        planning.action.tool,
        planning.action.args,
        userContext
      );

      entry.observation = {
        mode: 'narrative',
        content: result.content,
        success: result.success,
        error: result.error
      };

      // If error has suggestions, append them to observation
      if (result.error?.suggestions) {
        entry.observation.content += '\n\nSuggestions:\n' +
          result.error.suggestions.map(s => `- ${s}`).join('\n');
      }

      // Stream to UI
      onProgress?.({
        type: 'action',
        tool: planning.action.tool,
        args: planning.action.args,
        step: state.currentStep
      });

      onProgress?.({
        type: 'observation',
        content: result.content,
        success: result.success,
        step: state.currentStep
      });
    }

    state.scratchpad.push(entry);

    // Continue with completion check...
  }

  return { /* ... */ };
}
```

#### Success Criteria
- ✅ All skill errors captured with structured metadata
- ✅ Error analysis provides contextual suggestions
- ✅ Failure loop detection prevents repeated failures
- ✅ Suggestions injected into scratchpad for LLM
- ✅ Warning messages streamed to UI
- ✅ LLM can adjust based on error feedback

#### Files Modified
- **Modified**: `brain/agents/operator-react.ts`

---

### Phase 6: Configuration & Feature Flags

**Goal**: Add toggleable deployment with comprehensive configuration

**Duration**: 1 day

#### Tasks

**6.1 Add Feature Flag**

File: `etc/runtime.json`

```json
{
  "headless": false,
  "lastChangedBy": "remote",
  "changedAt": "2025-11-10T02:43:30.915Z",
  "claimedBy": null,
  "operator": {
    "reactV2": false
  }
}
```

**6.2 Create Operator Configuration**

File: `etc/operator.json` (new file)

```json
{
  "version": "2.0",
  "scratchpad": {
    "maxSteps": 10,
    "trimToLastN": 10,
    "enableVerbatimMode": true,
    "enableErrorRetry": true
  },
  "models": {
    "useSingleModel": false,
    "planningModel": "default.coder",
    "responseModel": "persona"
  },
  "logging": {
    "enableScratchpadDump": false,
    "logDirectory": "logs/run/agents",
    "verboseErrors": true
  },
  "performance": {
    "cacheCatalog": true,
    "catalogTTL": 60000,
    "parallelSkillExecution": false
  }
}
```

**6.3 Configuration Loader**

File: `packages/core/src/config.ts`

```typescript
import fs from 'fs/promises';
import path from 'path';
import { paths } from './paths.js';

interface OperatorConfig {
  version: string;
  scratchpad: {
    maxSteps: number;
    trimToLastN: number;
    enableVerbatimMode: boolean;
    enableErrorRetry: boolean;
  };
  models: {
    useSingleModel: boolean;
    planningModel: string;
    responseModel: string;
  };
  logging: {
    enableScratchpadDump: boolean;
    logDirectory: string;
    verboseErrors: boolean;
  };
  performance: {
    cacheCatalog: boolean;
    catalogTTL: number;
    parallelSkillExecution: boolean;
  };
}

let configCache: OperatorConfig | null = null;

export async function loadOperatorConfig(): Promise<OperatorConfig> {
  if (configCache) return configCache;

  const configPath = path.join(paths.root, 'etc', 'operator.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    configCache = JSON.parse(content);
    return configCache!;
  } catch (error) {
    // Return defaults if config doesn't exist
    console.warn('operator.json not found, using defaults');
    return getDefaultOperatorConfig();
  }
}

export function getDefaultOperatorConfig(): OperatorConfig {
  return {
    version: '2.0',
    scratchpad: {
      maxSteps: 10,
      trimToLastN: 10,
      enableVerbatimMode: true,
      enableErrorRetry: true
    },
    models: {
      useSingleModel: false,
      planningModel: 'default.coder',
      responseModel: 'persona'
    },
    logging: {
      enableScratchpadDump: false,
      logDirectory: 'logs/run/agents',
      verboseErrors: true
    },
    performance: {
      cacheCatalog: true,
      catalogTTL: 60000,
      parallelSkillExecution: false
    }
  };
}

export function invalidateOperatorConfig(): void {
  configCache = null;
}
```

**6.4 Feature Flag Check**

File: `brain/agents/operator-react.ts`

```typescript
import { loadOperatorConfig } from '@metahuman/core';

async function isReactV2Enabled(): Promise<boolean> {
  try {
    const runtimePath = path.join(paths.root, 'etc', 'runtime.json');
    const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf-8'));
    return runtime.operator?.reactV2 === true;
  } catch {
    return false; // Default to v1 if config missing
  }
}

// Main entry point
export async function runOperator(
  goal: string,
  context: OperatorContext,
  onProgress?: (update: OperatorUpdate) => void,
  userContext: UserContext = {}
): Promise<OperatorResult> {
  const useV2 = await isReactV2Enabled();

  if (useV2) {
    // Load operator config
    const config = await loadOperatorConfig();

    // Run new ReAct loop with all enhancements
    return runReActLoopV2(goal, context, config, onProgress, userContext);
  } else {
    // Run legacy loop (keep existing implementation)
    return runReActLoopV1(goal, context, onProgress, userContext);
  }
}
```

#### Success Criteria
- ✅ Feature flag in `etc/runtime.json` controls v1/v2
- ✅ Operator configuration loaded successfully
- ✅ Defaults work if config file missing
- ✅ Configuration accessible from operator code
- ✅ Toggle works without code changes

#### Files Modified
- **Modified**: `etc/runtime.json`
- **New**: `etc/operator.json`
- **New**: `packages/core/src/config.ts`
- **Modified**: `packages/core/src/index.ts` (exports)
- **Modified**: `brain/agents/operator-react.ts`

---

### Phase 7: Debug Infrastructure

**Goal**: Add comprehensive debugging and testing tools

**Duration**: 1-2 days

#### Tasks

**7.1 Scratchpad Logging**

File: `brain/agents/operator-react.ts`

```typescript
import fs from 'fs/promises';
import path from 'path';
import { paths } from '@metahuman/core';

async function logScratchpad(
  state: ReactState,
  goal: string,
  userContext: UserContext
): Promise<void> {
  const config = await loadOperatorConfig();

  if (!config.logging.enableScratchpadDump) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const logDir = path.join(paths.root, config.logging.logDirectory);
  const logFile = path.join(logDir, `scratchpad-${timestamp}.json`);

  const dump = {
    timestamp: new Date().toISOString(),
    goal,
    userId: userContext.userId,
    cognitiveMode: userContext.cognitiveMode,
    scratchpad: state.scratchpad,
    config: config,
    finalResponse: state.finalResponse,
    completed: state.completed
  };

  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(logFile, JSON.stringify(dump, null, 2));

  console.log(`[DEBUG] Scratchpad dumped to: ${logFile}`);
}

// Call at end of runReActLoopV2
async function runReActLoopV2(/* ... */): Promise<OperatorResult> {
  // ... main loop ...

  // Log scratchpad before returning
  await logScratchpad(state, goal, userContext);

  return { /* ... */ };
}
```

**7.2 CLI Debug Command**

File: `packages/cli/src/mh-new.ts`

Add new command:

```typescript
program
  .command('operator')
  .description('Operator debugging and testing')
  .argument('<query>', 'Query to process')
  .option('--debug', 'Enable scratchpad dumping')
  .option('--mode <mode>', 'Observation mode: narrative, structured, verbatim', 'narrative')
  .option('--no-stream', 'Disable streaming output')
  .action(async (query, options) => {
    // Temporarily enable scratchpad logging
    if (options.debug) {
      const runtimePath = path.join(paths.root, 'etc', 'runtime.json');
      const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf-8'));

      if (!runtime.operator) runtime.operator = {};
      runtime.operator.debugMode = true;

      await fs.writeFile(runtimePath, JSON.stringify(runtime, null, 2));
    }

    console.log(`[Operator Debug Mode]\nQuery: ${query}\nMode: ${options.mode}\n`);

    const result = await runOperator(
      query,
      { memories: [], conversationHistory: [] },
      options.stream ? (update) => {
        console.log(`[${update.type}] ${JSON.stringify(update)}`);
      } : undefined,
      { userId: 'cli-test', cognitiveMode: 'dual' }
    );

    console.log('\n=== RESULT ===');
    console.log(result.result);
    console.log('\n=== REASONING ===');
    console.log(result.reasoning);
    console.log('\n=== ACTIONS ===');
    console.log(result.actions.join(' → '));

    if (options.debug && result.scratchpad) {
      console.log('\n=== SCRATCHPAD ===');
      console.log(JSON.stringify(result.scratchpad, null, 2));
    }
  });
```

**7.3 Performance Benchmarking**

File: `tests/benchmark-operator.mjs` (new file)

```javascript
import { runOperator } from '../brain/agents/operator-react.ts';
import { performance } from 'perf_hooks';

const testCases = [
  { name: 'Simple task list', query: 'What tasks do I have?' },
  { name: 'Multi-tool chain', query: 'Find unfinished tasks about the API project' },
  { name: 'File operations', query: 'Show me the README file' },
  { name: 'Complex reasoning', query: 'What have I worked on this week and what should I prioritize?' }
];

async function benchmark() {
  console.log('🔍 Benchmarking Operator Performance\n');

  for (const testCase of testCases) {
    const start = performance.now();

    try {
      const result = await runOperator(
        testCase.query,
        { memories: [], conversationHistory: [] },
        null,
        { userId: 'benchmark', cognitiveMode: 'dual' }
      );

      const duration = performance.now() - start;

      console.log(`✅ ${testCase.name}`);
      console.log(`   Latency: ${duration.toFixed(2)}ms`);
      console.log(`   Actions: ${result.actions.length}`);
      console.log(`   Success: ${result.result ? 'Yes' : 'No'}\n`);

    } catch (error) {
      console.log(`❌ ${testCase.name}`);
      console.log(`   Error: ${error.message}\n`);
    }
  }
}

benchmark();
```

#### Success Criteria
- ✅ Scratchpad dumped to logs when debug enabled
- ✅ CLI command `./bin/mh operator "query" --debug` works
- ✅ Benchmark script runs successfully
- ✅ Performance metrics collected
- ✅ Debug output includes full scratchpad, tool catalog, planning responses

#### Files Modified
- **Modified**: `brain/agents/operator-react.ts`
- **Modified**: `packages/cli/src/mh-new.ts`
- **New**: `tests/benchmark-operator.mjs`

---

### Phase 8: Testing & Verification

**Goal**: Comprehensive validation per verification document

**Duration**: 2-3 days

#### Test Scenarios (from verification doc)

**8.1 Task Listing (Verbatim Mode)**

```bash
# Test: User asks "What's on my task list?"
# Expected: Strict, verbatim reply with title/status/priority lines
# Expected: NO extra commentary
# Expected: NO conversational_response call

./bin/mh operator "What's on my task list?" --debug
```

**Validation**:
- Check logs: No `conversational_response` invocation
- Response format: Plain bullet list
- Content: Only data from `task_list` tool output

**8.2 Multi-Tool Reasoning**

```bash
# Test: "Find unfinished tasks and rename the one about April"
# Expected: Chain task_list → task_find → task_update_status
# Expected: Retries if rename fails

./bin/mh operator "Find unfinished tasks and rename the one about April" --debug
```

**Validation**:
- Check scratchpad: Multiple actions chained
- Each action has corresponding observation
- Error handling if task not found

**8.3 Error Recovery**

```bash
# Setup: Break a skill (chmod 000 memory/tasks/active)
# Test: Try to list tasks
# Expected: Error observed, alternative suggested

chmod 000 memory/tasks/active
./bin/mh operator "Show my tasks" --debug
chmod 755 memory/tasks/active  # Restore
```

**Validation**:
- Error captured in scratchpad
- Suggestions provided to LLM
- LLM tries alternative or asks user

**8.4 Model Routing**

```bash
# Test: Verify correct models used
# Expected: Planning uses default.coder
# Expected: Final response uses persona

./bin/mh operator "Tell me about my recent work" --debug | grep "model:"
```

**Validation**:
- Grep logs for `llm_call` audit entries
- Verify `orchestrator` role → `default.coder` model
- Verify `persona` role → persona model

**8.5 Performance Baseline**

```bash
# Measure latency before/after
time ./bin/mh operator "List tasks" > baseline-v1.txt
# Enable reactV2 flag
time ./bin/mh operator "List tasks" > baseline-v2.txt

# Compare
echo "V1: $(grep 'real' baseline-v1.txt)"
echo "V2: $(grep 'real' baseline-v2.txt)"
```

**Validation**:
- V2 latency < 3x V1 latency
- Token usage reasonable (check audit logs)

**8.6 Feature Flag Toggle**

```bash
# Test: Disable reactV2, verify fallback to v1
echo '{"operator":{"reactV2":false}}' > etc/runtime.json
./bin/mh operator "Test query" --debug
# Should use legacy implementation

# Re-enable
echo '{"operator":{"reactV2":true}}' > etc/runtime.json
./bin/mh operator "Test query" --debug
# Should use new implementation
```

**Validation**:
- Both modes work without crashes
- Legacy behavior preserved when reactV2=false

**8.7 UI Integration**

1. Start web dev server: `cd apps/site && pnpm dev`
2. Navigate to chat interface
3. Send query: "What tasks do I have?"
4. Verify:
   - Status widget shows model assignments
   - Audit stream includes `react_scratchpad_snapshot`
   - Strict responses render correctly (no Markdown injection)
   - Long JSON rendered in `<pre>` tags

#### Automated Test Suite

File: `tests/test-operator-v2.mjs` (new file)

```javascript
import { runOperator } from '../brain/agents/operator-react.ts';
import assert from 'assert';

describe('Operator V2', () => {
  it('should use verbatim mode for task list queries', async () => {
    const result = await runOperator(
      'What tasks do I have?',
      { memories: [], conversationHistory: [] },
      null,
      { userId: 'test', cognitiveMode: 'dual' }
    );

    assert.strictEqual(result.verbatim, true);
    assert(result.actions.includes('task_list'));
  });

  it('should chain multiple tools for complex queries', async () => {
    const result = await runOperator(
      'Find unfinished tasks about the API',
      { memories: [], conversationHistory: [] },
      null,
      { userId: 'test', cognitiveMode: 'dual' }
    );

    assert(result.actions.length >= 2);
    assert(result.actions.includes('task_list') || result.actions.includes('task_find'));
  });

  it('should handle errors gracefully', async () => {
    // Simulate error by passing invalid args
    const result = await runOperator(
      'Read a non-existent file at /invalid/path',
      { memories: [], conversationHistory: [] },
      null,
      { userId: 'test', cognitiveMode: 'dual' }
    );

    // Should not crash
    assert(result.result);
    // Should mention error in response
    assert(result.result.includes('error') || result.result.includes('not found'));
  });

  it('should trim scratchpad to last N steps', async () => {
    // Create query that requires many steps (might need to mock)
    const result = await runOperator(
      'Do a complex task requiring many steps',
      { memories: [], conversationHistory: [] },
      null,
      { userId: 'test', cognitiveMode: 'dual' }
    );

    if (result.scratchpad) {
      // Verify scratchpad doesn't exceed config limit
      assert(result.scratchpad.length <= 10);
    }
  });
});
```

#### Success Criteria (Complete Checklist)

- [ ] ✅ Task listing returns verbatim, strict response
- [ ] ✅ Multi-tool chains work (task search + rename scenario)
- [ ] ✅ Errors trigger retries with suggestions
- [ ] ✅ Planning uses `default.coder`, responses use `persona`
- [ ] ✅ Latency within 3x baseline
- [ ] ✅ Feature flag toggle works without issues
- [ ] ✅ Status widget shows correct model assignments
- [ ] ✅ Audit stream includes `react_scratchpad_snapshot`
- [ ] ✅ Strict responses render correctly in UI
- [ ] ✅ Scratchpad trimmed to last 10 steps
- [ ] ✅ Tool catalog cached (same instance within 1 minute)
- [ ] ✅ All automated tests pass

#### Files Modified
- **New**: `tests/test-operator-v2.mjs`

---

### Phase 9: Cleanup & Documentation

**Goal**: Remove legacy code and update documentation

**Duration**: 1 day

#### Tasks

**9.1 Delete Legacy Code**

After verification complete and reactV2 enabled by default:

```bash
# Remove temporary debug scripts (older than 7 days)
find logs/run/agents -name "scratchpad-*.json" -mtime +7 -delete

# Remove old observation formatter (if completely replaced)
# - Check if any code still references old formatObservation heuristics
# - Carefully remove deprecated sections in operator-react.ts
```

Manual review needed before deletion:
- Old `formatObservation` narrative logic (might keep for backward compat)
- Fast-path heuristics in `checkCompletion` (keep if still useful)
- Legacy planning prompts (safe to delete once v2 is stable)

**9.2 Update Documentation**

File: `docs/user-guide/13-advanced-usage.md`

Add section:

```markdown
## Operator V2: Structured ReAct System

MetaHuman OS v2.0 introduces an enhanced reactive operator with structured reasoning and tool awareness.

### Key Features

- **Tool Catalog**: Skills are documented and cached for efficient LLM prompting
- **Structured Scratchpad**: Explicit Thought → Action → Observation reasoning blocks
- **Verbatim Mode**: Raw data responses for "list tasks" type queries (no embellishment)
- **Error Recovery**: Automatic retry suggestions when skills fail
- **Multi-Model Routing**: Planning uses coder model, responses use persona model

### Configuration

Operator behavior is configured in `etc/operator.json`:

```json
{
  "scratchpad": {
    "maxSteps": 10,
    "enableVerbatimMode": true,
    "enableErrorRetry": true
  },
  "models": {
    "planningModel": "default.coder",
    "responseModel": "persona"
  }
}
```

### Enabling V2

Edit `etc/runtime.json`:

```json
{
  "operator": {
    "reactV2": true
  }
}
```

### Troubleshooting

**Problem**: Operator returns hallucinated task data

**Solution**: Enable strict mode by editing `etc/operator.json`:
- Set `enableVerbatimMode: true`
- Verify query matches data retrieval pattern (e.g., "list tasks", "show file")

**Problem**: Operator fails after 2 iterations

**Solution**: Check `logs/run/agents/operator-react.log` for errors. Enable debug mode:
```bash
./bin/mh operator "your query" --debug
```

**Problem**: High latency (>10s per query)

**Solution**:
- Reduce `maxSteps` in `etc/operator.json`
- Use faster model for planning (e.g., `qwen3:8b` instead of `qwen3-coder:30b`)
- Disable verbatim mode if not needed

### Debugging

View full scratchpad for any query:

```bash
./bin/mh operator "Find tasks about API" --debug
```

This dumps:
- Full scratchpad (Thought/Action/Observation blocks)
- Tool catalog used by LLM
- Planning responses
- Error traces

### Performance Benchmarks

Run automated benchmarks:

```bash
node tests/benchmark-operator.mjs
```

Expected performance:
- Simple queries (<5s)
- Multi-tool chains (<15s)
- Complex reasoning (<30s)
```

**9.3 Update CLAUDE.md**

File: `CLAUDE.md`

Add to "Key Design Patterns" section:

```markdown
**Structured ReAct (V2)**: The operator uses a structured Reason-Act-Observe loop:
1. **Tool Catalog**: All skills documented in LLM-friendly format, cached per process
2. **Scratchpad**: Explicit Thought → Action → Observation blocks for transparent reasoning
3. **Verbatim Mode**: Data queries return raw tool outputs (no synthesis)
4. **Error Recovery**: Failed actions trigger suggestion engine for alternatives
5. **Multi-Model**: Planning uses coder model, synthesis uses persona model

Enable with `"operator": { "reactV2": true }` in `etc/runtime.json`.
```

**9.4 Update Implementation Plan Documents**

File: `docs/implementation-plans/reactive-operator-refactor.md`

Add banner at top:

```markdown
# ✅ IMPLEMENTED

This refactor was completed in MetaHuman OS v2.0.

See `reactive-operator-refactor-IMPLEMENTATION-PLAN.md` for full details.

---

# Reactive Operator Refactor & Tooling Upgrade
...
```

File: `docs/implementation-plans/reactive-operator-refactor-verification.md`

Add results section at end:

```markdown
## Verification Results

**Date**: [YYYY-MM-DD]
**Status**: ✅ All tests passed

### Test Results

| Test | Status | Notes |
|------|--------|-------|
| Task listing (verbatim) | ✅ Pass | Response strict, no embellishment |
| Multi-tool reasoning | ✅ Pass | Chains 3+ tools successfully |
| Error recovery | ✅ Pass | Retries with suggestions |
| Model routing | ✅ Pass | Correct models used |
| Performance | ✅ Pass | Latency <3x baseline |
| Feature flag toggle | ✅ Pass | Both v1/v2 work |
| UI integration | ✅ Pass | Renders correctly |

### Performance Metrics

- **Average latency**: X.Xms (vs Y.Yms baseline)
- **Token usage**: ~Z tokens/query
- **Success rate**: 95%+ on standard queries
```

#### Success Criteria
- ✅ Legacy debug files cleaned up
- ✅ Documentation updated with v2 features
- ✅ Troubleshooting guide complete
- ✅ CLAUDE.md includes v2 design patterns
- ✅ Implementation plan documents marked as complete

#### Files Modified
- **Modified**: `docs/user-guide/13-advanced-usage.md`
- **Modified**: `CLAUDE.md`
- **Modified**: `docs/implementation-plans/reactive-operator-refactor.md`
- **Modified**: `docs/implementation-plans/reactive-operator-refactor-verification.md`

---

## Testing Strategy

### Unit Tests (Per Phase)

Each phase includes focused unit tests:
- Phase 1: Tool catalog builder
- Phase 2: Scratchpad formatting, JSON parsing
- Phase 3: Observation mode detection
- Phase 4: Response style parameter
- Phase 5: Error analysis logic
- Phase 6: Configuration loading
- Phase 7: Logging utilities

### Integration Tests (Phase 8)

End-to-end scenarios:
1. Simple queries (verbatim mode)
2. Complex multi-tool chains
3. Error handling and retry
4. Model routing verification
5. Performance benchmarks

### Manual Testing (Phase 8)

UI testing:
- ChatGPT-style interface
- Status widget updates
- Audit stream monitoring
- Response rendering

### Regression Testing

Before each phase:
- Run existing test suite
- Verify no breaking changes
- Check audit logs for anomalies

---

## Risk Mitigation

### High Risk: Longer Latency

**Mitigation**:
1. Cache tool catalog (1-minute TTL)
2. Trim scratchpad to last 10 steps
3. Use faster models for non-critical operations
4. Benchmark early and often (Phase 7)

**Metrics**:
- Target: <3x baseline latency
- Measure: Phase 8 performance tests
- Rollback trigger: >5x baseline

### High Risk: Model JSON Errors

**Mitigation**:
1. Use Ollama `format: 'json'` enforcement
2. Implement robust retry with schema hints
3. Validate JSON before use
4. Log all parse failures to audit

**Metrics**:
- Target: <5% JSON parse failures
- Measure: Audit logs over 7 days
- Rollback trigger: >20% failures

### Medium Risk: Breaking Changes

**Mitigation**:
1. Feature flag toggle (`reactV2`)
2. Keep legacy implementation intact
3. Parallel testing of v1 and v2
4. Gradual rollout per user

**Metrics**:
- Target: 100% backward compatibility when flag disabled
- Measure: Regression test suite
- Rollback trigger: Any existing test failures

### Medium Risk: User Confusion

**Mitigation**:
1. Clear UI indicators for response modes
2. Documentation with examples
3. Troubleshooting guide
4. Gradual feature education

**Metrics**:
- Target: <10% support requests related to new operator
- Measure: User feedback over 30 days
- Rollback trigger: >30% negative feedback

### Low Risk: Skill Discovery Issues

**Mitigation**:
1. Validate catalog against `listSkills()` at build time
2. Unit tests for catalog completeness
3. Fallback to generic descriptions if manifest incomplete

**Metrics**:
- Target: 100% skill coverage in catalog
- Measure: Unit test assertion
- Rollback trigger: N/A (low impact)

---

## Success Criteria

### Functional Requirements

- ✅ Tool catalog includes all 25 skills with correct documentation
- ✅ Scratchpad uses structured Thought/Action/Observation blocks
- ✅ Verbatim mode returns raw data without embellishment
- ✅ Strict response style prevents hallucination
- ✅ Error suggestions provided for common failures
- ✅ Retry logic prevents failure loops
- ✅ Feature flag enables/disables v2 seamlessly

### Performance Requirements

- ✅ Latency increase <3x baseline
- ✅ Token usage per query <2000 tokens average
- ✅ Tool catalog cache hit rate >90%
- ✅ JSON parse success rate >95%
- ✅ Scratchpad memory footprint <1MB per session

### Quality Requirements

- ✅ 100% of unit tests pass
- ✅ 100% of integration tests pass
- ✅ Zero regressions in existing functionality
- ✅ Audit trail complete for all operations
- ✅ Documentation comprehensive and accurate

### User Experience Requirements

- ✅ Response quality improved (fewer hallucinations)
- ✅ Multi-tool chains work reliably
- ✅ Error messages actionable
- ✅ UI rendering correct for all modes
- ✅ Status indicators clear

---

## Appendix

### A. Dependency Graph

```
Tool Catalog (Phase 1)
  └── Scratchpad Structure (Phase 2)
        ├── Observation Modes (Phase 3)
        │     ├── Response Enhancement (Phase 4)
        │     └── Error Handling (Phase 5)
        └── Configuration (Phase 6)
              └── Debug Infrastructure (Phase 7)
                    └── Testing (Phase 8)
                          └── Cleanup (Phase 9)
```

### B. File Modification Summary

**New Files** (8):
- `packages/core/src/tool-catalog.ts`
- `packages/core/src/tool-catalog.spec.ts`
- `packages/core/src/config.ts`
- `etc/operator.json`
- `tests/benchmark-operator.mjs`
- `tests/test-operator-v2.mjs`

**Modified Files** (8):
- `brain/agents/operator-react.ts` (major refactor)
- `brain/skills/conversational_response.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/mh-new.ts`
- `etc/runtime.json`
- `docs/user-guide/13-advanced-usage.md`
- `CLAUDE.md`
- `docs/implementation-plans/*.md` (2 files)

**Total**: 16 files touched

### C. Estimated Timeline Breakdown

| Phase | Duration | Start Day | End Day |
|-------|----------|-----------|---------|
| Phase 1: Tool Catalog | 2.5 days | Day 1 | Day 3 |
| Phase 2: Scratchpad | 3.5 days | Day 3 | Day 7 |
| Phase 3: Observation | 2.5 days | Day 7 | Day 10 |
| Phase 4: Response | 1 day | Day 10 | Day 11 |
| Phase 5: Error Handling | 2.5 days | Day 11 | Day 14 |
| Phase 6: Configuration | 1 day | Day 14 | Day 15 |
| Phase 7: Debug Tools | 1.5 days | Day 15 | Day 17 |
| Phase 8: Testing | 2.5 days | Day 17 | Day 20 |
| Phase 9: Cleanup | 1 day | Day 20 | Day 20 |

**Total**: ~20 working days

**Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 8

**Parallelization Opportunities**:
- Phases 4-5 can overlap with Phase 3
- Phase 6 can be done anytime after Phase 2
- Phase 7 can be done alongside Phase 5

### D. Review Checkpoints

**Checkpoint 1** (End of Phase 2):
- Review scratchpad structure
- Validate tool catalog integration
- Verify JSON parsing robustness

**Checkpoint 2** (End of Phase 5):
- Review error handling logic
- Test multi-tool chains
- Validate retry behavior

**Checkpoint 3** (End of Phase 8):
- Full regression testing
- Performance validation
- UI/UX review
- Go/no-go decision for production

### E. Rollback Plan

If critical issues discovered:

1. **Immediate**: Set `reactV2: false` in `etc/runtime.json`
2. **Short-term**: Keep legacy code intact for 30 days post-launch
3. **Long-term**: Address issues in patch release, re-enable v2

**Rollback Triggers**:
- >5x latency increase
- >20% JSON parse failure rate
- Critical functionality broken
- >30% negative user feedback

### F. Post-Implementation Monitoring

**Week 1**:
- Monitor audit logs daily for anomalies
- Track JSON parse failures
- Measure latency P50/P95/P99
- Collect user feedback

**Week 2-4**:
- Weekly performance reports
- Refine error suggestions based on real failures
- Optimize tool catalog formatting
- Update documentation based on common questions

**Month 2+**:
- Consider removing legacy v1 code
- Add new skills to catalog
- Enhance observation formatting
- Explore parallel skill execution

---

**END OF IMPLEMENTATION PLAN**

This document serves as the complete guide for implementing the Reactive Operator Refactor in MetaHuman OS v2.0.

For questions or clarifications, refer to:
- `docs/implementation-plans/reactive-operator-refactor.md` (original design)
- `docs/implementation-plans/reactive-operator-refactor-verification.md` (test plan)
- `CLAUDE.md` (project context for AI assistants)
