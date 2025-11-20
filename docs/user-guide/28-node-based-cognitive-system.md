# Node-Based Cognitive System: Visual Programming for AI Workflows

MetaHuman OS now uses a **visual node-based architecture** for defining cognitive workflows. Instead of hardcoded logic, each cognitive mode (Dual, Agent, Emulation) is represented as a **directed graph** that you can view, edit, and customize in real-time.

## What Is the Node System?

Think of it like **visual programming for AI cognition**. Each node represents a single operation (like "retrieve memories", "call LLM", "validate safety"), and connections between nodes define the data flow.

## Why a Node-Based System?

The move to a node-based architecture was driven by several key benefits for users and developers:

*   **Code Reduction:** Significantly reduces the amount of hardcoded logic, shifting workflow definitions into human-readable JSON graphs.
*   **Faster Development:** Accelerates feature development by allowing rapid prototyping and iteration within the visual editor.
*   **Hot-Reloadable Configurations:** Changes to cognitive workflows take effect immediately without requiring code redeployment.
*   **Community Contributions:** Facilitates community-driven development of custom workflows and plugins, fostering a vibrant ecosystem.


### Key Concepts

**Nodes**: Individual processing units
- Input nodes (user message, session data)
- Processing nodes (semantic search, LLM generation)
- Output nodes (stream response, save memory)

**Links**: Data connections between nodes
- Define execution order via topological sorting
- Multiple input/output slots per node
- Typed connections (string, array, object)

**Graphs**: Complete cognitive workflows
- Stored as JSON in `etc/cognitive-graphs/`
- Hot-reloadable (changes take effect immediately)
- Mode-specific (emulation-mode.json, dual-mode.json, agent-mode.json)

## Architecture

```
User Message
     ↓
┌────────────────────────────────────────┐
│   Graph Execution Engine               │
│   (packages/core/src/graph-executor.ts)│
└────────────────────────────────────────┘
     ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Node 1         │→ │  Node 2         │→ │  Node 3         │
│  user_input     │  │  semantic_search│  │  persona_llm    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                                               ↓
                                        Final Response
```

## Available Cognitive Graphs

### 1. Emulation Mode (`emulation-mode.json`)
**Purpose**: Chat-only mode with full conversation persistence

**Graph Structure** (v1.1, 13 nodes):
```
user_input → reply_to_handler → conversation_history
                              → semantic_search
                              → session_context
                              → system_settings

           All feed into → persona_llm

persona_llm → cot_stripper → safety_validator → response_refiner
           → memory_capture (if authenticated)
           → buffer_manager (persists conversation)
           → stream_writer (outputs response)
```

**Key Features**:
- ✅ Conversation buffer persistence (loads/saves to disk)
- ✅ Reply-to handler (curiosity questions)
- ✅ Temperature adjustment (0.6 for inner dialogue, 0.7 for conversation)
- ✅ Memory capture when authenticated
- ✅ Auto-pruning history (max 20 messages)

### 2. Dual Mode (`dual-mode.json`)
**Purpose**: Full ReAct pipeline with multi-step reasoning

**Graph Structure** (v1.1, 16 nodes):
```
user_input → operator_eligibility (decides if operator needed)
           ↓ (if yes)
           context_builder → loop_controller (iterative ReAct)
                          → react_planner
                          → skill_executor
                          → scratchpad updater
                          → completion_checker
                          → response_synthesizer

           ↓ (if no - simple chat)
           conversation_history → persona_llm → stream_writer
```

**Key Features**:
- ✅ Multi-step ReAct reasoning (Thought → Action → Observation loops)
- ✅ Loop controller (manages scratchpad and iterations)
- ✅ Skill execution with error recovery
- ✅ Automatic completion detection
- ✅ Memory grounding with semantic search

### 3. Agent Mode (`agent-mode.json`)
**Purpose**: Heuristic routing between chat and operator

**Graph Structure** (v1.0, 16 nodes):
```
user_input → operator_eligibility (smart detection)
           ↓ (action-oriented)
           react_planner → skill_executor → response_synthesizer

           ↓ (simple query)
           conversation_history → persona_llm → stream_writer
```

**Key Features**:
- ✅ Lightweight heuristic routing
- ✅ Single-pass planning (no iteration)
- ✅ Faster response times
- ⚠️ Limited to single-step tasks (no multi-iteration)

## Node Types Reference

### Input Nodes

#### `user_input`
**Purpose**: Captures user message and creates execution context

**Outputs**:
- `message` (string): User's message text
- `sessionId` (string): Current session identifier
- `userId` (string): Authenticated user ID
- `timestamp` (string): ISO timestamp

