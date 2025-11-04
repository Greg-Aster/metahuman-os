## Core Concepts

MetaHuman OS functions as a personal operating system with seven core subsystems (OS Services). These work together to create a seamless digital personality extension.

### 1. Identity & Persona Kernel

Your core identity model stored in `persona/*.json` files:

**Deep Personality Model:**
- Communication style, humor, values, boundaries, goals, fears
- Decision patterns: How you prioritize, what you care about, your heuristics and biases
- Behavioral fingerprint: Your routines, habits, energy patterns, work styles
- Relationship model: Key people, communication patterns, interaction preferences
- Editable & versioned: Update your digital personality extension as you evolve

**Files:**
- `persona/core.json` - Personality, values, goals, communication style
- `persona/relationships.json` - Key people and interaction patterns
- `persona/routines.json` - Habits, patterns, energy cycles
- `persona/decision-rules.json` - Heuristics and boundaries

### 2. Memory System (Persistent State)

Structured storage of your experiences, knowledge, and learnings:

**Episodic Memory:**
- Timeline of events, conversations, observations with full context
- Stored as JSON files in `memory/episodic/YYYY/`
- Each event includes timestamp, content, tags, entities, and metadata

**Semantic Memory:** (Planned)
- Facts, knowledge, learnings, concepts, and their relationships
- Knowledge graph structure connecting related information
- Fast retrieval via relationships and associations

**Procedural Memory:** (Planned)
- How to do things, workflows, scripts, learned sequences
- Reusable procedures for common tasks
- Automation templates

**Preference Cache:** (Planned)
- Accumulated decisions that inform future choices
- Learned from repeated behaviors and explicit corrections
- Confidence scores for each preference

**Emotional Context:**
- Sentiment, importance, energy levels associated with memories
- Helps prioritize and recall contextually relevant information

**Fast Retrieval:**
- Vector search for semantic similarity
- Temporal queries for timeline navigation
- Associative links between related memories
- Tag-based filtering for quick categorization

### 3. Autonomous Agent Runtime

Background processes that operate continuously:

**Background Processes:**
- Monitoring tasks, scheduled routines, event-driven triggers
- Examples: organizer, reflector, dreamer, boredom-service, sleep-service, ingestor

**Proactive Planning:**
- Anticipate needs based on calendar, patterns, and goals
- Surface insights before you need to ask

**Decision Automation:**
- Handle routine choices within trust boundaries automatically
- Learn from corrections and adjust behavior

**Opportunity Detection:**
- Scan for relevant info, connections, and potential actions
- Alert you to time-sensitive or important updates

**Self-Maintenance:**
- Health checks, memory consolidation, skill updates
- Automatic cleanup and optimization

### 4. Sync Engine (Human ↔ Digital Personality Extension)

Bidirectional learning between you and your digital twin:

**Observation Capture:**
- Passive listening to activities, communications, decisions
- `mh capture` command for explicit observations

**Active Feedback Loops:**
- Explicit corrections, approvals, and teaching moments
- Memory validation (mark as correct/incorrect)

**Behavioral Learning:**
- Pattern recognition from repeated actions and choices
- Identify routines and preferences automatically

**Preference Inference:**
- Learn unstated preferences from observed behavior
- Build decision models from your actual choices

**Continuous Alignment:**
- Ensure digital personality extension stays synchronized with your evolving self
- Regular reviews and adjustments

### 5. Decision Engine

Policy-based reasoning system:

**Policy-Based Reasoning:**
- Codified rules, heuristics, and decision trees
- Stored in `persona/decision-rules.json`

**Context-Aware Judgment:**
- Factor in goals, constraints, current state, and risks
- Consider past decisions and outcomes

**Trust Levels:**
- Different autonomy modes based on action risk and confidence
- Progressive trust: observe → suggest → supervised_auto → bounded_auto

**Explanation Generation:**
- Always know why a decision was made
- Full audit trail in `logs/audit/`

**Fallback to Human:**
- Escalate uncertain or high-stakes decisions
- Approval queue for skills requiring permission

### 6. Skills & Integration Layer

Modular capabilities for interacting with the world, organized into domains.

**Domain-Centric Capabilities:**
- Functional areas (tasks, calendar, notes) are treated as **domains**.
- Each domain exposes primitives like `list`, `create`, `update`.
- Skills are namespaced (e.g., `tasks.list`, `calendar.create`).

**Capability Catalog:**
- The planner queries a **capability catalog** to discover available actions at runtime.
- Concise "how-to" guides for each domain are stored in `persona/capabilities/*.md`.

**Available Domains:**
- **Tasks & Calendar**: Manage tasks, lists, and schedule events.
- **Communication**: (Planned) Email, Slack, SMS with your voice.
- **Information Gathering**: Research, summarization, web search.
- **Task Execution**: File operations, API calls, system commands.
- **Knowledge Work**: (Planned) Writing, coding, planning.
- **Physical World**: (Planned) IoT controls, location-based actions.

### 7. Learning & Adaptation

Continuous improvement system:

**Outcome Tracking:**
- What worked, what didn't, why
- Success/failure analysis

**Pattern Recognition:**
- Identify recurring situations and optimal responses
- Learn from repetition

**Skill Improvement:**
- Self-directed learning to better serve your goals
- Adapt to new tools and integrations

**Model Updates:**
- Refine personality model, preferences, and decision policies
- Evolve with you over time

**Experimentation:**
- A/B test approaches within safe boundaries
- Learn optimal strategies through trial

### 8. Cognitive Modes

MetaHuman OS features three distinct operational modes that control how the system processes information, routes decisions, and manages memory. You can switch between modes via the Web UI header or the API to match your current needs.

