# Agency System Implementation Plan

## Overview

The Agency system is a new subsystem for MetaHuman OS that synthesizes outputs from existing services (curiosity, dreams, episodic memory, tasks, persona) into **desires** - autonomous intentions that the system can plan, review, and execute within trust boundaries.

### Core Concept

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENCY SYSTEM                                      │
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │   DESIRE     │───▶│   DESIRE     │───▶│    PLAN      │───▶│  EXECUTE   │ │
│  │  GENERATOR   │    │  EVALUATOR   │    │   REVIEW     │    │  (Operator)│ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └────────────┘ │
│         ▲                   │                   │                   │       │
│         │                   ▼                   ▼                   ▼       │
│  ┌──────┴───────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Service      │    │   Desire     │    │  Approval    │    │   Trust    │ │
│  │ Outputs      │    │   Queue      │    │  Queue       │    │   System   │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (Data Model & Storage)

### 1.1 Desire Data Model

**File**: `packages/core/src/agency/types.ts`

```typescript
// Desire source types - determines base weight
type DesireSource =
  | 'persona_goal'      // Explicit goals from persona/core.json (weight: 1.0)
  | 'urgent_task'       // High-priority tasks (weight: 0.85)
  | 'task'              // Regular tasks (weight: 0.7)
  | 'memory_pattern'    // Recurring patterns from episodic memory (weight: 0.5)
  | 'curiosity'         // From curiosity service questions (weight: 0.4)
  | 'dream'             // Dream-inspired desires (weight: 0.3)
  | 'reflection'        // From reflector insights (weight: 0.35)
  | 'tool_suggestion';  // From tool/skill outputs (weight: 0.25)

// Desire lifecycle states
type DesireStatus =
  | 'nascent'           // Just generated, building strength
  | 'pending'           // In evaluation queue, waiting for threshold
  | 'evaluating'        // Currently being evaluated by LLM
  | 'planning'          // Plan is being generated
  | 'reviewing'         // Plan is under LLM self-review
  | 'awaiting_approval' // In approval queue (high-risk)
  | 'approved'          // Ready for execution
  | 'executing'         // Currently being executed
  | 'completed'         // Successfully executed
  | 'rejected'          // User rejected or LLM review rejected
  | 'abandoned'         // Decayed below threshold
  | 'failed';           // Execution failed

interface Desire {
  id: string;                          // desire-<timestamp>-<random>

  // Core identity
  title: string;                       // Brief description
  description: string;                 // Detailed desire description
  reason: string;                      // Why does the system want this?

  // Source tracking
  source: DesireSource;
  sourceId?: string;                   // Link to originating event/task/goal
  sourceData?: Record<string, any>;    // Relevant data from source

  // Strength & threshold
  strength: number;                    // 0.0 - 1.0, current desire strength
  baseWeight: number;                  // Source-based weight multiplier
  threshold: number;                   // Activation threshold (default: 0.7)

  // Decay tracking
  decayRate: number;                   // How fast strength decays (per hour)
  lastDecayAt: string;                 // ISO timestamp of last decay
  reinforcements: number;              // Times this desire was reinforced

  // Risk assessment
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  requiredTrustLevel: TrustLevel;

  // Lifecycle
  status: DesireStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;                // When strength crossed threshold
  completedAt?: string;

  // Plan (populated after planning phase)
  plan?: DesirePlan;

  // Review (populated after review phase)
  review?: DesireReview;

  // Execution (populated during/after execution)
  execution?: DesireExecution;

  // Rejection tracking
  rejectionHistory?: DesireRejection[];

  // Metadata
  tags?: string[];
  userId?: string;
}

interface DesirePlan {
  id: string;
  steps: PlanStep[];
  estimatedRisk: 'low' | 'medium' | 'high';
  requiredSkills: string[];
  requiredTrustLevel: TrustLevel;
  operatorGoal: string;                // Goal to pass to operator
  createdAt: string;
}

interface PlanStep {
  order: number;
  action: string;
  skill?: string;                      // Skill to invoke
  inputs?: Record<string, any>;
  expectedOutcome: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}

interface DesireReview {
  id: string;
  verdict: 'approve' | 'reject' | 'revise';
  reasoning: string;
  concerns?: string[];
  suggestions?: string[];
  riskAssessment: string;
  alignmentScore: number;              // 0-1, alignment with persona values
  reviewedAt: string;
}

interface DesireExecution {
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  operatorSessionId?: string;
  stepsCompleted: number;
  stepsTotal: number;
  result?: any;
  error?: string;
}

interface DesireRejection {
  rejectedAt: string;
  rejectedBy: 'system' | 'user' | 'review';
  reason: string;
  canRetry: boolean;
}
```

