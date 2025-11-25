# Reasoning Engine: ReAct Pattern Deep Dive

The **ReasoningEngine** is MetaHuman OS's sophisticated multi-step reasoning system that powers the Operator agent. It implements the ReAct pattern (Reason-Act-Observe) for goal-oriented task execution with intelligent error recovery and adaptive planning.

---

## Overview

### What is ReAct?

ReAct (Reasoning and Acting) is a framework where an AI alternates between:
1. **Reasoning**: Thinking about what to do next
2. **Acting**: Executing a tool/skill to gather information or make changes
3. **Observing**: Processing the results and updating understanding

This cycle repeats until the goal is achieved or maximum steps are reached.

### The Pattern

```
Goal → Thought → Action → Observation → Thought → Action → ... → Response
```

**Example execution:**
```
User: "What tasks do I have today?"

Thought 1: Need to retrieve task list. I should use task_list skill.
Action 1: task_list({ status: "active" })
Observation 1: Found 3 active tasks:
  - Review documentation (high priority)
  - Update training pipeline (medium)
  - Check email (low)

Thought 2: I have all the information needed to respond.
Response: You have 3 active tasks today:
  1. Review documentation (high priority)
  2. Update training pipeline (medium priority)
  3. Check email (low priority)
```

---

## Three Implementations

MetaHuman OS provides three ReAct implementations with different characteristics:

### V2 Service (Recommended)

**Purpose**: Production-grade reasoning with enhanced features

**Location**: `packages/core/src/reasoning/reasoning-engine.ts`

**Key Features**:
- ✅ Extracted into reusable `@metahuman/core/reasoning` module
- ✅ Enhanced error recovery with 7 error types
- ✅ Contextual suggestions based on error type
- ✅ Failure loop detection (prevents repeated failures)
- ✅ Structured event streaming for UI observability
- ✅ Full scratchpad history for debugging
- ✅ Tool catalog caching (1-minute TTL)

**Use when**: You want maximum reliability and observability

### V2 Inline (Default)

**Purpose**: Lightweight reasoning embedded in operator

**Location**: `brain/agents/operator-react.ts`

**Key Features**:
- ✅ Plans one step at a time based on observed results
- ✅ Never hallucinates data (only uses actual observations)
- ✅ Max 10 iterations with intelligent completion detection
- ✅ Real-time streaming via Server-Sent Events
- ✅ Simpler codebase, easier to modify

**Use when**: You want good performance without external service

### V1 Legacy

**Purpose**: Backward compatibility

**Location**: `brain/agents/operator.ts` (deprecated)

**Key Features**:
- ⚠️ Plans all steps upfront before seeing results
- ⚠️ Can hallucinate data it hasn't observed yet
- ⚠️ Less reliable for complex multi-step tasks
- ✅ Preserved for compatibility

**Use when**: You need to test against old behavior

---

## Configuration

Control which implementation to use via `etc/runtime.json`:

```json
{
  "operator": {
    "reactV2": true,              // true = V2, false = V1
    "useReasoningService": false  // true = Service, false = Inline
  }
}
```

**Configuration matrix**:

| reactV2 | useReasoningService | Result |
|---------|-------------------|--------|
| false | - | V1 Legacy (deprecated) |
| true | false | V2 Inline (default) |
| true | true | V2 Service (recommended) |

---

## Reasoning Depth Levels

The ReasoningEngine supports configurable depth levels that control how many steps it will take:

| Level | Name | Max Steps | Use Case | Example |
|-------|------|-----------|----------|---------|
| 0 | Off | 1 | Direct execution, no reasoning | Simple skill call |
| 1 | Quick | 5 | Single-task operations | "List my tasks" |
| 2 | Focused | 10 | Multi-step tasks (default) | "Create and schedule a task" |
| 3 | Deep | 15 | Complex problem solving | "Analyze and fix errors in code" |

**Setting depth**:

```typescript
// In operator configuration
const result = await runReActLoop({
  goal: userMessage,
  maxSteps: 10,  // Reasoning depth 2
  // ...
});
```

**Automatic depth selection**:
- Simple queries: Level 1 (5 steps)
- Standard requests: Level 2 (10 steps) - default
- Explicit "deep analysis": Level 3 (15 steps)

---

## Error Recovery System

One of the most powerful features of the V2 ReasoningEngine is intelligent error recovery.

### 7 Error Types

Each error type has contextual recovery suggestions:

#### 1. FILE_NOT_FOUND

**Trigger**: Skill returns "file not found" error

**Suggestions**:
- "Use fs_list to check what files exist in the directory"
- "Verify the file path is correct"
- "Check if the file was moved or deleted"

**Example**:
```
Action: fs_read({ path: "/nonexistent/file.txt" })
Observation: ❌ Error: File not found

Recovery Thought: File doesn't exist. Let me list the directory first.
Action: fs_list({ path: "/nonexistent/" })
```

