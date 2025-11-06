# ReAct Operator Performance Audit

**Date**: November 5, 2025
**Status**: 🔴 **PERFORMANCE ISSUE IDENTIFIED**
**Severity**: High - System slowness reported after React migration

## Executive Summary

The unified React operator is causing significant slowness due to **excessive LLM calls per request**. A simple conversational request can trigger **4-8 LLM calls** compared to the previous **1-2 calls**.

### Root Cause

The React loop makes **2 LLM calls per iteration**:
1. `planNextStep()` - Decide what skill to use
2. `checkCompletion()` - Determine if task is done

For a typical conversation that requires 2-3 iterations, this results in **4-6 LLM calls** instead of a single chat response.

## Detailed Analysis

### LLM Call Breakdown

#### Simple Conversational Request: "How are you doing?"

**Legacy Flow** (pre-React):
```
1. shouldUseOperator() → LLM call → "No, just chat" (100-200ms)
2. Direct persona chat → LLM call → Response (150-300ms)
---
Total: 2 LLM calls, ~250-500ms
```

**Current React Flow**:
```
1. Iteration 1:
   a. planNextStep() → LLM call → "Use conversational_response" (100-200ms)
   b. executeSkill('conversational_response') → LLM call → Response (150-300ms)
   c. checkCompletion() → LLM call → "Is complete? true" (50-100ms)

Total: 3 LLM calls, ~300-600ms
```

**Problem**: Even though we eliminated the routing call, we added **completion checking**, resulting in similar or worse latency.

#### Action-Based Request: "List files in docs/"

**Legacy Flow** (Static Planner):
```
1. shouldUseOperator() → LLM call → "Yes, use operator" (100-200ms)
2. Planner → LLM call → "Plan all steps" (200-400ms)
3. Executor → Run skills (no LLM)
4. Critic → LLM call → "Review execution" (150-300ms)
---
Total: 3 LLM calls, ~450-900ms
```

**Current React Flow**:
```
1. Iteration 1:
   a. planNextStep() → LLM call → "Use fs_list" (100-200ms)
   b. executeSkill('fs_list') → No LLM (0ms)
   c. checkCompletion() → LLM call → "Not complete yet" (50-100ms)

2. Iteration 2:
   a. planNextStep() → LLM call → "Use conversational_response with file list" (100-200ms)
   b. executeSkill('conversational_response') → LLM call → Response (150-300ms)
   c. checkCompletion() → LLM call → "Is complete? true" (50-100ms)

3. extractFinalResult() → LLM call → "Synthesize answer" (100-200ms)

---
Total: 6 LLM calls, ~550-1100ms
```

**Problem**: The React loop makes **2 LLM calls per iteration**, and even simple tasks require 2-3 iterations.

### Performance Comparison Table

| Request Type | Legacy | React | Difference |
|-------------|---------|-------|------------|
| **Pure Chat** ("How are you?") | 2 calls, ~300ms | 3 calls, ~400ms | +33% latency |
| **Simple Action** ("List files") | 3 calls, ~600ms | 6 calls, ~800ms | +100% calls, +33% latency |
| **Complex Action** ("Find and summarize files") | 3 calls, ~700ms | 8-10 calls, ~1200ms | +200% calls, +71% latency |

### Latency Breakdown by Function

From audit logs and code analysis:

| Function | Average Latency | Frequency per Request | Total Impact |
|----------|-----------------|----------------------|--------------|
| `planNextStep()` | 100-200ms | 2-3 times | 200-600ms |
| `checkCompletion()` | 50-100ms | 2-3 times | 100-300ms |
| `extractFinalResult()` | 100-200ms | 1 time | 100-200ms |
| `executeSkill()` (conversational_response) | 150-300ms | 1-2 times | 150-600ms |
| **Total** | | | **550-1700ms** |

**Legacy baseline**: ~300-700ms

**Net overhead**: +250-1000ms (83-143% slower)

## Specific Bottlenecks

### 1. Completion Checking on Every Iteration

**Location**: `operator-react.ts:533-614`

```typescript
async function checkCompletion(context: ReActContext): Promise<boolean> {
  // Builds summary of observations
  const observationsSummary = context.steps.map(s => `...`).join('\n');

  // Makes LLM call to determine if complete
  const response = await callLLM({
    role: 'orchestrator',
    messages: [...],
    options: { temperature: 0.2, maxTokens: 200 },
  });

  return parsed.complete === true;
}
```

**Problem**:
- Called after EVERY skill execution
- Even for simple tasks that obviously aren't done (e.g., after first fs_list)
- Adds 50-100ms per iteration
- For 3 iterations = 150-300ms overhead

**Why it's slow**:
- LLM must process entire context every time
- Generates verbose reasoning about completion status
- Temperature 0.2 is good for consistency but not speed

### 2. Over-verbose Planning Prompts

**Location**: `operator-react.ts:274-315`

```typescript
const systemPrompt = `You are a unified reasoning agent...

