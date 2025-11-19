# Cognitive Graph Templates

This directory contains pre-built graph templates for the MetaHuman OS node-based cognitive system editor.

## Built-in Templates

### 1. Dual Consciousness Mode (`dual-mode.json`)

**Description**: Full operator pipeline with ReAct reasoning loop, semantic memory grounding, and proactive agents.

**Flow**:
```
UserInput → SemanticSearch → ContextBuilder → ReActPlanner
                                                    ↓
                                             SkillExecutor
                                                    ↓
                                         ObservationFormatter
                                                    ↓
                                          CompletionChecker
                                                    ↓
                                        ResponseSynthesizer → MemoryCapture → StreamWriter
```

**Nodes**: 16 total
- **Input**: UserInput, SessionContext, SystemSettings
- **Router**: AuthCheck, OperatorEligibility
- **Context**: SemanticSearch, ConversationHistory, ContextBuilder
- **Operator**: ReActPlanner, SkillExecutor, ObservationFormatter, CompletionChecker, ResponseSynthesizer
- **Output**: MemoryCapture, AuditLogger, StreamWriter

**Use Case**: Primary operational mode with full cognitive capabilities, memory writes, and autonomous reasoning.

---

### 2. Agent Mode (`agent-mode.json`)

**Description**: Heuristic-based routing that detects whether a message is an action request (uses operator) or simple query (uses chat).

**Flow**:
```
UserInput → OperatorEligibility (Intent Detection)
                ↓                           ↓
         (Action Path)              (Chat Path)
                ↓                           ↓
    ContextBuilder → ReAct → Synthesizer   PersonaLLM
                ↓                           ↓
         MemoryCapture → StreamWriter
```

**Nodes**: 13 total
- **Input**: UserInput, SessionContext, SystemSettings
- **Router**: AuthCheck, OperatorEligibility
- **Context**: ContextBuilder, ConversationHistory
- **Operator** (conditional): ReActPlanner, SkillExecutor, ResponseSynthesizer
- **Chat** (conditional): PersonaLLM
- **Output**: MemoryCapture, StreamWriter

**Use Case**: Lightweight assistant mode that reduces cognitive load by only engaging the operator when needed.

---

### 3. Emulation Mode (`emulation-mode.json`)

**Description**: Simple chat-only pipeline with no operator or memory writes. Uses frozen persona snapshot.

**Flow**:
```
UserInput → ConversationHistory → PersonaLLM → StreamWriter
                ↓
        SemanticSearch (optional context)
```

**Nodes**: 7 total
- **Input**: UserInput, SessionContext, SystemSettings
- **Context**: ConversationHistory, SemanticSearch (optional)
- **Chat**: PersonaLLM
- **Output**: StreamWriter (no memory writes)

**Use Case**: Demonstration mode, testing, or simple chat without operator overhead. Read-only access for anonymous users.

---

## How to Use Templates

### Via Web UI

1. Click the blue **node graph icon** in the header
2. Click **"Load Template"** button
3. Select a template from the dropdown
4. The graph will be loaded into the editor

### Programmatically

```typescript
import { loadTemplateAsGraph } from '../lib/cognitive-nodes/template-loader';

const graphData = await loadTemplateAsGraph('dual-mode');
graph.configure(graphData);
```

---

## Creating Custom Templates

Custom graphs are stored in `etc/cognitive-graphs/custom/`.

### Template Structure

```json
{
  "version": "1.0",
  "name": "My Custom Graph",
  "description": "Description of what this graph does",
  "cognitiveMode": "dual",  // optional: dual | agent | emulation
  "last_modified": "2025-11-18",
  "nodes": [
    {
      "id": 1,
      "type": "cognitive/user_input",
      "pos": [50, 100],
      "size": [180, 60],
      "properties": {},
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
  ],
  "groups": []  // optional visual grouping
}
```

### Exporting from Node Editor

1. Build your graph in the node editor
2. Click **"Save"** button
3. Enter a name
4. Graph will be saved to `etc/cognitive-graphs/custom/<name>.json`

---

## Node Reference

See [docs/NODE_EDITOR_IMPLEMENTATION.md](../../docs/NODE_EDITOR_IMPLEMENTATION.md) for complete node documentation.

**Available node categories**:
- Input (3 nodes) - User input, session context, system settings
- Router (3 nodes) - Cognitive mode routing, auth checks, operator eligibility
- Context (3 nodes) - Context building, semantic search, conversation history
- Operator (5 nodes) - ReAct planner, skill executor, observation formatter, completion checker, response synthesizer
- Chat (4 nodes) - Persona LLM, chain-of-thought stripper, safety validator, response refiner
- Model (2 nodes) - Model resolver, model router
- Skill (9+ nodes) - Executable skills (fs_read, task_list, search_index, etc.)
- Output (3 nodes) - Memory capture, audit logger, stream writer

---

## Version History

**v1.0** (2025-11-18)
- Initial release with three built-in templates
- Support for dual, agent, and emulation modes
- Full operator pipeline with ReAct loop
- Conditional routing in agent mode
- Read-only chat mode in emulation

---

## Future Enhancements

- **Auto-loading**: Load template automatically when cognitive mode changes
- **Diff viewer**: Compare templates side-by-side
- **Validation**: Check for disconnected nodes, infinite loops, missing required connections
- **Subgraphs**: Reusable graph components
- **Marketplace**: Community-contributed templates
