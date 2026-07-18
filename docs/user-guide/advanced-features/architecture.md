# System Architecture

A deep dive into the architecture and philosophy behind MetaHuman OS for power users.

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
25+ background processes that operate independently:
- **Organizer**: Enriches memories with LLM-extracted tags/entities
- **Reflector**: Generates internal thoughts via associative chains
- **Curator**: Prepares training data from conversations
- **Dreamer**: Creates surreal narratives during sleep hours
- **Agency Generator**: Synthesizes desires from goals, tasks, and memories
- **Boredom Maintenance**: Triggers reflections during idle time
- **Sleep Service**: Manages dream generation during sleep hours
- **Inner Curiosity**: Self-directed Q&A saved as inner dialogue
- **And 17 more...**

See [Autonomous Agents](autonomous-agents.md) for complete list and details.

### 3. Progressive Trust Model
The system operates at configurable autonomy levels:
1. **Observe**: Monitor only, no actions
2. **Suggest**: Propose actions, require approval
3. **Supervised Auto**: Execute within approved categories
4. **Bounded Auto**: Full autonomy within defined boundaries
5. **Adaptive Auto**: Self-expand boundaries based on learning

---

## Cognitive Modes

Three operational modes control memory recording, operator behavior, and proactive agents.

**Memory Behavior by User Type:**
- **Authenticated users**: Save memories in ALL modes (tagged with `cognitiveMode` metadata)
- **Guest users**: Read-only access in ALL modes (no memory writes)

### Dual Consciousness Mode (Default)
- **Operator Always Active**: Every message routes through planner → skills → narrator
- **Memory Grounding**: Semantic search with persona fallback
- **Proactive Agents**: Reflections, curiosity, dreaming enabled
- **Training**: Memories saved with `cognitiveMode: "dual"` (for authenticated users)
- **Use Case**: Primary operational mode with full capabilities

### Agent Mode
- **Heuristic Routing**: Simple queries → chat, action requests → operator
- **Proactive Agents**: Disabled for reduced overhead
- **Training**: Memories saved with `cognitiveMode: "agent"` (for authenticated users)
- **Use Case**: Lightweight assistant with selective operator use

### Emulation Mode
- **Chat Only**: Never routes to operator
- **Stable Snapshot**: Frozen personality, no training or operator
- **Proactive Agents**: Disabled
- **Training**: Memories saved with `cognitiveMode: "emulation"` (for authenticated users)
- **Use Case**: Demonstrations, testing, simple chat (guest users are read-only)

See [Cognitive Modes](../training-personalization/cognitive-modes.md) for complete details.

---

## LLM Architecture

### Model Roles
- **Orchestrator**: Intent detection and routing
- **Persona**: Primary conversation model (with LoRA adapters)
- **Curator**: Memory preparation and dataset building
- **Fallback**: General-purpose backup

### LoRA Adapters
Low-Rank Adaptation layers trained on your conversations:
- **Base Model**: Foundation LLM (maintained default: Qwen3.5-9B)
- **Historical Adapter**: Merged lifetime training data
- **Recent Adapter**: Last 14 days of fresh conversations
- **Dual-Adapter System**: Both load simultaneously for balanced personality

### Model Registry & Router
Configuration-driven model selection (`etc/models.json`):
- **Role-based routing**: Different models for different tasks
- **Cognitive mode integration**: Mode-specific model mappings
- **Hot-swappable models**: Change models without code changes
- **Audit logging**: All model calls logged to audit trail

**Functions:**
- `resolveModel(role)` - Get model for a specific role
- `callLLM({ role, messages, options })` - Call LLM with role-based routing

### LLM Backend Manager
Switch between local LLM backends (`etc/llm-backend.json`):
- **Ollama** (default): Easy model switching, GGUF files
- **vLLM**: Higher throughput, loads ONE model at a time, requires server restart

**Functions:**
- `getActiveBackend()` - Check current backend
- `setActiveBackend(name)` - Switch backends
- `ensureBackendRunning()` - Start backend if needed

See [LLM Backend](../configuration-admin/llm-backend.md) for details.

---

