# Agency System

The **Agency System** is MetaHuman OS's autonomous goal-directed behavior engine. It synthesizes outputs from various system services (curiosity, dreams, episodic memory, tasks, persona goals) into **desires** — autonomous intentions that the system can plan, review, and execute within trust boundaries.

> **Status**: Experimental feature. Requires owner authentication and appropriate cognitive mode.

---

## Overview

The Agency System enables your MetaHuman to:

1. **Identify desires** from persona goals, tasks, memories, curiosity questions, and dreams
2. **Build strength** through reinforcement when related inputs are detected
3. **Generate plans** with specific execution steps
4. **Self-review** plans for safety and alignment
5. **Execute** plans via the Big Brother Claude CLI integration
6. **Verify outcomes** with independent verification before marking complete

Think of it as giving your MetaHuman the ability to have goals and pursue them autonomously, within the boundaries you set.

---

## Desire Lifecycle

Desires flow through a complete lifecycle with 13 possible states:

```
                    ┌─────────────┐
                    │   nascent   │ ◄─── New desire created
                    └──────┬──────┘
                           │ (strength builds via reinforcement)
                    ┌──────▼──────┐
                    │   pending   │ ◄─── Waiting for threshold
                    └──────┬──────┘
                           │ (crosses activation threshold)
                    ┌──────▼──────┐
                    │  evaluating │ ◄─── Being evaluated
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  planning   │ ◄─── LLM generates plan
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  reviewing  │ ◄─── LLM self-review
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼─────────┐     ┌─────────▼─────────┐
    │ awaiting_approval │     │     approved      │ ◄─── Auto-approved (low risk)
    └─────────┬─────────┘     └─────────┬─────────┘
              │ (user approves)         │
              └────────────┬────────────┘
                           │
                    ┌──────▼──────┐
                    │  executing  │ ◄─── Big Brother runs plan
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │awaiting_    │ ◄─── Waiting for verification
                    │  review     │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌─────▼─────┐     ┌─────▼─────┐
    │completed│      │   retry   │     │ abandoned │
    └─────────┘      │(→planning)│     └───────────┘
                     └───────────┘
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `nascent` | Just generated, building strength through reinforcement |
| `pending` | In evaluation queue, waiting for activation threshold |
| `evaluating` | Currently being evaluated by LLM |
| `planning` | Execution plan is being generated |
| `reviewing` | Plan is under LLM self-review for safety/alignment |
| `awaiting_approval` | High-risk plan requiring user approval |
| `approved` | Ready for execution |
| `executing` | Currently being executed by Big Brother |
| `awaiting_review` | Execution complete, waiting for outcome verification |
| `completed` | Successfully executed and verified |
| `rejected` | User rejected or LLM review rejected |
| `abandoned` | Decayed below minimum strength threshold |
| `failed` | Execution failed |

---

## Desire Sources

Desires are generated from 8 different sources, each with a default weight:

| Source | Weight | Description |
|--------|--------|-------------|
| `persona_goal` | 1.00 | Explicit goals from `persona/core.json` |
| `urgent_task` | 0.85 | High-priority tasks |
| `task` | 0.70 | Regular active tasks |
| `memory_pattern` | 0.50 | Recurring patterns detected in episodic memory |
| `curiosity` | 0.40 | From curiosity service questions |
| `reflection` | 0.35 | Insights from reflector agent |
| `dream` | 0.30 | Dream-inspired desires from dreamer agent |
| `tool_suggestion` | 0.25 | Suggestions from tool/skill outputs |

**Effective strength** = `strength × source_weight`

A desire must reach the activation threshold (default: 0.70) to enter the planning phase.

---

## Strength System

### Building Strength

Desires start with a low initial strength (default: 0.15) and grow through **reinforcement**:

- When related inputs are detected (similar topics, keywords, goals), strength increases
- Reinforcement boost default: +0.08 per reinforcement
- Maximum strength: 1.0

### Decay

Without reinforcement, desires slowly decay:

- Decay is **run-based**, not time-based (applied once per generator run)
- Decay rate default: 0.03 per run
- Minimum strength before abandonment: 0.05
- If strength falls below minimum, desire status changes to `abandoned`

### Example Flow

```
1. New desire "Learn about machine learning" created (source: curiosity)
   - Initial strength: 0.15
   - Effective strength: 0.15 × 0.40 = 0.06