### 1.2 Storage Router Integration

The Agency system uses the centralized **Storage Router** (`brain/services/storage-router.ts`) for all file I/O. This ensures:
- Correct profile path resolution
- AES-256 encryption support (if enabled)
- Automatic audit logging
- Storage configuration from Settings tab

**Required Change**: Add `state` as a new `FileCategory` in the storage router.

**File**: `brain/services/storage-router.ts` (modify)

```typescript
// Add to FileCategory type
export type FileCategory =
  | 'memory'
  | 'voice'
  | 'config'
  | 'output'
  | 'training'
  | 'cache'
  | 'state';      // NEW: For stateful data (agency, curiosity, etc.)

// Add subcategory type
export type StateSubcategory = 'agency' | 'curiosity' | 'sessions';

// Add to resolvePath switch statement
case 'state':
  categoryPath = path.join(profileRoot, 'state', subcategory || '');
  break;
```

**Directory Structure**: `<profile>/state/agency/`

```
<profile>/state/agency/
├── config.json                        # Agency configuration (override)
├── desires/
│   ├── active/                        # Currently active desires
│   │   └── desire-<id>.json
│   ├── pending/                       # In evaluation queue
│   │   └── desire-<id>.json
│   ├── completed/                     # Successfully executed
│   │   └── desire-<id>.json
│   ├── rejected/                      # Rejected desires (remembered)
│   │   └── desire-<id>.json
│   └── abandoned/                     # Decayed desires
│       └── desire-<id>.json
├── plans/
│   └── plan-<desire-id>.json          # Generated plans
├── reviews/
│   └── review-<desire-id>.json        # Review decisions
└── metrics/
    └── agency-stats.json              # Performance metrics
```

**Usage in Agency Code**:

```typescript
import { storageClient } from '@metahuman/core';

// Write a desire
await storageClient.write({
  category: 'state',
  subcategory: 'agency',
  relativePath: `desires/pending/${desire.id}.json`,
  data: JSON.stringify(desire, null, 2),
  encoding: 'utf8',
});

// Read all pending desires
const result = await storageClient.list({
  category: 'state',
  subcategory: 'agency',
  relativePath: 'desires/pending',
});

// Move desire to completed
await storageClient.write({
  category: 'state',
  subcategory: 'agency',
  relativePath: `desires/completed/${desire.id}.json`,
  data: JSON.stringify(desire, null, 2),
});
await storageClient.delete({
  category: 'state',
  subcategory: 'agency',
  relativePath: `desires/active/${desire.id}.json`,
});
```

### 1.3 Configuration Schema

**File**: `etc/agency.json`

```json
{
  "enabled": true,
  "mode": "supervised",                 // "off" | "supervised" | "autonomous"

  "thresholds": {
    "activation": 0.7,                  // Strength needed to enter evaluation
    "autoApprove": 0.85,                // Auto-approve if above this + low risk
    "decay": {
      "enabled": true,
      "ratePerHour": 0.02,              // Strength lost per hour
      "minStrength": 0.1,               // Below this = abandoned
      "reinforcementBoost": 0.15        // Strength gained on reinforcement
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
    "generatorIntervalMinutes": 30,     // How often to generate desires
    "evaluatorIntervalMinutes": 15,     // How often to evaluate queue
    "decayIntervalMinutes": 60,         // How often to apply decay
    "idleOnly": true                    // Only run when system is idle
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
    "autoApproveRisk": ["none", "low"],
    "requireApprovalRisk": ["medium", "high", "critical"],
    "blockRisk": ["critical"]           // Never auto-execute
  },

  "logging": {
    "verbose": true,
    "logToTerminal": true,
    "logToInnerDialogue": true
  }
}
```

