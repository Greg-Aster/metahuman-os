# ReAct Loop Migration Plan

## Problem Statement

The current operator agent uses a **static planning** approach:
1. Planner creates all steps upfront (without seeing any results)
2. Executor blindly follows the plan
3. Critic reviews after completion (too late to fix errors)

This causes issues like **hallucinated filenames** - the planner invents file paths instead of observing actual `fs_list` results.

## Solution: Modern ReAct Loop

Implement the **Reason + Act** pattern used by ChatGPT, Claude Code, Cursor, and other modern LLM agents.

### Core Architecture

```typescript
interface ReActStep {
  iteration: number;
  thought: string;          // "I need to list files first"
  action: string;           // "fs_list"
  actionInput: object;      // { pattern: "docs/**/*" }
  observation: string;      // "Found 20 files: [docs/README.md, ...]"
  reasoning?: string;       // Optional deep reasoning
}

interface ReActContext {
  goal: string;
  steps: ReActStep[];
  completed: boolean;
  result?: any;
}
```

### The ReAct Loop

```typescript
async function runReActLoop(task: Task): Promise<ReActContext> {
  const context = {
    goal: task.goal,
    steps: [],
    completed: false
  };

  while (!context.completed && context.steps.length < MAX_ITERATIONS) {
    // 1. THINK: What should I do next?
    const thought = await planNextStep(context);

    // 2. ACT: Execute one skill
    const result = await executeSkill(thought.action, thought.actionInput);

    // 3. OBSERVE: Record what happened
    const step = {
      iteration: context.steps.length + 1,
      thought: thought.reasoning,
      action: thought.action,
      actionInput: thought.actionInput,
      observation: formatObservation(result),
      reasoning: thought.deepReasoning
    };
    context.steps.push(step);

    // 4. REFLECT: Am I done?
    context.completed = await checkCompletion(context);
  }

  return context;
}
```

## Implementation Phases

### Phase 1: Core ReAct Engine
**File**: `brain/agents/operator-react.ts`

Create the fundamental ReAct loop with:
- `runReActLoop()` - Main loop coordinator
- `planNextStep()` - Single-step planning with observation context
- `formatObservation()` - Convert skill results to human-readable context
- `checkCompletion()` - Detect when goal is achieved
- Configuration: `MAX_ITERATIONS = 10`, `ENABLE_DEEP_REASONING = false`

### Phase 2: LLM Integration
**Location**: `brain/agents/operator-react.ts`

Implement LLM prompts for:
- **Single-step planner**: Given goal + all previous observations, what's the next action?
- **Completion detector**: Given goal + observations, is the task complete?
- **Observation formatter**: Convert raw skill results into natural language summaries

Prompt structure:
```typescript
const REACT_PLANNER_PROMPT = `
You are planning the NEXT SINGLE STEP for this task.

Goal: ${context.goal}

Previous steps:
${context.steps.map(s => `
  Iteration ${s.iteration}:
  Thought: ${s.thought}
  Action: ${s.action}(${JSON.stringify(s.actionInput)})
  Observation: ${s.observation}
`).join('\n')}

Based on the observations above, what is the NEXT SINGLE ACTION you should take?
Do NOT plan multiple steps - just decide the immediate next action.

Return JSON: { "thought": "...", "action": "skill_name", "actionInput": {...} }
`;
```

### Phase 3: UI Integration
**File**: `apps/site/src/pages/api/operator/react.ts`

Create new API endpoint that:
- Accepts task via POST
- Runs ReAct loop
- Streams progress using Server-Sent Events
- Maps ReAct steps to existing reasoning UI

Mapping to existing UI:
```typescript
// Map ReAct steps to reasoningStages array
const reasoningStages = context.steps.map(step => ({
  stage: `Step ${step.iteration}`,
  content: step.thought,
  action: step.action,
  observation: step.observation,
  deepReasoning: step.reasoning || undefined
}));
```

### Phase 4: Skills Enhancement
**Location**: `brain/skills/*`

Enhance skill return values for better observations:
- `fs_list`: "Found 20 files: [file1.md, file2.md, ...]" (instead of raw array)
- `fs_read`: "Successfully read 1500 chars from file.ts: [preview]" (instead of full content)
- `web_search`: "Found 5 results for 'query': [titles]" (instead of raw JSON)

Add `formatObservation()` helper to each skill manifest.

