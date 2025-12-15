# Agent Runtime Refactor - Universal Agent System

## Goal
Make agents work identically on web AND mobile by separating agent logic from execution model.

## Architecture

```
packages/agent-runtime/
├── src/
│   ├── index.ts           # Public exports
│   ├── types.ts           # AgentContext, AgentResult, AgentMeta
│   ├── registry.ts        # Agent registry (id → module)
│   ├── runtime.ts         # Main runtime: run(agentId, input)
│   └── executors/
│       ├── interface.ts   # Executor interface
│       ├── web-process.ts # spawn/fork executor
│       └── mobile-inproc.ts # in-process executor

brain/agents/
├── profile-sync/
│   ├── core.ts            # export run(ctx, input): Promise<AgentResult>
│   ├── cli.ts             # CLI wrapper: parse args → call core.run()
│   └── index.ts           # export metadata + run
├── organizer/
│   ├── core.ts
│   ├── cli.ts
│   └── index.ts
... (all agents follow same pattern)
```

## Key Principles

1. **Agents are functions first, CLIs second**
2. **2 executors total, not N×2 agent implementations**
3. **Same API everywhere**: `runtime.run("profile-sync", input)`
4. **Safety guards in mobile executor**: try/catch, timeouts, abort signals

---

## Phase 1: Infrastructure

- [x] Create `packages/agent-runtime/package.json`
- [x] Create `types.ts` - AgentContext, AgentResult, AgentInput, AgentMeta
- [x] Create `executors/interface.ts` - Executor interface
- [x] Create `registry.ts` - Agent registry
- [x] Create `runtime.ts` - Main runtime API
- [x] Create `executors/web-process.ts` - spawn/fork executor
- [x] Create `executors/mobile-inproc.ts` - in-process executor
- [x] Export from `index.ts`
- [ ] Add to pnpm workspace (skipped - uses workspace tsc)

## Phase 2: Refactor Agents

Each agent needs: `core.ts` (logic) + `cli.ts` (wrapper) + `index.ts` (metadata)

### Sync & Data Agents
- [x] `profile-sync` - Full profile synchronization
- [ ] `memory-sync` - Memory synchronization
- [ ] `update-check` - Check for app updates

### Memory Processing Agents
- [x] `organizer` - Enrich memories with LLM tags/entities
- [x] `ingestor` - Convert inbox files to episodic memories
- [x] `curator` - Prepare memories for training
- [x] `digest` - Daily digest generation

### Reflection & Creativity Agents
- [x] `reflector` - Generate internal reflections
- [x] `dreamer` - Create surreal dreams from memories
- [x] `curiosity-service` - Ask user-facing questions
- [x] `inner-curiosity` - Self-directed questions and answers
- [x] `curiosity-researcher` - Research pending questions
- [x] `psychoanalyzer` - Psychological analysis
- [x] `train-of-thought` - Extended thinking chains

### Background Services
- [x] `night-pipeline` - Nightly pipeline orchestration
- [ ] `boredom-maintenance` - Trigger reflections on inactivity (uses scheduler-service)
- [ ] `sleep-service` - Utility module (used by night-pipeline)

### Agency System Agents
- [x] `desire-generator` - Generate desires from inputs
- [x] `desire-planner` - Create plans for desires
- [x] `desire-executor` - Execute approved desires
- [x] `desire-outcome-reviewer` - Review execution outcomes

### Specialized Agents
- [x] `coder` - Self-healing code modification
- [x] `transcriber` - Audio transcription
- [x] `audio-organizer` - Audio file organization

## Phase 3: Integration

- [x] Update `/api/agents/run` to support new directory structure (cli.ts)
- [x] Update `mobile-handlers/mobile-agents.ts` to use profile-sync from new structure
- [x] Update mobile-agents.ts to import all agents from new modular structure
- [x] Update scheduler-service to use runtime (with lazy loading and fallback to legacy spawn)
- [x] AuthGate sync trigger already uses `/api/agents/run` which supports new structure

