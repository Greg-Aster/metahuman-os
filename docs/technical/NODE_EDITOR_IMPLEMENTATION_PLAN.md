# Node-Based Cognitive System Editor - Implementation Plan

**Version**: 1.0
**Date**: 2025-11-18
**Author**: Claude Code + greggles
**Status**: Phase 1 In Progress

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Cognitive System Architecture Research](#cognitive-system-architecture-research)
3. [Implementation Phases](#implementation-phases)
4. [Node Type Specifications](#node-type-specifications)
5. [Graph Templates](#graph-templates)
6. [Technical Architecture](#technical-architecture)
7. [Integration Points](#integration-points)
8. [File Structure](#file-structure)
9. [API Specifications](#api-specifications)
10. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Vision
Create a visual node-based editor (similar to ComfyUI) that allows users to visualize, edit, and configure the MetaHuman OS cognitive pipeline. Users can toggle between the traditional chat interface and a node editor view via a switch in the header.

### Goals
- **Transparency**: Visualize the complete cognitive pipeline from input to output
- **Customization**: Allow users to modify routing logic, add custom skills, and override model selection
- **Debugging**: Trace execution paths in real-time with node highlighting and data flow visualization
- **Flexibility**: Save custom cognitive graphs and switch between templates
- **Education**: Help users understand how the system processes their requests

### Technology Stack
- **LiteGraph.js** v0.7.18 - Node graph editor library
- **Svelte** v4.2.19 - Component framework
- **Astro** v4.14.0 - Web framework
- **TypeScript** - Type safety
- **JSON** - Graph serialization format

---

## Cognitive System Architecture Research

### 1. Cognitive Mode System

**Location**: `packages/core/src/cognitive-mode.ts`, `persona/cognitive-mode.json`

#### Three Operational Modes

##### 1.1 Dual Consciousness Mode (Default)
- **Behavior**: Always routes through operator pipeline (planner → skills → narrator)
- **Memory**: Full read/write access, mandatory semantic search grounding
- **Agents**: Proactive agents enabled
- **Use Case**: Primary operational mode with full system capabilities
- **Metadata Tag**: `cognitiveMode: "dual"`

##### 1.2 Agent Mode
- **Behavior**: Heuristic-based routing (simple queries use chat, action requests use operator)
- **Memory**: Write access for authenticated users, read-only for anonymous
- **Agents**: Proactive agents disabled
- **Use Case**: Lightweight assistant mode with reduced cognitive load
- **Metadata Tag**: `cognitiveMode: "agent"`

##### 1.3 Emulation Mode
- **Behavior**: Never routes to operator (chat-only)
- **Memory**: Read-only (for authenticated), no writes for anonymous
- **Agents**: Proactive agents disabled
- **Use Case**: Stable personality snapshot for demos/testing
- **Metadata Tag**: `cognitiveMode: "emulation"`

#### Key Functions
```typescript
loadCognitiveMode() // Load current mode
saveCognitiveMode(mode, actor) // Switch modes
canWriteMemory(mode) // Check memory write permission
canUseOperator(mode) // Check operator usage permission
getModeDefinition(mode) // Get mode configuration
```

---

### 2. Model Routing & LLM Integration

**Locations**:
- Model Router: `packages/core/src/model-router.ts`
- Model Resolver: `packages/core/src/model-resolver.ts`
- Model Registry: `etc/models.json`
- LLM Adapter: `packages/core/src/llm.ts`

#### 2.1 Model Roles (8 Specialized Roles)

| Role | Model | Temp | Purpose |
|------|-------|------|---------|
| **orchestrator** | qwen3:14b | 0.1 | Intent routing and tool selection |
| **persona** | qwen3:14b | 0.8 | Conversational responses |
| **curator** | qwen3:14b | 0.3 | Memory curation and training data prep |
| **coder** | qwen3-coder:30b | 0.2 | Code generation/review |
| **planner** | qwen3-coder:30b | 0.4 | Strategic planning and task breakdown |
| **summarizer** | qwen3:14b | 0.3 | Document/conversation summarization |
| **psychotherapist** | qwen3:30b | 0.7 | Persona analysis (motivational interviewing) |
| **fallback** | qwen3:14b | 0.7 | General purpose backup |

#### 2.2 Cognitive Mode Mappings

Each cognitive mode can override model selections:

```json
{
  "dual": {
    "orchestrator": "default.orchestrator",
    "persona": "default.orchestrator",
    "coder": "default.coder",
    "psychotherapist": "qwen3:30b"
  },
  "agent": {
    "orchestrator": "default.orchestrator",
    "persona": "default.persona",
    "coder": "default.coder"
  },
  "emulation": {
    "orchestrator": "qwen3:0.6b",
    "persona": "default.orchestrator"
  }
}
```

#### 2.3 Key Functions
```typescript
callLLM({ role, messages, options }) // Role-based LLM call
callLLMText() // Simple text response
callLLMPrompt() // Single user message
callLLMJSON() // Structured JSON response
resolveModel(role) // Get model for role
resolveModelForCognitiveMode(mode, role) // Get mode-specific model
```

---

### 3. Operator System (ReAct Loop)

**Location**: `brain/agents/operator-react.ts`, `etc/operator.json`

#### 3.1 ReAct Pattern
Modern agentic loop using Reason + Act pattern:
1. **THINK**: Plan next single step (not all steps upfront)
2. **ACT**: Execute one skill
3. **OBSERVE**: Record what happened
4. **REFLECT**: Am I done?

#### 3.2 Key Features

##### Fast-Path Optimizations
- **Pure Chat Detection**: Skips ReAct for simple greetings ("hi", "how are you")
- **Completion Rules**: Deterministic checks before LLM evaluation
  - `conversational_response` skill is terminal
  - Errors require adaptation
  - First filesystem/task operations need follow-up

##### Fuzzy Path Resolution
- Auto-corrects misspelled filenames
- Suggests alternatives when files not found
- Prevents "file not found" failures

##### Error Recovery
- Failure loop detection (prevents repeated failures)
- Contextual error analysis with suggestions
- Error codes: `FILE_NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_ARGS`, etc.

#### 3.3 Configuration (`etc/operator.json`)

```json
{
  "version": "2.0",
  "scratchpad": {
    "maxSteps": 10,
    "trimToLastN": 10,
    "enableVerbatimMode": true,
    "enableErrorRetry": true
  },
  "models": {
    "useSingleModel": false,
    "planningModel": "default.coder",
    "responseModel": "persona"
  },
  "performance": {
    "cacheCatalog": true,
    "catalogTTL": 60000
  }
}
```

#### 3.4 Scratchpad Entry Structure

```typescript
interface ScratchpadEntry {
  step: number;
  thought: string;
  action?: {
    tool: string;
    args: Record<string, any>
  };
  observation?: {
    mode: 'narrative' | 'structured' | 'verbatim';
    content: string;
    success: boolean;
    error?: {
      code: string;
      message: string;
      context: any
    };
  };
  outputs?: any; // Raw skill outputs
  timestamp: string;
}
```

---

### 4. Skills System

**Locations**:
- Core: `packages/core/src/skills.ts`
- Registry: `brain/skills/index.ts`
- Implementations: `brain/skills/*.ts`

#### 4.1 Registered Skills (25 Total)

##### Filesystem (6 skills)
- `fs_read` - Read file contents
- `fs_write` - Write file contents
- `fs_list` - List files/directories
- `fs_delete` - Delete files
- `git_status` - Git repository status
- `git_commit` - Git commit changes

##### Tasks (5 skills)
- `task_create` - Create new task
- `task_list` - List active tasks
- `task_find` - Find specific task
- `task_update_status` - Update task status
- `task_delete` - Delete task

##### Search (2 skills)
- `search_index` - Semantic memory search
- `web_search` - Web search via API

##### Development (3 skills)
- `code_generate` - Generate code
- `code_apply_patch` - Apply code patches
- `shell_safe` - Safe shell command execution

##### Communication (1 skill)
- `conversational_response` - Generate natural language responses

##### Other (4 skills)
- `json_update` - Update JSON files
- `http_get` - HTTP GET requests
- `summarize_file` - Summarize file contents
- `run_agent` - Run autonomous agent

#### 4.2 Skill Manifest Structure

```typescript
interface SkillManifest {
  id: string;
  name: string;
  description: string;
  category: 'fs' | 'memory' | 'agent' | 'shell' | 'network';
  inputs: Record<string, SkillInput>;
  outputs: Record<string, SkillOutput>;
  risk: 'low' | 'medium' | 'high';
  cost: 'free' | 'cheap' | 'expensive';
  minTrustLevel: 'observe' | 'suggest' | 'supervised_auto' | 'bounded_auto';
  requiresApproval: boolean;
  allowedDirectories?: string[];
  commandWhitelist?: string[];
}
```

---

### 5. Chat Flow Architecture

**Location**: `apps/site/src/pages/api/persona_chat.ts`

#### 5.1 Complete Request Flow

```
User Input
    ↓
Cognitive Mode Check
    ↓
Authentication Check
    ↓
─────┬─────
     │
     ├─ (Authenticated + Dual/Agent Mode) → OPERATOR PATH
     │       ↓
     │   Build Context Package
     │       ↓
     │   Retrieve Memories (semantic search)
     │       ↓
     │   Build Conversation History
     │       ↓
     │   Call /api/operator/react
     │       ↓
     │   ReAct Loop:
     │       • Plan next step
     │       • Execute skill
     │       • Observe result
     │       • Check completion
     │       ↓
     │   Synthesize final response
     │       ↓
     │   Stream to user
     │
     └─ (Anonymous OR Emulation Mode) → CHAT PATH
             ↓
         Build Context Package
             ↓
         Retrieve Memories (read-only)
             ↓
         Build Chat History
             ↓
         Call LLM (persona role)
             ↓
         Optional: Strip chain-of-thought
             ↓
         Stream to user
```

---

## Implementation Phases

### Phase 1: Foundation & Setup (2-4 hours)

#### Goals
- Install LiteGraph.js
- Create basic Svelte component wrapper
- Add UI toggle switch
- Integrate into existing layout

#### Tasks
- [x] 1.1: Install LiteGraph.js dependencies
- [ ] 1.2: Create NodeEditor.svelte component wrapper
- [ ] 1.3: Add toggle switch to header next to cognitive mode dropdown
- [ ] 1.4: Create 'node-editor' view in CenterContent.svelte
- [ ] 1.5: Test basic LiteGraph canvas rendering

#### Deliverables
- Working node editor canvas
- Toggle switch in header
- Basic empty graph display

---

### Phase 2: Node Schema Design (3-5 hours)

#### Goals
- Define all node types matching cognitive architecture
- Implement base node classes
- Register node types with LiteGraph

#### Tasks
- [ ] 2.1: Define node type schemas and categories
- [ ] 2.2: Implement core node classes (Input, Router, Context, Operator, Chat, Output)
- [ ] 2.3: Register all 25 skill nodes

#### Deliverables
- Node type definitions
- Node registry
- Visual node catalog

---

### Phase 3: Graph Templates (2-3 hours)

#### Goals
- Create pre-built graphs for each cognitive mode
- Define JSON template format
- Implement template loading

#### Tasks
- [ ] 3.1: Create Dual Mode template graph
- [ ] 3.2: Create Agent Mode template graph
- [ ] 3.3: Create Emulation Mode template graph

#### Deliverables
- 3 cognitive mode templates
- Template storage in `etc/cognitive-graphs/`

---

### Phase 4: Serialization & Loading (3-4 hours)

#### Goals
- Save/load custom graphs
- Auto-generate graph from current mode
- Validate graph structure

#### Tasks
- [ ] 4.1: Define JSON schema for graph serialization
- [ ] 4.2: Implement graph loader from cognitive mode
- [ ] 4.3: Implement save/export functionality
- [ ] 4.4: Create API endpoints (GET/POST /api/cognitive-graph)

#### Deliverables
- Graph save/load system
- API endpoints
- Validation logic

---

### Phase 5: Execution Engine (5-7 hours)

#### Goals
- Execute graphs in real-time
- Visualize execution flow
- Enable debugging features

#### Tasks
- [ ] 5.1: Build graph execution engine
- [ ] 5.2: Implement real-time node highlighting during execution
- [ ] 5.3: Add data flow visualization

#### Deliverables
- Graph interpreter
- Real-time execution visualization
- Debugging tools

---

### Phase 6: UI/UX Polish (2-3 hours)

#### Goals
- Improve usability
- Add navigation features
- Support dark mode

#### Tasks
- [ ] 6.1: Add UI polish (mini-map, search, tooltips)
- [ ] 6.2: Implement dark mode support

#### Deliverables
- Polished user interface
- Dark mode support
- Enhanced navigation

---

## Node Type Specifications

### Input Nodes

#### 1. UserInput
**Category**: Input
**Description**: Raw user message input
**Inputs**: None
**Outputs**:
- `text` (string) - User message text
- `timestamp` (string) - Message timestamp
- `sessionId` (string) - Session identifier

#### 2. SessionContext
**Category**: Input
**Description**: Session state and conversation history
**Inputs**:
- `sessionId` (string) - Session ID
**Outputs**:
- `conversationHistory` (array) - Previous messages
- `sessionId` (string) - Session identifier
- `userId` (string) - User identifier

#### 3. SystemSettings
**Category**: Input
**Description**: System configuration
**Inputs**: None
**Outputs**:
- `cognitiveMode` (string) - Current mode (dual/agent/emulation)
- `trustLevel` (string) - Trust level
- `chatSettings` (object) - Chat configuration

---

### Decision/Router Nodes

#### 4. CognitiveModeRouter
**Category**: Router
**Description**: Routes based on cognitive mode
**Inputs**:
- `mode` (string) - Cognitive mode
- `request` (object) - Request data
**Outputs**:
- `operatorPath` (object) - Data for operator pipeline
- `chatPath` (object) - Data for chat pipeline

#### 5. AuthenticationCheck
**Category**: Router
**Description**: Validates user authentication
**Inputs**:
- `sessionId` (string) - Session ID
**Outputs**:
- `authenticated` (boolean) - Auth status
- `user` (object) - User data
- `role` (string) - User role

#### 6. OperatorEligibility
**Category**: Router
**Description**: Determines if operator should be used
**Inputs**:
- `cognitiveMode` (string) - Mode
- `authenticated` (boolean) - Auth status
- `message` (string) - User message
**Outputs**:
- `useOperator` (boolean) - Use operator pipeline
- `reason` (string) - Decision reason

---

### Context Nodes

#### 7. ContextBuilder
**Category**: Context
**Description**: Builds context package from multiple sources
**Inputs**:
- `userMessage` (string) - User input
- `cognitiveMode` (string) - Mode
- `sessionId` (string) - Session ID
**Outputs**:
- `contextPackage` (object) - Complete context
- `memories` (array) - Retrieved memories
- `tasks` (array) - Active tasks
- `personaCache` (object) - Persona data

#### 8. SemanticSearch
**Category**: Context
**Description**: Searches memories by semantic similarity
**Inputs**:
- `query` (string) - Search query
- `threshold` (number) - Similarity threshold (0-1)
- `maxResults` (number) - Max results
- `filters` (object) - Metadata filters
**Outputs**:
- `results` (array) - Relevant memories
- `scores` (array) - Similarity scores

#### 9. ConversationHistory
**Category**: Context
**Description**: Manages conversation history
**Inputs**:
- `sessionId` (string) - Session ID
- `mode` (string) - inner/conversation
- `maxMessages` (number) - Max history length
**Outputs**:
- `history` (array) - Pruned conversation history

---

### Operator Nodes

#### 10. ReActPlanner
**Category**: Operator
**Description**: Plans next step in ReAct loop
**Inputs**:
- `goal` (string) - User request
- `context` (object) - Context package
- `scratchpad` (array) - Previous steps
**Outputs**:
- `thought` (string) - Reasoning
- `action` (object) - Next action
- `complete` (boolean) - Is task done

#### 11. SkillExecutor
**Category**: Operator
**Description**: Executes a skill/tool
**Inputs**:
- `skillName` (string) - Skill identifier
- `args` (object) - Skill arguments
- `trustLevel` (string) - User trust level
**Outputs**:
- `result` (any) - Skill output
- `success` (boolean) - Success status
- `error` (object) - Error details (if failed)

#### 12. ObservationFormatter
**Category**: Operator
**Description**: Formats skill results for LLM
**Inputs**:
- `result` (any) - Raw skill output
- `mode` (string) - narrative/structured/verbatim
**Outputs**:
- `observation` (string) - Formatted observation

#### 13. CompletionChecker
**Category**: Operator
**Description**: Determines if task is complete
**Inputs**:
- `goal` (string) - Original goal
- `scratchpad` (array) - All steps taken
**Outputs**:
- `complete` (boolean) - Is complete
- `reason` (string) - Explanation

#### 14. ResponseSynthesizer
**Category**: Operator
**Description**: Generates final response from scratchpad
**Inputs**:
- `goal` (string) - User request
- `scratchpad` (array) - All steps
- `report` (object) - Operator report
**Outputs**:
- `response` (string) - Final response text

---

### Chat Nodes

#### 15. PersonaLLM
**Category**: Chat
**Description**: Calls persona model for chat response
**Inputs**:
- `messages` (array) - Chat history
- `context` (object) - Context package
- `temperature` (number) - Sampling temperature
**Outputs**:
- `response` (string) - Raw LLM response

#### 16. ChainOfThoughtStripper
**Category**: Chat
**Description**: Removes <think> blocks from response
**Inputs**:
- `response` (string) - Raw response
**Outputs**:
- `cleanResponse` (string) - Response without COT

#### 17. SafetyValidator
**Category**: Chat
**Description**: Validates response safety
**Inputs**:
- `response` (string) - Response to check
- `threshold` (number) - Safety threshold
**Outputs**:
- `safe` (boolean) - Is safe
- `issues` (array) - Safety issues found

#### 18. ResponseRefiner
**Category**: Chat
**Description**: Refines response to fix safety issues
**Inputs**:
- `response` (string) - Original response
- `safetyResult` (object) - Safety validation result
**Outputs**:
- `refined` (string) - Refined response

---

### Model Nodes

#### 19. ModelResolver
**Category**: Model
**Description**: Resolves model for a given role
**Inputs**:
- `role` (string) - Model role
- `cognitiveMode` (string) - Cognitive mode
**Outputs**:
- `modelConfig` (object) - Model configuration

#### 20. ModelRouter (8 variants)
**Category**: Model
**Description**: Calls LLM with specific role
**Variants**:
- OrchestratorModel
- PersonaModel
- CuratorModel
- CoderModel
- PlannerModel
- SummarizerModel
- PsychotherapistModel
- FallbackModel

**Inputs**:
- `messages` (array) - Messages to send
- `options` (object) - LLM options
**Outputs**:
- `response` (string/object) - LLM response

---

### Skill Nodes (25 total)

Each skill has its own node type. Examples:

#### 21. fs_read
**Category**: Skill (Filesystem)
**Inputs**:
- `path` (string) - File path
**Outputs**:
- `content` (string) - File contents
- `success` (boolean) - Success status

#### 22. task_list
**Category**: Skill (Tasks)
**Inputs**:
- `status` (string) - Filter by status (optional)
**Outputs**:
- `tasks` (array) - Task list
- `count` (number) - Task count

#### 23. search_index
**Category**: Skill (Search)
**Inputs**:
- `query` (string) - Search query
- `maxResults` (number) - Max results
**Outputs**:
- `results` (array) - Search results
- `count` (number) - Result count

*(Full skill node list continues for all 25 skills...)*

---

### Output Nodes

#### 24. MemoryCapture
**Category**: Output
**Description**: Saves conversation to memory
**Inputs**:
- `userMessage` (string) - User input
- `response` (string) - System response
- `cognitiveMode` (string) - Mode tag
**Outputs**:
- `eventId` (string) - Memory event ID
- `filePath` (string) - Saved file path

#### 25. AuditLogger
**Category**: Output
**Description**: Logs to audit trail
**Inputs**:
- `eventType` (string) - Event type
- `details` (object) - Event details
- `actor` (string) - Actor identifier
**Outputs**:
- `auditId` (string) - Audit entry ID

#### 26. StreamWriter
**Category**: Output
**Description**: Streams response to client
**Inputs**:
- `response` (string) - Final response
- `sessionId` (string) - Session ID
**Outputs**:
- `streamed` (boolean) - Stream complete

---

## Graph Templates

### Template 1: Dual Consciousness Mode

```json
{
  "name": "Dual Consciousness Mode",
  "version": "1.0",
  "mode": "dual",
  "description": "Full operator pipeline with memory grounding",
  "nodes": [
    {
      "id": 1,
      "type": "UserInput",
      "pos": [100, 200]
    },
    {
      "id": 2,
      "type": "SessionContext",
      "pos": [100, 300]
    },
    {
      "id": 3,
      "type": "AuthenticationCheck",
      "pos": [300, 250]
    },
    {
      "id": 4,
      "type": "ContextBuilder",
      "pos": [500, 200]
    },
    {
      "id": 5,
      "type": "SemanticSearch",
      "pos": [500, 350]
    },
    {
      "id": 6,
      "type": "ReActPlanner",
      "pos": [750, 200]
    },
    {
      "id": 7,
      "type": "SkillExecutor",
      "pos": [950, 200]
    },
    {
      "id": 8,
      "type": "ObservationFormatter",
      "pos": [950, 350]
    },
    {
      "id": 9,
      "type": "CompletionChecker",
      "pos": [1150, 200]
    },
    {
      "id": 10,
      "type": "ResponseSynthesizer",
      "pos": [1350, 200]
    },
    {
      "id": 11,
      "type": "MemoryCapture",
      "pos": [1550, 200]
    },
    {
      "id": 12,
      "type": "StreamWriter",
      "pos": [1550, 350]
    }
  ],
  "links": [
    { "from": [1, 0], "to": [4, 0] },
    { "from": [2, 0], "to": [3, 0] },
    { "from": [3, 1], "to": [4, 1] },
    { "from": [4, 0], "to": [6, 1] },
    { "from": [1, 0], "to": [5, 0] },
    { "from": [5, 0], "to": [4, 2] },
    { "from": [6, 1], "to": [7, 0] },
    { "from": [7, 0], "to": [8, 0] },
    { "from": [8, 0], "to": [6, 2] },
    { "from": [6, 2], "to": [9, 0] },
    { "from": [9, 0], "to": [10, 0] },
    { "from": [10, 0], "to": [11, 0] },
    { "from": [10, 0], "to": [12, 0] }
  ]
}
```

### Template 2: Agent Mode

```json
{
  "name": "Agent Mode",
  "version": "1.0",
  "mode": "agent",
  "description": "Conditional routing with heuristic detection",
  "nodes": [
    {
      "id": 1,
      "type": "UserInput",
      "pos": [100, 200]
    },
    {
      "id": 2,
      "type": "OperatorEligibility",
      "pos": [300, 200]
    },
    {
      "id": 3,
      "type": "ContextBuilder",
      "pos": [500, 150]
    },
    {
      "id": 4,
      "type": "ReActPlanner",
      "pos": [750, 150],
      "conditional": true
    },
    {
      "id": 5,
      "type": "PersonaLLM",
      "pos": [750, 250],
      "conditional": true
    },
    {
      "id": 6,
      "type": "ResponseSynthesizer",
      "pos": [1000, 200]
    },
    {
      "id": 7,
      "type": "StreamWriter",
      "pos": [1200, 200]
    }
  ],
  "links": [
    { "from": [1, 0], "to": [2, 0] },
    { "from": [2, 0], "to": [3, 0] },
    { "from": [3, 0], "to": [4, 0], "condition": "useOperator" },
    { "from": [3, 0], "to": [5, 0], "condition": "!useOperator" },
    { "from": [4, 0], "to": [6, 0] },
    { "from": [5, 0], "to": [6, 1] },
    { "from": [6, 0], "to": [7, 0] }
  ]
}
```

### Template 3: Emulation Mode

```json
{
  "name": "Emulation Mode",
  "version": "1.0",
  "mode": "emulation",
  "description": "Simple chat path only, no operator",
  "nodes": [
    {
      "id": 1,
      "type": "UserInput",
      "pos": [100, 200]
    },
    {
      "id": 2,
      "type": "SessionContext",
      "pos": [100, 300]
    },
    {
      "id": 3,
      "type": "ContextBuilder",
      "pos": [400, 250]
    },
    {
      "id": 4,
      "type": "PersonaLLM",
      "pos": [700, 250]
    },
    {
      "id": 5,
      "type": "ChainOfThoughtStripper",
      "pos": [950, 250]
    },
    {
      "id": 6,
      "type": "StreamWriter",
      "pos": [1200, 250]
    }
  ],
  "links": [
    { "from": [1, 0], "to": [3, 0] },
    { "from": [2, 0], "to": [3, 1] },
    { "from": [3, 0], "to": [4, 0] },
    { "from": [4, 0], "to": [5, 0] },
    { "from": [5, 0], "to": [6, 0] }
  ]
}
```

---

## Technical Architecture

### Component Structure

```
apps/site/src/
├── components/
│   ├── NodeEditor.svelte          # Main node editor wrapper
│   ├── NodeEditorCanvas.svelte    # LiteGraph canvas
│   ├── NodePalette.svelte         # Node selection palette
│   ├── GraphControls.svelte       # Save/load/export controls
│   └── ExecutionMonitor.svelte    # Real-time execution view
│
├── lib/
│   └── node-editor/
│       ├── nodes/
│       │   ├── base.ts            # Base node class
│       │   ├── input.ts           # Input nodes
│       │   ├── router.ts          # Router nodes
│       │   ├── context.ts         # Context nodes
│       │   ├── operator.ts        # Operator nodes
│       │   ├── chat.ts            # Chat nodes
│       │   ├── model.ts           # Model nodes
│       │   ├── skill.ts           # Skill nodes (25)
│       │   └── output.ts          # Output nodes
│       │
│       ├── execution/
│       │   ├── interpreter.ts     # Graph interpreter
│       │   ├── executor.ts        # Node executor
│       │   └── visualizer.ts      # Execution visualizer
│       │
│       ├── templates/
│       │   ├── loader.ts          # Template loader
│       │   └── generator.ts       # Graph generator
│       │
│       └── utils/
│           ├── serializer.ts      # JSON serialization
│           ├── validator.ts       # Graph validation
│           └── colors.ts          # Node color schemes
│
└── pages/
    └── api/
        ├── cognitive-graph.ts     # GET/POST graph API
        └── execute-graph.ts       # Graph execution API
```

### Node Base Class

```typescript
// apps/site/src/lib/node-editor/nodes/base.ts

import { LGraphNode } from 'litegraph.js';

export interface NodeConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  color: string;
  bgcolor: string;
  inputs: NodeInput[];
  outputs: NodeOutput[];
  properties?: Record<string, any>;
}

export interface NodeInput {
  name: string;
  type: string;
  optional?: boolean;
  defaultValue?: any;
}

export interface NodeOutput {
  name: string;
  type: string;
}

export abstract class MetaHumanNode extends LGraphNode {
  static category: string;
  static description: string;

  constructor(config: NodeConfig) {
    super();
    this.title = config.name;
    this.color = config.color;
    this.bgcolor = config.bgcolor;

    // Add inputs
    for (const input of config.inputs) {
      this.addInput(input.name, input.type);
    }

    // Add outputs
    for (const output of config.outputs) {
      this.addOutput(output.name, output.type);
    }

    // Set properties
    if (config.properties) {
      this.properties = config.properties;
    }
  }

  abstract onExecute(): void;

  getInputData(index: number): any {
    return this.getInputData(index);
  }

  setOutputData(index: number, data: any): void {
    this.setOutputData(index, data);
  }
}
```

### Color Schemes

```typescript
// apps/site/src/lib/node-editor/utils/colors.ts

export const NODE_COLORS = {
  input: {
    color: '#4A90E2',      // Blue
    bgcolor: '#2C5282'
  },
  router: {
    color: '#F5A623',      // Orange
    bgcolor: '#C77700'
  },
  context: {
    color: '#7B61FF',      // Purple
    bgcolor: '#5B41DB'
  },
  operator: {
    color: '#50E3C2',      // Teal
    bgcolor: '#2EBAAA'
  },
  chat: {
    color: '#B8E986',      // Green
    bgcolor: '#8BC34A'
  },
  model: {
    color: '#F8E71C',      // Yellow
    bgcolor: '#D4C417'
  },
  skill: {
    color: '#E86C6C',      // Red
    bgcolor: '#C44545'
  },
  output: {
    color: '#9013FE',      // Dark Purple
    bgcolor: '#6610C2'
  }
};

export const MODE_COLORS = {
  dual: '#50E3C2',         // Teal
  agent: '#B8E986',        // Green
  emulation: '#9E9E9E'     // Gray
};
```

---

## Integration Points

### 1. Header Toggle Switch

Modify `apps/site/src/components/ChatLayout.svelte`:

```svelte
<!-- Add after cognitive mode dropdown -->
<div class="interface-mode-toggle">
  <button
    class="toggle-btn"
    class:active={interfaceMode === 'chat'}
    on:click={() => setInterfaceMode('chat')}
  >
    💬 Chat
  </button>
  <button
    class="toggle-btn"
    class:active={interfaceMode === 'nodes'}
    on:click={() => setInterfaceMode('nodes')}
  >
    🔷 Nodes
  </button>
</div>

<style>
  .interface-mode-toggle {
    display: flex;
    gap: 4px;
    margin-left: 16px;
  }

  .toggle-btn {
    padding: 6px 12px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ccc;
    cursor: pointer;
    transition: all 0.2s;
  }

  .toggle-btn:hover {
    background: #3a3a3a;
  }

  .toggle-btn.active {
    background: #4A90E2;
    color: white;
    border-color: #4A90E2;
  }
</style>
```

### 2. CenterContent Router

Modify `apps/site/src/components/CenterContent.svelte`:

```svelte
<script lang="ts">
  import { activeView, interfaceMode } from '../stores/navigation';
  import ChatInterface from './ChatInterface.svelte';
  import NodeEditor from './NodeEditor.svelte';
  // ... other imports
</script>

{#if $interfaceMode === 'nodes'}
  <NodeEditor />
{:else if $activeView === 'chat'}
  <ChatInterface />
{:else if $activeView === 'dashboard'}
  <Dashboard />
<!-- ... other views -->
{/if}
```

### 3. Navigation Store

Update `apps/site/src/stores/navigation.ts`:

```typescript
import { writable } from 'svelte/store';

export const interfaceMode = writable<'chat' | 'nodes'>(
  (localStorage.getItem('interfaceMode') as 'chat' | 'nodes') || 'chat'
);

// Persist to localStorage
interfaceMode.subscribe(value => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('interfaceMode', value);
  }
});
```

---

## API Specifications

### GET /api/cognitive-graph

**Description**: Get graph for current cognitive mode or load saved graph

**Query Parameters**:
- `mode` (optional) - Cognitive mode (dual/agent/emulation)
- `name` (optional) - Saved graph name

**Response**:
```json
{
  "graph": {
    "name": "Dual Consciousness Mode",
    "version": "1.0",
    "mode": "dual",
    "nodes": [...],
    "links": [...]
  }
}
```

### POST /api/cognitive-graph

**Description**: Save custom graph

**Request Body**:
```json
{
  "name": "My Custom Graph",
  "graph": {
    "nodes": [...],
    "links": [...]
  }
}
```

**Response**:
```json
{
  "success": true,
  "path": "etc/cognitive-graphs/custom/my-custom-graph.json"
}
```

### POST /api/execute-graph

**Description**: Execute graph with user input

**Request Body**:
```json
{
  "graph": {
    "nodes": [...],
    "links": [...]
  },
  "input": {
    "userMessage": "What tasks are active?",
    "sessionId": "abc123"
  }
}
```

**Response**: SSE stream with execution events

---

## File Structure

```
metahuman/
├── docs/
│   └── NODE_EDITOR_IMPLEMENTATION_PLAN.md  # This file
│
├── etc/
│   └── cognitive-graphs/
│       ├── dual-mode.json                   # Dual mode template
│       ├── agent-mode.json                  # Agent mode template
│       ├── emulation-mode.json              # Emulation mode template
│       └── custom/                          # User-saved graphs
│           └── my-graph.json
│
└── apps/site/
    └── src/
        ├── components/
        │   ├── NodeEditor.svelte
        │   ├── NodeEditorCanvas.svelte
        │   ├── NodePalette.svelte
        │   ├── GraphControls.svelte
        │   └── ExecutionMonitor.svelte
        │
        ├── lib/
        │   └── node-editor/
        │       ├── nodes/
        │       ├── execution/
        │       ├── templates/
        │       └── utils/
        │
        └── pages/
            └── api/
                ├── cognitive-graph.ts
                └── execute-graph.ts
```

---

## Testing Strategy

### Unit Tests
- [ ] Node type definitions
- [ ] Graph serialization/deserialization
- [ ] Graph validation logic
- [ ] Node execution functions

### Integration Tests
- [ ] Load template graphs
- [ ] Save custom graphs
- [ ] Execute simple graph (emulation mode)
- [ ] Execute complex graph (dual mode)
- [ ] Real-time execution visualization

### Manual Tests
- [ ] Toggle between chat and node interface
- [ ] Create custom graph from scratch
- [ ] Modify existing template
- [ ] Execute graph with user input
- [ ] Verify output matches traditional flow
- [ ] Test dark mode support
- [ ] Test on mobile (responsive)

---

## Success Criteria

### MVP (Minimum Viable Product)
- [ ] Toggle between chat and node editor
- [ ] Load 3 cognitive mode templates
- [ ] Visual node graph display
- [ ] Basic node palette
- [ ] Save/load custom graphs

### V1.0 (Full Release)
- [ ] All 26+ node types implemented
- [ ] Real-time execution visualization
- [ ] Node highlighting during chat
- [ ] Data flow animation
- [ ] Graph validation
- [ ] Error handling
- [ ] Dark mode support
- [ ] Mobile responsive

### Future Enhancements
- [ ] Subgraphs/node groups
- [ ] Custom node creation UI
- [ ] Graph debugging tools
- [ ] Performance profiling
- [ ] Export to Python/TypeScript code
- [ ] Multi-graph comparison
- [ ] A/B testing different graphs

---

## Risks & Mitigations

### Risk 1: LiteGraph.js Learning Curve
**Mitigation**: Start with simple nodes, reference ComfyUI source code, create comprehensive examples

### Risk 2: Performance with Large Graphs
**Mitigation**: Implement graph optimization, lazy loading, virtual scrolling

### Risk 3: Graph Validation Complexity
**Mitigation**: Use JSON Schema, implement incremental validation, provide helpful error messages

### Risk 4: Execution Engine Complexity
**Mitigation**: Build incrementally, start with linear execution, add parallelism later

### Risk 5: UI/UX Confusion
**Mitigation**: User testing, tooltips, documentation, video tutorials

---

## Timeline Estimate

| Phase | Tasks | Hours | Weeks |
|-------|-------|-------|-------|
| Phase 1 | Foundation & Setup | 2-4 | 0.5 |
| Phase 2 | Node Schema Design | 3-5 | 0.75 |
| Phase 3 | Graph Templates | 2-3 | 0.5 |
| Phase 4 | Serialization & Loading | 3-4 | 0.75 |
| Phase 5 | Execution Engine | 5-7 | 1.25 |
| Phase 6 | UI/UX Polish | 2-3 | 0.5 |
| **Total** | **All Phases** | **17-26** | **4-6** |

*Assuming 4-6 hours of focused development per week*

---

## References

### Documentation
- [CLAUDE.md](../CLAUDE.md) - Project overview
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [DESIGN.md](../DESIGN.md) - Design philosophy
- [AUTHENTICATION_STREAMLINED.md](./AUTHENTICATION_STREAMLINED.md) - Auth system

### External Resources
- [LiteGraph.js Documentation](https://github.com/jagenjo/litegraph.js)
- [ComfyUI Source Code](https://github.com/comfyanonymous/ComfyUI)
- [Svelte Documentation](https://svelte.dev/docs)
- [Astro Documentation](https://docs.astro.build)

---

## Changelog

### Version 1.0 (2025-11-18)
- Initial implementation plan created
- Complete cognitive architecture research
- Node type specifications defined
- Graph templates designed
- API specifications documented
- Testing strategy outlined

---

## Contributors

- **greggles** - Project Lead, Architect
- **Claude Code** - Research, Documentation, Implementation

---

## License

This document is part of the MetaHuman OS project and is subject to the same license terms.

---

*Last Updated: 2025-11-18*