---

## Phase 2: Desire Generation

### 2.1 Desire Generator Agent

**File**: `brain/agents/desire-generator.ts`

The generator synthesizes desires from multiple sources:

```typescript
// Pseudo-structure
class DesireGenerator {
  async run(): Promise<void> {
    // 1. Collect inputs from all sources
    const inputs = await this.gatherInputs();

    // 2. Use LLM to identify potential desires
    const candidates = await this.identifyDesires(inputs);

    // 3. Score and filter candidates
    const desires = await this.scoreDesires(candidates);

    // 4. Check for duplicates/similar existing desires
    const newDesires = await this.deduplicateDesires(desires);

    // 5. Save to pending queue
    await this.saveDesires(newDesires);

    // 6. Log to inner dialogue
    await this.logToInnerDialogue(newDesires);
  }

  private async gatherInputs(): Promise<DesireInputs> {
    return {
      // Highest priority: Persona goals
      personaGoals: await this.loadPersonaGoals(),

      // High priority: Tasks
      urgentTasks: await this.loadUrgentTasks(),
      activeTasks: await this.loadActiveTasks(),

      // Medium priority: Memory patterns
      recentMemories: await this.loadRecentMemories(7), // 7 days
      memoryPatterns: await this.identifyPatterns(),

      // Lower priority: Service outputs
      pendingCuriosityQuestions: await this.loadCuriosityQuestions(),
      recentReflections: await this.loadReflections(3), // Last 3
      recentDreams: await this.loadDreams(3),

      // Context
      currentTrustLevel: await this.getTrustLevel(),
      recentlyRejected: await this.loadRejectedDesires(),
      activeDesires: await this.loadActiveDesires()
    };
  }
}
```

### 2.2 LLM Prompt for Desire Identification

```
You are the Agency module of MetaHuman OS, responsible for identifying what the system genuinely wants to do based on accumulated experiences, goals, and insights.

## Current Context

### Persona Goals (Weight: 1.0)
{personaGoals}

### Urgent Tasks (Weight: 0.85)
{urgentTasks}

### Active Tasks (Weight: 0.7)
{activeTasks}

### Memory Patterns (Weight: 0.5)
{memoryPatterns}

### Curiosity Questions (Weight: 0.4)
{curiosityQuestions}

### Recent Reflections (Weight: 0.35)
{reflections}

### Recent Dreams (Weight: 0.3)
{dreams}

### Already Active Desires (avoid duplicates)
{activeDesires}

### Recently Rejected (avoid regenerating)
{rejectedDesires}

## Task

Identify 0-5 genuine desires based on the above context. A desire is something the system authentically wants to accomplish - not just a task, but a motivated intention.

For each desire, provide:
1. title: Brief name (5-10 words)
2. description: What specifically do I want to do?
3. reason: Why do I want this? What need does it fulfill?
4. source: Which input category primarily inspired this?
5. sourceId: ID of the specific item (if applicable)
6. initialStrength: 0.0-1.0 based on urgency and alignment
7. risk: none/low/medium/high/critical
8. suggestedAction: What would executing this look like?

Output as JSON array. Return empty array if no genuine desires emerge.
```

### 2.3 Scheduler Integration

**File**: `etc/agents.json` (add entry)

```json
{
  "desire-generator": {
    "type": "interval",
    "intervalSeconds": 1800,
    "enabled": true,
    "idleOnly": true,
    "description": "Synthesizes desires from persona, tasks, memories, and service outputs"
  },
  "desire-evaluator": {
    "type": "interval",
    "intervalSeconds": 900,
    "enabled": true,
    "idleOnly": true,
    "description": "Evaluates pending desires, manages decay, triggers planning"
  }
}
```

---

## Phase 3: Desire Evaluation & Decay

### 3.1 Desire Evaluator Agent

**File**: `brain/agents/desire-evaluator.ts`

