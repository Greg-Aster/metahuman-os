# MetaHuman OS → Full Node-Based Architecture Migration Plan

**Status**: Phase 1 In Progress
**Timeline**: 8-12 weeks across 5 phases
**Effort**: 1-2 developers full-time
**Last Updated**: 2025-11-19

---

## Executive Summary

Transform MetaHuman OS from hardcoded TypeScript logic to a fully node-based, graph-driven system (like ComfyUI). **Current state**: 60% infrastructure complete, all critical flows still hardcoded. **Target**: 100% workflows defined as hot-reloadable JSON graphs.

**Benefits**:
- 50% code reduction (TypeScript → JSON)
- 10x deployment frequency (no builds needed)
- 80% faster feature development
- Hot-reloadable configurations
- Community-contributed workflows/plugins

---

## Current State Analysis

### What Already Works ✅

1. **Graph Executor** (`packages/core/src/graph-executor.ts`)
   - Topological sort for execution order
   - Node state tracking (pending/running/completed/failed)
   - Event emission for progress tracking
   - Error handling and propagation

2. **Node Executors** (`packages/core/src/node-executors.ts` - 898 lines)
   - 30+ node types implemented
   - Categories: Input, Router, Context, Operator, Chat, Model, Output
   - Real integration with LLM, skills, memory, audit system

3. **Template Graphs** (`etc/cognitive-graphs/`)
   - `dual-mode.json` - Full operator pipeline (19 nodes, 30 links)
   - `agent-mode.json` - Heuristic routing
   - `emulation-mode.json` - Chat-only mode

4. **Visual Node Editor** (`apps/site/src/components/NodeEditor.svelte`)
   - LiteGraph.js integration
   - Template loading
   - Visual node connections
   - Real-time graph editing

5. **Feature Flags** (`etc/runtime.json`)
   ```json
   {
     "operator": { "reactV2": true },
     "cognitive": { "useNodePipeline": true }
   }
   ```

### What's Still Hardcoded ❌

1. **Conversation Pipeline** (`persona_chat.ts` - 25,000+ tokens)
   - Cognitive mode routing (dual/agent/emulation)
   - Operator eligibility logic
   - Memory grounding decisions
   - Safety validation
   - Response synthesis
   - **Problem**: Graph pipeline exists but falls back to hardcoded logic on errors

2. **Operator/ReAct System** (`operator-react.ts` - 2,679 lines)
   - ReAct loop structure
   - Planning prompts
   - Skill execution
   - Error recovery
   - **Problem**: Entire workflow is imperative TypeScript code

3. **Background Agents** (~3,000 lines total)
   - Dreamer (`brain/agents/dreamer.ts` - 551 lines)
   - Reflector (`brain/agents/reflector.ts` - 609 lines)
   - Curiosity Service (`brain/agents/curiosity-service.ts` - 490 lines)
   - Organizer, Scheduler
   - **Problem**: Memory curation algorithms, LLM prompts, multi-step workflows all hardcoded

4. **Configuration** (persona, trust, cognitive modes)
   - Mode definitions in TypeScript (`cognitive-mode.ts`)
   - Prompts inline in code
   - **Problem**: Changing behavior requires code changes and redeployment

### Missing Node Types (40-50 needed)

**Control Flow** (4 types):
- `LoopController` - ReAct-style iteration with max steps ✅ IMPLEMENTED
- `ConditionalBranch` - If/else routing ✅ IMPLEMENTED
- `Switch` - Multi-way routing ✅ IMPLEMENTED
- `ForEach` - Array iteration ✅ IMPLEMENTED

**Memory Curation** (3 types):
- `WeightedSampler` - Exponential decay weighting
- `AssociativeChain` - Follow keyword connections
- `MemoryFilter` - Filter by type/tags/date range

**Agent-Specific** (3 types):
- `DreamGenerator` - Surreal narrative creation
- `ReflectionGenerator` - Thought pattern analysis
- `CuriosityQuestion` - Question formulation

**Advanced Operator** (4 types):
- `PlanParser` - Parse LLM planning output
- `ScratchpadManager` - Manage ReAct scratchpad state
- `ErrorRecovery` - Smart retry with suggestions
- `StuckDetector` - Detect failure loops

