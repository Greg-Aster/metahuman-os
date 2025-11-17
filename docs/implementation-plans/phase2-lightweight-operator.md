# Phase 2: Enable Lightweight Operator for Emulation Mode

**Status**: Planning
**Depends On**: Phase 1 (Cognitive Layers Integration)
**Goal**: Add intent detection and routing for emulation mode without full ReAct overhead

## Problem Statement

Emulation mode currently bypasses the operator entirely, which means:
1. No intent detection - all messages go straight to chat LLM
2. No routing to appropriate handlers (memory search, temporal lookback, skill execution)
3. No planning capability for multi-step responses

However, full ReAct operator is too heavy for emulation mode's "fast response" goal.

## Solution Overview

Create a **lightweight operator** for emulation mode that:
- Detects user intent (factual question, temporal query, casual chat)
- Routes to appropriate handler in single step (no multi-step ReAct loop)
- Executes one action and returns (no iteration)
- Falls back to direct chat for simple queries

## Architecture

### Intent Categories

1. **Factual Query** - Requires memory search
   - Examples: "What's your cat's name?", "Who did you meet last week?"
   - Handler: Memory search skill → synthesize answer

2. **Temporal Query** - Requires time-based lookback
   - Examples: "How was your day?", "What did you do yesterday?"
   - Handler: Temporal memory skill (Phase 4) → summarize events

3. **Task Query** - Requires task system
   - Examples: "What am I working on?", "Show me my tasks"
   - Handler: Task list skill → format response

4. **Casual Chat** - No action needed
   - Examples: "Hi there", "How are you?", "That's interesting"
   - Handler: Direct LLM chat (skip operator)

5. **Complex Request** - Multiple steps needed
   - Examples: "Create a task and tell me what I'm working on"
   - Handler: Fallback to full ReAct operator (rare in emulation)

### Single-Step Execution Flow

```
User Input
    ↓
Intent Classifier (fast LLM call)
    ↓
Route to Handler
    ├── Factual → search_memory skill → synthesize
    ├── Temporal → temporal_summary skill → synthesize
    ├── Task → list_tasks skill → format
    ├── Casual → direct chat (skip operator)
    └── Complex → full ReAct operator (rare)
    ↓
Return Response
```

## Implementation Steps

### Step 2.1: Create Intent Classifier

**File**: `packages/core/src/intent-classifier.ts` (NEW)

```typescript
import { callLLM, type RouterMessage } from './model-router';
import { audit } from './audit';

export type IntentType = 'factual' | 'temporal' | 'task' | 'casual' | 'complex';

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  reasoning: string;
  suggestedAction?: string;
}

/**
 * Classify user intent using fast LLM call
 */
export async function classifyIntent(
  userMessage: string,
  conversationHistory: RouterMessage[],
  cognitiveMode: string = 'emulation'
): Promise<IntentClassification> {
  const prompt = `Analyze this user message and classify the intent.

User Message: "${userMessage}"

Intent Categories:
- factual: Asking about specific facts, names, events, or memories (requires memory search)
- temporal: Asking about time-based experiences ("how was your day", "what did you do yesterday")
- task: Asking about tasks, projects, or work ("what am I working on", "show my tasks")
- casual: Greetings, acknowledgments, simple chat (no action needed)
- complex: Multi-step requests or commands (rare, requires full planning)

Respond ONLY as JSON:
{
  "intent": "factual" | "temporal" | "task" | "casual" | "complex",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "suggestedAction": "what action to take (optional)"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage }
  ];

  const response = await callLLM({
    role: 'orchestrator',
    messages,
    cognitiveMode,
    options: {
      temperature: 0.1, // Low temp for consistent classification
      maxTokens: 256
    }
  });

  try {
    const classification = JSON.parse(response.content);

    audit({
      level: 'info',
      category: 'system',
      event: 'intent_classified',
      details: {
        userMessage,
        classification,
        cognitiveMode
      },
      actor: 'system'
    });

    return classification;
  } catch (error) {
    console.error('[intent-classifier] Failed to parse classification:', error);

    // Default to casual chat on parse failure
    return {
      intent: 'casual',
      confidence: 0.5,
      reasoning: 'Failed to classify, defaulting to casual chat'
    };
  }
}

/**
 * Quick heuristic-based intent detection (fallback for when LLM is unavailable)
 */
export function quickIntentDetection(userMessage: string): IntentType {
  const msg = userMessage.toLowerCase();

  // Temporal indicators
  if (/\b(today|yesterday|this week|last week|how was|what did you do)\b/i.test(msg)) {
    return 'temporal';
  }

  // Task indicators
  if (/\b(task|tasks|working on|project|projects|todo)\b/i.test(msg)) {
    return 'task';
  }

  // Casual indicators
  if (/^(hi|hello|hey|thanks|ok|okay|cool|nice|interesting)\b/i.test(msg)) {
    return 'casual';
  }

  // Complex indicators (multi-sentence, conjunctions)
  if (/\b(and then|after that|also|plus)\b/i.test(msg) || msg.split(/[.!?]/).length > 2) {
    return 'complex';
  }

  // Default to factual (likely a question)
  return 'factual';
}
```

---

### Step 2.2: Create Lightweight Operator

**File**: `brain/agents/operator-lightweight.ts` (NEW)

```typescript
import { classifyIntent, quickIntentDetection, type IntentType } from '@metahuman/core/intent-classifier';
import { executeSkill } from '@metahuman/core/skills';
import { callLLM, type RouterMessage } from '@metahuman/core/model-router';
import { audit } from '@metahuman/core/audit';