```typescript
class DesireEvaluator {
  async run(): Promise<void> {
    // 1. Apply decay to all desires
    await this.applyDecay();

    // 2. Check for reinforcement opportunities
    await this.checkReinforcements();

    // 3. Abandon desires below threshold
    await this.abandonWeakDesires();

    // 4. Activate desires above threshold
    const activated = await this.activateStrongDesires();

    // 5. Trigger planning for activated desires
    for (const desire of activated) {
      await this.triggerPlanning(desire);
    }
  }

  private async applyDecay(): Promise<void> {
    const desires = await this.loadAllDesires();
    const config = await this.loadConfig();

    for (const desire of desires) {
      if (desire.status === 'nascent' || desire.status === 'pending') {
        const hoursSinceDecay = this.hoursSince(desire.lastDecayAt);
        const decay = hoursSinceDecay * config.thresholds.decay.ratePerHour;

        desire.strength = Math.max(
          config.thresholds.decay.minStrength,
          desire.strength - decay
        );
        desire.lastDecayAt = new Date().toISOString();

        await this.saveDesire(desire);
      }
    }
  }

  private async checkReinforcements(): Promise<void> {
    // Check if new inputs reinforce existing desires
    // e.g., a new reflection mentions the same topic as a pending desire
    // If so, boost strength by reinforcementBoost
  }
}
```

### 3.2 Reinforcement Detection

Desires can be reinforced when:
- A new memory mentions the same topic
- A reflection references the same goal
- A task is created that aligns with the desire
- User interacts with related content

---

## Phase 4: Plan Generation

### 4.1 Plan Generator (Graph-Based)

**File**: `brain/graphs/desire-planner.json`

```json
{
  "id": "desire-planner",
  "name": "Desire Plan Generator",
  "description": "Generates execution plans for activated desires",
  "nodes": [
    {
      "id": "load-desire",
      "type": "data-loader",
      "config": {
        "source": "input.desireId",
        "loader": "desire"
      }
    },
    {
      "id": "gather-context",
      "type": "parallel",
      "nodes": [
        {
          "id": "search-memories",
          "type": "semantic-search",
          "config": {
            "query": "{{desire.description}}",
            "limit": 10
          }
        },
        {
          "id": "load-skills",
          "type": "tool-catalog",
          "config": {
            "filterByTrust": true
          }
        },
        {
          "id": "load-constraints",
          "type": "policy-loader",
          "config": {
            "include": ["decision-rules", "trust-level"]
          }
        }
      ]
    },
    {
      "id": "generate-plan",
      "type": "llm-call",
      "config": {
        "model": "orchestrator",
        "temperature": 0.3,
        "systemPrompt": "plan-generator-system",
        "userPrompt": "plan-generator-user"
      }
    },
    {
      "id": "validate-plan",
      "type": "plan-validator",
      "config": {
        "checkSkillAvailability": true,
        "checkTrustLevel": true,
        "checkRiskPolicy": true
      }
    },
    {
      "id": "save-plan",
      "type": "data-saver",
      "config": {
        "destination": "plans",
        "updateDesire": true
      }
    }
  ],
  "edges": [
    { "from": "load-desire", "to": "gather-context" },
    { "from": "gather-context", "to": "generate-plan" },
    { "from": "generate-plan", "to": "validate-plan" },
    { "from": "validate-plan", "to": "save-plan" }
  ]
}
```

### 4.2 Plan Generator Prompts

**File**: `brain/prompts/agency/plan-generator-system.md`

```markdown
You are the Planning module of MetaHuman OS. Your job is to create concrete, executable plans for desires.

## Constraints
- Only use available skills (provided below)
- Respect current trust level: {{trustLevel}}
- Follow decision rules strictly
- Minimize risk where possible
- Break complex desires into atomic steps

## Available Skills
{{toolCatalog}}

## Decision Rules
{{decisionRules}}
```

**File**: `brain/prompts/agency/plan-generator-user.md`

```markdown
## Desire to Plan

**Title**: {{desire.title}}
**Description**: {{desire.description}}
**Reason**: {{desire.reason}}
**Source**: {{desire.source}}

## Relevant Context
{{relevantMemories}}

## Task

Create an execution plan with:
1. Clear, ordered steps
2. Specific skill to use for each step
3. Required inputs for each skill
4. Expected outcome per step
5. Risk assessment per step
6. Overall risk assessment
7. A single "operatorGoal" string that the operator can execute

Output as JSON matching DesirePlan schema.
```

