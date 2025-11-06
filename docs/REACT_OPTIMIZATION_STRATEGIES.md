# ReAct Operator - Optimization Strategies

**Date**: November 5, 2025
**Priority**: 🔴 **HIGH** - Critical performance issue
**Goal**: Reduce latency by 40-60% while preserving correctness benefits

## Overview

This document outlines concrete optimization strategies to address the performance bottlenecks identified in the React operator audit. Each strategy is ranked by **Impact** (latency reduction) and **Effort** (implementation complexity).

## Quick Wins (High Impact, Low Effort)

### 1. Smart Completion Detection (Skip LLM Call)

**Impact**: 🟢🟢🟢 High (-150-300ms per request)
**Effort**: 🟢 Low (1-2 hours)
**Risk**: Low

**Current behavior**:
```typescript
// After EVERY skill execution
context.completed = await checkCompletion(context);  // LLM call: 50-100ms
```

**Problem**: Makes LLM call even when completion is obvious:
- After `conversational_response` skill → Obviously complete
- After first `fs_list` → Obviously not complete
- After error → Obviously not complete

**Optimization**:
```typescript
async function checkCompletion(context: ReActContext): Promise<boolean> {
  const lastStep = context.steps[context.steps.length - 1];

  // Fast-path: Deterministic completion rules
  if (lastStep.action === 'conversational_response' && lastStep.observation.startsWith('Success')) {
    // Conversational responses are always terminal
    audit({ event: 'completion_check_fastpath', details: { reason: 'conversational_response_success' } });
    return true;
  }

  if (lastStep.observation.startsWith('Error:')) {
    // Errors require adaptation, not completion
    audit({ event: 'completion_check_fastpath', details: { reason: 'error_not_complete' } });
    return false;
  }

  if (context.steps.length === 1 && lastStep.action.startsWith('fs_')) {
    // First file system action is never complete (need to respond to user)
    audit({ event: 'completion_check_fastpath', details: { reason: 'first_fs_action' } });
    return false;
  }

  // Fall back to LLM for ambiguous cases
  audit({ event: 'completion_check_llm', details: { reason: 'ambiguous' } });
  return await checkCompletionWithLLM(context);
}
```

**Benefits**:
- Eliminates 50-100ms per iteration for obvious cases
- Typical 3-iteration task: Saves 100-200ms (2 fast-paths, 1 LLM call)
- Reduces LLM calls from 3 to 1 per request

**Testing**:
```bash
# Test conversational_response fast-path
curl -X POST /api/operator/react -d '{"goal":"How are you?"}'
# Expected: 1 checkCompletion LLM call instead of 1

# Test fs_list fast-path
curl -X POST /api/operator/react -d '{"goal":"List files in docs/"}'
# Expected: 1 checkCompletion LLM call instead of 2
```

### 2. Skip Final Synthesis for Terminal Skills

**Impact**: 🟢🟢🟢 High (-100-200ms per request)
**Effort**: 🟢 Low (30 minutes)
**Risk**: Very Low

**Current behavior**:
```typescript
if (context.completed) {
  context.result = await extractFinalResult(context);  // Always calls LLM
}
```

**Problem**: The `extractFinalResult()` function **always** calls the LLM to synthesize results, even when the last skill already produced a perfect response.

**Example waste**:
```
User: "How are you doing today?"

Step 1: conversational_response executes
  → Output: "I'm doing well, thanks for asking! How can I help you today?"

extractFinalResult() calls LLM:
  → Output: "I'm doing well, thanks for asking! How can I help you today?"
  (Identical, wasted 100-200ms)
```

**Optimization**:
```typescript
async function extractFinalResult(context: ReActContext): Promise<any> {
  const lastStep = context.steps[context.steps.length - 1];

  // If last step was a terminal skill (conversational_response), use its output directly
  const terminalSkills = ['conversational_response'];

  if (terminalSkills.includes(lastStep.action) && lastStep.observation.startsWith('Success')) {
    audit({ event: 'result_extraction_skipped', details: { reason: 'terminal_skill_output' } });

    // Extract the actual response from the observation
    // Format: "Success. Output: <response>"
    const match = lastStep.observation.match(/Output:\s*(.+)/s);
    if (match) {
      return match[1].trim();
    }
  }

  // Fall back to LLM synthesis for complex multi-step results
  audit({ event: 'result_extraction_llm', details: { reason: 'multi_step_synthesis_needed' } });
  return await synthesizeResultWithLLM(context);
}
```

**Benefits**:
- Eliminates 100-200ms for pure conversational requests
- Reduces LLM calls from 3 to 2 for simple conversations
- No quality loss (output is identical)

### 3. Detect Pure Chat and Use Fast-Path

