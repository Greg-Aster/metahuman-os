# Modular ReAct Scratchpad Nodes

These are composable building blocks for creating multi-step ReAct (Reasoning + Acting) workflows in the node-based cognitive system.

## Philosophy

Instead of a monolithic `loop_controller` node, we provide **5 modular nodes** that can be wired together flexibly. This embraces the visual programming paradigm where you compose complex behaviors from simple, reusable components.

## Available Nodes

### 1. `scratchpad_initializer`
**Purpose**: Creates or resets the scratchpad at the start of a ReAct workflow

**Inputs**: None (uses context)

**Outputs**:
```typescript
{
  scratchpad: [],          // Empty array ready for entries
  iteration: 0,            // Starting iteration count
  maxIterations: 10,       // Configurable via context
  isComplete: false        // Initial state
}
```

**Context Properties**:
- `maxIterations` (optional, default: 10)

---

### 2. `scratchpad_updater`
**Purpose**: Appends a new thought/action/observation entry to the scratchpad

**Inputs**:
- `[0]` = Current scratchpad state `{ scratchpad, iteration, maxIterations }`
- `[1]` = New entry `{ thought, action, observation }`

**Outputs**:
```typescript
{
  scratchpad: [...entries],  // Updated with new entry
  iteration: N + 1,          // Incremented
  maxIterations: 10,
  isComplete: false
}
```

---

### 3. `iteration_counter`
**Purpose**: Tracks and validates iteration count

**Inputs**:
- `[0]` = Scratchpad state `{ iteration, maxIterations, scratchpad }`

**Outputs**:
```typescript
{
  iteration: N,
  maxIterations: 10,
  hasExceededMax: boolean,
  shouldContinue: boolean,
  scratchpadLength: number
}
```

---

### 4. `scratchpad_completion_checker`
**Purpose**: Determines if the ReAct task is complete

**Inputs**:
- `[0]` = Response text (checks for "Final Answer:", "FINAL_ANSWER", "Task Complete")
- `[1]` = Scratchpad state `{ iteration, maxIterations }`

**Outputs**:
```typescript
{
  isComplete: boolean,
  hasFinalAnswer: boolean,
  hasExceededMax: boolean,
  iteration: number,
  response: string,
  reason: 'final_answer' | 'max_iterations' | 'continue'
}
```

---

### 5. `scratchpad_formatter`
**Purpose**: Formats scratchpad for display or LLM consumption

**Inputs**:
- `[0]` = Scratchpad state `{ scratchpad }`

**Outputs**:
```typescript
{
  formatted: string,  // Formatted text/json/markdown
  entries: number     // Entry count
}
```

**Context Properties**:
- `format`: `'text'` (default) | `'json'` | `'markdown'`

---

### 6. `conditional_router`
**Purpose**: Routes data flow based on conditions, enabling graph-level loops

**Inputs**:
- `[0]` = Condition `{ isComplete: boolean }` or boolean
- `[1]` = Data to pass if condition is true (exit path)
- `[2]` = Data to pass if condition is false (loop back path)

**Outputs**:
```typescript
{
  routedData: any,              // The selected data
  conditionMet: boolean,        // Whether condition was true
  branch: 'true' | 'false',     // Which branch was taken
  routingDecision: string       // Tells graph executor which path to take
}
```

**How It Works**:
- Evaluates the condition (supports boolean, string, object with `isComplete`/`isDone`/`shouldContinue` fields)
- Routes to **slot 0** (true branch) if condition is met → exits loop
- Routes to **slot 1** (false branch) if condition is not met → loops back
- The graph executor detects `routingDecision` and re-queues nodes accordingly

**Graph Integration**:
- Output slot 0 links to exit nodes (e.g., `scratchpad_formatter`, `response_synthesizer`)
- Output slot 1 links back to earlier nodes (e.g., `iteration_counter`) — marked as **back-edge**
- The graph executor allows this cycle and manages re-execution

---

## Example: Simple Single-Pass ReAct

