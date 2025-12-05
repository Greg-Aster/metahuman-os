# Agency System Architecture

## Overview

The Agency System enables MetaHuman OS to autonomously pursue goals ("desires") on behalf of the user. It operates through a structured pipeline of planning, execution, and outcome review stages, with trust-based oversight controls.

## Core Concepts

### Desire Lifecycle

```
nascent → pending → planning → reviewing → approved → executing → completed
                ↑                    ↓           ↑              ↓
                └──── (revision) ────┘           └── (retry) ───┘
```

**Stages:**
1. **nascent**: Initial desire captured from user input or agent observation
2. **pending**: Desire validated, waiting for strength threshold
3. **planning**: LLM generating execution plan
4. **reviewing**: Plan awaiting user review (or auto-approved based on trust)
5. **approved**: Plan approved, ready for execution
6. **executing**: Big Brother operator running the plan
7. **completed**: Desire fulfilled (or abandoned/failed)

### Trust Levels

Trust determines autonomy for desire execution:

| Level | Description | Desire Handling |
|-------|-------------|-----------------|
| `observe` | Monitor only | No execution, suggestions only |
| `suggest` | Propose actions | All plans require approval |
| `supervised_auto` | Execute with oversight | Medium+ risk requires approval |
| `bounded_auto` | Autonomy within limits | High/critical risk requires approval |
| `adaptive_auto` | Self-expanding autonomy | Only critical risk requires approval |

### Review Bypass Settings

User-configurable in Settings → Agency:

| Setting | Behavior |
|---------|----------|
| `never` | All plans require manual review |
| `trust_based` | Low risk + high trust = auto-approve |
| `always` | All plans auto-approved (dangerous) |

## Storage Architecture

### Folder Structure

Each user has an isolated agency folder with subfolders per desire:

```
profiles/<username>/agency/desires/
├── <desire-id-1>/
│   ├── scratchpad.json      # Metadata, stage tracking, iterations
│   ├── desire.json          # Core desire object
│   ├── plan-v1.json         # First generated plan
│   ├── plan-v2.json         # Revised plan (if any)
│   ├── execution-log.json   # Operator execution trace
│   └── outcome.json         # Final outcome and review
├── <desire-id-2>/
│   └── ...
└── ...
```

### Scratchpad Schema

Each desire's `scratchpad.json` tracks lifecycle state:

```json
{
  "desireId": "desire-abc123",
  "stage": "planning",
  "version": 1,
  "iterations": {
    "planning": 1,
    "execution": 0,
    "review": 0
  },
  "timestamps": {
    "created": "2025-12-04T10:00:00Z",
    "lastUpdated": "2025-12-04T10:05:00Z",
    "planStarted": "2025-12-04T10:05:00Z",
    "planCompleted": null,
    "executionStarted": null,
    "executionCompleted": null,
    "reviewCompleted": null
  },
  "currentPlanVersion": 1,
  "userCritique": null,
  "critiqueAt": null,
  "reviewBypassed": false,
  "autoApproveReason": null
}
```

## Pipeline Components

### 1. Desire Detection Agent

**Purpose:** Monitors user interactions and generates desires from:
- Explicit user requests ("I want to...")
- Implicit patterns (repeated actions)
- Scheduled triggers (daily reviews, etc.)

**Actions:**
- Generate new desires
- Upgrade existing desires (increase priority/urgency)
- Deprecate stale desires

**Trigger:** Runs on user message analysis, scheduled intervals

### 2. Plan Generator Workflow

**Cognitive Graph:** `etc/cognitive-graphs/desire-planner.json`

**Nodes:**
1. `desire_loader` - Load desire from storage
2. `desire_enricher` - Merge user critique if present
3. `tool_catalog_builder` - Build available skills reference
4. `policy_loader` - Load decision rules and hard rules
5. `semantic_search` - Find relevant memories for context
6. `desire_plan_generator` - LLM generates execution plan
7. `plan_validator` - Validate plan against constraints
8. `desire_updater` - Save plan to desire folder
9. `audit_logger` - Log plan generation event