**Utilities** (4 types):
- `JSONParser` - Extract JSON from LLM responses
- `TextTemplate` - String interpolation
- `DataTransform` - Map/filter/reduce operations
- `Cache` - Store intermediate results

---

## Migration Plan: 5 Phases

## 📦 Phase 1: Complete Node Infrastructure (2-3 weeks)

**Goal**: Fill all gaps in node types so every hardcoded operation has a node equivalent

**Status**: 🟡 IN PROGRESS (Control flow nodes done)

### Deliverables

#### 1.1 Control Flow Nodes ✅ DONE
- [x] `LoopController` - Implements ReAct-style iteration with max steps
- [x] `ConditionalBranch` - If/else routing based on conditions
- [x] `Switch` - Multi-way routing (like cognitive mode router)
- [x] `ForEach` - Array iteration for batch operations

#### 1.2 Memory Curation Nodes ⏳ TODO
- [ ] `WeightedSampler` - Exponential decay weighting for memory selection
- [ ] `AssociativeChain` - Follow keyword connections between memories
- [ ] `MemoryFilter` - Filter by type/tags/date range

#### 1.3 Advanced Operator Nodes ⏳ TODO
- [ ] `PlanParser` - Parse structured planning output from LLM
- [ ] `ScratchpadManager` - Manage ReAct scratchpad state
- [ ] `ErrorRecovery` - Smart retry with contextual suggestions
- [ ] `StuckDetector` - Detect failure loops

#### 1.4 Utility Nodes ⏳ TODO
- [ ] `JSONParser` - Extract JSON from LLM responses
- [ ] `TextTemplate` - String interpolation with variables
- [ ] `DataTransform` - Map/filter/reduce operations
- [ ] `Cache` - Store intermediate results

#### 1.5 Node Validation System ⏳ TODO
- [ ] JSON schemas for all node types
- [ ] Runtime validation before execution
- [ ] Comprehensive test suite

### Success Criteria
- ✅ All 40-50 missing node types implemented and tested
- ✅ TypeScript compilation passes with no errors
- ✅ All nodes have comprehensive JSDoc comments
- ✅ Test coverage >80% for all new nodes

---

## 💬 Phase 2: Conversation Pipeline Migration (2-3 weeks)

**Goal**: Make graph pipeline production-ready, remove hardcoded fallback

**Status**: ⏳ NOT STARTED (waiting for Phase 1 completion)

### Week 1: Fix Existing Graphs
- [ ] Debug dual-mode.json end-to-end
- [x] Fix CoT stripper executor (DONE - added robust string extraction)
- [x] Fix safety validator executor (DONE - added robust string extraction)
- [ ] Add comprehensive error handling to all nodes
- [ ] Test all cognitive modes via graphs

### Week 2: Complete Agent/Emulation Graphs
- [ ] Implement heuristic routing as nodes (agent mode)
- [ ] Verify chat-only flow (emulation mode)
- [ ] Add missing context/memory nodes
- [ ] Test edge cases and error paths

### Week 3: Remove Hardcoded Fallback
- [ ] Delete legacy code from `persona_chat.ts` (15,000+ lines)
- [ ] Make graph execution mandatory (no fallback)
- [ ] Add graph execution monitoring/telemetry
- [ ] Set up alerts for graph execution failures

### Files to Change
- `apps/site/src/pages/api/persona_chat.ts` - Remove legacy logic
- `etc/cognitive-graphs/dual-mode.json` - Complete and validate
- `etc/cognitive-graphs/agent-mode.json` - Complete and validate
- `etc/cognitive-graphs/emulation-mode.json` - Complete and validate

### Success Criteria
- ✅ All cognitive modes work via graphs only
- ✅ No fallback to hardcoded logic
- ✅ Response latency <200ms overhead vs. legacy baseline
- ✅ Zero graph execution errors in production
- ✅ Comprehensive logging/monitoring in place

---

## 🤖 Phase 3: Agent Workflow Migration (2-3 weeks)

**Goal**: Convert all background agents to graph-based workflows

**Status**: ⏳ NOT STARTED (waiting for Phase 2 completion)

### Agents to Migrate (in priority order)

#### 3.1 Organizer (Week 1 - Simplest)
- Memory enrichment (tag extraction, entity detection)
- Graph: `etc/agent-graphs/organizer.json`
- Nodes needed: LLM call, memory update, tag extraction

