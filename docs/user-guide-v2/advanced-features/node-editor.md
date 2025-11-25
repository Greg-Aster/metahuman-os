# Node Editor

The Node Editor is a visual programming interface for designing and customizing cognitive workflows in MetaHuman OS. Built on LiteGraph.js, it allows you to wire together processing nodes to create custom reasoning pipelines, agent behaviors, and conversation flows.

## Overview

The Node Editor provides:
- **Visual workflow design**: Drag-and-drop node-based programming
- **50+ cognitive nodes**: Pre-built components for all system operations
- **Template library**: Pre-configured workflows for common use cases
- **Real-time execution**: See data flow through your graphs
- **Custom graph saving**: Create and share your own workflows
- **Cognitive mode integration**: Edit the workflows that power dual/agent/emulation modes

## Accessing the Node Editor

### Via Web UI

1. Click **Node Editor** in the left sidebar
2. Editor opens with cognitive mode workflow loaded
3. Canvas displays current active graph

### Editor Layout

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [Save] [Load▼] [Execute] [Traces] [Help]      │
├─────────┬───────────────────────────────────────────────┤
│ Node    │ Canvas                                        │
│ Palette │                                               │
│         │  ┌───────┐      ┌───────┐      ┌────────┐   │
│ Input   │  │ Input │─────▶│ Model │─────▶│ Output │   │
│ Router  │  └───────┘      └───────┘      └────────┘   │
│ Context │                                               │
│ Operator│                                               │
│ Chat    │                                               │
│ Model   │                                               │
│ Skill   │                                               │
│ Output  │                                               │
│ Control │                                               │
│ Memory  │                                               │
│ Utility │                                               │
│ Agent   │                                               │
│ Config  │                                               │
└─────────┴───────────────────────────────────────────────┘
```

## Node Categories

### 1. Input Nodes (Green)

**Purpose:** Capture user input and system state

- **Mic Input**: Captures audio from microphone for speech recognition
- **Speech to Text**: Converts audio to text using Whisper STT
- **Text Input**: Gateway to chat interface text field
- **User Input**: Unified input node (prioritizes chat interface, can accept text/speech)
- **Session Context**: Loads conversation history and user object
- **System Settings**: Provides cognitive mode, trust level, system config

**Example Use:** User Input → routes to either Text Input or Mic Input → Speech to Text

### 2. Router Nodes (Amber)

**Purpose:** Conditional routing and decision-making

- **Cognitive Mode Router**: Routes based on dual/agent/emulation mode
  - Output: `useDual` → operator path
  - Output: `useAgent` → conditional routing
  - Output: `useEmulation` → chat-only path
- **Smart Router**: Heuristic-based routing (action intent detection)
  - Analyzes message for action keywords
  - Routes to operator or chat accordingly

**Example Use:** Cognitive Mode Router → [Dual path] → Operator | [Emulation path] → Chat

### 3. Context Nodes (Blue)

**Purpose:** Prepare and format context for LLM

- **Conversation History**: Loads recent conversation messages
- **Buffer Manager**: Manages context window size
- **Observation Formatter**: Formats memory observations
- **Persona Formatter**: Injects persona details into prompt

**Example Use:** Conversation History + Persona Formatter → Model

### 4. Operator Nodes (Purple)

**Purpose:** ReAct operator pipeline components

- **Iteration Counter**: Tracks operator loop iterations (max 10)
- **Scratchpad Formatter**: Formats Thought→Action→Observation blocks
- **Scratchpad Completion Checker**: Detects when final answer is reached

**Example Use:** Iteration Counter → Scratchpad Formatter → LLM → Scratchpad Completion Checker

### 5. Chat Nodes (Pink)

**Purpose:** Persona-driven conversation

- **Chat View**: Renders chat messages in UI
- **Orchestrator LLM**: Operator planning model
- **Persona Summary Loader**: Loads condensed persona for context

**Example Use:** Persona Summary Loader + User Message → Orchestrator LLM → Chat View

### 6. Model Nodes (Orange)

**Purpose:** LLM routing and configuration

- **Model Router**: Routes to appropriate model based on role (orchestrator/persona/curator/fallback)
- **Curator LLM**: Dataset curation model for training

**Example Use:** Model Router [role: "persona"] → loads persona model + adapters

### 7. Skill Nodes (Emerald)

**Purpose:** Execute system operations

- **FS Write**: Write files to filesystem
- **FS List**: List directory contents
- **Task Create**: Create new task
- **Task Update**: Update task status
- **Search Index**: Semantic memory search
- **Web Search**: External web search

**Example Use:** User: "Create task to buy groceries" → Task Create skill

### 8. Output Nodes (Red)

**Purpose:** Generate and refine responses

- **TTS**: Text-to-speech conversion
- **Response Synthesizer**: Combines operator results into final response
- **Chain of Thought Stripper**: Removes internal reasoning from output
- **Safety Validator**: Content safety checks
- **Response Refiner**: Post-processing and formatting

**Example Use:** Response Synthesizer → Chain of Thought Stripper → Safety Validator → Chat View

### 9. Control Flow Nodes (Indigo)

**Purpose:** Logic control and iteration

- **Conditional**: Route based on boolean condition
  - Inputs: condition object, data
  - Outputs: truePath, falsePath
- **Switch**: Multi-way routing based on value
  - Properties: switchField, cases, defaultCase
- **For Each**: Iterates over array elements
  - Processes each item through connected nodes
  - Returns array of results + count

**Example Use:** For Each [unprocessed memories] → LLM Enricher → Memory Saver

### 10. Memory Nodes (Violet)

**Purpose:** Memory operations and curation

- **Weighted Sampler**: Samples memories with exponential decay (14-day decay factor)
- **Associative Chain**: Follows keyword connections (chain length: 5)
- **Memory Filter**: Filter by type, tags, date range
- **Uncurated Memory Loader**: Loads raw episodic memories
- **Memory Marker**: Marks memories as processed
- **Curated Memory Saver**: Saves curator-approved memories

**Example Use:** Weighted Sampler → Memory Filter [type: conversation] → Associative Chain

### 11. Utility Nodes (Slate)

**Purpose:** Support functions

- **Audit Logger**: Logs events to audit trail
  - Properties: category, event, level
- **Curiosity Weighted Sampler**: Samples memories for curiosity questions
- **Curiosity Question Generator**: Generates user-facing questions
- **Curiosity Question Saver**: Saves question as inner_dialogue
- **Curiosity Activity Check**: Checks user activity for curiosity triggers

**Example Use:** Task Create → Audit Logger [event: "task_created"]

### 12. Agent Nodes (Cyan)

**Purpose:** Autonomous agent workflows

- **Training Pair Generator**: Generates LoRA training pairs
- **Training Pair Appender**: Appends to JSONL training file

**Example Use:** See pre-built Organizer Agent template

### 13. Config Nodes (Yellow)

**Purpose:** System configuration

- **System Settings**: Outputs current system configuration
  - cognitiveMode, trustLevel, settings object

## Node Connections

### Slot Types

Nodes connect via typed slots:
- **string**: Text data
- **number**: Numeric values
- **boolean**: True/false
- **object**: JSON objects
- **array**: Arrays of data
- **message**: User/assistant messages
- **context**: Conversation context
- **cognitiveMode**: dual/agent/emulation
- **user**: User object
- **memory**: Memory object
- **skill_result**: Skill execution result
- **llm_response**: LLM output
- **decision**: Routing decision
- **any**: Universal type

### Connection Rules

- Output slot → Input slot of matching type
- `any` type accepts all connections
- Multiple connections from one output allowed
- Only one connection to each input slot

## Template Library

### Cognitive Mode Workflows

**Built-in templates** for each cognitive mode:

**1. Dual Consciousness Mode**
- User Input → Cognitive Mode Router → [Dual path]
- Memory Search → Persona Formatter → Orchestrator LLM
- Scratchpad loop with iteration counter
- Skill execution based on planner decisions
- Response synthesis with memory grounding

**2. Agent Mode**
- User Input → Smart Router
- Heuristic detection: action keywords → operator | simple query → chat
- Lightweight routing for fast responses
- No memory grounding

**3. Emulation Mode**
- User Input → Persona Chat (direct)
- No operator, no memory search
- Chat-only with frozen personality

### Agent Workflows

**Organizer Agent** (Built-in template):
1. Memory Loader [onlyUnprocessed: true, limit: 10]
2. For Each [itemName: "memory"]
3. LLM Enricher [extract tags and entities]
4. Memory Saver [updateOnly: true]
5. Audit Logger [event: "organizer_memory_processed"]

**Execution:** Scheduled every 5 minutes (300000ms)

### Legacy Workflows

- **Dual Mode v1.1 Backup**: Previous dual consciousness version
- **Dual Mode v1.2 Backup**: Intermediate dual consciousness version

**Use Case:** Rollback to older workflow if new version has issues

## Creating Custom Graphs

### Basic Workflow

1. **Open Node Editor**
2. **Clear canvas** (if loading existing graph)
3. **Add nodes** from palette:
   - Click category to expand
   - Drag node onto canvas
4. **Connect nodes**:
   - Click output slot (right side)
   - Drag to input slot (left side)
   - Release to create connection
5. **Configure properties**:
   - Double-click node to open properties panel
   - Edit values
   - Click outside to close
6. **Save graph**:
   - Press `Ctrl+S` or click Save button
   - Enter graph name
   - Choose scope: custom (your graphs) or builtin (system-wide)

### Example: Custom Reflection Agent

**Goal:** Generate reflection when user has been inactive for 15 minutes

**Nodes:**
1. **Curiosity Activity Check** [threshold: 900000ms]
   - Checks last user activity timestamp
2. **Conditional** [truePath: inactive]
   - Routes based on activity check result
3. **Weighted Sampler** [sampleSize: 5, decayFactor: 14]
   - Samples recent memories
4. **Associative Chain** [chainLength: 5]
   - Builds memory chain
5. **Orchestrator LLM** [prompt: reflection template]
   - Generates reflection from chain
6. **Curiosity Question Saver** [type: inner_dialogue]
   - Saves as internal thought
7. **Audit Logger** [event: "reflection_generated"]

**Connections:**
```
Curiosity Activity Check → Conditional
Conditional [truePath] → Weighted Sampler
Weighted Sampler → Associative Chain
Associative Chain → Orchestrator LLM
Orchestrator LLM → Curiosity Question Saver
Curiosity Question Saver → Audit Logger
```

**Save as:** `custom-reflection-agent` (custom scope)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current graph |
| `Ctrl+Z` | Undo last change |
| `Ctrl+Shift+Z` | Redo change |
| `Del` | Delete selected node/connection |
| `Ctrl+C` | Copy selected nodes |
| `Ctrl+V` | Paste nodes |
| `Ctrl+A` | Select all nodes |
| `Space` | Pan canvas (hold and drag) |
| `Mouse Wheel` | Zoom in/out |
| `F` | Frame all nodes in view |
| `?` | Show keyboard help |

## Executing Graphs

### Manual Execution

1. Click **Execute** button in toolbar
2. Graph runs from input nodes to output nodes
3. Data flows through connections
4. Results displayed in output nodes
5. Execution trace saved to history

### Scheduled Execution

**For agent workflows:**
1. Set `executionMode: "scheduled"` in graph metadata
2. Set `scheduledInterval` in milliseconds
3. Save graph
4. Scheduler service auto-runs at interval

**Example:** Organizer Agent runs every 5 minutes

### Execution Context

Graphs execute with access to:
- **Chat context**: Current user message, conversation history
- **User context**: Username, authentication, permissions
- **System context**: Cognitive mode, trust level, settings
- **Memory access**: Read episodic memories, search index
- **Skill access**: Execute all registered skills
- **Model access**: Call LLMs via model router

## Execution Traces

### Viewing Traces

1. Click **Traces** button in toolbar
2. Panel opens showing execution history
3. Each trace shows:
   - Timestamp
   - Cognitive mode
   - Graph name
   - Session ID
   - Status (success/error)
   - Duration (ms)
   - Event count (nodes executed)

### Trace Details

Click trace entry to view:
- Full execution log
- Node-by-node data flow
- Input/output values
- Error messages (if failed)
- Performance metrics

**Use Case:** Debugging custom graphs, optimizing performance

## Graph Storage

### Built-in Graphs

**Location:** `apps/site/src/lib/cognitive-nodes/templates/*.json`

**Managed by:** MetaHuman core team

**Scope:** System-wide, all users

**Examples:**
- `dual-mode.json`
- `agent-mode.json`
- `emulation-mode.json`
- `organizer-agent.json`

### Custom Graphs

**Location:** `profiles/<username>/graphs/*.json`

**Managed by:** Individual users

**Scope:** Per-user

**Format:**
```json
{
  "name": "My Custom Graph",
  "description": "Custom workflow for X",
  "version": "1.0.0",
  "category": "agent",
  "nodes": [
    {
      "id": 1,
      "type": "text_input",
      "properties": {},
      "position": [100, 100]
    }
  ],
  "links": [
    {
      "id": 1,
      "origin_id": 1,
      "origin_slot": 0,
      "target_id": 2,
      "target_slot": 0
    }
  ],
  "metadata": {
    "author": "username",
    "created": "2025-11-25",
    "tags": ["custom", "workflow"],
    "executionMode": "manual"
  }
}
```

## Advanced Techniques

### Loop Patterns

**For Each Loop:**
```
Memory Loader → For Each → [Loop body] → Memory Saver
```

**While Loop (Manual):**
```
Iteration Counter → Conditional → [Loop body] → [Loop back to counter]
                        ↓ [exit path]
                    Output Node
```

### Conditional Branching

**Binary Decision:**
```
Input → Conditional → [truePath] → Process A
                   → [falsePath] → Process B
```

**Multi-way Switch:**
```
Input → Switch [cognitiveMode] → [case: dual] → Operator Path
                              → [case: agent] → Smart Router
                              → [case: emulation] → Chat Path
```

### Memory Chains

**Associative Thinking:**
```
Weighted Sampler → Memory Filter → Associative Chain → LLM
```

**Use Case:** Reflection generation, curiosity questions

### Skill Composition

**Task Workflow:**
```
User Input → Task Create → Task Update → Audit Logger → Chat View
```

### Model Orchestration

**Multi-stage Processing:**
```
Input → Model Router [role: orchestrator] → Planner
      → Model Router [role: persona] → Responder
      → Model Router [role: curator] → Quality Check
```

## Best Practices

### Design Principles

1. **Single Responsibility**: Each node does one thing well
2. **Clear Data Flow**: Left-to-right, top-to-bottom
3. **Error Handling**: Add Safety Validator and Conditional nodes
4. **Audit Everything**: Use Audit Logger for important operations
5. **Minimize Complexity**: Prefer simple graphs over deep nesting

### Performance Optimization

1. **Limit Memory Sampling**: Use `limit` property on Memory Loader
2. **Cache Results**: Store expensive computations in properties
3. **Early Exit**: Use Conditional to skip unnecessary processing
4. **Batch Operations**: Use For Each efficiently
5. **Monitor Traces**: Check execution times, optimize slow nodes

### Testing Workflows

1. **Start Simple**: Build incrementally, test at each step
2. **Use Mock Data**: Test with sample inputs before production
3. **Check Traces**: Review execution logs after each run
4. **Validate Outputs**: Verify expected data at each stage
5. **Handle Errors**: Add error paths for common failures

## Troubleshooting

### Graph Won't Execute

**Cause:** Disconnected nodes or missing inputs
**Solution:**
- Check all nodes are connected
- Verify input nodes have data sources
- Review execution trace for errors

### Nodes Not Connecting

**Cause:** Type mismatch between slots
**Solution:**
- Check slot types (output `string` → input `string`)
- Use `any` type for universal connections
- Add type conversion node if needed

### Execution Timeout

**Cause:** Infinite loop or slow nodes
**Solution:**
- Check Iteration Counter max limit
- Review Conditional exit paths
- Optimize Memory Sampler limits
- Monitor LLM response times

### Graph Not Saving

**Cause:** Permission error or invalid JSON
**Solution:**
- Check write access (not in emulation mode)
- Verify graph name is valid (no special chars)
- Review browser console for errors

### Template Won't Load

**Cause:** Corrupted template or missing nodes
**Solution:**
- Check template JSON format
- Verify all referenced node types exist
- Review node registry for missing implementations

## Example Workflows

### 1. Custom Memory Curator

**Goal:** Filter conversation memories for quality training data

**Nodes:**
1. Uncurated Memory Loader [type: "conversation", limit: 100]
2. Memory Filter [startDate: last 30 days]
3. For Each [itemName: "memory"]
4. Curator LLM [confidence threshold: 0.8]
5. Conditional [truePath: high confidence]
6. Curated Memory Saver
7. Training Pair Generator
8. Training Pair Appender [file: training-dataset.jsonl]

### 2. Smart Question Answerer

**Goal:** Answer questions using memory context

**Nodes:**
1. User Input
2. Search Index [query: user message, limit: 5]
3. Memory Filter [relevant results]
4. Persona Formatter [inject persona + memories]
5. Model Router [role: "persona"]
6. Response Synthesizer
7. Chain of Thought Stripper
8. Chat View

### 3. Task Automation Agent

**Goal:** Auto-create tasks from conversation

**Nodes:**
1. Conversation History
2. Smart Router [detect task mentions]
3. Conditional [hasTasks: true]
4. Task Create [extract title/description from message]
5. Task Update [status: "active"]
6. Audit Logger [event: "auto_task_created"]
7. Chat View [confirmation message]

## Integration with Cognitive Modes

The Node Editor is the **visual representation** of cognitive mode logic:

**Dual Mode** = Complex operator graph with memory grounding
**Agent Mode** = Simple smart router with conditional operator
**Emulation Mode** = Direct chat path, no operator

**Editing Cognitive Modes:**
1. Load cognitive mode template (e.g., `dual-mode`)
2. Modify nodes and connections
3. Save as built-in graph (requires admin access)
4. Restart system to apply changes

**Warning:** Modifying cognitive mode graphs affects system behavior. Test thoroughly before saving as built-in.

## Next Steps

- Explore [Autonomous Agents](autonomous-agents.md) to see node graphs in action
- Learn [Skills System](skills-system.md) for available skill nodes
- Review [Cognitive Modes](../training-personalization/cognitive-modes.md) to understand mode workflows
- Check [Dashboard Monitoring](../using-metahuman/dashboard-monitoring.md) for execution traces
