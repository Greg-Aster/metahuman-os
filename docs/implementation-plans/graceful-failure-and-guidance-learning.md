# Graceful Failure & Guidance Learning

**Date**: November 14, 2025
**Status**: 📋 DESIGN PHASE
**Priority**: HIGH

## Problem Statement

When the operator encounters errors or gets stuck, it currently:
1. ❌ Returns HTTP 500 error (bad UX)
2. ❌ Times out after 2 minutes with no useful feedback
3. ❌ Provides no way for user to help when stuck
4. ❌ Doesn't learn from failures to prevent future issues

**User Suggestion** (exact quote):
> "When the llm fails its task is there a way to gracefully respond and perhaps learn? Maybe we need a sub function where the ai asks what to do and when we select the request and respond it analyzed the response and saves the memory?"

## Proposed Solution

### Phase 1: Graceful Error Responses (IMMEDIATE)

**Goal**: Stop returning 500 errors, provide helpful feedback

**Changes**:
1. Operator returns structured error object even on failure
2. Frontend displays errors gracefully with context
3. Audit trail captures full failure context

**Implementation**:

```typescript
// operator-react.ts - Detect stuck state
function isOperatorStuck(state: ReactState): {
  stuck: boolean;
  reason: string;
  context: any;
} {
  // Check 1: Repeated failures
  const recentFailures = state.scratchpad.slice(-5)
    .filter(e => e.observation && !e.observation.success);
  if (recentFailures.length >= 3) {
    return {
      stuck: true,
      reason: 'Multiple consecutive failures',
      context: { recentFailures }
    };
  }

  // Check 2: Approaching max iterations with no progress
  const completionActions = state.scratchpad.filter(
    e => e.action?.tool === 'conversational_response'
  );
  if (state.currentStep >= 8 && completionActions.length === 0) {
    return {
      stuck: true,
      reason: 'No progress toward completion',
      context: { iterations: state.currentStep }
    };
  }

  // Check 3: Failure loop (already detected)
  // ... existing logic

  return { stuck: false, reason: '', context: {} };
}

// operator-react.ts - Return structured error
if (isStuck.stuck) {
  return {
    goal,
    result: null,
    error: {
      type: 'stuck',
      reason: isStuck.reason,
      context: isStuck.context,
      scratchpad: state.scratchpad,
      suggestions: [
        'Try breaking the task into smaller steps',
        'Check if required information is available',
        'Consider alternative approaches'
      ]
    },
    metadata: { ... }
  };
}
```

```typescript
// apps/site/src/pages/api/operator.ts - Never return 500
} catch (error) {
  // Return 200 with error details (not 500)
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        type: 'exception',
        message: (error as Error).message,
        stack: process.env.NODE_ENV === 'development'
          ? (error as Error).stack
          : undefined
      }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
```

### Phase 2: Interactive Guidance (FUTURE)

**Goal**: When stuck, ask user for help and learn from response

**User Flow**:

1. **Operator Detects Stuck State**
   - After 3 failures or 8 iterations with no progress
   - Returns special `needGuidance: true` flag

2. **Frontend Shows Guidance Request**
   ```
   🤔 I'm stuck trying to: [goal]

   I've tried:
   - [action 1] → Failed: [error]
   - [action 2] → Failed: [error]
   - [action 3] → No progress

   💬 How would you approach this task?
   [Text input for user guidance]

   Quick options:
   [ Break into smaller steps ]
   [ Try different skill ]
   [ Skip this task ]
   ```

3. **User Provides Guidance**
   - Free-form text explanation
   - OR quick option selection
   - Sent to `/api/operator/guidance` endpoint

4. **System Learns from Guidance**
   ```typescript
   // When guidance received:
   const guidanceMemory = {
     situation: {
       goal: originalGoal,
       attemptedActions: scratchpad.filter(e => e.action),
       errors: scratchpad.filter(e => !e.observation?.success)
     },
     userGuidance: userInput,
     outcome: 'pending' // Will update when retry succeeds
   };

   // Save as episodic memory
   await captureEvent({
     type: 'guidance',
     content: `User guided operator: ${userInput}`,
     metadata: { situation: guidanceMemory }
   });

   // Extract workflow if guidance includes steps
   const workflow = parseGuidanceIntoSteps(userInput);
   if (workflow && workflow.length >= 2) {
     // Create draft function memory
     await detectAndLearnPattern(
       originalGoal,
       workflow,
       { userId, source: 'user_guidance' }
     );
   }

   // Retry with guidance context
   const retry = await runOperatorWithFeatureFlag(
     originalGoal,
     { ...context, userGuidance: userInput }
   );

   // Update guidance memory with outcome
   if (retry.success) {
     guidanceMemory.outcome = 'success';
     // Promote draft function to verified if it worked
   }
   ```

**Data Model**:

```typescript
interface GuidanceRequest {
  conversationId: string;
  operatorRunId: string;
  goal: string;
  scratchpad: ScratchpadEntry[];
  stuckReason: string;
}

interface GuidanceResponse {
  conversationId: string;
  operatorRunId: string;
  guidance: string;
  action: 'retry_with_guidance' | 'break_into_steps' | 'try_different_skill' | 'skip';
  suggestedSteps?: string[]; // If user breaks into steps
}
```

**API Endpoints**:

```typescript
// POST /api/operator/guidance
// Receives user guidance, learns, and retries
export const POST = async ({ request }) => {
  const { operatorRunId, guidance, action } = await request.json();

  // Load original context
  const originalRun = await loadOperatorRun(operatorRunId);

  // Save guidance as episodic memory
  const guidanceEvent = await captureEvent({
    type: 'guidance',
    content: `User guidance: ${guidance}`,
    metadata: { originalGoal: originalRun.goal, scratchpad: originalRun.scratchpad }
  });

  // Attempt to extract workflow
  const extractedWorkflow = await extractWorkflowFromGuidance(guidance);

  if (extractedWorkflow) {
    // Learn as draft function
    await createDraftFunction(originalRun.goal, extractedWorkflow);
  }

  // Retry with guidance context
  const retryResult = await runOperatorWithGuidance(
    originalRun.goal,
    originalRun.context,
    guidance
  );

  return new Response(JSON.stringify({
    success: true,
    learned: !!extractedWorkflow,
    retryResult
  }));
};
```

### Phase 3: Proactive Guidance Learning (ADVANCED)

**Goal**: Learn from successful user interventions to prevent future stuck states

**Features**:
1. **Pattern Recognition**: Detect when users repeatedly provide similar guidance
2. **Auto-Suggestions**: Offer learned patterns as quick options
3. **Confidence Scoring**: Track which guidance patterns lead to success
4. **Preventive Learning**: Update function memory before getting stuck next time

**Example**:
```
Situation: Operator tried fs_read on non-existent file 3 times
User Guidance: "Use fs_list first to see what files exist, then read"

Learning:
✓ Created function: "List files before reading"
✓ Quality score: 100% (user-verified)
✓ Auto-applied next time similar situation occurs
```

## Implementation Plan

### Immediate (Today)

- [ ] Add `isOperatorStuck()` detection function
- [ ] Return structured error objects instead of exceptions
- [ ] Change API error responses from 500 to 200 with error details
- [ ] Add "stuck" state UI display in ChatInterface.svelte

### Short-Term (This Week)

- [ ] Create `/api/operator/guidance` endpoint
- [ ] Add guidance request UI component
- [ ] Implement basic guidance → episodic memory flow
- [ ] Test with manual guidance scenarios

### Medium-Term (Next Week)

- [ ] Implement workflow extraction from free-form guidance
- [ ] Auto-create draft functions from successful guidance
- [ ] Add guidance history view in Memory tab
- [ ] Add "quick guidance" buttons for common stuck states

### Long-Term (Future)

- [ ] Pattern recognition for repeated guidance
- [ ] Confidence scoring for guidance effectiveness
- [ ] Proactive suggestion system
- [ ] Integration with function memory quality scoring

## Success Metrics

1. **User Experience**:
   - Zero HTTP 500 errors from operator
   - Stuck state detected within 3 failures
   - User can provide guidance in <30 seconds

2. **Learning Effectiveness**:
   - 80% of user guidance creates valid function memory
   - 50% of created functions reused within 1 week
   - Stuck rate decreases 30% after 10 guidance sessions

3. **System Reliability**:
   - All operator errors logged to audit trail
   - No silent failures (every error has context)
   - Recovery success rate >70%

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| User guidance is vague | Failed learning | Prompt with examples, require structured input |
| Guidance creates bad functions | Pollution | Keep as drafts, require manual verification |
| Adds friction to UX | User annoyance | Only trigger on truly stuck state (3+ failures) |
| Complex to implement | Delays delivery | Phase 1 first (graceful errors), rest iterative |

## Related Work

- **Function Memory System**: Will use existing infrastructure
- **Episodic Memory**: Guidance stored as new event type
- **Audit System**: Full trail of stuck states and guidance
- **ReAct V2**: Already has failure loop detection

## Files to Modify

- [x] [brain/agents/operator-react.ts](../../brain/agents/operator-react.ts) - Add stuck detection
- [x] [apps/site/src/pages/api/operator.ts](../../apps/site/src/pages/api/operator.ts) - Graceful errors
- [ ] [apps/site/src/pages/api/operator/guidance.ts](../../apps/site/src/pages/api/operator/guidance.ts) - New endpoint
- [ ] [apps/site/src/components/ChatInterface.svelte](../../apps/site/src/components/ChatInterface.svelte) - Guidance UI
- [ ] [packages/core/src/memory.ts](../../packages/core/src/memory.ts) - New 'guidance' event type

## Next Steps

1. Review this design with user
2. Implement Phase 1 (graceful errors) immediately
3. Create guidance UI mockup for feedback
4. Build Phase 2 incrementally with testing
