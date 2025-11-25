# Core Concepts

Understanding the architecture and philosophy behind MetaHuman OS.

---

## The Three Pillars

### 1. Memory System
Every interaction is stored as **episodic memory** with structured metadata:
- **Type**: conversation, observation, task, dream, inner_dialogue
- **Timestamp**: Precise temporal ordering
- **Metadata**: Tags, entities, cognitive mode, processing status
- **Content**: The actual data (text, audio reference, etc.)

**Memory Types:**
- `conversation`: User-assistant dialogue
- `observation`: Manual captures (`mh capture`)
- `inner_dialogue`: Reflections (never shown in chat)
- `dream`: Surreal narratives from memory fragments
- `task`: Active and completed tasks

### 2. Autonomous Agents
40+ background processes that operate independently:
- **Organizer**: Enriches memories with LLM-extracted tags/entities
- **Reflector**: Generates internal thoughts via associative chains
- **Curator**: Prepares training data from conversations
- **Dreamer**: Creates surreal narratives during sleep hours
- **And 36 more...**

### 3. Progressive Trust Model
The system operates at configurable autonomy levels:
1. **Observe**: Monitor only, no actions
2. **Suggest**: Propose actions, require approval
3. **Supervised Auto**: Execute within approved categories
4. **Bounded Auto**: Full autonomy within defined boundaries
5. **Adaptive Auto**: Self-expand boundaries based on learning

---

## Cognitive Modes

### Dual Consciousness Mode (Default)
- **Operator Always Active**: Every message routes through planner → skills → narrator
- **Memory Grounding**: Semantic search with persona fallback
- **Proactive Agents**: Reflections, curiosity, dreaming enabled
- **Training**: Memories saved with `cognitiveMode: "dual"`

### Agent Mode
- **Heuristic Routing**: Simple queries → chat, action requests → operator
- **Proactive Agents**: Disabled for reduced overhead
- **Training**: Memories saved with `cognitiveMode: "agent"`

### Emulation Mode
- **Chat Only**: Never routes to operator
- **Stable Snapshot**: Frozen personality, no training or operator
- **Proactive Agents**: Disabled
- **Use Case**: Demonstrations, testing, simple chat

---

## LLM Architecture

### Model Roles
- **Orchestrator**: Intent detection and routing
- **Persona**: Primary conversation model (with LoRA adapters)
- **Curator**: Memory preparation and dataset building
- **Fallback**: General-purpose backup

### LoRA Adapters
Low-Rank Adaptation layers trained on your conversations:
- **Base Model**: Foundation LLM (e.g., Qwen2.5-Coder-30B)
- **Historical Adapter**: Merged lifetime training data
- **Recent Adapter**: Last 14 days of fresh conversations
- **Dual-Adapter System**: Both load simultaneously for balanced personality

---

## Data Storage

### Directory Structure
```
metahuman/
├── persona/           # Identity kernel
│   ├── core.json     # Personality traits
│   ├── relationships.json
│   └── routines.json
├── memory/
│   ├── episodic/     # Timeline (YYYY/YYYY-MM-DD-*.json)
│   ├── tasks/        # Active and completed tasks
│   └── inbox/        # Raw files awaiting ingestion
├── logs/
│   └── audit/        # Complete operation trail
└── etc/              # System configuration
```

### Human-Readable JSON
All data is stored as readable, editable JSON files. No proprietary formats or databases.

---

## Security & Privacy

### Local-First
- All data stored on your infrastructure
- No cloud dependencies (except optional LLM providers)
- Full control over memory retention

### Audit Trail
Every operation logged to `logs/audit/YYYY-MM-DD.ndjson`:
- Actor (who performed the action)
- Event type and details
- Timestamp and context
- Complete transparency

### Multi-User Isolation
- Per-user profile directories
- Separate memory, persona, and configuration
- Owner/guest role hierarchy

---

## Skills & Operator System

### ReAct Pattern
The operator uses Reason-Act-Observe loop:
1. **Reason**: Plan next step based on goal and context
2. **Act**: Execute a skill (search memory, create task, etc.)
3. **Observe**: Analyze result and adapt
4. **Repeat**: Until goal achieved or max iterations

### Skill Catalog
20+ built-in skills:
- `memory_search`: Find relevant episodic memories
- `task_create`: Create new tasks
- `web_search`: Search the internet (TODO)
- `code_execute`: Run code snippets
- And more...

---

## Training Pipeline

### Dataset Building
1. **Curator Agent**: Selects high-quality conversations
2. **Auto-Approver**: Quality-checks datasets
3. **Aggregator**: Combines approved data

### Training
1. **Adapter Builder**: Creates instruction-response pairs
2. **LoRA Trainer**: Trains on RunPod or local GPU
3. **Evaluator**: Heuristic quality scoring
4. **Activation**: System automatically uses new adapters

---

## Next Steps

Now that you understand the core concepts, explore:
- [Chat Interface](../using-metahuman/chat-interface.md) - Start conversing
- [Memory System](../using-metahuman/memory-system.md) - Manage your timeline
- [Autonomous Agents](../advanced-features/autonomous-agents.md) - Deep dive on agents