**Impact**: 🟢🟢🟢 High (-200-400ms for chat)
**Effort**: 🟢 Low (1 hour)
**Risk**: Low

**Current behavior**:
ALL requests go through full React loop, even simple conversations.

**Optimization**: Add a pre-check before entering React loop:

```typescript
export async function runReActLoop(
  task: OperatorTask,
  onProgress?: (step: ReActStep) => void,
  reasoningDepth?: number
): Promise<ReActContext> {
  const config = loadConfig();

  // FAST-PATH: Detect pure conversational requests
  const isPureChat = await detectPureChat(task.goal);

  if (isPureChat && !config.forceFullLoop) {
    audit({ event: 'react_fastpath_chat', details: { goal: task.goal } });

    // Skip React loop entirely, call conversational_response directly
    const result = await coreExecuteSkill(
      'conversational_response',
      { message: task.goal, context: '' },
      'bounded_auto',
      true
    );

    return {
      goal: task.goal,
      audience: task.audience,
      steps: [{
        iteration: 1,
        thought: 'Direct conversational response (fast-path)',
        action: 'conversational_response',
        actionInput: { message: task.goal },
        observation: formatObservation(result, config),
        timestamp: new Date().toISOString(),
      }],
      completed: true,
      result: result.outputs?.response || result.outputs,
    };
  }

  // Continue with normal React loop for complex tasks
  // ... existing code ...
}

async function detectPureChat(goal: string): Promise<boolean> {
  // Simple heuristic patterns for obvious chat
  const chatPatterns = [
    /^(hi|hey|hello|howdy|greetings)/i,
    /how (are|is) (you|it|things)/i,
    /what('s| is) up/i,
    /^(thanks|thank you)/i,
    /^(good morning|good afternoon|good evening)/i,
    /(tell me about|what is|explain|who is|why)/i,  // Questions
  ];

  if (chatPatterns.some(p => p.test(goal))) {
    return true;
  }

  // Action patterns that definitely need React loop
  const actionPatterns = [
    /(list|find|search|look for|show me|get|read|write|create|delete)/i,
    /(file|task|document|folder|directory)/i,
  ];

  if (actionPatterns.some(p => p.test(goal))) {
    return false;
  }

  // For ambiguous cases, use a lightweight LLM call (still faster than full React loop)
  // OR just default to React loop (safer)
  return false;
}
```

**Benefits**:
- Pure chat: 1 LLM call instead of 3 (400ms → 200ms)
- Eliminates 2 unnecessary LLM calls (planNextStep, checkCompletion)
- Covers ~40-60% of requests (many are conversational)

**Trade-offs**:
- Adds ~1ms for pattern matching
- May occasionally miss-classify (safe: defaults to React loop)

## Medium Impact Optimizations

### 4. Reduce Planning Prompt Token Count

**Impact**: 🟢🟢 Medium (-50-100ms per iteration)
**Effort**: 🟡 Medium (2-3 hours)
**Risk**: Medium (may reduce planning quality)

**Current problem**: Planning prompt includes:
- Full skill manifest (~800 tokens)
- All previous steps (~100 tokens × iterations)
- Verbose instructions (~200 tokens)

**Optimization A**: Skill Filtering
```typescript
async function planNextStep(context: ReActContext, config: ReActConfig) {
  // Instead of listing ALL skills, filter to relevant ones
  const allSkills = listSkills();

  // Categorize skills
  const fileSkills = allSkills.filter(s => s.category === 'filesystem');
  const taskSkills = allSkills.filter(s => s.category === 'tasks');
  const conversationalSkills = allSkills.filter(s => s.id === 'conversational_response');

  // Detect goal category
  const goalCategory = categorizeGoal(context.goal);

  // Include only relevant skills
  let relevantSkills = conversationalSkills; // Always include
  if (goalCategory.includes('file')) relevantSkills.push(...fileSkills);
  if (goalCategory.includes('task')) relevantSkills.push(...taskSkills);

  // Build prompt with filtered skills (reduces from 20 to ~5-8 skills)
  const skillsContext = relevantSkills.map(s => `...`).join('\n');
  // ... rest of prompt
}

function categorizeGoal(goal: string): string[] {
  const categories = [];
  if (/\b(file|folder|directory|document|read|write|list)\b/i.test(goal)) {
    categories.push('file');
  }
  if (/\b(task|todo|reminder)\b/i.test(goal)) {
    categories.push('task');
  }
  if (/\b(search|web|google|find online)\b/i.test(goal)) {
    categories.push('web');
  }
  return categories.length > 0 ? categories : ['conversational'];
}
```

**Benefits**:
- Reduces skill manifest from ~800 to ~200-300 tokens
- Faster LLM processing (fewer tokens to parse)
- Estimated savings: 30-50ms per planning call

