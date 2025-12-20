# Agency System

The Agency System is MetaHuman OS's autonomous goal-pursuit engine. It transforms passive response generation into proactive, desire-driven behavior by creating bidirectional feedback loops between **desires**, **tasks**, and **goals**.

---

## Overview

Traditional AI systems respond to prompts. MetaHuman OS develops **intentions**. The Agency System:

1. **Synthesizes desires** from memories, reflections, dreams, and goals
2. **Nurtures desires** through reinforcement and decay
3. **Executes desires** by creating and completing tasks
4. **Evolves goals** by promoting strong desires to persona goals

```
Goals (persona/core.json)
   │
   ▼ (inspire desires, weight: 1.0)
Desires (nascent → pending → active)
   │
   ▼ (create linked task on execution)
Tasks (tagged desire:xxx)
   │
   ▼ (reinforce desire on completion)
Desires (strength +0.08)
   │
   ▼ (when strength > 0.9, 5+ reinforcements)
Goals (proposed → approved by user)
```

---

## Key Concepts

### Desires

A **desire** is an autonomous intention that the system wants to act on. Unlike tasks (which are explicit), desires emerge organically from the system's experiences.

**Desire Sources** (with priority weights):
| Source | Weight | Description |
|--------|--------|-------------|
| `persona_goal` | 1.0 | Explicit goals from persona/core.json |
| `urgent_task` | 0.85 | High-priority tasks (P0, P1) |
| `task` | 0.70 | Regular active tasks |
| `memory_pattern` | 0.50 | Recurring themes in memories |
| `curiosity` | 0.40 | Pending curiosity questions |
| `reflection` | 0.35 | Insights from inner dialogue |
| `dream` | 0.30 | Dream-inspired desires |

**Desire Lifecycle**:
```
nascent → pending → evaluating → planning → reviewing → approved → executing → completed
                                                                           ↓
                                                    abandoned (if decayed) / rejected / failed
```

### Strength & Reinforcement

Desires don't just exist — they grow or fade based on relevance:

- **Initial Strength**: New desires start at 0.15 (configurable)
- **Activation Threshold**: 0.70 (desires must grow to activate)
- **Reinforcement**: +0.08 when related inputs appear
- **Decay**: -0.03 per generator run if not reinforced
- **Abandonment**: Below 0.05 strength

This creates natural selection: desires that align with ongoing experiences grow strong; irrelevant desires fade away.

### Goal-Task-Desire Integration

The Agency System closes the feedback loop with three integrations:

#### 1. Desire → Task Creation

When a desire starts executing, a linked task is automatically created:

```
Desire: "Organize project notes"
    ↓
Task: "Organize project notes" [tags: agency, desire:desire-xxx, memory_pattern]
```

The task is tagged with `desire:<id>` to maintain the connection.

#### 2. Task Completion → Desire Reinforcement

When you complete a task linked to a desire, the desire is reinforced:

```
Task completed: "Organize project notes"
    ↓
Desire "Organize project notes" strength: 0.82 → 0.90 (+0.08)
```

This teaches the system: "This desire led to successful action!"

#### 3. Strong Desire → Goal Proposal

When a desire reaches high strength (>0.9) with 5+ reinforcements, it's automatically proposed as a goal:

```
Desire: "Learn more about AI safety" (strength: 0.92, reinforcements: 7)
    ↓
Proposed Goal: "Learn more about AI safety"
    ↓
User reviews and approves/rejects
    ↓
Active Goal in persona/core.json
```

**Thresholds**:
- Minimum strength: 0.9
- Minimum reinforcements: 5

---

## Configuration

### Agency Configuration (`etc/agency.json`)