**Outputs:**
- Updated desire with plan attached
- Plan file saved to desire folder (plan-v{N}.json)
- Scratchpad updated with planning timestamps

### 3. Review Process

**Trust-Based Auto-Approval Logic:**

```
if (reviewSetting === 'always') → auto-approve
if (reviewSetting === 'never') → require review
if (reviewSetting === 'trust_based') {
  if (plan.estimatedRisk in ['none', 'low'] && userTrustLevel >= 'bounded_auto') {
    → auto-approve with reason logged
  } else {
    → require review
  }
}
```

**User Review Interface:**
- Agency tab shows desires awaiting review
- User can: approve, reject, or provide critique
- Critique triggers re-planning with user instructions

### 4. Executor Workflow

**Cognitive Graph:** `etc/cognitive-graphs/desire-executor.json`

**Purpose:** Runs approved plans through Big Brother operator

**Nodes:**
1. `desire_loader` - Load approved desire with plan
2. `execution_context_builder` - Prepare operator context
3. `desire_executor` - ReAct loop execution via /api/operator
4. `execution_logger` - Save step-by-step trace
5. `scratchpad_writer` - Update scratchpad with progress
6. `desire_updater` - Update desire status

**Execution Flow:**
1. Load approved plan
2. For each step in plan:
   - Execute via Big Brother operator
   - Log results to execution-log.json
   - Update scratchpad progress
3. On completion, trigger outcome review

### 5. Outcome Reviewer Workflow

**Cognitive Graph:** `etc/cognitive-graphs/outcome-reviewer.json`

**Purpose:** Evaluates execution results and determines next action

**Verdicts:**
| Verdict | Action |
|---------|--------|
| `completed` | Mark desire as complete, archive |
| `continue` | Execution paused, resume later (recurring desires) |
| `retry` | Re-execute with same plan |
| `loop_back` | Generate new plan (partial success, needs adjustment) |
| `escalate` | Requires user intervention |
| `abandon` | Mark desire as failed |

**Loop Back Flow:**
When outcome reviewer returns `loop_back`:
1. Increment planning iteration in scratchpad
2. Add execution insights to context
3. Trigger plan generator with learned context
4. New plan addresses gaps from previous attempt

## API Endpoints

### Desire Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agency/desires` | GET | List all desires |
| `/api/agency/desires` | POST | Create new desire |
| `/api/agency/desires/[id]` | GET | Get desire details |
| `/api/agency/desires/[id]` | PUT | Update desire |
| `/api/agency/desires/[id]` | DELETE | Delete desire |
| `/api/agency/desires/[id]/generate-plan` | POST | Generate/regenerate plan |
| `/api/agency/desires/[id]/approve` | POST | Approve plan |
| `/api/agency/desires/[id]/reject` | POST | Reject plan |
| `/api/agency/desires/[id]/revise` | POST | Submit critique for revision |
| `/api/agency/desires/[id]/execute` | POST | Execute approved plan |
| `/api/agency/desires/[id]/reset` | POST | Reset stuck desire |

