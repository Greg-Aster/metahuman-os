# Cognitive System Node Editor - Implementation Plan

**Status**: Phases 1-2 Complete ✅
**Last Updated**: 2025-11-18

---

## Overview

This document tracks the implementation of a visual node-based editor for the MetaHuman OS cognitive system. The editor allows users to visualize, configure, and customize the cognitive pipeline using a ComfyUI-style interface powered by LiteGraph.js.

### Goals

1. **Visualize** the complete cognitive pipeline (from user input to response output)
2. **Configure** how different cognitive modes (dual/agent/emulation) process requests
3. **Customize** the reasoning flow by modifying node connections and parameters
4. **Save/Load** custom cognitive graphs as JSON configurations
5. **Execute** graphs in real-time with visual feedback during chat

---

## Architecture

### Technology Stack

- **Frontend**: Svelte components
- **Node Engine**: LiteGraph.js (v0.7.18)
- **Styling**: Tailwind CSS + custom styles
- **Backend**: Astro API routes (for graph persistence)

### Key Components

```
apps/site/src/
├── components/
│   ├── NodeEditor.svelte           # LiteGraph canvas wrapper
│   └── NodeEditorLayout.svelte     # Full-screen UI with controls
├── lib/
│   └── cognitive-nodes/
│       ├── node-schemas.ts         # Node type definitions (39 nodes)
│       └── node-registry.ts        # LiteGraph implementations
└── stores/
    └── navigation.ts               # nodeEditorMode toggle store
```

---

## Phase 1: Foundation ✅ COMPLETE

### Deliverables

1. ✅ **LiteGraph.js Integration**
   - Installed `litegraph.js@0.7.18`
   - CSS imported in NodeEditorLayout

2. ✅ **UI Components**
   - [NodeEditor.svelte](../apps/site/src/components/NodeEditor.svelte) - Canvas wrapper
   - [NodeEditorLayout.svelte](../apps/site/src/components/NodeEditorLayout.svelte) - Full-screen interface
   - Toggle button in header (blue node icon)

3. ✅ **Navigation Store**
   - `nodeEditorMode` writable store
   - Conditional rendering in ChatLayout

4. ✅ **Basic Rendering**
   - Empty canvas displays correctly
   - No compilation errors
   - Dev server running at http://localhost:4322

### Files Created/Modified

- [apps/site/package.json](../apps/site/package.json) - Added litegraph.js dependency
- [apps/site/src/stores/navigation.ts](../apps/site/src/stores/navigation.ts) - Added nodeEditorMode store
- [apps/site/src/components/NodeEditor.svelte](../apps/site/src/components/NodeEditor.svelte) - New component
- [apps/site/src/components/NodeEditorLayout.svelte](../apps/site/src/components/NodeEditorLayout.svelte) - New component
- [apps/site/src/components/ChatLayout.svelte](../apps/site/src/components/ChatLayout.svelte) - Added toggle + conditional rendering

---

## Phase 2: Node System ✅ COMPLETE

### Deliverables

1. ✅ **Node Type Schemas** ([node-schemas.ts](../apps/site/src/lib/cognitive-nodes/node-schemas.ts))
   - 39 node types across 8 categories
   - Full input/output definitions
   - Color-coded by category

2. ✅ **Node Implementations** ([node-registry.ts](../apps/site/src/lib/cognitive-nodes/node-registry.ts))
   - Base `CognitiveNode` class
   - 23+ implemented node types
   - Registration function

3. ✅ **Default Demo Graph**
   - Simple pipeline: UserInput → ModeRouter → ConversationalResponse → StreamWriter
   - Shows basic connectivity

### Node Categories

| Category | Color | Count | Examples |
|----------|-------|-------|----------|
| **Input** | 🟢 Green | 3 | UserInput, SessionContext, SystemSettings |
| **Router** | 🟡 Amber | 3 | CognitiveModeRouter, AuthCheck, OperatorEligibility |
| **Context** | 🔵 Blue | 3 | ContextBuilder, SemanticSearch, ConversationHistory |
| **Operator** | 🟣 Purple | 5 | ReActPlanner, SkillExecutor, CompletionChecker |
| **Chat** | 🩷 Pink | 4 | PersonaLLM, ChainOfThoughtStripper, SafetyValidator |
| **Model** | 🟠 Orange | 2 | ModelResolver, ModelRouter |
| **Skill** | 🟩 Emerald | 9+ | fs_read, task_list, search_index, conversational_response |
| **Output** | 🔴 Red | 3 | MemoryCapture, AuditLogger, StreamWriter |