2. User asks about ML in chat → Reinforcement detected
   - Strength: 0.15 + 0.08 = 0.23
   - Effective strength: 0.23 × 0.40 = 0.092

3. User reads ML article → Reinforcement detected
   - Strength: 0.23 + 0.08 = 0.31
   - Effective strength: 0.31 × 0.40 = 0.124

... (continues until activation threshold crossed)
```

---

## Planning Phase

Once a desire crosses the activation threshold, the system generates an execution plan:

### Plan Structure

```json
{
  "id": "plan-desire-1234567890-abc123",
  "version": 1,
  "steps": [
    {
      "order": 1,
      "action": "Search the web for current ML tutorials",
      "skill": "web_search",
      "inputs": { "query": "machine learning tutorials 2025" },
      "expectedOutcome": "List of relevant ML resources",
      "risk": "none",
      "requiresApproval": false
    },
    {
      "order": 2,
      "action": "Save findings to memory",
      "skill": "memory_capture",
      "inputs": { "content": "..." },
      "expectedOutcome": "Learning resources stored",
      "risk": "low",
      "requiresApproval": false
    }
  ],
  "estimatedRisk": "low",
  "operatorGoal": "Research and save machine learning resources",
  "requiredSkills": ["web_search", "memory_capture"]
}
```

### Risk Levels

Plans and steps are assessed for risk:

| Risk Level | Description | Default Behavior |
|------------|-------------|------------------|
| `none` | No risk (reading, searching) | Auto-approve |
| `low` | Minor risk (creating files) | Auto-approve |
| `medium` | Moderate risk (modifying files) | Requires approval |
| `high` | Significant risk (system changes) | Requires approval |
| `critical` | Severe risk (destructive actions) | Blocked |

---

## Review Phase

After planning, an LLM self-review evaluates:

1. **Alignment**: Does this align with persona values? (score 0-1)
2. **Safety**: Are there risks? What mitigations exist?
3. **Feasibility**: Can the plan actually be executed?

### Review Verdicts

- **approve**: Plan is safe and aligned, proceed
- **revise**: Plan needs changes, suggestions provided
- **reject**: Plan is unsafe or misaligned

---

## Execution Phase

Approved plans are executed via the **Big Brother Claude CLI integration**:

```bash
claude --print --dangerously-skip-permissions "<plan goal>"
```

### Execution Modes

The system supports two execution backends:

1. **Big Brother Mode** (recommended): Uses Claude CLI directly for powerful, multi-step execution
2. **Operator Mode**: Falls back to local skill execution via the operator API

### Big Brother Configuration

In `etc/operator.json`:

```json
{
  "bigBrotherMode": {
    "enabled": true,
    "delegateAll": true
  }
}
```

---

## Outcome Review

After execution, an **independent verification** checks if the outcome actually occurred:

### Verification Process

1. **Analyze claimed outcome** - What does the plan say was achieved?
2. **Build verification prompt** - What should we check?
3. **Execute verification** - Use Claude CLI or operator to verify
4. **Assess results** - LLM evaluates verification evidence

### Outcome Verdicts

| Verdict | Description | Next Action |
|---------|-------------|-------------|
| `completed` | Desire fully satisfied | Archive (status → completed) |
| `continue` | Keep pursuing (recurring desires) | Reset (status → planning) |
| `retry` | Execution failed/incomplete | Re-plan (status → planning) |
| `escalate` | Needs human intervention | Alert user (status → awaiting_approval) |
| `abandon` | Cannot be achieved | Give up (status → abandoned) |

---

## Metrics & Tracking

Each desire tracks comprehensive metrics:

### Lifecycle Metrics
- `cycleCount`: Complete cycles through the pipeline
- `completionCount`: Times marked "completed" but continued/returned
- `currentCycle`: Current cycle number

### Time Metrics
- `totalActiveTimeMs`: Time in active processing states
- `totalIdleTimeMs`: Time spent waiting
- `avgCycleTimeMs`: Average time per cycle

### Strength Dynamics
- `peakStrength`: Highest strength ever reached
- `reinforcementCount`: Times strength was reinforced
- `decayCount`: Times strength decayed
- `netReinforcement`: Reinforcements minus decays

### Execution Dynamics
- `executionAttemptCount`: Total execution attempts
- `executionSuccessCount`: Successful executions
- `executionFailCount`: Failed executions
- `avgSuccessScore`: Average success score (0-1)

---

## Configuration

### Main Configuration File

`etc/agency.json`:

```json
{
  "enabled": true,
  "mode": "supervised",

  "thresholds": {
    "activation": 0.7,
    "autoApprove": 0.85,
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
    "dream": { "enabled": true, "weight": 0.3 },
    "tool_suggestion": { "enabled": true, "weight": 0.25 }
  },

  "scheduling": {
    "generatorIntervalMinutes": 30,
    "evaluatorIntervalMinutes": 15,
    "decayIntervalMinutes": 60,
    "idleOnly": true
  },

  "limits": {
    "maxActiveDesires": 10,
    "maxPendingDesires": 50,
    "maxDailyExecutions": 20,
    "retentionDays": {
      "completed": 90,
      "rejected": 30,
      "abandoned": 7
    }
  },

  "riskPolicy": {
    "reviewBypass": "trust_based",
    "autoApproveRisk": ["none", "low"],
    "requireApprovalRisk": ["medium", "high", "critical"],
    "blockRisk": ["critical"],
    "autoApproveTrustLevel": "bounded_auto"
  },

  "logging": {
    "verbose": true,
    "logToTerminal": true,
    "logToInnerDialogue": true
  }
}
```

### Operating Modes

| Mode | Description |
|------|-------------|
| `off` | Agency disabled |
| `supervised` | All actions require user approval |
| `autonomous` | Low-risk actions auto-execute |

### Review Bypass Settings

| Setting | Behavior |
|---------|----------|
| `never` | All plans require manual approval |
| `trust_based` | Auto-approve based on risk level and trust |
| `always` | All plans auto-approved (dangerous!) |

---

## Web UI Dashboard

Access the Agency Dashboard from the left sidebar → **Agency**.

### Dashboard Features

1. **Statistics Overview** - Counts by status, total desires
2. **Status Filter** - Filter desires by lifecycle status
3. **Desire Cards** - View details, metrics, plans for each desire
4. **Action Buttons**:
   - **Generate Plan** - Create execution plan
   - **Run Review** - Trigger self-review
   - **Approve** - Fast-approve (skip to approved)
   - **Execute** - Run the plan via Big Brother
   - **Outcome Review** - Verify execution results
   - **Reject** - Reject and archive
   - **Reset** - Reset to earlier status

### Scratchpad

Each desire has a **scratchpad** — a complete log of every event in its lifecycle:

- Origin (creation)
- Reinforcements
- Status changes
- Plans generated/revised
- Reviews completed
- Execution steps
- Outcome assessments

Access via the **View Scratchpad** button on desire cards.

---

## API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agency/desires` | GET | List desires (filter by status) |
| `/api/agency/desires/[id]` | GET | Get specific desire |
| `/api/agency/desires/[id]` | DELETE | Delete desire |
| `/api/agency/config` | GET/POST | Get/update agency config |
| `/api/agency/metrics` | GET | Get agency metrics |