**Why Cognitive Modes?**
Different situations call for different levels of system engagement. Cognitive modes let you choose between:
- Full learning and adaptation (Dual Consciousness)
- Lightweight assistant behavior (Agent Mode)
- Stable, read-only operation (Emulation)

#### Dual Consciousness Mode (Default)

**Purpose:** Full cognitive mirror with deep learning and memory grounding.

**Behavior:**
- **Routing**: Always uses the operator pipeline (planner → skills → narrator)
- **Memory**: Full read/write access, captures all interactions for training
- **Context**: Mandatory semantic search with persona fallback when index unavailable
- **Learning**: Proactive agents enabled, training pipeline active
- **Use Case**: Primary operational mode for maximum system capabilities

**When to Use:**
- Daily operation and conversations
- Building long-term personality model
- When you want the system to learn from every interaction
- Task execution with full memory integration

**Technical Details:**
```json
{
  "operatorRouting": "operator_only",
  "memoryWriteLevel": "read_write",
  "proactiveAgents": true,
  "trainingPipeline": "dual_trigger",
  "contextRetrieval": "semantic_required"
}
```

**Audit Tracking:**
All chat operations include `cognitiveMode: "dual"` and `usedOperator: true` in logs.

#### Agent Mode

**Purpose:** Lightweight assistant mode with selective memory capture.

**Behavior:**
- **Routing**: Smart heuristics (simple chat vs. action-oriented operator routing)
- **Memory**: Command outcomes only (not casual conversations)
- **Context**: Optional semantic search (graceful degradation)
- **Learning**: Proactive agents disabled, training pipeline disabled
- **Use Case**: Traditional assistant experience with reduced cognitive load

**When to Use:**
- Quick questions without deep processing
- When you want faster responses
- Temporary sessions where you don't need learning
- Testing or experimentation

**Routing Logic:**
```typescript
// Simple query → Chat response (no operator)
"What's the weather?" → Direct chat

// Action request → Operator pipeline
"Create a task to review documentation" → Planner + Skills
```

**Technical Details:**
```json
{
  "operatorRouting": "heuristic",
  "memoryWriteLevel": "command_only",
  "proactiveAgents": false,
  "trainingPipeline": "disabled",
  "contextRetrieval": "semantic_optional"
}
```

**Audit Tracking:**
Logs include `cognitiveMode: "agent"` and `usedOperator: true/false` based on routing decision.

#### Emulation Mode (Replicant)

**Purpose:** Read-only personality snapshot without learning or side effects.

**Behavior:**
- **Routing**: Never uses operator (chat only)
- **Memory**: Read-only access, no new memories created
- **Context**: Can access existing memories but doesn't learn
- **Learning**: All learning and training disabled
- **Use Case**: Demonstration, testing, or safe exploration

**When to Use:**
- Showing the system to others without side effects
- Testing responses without polluting memory
- Accessing knowledge without changing state
- Creating stable personality snapshots

**Safety Features:**
- No memory writes (audit event: `chat_assistant_readonly`)
- No task creation or file modifications
- No training data generation
- Existing memories accessible but frozen

**Technical Details:**
```json
{
  "operatorRouting": "chat_only",
  "memoryWriteLevel": "read_only",
  "proactiveAgents": false,
  "trainingPipeline": "disabled",
  "contextRetrieval": "semantic_optional"
}
```

**Audit Tracking:**
All operations logged with `event: "chat_assistant_readonly"` and `cognitiveMode: "emulation"`.

#### Switching Modes

**Via Web UI:**
1. Look at the header (top of the page)
2. Click the cognitive mode selector
3. Choose your desired mode:
   - 🧠 Dual Consciousness (purple glow)
   - 🛠️ Agent Mode (blue)
   - 🪄 Emulation (amber)
4. Mode switches instantly and persists across sessions

**Via API:**
```bash
# Get current mode
curl http://localhost:4321/api/cognitive-mode

# Set mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dual"}'
```

**Mode Persistence:**
- Current mode stored in `persona/cognitive-mode.json`
- Full history of mode changes tracked
- Survives page reloads and system restarts

#### Mode Comparison Table

| Feature | Dual Consciousness | Agent Mode | Emulation |
|---------|-------------------|------------|-----------|
| **Operator Pipeline** | Always | Heuristic | Never |
| **Memory Writes** | Full | Commands only | None |
| **Context Grounding** | Required | Optional | Optional |
| **Proactive Agents** | Enabled | Disabled | Disabled |
| **Training Pipeline** | Active | Disabled | Disabled |
| **Use Case** | Full system | Quick assistant | Demo/testing |
| **Speed** | Slower | Faster | Fastest |
| **Learning** | Yes | Limited | No |

#### Advanced: Fallback Context

**Dual Mode Robustness:**
When semantic index is unavailable, Dual Mode automatically provides fallback grounding:
- Core persona identity (name, role, purpose)
- Communication style and values
- Recent reflections (last 2)
- Prevents empty context, ensures grounded responses

**Warning Logged:**
```
[DUAL MODE] No semantic index available - memory grounding degraded
```

**Audit Event:**
```json
{
  "event": "dual_mode_missing_index",
  "level": "warn",
  "details": {
    "message": "Semantic index unavailable, using persona fallback"
  }
}
```

#### Implementation Details

Cognitive modes are implemented through:
- **Core Module**: `packages/core/src/cognitive-mode.ts`
- **Config File**: `persona/cognitive-mode.json`
- **Chat Integration**: `apps/site/src/pages/api/persona_chat.ts`
- **UI Controls**: Mode selector in `ChatLayout.svelte` header

All mode switches are fully audited with actor tracking (user vs. system).

---