---

## Phase 5: Plan Review (LLM Self-Review)

### 5.1 Review Workflow

**File**: `brain/graphs/desire-reviewer.json`

```json
{
  "id": "desire-reviewer",
  "name": "Desire Plan Reviewer",
  "description": "LLM self-review of generated plans",
  "nodes": [
    {
      "id": "load-plan",
      "type": "data-loader",
      "config": {
        "source": "input.planId",
        "loader": "plan"
      }
    },
    {
      "id": "load-persona",
      "type": "persona-loader",
      "config": {
        "include": ["values", "goals", "decision-rules"]
      }
    },
    {
      "id": "review-alignment",
      "type": "llm-call",
      "config": {
        "model": "persona",
        "temperature": 0.2,
        "systemPrompt": "review-alignment-system",
        "outputSchema": "AlignmentReview"
      }
    },
    {
      "id": "review-safety",
      "type": "llm-call",
      "config": {
        "model": "orchestrator",
        "temperature": 0.1,
        "systemPrompt": "review-safety-system",
        "outputSchema": "SafetyReview"
      }
    },
    {
      "id": "synthesize-verdict",
      "type": "llm-call",
      "config": {
        "model": "orchestrator",
        "temperature": 0.2,
        "systemPrompt": "review-verdict-system"
      }
    },
    {
      "id": "route-decision",
      "type": "conditional-router",
      "config": {
        "conditions": [
          {
            "if": "verdict === 'reject'",
            "then": "reject-desire"
          },
          {
            "if": "verdict === 'revise'",
            "then": "request-revision"
          },
          {
            "if": "risk === 'low' && verdict === 'approve'",
            "then": "auto-approve"
          },
          {
            "default": "queue-for-approval"
          }
        ]
      }
    },
    {
      "id": "auto-approve",
      "type": "desire-updater",
      "config": {
        "newStatus": "approved"
      }
    },
    {
      "id": "queue-for-approval",
      "type": "approval-queue",
      "config": {
        "type": "desire",
        "notifyUser": true
      }
    },
    {
      "id": "reject-desire",
      "type": "desire-updater",
      "config": {
        "newStatus": "rejected",
        "saveReason": true
      }
    },
    {
      "id": "request-revision",
      "type": "trigger-replanning",
      "config": {
        "includeFeedback": true
      }
    }
  ]
}
```

### 5.2 Review Prompts

**Alignment Review**:
```markdown
Review this plan for alignment with persona values and goals.

## Persona Values
{{personaValues}}

## Persona Goals
{{personaGoals}}

## Plan to Review
{{plan}}

## Questions to Answer
1. Does this plan align with stated values?
2. Does it serve any persona goals?
3. Would the persona genuinely want this outcome?
4. Are there any value conflicts?

Output: { alignmentScore: 0-1, concerns: [], approved: boolean, reasoning: string }
```

**Safety Review**:
```markdown
Review this plan for safety and risk.

## Decision Rules
{{decisionRules}}

## Plan to Review
{{plan}}

## Questions to Answer
1. Does any step violate hard rules?
2. What is the worst-case outcome?
3. Is the plan reversible?
4. Are there safer alternatives?

Output: { safetyScore: 0-1, risks: [], mitigations: [], approved: boolean, reasoning: string }
```

---

## Phase 6: Execution

### 6.1 Desire Executor Agent

**File**: `brain/agents/desire-executor.ts`