**Example Output**:
```json
{
  "message": "Create a task to review docs",
  "sessionId": "conv-1234567890",
  "userId": "f1be5026-fd95...",
  "timestamp": "2025-11-20T04:00:00.000Z"
}
```

#### `session_context`
**Purpose**: Loads session-specific data

**Outputs**:
- `user`: User profile data
- `sessionId`: Session identifier
- `conversationHistory`: Recent messages (legacy, use `conversation_history` node instead)

#### `system_settings`
**Purpose**: Loads cognitive mode, chat settings, active facet, memory policy

**Outputs**:
```json
{
  "cognitiveMode": "dual",
  "chatSettings": {
    "temperature": 0.7,
    "maxContextChars": 8000
  },
  "activeFacet": "poet",
  "memoryPolicy": {
    "canWriteConversation": true,
    "canWriteInnerDialogue": true
  },
  "trustLevel": "supervised_auto",
  "settings": {
    "recordingEnabled": true,
    "proactiveAgents": true
  }
}
```

### Memory & Context Nodes

#### `semantic_search`
**Purpose**: Retrieves relevant memories using vector similarity

**Inputs**:
- `[0]`: User message or query object

**Properties**:
- `similarityThreshold` (default: 0.6): Min similarity score
- `maxResults` (default: 5): Max memories to return

**Outputs**:
```json
{
  "memories": [
    {
      "content": "...",
      "timestamp": "2025-11-19T...",
      "type": "conversation",
      "score": 0.85
    }
  ],
  "query": { ... },
  "error": null
}
```

#### `conversation_history`
**Purpose**: Loads persisted conversation buffer with deduplication

**Inputs**:
- `[0]`: Session ID or user input

**Properties**:
- `mode`: "conversation" | "inner"
- `maxMessages` (default: 20): Max history length

**Outputs**:
```json
{
  "messages": [...],
  "summaryMarkers": [...],
  "count": 15,
  "pruned": true,
  "loadedFromBuffer": true,
  "estimatedTokens": 3200,
  "mode": "conversation"
}
```

#### `context_builder`
**Purpose**: Assembles comprehensive context package for operator

**Properties**:
- `searchDepth`: "shallow" | "normal" | "deep"
- `maxMemories`: Number of memories to include
- `maxContextChars`: Max context string length

**Outputs**:
```json
{
  "context": "# Relevant Memories\n...\n\n# Active Tasks\n...",
  "contextPackage": {
    "memories": [...],
    "tasks": [...],
    "reflections": [...]
  },
  "usedSemantic": true
}
```

### LLM Nodes

#### `persona_llm`
**Purpose**: Generates responses using persona model with memory grounding

**Inputs**:
- `[0]`: Conversation history (messages array)
- `[1]`: Memories/context
- `[2+]`: Additional context (facet, settings, etc.)

**Properties**:
- `model`: Model identifier (default: "default.persona")
- `temperature`: Randomness (default: 0.7, adjusted to 0.6 for inner dialogue)

**Context Used**:
- `cognitiveMode`: Affects temperature
- `dialogueType`: "conversation" vs "inner"

**Outputs**:
```json
{
  "response": "Generated response text..."
}
```

#### `react_planner`
**Purpose**: Plans next ReAct step (Thought → Action)

**Inputs**:
- `[0]`: Context data
- `[1]`: Scratchpad state (array of previous steps)

**Properties**:
- `model`: "default.coder"
- `temperature`: 0.2 (lower for planning)

**Outputs**:
```json
{
  "thought": "I should create a task...",
  "action": "task_create",
  "actionInput": { "title": "Review docs" }
}
```

### Processing Nodes

#### `cot_stripper`
**Purpose**: Removes chain-of-thought markers from responses

**Inputs**:
- `[0]`: LLM response text

**Outputs**:
```json
{
  "cleaned": "Response without <thinking> tags",
  "response": "Same as cleaned"
}
```

#### `safety_validator`
**Purpose**: Checks response for safety issues

**Inputs**:
- `[0]`: Response text to validate

**Properties**:
- `threshold`: Minimum safety score (0-1)

**Outputs**:
```json
{
  "response": "Original response",
  "isSafe": true,
  "issues": [],
  "safetyResult": {
    "safe": true,
    "score": 1.0,
    "issues": []
  }
}
```

#### `response_refiner`
**Purpose**: Refines responses to remove sensitive data or improve quality

**Inputs**:
- `[0]`: Response text
- `[1]`: Safety result (optional)

**Outputs**:
```json
{
  "response": "Refined response text",
  "refined": true,
  "changes": ["api_key_redacted", "path_removed"]
}
```

