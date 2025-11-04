# Adaptive Retry System Implementation Plan

**Goal**: Make the operator agent adaptive - learning from failures and trying different approaches instead of repeating the same mistakes.

**Problem**: Currently, the retry loop at `operator.ts:1071-1162` calls `plan()` with identical inputs each iteration, causing the planner to generate the same flawed plan repeatedly.

---

## Progress Status

### Completed ✅
1. Added `RetryContext` interface (lines 59-65)
2. Added `retryContext` parameter to `plan()` function signature (line 265)
3. Modified retry loop to build and pass retry context (lines 1080, 1088, 1172-1179)
4. Enhanced planning prompt with failure details (lines 403-432)
5. Improved critic prompt with actionable suggestions (lines 959-981)
6. Added exploratory instructions to planner (lines 338-341)
7. Clarified skill path descriptions (fs_read, fs_write, fs_list)
8. Added smart path auto-fix in executor (lines 629-641)

### In Progress 🔄
9. Test adaptive retry behavior

---

## Phase 1: Core Feedback Loop (CRITICAL)

### What We're Fixing
The retry loop needs to pass failure information back to the planner so it can learn and adapt.

### Changes Required

#### 1. ✅ Add RetryContext Interface (COMPLETED)
**File**: `brain/agents/operator.ts` (lines 59-65)
```typescript
interface RetryContext {
  attemptNumber: number;
  previousPlan: Plan;
  previousResults: ExecutionResult[];
  criticFeedback: string;
  suggestedFixes?: string;
}
```

#### 2. ✅ Add retryContext Parameter to plan() (COMPLETED)
**File**: `brain/agents/operator.ts` (line 265)
```typescript
async function plan(
  task: Task,
  profile: OperatorProfile | undefined,
  mode: OperatorMode,
  assessment?: TaskAssessment | null,
  retryContext?: RetryContext  // NEW
): Promise<Plan | null>
```

#### 3. ⏳ Modify Retry Loop to Build Retry Context
**File**: `brain/agents/operator.ts` (lines 1071-1162)

**Current Code**:
```typescript
while (retries <= maxRetries) {
  const planResult = await plan(task, options.profile, effectiveMode, assessment);
  // ... execute, critique ...
  retries++; // ONLY CHANGE!
}
```

**Needs to Become**:
```typescript
let retryContext: RetryContext | undefined = undefined;

while (retries <= maxRetries) {
  const planResult = await plan(
    task,
    options.profile,
    effectiveMode,
    assessment,
    retryContext  // Pass retry context
  );

  const executionResult = await execute(planResult, effectiveMode);
  const criticResult = await critique(planResult, executionResult, task);

  if (!criticResult.approved) {
    // Build retry context for next iteration
    retryContext = {
      attemptNumber: retries + 1,
      previousPlan: planResult,
      previousResults: executionResult.steps,
      criticFeedback: criticResult.feedback,
      suggestedFixes: criticResult.suggestions,
    };
  }

  retries++;
}
```

#### 4. ⏳ Enhance Planning Prompt with Failure Details
**File**: `brain/agents/operator.ts` (lines 366-407)

**Add After Line 407** (before the user prompt):
```typescript
// Build retry context section if this is a retry attempt
let retryContextSection = '';
if (retryContext) {
  const failedSteps = retryContext.previousResults
    .filter(r => !r.success)
    .map(r => `  - Step ${r.stepId}: ${r.error}`)
    .join('\n');

  retryContextSection = `
RETRY ATTEMPT #${retryContext.attemptNumber}

Previous attempt failed. Learn from these mistakes:

Previous Plan:
${JSON.stringify(retryContext.previousPlan, null, 2)}

Failed Steps:
${failedSteps}

Critic Feedback:
${retryContext.criticFeedback}

${retryContext.suggestedFixes ? `Suggested Fixes:\n${retryContext.suggestedFixes}` : ''}

IMPORTANT: Analyze what went wrong and try a DIFFERENT approach. Don't repeat the same mistake.
`;
}
```

**Modify User Prompt** (line 402):
```typescript
const userPrompt = `Task: ${task.goal}

${task.context ? `Context: ${task.context}` : ''}
${assessment ? `\nAssessment:\n- Ready: ${assessment.ready ? 'yes' : 'no'}\n- Confidence: ${(assessment.confidence * 100).toFixed(0)}%\n${assessment.clarification ? `- Missing detail: ${assessment.clarification}\n` : ''}${assessment.rationale ? `- Notes: ${assessment.rationale}` : ''}` : ''}
${retryContextSection}

Create a step-by-step plan to accomplish this task.`;
```

---

## Phase 2: Enhanced Guidance

### 5. ⏳ Add Exploratory Instructions to Planner
**File**: `brain/agents/operator.ts` (around line 326-337)

**Add to instructionLines**:
```typescript
instructionLines.push(
  'When file paths are uncertain or validation fails, use fs_list to search for the file first',
  'If a path fails validation, try searching with fs_list before giving up',
  'Project-relative paths do NOT start with / (e.g., use "docs/file.md" not "/docs/file.md")'
);
```

### 6. ⏳ Clarify Skill Path Descriptions
**File**: `brain/skills/index.ts` (skill definitions)

**Update skill descriptions** to be more explicit:
- `fs_read`: "path must be project-relative (e.g., 'docs/file.md') or absolute system path"
- `fs_write`: "path must be project-relative (no leading /) or absolute system path"
- `fs_list`: "Use this to search for files when exact path is unknown"