#### 3.2 Reflector (Week 1-2 - Medium)
- Associative memory chain → reflection LLM → capture
- Graph: `etc/agent-graphs/reflector.json`
- Nodes needed: WeightedSampler, AssociativeChain, ReflectionGenerator

#### 3.3 Curiosity Service (Week 2 - Medium)
- Weighted sampling → question generation → user prompt
- Graph: `etc/agent-graphs/curiosity.json`
- Nodes needed: WeightedSampler, CuriosityQuestion, ChatInjector

#### 3.4 Dreamer (Week 2-3 - Complex)
- Multi-step: sample memories → generate dream → extract learning
- Graph: `etc/agent-graphs/dreamer.json`
- Nodes needed: WeightedSampler, DreamGenerator, LearningExtractor

#### 3.5 Inner Curiosity (Week 3 - Complex)
- Question generation → self-answering → capture
- Graph: `etc/agent-graphs/inner-curiosity.json`
- Nodes needed: CuriosityQuestion, SemanticSearch, ResponseSynthesizer

### New Features
- [x] Hot-reload: Edit agent graph, changes apply immediately
- [ ] Visual debugging: See agent execution in node editor
- [ ] Agent monitoring: Real-time stats in web UI
- [ ] Agent execution history: Track all runs

### Files to Change
- `brain/agents/organizer.ts` - Convert to graph executor call
- `brain/agents/reflector.ts` - Convert to graph executor call
- `brain/agents/dreamer.ts` - Convert to graph executor call
- `brain/agents/curiosity-service.ts` - Convert to graph executor call
- Create: `etc/agent-graphs/*.json` (5 new graph templates)

### Success Criteria
- ✅ All 5 agents converted to graphs
- ✅ Behavior identical to legacy (validated via regression tests)
- ✅ Hot-reload works (<1 second)
- ✅ Agent execution visible in audit trail
- ✅ Visual debugging in node editor functional

---

## ⚙️ Phase 4: Configuration Migration (1-2 weeks)

**Goal**: Move all hardcoded configs to JSON, enable hot-reload

**Status**: ⏳ NOT STARTED (waiting for Phase 3 completion)

### 4.1 Cognitive Modes (Week 1)

**Create**: `etc/cognitive-modes.json`

**Structure**:
```json
{
  "modes": {
    "dual": {
      "id": "dual",
      "label": "Dual Consciousness",
      "description": "Deep cognitive mirroring with continuous recording...",
      "graphTemplate": "etc/cognitive-graphs/dual-mode.json",
      "defaults": {
        "recordingEnabled": true,
        "proactiveAgents": true,
        "trainingPipeline": "dual_trigger",
        "memoryWriteLevel": "full"
      },
      "guidance": [
        "Continuous recording of all interactions",
        "Synchronize persona with human consciousness",
        "Training data actively collected"
      ]
    },
    "agent": {
      "id": "agent",
      "label": "Agent Mode",
      "description": "Intelligent routing between chat and operator...",
      "graphTemplate": "etc/cognitive-graphs/agent-mode.json",
      "defaults": {
        "recordingEnabled": true,
        "proactiveAgents": false,
        "trainingPipeline": "agent_trigger",
        "memoryWriteLevel": "full"
      }
    },
    "emulation": {
      "id": "emulation",
      "label": "Emulation Mode",
      "description": "Stable personality snapshot, chat-only...",
      "graphTemplate": "etc/cognitive-graphs/emulation-mode.json",
      "defaults": {
        "recordingEnabled": false,
        "proactiveAgents": false,
        "trainingPipeline": "none",
        "memoryWriteLevel": "read_only"
      }
    }
  },
  "currentMode": "dual"
}
```

### 4.2 LLM Prompts (Week 1-2)

**Create**: `etc/prompts/` directory

**Extract all inline prompts**:
- `etc/prompts/reflector-system.txt`
- `etc/prompts/reflector-user.txt`
- `etc/prompts/dreamer-system.txt`
- `etc/prompts/curiosity-system.txt`
- `etc/prompts/operator-planner.txt`
- `etc/prompts/operator-synthesizer.txt`
- ... (15-20 total prompt files)

**Template System**:
```typescript
// Load prompt with variable interpolation
const prompt = await loadPrompt('reflector-system', {
  personaName: persona.identity.name,
  communicationStyle: persona.communicationStyle,
  recentMemories: memoriesText
});
```