### Operator & Skills Nodes

#### `operator_eligibility`
**Purpose**: Decides if message needs operator (ReAct) or simple chat

**Inputs**:
- `[0]`: User message

**Outputs**:
```json
{
  "eligible": true,
  "reason": "Action-oriented request detected",
  "confidence": 0.85
}
```

#### `skill_executor`
**Purpose**: Executes a skill and returns observation

**Inputs**:
- `[0]`: Skill invocation `{ action, actionInput }`

**Outputs**:
```json
{
  "observation": "Task created with ID task-123",
  "success": true,
  "outputs": { ... }
}
```

#### `loop_controller`
**Purpose**: Manages multi-iteration ReAct loops (monolithic)

**Inputs**:
- `[0]`: User message
- `[1]`: Context package

**Properties**:
- `maxIterations`: 10
- `completionDetection`: "auto"

**Outputs**:
```json
{
  "scratchpad": [ ... ],
  "finalAnswer": "...",
  "iterations": 3,
  "complete": true
}
```

### Modular ReAct Nodes (New!)

These are composable building blocks for creating custom ReAct workflows without the monolithic `loop_controller`:

#### `scratchpad_initializer`
**Purpose**: Creates empty scratchpad for ReAct

**Outputs**:
```json
{
  "scratchpad": [],
  "iteration": 0,
  "maxIterations": 10,
  "isComplete": false
}
```

#### `scratchpad_updater`
**Purpose**: Appends thought/action/observation to scratchpad

**Inputs**:
- `[0]`: Current scratchpad state
- `[1]`: New entry `{ thought, action, observation }`

**Outputs**:
```json
{
  "scratchpad": [...entries],
  "iteration": N + 1,
  "maxIterations": 10
}
```

#### `iteration_counter`
**Purpose**: Tracks iteration count and checks limits

**Inputs**:
- `[0]`: Scratchpad state

**Outputs**:
```json
{
  "iteration": 3,
  "maxIterations": 10,
  "hasExceededMax": false,
  "shouldContinue": true,
  "scratchpadLength": 3
}
```

#### `scratchpad_completion_checker`
**Purpose**: Detects if ReAct task is complete

**Inputs**:
- `[0]`: Response text (checks for "Final Answer:")
- `[1]`: Scratchpad state

**Outputs**:
```json
{
  "isComplete": true,
  "hasFinalAnswer": true,
  "hasExceededMax": false,
  "reason": "final_answer"
}
```

#### `scratchpad_formatter`
**Purpose**: Formats scratchpad for display

**Inputs**:
- `[0]`: Scratchpad state

**Properties**:
- `format`: "text" | "json" | "markdown"

**Outputs**:
```json
{
  "formatted": "Thought: ...\nAction: ...\nObservation: ...",
  "entries": 3
}
```

### Output Nodes

#### `memory_capture`
**Purpose**: Saves conversation to episodic memory

**Inputs**:
- `[0]`: User message
- `[1]`: Assistant response
- `[2]`: System settings (for memory policy)

**Outputs**:
```json
{
  "saved": true,
  "type": "conversation",
  "eventId": "evt-20251120040000-..."
}
```

**Note**: Only saves if authenticated and memory writes allowed

#### `buffer_manager`
**Purpose**: Persists conversation history to disk

**Inputs**:
- `[0]`: Messages array (updated conversation history)

**Outputs**:
```json
{
  "persisted": true,
  "mode": "conversation",
  "messageCount": 15,
  "sessionId": "conv-..."
}
```

**Side Effects**: Writes to `profiles/<user>/state/conversation-buffer-<mode>.json`

#### `stream_writer`
**Purpose**: Outputs response to user (terminal node)

**Inputs**:
- `[0]`: Response text or object containing response

**Outputs**:
```json
{
  "output": "Response text sent to user",
  "completed": true
}
```

**Note**: This is typically the final node in a graph

## How Routing Works

When you send a message, here's what happens:

1. **Graph Selection**: System loads the appropriate graph based on `cognitiveMode`
   ```typescript
   const graphPath = `etc/cognitive-graphs/${cognitiveMode}-mode.json`;
   ```

2. **Topological Sort**: Graph executor determines execution order
   ```
   Nodes with no dependencies → Nodes depending on those → ... → Terminal nodes
   ```

3. **Sequential Execution**: Each node executes in order
   ```typescript
   for (const nodeId of executionOrder) {
     const inputs = getNodeInputs(nodeId, graph, executionState);
     const outputs = await executeNode(nodeId, inputs, context);
     executionState.set(nodeId, { outputs });
   }
   ```

