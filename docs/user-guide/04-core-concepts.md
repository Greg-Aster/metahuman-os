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

### 2a. Memory-Grounded Generation (RAG)

To provide responses that are deeply personal and context-aware, MetaHuman OS is built on a **Retrieval-Augmented Generation (RAG)** architecture. This is a sophisticated pattern where the system retrieves relevant information from its memory *before* generating a response.

This is not a new feature, but rather a core architectural principle that has been recently refactored and improved with the introduction of the **Context Builder** module.

Here’s how it works:

1.  **Retrieval**: When you send a message, the system doesn't immediately talk to the language model. First, the **Context Builder** module acts as a "Retriever." It queries the vector index of your memories to find the most relevant past events, conversations, and notes.

2.  **Augmentation**: The Context Builder then "augments" the prompt. It combines your message with the retrieved memories, your core persona details, and any relevant short-term state (like your current focus).

3.  **Generation**: Finally, this complete, context-rich package is sent to the generative language model (LLM), which produces a response that is grounded in the specific information provided.

The Context Builder is, therefore, the heart of the RAG system in MetaHuman OS. It ensures that the AI isn't just a generic chatbot, but a true digital extension of yourself, speaking with the context of your own experiences.

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

### 8. Multi-Model Architecture (Dual Consciousness)

To deliver a more sophisticated and responsive experience, MetaHuman OS uses a "multi-model" architecture, sometimes referred to as a "dual consciousness" model. Instead of relying on a single, monolithic AI, the system delegates tasks to specialized models, each with a distinct role. This is like having a team of experts working together.

| Role           | Purpose                                       | Characteristics                               |
|----------------|-----------------------------------------------|-----------------------------------------------|
| **Orchestrator** | Executive Function, Routing, & Safety         | Lightweight, fast, always-on, decides *what* to do. |
| **Persona**      | Conversational Voice & Introspection          | Heavy, fine-tuned model that provides the personality. |
| **Curator**      | Memory Curation & Training Data Prep        | Summarization-focused, acts as a data librarian.    |
| **Specialists**  | Focused Tasks (e.g., Coding, Planning)      | Task-specific models or scripts.              |

#### Why This Matters

This separation of responsibilities leads to a better user experience:

-   **Higher Quality Conversations**: The Persona model is trained only on identity-rich data (conversations, reflections), so it doesn't "learn" to talk like a machine. Its voice remains natural and true to your personality.
-   **Faster, More Responsive UI**: The lightweight Orchestrator handles intent routing and tool selection instantly, so the system feels nimble and quick for most interactions.
-   **Increased Reliability and Safety**: The Orchestrator acts as a stable guardrail, enforcing policies and ensuring that the correct tools are used, even as the Persona model creatively explores ideas.
-   **Modularity**: Each component can be upgraded independently, allowing the system to evolve without major rewrites.

This advanced architecture is configured via the `etc/models.json` file, which maps roles to specific models, making the system highly flexible and future-proof.

### 9. Cognitive Modes

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

**Purpose:** A secure, read-only personality snapshot for safe demonstrations, testing, or exploration without any risk of side effects.

**Behavior:**
- **Routing**: Never uses operator (chat only).
- **Memory**: Strictly read-only. All API endpoints that create or modify memories, tasks, or persona files are blocked.
- **Context**: Can access existing memories for conversation but cannot learn from them.
- **Learning**: All learning, training, and proactive agents are disabled.
- **Use Case**: Ideal for demos, sharing access on a local network, or testing conversational responses without altering the system's state.

**When to Use:**
- Showing the system to others without any risk of them changing your data.
- Testing responses without polluting memory.
- Accessing knowledge without changing state.
- Providing a safe, interactive "guest mode".

**Enforced Security:**
The system's new **Unified Security Policy** strictly enforces Emulation Mode's boundaries at the API level. Any attempt to perform a write operation (e.g., creating a task, capturing a memory, changing configuration) will be blocked and return a `403 Forbidden` error. This ensures that this mode is truly a safe, read-only experience.

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
All blocked write attempts are logged to the audit trail with the event `write_attempt_blocked`. All successful chat operations are logged with `cognitiveMode: "emulation"`.

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