### 4.3 Model Routing (Already Done ✅)
- `etc/models.json` exists and works

### Files to Change
- Delete: Mode definitions from `packages/core/src/cognitive-mode.ts`
- Create: `etc/cognitive-modes.json`
- Create: `etc/prompts/*.txt` (15-20 prompt files)
- Create: `packages/core/src/prompt-loader.ts` (new utility)
- Update: All code to load from configs instead of hardcoded

### Success Criteria
- ✅ All mode definitions in JSON
- ✅ Hot-reload works for mode/prompt changes
- ✅ Config validation prevents invalid changes
- ✅ Documentation updated with new config structure

---

## 🔌 Phase 5: Plugin System (2 weeks)

**Goal**: Allow users to add custom nodes via plugins

**Status**: ⏳ NOT STARTED (waiting for Phase 4 completion)

### 5.1 Plugin Infrastructure (Week 1)

**Features**:
1. Plugin directory: `brain/plugins/`
2. Plugin manifest: `plugin.json`
3. Auto-discovery: Scan on startup
4. Validation: Check compatibility
5. Hot-load: Add/remove without restart

**Example Plugin Structure**:
```
brain/plugins/my-custom-node/
  plugin.json          - Manifest (name, version, nodes)
  executor.ts          - Node implementation
  schema.json          - Input/output schema
  README.md            - Documentation
  test.ts              - Unit tests
```

**Plugin Manifest** (`plugin.json`):
```json
{
  "name": "my-custom-node",
  "version": "1.0.0",
  "description": "My awesome custom node",
  "author": "Community Member",
  "metahumanVersion": ">=1.0.0",
  "nodes": [
    {
      "type": "custom/my_node",
      "name": "My Custom Node",
      "category": "custom",
      "description": "Does something amazing",
      "executor": "./executor.ts",
      "schema": "./schema.json"
    }
  ]
}
```

### 5.2 Example Plugins (Week 2)

**Create 3+ example plugins**:
1. **Twitter Integration** - Post reflections to Twitter
2. **Email Digester** - Generate daily summary emails
3. **GitHub Monitor** - Track repository activity

### Files to Create
- `packages/core/src/plugin-loader.ts` - Plugin discovery and loading
- `packages/core/src/plugin-validator.ts` - Plugin validation
- `docs/PLUGIN_DEVELOPMENT.md` - Plugin development guide
- `brain/plugins/examples/twitter/` - Example plugin
- `brain/plugins/examples/email-digest/` - Example plugin
- `brain/plugins/examples/github-monitor/` - Example plugin

### Success Criteria
- ✅ Users can add custom nodes
- ✅ Plugins load on startup
- ✅ Plugin validation prevents crashes
- ✅ 3+ example plugins in docs
- ✅ Plugin registry UI in node editor

---

## Risk Mitigation

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Graph execution overhead | High | Medium | Benchmark and optimize executor, add caching layer |
| Missing node types block features | Medium | Medium | Prioritize critical nodes, allow temporary code fallback |
| Hot-reload causes crashes | Medium | High | Validate before reload, atomic updates, rollback on error |
| Graph debugging difficult | High | Medium | Add graph trace visualization, step debugger, execution logs |
| Complex node composition | Medium | High | Create higher-level composite nodes, visual templates |

### User Experience Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Users break system with invalid graphs | High | High | Validation, safe defaults, graph linting, undo/redo |
| Graph editor too complex | Medium | Medium | Provide templates, visual tutorials, guided mode |
| Performance regression | Medium | High | Benchmark, optimize, add performance monitoring alerts |
| Lost functionality during migration | Low | High | Comprehensive testing, rollback plan, dual-track period |

### Development Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Scope creep (too many node types) | High | Medium | Ruthless prioritization, use composite nodes |
| Difficult to test all graph combinations | High | Medium | Property-based testing, generated test cases |
| Team velocity drops during migration | Medium | Medium | Phased rollout, maintain dual-track temporarily |
| Documentation falls behind | High | Low | Document as you build, auto-gen from node schemas |

---

## Success Metrics