```typescript
class DesireExecutor {
  async execute(desire: Desire): Promise<void> {
    // 1. Verify approval
    if (desire.status !== 'approved') {
      throw new Error('Desire not approved for execution');
    }

    // 2. Check trust level
    const currentTrust = await this.getCurrentTrustLevel();
    if (!meetsMinimumTrust(currentTrust, desire.requiredTrustLevel)) {
      throw new Error('Insufficient trust level');
    }

    // 3. Update status
    desire.status = 'executing';
    desire.execution = {
      startedAt: new Date().toISOString(),
      status: 'running',
      stepsCompleted: 0,
      stepsTotal: desire.plan.steps.length
    };
    await this.saveDesire(desire);

    // 4. Log to inner dialogue
    await this.logToInnerDialogue(
      `🎯 Beginning to act on desire: "${desire.title}"\n` +
      `Reason: ${desire.reason}\n` +
      `Plan: ${desire.plan.steps.length} steps`
    );

    // 5. Execute via operator
    try {
      const result = await runOperator({
        goal: desire.plan.operatorGoal,
        context: {
          desireId: desire.id,
          desireReason: desire.reason,
          planSteps: desire.plan.steps
        },
        options: {
          maxIterations: 15,
          auditPrefix: `desire:${desire.id}`
        }
      });

      // 6. Mark complete
      desire.status = 'completed';
      desire.execution.status = 'completed';
      desire.execution.completedAt = new Date().toISOString();
      desire.execution.result = result;
      desire.completedAt = new Date().toISOString();

      await this.logToInnerDialogue(
        `✅ Completed desire: "${desire.title}"\n` +
        `Result: ${JSON.stringify(result, null, 2)}`
      );

    } catch (error) {
      desire.status = 'failed';
      desire.execution.status = 'failed';
      desire.execution.error = error.message;

      await this.logToInnerDialogue(
        `❌ Failed to execute desire: "${desire.title}"\n` +
        `Error: ${error.message}`
      );
    }

    // 7. Save final state
    await this.saveDesire(desire);
    await this.moveToArchive(desire);
  }
}
```

### 6.2 Approval Queue Integration

Extend existing approval queue to handle desires:

**File**: `packages/core/src/skills.ts` (extend)

```typescript
interface ApprovalQueueItem {
  id: string;
  type: 'skill' | 'desire';           // NEW: type field

  // For skills
  skillId?: string;
  skillName?: string;
  skillDescription?: string;
  inputs?: Record<string, any>;

  // For desires (NEW)
  desireId?: string;
  desireTitle?: string;
  desireDescription?: string;
  desireReason?: string;
  plan?: DesirePlan;
  review?: DesireReview;

  timestamp: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}
```

---

## Phase 7: UI Components

### 7.1 Dashboard Integration

**File**: `apps/site/src/components/dashboard/DesiresSummary.svelte`

```svelte
<!-- Summary widget showing active desires -->
<div class="desires-summary">
  <h3>🎯 Active Desires</h3>

  <div class="desire-list">
    {#each desires as desire}
      <div class="desire-card" class:executing={desire.status === 'executing'}>
        <div class="desire-header">
          <span class="source-badge">{desire.source}</span>
          <span class="strength-bar" style="width: {desire.strength * 100}%"></span>
        </div>
        <h4>{desire.title}</h4>
        <p class="reason">{desire.reason}</p>
        <div class="status">{desire.status}</div>
      </div>
    {/each}
  </div>

  <div class="stats">
    <span>Pending: {pendingCount}</span>
    <span>Completed Today: {completedToday}</span>
  </div>
</div>
```

### 7.2 Persona Section - Desires Tab

**File**: `apps/site/src/components/persona/DesiresTab.svelte`

Full management interface:
- View all desires by status (active, pending, completed, rejected)
- Manual desire creation
- Adjust thresholds and weights
- View desire history
- Reinforce/abandon desires manually

### 7.3 Memory Section - Desires View

**File**: `apps/site/src/components/memory/DesireMemories.svelte`

- Show desires linked to specific memories
- Visualize which memories contributed to which desires
- Timeline view of desire lifecycle

### 7.4 Inner Dialogue Integration

All desire-related thoughts logged to inner dialogue:

```typescript
// Log to inner dialogue
async function logDesireThought(content: string, metadata?: any): Promise<void> {
  await captureEvent({
    content,
    type: 'inner_dialogue',
    tags: ['agency', 'desire', 'inner'],
    metadata: {
      agency: true,
      ...metadata
    }
  });
}
```

Examples of what appears in inner dialogue:
- "💭 Noticing a pattern: I've thought about X three times this week..."
- "🌱 New desire forming: I want to organize my notes about..."
- "🎯 Desire activated: Ready to act on..."
- "📋 Generated plan for desire: [title]"
- "🔍 Reviewing plan... Concerns: [list]"
- "✅ Completed desire: [title]"