#### 2. TASK_NOT_FOUND

**Trigger**: Skill returns "task not found" error

**Suggestions**:
- "Use task_list to see available tasks"
- "Check if the task ID is correct"
- "The task may have been completed or deleted"

#### 3. PERMISSION_DENIED

**Trigger**: Skill returns "permission denied" error

**Suggestions**:
- "Check file permissions with fs_list"
- "You may not have access to this resource"
- "Try a different approach that doesn't require this permission"

#### 4. INVALID_ARGUMENTS

**Trigger**: Skill returns "invalid arguments" error

**Suggestions**:
- "Check the skill documentation for correct parameters"
- "Verify argument types match expected format"
- "Some required arguments may be missing"

#### 5. SKILL_NOT_FOUND

**Trigger**: Skill doesn't exist

**Suggestions**:
- "Use available skills from the tool catalog"
- "Check skill name spelling"
- "The skill may not be available in current trust level"

#### 6. TIMEOUT

**Trigger**: Skill execution exceeds timeout

**Suggestions**:
- "Try breaking the task into smaller steps"
- "The operation may be too complex"
- "Check if external service is responding"

#### 7. UNKNOWN_ERROR

**Trigger**: Any other error

**Suggestions**:
- "Review the error message for clues"
- "Try a different approach"
- "The operation may not be possible"

### Failure Loop Detection

Prevents the reasoning engine from repeating the same failed action:

**Without failure detection**:
```
Thought 1: Read the file
Action 1: fs_read({ path: "/missing.txt" })
Observation 1: ❌ File not found

Thought 2: Try reading the file again
Action 2: fs_read({ path: "/missing.txt" })
Observation 2: ❌ File not found
... (infinite loop)
```

**With failure detection** (triggers after 2 attempts):
```
Thought 1: Read the file
Action 1: fs_read({ path: "/missing.txt" })
Observation 1: ❌ File not found

Thought 2: Try reading the file again
Action 2: fs_read({ path: "/missing.txt" })
Observation 2: ❌ File not found

⚠️ FAILURE LOOP DETECTED: Same action failed twice.
Suggestion: Try fs_list to check available files.

Thought 3: Let me list the directory instead
Action 3: fs_list({ path: "/" })
Observation 3: ✅ Found 15 files...
```

---

## Observation Modes

The ReasoningEngine supports three observation formatting modes to prevent hallucination and improve accuracy:

### 1. Verbatim Mode

**Purpose**: Raw, unfiltered output for data-focused queries

**Format**: JSON output from skills

**Use case**: "List my tasks" queries where you want exact data

**Example**:
```json
Observation: {
  "tasks": [
    { "id": "task-001", "title": "Review docs", "priority": "high" },
    { "id": "task-002", "title": "Update code", "priority": "medium" }
  ],
  "count": 2
}
```

**Benefits**:
- Zero interpretation overhead
- No data loss
- Perfect for structured queries

### 2. Structured Mode

**Purpose**: Formatted tables and bullet lists

**Format**: Human-readable but structured

**Use case**: Multi-item results that need organization

**Example**:
```
Observation: Found 2 tasks:

ID        | Title        | Priority
----------|--------------|----------
task-001  | Review docs  | high
task-002  | Update code  | medium
```

**Benefits**:
- Easy to read
- Maintains data accuracy
- No hallucinated details

### 3. Narrative Mode

**Purpose**: Natural language descriptions

**Format**: Prose summaries (V1 style)

**Use case**: Conversational responses

**Example**:
```
Observation: I found 2 active tasks. The first is reviewing documentation
with high priority, and the second is updating code with medium priority.
```

**Benefits**:
- Most natural
- Good for final responses
- Can add context

**Warning**: Risk of hallucination if not careful

---

## Tool Catalog Integration

The ReasoningEngine has built-in integration with the Tool Catalog for skill discovery.

### Auto-Generated Documentation

Skills are automatically documented in LLM-friendly format:

```
Available Skills:

task_list - List tasks
  Description: Retrieve tasks filtered by status
  Parameters:
    - status (optional): "active", "completed", or "all"
  Example: task_list({ status: "active" })

task_create - Create a new task
  Description: Create a task with title and optional priority
  Parameters:
    - title (required): Task title
    - priority (optional): "high", "medium", or "low"
  Example: task_create({ title: "Review docs", priority: "high" })
```

### Caching

Tool catalog is cached for 1 minute (60 seconds) to reduce overhead:

**First call**: Generates catalog (~500ms)
**Subsequent calls**: Uses cache (~1ms)
**After 60s**: Regenerates catalog

### Usage in Reasoning

The reasoning prompt includes:

```
You have access to these skills:
[tool catalog here]

Use skills by outputting:
Action: skill_name({ arg1: value1, arg2: value2 })
```

---

## Fast-Path Optimizations

The V2 ReasoningEngine includes optimizations for common queries:

### Verbatim Short-Circuit

**Detection**: Queries like "list tasks", "show files", "what tasks"

**Optimization**: Skip planning loop, execute directly

**Performance**: 0 LLM calls vs. 2+ LLM calls

**Example**:
```
User: "List my tasks"

Without optimization:
  1. Planning LLM call → "I should use task_list"
  2. Execution → task_list()
  3. Synthesis LLM call → "Here are your tasks..."

With optimization:
  1. Execution → task_list()
  2. Return raw data (no synthesis needed)
```

**Savings**: ~2-4 seconds per query

---

## Structured Scratchpad

The scratchpad maintains complete history of the reasoning process:

### Format

```typescript
interface ScratchpadEntry {
  step: number;
  thought: string;
  action?: {
    skill: string;
    args: any;
  };
  observation?: {
    success: boolean;
    data: any;
    error?: string;
  };
  timestamp: string;
}
```

### Example Scratchpad

```json
[
  {
    "step": 1,
    "thought": "Need to retrieve active tasks",
    "action": {
      "skill": "task_list",
      "args": { "status": "active" }
    },
    "observation": {
      "success": true,
      "data": { "tasks": [...], "count": 3 }
    },
    "timestamp": "2025-01-15T10:30:00Z"
  },
  {
    "step": 2,
    "thought": "I have all needed information",
    "timestamp": "2025-01-15T10:30:02Z"
  }
]
```

### Scratchpad Trimming

To manage token limits, scratchpad is trimmed to last 10 steps:

**Before trimming** (15 steps):
```
Step 1, Step 2, ... Step 15
```

**After trimming** (10 steps):
```
Step 6, Step 7, ... Step 15
[Earlier steps trimmed for token limit]
```

Full scratchpad always available in audit logs for debugging.

---

## SSE Event Streaming

The ReasoningEngine streams events in real-time via Server-Sent Events (SSE) for UI observability.

### Event Types

**`type: 'thought'`** - Planning steps
```json
{
  "type": "thought",
  "step": 1,
  "content": "Need to retrieve active tasks"
}
```

**`type: 'action'`** - Tool executions
```json
{
  "type": "action",
  "step": 1,
  "skill": "task_list",
  "args": { "status": "active" }
}
```

**`type: 'observation'`** - Results and feedback
```json
{
  "type": "observation",
  "step": 1,
  "success": true,
  "data": { "tasks": [...], "count": 3 }
}
```

**`type: 'completion'`** - Final response
```json
{
  "type": "completion",
  "content": "You have 3 active tasks...",
  "totalSteps": 2
}
```

**`type: 'error'`** - Failures and suggestions
```json
{
  "type": "error",
  "step": 1,
  "error": "File not found",
  "suggestions": ["Use fs_list to check files"]
}
```

### Web UI Integration

The reasoning slider in the web UI displays these events:

```
🤔 Thought: Need to retrieve active tasks
⚙️ Action: task_list({ status: "active" })
✅ Observation: Found 3 tasks
🤔 Thought: I have all needed information
✅ Response: You have 3 active tasks...
```

---

## Audit Logging

All reasoning steps are logged to `logs/audit/YYYY-MM-DD.ndjson`:

### Event Schema

```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "level": "info",
  "category": "reasoning",
  "event": "reasoning_thought",
  "step": 1,
  "data": {
    "thought": "Need to retrieve active tasks",
    "cognitiveMode": "dual",
    "reasoningDepth": 2,
    "scratchpadSize": 1
  },
  "actor": "greggles"
}
```

### Searchable Events

```bash
# Find all reasoning sessions
grep "reasoning_thought" logs/audit/*.ndjson

# Find error recoveries
grep "reasoning_error_recovery" logs/audit/*.ndjson

# Find failure loops
grep "failure_loop_detected" logs/audit/*.ndjson
```

---

## Performance Characteristics

### Token Usage

| Operation | Tokens | Notes |
|-----------|--------|-------|
| Tool catalog | 500-1000 | Cached for 1 minute |
| Thought generation | 100-300 | Per step |
| Action execution | 50-200 | Skill args |
| Observation formatting | 100-500 | Depends on mode |
| Final synthesis | 200-800 | Narrator response |

**Total per request**: 1000-3000 tokens (average)

### Latency

| Component | Time | Notes |
|-----------|------|-------|
| Tool catalog generation | 500ms | First call only |
| Thought LLM call | 500-1500ms | Per step |
| Skill execution | 50-500ms | Depends on skill |
| Observation formatting | 10-100ms | Depends on mode |
| Final synthesis | 500-1500ms | Narrator LLM call |