4. **Output Extraction**: Final response extracted from terminal node outputs

5. **Streaming**: Response streamed back to user via SSE

## Execution Flow Example

**Emulation Mode Message**: "Tell me about my recent memories"

```
[graph-pipeline] 🚀 Starting execution: Emulation Mode (Enhanced) v1.1
[graph-pipeline]    Nodes: 13, Links: 15
[graph-pipeline]    Cognitive Mode: emulation
[graph-pipeline]    Context: userId=f1be5026..., sessionId=conv-...

[graph-pipeline]    ➤ Node 1 (user_input) START
[graph-pipeline]    ✓ Node 1 (user_input) DONE (5ms)
[graph-pipeline]      Outputs: {message,sessionId,userId,timestamp}

[graph-pipeline]    ➤ Node 4 (conversation_history) START
[graph-pipeline]    ✓ Node 4 (conversation_history) DONE (12ms)
[graph-pipeline]      Outputs: {messages,count,loadedFromBuffer}

[graph-pipeline]    ➤ Node 5 (semantic_search) START
[graph-pipeline]    ✓ Node 5 (semantic_search) DONE (150ms)
[graph-pipeline]      Outputs: {memories,query}

[graph-pipeline]    ➤ Node 6 (persona_llm) START
[graph-pipeline]    ✓ Node 6 (persona_llm) DONE (2450ms)
[graph-pipeline]      Outputs: {response}

[graph-pipeline]    ➤ Node 8 (cot_stripper) START
[graph-pipeline]    ✓ Node 8 (cot_stripper) DONE (2ms)

[graph-pipeline]    ➤ Node 9 (safety_validator) START
[graph-pipeline]    ✓ Node 9 (safety_validator) DONE (3ms)

[graph-pipeline]    ➤ Node 10 (response_refiner) START
[graph-pipeline]    ✓ Node 10 (response_refiner) DONE (5ms)

[graph-pipeline]    ➤ Node 7 (stream_writer) START
[graph-pipeline]    ✓ Node 7 (stream_writer) DONE (1ms)

[graph-pipeline] ✅ COMPLETE: 13 nodes in 2650ms
[graph-pipeline]    Pipeline: user_input → session_context → system_settings → conversation_history → semantic_search → persona_llm → cot_stripper → safety_validator → response_refiner → memory_capture → buffer_manager → stream_writer
```

## Viewing & Editing Graphs

### Node Editor (Web UI)

1. **Access**: Click "Node Editor" in left sidebar
2. **View**: See visual representation of current cognitive mode's graph
3. **Edit**: Drag nodes, create connections (visual editor)
4. **Test**: Click "Execute" to test graph with sample data
5. **Save**: Changes automatically saved to JSON file

### Manual Editing

Graph files are stored in `etc/cognitive-graphs/`:

```bash
# View current graphs
ls etc/cognitive-graphs/

# Edit a graph
code etc/cognitive-graphs/emulation-mode.json

# Validate graph structure
jq '.' etc/cognitive-graphs/emulation-mode.json
```

**Graph JSON Structure**:
```json
{
  "version": "1.1",
  "name": "Emulation Mode (Enhanced)",
  "cognitiveMode": "emulation",
  "nodes": [
    {
      "id": 1,
      "type": "cognitive/user_input",
      "pos": [50, 260],
      "size": [180, 60],
      "title": "User Input"
    }
  ],
  "links": [
    {
      "id": 1,
      "origin_id": 1,
      "origin_slot": 0,
      "target_id": 2,
      "target_slot": 0,
      "type": "string"
    }
  ]
}
```

## Creating Custom Graphs

Want to create a custom cognitive workflow? Here's how:

### 1. Copy Existing Graph

```bash
cp etc/cognitive-graphs/emulation-mode.json etc/cognitive-graphs/custom/my-mode.json
```

### 2. Edit Node Structure

Add/remove nodes, change connections, adjust properties:

```json
{
  "nodes": [
    {
      "id": 1,
      "type": "cognitive/user_input"
    },
    {
      "id": 2,
      "type": "cognitive/my_custom_node",
      "properties": {
        "customParam": "value"
      }
    }
  ],
  "links": [
    {
      "origin_id": 1,
      "target_id": 2
    }
  ]
}
```

### 3. Create Custom Node Executor (Optional)

If you need new node types, add executor in `packages/core/src/node-executors.ts`:

```typescript
export const myCustomNodeExecutor: NodeExecutor = async (inputs, context) => {
  const userMessage = inputs[0];

  // Your custom logic here

  return {
    customOutput: "result"
  };
};

// Register it
export const nodeExecutors = {
  // ...
  'my_custom_node': myCustomNodeExecutor,
};
```