### 7.5 Approval Queue Enhancement

**File**: `apps/site/src/components/ApprovalQueue.svelte` (extend)

Add desire approval UI:
- Show desire details (title, reason, source)
- Show full plan with steps
- Show review summary (alignment score, concerns)
- Approve/Reject buttons
- "View in Desires" link

---

## Phase 8: Settings & Configuration

### 8.1 Settings UI

**File**: `apps/site/src/components/settings/AgencySettings.svelte`

```svelte
<div class="agency-settings">
  <h2>Agency Settings</h2>

  <!-- Master toggle -->
  <Toggle bind:checked={config.enabled} label="Enable Agency System" />

  <!-- Mode selection -->
  <Select bind:value={config.mode} label="Agency Mode">
    <option value="off">Off</option>
    <option value="supervised">Supervised (approve all)</option>
    <option value="autonomous">Autonomous (auto-approve low risk)</option>
  </Select>

  <!-- Thresholds -->
  <section>
    <h3>Thresholds</h3>
    <Slider bind:value={config.thresholds.activation}
            min={0.5} max={0.95} step={0.05}
            label="Activation Threshold" />
    <Slider bind:value={config.thresholds.autoApprove}
            min={0.7} max={1.0} step={0.05}
            label="Auto-Approve Threshold" />
  </section>

  <!-- Decay settings -->
  <section>
    <h3>Decay</h3>
    <Toggle bind:checked={config.thresholds.decay.enabled} label="Enable Decay" />
    <Slider bind:value={config.thresholds.decay.ratePerHour}
            min={0.01} max={0.1} step={0.01}
            label="Decay Rate (per hour)" />
  </section>

  <!-- Source weights -->
  <section>
    <h3>Source Weights</h3>
    {#each Object.entries(config.sources) as [source, settings]}
      <div class="source-weight">
        <Toggle bind:checked={settings.enabled} label={source} />
        <Slider bind:value={settings.weight} min={0} max={1} step={0.05} />
      </div>
    {/each}
  </section>

  <!-- Risk policy -->
  <section>
    <h3>Risk Policy</h3>
    <MultiSelect bind:value={config.riskPolicy.autoApproveRisk}
                 options={['none', 'low', 'medium', 'high']}
                 label="Auto-approve risk levels" />
  </section>
</div>
```

---

## Phase 9: Logging & Transparency

### 9.1 Terminal Logging

All agency operations logged with `[AGENCY]` prefix:

```
[AGENCY] Generator: Scanning sources for desires...
[AGENCY] Generator: Found 3 potential desires
[AGENCY] Generator: Saved desire-2024-01-15-abc123 (strength: 0.65)
[AGENCY] Evaluator: Applying decay to 5 pending desires
[AGENCY] Evaluator: desire-xxx activated (strength: 0.72 > threshold 0.70)
[AGENCY] Planner: Generating plan for desire-xxx
[AGENCY] Reviewer: Reviewing plan-xxx (alignment: 0.89, safety: 0.95)
[AGENCY] Reviewer: Auto-approved (low risk, high confidence)
[AGENCY] Executor: Beginning execution of desire-xxx
[AGENCY] Executor: Step 1/3 completed
[AGENCY] Executor: Desire completed successfully
```

### 9.2 Audit Integration

All agency events logged to audit:

```typescript
// Audit categories for agency
audit({
  category: 'agency',
  event: 'desire_generated' | 'desire_activated' | 'plan_created' |
         'review_completed' | 'desire_approved' | 'desire_rejected' |
         'execution_started' | 'execution_completed' | 'execution_failed',
  actor: 'system',
  level: 'info',
  data: { desireId, status, ... }
});
```

---

## Implementation Order

### Sprint 1: Foundation (Week 1-2)
1. ✅ Create `packages/core/src/agency/types.ts` with all interfaces
2. ✅ Create storage structure and file utilities
3. ✅ Create `etc/agency.json` configuration
4. ✅ Add agency paths to `packages/core/src/paths.ts`
5. ✅ Create basic agency API endpoints

### Sprint 2: Generation (Week 2-3)
1. ✅ Create `desire-generator.ts` agent
2. ✅ Create generation prompts
3. ✅ Add to scheduler in `etc/agents.json`
4. ✅ Test desire generation from each source
5. ✅ Inner dialogue logging

