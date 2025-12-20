# AGI Integration Progress

This document tracks progress on creating emergent personality and agency in MetaHuman OS.

**Goal**: Transform the system from a response generator into a proactive, desire-driven AI extension with genuine personality evolution.

---

## The Core Problem

The system generates responses but doesn't develop intentions. The architecture has excellent building blocks (desires, dreams, reflections, learnings) but they operate in silos without feedback loops that create emergent behavior.

**Emergence requires closed feedback loops:**
1. Act → 2. Observe outcomes → 3. Update internal state → 4. Act differently

MetaHuman OS has steps 1-2 but weak 3 and no 4.

---

## The Plan

### Phase 1: Integrate Psychoanalyzer into Sleep Cycle (**DONE**)
The psychoanalyzer already exists and works. Just needed scheduling integration.

### Phase 2: Dream Learnings Review (**RESOLVED**)
The overnight learnings file is kept as a human-readable log for audit purposes.
No machine integration needed - the existing flows are sufficient:
- Dreams → Reflector (included in memory pool)
- Dreams → Psychoanalyzer (analyzes memories including dreams)
- Dreams → LoRA Training (episodic memories)

### Phase 3: Verify Reflection → Desire Pipeline (**DONE**)
Reflections are already processed via `loadReflections()` - verified working.

### Phase 4: Implement Pattern Detection (**DONE**)
Memory pattern detector integrated directly into desire-generator.

### Phase 5: Goal-Task-Desire Integration (**DONE**)
Created bidirectional connections between goals, tasks, and desires.

---

## Completed Work

### 1. Psychoanalyzer Integration into Sleep Cycle (2025-12-19)
**File Modified**: [brain/services/sleep-service.ts](../brain/services/sleep-service.ts)

Added psychoanalyzer to the nightly pipeline after dream generation:
```typescript
// Step 2: Run psychoanalyzer to update persona based on recent memories
await runAgent('psychoanalyzer', 'Analyze recent memories and update persona');
```

**What This Does**:
- Psychoanalyzer analyzes recent memories using psychotherapist model
- Updates 7 persona sections: Big 5 traits, values, interests, goals, context, heuristics, writing style
- Creates archives before changes for stability comparison
- Logs insights to `persona/insights.json`

**Impact**: Closes the persona evolution loop - persona now updates based on actual user behavior.

### 2. Pattern Detection in Desire Generator (2025-12-19)
**File Modified**: [brain/agents/desire-generator/core.ts](../brain/agents/desire-generator/core.ts)

Added `detectMemoryPatterns()` function that analyzes recent memories for recurring themes.

**Pattern Types Detected**:
1. **Tag Frequency** - Tags appearing 3+ times in recent memories
2. **Tag Co-occurrence** - Pairs of tags that appear together 2+ times (e.g., "work + stress")
3. **Time-based Clustering** - Tags that cluster in specific time slots (70%+ in morning/afternoon/evening/night)

**How It Works**:
```
loadRecentMemories(7 days) → detectMemoryPatterns() → MemoryPattern[]
     ↓
formatInputsForPrompt() includes patterns in LLM context
     ↓
LLM identifyDesires() may generate desires with source: 'memory_pattern'
     ↓
Standard desire lifecycle (nascent → reinforcement/decay → pending → active)
```

**Key Point**: Patterns don't bypass the desire system - they feed into it as another source (weight: 0.5). The LLM decides if a pattern warrants a desire, and that desire must grow through reinforcement like any other.

**Example Pattern Output**:
```json
{
  "id": "pattern-pair-0",
  "description": "Connected themes: \"evening + stress\" appear together (4 times)",
  "frequency": 4,
  "relatedMemoryIds": ["mem-1", "mem-2", "mem-3", "mem-4"]
}
```

### 3. Goal-Task-Desire Integration (2025-12-19)
**Files Modified**:
- [brain/agents/desire-executor/core.ts](../brain/agents/desire-executor/core.ts)
- [packages/core/src/memory.ts](../packages/core/src/memory.ts)
- [packages/core/src/identity.ts](../packages/core/src/identity.ts)
- [brain/agents/desire-generator/core.ts](../brain/agents/desire-generator/core.ts)

This closes the final feedback loop: **desires, tasks, and goals now reinforce each other bidirectionally.**

