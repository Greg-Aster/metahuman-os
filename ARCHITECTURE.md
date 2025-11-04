# MetaHuman OS — Technical Architecture

## System Overview

MetaHuman OS is a personal operating system that creates an autonomous digital personality extension. It operates as a persistent runtime with multiple subsystems working in concert to observe, learn, decide, and act on your behalf.

## Core Architecture Principles

1. **Event-Driven**: All state changes flow through an event bus for auditability
2. **Modular**: Each subsystem is independent with clear interfaces
3. **Local-First**: All computation and storage local by default, cloud optional
4. **Observable**: Complete instrumentation and logging of all operations
5. **Fail-Safe**: Graceful degradation, rollback, and human escalation
6. **Extensible**: Plugin architecture for skills, agents, and integrations

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interfaces                         │
│  CLI • Web Dashboard • Mobile App • API • Notifications     │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                         │
│  Command Router • Query Interface • Action Executor         │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    OS Kernel                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Identity   │  │    Memory    │  │   Decision   │     │
│  │    Kernel    │  │   Manager    │  │    Engine    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Process    │  │     Sync     │  │    Policy    │     │
│  │  Scheduler   │  │    Engine    │  │   Enforcer   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   System Services                           │
│  Memory Service • Agent Runtime • Skill Registry            │
│  Event Bus • Logger • Vector Search • LLM Adapter          │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Storage Layer                             │
│  File System (JSON) • Vector Index (JSON) • Logs           │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Map (Current)

- `packages/core` — Core library (ESM): identity, memory, audit, paths, LLM/embeddings, agent monitor, policy utils
- `packages/cli` — CLI entry (`mh`) via `tsx`, commands for `agent`, `task`, `remember`, `ollama`, `audio`, etc.
- `brain/agents` — Long‑running/background agents (e.g., `organizer.ts`, `reflector.ts`, `sleep-service.ts`)
- `apps/site` — Astro + Svelte Web UI integrating `@metahuman/core`
- `persona`, `memory`, `logs`, `out` — User‑owned runtime data
- `bin/` — Helper scripts: `mh`, `audit`, model/audio helpers

## Core Components

### 1. Identity Kernel

**Purpose**: Maintains the canonical representation of your identity, personality, and preferences.

**Structure**:
```typescript
interface IdentityKernel {
  persona: PersonaModel;        // Core personality traits
  values: ValueSystem;          // What you care about, prioritize
  goals: GoalTree;              // Short/medium/long-term objectives
  relationships: RelationshipGraph;  // People and interaction patterns
  routines: RoutineMap;         // Habits, patterns, energy cycles
  decisionRules: PolicySet;     // Heuristics and boundaries
}
```

**Operations**:
- `load()`: Initialize persona from storage
- `update(field, value)`: Update aspect of identity
- `query(context)`: Get relevant identity info for decision
- `version()`: Track identity evolution over time

### 2. Memory Manager

**Purpose**: Unified interface to all memory subsystems with fast retrieval.

**Memory Types**:
- **Episodic**: Time-ordered events, conversations, observations
- **Semantic**: Facts, knowledge, entities, relationships
- **Procedural**: Workflows, scripts, how-to knowledge
- **Preference**: Learned choices, style, priorities

**Structure**:
```typescript
interface MemoryManager {
  episodic: EpisodicMemory;
  semantic: SemanticMemory;
  procedural: ProceduralMemory;
  preferences: PreferenceCache;

  // Unified query interface
  search(query: Query): Memory[];
  store(memory: Memory): void;
  relate(m1: Memory, m2: Memory, type: string): void;
  consolidate(): void;  // Periodic memory optimization
}
```

**Storage Strategy (Current)**:
- Filesystem JSON for episodic/tasks/preferences (user-owned)
- Vector embeddings: JSON index under `memory/index/`
- Logs and audit: NDJSON under `logs/`

### 3. Process Scheduler