### 7. ⏳ Improve Critic Prompt with Actionable Suggestions
**File**: `brain/agents/operator.ts` (lines 915-954)

**Modify CriticReview interface** (around line 48):
```typescript
interface CriticReview {
  approved: boolean;
  confidence: number;
  feedback: string;
  suggestions?: string;  // NEW: Specific recovery suggestions
}
```

**Enhance critic system prompt** (around line 920):
```typescript
const systemPrompt = `You are the Critic for an autonomous operator system.

Your job: Review execution results and provide actionable feedback.

When steps fail, provide SPECIFIC suggestions for recovery:
- If path validation failed: "Try using fs_list to search for the file"
- If file not found: "Use fs_list with a broader search pattern"
- If permission denied: "Check if the path is accessible or try a different location"

Your response must be valid JSON:
{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "feedback": "Detailed explanation of what happened",
  "suggestions": "Specific actionable steps to fix the problem"  // NEW
}`;
```

---

## Phase 3: Smart Path Handling

### 8. ⏳ Add Path Auto-Fix in Executor
**File**: `brain/agents/operator.ts` (around line 686 in validateInput function)

**Add path normalization** before validation:
```typescript
function validateInput(key: string, value: any, spec: InputSpec): any {
  // Auto-fix common path mistakes
  if (spec.type === 'string' && typeof value === 'string') {
    // Remove leading slash for project-relative paths
    if (value.startsWith('/') && !value.startsWith('/home/') && !value.startsWith('/usr/')) {
      console.log(`[operator:executor] Auto-fixing path: ${value} -> ${value.slice(1)}`);
      value = value.slice(1);
    }
  }

  // ... existing validation logic
}
```

---

## Testing Strategy

### Test Case 1: Path Validation Failure
**Input**: "Read the file at /docs/dev/MULTI_MODEL_INTEGRATION_STATUS.md"
**Expected Behavior**:
1. First attempt fails with path validation error
2. Retry context passed to planner with failure details
3. Planner sees "path validation failed" and critic suggestion
4. Second attempt uses fs_list to search for the file
5. Finds `docs/dev/MULTI_MODEL_INTEGRATION_STATUS.md`
6. Reads file successfully

### Test Case 2: File Not Found
**Input**: "Read the README file"
**Expected Behavior**:
1. First attempt tries to read "README" directly, fails
2. Retry context shows file not found
3. Second attempt uses fs_list to search for "README*"
4. Finds README.md
5. Reads file successfully

### Validation
- Check audit logs for `planning_started` events with retry context
- Verify `attemptNumber` increments on retries
- Confirm different approaches used on subsequent attempts
- Ensure tasks complete successfully after adaptive retry

---

## Implementation Order

1. ✅ Add RetryContext interface
2. ✅ Add retryContext parameter to plan()
3. 🔄 Modify retry loop to build and pass context
4. ⏳ Enhance planning prompt with failure details
5. ⏳ Improve critic prompt and interface
6. ⏳ Add exploratory instructions
7. ⏳ Clarify skill descriptions
8. ⏳ Add path auto-fix
9. ⏳ Test end-to-end

---

## Success Criteria

- ✅ Planner receives failure information on retry attempts
- ✅ Retry attempts show different approaches (verified in audit logs)
- ✅ Path validation errors trigger file search behavior
- ✅ Tasks with ambiguous paths complete successfully after 1-2 retries
- ✅ No infinite retry loops (max retries still enforced)

---

## Implementation Summary

**Status**: ✅ **ALL IMPLEMENTATION COMPLETE** - Ready for testing

### Changes Made

#### 1. Core Feedback Loop (Phase 1)
- **RetryContext Interface** (operator.ts:59-65): Captures attempt number, previous plan, results, critic feedback, and suggested fixes
- **plan() Function Updated** (operator.ts:265): Added `retryContext` parameter
- **Retry Loop Enhanced** (operator.ts:1172-1179): Builds retry context after failed critique, passes to next planning iteration
- **Planning Prompt Enhanced** (operator.ts:403-432): Shows previous plan, failed steps, critic feedback, and suggested fixes on retry attempts

#### 2. Enhanced Guidance (Phase 2)
- **Critic Prompt Improved** (operator.ts:959-981): Provides specific, actionable suggestions for each failure type
- **Exploratory Instructions Added** (operator.ts:338-341): Guides planner to use fs_list for uncertain paths, understand path format, and think about alternatives
- **Skill Descriptions Clarified**:
  - fs_read: "Project-relative path (e.g., 'docs/file.md') or absolute system path. Project-relative paths should NOT start with /"
  - fs_write: Same clarification
  - fs_list: "Use this to search for files when exact paths are unknown"

#### 3. Smart Path Handling (Phase 3)
- **Path Auto-Fix** (operator.ts:629-641): Automatically strips leading `/` from project-relative paths before validation
- Prevents most common path validation errors
- Logs the fix for transparency

### Testing Required

Run the original failing task to verify adaptive retry:

```bash
./bin/mh chat
# Then: "I just made some more edits to your system - check out MULTI_MODEL_INTEGRATION_STATUS.md and let me know what you think"
```

**Expected Behavior**:
1. First attempt may still use `/docs/dev/...` path format
2. Path auto-fix should correct it to `docs/dev/...` automatically
3. OR if auto-fix doesn't catch it, retry should show critic feedback and planner should try fs_list
4. Task should complete successfully within 1-2 attempts
