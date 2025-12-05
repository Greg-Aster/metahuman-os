# Desire to Make Desire Work

**Goal**: Make the desire execution system ACTUALLY DO THINGS (not simulate)

## Current Status: ✅ BIG BROTHER ROUTING COMPLETE

---

## Architecture Decision

**ALL execution routes through Big Brother operator system.**

Why:
- Big Brother is intelligent (Claude-based ReAct loop)
- Handles skill selection dynamically
- Provides audit trail and scratchpad
- Unified execution pathway

---

## Tasks

### 1. ✅ [COMPLETE] Route execution through Big Brother operator
- [x] Rewrote `executeStep()` in run.ts to call `/api/operator`
- [x] Removed simulated setTimeout execution
- [x] Operator handles skill selection and execution
- [x] Added deprecation header to prevent direct skill calls

### 2. ✅ [COMPLETE] Create cognitive graph architecture
- [x] Created `desire-executor.node.ts` - node for graph execution
- [x] Created `desire-executor.json` - cognitive graph workflow
- [x] Graph: Load Desire → Execute via BB → Outcome Review → Update State

### 3. ✅ [COMPLETE] Create missing graph nodes
- [x] `outcome-reviewer.node.ts` - Reviews execution outcomes (agency/)
- [x] `scratchpad-writer.node.ts` - Records to desire scratchpad (cognitive/)
- [x] `inner-dialogue-saver.node.ts` - Already existed in cognitive/

### 4. [PENDING] Add plan step editing UI
- [ ] Add edit button on each step
- [ ] Modal to edit step action, skill, inputs
- [ ] Save changes to desire plan

### 5. [PENDING] Record execution results to desire scratchpad
- [ ] Log each step's input/output to desire.scratchpad
- [ ] Show detailed execution log in Journey Log UI

### 6. [PENDING] Test end-to-end desire execution
- [ ] Create desire: "make a test file called hello.txt"
- [ ] Generate plan (should use fs_write skill)
- [ ] Execute via Big Brother and verify file actually exists

---

## Key Files

### Modified
| File | Change |
|------|--------|
| `apps/site/src/pages/api/agency/desires/[id]/run.ts` | Routes through Big Brother operator |
| `apps/site/src/pages/api/agency/desires/[id]/reset.ts` | Reset stuck desires |
| `apps/site/src/components/AgencyDashboard.svelte` | Reset button UI |

### Created (Cognitive Graph)
| File | Purpose |
|------|---------|
| `packages/core/src/nodes/agency/desire-executor.node.ts` | Node: Execute via BB |
| `packages/core/src/nodes/agency/outcome-reviewer.node.ts` | Node: Review outcomes |
| `packages/core/src/nodes/cognitive/scratchpad-writer.node.ts` | Node: Write to scratchpad |
| `etc/cognitive-graphs/desire-executor.json` | Graph workflow |

### Existing Infrastructure
| File | Purpose |
|------|---------|
| `brain/agents/operator-react.ts` | Big Brother ReAct loop |
| `brain/skills/index.ts` | 27 registered skills |
| `packages/core/src/skills.ts` | Skill execution engine |

---

## Execution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DESIRE EXECUTION FLOW                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Desire Approved → run.ts receives request               │
│                           │                                  │
│                           ▼                                  │
│  2. For each plan step:                                      │
│     ┌──────────────────────────────────────┐                │
│     │  executeStep() builds goal + context  │                │
│     └──────────────────────────────────────┘                │
│                           │                                  │
│                           ▼                                  │
│  3. POST /api/operator                                       │
│     ┌──────────────────────────────────────┐                │
│     │  Big Brother ReAct Loop:              │                │
│     │  - Thought: "I need to..."            │                │
│     │  - Action: skill_name + inputs        │                │
│     │  - Observation: result                │                │
│     │  - (repeat until done)                │                │
│     └──────────────────────────────────────┘                │
│                           │                                  │
│                           ▼                                  │
│  4. Step result returned → run.ts continues                 │
│                           │                                  │
│                           ▼                                  │
│  5. All steps done → Outcome Review                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Deprecation Notice

```typescript
// =============================================================================
// ⚠️ DEPRECATED PATTERNS - DO NOT USE
// =============================================================================
// ❌ Direct skill calls: executeSkill(skill, inputs)
// ❌ Direct runReActLoop calls from desire system
// ❌ Simulated execution with setTimeout
//
// ✅ CORRECT: Route through /api/operator
// =============================================================================
```

---

## Progress Log

### 2025-12-04 - Session 1
- Identified simulation problem in run.ts
- Found existing skill system (27 skills ready)
- Found Big Brother operator in brain/agents/operator-react.ts

### 2025-12-04 - Session 2
- Rewrote executeStep() to route through Big Brother operator
- Added deprecation header to run.ts
- Created desire-executor.node.ts for cognitive graphs
- Created desire-executor.json cognitive graph workflow
- Updated this scratchpad with new architecture

### 2025-12-04 - Session 3
- Created `outcome-reviewer.node.ts` - LLM-based outcome evaluation
- Created `scratchpad-writer.node.ts` - Records to desire folder
- Registered both nodes in index files
- Fixed pre-existing bug in `storage.ts` (wrong arg to updateScratchpadSummary)
- ✅ TypeScript compilation passes

### 2025-12-04 - Session 4 (Current)
- Fixed revision/critique pipeline:
  - `revise.ts` - Now allows instructions on desires without plans (pending/nascent)
  - `generate-plan.ts` - Auto-reads `desire.userCritique` for plan generation
  - Both clear `userCritique` after it's been addressed
- Pipeline now supports: New desire → Add instructions → Generate Plan (uses instructions)

### Next Actions
1. Test real execution with "make test file" desire
2. Add step editing UI