### Phase 5: Testing & Refinement
**Tests to run**:

1. **File Operations Test** (the original failure case):
   - Task: "List all files in docs/user-guide and summarize their topics"
   - Expected: fs_list → observe filenames → fs_read actual files (not hallucinated ones)

2. **Multi-Step Research**:
   - Task: "Find the current agent scheduler configuration and explain how it works"
   - Expected: fs_list → fs_read etc/agents.json → explain

3. **Error Recovery**:
   - Task: "Read the file at /nonexistent/path.txt"
   - Expected: Observe error, adapt plan, report gracefully

4. **Complex Chain**:
   - Task: "What autonomous agents are configured and how often do they run?"
   - Expected: fs_read etc/agents.json → extract data → web_search if needed → synthesize answer

### Phase 6: Cleanup & Documentation
**Actions**:

1. **Remove Legacy Code**:
   - Archive `brain/agents/operator.ts` → `brain/agents/operator-legacy.ts`
   - Remove static planner code
   - Remove executor loop
   - Remove critic step

2. **Update Documentation**:
   - `docs/ARCHITECTURE.md` - Document ReAct loop architecture
   - `docs/user-guide/08-autonomous-agents.md` - Update operator agent description
   - `CLAUDE.md` - Update operator agent workflow

3. **Update API Routing**:
   - Make `/api/operator` call `operator-react.ts` by default
   - Add `/api/operator/legacy` for old static planner (if needed for comparison)

## Integration with Existing Reasoning UI

The web UI already has a reasoning system in [ChatInterface.svelte](apps/site/src/components/ChatInterface.svelte:424-500):

```typescript
interface ReasoningStage {
  stage: string;
  content: string;
  deepReasoning?: string;
}

let reasoningStages: ReasoningStage[] = [];
```

**Mapping Strategy**:
```typescript
// ReAct step → reasoning stage
{
  stage: `Step ${step.iteration}: ${step.action}`,
  content: `${step.thought}\n\nAction: ${step.action}\nObservation: ${step.observation}`,
  deepReasoning: step.reasoning || undefined
}
```

The existing `reasoningDepth` slider controls:
- **Off**: No reasoning shown
- **Quick**: Show thought + action only
- **Focused**: Show thought + action + observation
- **Deep**: Show everything including deepReasoning

## Backward Compatibility

**Approach**: Augment, don't replace
- Keep `operator.ts` as `operator-legacy.ts`
- Create new `operator-react.ts`
- Update `/api/operator` to use ReAct by default
- Add feature flag: `USE_REACT_OPERATOR=true` in `.env`
- Allow fallback to legacy for comparison testing

## Success Metrics

1. **No More Hallucinated Filenames**: Operator uses actual fs_list results
2. **Adaptive Execution**: Operator changes plan based on observations
3. **Error Recovery**: Gracefully handles skill failures and adapts
4. **Performance**: <10 iterations for typical tasks
5. **User Experience**: Reasoning UI shows clear step-by-step progress

## Configuration

```typescript
// etc/operator.json (new file)
{
  "mode": "react",           // "react" or "legacy"
  "maxIterations": 10,
  "enableDeepReasoning": false,
  "streamProgress": true,
  "observationMaxLength": 500
}
```

## Risk Mitigation

1. **Infinite Loops**: Hard limit of MAX_ITERATIONS (10)
2. **Slow Execution**: Each iteration streams progress to UI
3. **LLM Failures**: Fallback to legacy operator on error
4. **Breaking Changes**: Keep legacy operator available
5. **Testing**: Run side-by-side comparison before full migration

## Timeline Estimate

- **Phase 1** (Core Engine): 1-2 hours
- **Phase 2** (LLM Integration): 1-2 hours
- **Phase 3** (UI Integration): 1 hour
- **Phase 4** (Skills Enhancement): 1 hour
- **Phase 5** (Testing): 1-2 hours
- **Phase 6** (Cleanup): 1 hour

**Total**: 6-9 hours of development work

## References

- **ReAct Paper**: "ReAct: Synergizing Reasoning and Acting in Language Models" (Yao et al., 2022)
- **Similar Implementations**: LangChain AgentExecutor, AutoGPT, BabyAGI
- **Our Current Code**: [brain/agents/operator.ts](brain/agents/operator.ts), [ChatInterface.svelte](apps/site/src/components/ChatInterface.svelte)
