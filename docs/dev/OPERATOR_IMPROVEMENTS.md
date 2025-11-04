# Operator Agent Improvements

## Current Issues

1. **Lost Contextual References**: Phrases like "this file" or "the one I mentioned" don't resolve to previous context
2. **Over-Cautious Task Assessment**: Simple tasks like "find a random file" are marked as unclear
3. **No Reasoning Fallback**: When stuck, the system doesn't engage deeper reasoning to solve the problem

## Completed Fixes (2025-11-04)

### ✅ Conversation History in Operator Context
**File**: `apps/site/src/pages/api/persona_chat.ts:714-731`

Added last 5 conversation turns to operator context:
```typescript
// Build operator context with recent conversation history
let operatorContext = '';
const recentHistory = histories[m].slice(-6, -1); // Last 5 messages
if (recentHistory.length > 0) {
  operatorContext += 'Recent conversation:\n';
  for (const turn of recentHistory) {
    const label = turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'System';
    operatorContext += `${label}: ${turn.content.substring(0, 500)}\n`;
  }
}
```

**Impact**: Operator now has access to recent conversation when planning tasks.

## Recommended Next Steps

### 1. Improve Task Assessment (High Priority)

**File**: `brain/agents/operator.ts:191-224`

**Current Problem**: The `assessTask()` function is too strict and doesn't understand conversational context.

**Solution**: Update the system prompt to be more context-aware:

```typescript
const systemPrompt = `You are a task assessment module for an autonomous operator.
Evaluate whether the task has enough detail to proceed safely.

IMPORTANT GUIDELINES:
- If the task references recent conversation ("this file", "the one I mentioned"), check the Context field
- Common requests like "find a file", "read a file", "list files" are ALWAYS ready (confidence: 0.9+)
- Only mark as unclear if truly ambiguous (e.g., "do the thing" with no context)
- In YOLO mode, be even more permissive

Respond ONLY as JSON with keys:
- "ready": boolean (true if enough info to start)
- "confidence": number 0-1 (0.7+ is good enough)
- "clarification": optional string (only if truly unclear)
- "rationale": optional short explanation`;
```

### 2. Add Reasoning Mode Fallback (Medium Priority)

**File**: `brain/agents/operator.ts` (new function)

**Concept**: When planning fails or confidence is low (<0.5), engage reasoning mode to think through the problem.

```typescript
async function reasonAboutTask(task: Task, assessment: TaskAssessment): Promise<string> {
  // Use reasoning model to think through ambiguity
  const systemPrompt = `You are helping plan a task that seems ambiguous.
Think step-by-step about what the user might mean and what information is available.`;

  const userPrompt = `Task: ${task.goal}
Context: ${task.context || 'None'}
Issue: ${assessment.clarification || 'Task seems unclear'}

Think through:
1. What might the user be referring to?
2. What information is available in the context?
3. What reasonable assumptions can we make?
4. What's the most likely intent?

Provide a clear plan of action.`;

  const response = await callLLM({
    role: 'planner',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      temperature: 0.7,
      reasoning: true, // Enable reasoning mode
    },
  });

  return response.content;
}
```

**Integration Point**: In `runTask()`, after `assessTask()` returns low confidence:

```typescript
const assessment = await assessTask(task, mode);
if (assessment && !assessment.ready && assessment.confidence < 0.5) {
  // Try reasoning mode before giving up
  console.log('[operator] Low confidence - engaging reasoning mode');
  const reasoning = await reasonAboutTask(task, assessment);
  // Update task context with reasoning insights
  task.context = `${task.context}\n\nReasoning: ${reasoning}`;
  // Retry assessment
  const reassessment = await assessTask(task, mode);
  if (reassessment && reassessment.ready) {
    // Proceed with new context
  }
}
```

### 3. Enhance Planner with Examples (Low Priority)

**File**: `brain/agents/operator.ts:310-410`

**Current**: The planner prompt is very long but doesn't include many examples.

**Solution**: Add more examples of conversational task resolution:

```typescript
EXAMPLES OF CONVERSATIONAL CONTEXT:

User: "Can you find a random markdown file?"
Assistant: "Found README.md in docs/"
User: "Open that file"
Plan:
  1. [fs_read] Read docs/README.md (from previous message)

User: "List files in the brain folder"
Assistant: "Found: organizer.ts, reflector.ts, ..."
User: "Read the first one"
Plan:
  1. [fs_read] Read brain/organizer.ts (first file from previous list)
```

## Testing Plan

1. **Test Conversational References**:
   - "Find a file" → "Read it" (should work now with context)
   - "List markdown files" → "Open the first one"
   - "Show me the docs" → "Read that README"

2. **Test Ambiguous Tasks**:
   - "Find a random file" (should succeed with confidence >0.8)
   - "Do the thing" (should trigger reasoning fallback)

3. **Test Reasoning Fallback**:
   - Intentionally vague request should trigger reasoning
   - Reasoning output should clarify intent
   - Second attempt should succeed

## Success Metrics

- ✅ 90%+ success rate on follow-up questions with pronouns ("it", "that", "the one")
- ✅ 95%+ success rate on common file operations ("find a file", "read", "list")
- ✅ Reasoning mode engages automatically when confidence <0.5
- ✅ User sees reasoning thought process when it activates

## Notes

- The conversation history fix (completed) should already improve ~50% of cases
- Task assessment improvements will fix another ~30%
- Reasoning fallback handles the remaining edge cases
- Model selection (`qwen3-coder`) is handled by model-router.ts based on role='planner'