**Trade-off**:
- May miss edge cases where user's language doesn't match category
- Mitigation: Keep conversational_response always available as fallback

**Optimization B**: Compress Step History
```typescript
// Instead of full step verbosity:
// "Iteration 1: Thought: I need to... Action: fs_list({pattern: '...'}) Observation: Found 20 files..."

// Use concise format:
// "1. fs_list → 20 files found"

const previousStepsContext = context.steps.map((s, i) =>
  `${i + 1}. ${s.action} → ${s.observation.substring(0, 80)}${s.observation.length > 80 ? '...' : ''}`
).join('\n');
```

**Benefits**:
- Reduces context from ~400 to ~100 tokens for 3 steps
- Faster LLM processing

### 5. Parallel LLM Calls (Where Safe)

**Impact**: 🟢🟢 Medium (-50-100ms per request)
**Effort**: 🟡 Medium (3-4 hours)
**Risk**: Medium (complexity)

**Current behavior**: All LLM calls are sequential:
```typescript
const thought = await planNextStep(...);  // Wait
const result = await executeSkill(...);    // Wait
const complete = await checkCompletion(...); // Wait
```

**Optimization**: When safe, run LLM calls in parallel:

```typescript
// Example: After last skill execution, we can check completion and plan next step in parallel

if (!isObviouslyComplete && !isObviouslyIncomplete) {
  // These don't depend on each other
  const [isComplete, nextPlan] = await Promise.all([
    checkCompletion(context),
    planNextStep(context, config),  // Speculative planning
  ]);

  if (isComplete) {
    // Discard nextPlan, proceed to result extraction
  } else {
    // Use pre-computed nextPlan
    context.steps.push(await executeStep(nextPlan));
  }
}
```

**Benefits**:
- Saves 50-100ms per iteration (parallel instead of sequential)
- Reduces wall-clock time even though total LLM time is same

**Trade-offs**:
- Wastes 1 LLM call if speculative planning isn't used
- More complex code
- Need to carefully avoid race conditions

**Recommendation**: **Skip this optimization** for now. The complexity doesn't justify the modest gains.

## Low Priority Optimizations

### 6. LLM Model Selection (Temperature/MaxTokens Tuning)

**Impact**: 🟡 Low (-10-30ms per call)
**Effort**: 🟢 Low (30 minutes)
**Risk**: Very Low

**Current settings**:
```typescript
// Planning
temperature: 0.3
maxTokens: 1000

// Completion checking
temperature: 0.2
maxTokens: 200

// Result synthesis
temperature: 0.7
maxTokens: 1000
```

**Optimization**: Reduce maxTokens for completion checking:
```typescript
// Completion checking only needs a short JSON response
temperature: 0.2
maxTokens: 50  // Was 200
```

**Benefits**:
- Faster generation (50 tokens vs 200)
- Estimated savings: 10-20ms per completion check

### 7. Caching Planning Prompts

**Impact**: 🟡 Low (-20-40ms per call)
**Effort**: 🔴 High (requires LLM provider support)
**Risk**: Low

**Idea**: Some LLM providers (Anthropic Claude) support prompt caching. The skill manifest and instructions rarely change.

**Implementation**:
- Mark skill manifest as cacheable
- First request: Full cost
- Subsequent requests: Use cached manifest

**Blockers**:
- Requires provider support
- May not work with Ollama (local LLM)

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1)
✅ = Recommended for immediate implementation