**Total per request**: 2-5 seconds (2-3 steps average)

### Optimization Tips

1. **Use verbatim mode** for data queries (skip synthesis)
2. **Enable tool catalog caching** (default)
3. **Set appropriate depth** (don't use level 3 for simple tasks)
4. **Use smaller models** for orchestrator role
5. **Monitor scratchpad size** (trim aggressively)

---

## Examples

### Example 1: Simple Query

**Input**: "What tasks do I have?"

**Execution**:
```
Step 1:
  Thought: Need to retrieve task list
  Action: task_list({ status: "active" })
  Observation: Found 3 tasks

Step 2:
  Thought: I have the information
  Response: You have 3 active tasks...
```

**Performance**: 2 steps, ~2 seconds

### Example 2: Multi-Step Task

**Input**: "Create a task to review docs and mark it high priority"

**Execution**:
```
Step 1:
  Thought: Need to create a task with specific title and priority
  Action: task_create({ title: "Review docs", priority: "high" })
  Observation: Task created with ID task-123

Step 2:
  Thought: Task successfully created
  Response: I've created a high-priority task...
```

**Performance**: 2 steps, ~3 seconds

### Example 3: Error Recovery

**Input**: "Read the file missing.txt"

**Execution**:
```
Step 1:
  Thought: Need to read the file
  Action: fs_read({ path: "missing.txt" })
  Observation: ❌ File not found

Step 2 (Error Recovery):
  Suggestion: Use fs_list to check available files
  Thought: Let me list files first
  Action: fs_list({ path: "." })
  Observation: Found 15 files (missing.txt not in list)

Step 3:
  Thought: File doesn't exist in current directory
  Response: The file missing.txt doesn't exist...
```

**Performance**: 3 steps, ~4 seconds

---

## Troubleshooting

### Issue: Reasoning Loop Never Completes

**Symptoms**: Reaches max steps without finishing

**Causes**:
- Task is too complex for configured depth
- Failure loop not detected properly
- Skill keeps failing

**Solutions**:
1. Increase reasoning depth: `maxSteps: 15`
2. Check skill implementation for bugs
3. Review audit logs for repeated failures
4. Enable failure loop detection (should be default)

### Issue: Hallucinated Data in Observations

**Symptoms**: Observations contain data that wasn't actually returned

**Causes**:
- Using narrative mode with unreliable model
- Synthesis step adding details

**Solutions**:
1. Switch to verbatim or structured mode
2. Use smaller, more focused models for orchestrator
3. Review observation formatting logic

### Issue: Slow Performance

**Symptoms**: Each reasoning cycle takes 5+ seconds

**Causes**:
- Tool catalog regenerating every time (cache expired)
- Large model for orchestrator
- Too many steps for simple queries

**Solutions**:
1. Verify tool catalog caching: check timestamps
2. Use 3B-7B model for orchestrator role
3. Enable fast-path optimizations
4. Lower reasoning depth for simple tasks

### Issue: Error Recovery Not Working

**Symptoms**: Same error repeated multiple times

**Causes**:
- Failure loop detection disabled
- Error type not recognized
- Recovery suggestions not in prompt

**Solutions**:
1. Verify `useReasoningService: true` in config
2. Check error type mapping in reasoning engine
3. Review scratchpad for detection triggers

---

## Best Practices

### 1. Choose the Right Implementation

- **Production**: Use V2 Service
- **Development**: Use V2 Inline
- **Testing**: Use Mock provider

### 2. Set Appropriate Depth

- **Simple queries**: Depth 1 (5 steps)
- **Standard tasks**: Depth 2 (10 steps)
- **Complex analysis**: Depth 3 (15 steps)

### 3. Use Correct Observation Mode

- **Data queries**: Verbatim
- **Multi-item results**: Structured
- **Conversational**: Narrative (with caution)

### 4. Monitor Performance

- Check audit logs regularly
- Track average steps per query
- Monitor token usage
- Watch for failure loops

### 5. Handle Errors Gracefully

- Always provide recovery suggestions
- Don't repeat failed actions
- Log all errors to audit trail
- Fallback to simpler approach if stuck

---

## Related Documentation

- **[Core Concepts](04-core-concepts-new.md)** - Overview of all subsystems
- **[Cognitive Modes](04b-cognitive-modes.md)** - Operator routing per mode
- **[Model Architecture](04a-model-architecture.md)** - Multi-model orchestrator
- **[Skills System](../09-skills-system.md)** - Available skills and development
- **[Autonomous Agents](../08-autonomous-agents.md)** - Operator agent details
- **[Configuration Files](../14-configuration-files.md)** - runtime.json reference

---

**Master the ReasoningEngine for intelligent task execution!** 🧠