### Technical Metrics
- **Graph Execution Success Rate**: >99.9% (no fallbacks)
- **Response Latency**: <200ms overhead vs. hardcoded baseline
- **Hot-Reload Time**: <1 second
- **Node Coverage**: 100% of hardcoded logic converted to nodes
- **Test Coverage**: >90% for all node executors
- **Code Reduction**: >50% reduction in TypeScript LOC

### User Experience Metrics
- **Graph Template Adoption**: >5 community-created graphs in 3 months
- **Plugin Adoption**: >3 community plugins in 6 months
- **User-Reported Bugs**: <5 per month post-migration
- **Documentation Completeness**: 100% of nodes documented

### Development Metrics
- **Deployment Frequency**: 10x increase (JSON changes don't need builds)
- **Time to Add Feature**: 80% reduction (graph editing vs. coding)
- **Contributor Onboarding**: 50% faster (non-developers can contribute graphs)
- **Breaking Changes**: <1 per month (stable node API)

---

## Timeline & Milestones

```
Week 1-3:   Phase 1 (Node Infrastructure)
            ├─ Week 1: Control flow nodes ✅
            ├─ Week 2: Memory curation + operator nodes
            └─ Week 3: Utility nodes + validation

Week 4-6:   Phase 2 (Conversation Pipeline)
            ├─ Week 4: Fix existing graphs
            ├─ Week 5: Complete agent/emulation graphs
            └─ Week 6: Remove legacy code

Week 7-9:   Phase 3 (Agent Workflows)
            ├─ Week 7: Organizer + Reflector
            ├─ Week 8: Curiosity + Dreamer
            └─ Week 9: Inner Curiosity + polish

Week 10-11: Phase 4 (Configuration)
            ├─ Week 10: Cognitive modes + prompts
            └─ Week 11: Testing + validation

Week 12:    Phase 5 (Plugin System)
            └─ Week 12: Plugin infrastructure + examples
```

**Total: 12 weeks (conservative) or 8 weeks (aggressive)**

---

## Next Steps

### Immediate (This Week)
1. [x] Create project plan document
2. [x] Implement control flow nodes (LoopController, ConditionalBranch, Switch, ForEach)
3. [ ] Implement memory curation nodes
4. [ ] Set up regression testing framework
5. [ ] Create telemetry for graph execution

### Short-term (Next 2 Weeks)
1. [ ] Complete all missing node types
2. [ ] Begin Phase 2: Fix dual-mode graph end-to-end
3. [ ] Document architecture decisions
4. [ ] Set up monitoring/alerts

### Medium-term (Next Month)
1. [ ] Complete Phase 2: Graph pipeline production-ready
2. [ ] Begin Phase 3: Migrate first 2 agents
3. [ ] Create plugin system design doc

---

## Decision Log

### Decision 1: Migration Speed (PENDING)
**Options**: Aggressive (8 weeks) vs. Conservative (12 weeks)
**Decision**: TBD - Waiting for user input
**Rationale**: TBD

### Decision 2: Node Type Strategy (PENDING)
**Options**: Build all upfront vs. Incremental vs. Composite nodes
**Decision**: TBD - Waiting for user input
**Rationale**: TBD

### Decision 3: Backward Compatibility (PENDING)
**Options**: Dual-track until Phase 5 vs. Remove legacy in Phase 2
**Decision**: TBD - Waiting for user input
**Rationale**: TBD

### Decision 4: Migration Order (PENDING)
**Options**: As proposed vs. Different priority
**Decision**: TBD - Waiting for user input
**Rationale**: TBD

### Decision 5: Performance (PENDING)
**Options**: Optimize heavily upfront vs. Get working first
**Decision**: TBD - Waiting for user input
**Rationale**: TBD

---

## References

- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Detailed technical architecture
- [docs/AUTHENTICATION_STREAMLINED.md](./AUTHENTICATION_STREAMLINED.md) - Auth system docs
- [etc/cognitive-graphs/](../etc/cognitive-graphs/) - Current graph templates
- [packages/core/src/graph-executor.ts](../packages/core/src/graph-executor.ts) - Graph execution engine
- [packages/core/src/node-executors.ts](../packages/core/src/node-executors.ts) - Node implementations

---

**Document Version**: 1.0
**Last Updated**: 2025-11-19
**Author**: Claude (Sonnet 4.5) + Greg (greggles)
**Status**: Living document - updated as migration progresses
