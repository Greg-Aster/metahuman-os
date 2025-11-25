# Core Concepts

MetaHuman OS functions as a personal operating system built on several core subsystems that work together to create a seamless digital personality extension. This document provides a high-level overview of the key concepts.

---

## 1. Identity & Persona Kernel

Your core identity model stored in `persona/*.json` files forms the foundation of your digital personality.

### Deep Personality Model

The persona system captures multiple dimensions of your identity:

- **Communication style**: How you express yourself (humor, tone, formality)
- **Values & ethics**: What you care about, your moral framework, boundaries
- **Decision patterns**: How you prioritize, your heuristics and biases
- **Behavioral fingerprint**: Routines, habits, energy patterns, work styles
- **Relationship model**: Key people, communication patterns, interaction preferences
- **Goals & aspirations**: Short-term and long-term objectives

### Persona Files

- **`persona/core.json`** - Personality, values, goals, communication style
- **`persona/relationships.json`** - Key people and interaction patterns
- **`persona/routines.json`** - Habits, patterns, energy cycles
- **`persona/decision-rules.json`** - Heuristics and boundaries
- **`persona/facets.json`** - Configuration for persona facets
- **`persona/facets/*.json`** - Individual facet definitions

### Persona Facets

Facets allow your digital personality to present different aspects depending on context:

- **Default** (Purple) - Balanced, authentic self
- **Poet** (Indigo) - Creative, metaphorical, expressive
- **Thinker** (Blue) - Analytical, philosophical, systematic
- **Friend** (Green) - Warm, supportive, empathetic
- **Antagonist** (Red) - Critical, challenging, provocative
- **Inactive** (Gray) - Persona system disabled

**Switching**: Click the persona badge in the status widget (left sidebar) to cycle through facets. Each response is color-coded with a left border matching the active facet.

**See also**: [Persona Management System](../25-persona-generation.md)

---

## 2. Memory System

Structured storage of your experiences, knowledge, and learnings.

### Memory Types

**Episodic Memory** (Implemented)
- Timeline of events, conversations, observations with full context
- Stored as JSON files in `memory/episodic/YYYY/`
- Each event includes timestamp, content, tags, entities, metadata
- Per-user isolation in `profiles/<username>/memory/episodic/`

**Semantic Memory** (Planned)
- Facts, knowledge, learnings, concepts, and relationships
- Knowledge graph structure connecting related information
- Fast retrieval via relationships and associations

**Procedural Memory** (Planned)
- How-to knowledge, workflows, scripts, learned sequences
- Reusable procedures for common tasks
- Automation templates

**Preference Cache** (Planned)
- Accumulated decisions that inform future choices
- Learned from repeated behaviors and explicit corrections
- Confidence scores for each preference

**Function Memory** (Implemented)
- Reusable multi-step execution patterns
- Learned from successful operator workflows
- User approval required before use

### Memory Features

**Emotional Context**:
- Sentiment, importance, energy levels associated with memories
- Helps prioritize and recall contextually relevant information

**Fast Retrieval**:
- Vector search for semantic similarity
- Tag-based filtering for categorization
- Temporal queries for timeline navigation
- Associative links between related memories

**Memory Grounding (RAG)**:
- Retrieval-Augmented Generation pattern
- Relevant memories retrieved before response generation
- Context Builder module augments prompts with personal history
- Ensures responses are grounded in your experiences

**See also**: [Memory System Guide](../07-memory-system.md)

---

## 3. Autonomous Agents

Intelligent background processes that operate continuously to augment your cognitive abilities.

### Agent Scheduler

- Centralized management via `scheduler-service`
- Configured through `etc/agents.json`
- Multiple trigger types: `interval`, `time-of-day`, `event`
- Single-instance protection via `running.json` registry
- Supports headless mode with reduced agent set

### Key Agents

**Organizer**
- Enriches memories with LLM-extracted tags and entities
- Improves search quality and memory organization

**Reflector**
- Generates thoughtful reflections on recent events
- Creates associative memory chains (3-5 related memories)
- Saves as `inner_dialogue` type (internal thoughts)

**Boredom Service**
- Activity-based agent that triggers reflections after inactivity
- Configurable thresholds: high (~1 min), medium (~5 min), low (~15 min)
- Managed via Settings → Boredom Control in web UI

**Curiosity Services**
- **Curiosity**: Asks user-facing questions in main chat
- **Inner Curiosity**: Self-directed internal questions and answers
- Uses weighted memory selection (14-day decay factor)

**Dreamer**
- Creates surreal dream narratives from lifetime memory fragments
- Uses reflective exponential decay weighting (old memories surface meaningfully)
- Runs during sleep cycle

**Sleep Service**
- Orchestrates nightly pipeline: dreams, audio processing, learning
- Manages adapter training data generation

**Ingestor**
- Converts raw files from `memory/inbox/` into episodic memories
- Supports text, PDF, code files, JSON, YAML, CSV