## Cognitive Layers Architecture

3-layer pipeline processes every conversation (`etc/cognitive-layers.json`):

### Layer 1: Subconscious
Memory retrieval, pattern detection, context building:
- **Search Depth**: shallow (4), normal (8), deep (16) memory results
- **Similarity Threshold**: 0.62 default
- **Filtering**: Can exclude inner dialogue and reflections

### Layer 2: Personality Core
Response generation with LoRA adapters:
- **LoRA Mode**: 'latest' (newest), 'snapshot' (specific date), or base model
- **Voice Consistency**: Track adapter usage for voice alignment
- **Fallback**: Gracefully fall back to base if adapter unavailable

### Layer 3: Meta-Cognition
Validation and refinement:
- **Validation Level**: 'none', 'selective' (safety only), 'full' (all checks)
- **Value Alignment**: Consistency and safety validators
- **Refinement**: Automatic response refinement below threshold

**Feature Flag:** `USE_COGNITIVE_PIPELINE=true` in `.env`

See [Configuration Files](../configuration-admin/configuration-files.md#etc-cognitive-layers-json) for full config.

---

## Training Configuration

Centralized LoRA adapter training configuration (`etc/training.json`):

**Priority Order:**
1. `METAHUMAN_BASE_MODEL` env var
2. `etc/training.json`
3. Hardcoded defaults

**Key Parameters:**
- `base_model`: HuggingFace model identifier
- `max_seq_length`: Maximum sequence length (2048 = ~1500 words)
- `lora_rank`: LoRA rank (8 = balanced, 16 = higher capacity)
- `num_train_epochs`: Training epochs (2-3 recommended)
- `learning_rate`: Learning rate (0.0002 = 2e-4)
- `dtype`: Training precision (`bfloat16` for Qwen3, `fp16` for older models)

Used by: `full-cycle.ts`, `full-cycle-local.ts`, `train_unsloth.py`

---

## Data Storage

**⚠️ CRITICAL:** Always use `getProfilePaths(username)` - never hardcode paths. Many users have custom profile storage on encrypted drives, external storage, or network mounts.

### Profile-Based Architecture

**Default Structure:**
```
metahuman/
├── profiles/<username>/    # Per-user profile directories
│   ├── persona/           # Identity kernel
│   │   ├── core.json      # Personality traits
│   │   ├── relationships.json
│   │   ├── routines.json
│   │   ├── cognitive-mode.json
│   │   └── desires/       # Agency system desires by status
│   ├── memory/
│   │   ├── episodic/      # Timeline (YYYY/YYYY-MM-DD-*.json)
│   │   ├── tasks/         # Active and completed tasks
│   │   ├── inbox/         # Raw files awaiting ingestion
│   │   └── index/         # Vector embeddings index
│   ├── etc/               # Profile-specific configuration
│   │   ├── models.json
│   │   ├── training.json
│   │   └── boredom.json
│   ├── state/             # Runtime state files
│   └── out/               # Generated outputs, adapters
├── etc/                   # System-wide configuration
│   ├── llm-backend.json
│   ├── operator.json
│   ├── cognitive-layers.json
│   └── agency.json
├── logs/
│   ├── audit/             # Complete operation trail
│   └── run/               # Agent PID files, locks
└── brain/                 # Agent and skill definitions
```

**Custom Profile Storage:**
Many users configure custom locations via `persona/users.json`:
- Encrypted drives: `/media/user/STACK/metahuman-profiles/<username>/`
- External storage: `/mnt/external/profiles/<username>/`
- Network storage: `/media/nas/metahuman/<username>/`

See [Accounts & Security](../configuration-admin/accounts-security.md#custom-storage-location-stacks) for details.

### Human-Readable JSON
All data is stored as readable, editable JSON files. No proprietary formats or databases.

### Path Resolution
```typescript
import { getProfilePaths, systemPaths } from '@metahuman/core';

// User-specific paths (resolves custom storage)
const profilePaths = getProfilePaths(username);
const memoryPath = profilePaths.episodic;

// System-wide paths
const agentPath = systemPaths.agents;
```

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