```json
{
  "enabled": true,
  "mode": "supervised",
  "thresholds": {
    "activation": 0.7,
    "autoApprove": 0.9,
    "decay": {
      "enabled": true,
      "ratePerRun": 0.03,
      "minStrength": 0.05,
      "reinforcementBoost": 0.08,
      "initialStrength": 0.15
    }
  },
  "sources": {
    "persona_goal": { "enabled": true, "weight": 1.0 },
    "urgent_task": { "enabled": true, "weight": 0.85 },
    "task": { "enabled": true, "weight": 0.7 },
    "memory_pattern": { "enabled": true, "weight": 0.5 },
    "curiosity": { "enabled": true, "weight": 0.4 },
    "reflection": { "enabled": true, "weight": 0.35 },
    "dream": { "enabled": true, "weight": 0.3 }
  },
  "limits": {
    "maxActiveDesires": 10,
    "maxPendingDesires": 50,
    "maxDailyExecutions": 5
  },
  "riskPolicy": {
    "reviewBypass": "trust_based",
    "autoApproveRisk": ["none", "low"],
    "requireApprovalRisk": ["medium", "high"],
    "blockRisk": ["critical"]
  }
}
```

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | true | Master switch for agency system |
| `mode` | supervised | `off`, `supervised`, `autonomous` |
| `thresholds.activation` | 0.7 | Strength needed to activate |
| `thresholds.decay.ratePerRun` | 0.03 | Strength lost per generator cycle |
| `thresholds.decay.reinforcementBoost` | 0.08 | Strength gained on reinforcement |
| `limits.maxActiveDesires` | 10 | Maximum concurrent active desires |
| `limits.maxDailyExecutions` | 5 | Maximum executions per day |

---

## Web UI Integration

### Agency Dashboard

Access the Agency Dashboard via **Left Sidebar → Agency**.

**Dashboard Features**:
- View all desires by status (nascent, pending, active, completed)
- Monitor desire strength and reinforcement history
- Approve/reject desires awaiting approval
- Execute pending desires manually
- View proposed goals and approve/reject them

### Proposed Goals Panel

When desires become strong enough to propose as goals, they appear in the **Proposed Goals** section:

- **Goal**: The desire title
- **Source**: Where it originated (memory_pattern, reflection, etc.)
- **Strength**: Final strength when proposed
- **Reinforcements**: How many times it was reinforced
- **Actions**: Approve (add to persona) or Reject (dismiss)

Approved goals are added to `persona/core.json` and begin influencing future desires.

---

## API Endpoints

### Desires

```bash
# List all desires
GET /api/agency/desires

# Get specific desire
GET /api/agency/desires/{id}

# Execute a desire
POST /api/agency/desires/{id}/execute

# Approve/reject desire
POST /api/agency/desires/{id}/approve
POST /api/agency/desires/{id}/reject
```

### Proposed Goals

```bash
# List proposed goals
GET /api/agency/proposed-goals

# Approve a proposed goal
POST /api/agency/proposed-goals/{id}/approve
{
  "targetTier": "shortTerm" | "midTerm" | "longTerm"
}

# Reject a proposed goal
POST /api/agency/proposed-goals/{id}/reject
{
  "reason": "Optional rejection reason"
}
```

---

## CLI Commands

```bash
# Run the desire generator manually
./bin/mh agent run desire-generator

# Run the desire executor
./bin/mh agent run desire-executor

# View agency status
./bin/mh agency status

# List active desires
./bin/mh agency desires

# Execute a specific desire
./bin/mh agency execute <desire-id>
```

---

## File Storage

Desires are stored in the user's profile:

```
profiles/<username>/persona/desires/
├── nascent/           # New desires building strength
│   └── desire-xxx.json
├── pending/           # Waiting for activation threshold
├── active/            # In planning/review/execution
├── completed/         # Successfully executed
├── rejected/          # User or system rejected
└── abandoned/         # Decayed below threshold
```

**Desire File Structure** (`desire-xxx.json`):
```json
{
  "id": "desire-1734567890-abc123",
  "title": "Organize project documentation",
  "description": "Consolidate scattered notes into structured docs",
  "reason": "Multiple memories mention documentation concerns",
  "source": "memory_pattern",
  "strength": 0.45,
  "baseWeight": 0.5,
  "threshold": 0.7,
  "decayRate": 0.03,
  "reinforcements": 3,
  "runCount": 8,
  "status": "nascent",
  "risk": "low",
  "createdAt": "2024-12-19T10:30:00Z",
  "updatedAt": "2024-12-19T14:45:00Z"
}
```