#### 3.1 Desire → Task Creation
When a desire starts executing, a linked task is automatically created:
```typescript
// In desire-executor/core.ts
linkedTaskPath = createTask(desire.title, {
  description: desire.description || desire.plan?.operatorGoal || '',
  status: 'in_progress',
  priority: desire.risk === 'high' ? 'P0' : desire.risk === 'medium' ? 'P1' : 'P2',
  tags: ['agency', `desire:${desire.id}`, desire.source],
});
```
The task is tagged with `desire:<id>` to track the connection.

#### 3.2 Task Completion → Desire Reinforcement
When a task with a `desire:xxx` tag is completed, the linked desire is automatically reinforced:
```typescript
// In memory.ts updateTaskStatus()
if (status === 'done' && task.tags) {
  const desireTag = task.tags.find(t => t.startsWith('desire:'));
  if (desireTag) {
    const desireId = desireTag.replace('desire:', '');
    reinforceLinkedDesire(desireId, task.title); // +0.08 strength
  }
}
```
This creates positive feedback: completing tasks strengthens the desires that spawned them.

#### 3.3 Strong Desire → Goal Proposal
When a desire reaches high strength (>0.9) with 5+ reinforcements, it's proposed as a new goal:
```typescript
// In identity.ts
export const GOAL_PROPOSAL_THRESHOLDS = {
  minStrength: 0.9,
  minReinforcements: 5,
};

export function proposeGoalFromDesire(desire) {
  // Adds goal with status 'proposed' to persona/core.json
  // User can approve/reject via UI or approveProposedGoal()/rejectProposedGoal()
}
```

**New Helper Functions in identity.ts**:
- `proposeGoalFromDesire(desire)` - Create a proposed goal from a strong desire
- `approveProposedGoal(goalId, targetTier)` - Approve and activate a proposed goal
- `rejectProposedGoal(goalId, reason)` - Reject a proposed goal
- `getProposedGoals()` - List all goals awaiting approval

**The Complete Feedback Loop**:
```
Goals (persona/core.json)
   │
   ▼ (inspire desires via persona_goal source, weight: 1.0)
Desires (nascent → pending → active)
   │
   ▼ (when executing, create linked task)
Tasks (with desire:xxx tag)
   │
   ▼ (when completed, reinforce linked desire)
Desires (strength +0.08)
   │
   ▼ (when strength > 0.9 && reinforcements >= 5)
Goals (proposed → approved by user)
```

**Impact**: The system can now:
1. Autonomously create tasks from its desires
2. Learn from task completion (reinforcement)
3. Elevate persistent desires to formal goals
4. Have goals feed back into new desires

---

## Existing Infrastructure (Already Working)