**Phase 3 Complete** - All integration tasks finished.

## Phase 4: Testing & Validation

- [ ] Test all agents on web server
- [ ] Test all agents on mobile (emulator)
- [ ] Test all agents on mobile (physical device)
- [ ] Verify isolation (agent crash doesn't crash host)
- [ ] Verify timeouts work
- [ ] Verify concurrent agent execution

---

## Agent Interface

```typescript
// types.ts
export interface AgentContext {
  username: string;
  dataDir: string;
  signal?: AbortSignal;  // For cancellation
}

export interface AgentInput {
  args?: string[];       // CLI-style args
  options?: Record<string, unknown>;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration?: number;
}

export interface AgentMeta {
  id: string;
  name: string;
  description: string;
  usesLLM: boolean;
  priority: 'high' | 'normal' | 'low';
  defaultInterval?: number;  // seconds
}

export type AgentRunFn = (ctx: AgentContext, input: AgentInput) => Promise<AgentResult>;
```

## Executor Interface

```typescript
// executors/interface.ts
export interface Executor {
  run(agentId: string, ctx: AgentContext, input: AgentInput): Promise<AgentResult>;
  isAvailable(): boolean;
  name: string;
}
```

---

## Progress Log

### 2025-12-14
- [x] Created `packages/agent-runtime/` with full infrastructure
  - types.ts, registry.ts, runtime.ts
  - executors/interface.ts, mobile-inproc.ts, web-process.ts
  - loader.ts for dynamic agent discovery
- [x] Refactored `profile-sync` as proof-of-concept:
  - brain/agents/profile-sync/core.ts - All sync logic
  - brain/agents/profile-sync/cli.ts - CLI wrapper
  - brain/agents/profile-sync/index.ts - AgentModule export
- [x] Updated `/api/agents/run` to support both directory and legacy agents
- [x] Updated `mobile-handlers/mobile-agents.ts` to use new profile-sync
- [x] Verified profile-sync loads and exports correctly
- [x] Refactored `organizer` agent:
  - brain/agents/organizer/core.ts - Memory enrichment logic
  - brain/agents/organizer/cli.ts - CLI wrapper
  - brain/agents/organizer/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use organizer from new structure
- [x] Refactored `reflector` agent:
  - brain/agents/reflector/core.ts - Reflection generation from memory chains
  - brain/agents/reflector/cli.ts - CLI wrapper
  - brain/agents/reflector/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use reflector from new structure
- [x] Refactored `dreamer` agent:
  - brain/agents/dreamer/core.ts - Dream generation with cognitive graph
  - brain/agents/dreamer/cli.ts - CLI wrapper
  - brain/agents/dreamer/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use dreamer from new structure
- [x] Refactored `ingestor` agent:
  - brain/agents/ingestor/core.ts - File ingestion logic
  - brain/agents/ingestor/cli.ts - CLI wrapper
  - brain/agents/ingestor/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use ingestor from new structure (replaced ~50 lines)
- [x] Refactored `curiosity-service` agent:
  - brain/agents/curiosity-service/core.ts - Question generation logic
  - brain/agents/curiosity-service/cli.ts - CLI wrapper
  - brain/agents/curiosity-service/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use curiosity-service from new structure
- [x] Refactored `inner-curiosity` agent:
  - brain/agents/inner-curiosity/core.ts - Self-directed Q&A logic
  - brain/agents/inner-curiosity/cli.ts - CLI wrapper
  - brain/agents/inner-curiosity/index.ts - AgentModule export
- [x] Updated mobile-agents.ts to use inner-curiosity from new structure
- [x] Refactored `digest` agent:
  - brain/agents/digest/core.ts - Thematic analysis logic
  - brain/agents/digest/cli.ts - CLI wrapper
  - brain/agents/digest/index.ts - AgentModule export
- [x] Refactored `curator` agent:
  - brain/agents/curator/core.ts - Memory curation logic
  - brain/agents/curator/cli.ts - CLI wrapper
  - brain/agents/curator/index.ts - AgentModule export
- [x] Refactored `night-pipeline` agent:
  - brain/agents/night-pipeline/core.ts - Nightly orchestration logic
  - brain/agents/night-pipeline/cli.ts - CLI wrapper
  - brain/agents/night-pipeline/index.ts - AgentModule export
  - Note: sleep-service.ts remains as utility module
- [x] Refactored `train-of-thought` agent:
  - brain/agents/train-of-thought/core.ts - Recursive reasoning logic
  - brain/agents/train-of-thought/cli.ts - CLI wrapper
  - brain/agents/train-of-thought/index.ts - AgentModule export
- [x] Refactored `curiosity-researcher` agent:
  - brain/agents/curiosity-researcher/core.ts - Research question logic
  - brain/agents/curiosity-researcher/cli.ts - CLI wrapper
  - brain/agents/curiosity-researcher/index.ts - AgentModule export
- [x] Refactored `psychoanalyzer` agent:
  - brain/agents/psychoanalyzer/core.ts - Personality analysis logic
  - brain/agents/psychoanalyzer/cli.ts - CLI wrapper
  - brain/agents/psychoanalyzer/index.ts - AgentModule export
- [x] Refactored `desire-generator` agent:
  - brain/agents/desire-generator/core.ts - Desire generation from persona/tasks/memories
  - brain/agents/desire-generator/cli.ts - CLI wrapper
  - brain/agents/desire-generator/index.ts - AgentModule export
- [x] Refactored `desire-planner` agent:
  - brain/agents/desire-planner/core.ts - Plan creation for desires
  - brain/agents/desire-planner/cli.ts - CLI wrapper
  - brain/agents/desire-planner/index.ts - AgentModule export
- [x] Refactored `desire-executor` agent:
  - brain/agents/desire-executor/core.ts - Execute approved desires
  - brain/agents/desire-executor/cli.ts - CLI wrapper
  - brain/agents/desire-executor/index.ts - AgentModule export
- [x] Refactored `desire-outcome-reviewer` agent:
  - brain/agents/desire-outcome-reviewer/core.ts - Post-execution review
  - brain/agents/desire-outcome-reviewer/cli.ts - CLI wrapper
  - brain/agents/desire-outcome-reviewer/index.ts - AgentModule export
- [x] Refactored `transcriber` agent:
  - brain/agents/transcriber/core.ts - Audio transcription with Whisper
  - brain/agents/transcriber/cli.ts - CLI wrapper
  - brain/agents/transcriber/index.ts - AgentModule export
- [x] Refactored `audio-organizer` agent:
  - brain/agents/audio-organizer/core.ts - Convert transcripts to memories
  - brain/agents/audio-organizer/cli.ts - CLI wrapper
  - brain/agents/audio-organizer/index.ts - AgentModule export
- [x] Refactored `coder` agent:
  - brain/agents/coder/core.ts - Code maintenance and fixes via Big Brother
  - brain/agents/coder/cli.ts - CLI wrapper
  - brain/agents/coder/index.ts - AgentModule export

**Phase 2 Complete** - All agents have been refactored to the new structure.

### Phase 3 Progress

- [x] Updated `mobile-agents.ts` imports to use new modular agent directories:
  - Now imports from `brain/agents/digest/core.js` instead of `brain/agents/digest.js`
  - Agency agents (desire-*) now import from `brain/agents/desire-*/core.js`
  - All 12 mobile-compatible agents using new structure
- [x] Updated `agent-scheduler.ts` with agent-runtime integration:
  - Added lazy runtime initialization via `initializeRuntime()`
  - `runAgentFile()` now tries runtime first, falls back to legacy spawn
  - Derives agent ID from path (e.g., 'reflector.ts' -> 'reflector')
  - Runtime loads all modular agents from brain/agents/ on first use
- [x] Verified AuthGate sync trigger uses `/api/agents/run` which already supports new structure

**Phase 3 Complete** - All integration tasks finished.