---

## How It Works

### Desire Generation Cycle

The desire generator runs periodically (configurable in `etc/agents.json`):

1. **Gather Inputs**: Load goals, tasks, memories, reflections, dreams
2. **Detect Patterns**: Find recurring themes in memories
3. **Nurture Existing**: Reinforce or decay current desires
4. **Check Activations**: Move strong desires to pending
5. **Generate New**: Ask LLM to identify new genuine desires
6. **Propose Goals**: Promote qualified desires to goal proposals

### Memory Pattern Detection

The system automatically detects patterns in your memories:

**Tag Frequency**: Tags appearing 3+ times become pattern sources
```
"project-x" appears 5 times → Pattern detected
```

**Tag Co-occurrence**: Tags appearing together 2+ times
```
"work + stress" appear together 4 times → Pattern: "Connected themes"
```

**Time Clustering**: Tags that cluster at certain times
```
"exercise" appears 70% in mornings → Pattern: "Morning activity"
```

These patterns feed into desire generation as `memory_pattern` sources.

### Reinforcement Examples

**Scenario 1: Task Completion**
```
1. You complete task "Review ML papers"
2. Task has tag "desire:desire-xxx"
3. System finds desire "Learn about ML developments"
4. Desire strength: 0.65 → 0.73 (+0.08)
5. Desire now closer to activation threshold (0.70)
```

**Scenario 2: Related Memory**
```
1. You have a conversation about AI ethics
2. Desire generator runs
3. LLM identifies connection to "Explore AI safety" desire
4. Desire reinforced: 0.55 → 0.63
```

**Scenario 3: Goal Proposal**
```
1. Desire "Improve code documentation" reaches 0.92 strength
2. Reinforcement count: 7 (threshold: 5)
3. System proposes as goal with status "proposed"
4. Goal appears in Web UI for your review
5. You approve → Goal added to persona/core.json
6. Future desires can now be inspired by this goal
```

---

## Risk Management

### Risk Levels

| Level | Description | Auto-Approve | Example |
|-------|-------------|--------------|---------|
| `none` | Read-only, information gathering | Yes | Search memories |
| `low` | Reversible actions, local files | Yes | Create draft document |
| `medium` | External comms, data mods | No | Send email |
| `high` | Irreversible, external systems | No | Delete files |
| `critical` | Financial, security, privacy | Blocked | Payment actions |

### Trust-Based Approval

The system uses your trust level to determine automation:

- **observe**: No automatic execution
- **suggest**: Proposes actions, requires approval
- **supervised_auto**: Auto-approves low-risk actions
- **bounded_auto**: Auto-approves medium-risk within limits
- **adaptive_auto**: Learns and expands boundaries

---

## Best Practices

### Nurturing Healthy Desires

1. **Complete linked tasks**: Task completion reinforces desires
2. **Engage with topics**: Related conversations strengthen desires
3. **Review proposed goals**: Accept genuine wants, reject noise
4. **Adjust weights**: Tune source weights for your workflow

### Managing Desire Volume

If too many desires accumulate:
1. Lower `maxPendingDesires` limit
2. Increase `decayRate` for faster pruning
3. Disable low-priority sources
4. Manually reject irrelevant desires

### Debugging Desire Generation

Check the audit log for desire events:
```bash
grep "desire_" logs/audit/$(date +%Y-%m-%d).ndjson
```

Events to look for:
- `desire_generated`: New desire created
- `desire_reinforced`: Desire strength increased
- `desire_activated`: Desire crossed threshold
- `desire_abandoned`: Desire decayed below minimum
- `goal_proposed_from_desire`: Strong desire became goal

---

## Related Documentation

- [Autonomous Agents](autonomous-agents.md) — Background processing agents
- [Persona Editor](../training-personalization/persona-editor.md) — Edit goals directly
- [Task Management](../using-metahuman/task-management.md) — Task system
- [Memory System](../using-metahuman/memory-system.md) — Episodic memory

---

**The Agency System transforms MetaHuman OS from a responder into a pursuer of goals!** 🎯
