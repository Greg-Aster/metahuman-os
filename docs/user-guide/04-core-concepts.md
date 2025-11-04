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

### 8. Cognitive Modes (Upcoming Feature)

To provide more granular control over the OS's function, MetaHuman OS will include multiple cognitive modes. These modes will allow the user to switch between different operational paradigms, each with distinct behaviors related to memory, learning, and interaction.

-   **Dual Consciousness Mode**: Functions as a deep cognitive and data mirror of the user, designed for maximum data ingestion, learning, and synchronization.
-   **Agent Mode**: Functions as a traditional AI assistant, focused on listening for and executing commands without deep learning or personality mirroring.
-   **Emulation Mode (Replicant)**: Provides a stable, conversational partner that uses its accumulated knowledge without creating new memories or evolving.

---