### Reflection → Desire Pipeline
The desire generator DOES process reflections via `loadReflections()`:
- Loads `inner_dialogue` memories with `idle-thought` tag
- Reflections weight: 0.35 in desire source weights
- Located: [brain/agents/desire-generator/core.ts:296](../brain/agents/desire-generator/core.ts#L296)

### Emotional State Layer
Already integrated into persona/drift system:
- `emotionalTone` dimension in drift types
- Big 5 `neuroticism` tracks emotional instability
- Located: [packages/core/src/drift/types.ts](../packages/core/src/drift/types.ts)

### Unified Buffer System
Inner dialogue already influences conversation:
- Buffer notifications trigger SSE updates
- Inner dialogue visible in chat interface

### Dream → Reflection Flow
Dreams are included in reflector's memory pool:
- [brain/agents/reflector/core.ts:175](../brain/agents/reflector/core.ts#L175): "Dreams are creative AI output worth reflecting on"

---

## Architecture Overview

```
User Input → Memory → Dreams → Reflections → Desires ←──→ Goals
     ↓                  ↓           ↓            ↓            ↑
     └──────────────────┼───────────┼────────────┼────────────┘
                        │           │            │
                        ▼           ▼            ▼
                  Psychoanalyzer (updates persona)
                        │
                        ▼
                  LLM Response (shaped by evolved persona)
```

**Goal-Task-Desire Feedback Loop** (NEW):
```
┌─────────────────────────────────────────────────────────────┐
│                    GOAL-TASK-DESIRE LOOP                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Goals (persona/core.json)                                  │
│    │                           ▲                            │
│    │ inspire desires           │ strong desires             │
│    │ (weight: 1.0)             │ become proposed goals      │
│    ▼                           │ (strength > 0.9,           │
│  Desires ──────────────────────┤  5+ reinforcements)        │
│    │                           │                            │
│    │ create linked task        │                            │
│    │ on execution              │ reinforce desire           │
│    ▼                           │ on completion              │
│  Tasks (tagged desire:xxx) ────┘                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Session Log

### 2025-12-19
- Fixed curiosity service input access bugs (handles → indexed access)
- Fixed reflector inner dialogue buffer integration
- Integrated psychoanalyzer into sleep-service nightly pipeline
- Documented existing infrastructure (reflections, emotional state, unified buffer)
- Implemented pattern detection in desire-generator (tag frequency, co-occurrence, time clustering)
- Patterns now feed into LLM for desire generation, following standard desire lifecycle
- **Implemented Goal-Task-Desire Integration**:
  - Desire → Task: Executing desires create linked tasks with `desire:xxx` tags
  - Task → Desire: Completing linked tasks reinforces the source desire (+0.08 strength)
  - Desire → Goal: Strong desires (>0.9, 5+ reinforcements) propose new goals
  - Added helper functions: `proposeGoalFromDesire()`, `approveProposedGoal()`, `rejectProposedGoal()`, `getProposedGoals()`

---

## Analysis Notes

### What Character.AI / Replika Do
- **Continuous Persona Refinement**: Every conversation updates an internal representation
- **Emotional State Modeling**: Moods influence response style
- **Relationship Tracking**: Memory of relationship dynamics shapes behavior
- **Proactive Engagement**: System initiates based on time-of-day and user patterns

### What BabyAGI / AutoGPT Do
- **Task Decomposition Loop**: Goals spawn sub-goals automatically
- **Self-Evaluation**: Agent reviews its own outputs and adjusts
- **Priority Recalculation**: Tasks reorder based on new information
- **Persistent Memory Integration**: Past attempts inform future behavior

### Key Insight
The spark of proactive personality won't come from one change - it requires closing multiple feedback loops so the system can learn from itself. **The good news is: most pieces exist, they just need to be connected.**

---

## Critical File References

| Component | File | Status |
|-----------|------|--------|
| Psychoanalyzer | `brain/agents/psychoanalyzer/core.ts` | Exists, integrated into sleep cycle |
| Sleep Service | `brain/services/sleep-service.ts` | Modified to include psychoanalyzer |
| Desire Generator | `brain/agents/desire-generator/core.ts` | Pattern detection, goal proposal integration |
| Desire Executor | `brain/agents/desire-executor/core.ts` | Creates linked tasks on execution |
| Pattern Detection | `brain/agents/desire-generator/core.ts` | `detectMemoryPatterns()` function |
| Goal Proposal | `packages/core/src/identity.ts` | `proposeGoalFromDesire()` and helpers |
| Task Reinforcement | `packages/core/src/memory.ts` | `reinforceLinkedDesire()` on task completion |
| Reflector | `brain/agents/reflector/core.ts` | Exists, includes dreams |
| Dream Learnings | `packages/core/src/nodes/dreamer/dreamer-learnings-writer.node.ts` | Writes to MD (human log only) |
| Curiosity Service | `brain/agents/curiosity-service/core.ts` | Fixed input access |
| Emotional State | `packages/core/src/drift/types.ts` | Exists in persona |

---

## The Emergence Test

After implementing all phases, we should see:
1. Persona traits updating based on conversation patterns ✓ (psychoanalyzer)
2. New goals appearing in persona/core.json that weren't manually added ✓ (goal proposal)
3. Reflections that reference previous dreams ✓ (reflector includes dreams)
4. Desires forming from reflection patterns ✓ (loadReflections in desire-generator)
5. Pattern-based desires forming spontaneously from repeated experiences ✓ (pattern detection)
6. **Tasks created autonomously from desires** ✓ (desire-executor → createTask)
7. **Task completion reinforcing desires** ✓ (memory.ts → reinforceLinkedDesire)
8. **Strong desires proposing themselves as goals** ✓ (proposeGoalFromDesire)

**All major feedback loops are now closed!**