### Complete Node List (39 nodes)

#### Input Nodes (3)
- `UserInput` - Entry point for user messages
- `SessionContext` - Loads conversation history and user object
- `SystemSettings` - Provides cognitive mode and trust level

#### Router Nodes (3)
- `CognitiveModeRouter` - Routes based on mode (dual/agent/emulation)
- `AuthCheck` - Checks user authentication status
- `OperatorEligibility` - Determines if operator should be used

#### Context Nodes (3)
- `ContextBuilder` - Builds complete context package with memories
- `SemanticSearch` - Searches memories using embeddings
- `ConversationHistory` - Loads recent chat history

#### Operator Nodes (5)
- `ReActPlanner` - Plans next action in ReAct loop
- `SkillExecutor` - Executes a skill with arguments
- `ObservationFormatter` - Formats skill results (narrative/structured/verbatim)
- `CompletionChecker` - Checks if goal is achieved
- `ResponseSynthesizer` - Synthesizes final response from scratchpad

#### Chat Nodes (4)
- `PersonaLLM` - Generates response using persona model
- `ChainOfThoughtStripper` - Removes `<think>` blocks
- `SafetyValidator` - Validates response safety
- `ResponseRefiner` - Refines response to address safety issues

#### Model Nodes (2)
- `ModelResolver` - Resolves model based on role and mode
- `ModelRouter` - Routes LLM call based on role

#### Skill Nodes (9 implemented + 16 more planned)
- `fs_read` - Read file contents
- `fs_write` - Write file contents
- `fs_list` - List directory contents
- `task_create` - Create new task
- `task_list` - List active tasks
- `task_update` - Update task status
- `search_index` - Semantic memory search
- `web_search` - Web search via API
- `conversational_response` - Generate conversational response (terminal skill)

#### Output Nodes (3)
- `MemoryCapture` - Saves conversation to episodic memory
- `AuditLogger` - Logs to audit trail
- `StreamWriter` - Streams response to client (terminal node)

### How to Use (Current State)

1. **Launch Node Editor**:
   - Open http://localhost:4322
   - Click the blue "node graph" icon in the header

2. **Add Nodes**:
   - Right-click on canvas → Search for nodes
   - All nodes are under the `cognitive/` namespace
   - Example: `cognitive/user_input`

3. **Connect Nodes**:
   - Drag from output slot (right side) to input slot (left side)
   - Color-coded by data type

4. **Execute Graph** (mock execution):
   - Nodes display their execution in the console
   - No actual API calls yet (Phase 5 feature)

---

## Phase 3: Template Graphs 🔄 NEXT

Create pre-built graphs for each cognitive mode that users can load as starting points.

### 3.1 Dual Mode Template

**Flow**: UserInput → ContextBuilder → ReActPlanner → [Loop: SkillExecutor → ObservationFormatter → CompletionChecker] → ResponseSynthesizer → MemoryCapture → StreamWriter

**Nodes**:
1. UserInput
2. SessionContext
3. SystemSettings
4. ContextBuilder (with semantic search)
5. ReActPlanner
6. SkillExecutor
7. ObservationFormatter
8. CompletionChecker
9. ResponseSynthesizer
10. MemoryCapture
11. StreamWriter

**File**: `etc/cognitive-graphs/dual-mode.json`

### 3.2 Agent Mode Template

**Flow**: Conditional routing based on message intent

**Nodes**:
1. UserInput
2. SystemSettings
3. OperatorEligibility (detects action vs chat)
4. Branch A (action): → Operator pipeline (same as dual)
5. Branch B (chat): → PersonaLLM → StreamWriter

**File**: `etc/cognitive-graphs/agent-mode.json`

### 3.3 Emulation Mode Template

**Flow**: UserInput → PersonaLLM → ChainOfThoughtStripper → StreamWriter (no memory writes, read-only)

**Nodes**:
1. UserInput
2. SessionContext (read-only)
3. PersonaLLM
4. ChainOfThoughtStripper
5. StreamWriter

**File**: `etc/cognitive-graphs/emulation-mode.json`

---

## Phase 4: Persistence & Loading 📝 PENDING

Enable saving/loading custom graphs and auto-loading based on cognitive mode.

### 4.1 JSON Schema