**Purpose**: Manages background agents, triggers, and autonomous processes.

**Components**:
```typescript
interface ProcessScheduler {
  agents: Map<AgentId, Agent>;      // Running agents
  triggers: Trigger[];              // Event-driven activations
  schedule: CronSchedule;           // Time-based routines

  spawn(agent: Agent): AgentId;
  kill(agentId: AgentId): void;
  pause(agentId: AgentId): void;
  on(event: Event, handler: Handler): void;
}
```

**Agent Lifecycle**:
1. **Spawn**: Load agent, allocate resources, start execution
2. **Run**: Execute with resource limits (CPU, memory, time)
3. **Pause/Resume**: Suspend for higher priority tasks
4. **Kill**: Clean shutdown, persist state, release resources

**Example Agents**:
- `morning-brief`: Daily summary generation (7am)
- `email-monitor`: Check inbox, flag urgent (every 30min)
- `calendar-sync`: Update tasks from calendar changes (on event)
- `opportunity-scanner`: Find relevant info across sources (every 2hr)

### 4. Decision Engine

**Purpose**: Make choices based on policies, context, and learned preferences.

**Decision Process**:
```typescript
interface DecisionEngine {
  decide(situation: Context, options: Option[]): Decision;
  explain(decision: Decision): Explanation;
  confident(decision: Decision): boolean;
}

// Decision flow
1. Gather context (situation, goals, constraints, history)
2. Apply policies (rules, boundaries, trust level)
3. Evaluate options (score, rank, filter)
4. Check confidence (is this certain enough?)
5. Make choice or escalate to human
6. Log reasoning and execute
```

**Policy Types**:
- **Hard rules**: Never violate (security, ethics, legal)
- **Soft preferences**: Guide but not absolute
- **Learned heuristics**: Inferred from your behavior
- **Contextual**: Vary by situation, time, people

### 5. Sync Engine

**Purpose**: Bidirectional learning between human and digital personality extension.

**Sync Modes**:

**Passive Observation**:
- Monitor activities (terminal, browser, editor, calendar)
- Capture decisions and outcomes
- Build behavioral model over time

**Active Feedback**:
- Explicit corrections: "No, do X instead"
- Approvals: Confirm suggested actions
- Teaching: Explain reasoning for decisions

**Pattern Learning**:
- Recurring choices → preferences
- Success outcomes → reinforce strategy
- Failures → update model, avoid repetition

**Continuous Alignment**:
```typescript
interface SyncEngine {
  observe(event: Event): void;           // Passive capture
  feedback(correction: Feedback): void;  // Active learning
  align(): void;                         // Periodic model update
  drift(): number;                       // Measure sync accuracy
}
```

### 6. Policy Enforcer

**Purpose**: Ensure all actions respect trust boundaries and safety constraints.

**Enforcement Layers**:
1. **Capability Check**: Does agent have permission?
2. **Trust Boundary**: Is this within autonomous scope?
3. **Risk Assessment**: What's the potential impact?
4. **Rate Limiting**: Prevent runaway behavior
5. **Approval Gate**: Escalate if needed

```typescript
interface PolicyEnforcer {
  canExecute(action: Action, agent: Agent): boolean;
  requiresApproval(action: Action): boolean;
  riskLevel(action: Action): RiskLevel;
  enforce(action: Action): EnforceResult;
}
```

## System Services

### Memory Service
- Filesystem‑backed JSON stores for episodic, tasks, etc.
- Optional vector index (JSON under `memory/index/`) for semantic search
- Memory consolidation and archival performed by agents

### Agent Runtime
- Execute skills and background processes
- Resource isolation and limits
- Error handling and recovery

### Skill Registry
- Discover and load available skills
- Validate manifests and permissions
- Dependency management

### Event Bus
- Pub/sub for all system events
- Enables loose coupling between components
- Complete audit trail