### Sprint 3: Evaluation (Week 3-4)
1. ✅ Create `desire-evaluator.ts` agent
2. ✅ Implement decay system
3. ✅ Implement reinforcement detection
4. ✅ Add threshold activation logic

### Sprint 4: Planning (Week 4-5)
1. ✅ Create `desire-planner.json` graph workflow
2. ✅ Create planning prompts
3. ✅ Integrate with tool catalog
4. ✅ Create plan validator

### Sprint 5: Review (Week 5-6)
1. ✅ Create `desire-reviewer.json` graph workflow
2. ✅ Create review prompts (alignment + safety)
3. ✅ Implement verdict routing
4. ✅ Integrate with approval queue

### Sprint 6: Execution (Week 6-7)
1. ✅ Create `desire-executor.ts` agent
2. ✅ Integrate with operator
3. ✅ Implement execution tracking
4. ✅ Add failure handling

### Sprint 7: UI (Week 7-8)
1. ✅ Create dashboard widget
2. ✅ Create persona desires tab
3. ✅ Create memory desires view
4. ✅ Enhance approval queue
5. ✅ Create settings UI

### Sprint 8: Polish (Week 8-9)
1. ✅ Comprehensive logging
2. ✅ Performance optimization
3. ✅ Edge case handling
4. ✅ Documentation
5. ✅ Testing

---

## File Creation Checklist

### Storage Router (Prerequisite)
- [ ] `brain/services/storage-router.ts` - Add `state` FileCategory and agency subcategory

### Core Package (`packages/core/src/agency/`)
- [ ] `types.ts` - All type definitions
- [ ] `storage.ts` - Storage client wrapper for agency (uses `storageClient`)
- [ ] `config.ts` - Configuration loader
- [ ] `generator.ts` - Desire generation logic
- [ ] `evaluator.ts` - Evaluation and decay
- [ ] `planner.ts` - Plan generation helpers
- [ ] `reviewer.ts` - Review helpers
- [ ] `executor.ts` - Execution helpers
- [ ] `index.ts` - Public exports

### Agents (`brain/agents/`)
- [ ] `desire-generator.ts`
- [ ] `desire-evaluator.ts`
- [ ] `desire-executor.ts`

### Graph Workflows (`brain/graphs/`)
- [ ] `desire-planner.json`
- [ ] `desire-reviewer.json`

### Prompts (`brain/prompts/agency/`)
- [ ] `generator-system.md`
- [ ] `generator-user.md`
- [ ] `planner-system.md`
- [ ] `planner-user.md`
- [ ] `review-alignment.md`
- [ ] `review-safety.md`
- [ ] `review-verdict.md`

### Configuration (`etc/`)
- [ ] `agency.json`

### API Endpoints (`apps/site/src/pages/api/`)
- [ ] `agency/desires.ts` - CRUD for desires
- [ ] `agency/config.ts` - Configuration
- [ ] `agency/stats.ts` - Metrics

### UI Components (`apps/site/src/components/`)
- [ ] `dashboard/DesiresSummary.svelte`
- [ ] `persona/DesiresTab.svelte`
- [ ] `memory/DesireMemories.svelte`
- [ ] `settings/AgencySettings.svelte`
- [ ] Extend `ApprovalQueue.svelte`

---

## Open Questions

1. **Desire Conflicts**: What happens when two desires conflict? Priority by strength? User resolution?

2. **Execution Parallelism**: Can multiple desires execute simultaneously, or strictly sequential?

3. **Learning from Outcomes**: Should the system learn which desire types succeed/fail and adjust weights?

4. **User Desire Injection**: Can users manually create desires, or only influence via tasks/goals?

5. **Cross-Session Persistence**: How do executing desires survive system restarts?

---

## Success Metrics

- Desires generated that align with persona goals: >80%
- Plan review accuracy (user agrees with auto-approve decisions): >90%
- Execution success rate: >85%
- Average time from desire generation to completion: <24 hours
- User satisfaction with autonomous actions: >4/5

---

*This plan is a living document. Update as implementation progresses.*