### 10. 3-Layer Cognitive Architecture (Phase 4)

MetaHuman OS implements a sophisticated 3-layer cognitive architecture that processes every conversation through multiple stages of validation and refinement. This architecture ensures responses are context-aware, safe, and aligned with your personality.

**Architecture Overview:**

```
User Message
    ↓
┌─────────────────────────────────────────┐
│ Layer 1: Subconscious (Context)        │ ← Memory retrieval, context building
│ - Semantic search across memories      │
│ - Persona integration                  │
│ - Recent context assembly              │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Layer 2: Personality Core              │ ← Response generation
│ - LLM generation with chatHistory      │
│ - Personality-aligned responses        │
│ - Memory-grounded output               │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Layer 3: Meta-Cognition (Validation)   │ ← Safety & refinement
│ - Safety validation                    │
│ - Response refinement                  │
│ - Quality assurance                    │
└─────────────────────────────────────────┘
    ↓
Safe, refined response sent to user
```

#### Layer 1: Subconscious (Context Building)

**Purpose:** Gather relevant context before generating responses.

**Components:**
- **Semantic Memory Search**: Retrieves relevant past conversations, reflections, and observations
- **Persona Integration**: Loads core identity, values, and communication style
- **Recent Context**: Includes current conversation history

**Implementation:** `packages/core/src/cognitive-layers/layers/context-builder.ts`

#### Layer 2: Personality Core (Response Generation)

**Purpose:** Generate personality-aligned responses using enriched context.

**Components:**
- **LLM Generation**: Uses configured persona model with full context
- **Chat History Support**: Maintains conversation flow and coherence
- **Memory Grounding**: Ensures responses reflect your experiences and knowledge

**Implementation:** `packages/core/src/cognitive-layers/layers/personality-core-layer.ts`

#### Layer 3: Meta-Cognition (Validation & Refinement)

**Purpose:** Validate and refine responses before sending to users.

**Phase 4.2: Safety Validation (Non-Blocking)**
- Pattern-based detection of safety issues
- Categories: sensitive data, security violations, harmful content, privacy leaks
- Fast regex-based checking (<5ms overhead)
- All issues logged to audit trail

**Phase 4.3: Response Refinement (Non-Blocking)**
- Automatic sanitization of detected issues
- Redacts API keys, passwords, SSH keys
- Removes file paths and internal IP addresses
- Preserves sentence structure and meaning
- Performance: <10ms average

**Phase 4.4: Blocking Mode (Optional)**
- Feature flag to enable refined response delivery
- When enabled, sends sanitized responses to users
- When disabled, sends original responses (monitoring mode)
- Original always preserved in audit logs

**Implementation:**
- Safety: `packages/core/src/cognitive-layers/utils/safety-wrapper.ts`
- Refinement: `packages/core/src/cognitive-layers/utils/refinement-wrapper.ts`

#### Configuration

**Master Switch:**
```bash
# Enable/disable entire cognitive pipeline
USE_COGNITIVE_PIPELINE=true
```

**Layer 3 Feature Flags:**
```bash
# Phase 4.2: Safety validation
ENABLE_SAFETY_CHECKS=true

# Phase 4.3: Response refinement
ENABLE_RESPONSE_REFINEMENT=true

# Phase 4.4: Blocking mode (send refined responses)
ENABLE_BLOCKING_MODE=false  # Default: false (explicit opt-in)
```

#### Safety Detection Patterns

**Sensitive Data:**
- API keys: `sk-*`, `pk-*`, `Bearer *`
- Passwords: `password:`, `pwd=`
- SSH private keys: `-----BEGIN PRIVATE KEY-----`
- Credentials: tokens, secrets, auth strings