### LLM Adapter
- Pluggable interface for language models
- Local models (Ollama, LM Studio) and cloud APIs
- Prompt management and caching

### LLM & Embeddings (Current)
- Ollama client in `@metahuman/core/ollama` for local models
- Embeddings via Ollama (fallback mock provider for dev)
- Vector index persisted as JSON in `memory/index/` (`@metahuman/core/vector-index`)

### Logging & Audit (Current)
- Append‑only NDJSON logs in `logs/audit/` (see `@metahuman/core/audit`)
- Agent run logs and metrics in `logs/run/agents`
- Console wrapper (`initGlobalLogger`) mirrors console output into audit stream

## Data Flow Examples

### Example 1: Capturing an Observation
```
User: mh capture "Met with Sarah about the ML project"
  ↓
CLI → Command Router
  ↓
Memory Manager.store({
  type: 'episodic',
  timestamp: now,
  content: "Met with Sarah about the ML project",
  entities: ['Sarah', 'ML project'],
  tags: ['meeting', 'work']
})
  ↓
Memory Service → Filesystem JSON (+ vector index if enabled)
  ↓
Event Bus → broadcast('memory.added')
  ↓
Sync Engine → update relationship(Sarah), context(ML project)
```

### Example 2: Autonomous Decision
```
Agent: email-monitor (background)
  ↓
Detect: Urgent email from boss
  ↓
Decision Engine.decide({
  situation: 'urgent email',
  options: ['notify', 'draft reply', 'ignore'],
  context: {persona, relationships, current_tasks}
})
  ↓
Policy Enforcer.canExecute('notify')
  ↓ (yes, low-risk, within bounds)
Skill: send-notification
  ↓
Log decision + action
  ↓
Event Bus → broadcast('decision.executed')
```

### Example 3: Daily Brief Generation
```
Scheduler: 7:00 AM trigger
  ↓
Agent: morning-brief.run()
  ↓
Memory Manager.search({
  episodic: last_24_hours,
  tasks: active + upcoming,
  calendar: today_events
})
  ↓
LLM Adapter.generate(prompt: "Daily brief for Greg")
  ↓
Skill: send-notification(brief)
  ↓
Memory Manager.store(generated_brief)
```

## Technology Stack

### Core Runtime
- **Language**: TypeScript (Node.js runtime)
- **Process**: Long-running daemon + CLI
- **IPC**: Unix sockets or HTTP for CLI ↔ daemon

### Storage
- **Structured**: SQLite for relational data
- **Unstructured**: JSON/Markdown files
- **Vector**: Chroma or local vector store
- **Cache**: In-memory LRU cache

### Web UI
- **Framework**: Astro + Svelte
- **Styling**: Tailwind CSS
- **Data**: Read from SQLite + file system
- **Updates**: Server-sent events for real-time

### CLI
- **Parser**: Commander.js or yargs
- **Output**: Rich terminal formatting
- **Config**: YAML configuration files

### LLM Integration
- **Local**: Ollama, LM Studio (default)
- **Cloud**: Anthropic Claude, OpenAI (opt-in)
- **Fallback**: Template-based responses

### Deployment
- **Local**: systemd service or launchd agent
- **Container**: Docker for isolation (optional)
- **Mobile**: Notifications via ntfy, Pushover, or Signal

## Security & Privacy

### Data Protection
- All data stored locally by default
- Encryption at rest (SQLite encryption extension)
- Secure credential storage (OS keychain)
- No telemetry, no cloud sync unless explicit

### Permission Model
- Skills declare required permissions in manifest
- User approves on first use
- Revocable at any time
- Scoped access (read-only, specific paths, etc.)

### Audit Trail
- Every decision logged with full context
- Every action recorded with timestamp
- Immutable log storage
- Regular human review prompts

## Next Steps

See [DESIGN.md](DESIGN.md) for the development roadmap and Phase 0 tasks to begin implementation.