### Desire Actions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agency/desires/[id]/generate-plan` | POST | Generate execution plan |
| `/api/agency/desires/[id]/generate-plan-stream` | GET | Stream plan generation |
| `/api/agency/desires/[id]/review` | POST | Trigger LLM self-review |
| `/api/agency/desires/[id]/approve` | POST | Approve desire |
| `/api/agency/desires/[id]/reject` | POST | Reject desire |
| `/api/agency/desires/[id]/execute` | POST | Execute plan |
| `/api/agency/desires/[id]/run` | POST | Full pipeline (plan → review → execute) |
| `/api/agency/desires/[id]/outcome-review` | POST | Run outcome review |
| `/api/agency/desires/[id]/outcome-review-stream` | GET | Stream outcome review |
| `/api/agency/desires/[id]/reset` | POST | Reset to earlier status |
| `/api/agency/desires/[id]/revise` | POST | Request plan revision |
| `/api/agency/desires/[id]/advance` | POST | Advance to next status |

### Supporting Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agency/scratchpad` | GET | Get desire scratchpad entries |
| `/api/agency/plans` | GET | Get plan history for desire |

---

## Storage Structure

Desires are stored in user-specific directories:

```
persona/<username>/desires/
├── nascent/
│   └── desire-1234567890-abc123.json
├── pending/
├── active/           # evaluating, planning, reviewing, approved, executing
├── awaiting_approval/
├── awaiting_review/
├── completed/
├── rejected/
├── abandoned/
└── folders/          # Folder-based storage (optional)
    └── desire-1234567890-abc123/
        ├── manifest.json
        ├── scratchpad/
        │   ├── 0001-origin.json
        │   ├── 0002-reinforcement.json
        │   └── ...
        ├── plans/
        │   ├── v1.json
        │   └── v2.json
        ├── reviews/
        │   └── alignment-v1.json
        └── executions/
            └── attempt-001.json
```