```typescript
interface CognitiveGraph {
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  graph: {
    nodes: Array<{
      id: number;
      type: string;
      pos: [number, number];
      properties?: Record<string, any>;
    }>;
    links: Array<{
      source_id: number;
      source_slot: number;
      target_id: number;
      target_slot: number;
    }>;
  };
}
```

### 4.2 Graph Loader

- **Auto-load on mode change**: When user switches cognitive mode, load corresponding template
- **Manual load**: Dropdown in NodeEditorLayout showing available graphs
- **Merge with current**: Option to load template but keep custom modifications

### 4.3 Save/Export

- **Save to file**: `etc/cognitive-graphs/custom/<name>.json`
- **Export as JSON**: Download button
- **Version control**: Track graph changes in git

### 4.4 API Endpoints

- `GET /api/cognitive-graphs` - List all saved graphs
- `GET /api/cognitive-graph?name=<name>` - Load specific graph
- `POST /api/cognitive-graph` - Save graph
- `DELETE /api/cognitive-graph?name=<name>` - Delete graph

**Files to Create**:
- `apps/site/src/pages/api/cognitive-graphs.ts`
- `apps/site/src/pages/api/cognitive-graph.ts`

---

## Phase 5: Execution Engine ⚙️ PENDING

Make the node graphs actually execute and drive the cognitive pipeline.

### 5.1 Graph Execution

**Approach**: Two execution modes

1. **Design Mode** (current): Visual editing, mock execution
2. **Runtime Mode**: Execute graph when chat message is sent

**Implementation**:
```typescript
async function executeGraph(graph: LGraph, inputs: Record<string, any>) {
  // Topological sort to determine execution order
  const executionOrder = topologicalSort(graph);

  // Execute nodes in order
  for (const node of executionOrder) {
    await node.onExecute();
  }

  // Return output from terminal nodes
  return getTerminalOutputs(graph);
}
```

**Integration Point**: `apps/site/src/pages/api/persona_chat.ts`
- Check if custom graph exists for current cognitive mode
- If yes, execute graph instead of hardcoded pipeline
- If no, use default behavior

### 5.2 Real-time Highlighting

**Visual Feedback During Execution**:
- Highlight currently executing node (pulsing border)
- Show data flowing through connections (animated lines)
- Display execution time per node
- Mark completed nodes (green checkmark)

**Implementation**:
```typescript
node.on('before_execute', () => {
  node.boxcolor = '#ff0'; // Yellow = executing
});

node.on('after_execute', () => {
  node.boxcolor = '#0f0'; // Green = complete
});
```

### 5.3 Data Flow Visualization

**Real-time Data Inspection**:
- Click on connection to see data flowing through it
- Hover over output slot to see current value
- Debug panel showing full scratchpad/context

**Features**:
- JSON viewer for complex objects
- Truncate long strings (show first 100 chars)
- Color-code by data type

---

## Phase 6: UI Polish & Features 🎨 PENDING

### 6.1 Node Palette

**Left Sidebar Panel**:
- Categorized list of all available nodes
- Search/filter by name or category
- Drag-and-drop to add nodes
- Recently used nodes at top

### 6.2 Mini-map

**Overview Navigator**:
- Small thumbnail of entire graph (top-right corner)
- Current viewport highlighted
- Click to navigate to specific area
- Especially useful for large graphs

### 6.3 Search/Filter

**Search Bar** (Ctrl+F):
- Find nodes by name
- Find nodes by property value
- Highlight matching nodes
- Jump to first match

### 6.4 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save graph |
| Ctrl+N | New graph |
| Ctrl+O | Open graph |
| Ctrl+F | Search nodes |
| Del | Delete selected nodes |
| Ctrl+C/V | Copy/paste nodes |
| Ctrl+Z/Y | Undo/redo |
| Space+Drag | Pan canvas |
| Scroll | Zoom |

### 6.5 Tooltips & Help

- Hover over node for description
- Hover over input/output for type info
- Help panel explaining node purpose
- Link to documentation

### 6.6 Dark Mode Support

- Already implemented in base styles
- LiteGraph CSS overrides for dark theme
- Ensure all colors are accessible

---

## Implementation Timeline

### Completed (2025-11-18)
- ✅ Phase 1: Foundation (5 tasks)
- ✅ Phase 2: Node System (3 tasks)

### Remaining Work
- 🔄 Phase 3: Template Graphs (3 tasks) - **NEXT**
- 📝 Phase 4: Persistence (4 tasks)
- ⚙️ Phase 5: Execution Engine (3 tasks)
- 🎨 Phase 6: UI Polish (6 tasks)