IMPORTANT RULES:
- Plan ONE step at a time, not multiple steps
- Base your decision on ACTUAL observations from previous steps
- NEVER guess or hallucinate data - only use what you've observed
...

Available Skills:
${skillsContext}  // Lists ALL skills with full descriptions

Goal: ${context.goal}
${context.audience ? `Audience: ${context.audience}` : ''}

${previousStepsContext}  // Full history of all steps

Based on the observations above, what is the NEXT SINGLE ACTION...
`;
```

**Problem**:
- Includes full skill manifest (20+ skills × 3-4 lines each = 60-80 lines)
- Repeats full step history every iteration
- Verbose instructions (necessary for accuracy but slow)

**Token count estimate**:
- System prompt: ~800 tokens
- Previous steps (3 iterations): ~400 tokens
- Total input: ~1200 tokens per planning call

**Why it's slow**:
- Large context window = more tokens to process
- LLM must parse entire skill list every time
- Growing context as steps accumulate

### 3. Final Result Synthesis

**Location**: `operator-react.ts:622-699`

```typescript
async function extractFinalResult(context: ReActContext): Promise<any> {
  // Builds complete context of ALL steps
  const stepsContext = context.steps.map(s => `...`).join('\n\n');

  const systemPrompt = `You are a result synthesizer...

  Steps taken:
  ${stepsContext}  // Full history

  Provide a clear summary of:
  1. What was accomplished
  2. Key findings or data discovered
  3. Any important notes or caveats
  `;

  const response = await callLLM({
    role: 'persona',
    messages: [...],
    options: { temperature: 0.7, maxTokens: 1000 },
  });
}
```

**Problem**:
- Always calls LLM to synthesize results
- Even when last step already produced a good answer (e.g., conversational_response)
- Adds 100-200ms overhead

**Example waste**:
```
Step 2: conversational_response skill executes
  → Returns: "I found 20 files in the docs folder: [list]"

Step 3: extractFinalResult() calls LLM
  → Returns: "I found 20 files in the docs folder: [list]"
  (Identical to step output)
```

### 4. Unnecessary Iterations for Simple Conversations

**Location**: `operator-react.ts:128-176` (main loop)

```typescript
while (!context.completed && context.steps.length < config.maxIterations) {
  const iteration = context.steps.length + 1;

  // 1. THINK
  const thought = await planNextStep(context, config);

  // 2. ACT
  const result = await executeSkill(thought.action, thought.actionInput);

  // 3. OBSERVE
  const observation = formatObservation(result, config);

  // 4. REFLECT
  context.completed = await checkCompletion(context);
}
```

**Problem**: For pure chat ("How are you?"), the operator still:
1. Calls `planNextStep()` → "Use conversational_response"
2. Executes skill → Gets response
3. Calls `checkCompletion()` → "Yes, complete"

**Waste**: Steps 1 and 3 are unnecessary. We could detect pure chat and skip directly to LLM call.

## Root Cause Summary

1. **Completion checking overhead**: 50-100ms × iterations = 150-300ms
2. **Verbose planning prompts**: Large context = slower LLM processing
3. **Unnecessary synthesis**: Duplicate work when skill already produced good output
4. **No fast-path for chat**: Simple conversations go through full React loop

## Impact on User Experience

### Before (Legacy)
- Pure chat: **~300ms** response time
- Simple action: **~600ms** response time
- Users: "System feels snappy"

### After (React)
- Pure chat: **~400-600ms** response time (+33-100%)
- Simple action: **~800-1200ms** response time (+33-100%)
- Users: **"System has become very slow"** ⚠️

### Perceived Slowdown

The issue is compounded by:
1. **Longer tail latency**: React can hit 1200ms vs legacy 700ms max
2. **No early feedback**: User sees nothing until ALL iterations complete
3. **Unpredictable timing**: 3-7 iterations = varying delay

## Memory Impact

Beyond latency, the React operator also increases memory usage:

- **Context accumulation**: Each iteration adds to context
- **Multiple LLM calls**: More simultaneous requests = more memory
- **Step storage**: Full ReActContext with all steps kept in memory

## Recommended Optimizations

See next section for detailed optimization strategies.

## Success Metrics (Current)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Pure chat latency | <300ms | 400-600ms | ❌ MISS |
| Action latency | <600ms | 800-1200ms | ❌ MISS |
| LLM calls per request | 1-3 | 3-8 | ❌ MISS |
| User satisfaction | High | Low | ❌ MISS |

## Next Steps

1. ✅ **Audit complete** - Bottlenecks identified
2. ⏳ **Propose optimizations** - See optimization strategies document
3. ⏳ **Implement fixes** - Prioritize by impact
4. ⏳ **Measure improvements** - Before/after benchmarks
5. ⏳ **User testing** - Confirm perceived speedup

---

**Conclusion**: The React operator's correctness improvements (no hallucinations) came at a steep performance cost. The system is now **33-100% slower** due to excessive LLM calls. Immediate optimization is required to restore acceptable performance.