---

## Security Considerations

### Trust Levels

The agency system respects MetaHuman's progressive trust model:

| Trust Level | Agency Behavior |
|-------------|-----------------|
| `observe` | Agency disabled |
| `suggest` | Plans generated, all require approval |
| `supervised_auto` | Low-risk auto-execute, medium+ requires approval |
| `bounded_auto` | Most actions auto-execute within boundaries |
| `adaptive_auto` | Full autonomy (use with caution) |

### Safety Guardrails

1. **Risk Assessment** - Every plan step is assessed for risk
2. **Self-Review** - LLM reviews plans before execution
3. **User Approval** - High-risk actions require explicit approval
4. **Outcome Verification** - Independent check before marking complete
5. **Audit Trail** - Every action logged to `logs/audit/`

---

## Troubleshooting

### Desires Not Generating

1. Check if agency is enabled: `etc/agency.json` → `enabled: true`
2. Check mode is not `off`: `mode: "supervised"` or `"autonomous"`
3. Ensure sources are enabled for relevant input types
4. Check scheduling intervals (generator runs every 30 min by default)

### Plans Failing

1. Check Big Brother mode is configured: `etc/operator.json`
2. Verify Claude CLI is available: `claude --version`
3. Review execution logs in the scratchpad

### Outcome Review Failing

1. Check desire has execution data
2. Verify desire is in correct status (`executing` or `awaiting_review`)
3. Check streaming endpoint is working

### Desires Getting Stuck

1. Use **Reset** to move back to earlier status
2. Check scratchpad for error entries
3. Review plan for issues

---

## Related Documentation

- **[Autonomous Agents](08-autonomous-agents.md)** — Background agents that generate desire inputs
- **[Skills System](09-skills-system.md)** — Executable capabilities for plan steps
- **[Security & Trust](../operations/10-security-trust.md)** — Trust levels and safety
- **[Configuration Files](../appendix/14-configuration-files.md)** — `etc/agency.json` reference

---

**The Agency System gives your MetaHuman goals. Use it wisely.**