### Configuration

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agency/config` | GET | Get agency configuration |
| `/api/agency/config` | PUT | Update configuration |

## UI Components

### Agency Tab (Left Sidebar)

**Sections:**
1. **Active Desires** - Currently executing
2. **Pending Review** - Awaiting approval
3. **Planning** - Being planned
4. **All Desires** - Full list with filters

**Desire Card:**
- Title and description
- Status badge
- Risk indicator
- Quick actions (approve, reject, view)

### Desire Detail View

**Tabs:**
1. **Overview** - Desire info, status, timeline
2. **Plan** - Current plan with steps
3. **Execution** - Real-time execution log
4. **History** - Previous plans and outcomes

**Actions:**
- Edit desire
- Generate/regenerate plan
- Approve/reject plan
- Submit critique
- Reset if stuck

### Settings → Agency

**Options:**
- Review bypass setting (never/trust_based/always)
- Auto-archive completed desires
- Notification preferences

## Cognitive Graphs

The agency system uses five separate cognitive graph workflows:

| Graph | File | Purpose |
|-------|------|---------|
| **Desire Generator** | `desire-generator.json` | Detects desires from user input, creates folder + scratchpad |
| **Proactive Generator** | `desire-generator-proactive.json` | Analyzes recent memories to find implicit desires |
| **Desire Planner** | `desire-planner.json` | Generates execution plans, validates, updates desire |
| **Desire Executor** | `desire-executor.json` | Runs plans through Big Brother operator |
| **Outcome Reviewer** | `outcome-reviewer.json` | Evaluates results, routes to next action |

## Agency Nodes

| Node ID | Purpose | LLM? |
|---------|---------|------|
| `desire_detector` | LLM-based desire detection from user input | Yes |
| `desire_folder_creator` | Creates folder structure + initial scratchpad | No |
| `desire_memory_analyzer` | Loads unanalyzed memories with scratchpad tracking | No |
| `desire_loader` | Loads desire by ID or status filter | No |
| `desire_enricher` | Merges user critique into desire | No |
| `desire_plan_generator` | LLM generates execution plan | Yes |
| `plan_validator` | Validates plan against constraints | No |
| `desire_alignment_reviewer` | LLM scores alignment with values | Yes |
| `desire_safety_reviewer` | LLM scores safety compliance | Yes |
| `desire_verdict` | Synthesizes reviews into verdict | No |
| `approval_queue` | Adds desire to manual approval queue | No |
| `desire_executor` | Runs plan via Big Brother operator | No |
| `outcome_reviewer` | LLM evaluates execution outcome | Yes |
| `verdict_router` | Routes based on verdict (multi-output) | No |
| `desire_updater` | Persists desire changes | No |

## Implementation Status

### Completed

- [x] Desire CRUD operations
- [x] Basic plan generation via LLM
- [x] Plan storage on desire object
- [x] Approve/reject endpoints
- [x] Revision with user critique
- [x] Big Brother operator integration
- [x] Desire enricher node for critique merging
- [x] Folder-based storage (fully migrated)
- [x] Cognitive graph: `desire-generator.json`
- [x] Cognitive graph: `desire-generator-proactive.json`
- [x] Cognitive graph: `desire-planner.json`
- [x] Cognitive graph: `desire-executor.json`
- [x] Cognitive graph: `outcome-reviewer.json`
- [x] Generator scratchpad for memory tracking
- [x] Memory analysis node (`desire_memory_analyzer`)
- [x] Node: `desire_detector` (LLM-based)
- [x] Node: `desire_folder_creator`
- [x] Node: `verdict_router`

### In Progress

- [ ] Trust-based auto-approval wiring

### Pending

- [ ] Settings UI for review bypass
- [ ] Agency tab in UI
- [ ] Real-time execution display
- [ ] Proactive generator scheduling (run hourly)

## Error Handling

### Stuck Desires

Desires can get stuck due to:
- Failed plan generation (LLM error)
- Execution timeout
- Operator crash

**Resolution:**
1. `/api/agency/desires/[id]/reset` endpoint
2. Resets status to appropriate stage
3. Clears in-progress markers
4. Logs reset event for audit

### Execution Failures

When Big Brother operator fails:
1. Log failure details to execution-log.json
2. Update scratchpad with error
3. Trigger outcome review
4. Outcome reviewer determines: retry, loop_back, escalate, or abandon

## Security Considerations

1. **Trust Boundaries**: Never auto-approve high/critical risk actions
2. **Audit Trail**: All desire operations logged
3. **User Isolation**: Desires stored per-user, no cross-access
4. **Execution Sandboxing**: Operator runs with user's trust level constraints
5. **Critique Validation**: Sanitize user critique input