1. ✅ **Smart Completion Detection** (Strategy #1)
   - Effort: 2 hours
   - Impact: -150-300ms
   - Priority: **CRITICAL**

2. ✅ **Skip Final Synthesis** (Strategy #2)
   - Effort: 30 minutes
   - Impact: -100-200ms
   - Priority: **CRITICAL**

3. ✅ **Pure Chat Fast-Path** (Strategy #3)
   - Effort: 1 hour
   - Impact: -200-400ms for 40% of requests
   - Priority: **HIGH**

**Expected Results After Phase 1**:
- Pure chat: 600ms → **250ms** (58% faster) ✅
- Simple action: 1000ms → **600ms** (40% faster) ✅
- User satisfaction: Restored to acceptable levels

### Phase 2: Medium Optimizations (Week 2)

4. **Reduce Planning Prompt** (Strategy #4)
   - Effort: 3 hours
   - Impact: -50-100ms
   - Priority: **MEDIUM**

**Expected Results After Phase 2**:
- Pure chat: 250ms → **200ms**
- Simple action: 600ms → **500ms**
- Total improvement from baseline: 67-75% faster

### Phase 3: Polish (Week 3+)

5. **LLM Parameter Tuning** (Strategy #6)
   - Effort: 30 minutes
   - Impact: -10-30ms
   - Priority: LOW

6. **Prompt Caching** (Strategy #7)
   - Effort: High (provider-dependent)
   - Impact: -20-40ms
   - Priority: BACKLOG

## Testing & Validation

### Performance Benchmarks

Create automated benchmarks:

```typescript
// tests/benchmark-react-performance.ts

const testCases = [
  { name: 'Pure Chat', goal: 'How are you doing today?', expectedIterations: 1, maxLatency: 300 },
  { name: 'Simple Action', goal: 'List files in docs/', expectedIterations: 2, maxLatency: 600 },
  { name: 'Complex Action', goal: 'Find user guide and summarize it', expectedIterations: 4, maxLatency: 1200 },
];

for (const tc of testCases) {
  const start = Date.now();
  const result = await runReActLoop({ id: '1', goal: tc.goal, status: 'in_progress', created: new Date().toISOString() });
  const latency = Date.now() - start;

  console.log(`${tc.name}:`);
  console.log(`  Iterations: ${result.steps.length} (expected: ${tc.expectedIterations})`);
  console.log(`  Latency: ${latency}ms (max: ${tc.maxLatency}ms)`);
  console.log(`  Status: ${latency <= tc.maxLatency ? 'PASS' : 'FAIL'}`);
}
```

### Before/After Metrics

| Metric | Baseline (Pre-Optimization) | Phase 1 Target | Phase 2 Target |
|--------|----------------------------|----------------|----------------|
| Pure Chat Latency | 600ms | 250ms (-58%) | 200ms (-67%) |
| Simple Action Latency | 1000ms | 600ms (-40%) | 500ms (-50%) |
| Complex Action Latency | 1500ms | 1000ms (-33%) | 800ms (-47%) |
| LLM Calls (Chat) | 3 | 1 | 1 |
| LLM Calls (Action) | 6 | 3 | 2-3 |
| User Satisfaction | Low | Medium | High |

## Monitoring & Alerts

Add audit logging to track optimization effectiveness:

```typescript
audit({
  level: 'info',
  category: 'performance',
  event: 'react_performance_metrics',
  details: {
    totalLatency,
    iterationCount,
    llmCallCount,
    fastPathsUsed: ['completion_detection', 'terminal_skill_output'],
    slowPathsUsed: ['llm_synthesis_needed'],
  },
  actor: 'operator-react',
});
```

## Risk Mitigation

### Correctness Preservation

All optimizations must preserve the core React benefits:
- ✅ No hallucinated data
- ✅ Observation-based planning
- ✅ Dynamic adaptation

**Testing checklist**:
- [ ] No hallucinated filenames (original bug)
- [ ] Still adapts when skills fail
- [ ] Still uses observed data only
- [ ] Completion detection is accurate (no false positives)

### Rollback Plan

If optimizations cause issues:

1. **Feature flags**: Each optimization behind a flag
   ```typescript
   const ENABLE_COMPLETION_FASTPATH = process.env.REACT_OPT_COMPLETION !== 'false';
   const ENABLE_SYNTHESIS_SKIP = process.env.REACT_OPT_SYNTHESIS !== 'false';
   const ENABLE_CHAT_FASTPATH = process.env.REACT_OPT_CHAT_FASTPATH !== 'false';
   ```

2. **Gradual rollout**: Enable one optimization at a time
3. **Monitoring**: Watch error rates and user feedback
4. **Quick disable**: Set env var to disable problematic optimization

## Success Criteria

**Phase 1 Complete When**:
- ✅ Pure chat latency < 300ms (currently 600ms)
- ✅ Simple action latency < 700ms (currently 1000ms)
- ✅ LLM calls for chat reduced from 3 to 1-2
- ✅ No regressions in correctness tests
- ✅ User feedback improves from "slow" to "acceptable"

**Phase 2 Complete When**:
- ✅ Pure chat latency < 250ms
- ✅ Simple action latency < 600ms
- ✅ 90th percentile latency < 1000ms
- ✅ User feedback improves to "fast"

## Conclusion

The React operator performance issue can be resolved with **3 high-impact, low-effort optimizations** in Phase 1:

1. Smart completion detection (skip unnecessary LLM calls)
2. Skip final synthesis for terminal skills
3. Fast-path for pure conversational requests

These changes will reduce latency by **40-60%** and restore acceptable performance while preserving all the correctness benefits of the React pattern.

**Estimated time to implement Phase 1**: 3-4 hours
**Expected user impact**: Immediate perceived speedup from "slow" to "acceptable"

---

**Next Steps**:
1. Implement Phase 1 optimizations
2. Run benchmarks (before/after)
3. Deploy and monitor
4. Collect user feedback
5. Decide whether Phase 2 is needed based on metrics