export interface LightweightOperatorResult {
  success: boolean;
  response: string;
  intent: IntentType;
  actionTaken?: string;
  error?: string;
}

/**
 * Lightweight single-step operator for emulation mode
 * - Classifies intent
 * - Routes to appropriate handler
 * - Executes ONE action
 * - Returns response (no iteration)
 */
export async function runLightweightOperator(
  userMessage: string,
  conversationHistory: RouterMessage[],
  cognitiveMode: string = 'emulation'
): Promise<LightweightOperatorResult> {
  try {
    // Step 1: Classify intent
    const classification = await classifyIntent(userMessage, conversationHistory, cognitiveMode);
    const { intent, confidence } = classification;

    audit({
      level: 'info',
      category: 'action',
      event: 'lightweight_operator_start',
      details: { userMessage, intent, confidence, cognitiveMode },
      actor: 'operator-lightweight'
    });

    // Step 2: Route based on intent
    switch (intent) {
      case 'casual':
        // Skip operator, return null to fall through to direct chat
        return {
          success: true,
          response: '',
          intent,
          actionTaken: 'skip_operator'
        };

      case 'factual':
        return await handleFactualQuery(userMessage, conversationHistory, cognitiveMode);

      case 'temporal':
        return await handleTemporalQuery(userMessage, conversationHistory, cognitiveMode);

      case 'task':
        return await handleTaskQuery(userMessage, conversationHistory, cognitiveMode);

      case 'complex':
        // Fall back to full ReAct operator
        return {
          success: false,
          response: '',
          intent,
          actionTaken: 'fallback_to_react',
          error: 'Complex intent requires full operator'
        };

      default:
        return {
          success: false,
          response: '',
          intent,
          error: 'Unknown intent type'
        };
    }
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'lightweight_operator_error',
      details: { userMessage, error: (error as Error).message },
      actor: 'operator-lightweight'
    });

    return {
      success: false,
      response: '',
      intent: 'casual',
      error: (error as Error).message
    };
  }
}

/**
 * Handle factual queries (memory search)
 */
async function handleFactualQuery(
  userMessage: string,
  conversationHistory: RouterMessage[],
  cognitiveMode: string
): Promise<LightweightOperatorResult> {
  try {
    // Execute memory search skill
    const searchResult = await executeSkill('search_memory', { query: userMessage });

    if (!searchResult.success) {
      return {
        success: false,
        response: '',
        intent: 'factual',
        error: searchResult.error || 'Memory search failed'
      };
    }

    // Synthesize answer from search results
    const synthesisPrompt = `Based on these memory search results, answer the user's question naturally.

User Question: "${userMessage}"

Search Results:
${JSON.stringify(searchResult.result, null, 2)}

Provide a concise, conversational answer.`;

    const synthesis = await callLLM({
      role: 'persona',
      messages: [
        ...conversationHistory,
        { role: 'system', content: synthesisPrompt }
      ],
      cognitiveMode,
      options: { temperature: 0.7, maxTokens: 512 }
    });

    return {
      success: true,
      response: synthesis.content,
      intent: 'factual',
      actionTaken: 'search_memory'
    };
  } catch (error) {
    return {
      success: false,
      response: '',
      intent: 'factual',
      error: (error as Error).message
    };
  }
}

/**
 * Handle temporal queries (Phase 4 dependency)
 */
async function handleTemporalQuery(
  userMessage: string,
  conversationHistory: RouterMessage[],
  cognitiveMode: string
): Promise<LightweightOperatorResult> {
  // TODO: Implement in Phase 4
  // For now, fall through to regular chat
  return {
    success: true,
    response: '',
    intent: 'temporal',
    actionTaken: 'pending_phase4'
  };
}

/**
 * Handle task queries
 */
async function handleTaskQuery(
  userMessage: string,
  conversationHistory: RouterMessage[],
  cognitiveMode: string
): Promise<LightweightOperatorResult> {
  try {
    // Execute list tasks skill
    const taskResult = await executeSkill('list_tasks', {});

    if (!taskResult.success) {
      return {
        success: false,
        response: '',
        intent: 'task',
        error: taskResult.error || 'Task list failed'
      };
    }

    // Format task list naturally
    const formatPrompt = `Format these tasks as a natural conversational response.

User Question: "${userMessage}"

Tasks:
${JSON.stringify(taskResult.result, null, 2)}

Respond naturally and concisely.`;

    const formatted = await callLLM({
      role: 'persona',
      messages: [
        ...conversationHistory,
        { role: 'system', content: formatPrompt }
      ],
      cognitiveMode,
      options: { temperature: 0.5, maxTokens: 512 }
    });

    return {
      success: true,
      response: formatted.content,
      intent: 'task',
      actionTaken: 'list_tasks'
    };
  } catch (error) {
    return {
      success: false,
      response: '',
      intent: 'task',
      error: (error as Error).message
    };
  }
}
```

---

### Step 2.3: Integrate Lightweight Operator into persona_chat.ts

**File**: `apps/site/src/pages/api/persona_chat.ts`
**Location**: After cognitive mode check, around line 1100

**Current Code**:
```typescript
// Check if we should use the operator based on cognitive mode
const shouldUseOperator = canUseOperator(cognitiveMode);