```json
{
  "nodes": [
    { "id": 1, "type": "cognitive/user_input" },
    { "id": 2, "type": "cognitive/scratchpad_initializer" },
    { "id": 3, "type": "cognitive/react_planner" },
    { "id": 4, "type": "cognitive/skill_executor" },
    { "id": 5, "type": "cognitive/scratchpad_updater" },
    { "id": 6, "type": "cognitive/response_synthesizer" }
  ],
  "links": [
    { "origin_id": 1, "target_id": 3, "target_slot": 0 },
    { "origin_id": 2, "target_id": 3, "target_slot": 1 },
    { "origin_id": 3, "target_id": 4 },
    { "origin_id": 4, "target_id": 5, "target_slot": 1 },
    { "origin_id": 2, "target_id": 5, "target_slot": 0 },
    { "origin_id": 5, "target_id": 6 }
  ]
}
```

**Flow**:
1. User input → planner (slot 0)
2. Empty scratchpad → planner (slot 1)
3. Planner generates thought/action
4. Skill executes action → observation
5. Scratchpad updater appends entry
6. Synthesizer generates final response

---

## Example: Multi-Iteration ReAct with Loop

Multi-iteration ReAct is now fully supported using the **conditional_router** node:

**Complete Flow**:
```
user_input → scratchpad_initializer
           ↓
    ┌──→ iteration_counter
    │      ↓
    │   react_planner
    │      ↓
    │   skill_executor
    │      ↓
    │   scratchpad_updater
    │      ↓
    │   completion_checker
    │      ↓
    │   conditional_router
    │      ├─ (isComplete=true) → scratchpad_formatter → response_synthesizer
    │      └─ (isComplete=false) ─┘ [loops back to iteration_counter]
```

**Key Features**:
- ✅ Graph executor supports cyclic execution via back-edges
- ✅ `conditional_router` automatically re-queues nodes for next iteration
- ✅ Maximum iteration safety limit prevents infinite loops (default: 20)
- ✅ Detailed execution logs show iteration counts per node

---

## Migration from loop_controller

The monolithic `loop_controller` can be **decomposed** into:

```
loop_controller ≈ scratchpad_initializer
                + react_planner
                + skill_executor
                + scratchpad_updater
                + iteration_counter
                + completion_checker
                + conditional router
```

**Advantages of modular approach**:
- ✅ Reusable components
- ✅ Visual clarity (see exactly what's happening)
- ✅ Flexible composition (skip steps, add custom logic)
- ✅ Easier debugging (inspect each step)
- ✅ Optional components (use only what you need)

**Disadvantages**:
- ❌ More complex graphs (more nodes/links)
- ❌ Requires loop routing mechanism (not yet available in graph executor)

---

## Current Status

**Implemented**: ✅ All 6 modular nodes (scratchpad + conditional_router)
**Graph Support**: ✅ Cyclic execution with back-edge detection
**Available Workflows**:
- ✅ `dual-mode.json` (v1.1) — Uses monolithic `loop_controller` (backward compatible)
- ✅ `dual-mode-v2.json` (v2.0) — Uses modular scratchpad nodes with `conditional_router`

**Migration**: Both workflows are available. v2.0 demonstrates the modular approach.

---

## Production Example: dual-mode-v2.json

See [/home/greggles/metahuman/etc/cognitive-graphs/dual-mode-v2.json](../../etc/cognitive-graphs/dual-mode-v2.json) for a complete working example of modular ReAct with `conditional_router`.

**Key Features**:
- 23 nodes total (vs 16 in v1.1 loop_controller version)
- Explicit modular scratchpad workflow
- Visual clarity: each ReAct step is a separate node
- Cyclic execution via back-edge from `conditional_router` to `iteration_counter`
- Maximum 20 iterations with safety limits
- Full audit logging of iteration counts

**To Use**:
1. Set `etc/runtime.json` → `cognitiveGraphs.dual` → `dual-mode-v2.json`
2. Restart the web server
3. Switch to Dual Consciousness mode in the UI header

**Performance**: Similar to v1.1 (~4-6 seconds per iteration), but with better observability and debugging.