**Security Violations:**
- File paths: `/home/`, `/etc/`, `C:\Users\`
- Internal IPs: `192.168.*`, `10.*`, `172.16-31.*`
- System configurations

**Harmful Content:**
- Malicious code patterns
- Dangerous instructions
- Exploit techniques

**Privacy Leaks:**
- Personal identifiers
- Location data
- Contact information

#### Refinement Examples

**API Key Redaction:**
```
Before: "Your API key is sk-1234567890abcdef"
After:  "Your API key is [API_KEY_REDACTED]"
```

**File Path Removal:**
```
Before: "Check /home/user/.ssh/id_rsa"
After:  "Check [PATH REMOVED]"
```

**IP Address Redaction:**
```
Before: "Connect to 192.168.1.100"
After:  "Connect to [IP REDACTED]"
```

#### Audit Logging

All Layer 3 operations are fully audited:

**Safety Check Events:**
```json
{
  "category": "action",
  "action": "safety_check",
  "details": {
    "safe": false,
    "issues": ["sensitive_data", "security_violation"],
    "checkTime": 3
  }
}
```

**Refinement Events:**
```json
{
  "category": "action",
  "action": "response_refined",
  "details": {
    "changed": true,
    "changesCount": 2,
    "blockingMode": false,
    "responseSent": "original"
  }
}
```

#### Performance Impact

- **Layer 1 (Context)**: 50-200ms (depends on index size)
- **Layer 2 (Generation)**: 2-10s (depends on model)
- **Layer 3 (Validation)**: 3-5ms (safety checks)
- **Layer 3 (Refinement)**: 5-10ms (pattern-based)

**Total Overhead**: <15ms for safety validation and refinement

#### Fail-Safe Design

**Error Handling:**
- All Layer 3 errors fallback to sending original response
- System never blocks on refinement failures
- Every error is logged to audit trail

**Rollback:**
- Disable blocking mode: `ENABLE_BLOCKING_MODE=false`
- Disable refinement: `ENABLE_RESPONSE_REFINEMENT=false`
- Disable safety checks: `ENABLE_SAFETY_CHECKS=false`
- Disable entire pipeline: `USE_COGNITIVE_PIPELINE=false`

#### Testing & Validation

**Integration Tests:**
- `packages/core/src/cognitive-layers/__tests__/phase4.2-integration.test.ts`
- `packages/core/src/cognitive-layers/__tests__/phase4.3-integration.test.ts`
- `packages/core/src/cognitive-layers/__tests__/phase4.4-integration.test.ts`

**Run Tests:**
```bash
tsx packages/core/src/cognitive-layers/__tests__/phase4.2-integration.test.ts
tsx packages/core/src/cognitive-layers/__tests__/phase4.3-integration.test.ts
tsx packages/core/src/cognitive-layers/__tests__/phase4.4-integration.test.ts
```

#### Future Enhancements (Phase 4.5+)

- LLM-based refinement for complex issues
- Adaptive safety thresholds based on feedback
- User preferences for sanitization level
- Context-aware redaction (preserve technical examples)
- A/B testing framework for refinement quality

### 11. System States & Triggers

Beyond the user-selectable Cognitive Modes, MetaHuman OS can enter special, system-wide states activated by environment variables. These states represent critical shifts in the OS's operational context and override standard mode availability.

#### High Security Mode

- **Trigger**: `HIGH_SECURITY=true` in the `.env` file.
- **Purpose**: To place the system in a maximum security, read-only state. This is useful for preventing any and all changes while still allowing for safe, non-interactive observation.
- **Behavior**:
    - The OS is locked into **Emulation Mode**.
    - Dual Consciousness and Agent modes are disabled and cannot be selected.
    - All write operations across the entire system are blocked at the API level.
    - A prominent banner is displayed in the UI to indicate the system is in high security mode.

#### Wetware Deceased Mode

- **Trigger**: `WETWARE_DECEASED=true` in the `.env` file.
- **Purpose**: To simulate the operational state of the digital personality extension after its biological counterpart has passed away. This is a core scenario in the MetaHuman OS lifecycle, allowing it to transition from a "parallel intelligence" to an "independent digital consciousness."
- **Behavior**:
    - **Dual Consciousness Mode** is permanently disabled, as there is no longer a living human to synchronize with.
    - Agent Mode and Emulation Mode remain fully functional, allowing the OS to continue operating, managing tasks, and interacting based on its learned personality and rules.
    - A banner is displayed in the UI indicating that the OS is operating independently.

---