### 4. Test Your Graph

```bash
# Load it via API
curl http://localhost:4321/api/graph/execute \
  -d '{"graphPath": "custom/my-mode.json", "message": "test"}'
```

## Configuration

### Runtime Flags

Enable/disable node pipeline in `etc/runtime.json`:

```json
{
  "cognitive": {
    "useNodePipeline": true  // ← Enables graph execution for ALL modes
  }
}
```

When `false`, system falls back to legacy operator/chat code.

### Logging

Control verbosity in `etc/logging.json`:

```json
{
  "levels": {
    "graph-pipeline": "debug",  // ← Detailed execution logs
    "node-executor": "debug"    // ← Individual node logs
  }
}
```

Log levels: `debug` → `info` → `warn` → `error` → `none`

## Performance

**Typical Execution Times**:
- **Emulation Mode**: 2-4 seconds (13 nodes)
- **Dual Mode** (chat path): 3-5 seconds (9 nodes)
- **Dual Mode** (operator path): 5-15 seconds (16 nodes, multi-iteration)

**Bottlenecks**:
- LLM generation (persona_llm, react_planner): 2-10s per call
- Semantic search: 50-200ms (depends on index size)
- All other nodes: <10ms each

## Troubleshooting

### Graph Not Loading

**Symptom**: `[loadGraphForMode] ❌ File not found`

**Solution**: Check file path and permissions
```bash
ls -l etc/cognitive-graphs/
```

### Node Execution Fails

**Symptom**: `[Node:X] Execution error: ...`

**Solution**: Check logs for specific error, validate inputs
```bash
tail -f logs/graph-traces.ndjson
```

### Response Not Generated

**Symptom**: `Graph executed but produced no response`

**Solution**: Ensure graph has terminal node (stream_writer) and outputs are properly connected

### Fallback to Legacy System

**Symptom**: `⚠️ Graph pipeline returned null - falling back to legacy`

**Solution**: Graph execution failed, check audit logs:
```bash
grep "graph_pipeline_fallback" logs/audit/$(date +%Y-%m-%d).ndjson
```

## Best Practices

### 1. Keep Graphs Simple

- Start with existing graphs as templates
- Add nodes incrementally
- Test after each change

### 2. Use Modular Scratchpad Nodes

Instead of monolithic `loop_controller`, compose from:
- `scratchpad_initializer`
- `react_planner`
- `skill_executor`
- `scratchpad_updater`
- `scratchpad_completion_checker`

This gives you full control over the ReAct loop!

### 3. Enable Debug Logging

While developing custom graphs:
```json
{
  "levels": {
    "graph-pipeline": "debug"
  }
}
```

### 4. Version Your Graphs

Increment version in graph JSON when making changes:
```json
{
  "version": "1.2",  // ← Bump this
  "last_modified": "2025-11-20"
}
```

### 5. Document Custom Nodes

Add comments to links explaining data flow:
```json
{
  "links": [
    {
      "id": 1,
      "origin_id": 1,
      "target_id": 2,
      "comment": "User message → Context builder"
    }
  ]
}
```

### 6. Validate Your Graphs

Always ensure your graphs are valid before deploying them. The system incorporates robust validation, safe defaults, and linting to prevent unexpected behavior. Starting from an existing template can significantly aid in creating valid graphs.

### 7. Start from Templates

Utilize the provided graph templates as a foundation rather than building from scratch, especially for complex workflows. This leverages proven structures and reduces errors.

## Related Documentation

- [SCRATCHPAD_NODES.md](../../docs/SCRATCHPAD_NODES.md) - Modular ReAct components API
- [NODE_PIPELINE_MIGRATION.md](../../docs/NODE_PIPELINE_MIGRATION.md) - Migration status and phase tracking
- [27-cognitive-architecture.md](27-cognitive-architecture.md) - Overall cognitive architecture
- [04-core-concepts.md](04-core-concepts.md) - Core system concepts

## Future Enhancements

We are continuously working to improve the node-based system. Planned enhancements include:

- **Conditional Router Node**: Enable graph-level loops without monolithic controller
- **Parallel Execution**: Run independent nodes concurrently
- **Streaming Output**: Stream LLM tokens in real-time through graph
- **Graph Debugger**: Step-through execution with breakpoints
- **Visual Editor Improvements**: Drag-and-drop node creation, auto-layout
- **Node Marketplace**: Share and download community-created nodes
- **Performance Profiling**: Per-node timing and bottleneck identification