if (shouldUseOperator && (forceOperator || (operatorEnabled && someOtherCondition))) {
  // Use full ReAct operator
  // ...
}

// Otherwise, proceed with normal chat flow
```

**Replace With**:
```typescript
import { runLightweightOperator } from '../../../../../brain/agents/operator-lightweight';

// Check if we should use the operator based on cognitive mode
const shouldUseOperator = canUseOperator(cognitiveMode);

// Emulation mode uses lightweight operator (Phase 2)
if (cognitiveMode === 'emulation' && shouldUseOperator) {
  // Run lightweight single-step operator
  const operatorResult = await runLightweightOperator(
    message,
    histories[m].map(h => ({ role: h.role, content: h.content })) as RouterMessage[],
    cognitiveMode
  );

  if (operatorResult.success && operatorResult.response) {
    // Operator handled the request, return response
    audit({
      level: 'info',
      category: 'action',
      event: 'chat_assistant',
      details: {
        mode: m,
        content: operatorResult.response,
        cognitiveMode,
        usedOperator: true,
        lightweightOperator: true,
        intent: operatorResult.intent,
        actionTaken: operatorResult.actionTaken
      },
      actor: 'assistant'
    });

    pushMessage(m, { role: 'assistant', content: operatorResult.response }, sessionId);

    return new Response(JSON.stringify({ response: operatorResult.response }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } else if (operatorResult.actionTaken === 'skip_operator') {
    // Casual chat, fall through to normal chat flow
    console.log('[persona_chat] Lightweight operator skipped (casual chat)');
  } else if (operatorResult.actionTaken === 'fallback_to_react') {
    // Complex query, use full ReAct operator
    console.log('[persona_chat] Falling back to full ReAct operator');
    // Continue to full operator code below
  }
}

// Full ReAct operator for dual/agent modes or complex queries
if (shouldUseOperator && (forceOperator || (operatorEnabled && someOtherCondition))) {
  // Use full ReAct operator
  // ... existing code
}

// Normal chat flow (no operator)
```

---

### Step 2.4: Update Cognitive Layers Config

**File**: `etc/cognitive-layers.json`
**Location**: Emulation mode section

**Add operator configuration**:
```json
{
  "emulation": {
    "description": "Read-only personality snapshot - frozen personality using LoRA adapter, minimal validation",
    "operator": {
      "enabled": true,
      "mode": "lightweight",
      "intentClassification": true,
      "maxSteps": 1,
      "fallbackToReact": false
    },
    "layers": [
      // ... existing layers
    ]
  }
}
```

---

## Expected Behavior After Implementation

### Before (Current State)
- ❌ Emulation mode bypasses operator entirely
- ❌ No intent detection
- ❌ Cannot answer factual questions from memory
- ❌ Cannot summarize temporal experiences

### After (Phase 2 Complete)
- ✅ Intent detection classifies user messages
- ✅ Factual queries trigger memory search
- ✅ Task queries return formatted task list
- ✅ Casual chat skips operator (fast path)
- ✅ Complex queries fall back to ReAct (rare)

## Testing Plan

1. **Test Intent Classification**:
   - Ask "What's your cat's name?" → should detect `factual` intent
   - Ask "How was your day?" → should detect `temporal` intent
   - Ask "What am I working on?" → should detect `task` intent
   - Say "Hi there" → should detect `casual` intent

2. **Test Factual Handler**:
   - Ask factual question
   - Verify memory search skill is called
   - Verify response is synthesized from search results
   - Check audit logs for `lightweight_operator_start` and `search_memory` events

3. **Test Task Handler**:
   - Ask "What tasks do I have?"
   - Verify list_tasks skill is called
   - Verify response formats tasks naturally

4. **Test Casual Skip**:
   - Say "Hello"
   - Verify operator is skipped
   - Verify fast response time (no skill execution)

## Dependencies

- Phase 1 must be complete (cognitive layers)
- Memory search skill must exist (`brain/skills/search_memory.ts`)
- Task list skill must exist (`brain/skills/list_tasks.ts`)
- Phase 4 temporal summary skill (dependency for temporal queries)

## Files Created/Modified

### New Files
1. `packages/core/src/intent-classifier.ts`
2. `brain/agents/operator-lightweight.ts`

### Modified Files
1. `apps/site/src/pages/api/persona_chat.ts` (add lightweight operator routing)
2. `etc/cognitive-layers.json` (add operator config)

## Next Phase

After Phase 2 is complete and tested, proceed to **Phase 3: Implement Subconscious Appropriateness Filter** to add content filtering before responses are sent to users.