**Operator** (See [Reasoning Engine](#4-reasoning-engine))
- Executes complex multi-step tasks using skills
- ReAct pattern (Reason-Act-Observe)

**See also**: [Autonomous Agents Guide](../08-autonomous-agents.md)

---

## 4. Reasoning Engine

The **Operator** agent uses a sophisticated reasoning system (ReasoningEngine) that implements the ReAct pattern for goal-oriented task execution.

### ReAct Pattern

```
Goal → Thought → Action → Observation → Thought → ... → Response
```

1. **Thought**: Plan the next step toward the goal
2. **Action**: Execute a skill/tool to gather information or make changes
3. **Observation**: Process the result and update understanding
4. **Loop**: Repeat until goal is achieved or max steps reached
5. **Response**: Generate final answer based on all observations

### Key Features

- **Structured Scratchpad**: Complete history of Thought → Action → Observation cycles
- **Error Recovery**: 7 error types with contextual suggestions
- **Failure Loop Detection**: Prevents repeated failures (triggers after 2 attempts)
- **3 Observation Modes**: Verbatim (raw JSON), Structured (tables), Narrative (prose)
- **Fast-Path Optimizations**: Short-circuits simple queries
- **Tool Catalog Integration**: Auto-generated LLM-friendly skill documentation

### Reasoning Depth Levels

| Level | Name | Steps | Use Case |
|-------|------|-------|----------|
| 0 | Off | 1 | Direct execution, no reasoning |
| 1 | Quick | 5 | Simple single-task operations |
| 2 | Focused | 10 | Multi-step tasks (default) |
| 3 | Deep | 15 | Complex problem solving |

### Implementations

**V2 Service (Recommended)**:
- Extracted into reusable `@metahuman/core/reasoning` module
- Enhanced error recovery with contextual suggestions
- Structured event streaming for UI observability

**V2 Inline (Default)**:
- Reasoning logic embedded in `operator-react.ts`
- Plans one step at a time based on observed results
- Never hallucinates data

**V1 Legacy**:
- Plans all steps upfront before seeing results
- Preserved for backward compatibility

### Configuration

Control via `etc/runtime.json`:
```json
{
  "operator": {
    "reactV2": true,              // Enable V2 ReAct pattern
    "useReasoningService": false  // Use unified service vs inline
  }
}
```

**See also**: [Reasoning Engine Deep Dive](core-features/04d-reasoning-engine.md)

---

## 5. Skills System

Skills provide controlled interfaces for the AI to interact with the system.

### Design Principles

- **Sandboxed execution** with strict permission boundaries
- **Trust-aware availability** and auto-execution
- **Fully audited** with inputs, outputs, results
- **Risk-based approval** requirements
- **Fuzzy paths** by default (typos auto-corrected)

### Skill Categories

- **`fs`** - File system operations (read, write, list)
- **`memory`** - Memory operations (search, create, update)
- **`task`** - Task management (list, create, update, complete)
- **`agent`** - Agent management (start, stop, status)
- **`shell`** - Shell command execution (whitelisted)
- **`network`** - Network operations (future)

### Skill Execution Flow

1. Operator requests skill execution
2. Policy Engine checks permissions and trust level
3. Validation and approval requirements applied
4. Skill executes with full audit logging
5. Results returned to operator for next steps

**See also**: [Skills System Guide](../09-skills-system.md)

---

## 6. Multi-User Context Management

Complete user isolation and context management.

### User Context Architecture

- **Session-based** user context via middleware
- **Per-user path resolution** and file access
- **Role-based permissions**: owner, guest, anonymous
- **Secure session management** with HTTPOnly cookies
- **Automatic context switching** between users

### Per-User Isolation

- Each user has separate `profiles/<username>/` directory
- Isolated memory, persona, config, and log files
- User-specific configuration in `etc/` subdirectories
- Cross-user access strictly forbidden
- Proper audit trail attribution

**See also**: [Multi-User Profiles Guide](../19-multi-user-profiles.md)

---

## 7. Cognitive Modes

Different operational paradigms for different use cases. Switch modes via Web UI header or API.

### Three Modes

**Dual Consciousness Mode** (Default)
- Parallel intelligence that syncs with your thoughts
- Always routes through operator pipeline (planner → skills → narrator)
- Mandatory memory grounding via semantic search
- Full memory capture and learning
- Proactive agents enabled
- **Use for**: Primary operational mode, full system capabilities

**Agent Mode**
- Smart routing: simple queries use chat, action requests use operator
- Heuristic-based detection of action-oriented messages
- Proactive agents disabled
- Memory capture when authenticated
- **Use for**: Lightweight assistant mode, reduced cognitive load

**Emulation Mode**
- Never routes to operator (chat only)
- Stable personality snapshot
- Memory capture when authenticated (read-only for anonymous)
- Proactive agents disabled
- **Use for**: Demonstration, testing, simple chat

### Mode Switching

**Via Web UI**: Click mode badge in header (Purple = Dual, Blue = Agent, Gray = Emulation)

**Via API**: `POST /api/cognitive-mode` with `{ "mode": "dual|agent|emulation" }`

All chat operations include `cognitiveMode` and `usedOperator` fields in audit logs.

**See also**: [Cognitive Modes Deep Dive](core-features/04b-cognitive-modes.md)

---

## 8. Multi-Model Architecture

MetaHuman OS uses a "multi-model" architecture with specialized models for different roles.

### Model Roles

| Role | Purpose | Characteristics |
|------|---------|-----------------|
| **Orchestrator** | Executive function, routing, safety | Lightweight, fast, decides *what* to do |
| **Persona** | Conversational voice & introspection | Heavy, fine-tuned, provides personality |
| **Curator** | Memory curation & training data prep | Summarization-focused, data librarian |
| **Coder** | Code generation and analysis | Specialized for programming tasks |

### Benefits

- **Higher quality conversations**: Persona model trained only on identity-rich data
- **Faster, more responsive UI**: Lightweight orchestrator handles routing instantly
- **Increased reliability**: Orchestrator enforces policies as stable guardrail
- **Modularity**: Each component upgradable independently

### Configuration

Models are mapped via `etc/models.json`, with role-based routing through the Model Router.

**See also**: [Model Architecture Deep Dive](core-features/04a-model-architecture.md)

---

## 9. Security & Trust Framework

Comprehensive security model with progressive autonomy.

### Unified Security Policy

- Centralized permission enforcement
- Cognitive mode validation
- User context validation
- Per-user isolation enforcement

### Trust Levels (Progressive Autonomy)

1. **`observe`** - Monitor only, learn patterns
2. **`suggest`** - Propose actions, require approval
3. **`supervised_auto`** - Execute within approved categories
4. **`bounded_auto`** - Full autonomy within boundaries
5. **`adaptive_auto`** - Self-expand boundaries (experimental)

### Safety Mechanisms

- Complete audit trail of all operations
- Dry-run mode for previewing changes
- Rate limits and confidence thresholds
- Emergency stop and rollback capabilities
- Approval queue for high-risk operations

**See also**: [Security & Trust Model](../10-security-trust.md)

---

## 10. System Architecture

### Sync Engine (Human ↔ Digital Personality)

Bidirectional learning between you and your digital twin:

- **Observation capture**: Passive listening + explicit `mh capture` commands
- **Active feedback loops**: Corrections, approvals, teaching moments
- **Behavioral learning**: Pattern recognition from repeated actions
- **Preference inference**: Learn unstated preferences from behavior
- **Continuous alignment**: Stay synchronized with your evolving self

### Decision Engine

Policy-based reasoning system:

- **Policy-based reasoning**: Codified rules in `persona/decision-rules.json`
- **Context-aware judgment**: Factor in goals, constraints, state, risks
- **Trust levels**: Different autonomy modes based on risk and confidence
- **Explanation generation**: Full audit trail of decision reasoning
- **Fallback to human**: Escalate uncertain or high-stakes decisions

### Learning & Adaptation

Continuous improvement:

- **Outcome tracking**: What worked, what didn't, why
- **Pattern recognition**: Identify recurring situations and optimal responses
- **Skill improvement**: Self-directed learning
- **Model updates**: Refine personality, preferences, decision policies
- **Experimentation**: A/B test approaches within safe boundaries

---

## Quick Reference

**Essential Files**:
- `persona/core.json` - Your personality
- `memory/episodic/` - Your experiences
- `etc/models.json` - Model configuration
- `etc/agents.json` - Agent configuration
- `logs/audit/` - Complete audit trail

**Key Commands**:
- `mh init` - Initialize system
- `mh status` - Check system health
- `mh capture "text"` - Record observation
- `mh remember "query"` - Search memories
- `mh task` - Manage tasks
- `mh agent list` - View available agents

**Web UI Sections**:
- Left Sidebar: Feature navigation
- Center Panel: Main content (Chat, Memory Browser, Tasks, etc.)
- Right Sidebar: Developer tools (Audit Stream, Agent Monitor, Settings)

---

## Related Documentation

- **[Getting Started Tutorial](getting-started/03-first-steps-tutorial.md)** - New user walkthrough
- **[Common Workflows](getting-started/05-common-workflows.md)** - Task-oriented guides
- **[Model Architecture](core-features/04a-model-architecture.md)** - Multi-model system details
- **[Cognitive Modes](core-features/04b-cognitive-modes.md)** - Mode comparison and configuration
- **[Reasoning Engine](core-features/04d-reasoning-engine.md)** - ReAct pattern deep dive
- **[Memory System](07-memory-system.md)** - Memory types and retrieval
- **[Autonomous Agents](08-autonomous-agents.md)** - Agent details and configuration
- **[Skills System](09-skills-system.md)** - Skill catalog and development
- **[Security & Trust](10-security-trust.md)** - Trust levels and policies
- **[Configuration Files](14-configuration-files.md)** - Complete config reference

---

**You now understand the core concepts powering MetaHuman OS!** 🎉