**Total**: 8/24 tasks complete (33%)

---

## Testing Strategy

### Manual Testing
1. Click toggle button → Node editor loads
2. Right-click canvas → Context menu appears
3. Add nodes → Nodes render with correct colors
4. Connect nodes → Connections work
5. Drag nodes → Nodes move smoothly
6. Pan/zoom → Canvas navigation works

### Integration Testing (Phase 5)
1. Load dual mode template → Execute on chat message
2. Verify operator pipeline runs through graph
3. Check memory capture saves correctly
4. Validate audit logs match graph execution

### Performance Testing
- Graph with 100+ nodes renders smoothly (target: 60fps)
- Execution completes within 500ms for simple queries
- No memory leaks during long sessions

---

## Future Enhancements

### Phase 7: Advanced Features (Future)
- **Subgraphs**: Collapse node groups into reusable components
- **Conditional Execution**: If/else branching based on node outputs
- **Loops**: Iterate over arrays (e.g., process multiple memories)
- **Error Handling**: Try/catch blocks as nodes
- **Debugging**: Breakpoints, step-through execution
- **Versioning**: Track graph changes over time, diff viewer
- **Collaboration**: Share graphs with other users
- **Marketplace**: Community-contributed cognitive templates

### Phase 8: AI-Assisted Configuration
- **Auto-generate graphs**: Describe desired behavior in natural language → LLM generates graph
- **Graph optimization**: Suggest more efficient node arrangements
- **Anomaly detection**: Warn about disconnected nodes or infinite loops

---

## Known Limitations

1. **No real execution yet**: Nodes are mocked (Phase 5 will fix this)
2. **No persistence**: Graphs reset on page reload (Phase 4 will fix this)
3. **Limited skills**: Only 9/25 skills implemented as nodes (can add more as needed)
4. **No undo/redo**: LiteGraph supports it, but needs to be configured
5. **No validation**: Can create invalid graphs (e.g., circular dependencies)

---

## How to Extend

### Adding a New Node Type

1. **Define schema** in `node-schemas.ts`:
```typescript
export const MyNewNode: NodeSchema = {
  id: 'my_new_node',
  name: 'My New Node',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [{ name: 'input', type: 'string' }],
  outputs: [{ name: 'output', type: 'string' }],
  description: 'Does something cool',
};
```

2. **Implement node** in `node-registry.ts`:
```typescript
class MyNewNodeImpl extends CognitiveNode {
  static schema = nodeSchemas.find((s) => s.id === 'my_new_node')!;

  constructor() {
    super(MyNewNodeImpl.schema);
  }

  async onExecute() {
    const input = this.getInputData(0);
    const output = await doSomethingCool(input);
    this.setOutputData(0, output);
  }
}
```

3. **Register** in `registerCognitiveNodes()`:
```typescript
LiteGraph.registerNodeType('cognitive/my_new_node', MyNewNodeImpl);
```

4. **Test** by adding node to graph via right-click menu

---

## Resources

- **LiteGraph.js Docs**: https://github.com/jagenjo/litegraph.js
- **ComfyUI** (inspiration): https://github.com/comfyanonymous/ComfyUI
- **MetaHuman Cognitive Architecture**: [ARCHITECTURE.md](../ARCHITECTURE.md)
- **Model Routing System**: [CLAUDE.md](../CLAUDE.md#model-registry--router)

---

## Questions & Decisions

### Q: Should graphs be version-controlled?
**A**: Yes. Store in `etc/cognitive-graphs/` so they're tracked in git. This allows:
- Rollback to previous configurations
- Share graphs with teammates
- Track evolution of cognitive pipeline

### Q: Can users override the default pipeline without editing code?
**A**: Yes (Phase 5). When a custom graph exists for a cognitive mode, it will be used instead of the hardcoded pipeline in `persona_chat.ts`.

### Q: How do we prevent infinite loops?
**A**: LiteGraph has built-in cycle detection. We'll also add a max iterations limit (default: 10) in the execution engine.

### Q: Can nodes call external APIs?
**A**: Yes. Nodes can be async and make fetch requests. For example, the `WebSearch` node would call a search API.

---

## Contact & Support

- **Implementation Lead**: Claude Code
- **User**: greggles
- **Codebase**: `/home/greggles/metahuman`
- **Docs**: `/home/greggles/metahuman/docs`

For questions or issues, refer to [CLAUDE.md](../CLAUDE.md) or create a task via `./bin/mh task add`.
