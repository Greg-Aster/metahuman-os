# Agency System Architecture

## Overview

The Agency system enables MetaHuman OS to autonomously pursue goals and desires within defined trust boundaries. This document describes the complete architecture, identifies gaps between the original intent and current implementation, and provides a roadmap for fixes.

**Last Updated:** 2025-12-04
**Status:** Phase 2 Complete, Critical Bug Identified

---

## 🚨 CRITICAL ISSUE: False Completion Bug

**Problem:** The Big Brother operator claims success via `conversational_response` skill without actually executing action skills like `fs_write`.

**Root Cause:** In `brain/agents/operator-react.ts` lines 890-903:
```typescript
// Rule 1: conversational_response skill is always terminal
if (lastStep.action === 'conversational_response' && !lastStep.observation.startsWith('Error:')) {
  return true;  // Marks task complete even if no actual action taken!
}
```

**Impact:** Desires that require file operations, web actions, or other skills are marked "completed" when the LLM merely describes what it would do rather than doing it.

**Fix Required:** Add goal-intent validation before marking conversational_response as terminal. See [Fix Plan](#fix-plan-for-false-completion) below.

---

## Original Design Intent

### Core Flow
```
User Content → Desire Agent → Generate/Upgrade/Depreciate Desires
                    ↓
         Threshold Reached?
                    ↓ YES
            Plan Generator → Creates execution plan
                    ↓
        Trust/Risk Check (reviewBypass setting)
           /         \
     SKIP           REQUIRE
          \         /
           Approval Queue ← User edits → Re-plan loop
                    ↓
           Big Brother Executor
                    ↓
          Outcome Reviewer
           /    |      \
    COMPLETE  CONTINUE  RETRY → Back to Planner
```

### Key Requirements (from user)

1. **Desire Lifecycle Management**
   - Desire agent triggers on user content
   - Reviews content, generates NEW desires
   - **UPGRADES** existing similar desires (reinforcement)
   - **DEPRECIATES** desires when context invalidates them

2. **Threshold-Based Activation**
   - Desires start at low strength (nascent)
   - Build strength through reinforcement
   - When threshold crossed → trigger planning

3. **Trust-Based Review Bypass**
   - Three settings: `never` | `trust_based` | `always`
   - UI toggle in settings
   - `never`: All desires go to approval queue
   - `trust_based`: Low risk + high trust = auto-approve
   - `always`: Skip approval entirely (dangerous)

4. **Re-Planning Loop**
   - User can edit in Agency tab
   - Edits trigger re-planning
   - Planner accepts BOTH desire input AND review/critique input

5. **Folder Structure Per Desire**
   ```
   desires/folders/<desire-id>/
   ├── manifest.json         # Core desire data
   ├── scratchpad/           # Individual event files
   │   ├── 0001-origin.json
   │   └── 0002-reinforcement.json
   ├── plans/                # Versioned plans
   │   └── v1.json
   ├── reviews/              # Outcome reviews
   │   └── outcome-001.json
   └── executions/           # Execution attempts
       └── attempt-001.json
   ```

6. **Scratchpad Requirements**
   - Tracks ALL events
   - **Current stage indicator** (what step in process)
   - **Iteration counts per stage** (how many times through each stage)
   - Timestamps for everything
   - Must be updated at EVERY stage change

7. **Three Main Workflows** (all update scratchpad)
   - **Planner**: Generates/revises plans
   - **Executor**: Runs via Big Brother operator
   - **Reviewer**: Evaluates outcomes, routes next steps

8. **Execution Output**
   - Big Brother executes plan
   - Output saved to desire's `executions/` subfolder
   - Results inform outcome review

9. **Outcome Review Verdicts**
   - `completed` → Archive desire
   - `continue` → Keep pursuing (recurring)
   - `retry` → Re-plan with lessons learned
   - `escalate` → Notify user
   - `abandon` → Give up

---

## Current Implementation Status (Updated 2025-12-04)

### ✅ IMPLEMENTED & WORKING

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Folder-based storage | `storage.ts` | ✅ Complete | All CRUD operations working |
| Scratchpad entries | `storage.ts`, `types.ts` | ✅ Complete | Event logging at each stage |
| Trust-based auto-approve | `config.ts` | ✅ Complete | `canAutoApprove()` function |
| ReviewBypassSetting type | `types.ts` | ✅ Complete | 'never' \| 'trust_based' \| 'always' |
| DesireStage type | `types.ts` | ✅ Complete | Granular pipeline tracking |
| StageIterations interface | `types.ts` | ✅ Complete | Per-stage iteration counts |
| DesireMetrics tracking | `types.ts` | ✅ Complete | Comprehensive behavioral metrics |
| Memory analyzer node | `desire-memory-analyzer.node.ts` | ✅ Complete | Loads unanalyzed memories |
| Desire loader (folder) | `desire-loader.node.ts` | ✅ Complete | Uses `loadDesireFromFolder()` |
| Desire updater (folder) | `desire-updater.node.ts` | ✅ Complete | Uses folder-based storage |
| Approval queue (folder) | `approval-queue.node.ts` | ✅ Complete | Migrated to folder storage |
| Plan generator node | `desire-plan-generator.node.ts` | ✅ Complete | LLM-based planning |
| Plan validator node | `plan-validator.node.ts` | ✅ Complete | Validates plan constraints |
| Alignment reviewer | `desire-alignment-reviewer.node.ts` | ✅ Complete | LLM alignment scoring (temp=0.2) |
| Safety reviewer | `desire-safety-reviewer.node.ts` | ✅ Complete | LLM safety scoring (temp=0.1) |
| Verdict node | `desire-verdict.node.ts` | ✅ Complete | Trust-based auto-approve logic |
| Outcome reviewer | `outcome-reviewer.node.ts` | ✅ Complete | Post-execution evaluation |
| Verdict router | `verdict-router.node.ts` | ✅ Complete | Routes by outcome verdict |
| Similar desire detection | `storage.ts` | ✅ Complete | `findSimilarDesires()` with Jaccard similarity |
| Desire reinforcement | `storage.ts` | ✅ Complete | `reinforceDesire()` function |
| Desire depreciation | `storage.ts` | ✅ Complete | `depreciateDesire()` function |
| Desire detector upgrade | `desire-detector.node.ts` | ✅ Complete | Checks for similar desires before creating |
| Execution output saving | `desire-executor.node.ts` | ✅ Complete | Saves to `executions/attempt-NNN.json` |
| Retry loop graph | `desire-retry.json` | ✅ Complete | Re-plans with lessons learned |
| Enricher outcome mode | `desire-enricher.node.ts` | ✅ Complete | `enrichFromOutcome` property |
| Generator scratchpad | `storage.ts` | ✅ Complete | Tracks analyzed memories |
| SSE plan streaming | `generate-plan-stream.ts` | ✅ Complete | Real-time LLM output |
| API cookie passthrough | `run.ts` | ✅ Complete | Fixed 403 auth errors |

### ⚠️ BUGS / CRITICAL ISSUES

| Component | Issue | Priority | Fix |
|-----------|-------|----------|-----|
| **Operator false completion** | LLM uses `conversational_response` instead of action skills | **CRITICAL** | Add goal-intent validation |
| Operator error handling | `goal` undefined in catch block | Fixed ✅ | Used fallback values |

### ❌ UI / INTEGRATION MISSING

| Component | Description | Priority |
|-----------|-------------|----------|
| Settings UI for bypass | No toggle for `reviewBypass` setting | MEDIUM |
| Agency dashboard improvements | Execution progress, real-time updates | LOW |
| Proactive generator scheduling | Generator graph not wired to scheduler | LOW |

---

## Gaps Analysis (Updated 2025-12-04)

### ✅ RESOLVED GAPS

| Gap | Resolution | Date |
|-----|------------|------|
| Desire Upgrade/Deprecation | Added `findSimilarDesires()`, `reinforceDesire()`, `depreciateDesire()` in storage.ts; Updated desire-detector.node.ts | 2025-12-04 |
| Current Stage Tracking | Added `DesireStage` type and `currentStage` field to Desire interface | 2025-12-04 |
| Per-Stage Iteration Counts | Added `StageIterations` interface with per-stage counters | 2025-12-04 |
| Outcome → Re-plan Loop | Created `desire-retry.json` cognitive graph | 2025-12-04 |
| Execution Output to Folder | Updated `desire-executor.node.ts` to save to `executions/attempt-NNN.json` | 2025-12-04 |
| Enricher Outcome Mode | Added `enrichFromOutcome` property to desire-enricher.node.ts | 2025-12-04 |

---

### 🚨 Gap: Operator False Completion (CRITICAL)

**Intent**: When a desire requires an action (file write, web search, etc.), the operator should execute the appropriate skill.

**Current Behavior**:
1. Operator receives goal: "Write a file called test.txt"
2. LLM in planning loop chooses `conversational_response` skill
3. LLM generates text describing what it would do: "I'll create test.txt with..."
4. Operator's `isGoalComplete()` function (line 890-903) returns `true` because:
   ```typescript
   if (lastStep.action === 'conversational_response' && !lastStep.observation.startsWith('Error:')) {
     return true;  // Terminal - task "complete"
   }
   ```
5. No `fs_write` skill is ever called
6. Desire is marked "completed" but file doesn't exist

**Root Cause Analysis**:
- The LLM is "hallucinating completion" by describing actions instead of taking them
- `conversational_response` is a catch-all skill that allows the LLM to respond conversationally
- The operator has no way to validate that the response actually satisfies the goal
- The planning prompt doesn't enforce action skill usage for action-oriented goals

**Evidence** (from audit logs):
```
[scratchpad] Step 4: Action: conversational_response
[scratchpad] Step 4: Observation: "I'll create the test file now..."
[operator] isGoalComplete() → true (conversational_response is terminal)
[operator] Result: { success: true, result: "I'll create the test file now..." }
```
No `fs_write` call in logs.

**Impact**:
- All desires requiring file operations, web actions, or other skills may falsely complete
- User sees "success" but nothing actually happened
- Breaks the entire agency execution pipeline

**Location**: `brain/agents/operator-react.ts` lines 890-903

---

### Gap: Settings UI for Review Bypass

**Intent**: User should be able to toggle `reviewBypass` setting in UI

**Current**:
- `ReviewBypassSetting` type exists ('never' | 'trust_based' | 'always')
- `canAutoApprove()` function respects the setting
- BUT no UI toggle in Settings page

**Priority**: MEDIUM

**Fix**:
1. Add to `AgencySettings.svelte` (or create if doesn't exist)
2. Radio buttons: "Never auto-approve" / "Trust-based" / "Always auto-approve"
3. Wire to `/api/agency/config` PUT endpoint

---

## Fix Plan

### 🚨 IMMEDIATE: Fix False Completion Bug

**File**: `brain/agents/operator-react.ts`

**Problem**: `isGoalComplete()` treats `conversational_response` as terminal regardless of goal intent.

**Solution**: Add goal-intent classification and validate completion against required actions.

#### Option A: Goal Intent Classification (Recommended)

Add a pre-planning step that classifies the goal intent:

```typescript
type GoalIntent =
  | 'action_file'        // Requires fs_write, fs_read, fs_list
  | 'action_web'         // Requires web_search, web_fetch
  | 'action_command'     // Requires shell_exec
  | 'action_memory'      // Requires memory_write, memory_search
  | 'query_information'  // Can complete with conversational_response
  | 'query_status'       // Can complete with conversational_response
  | 'creative_writing'   // Can complete with conversational_response
  | 'unknown';           // Requires at least one non-conversational skill

async function classifyGoalIntent(goal: string): Promise<GoalIntent> {
  // Keywords indicate action intent
  const fileKeywords = ['write', 'create file', 'save', 'generate file', 'output file'];
  const webKeywords = ['search', 'find online', 'look up', 'web'];
  const commandKeywords = ['run', 'execute', 'command', 'shell'];

  const goalLower = goal.toLowerCase();

  if (fileKeywords.some(k => goalLower.includes(k))) return 'action_file';
  if (webKeywords.some(k => goalLower.includes(k))) return 'action_web';
  if (commandKeywords.some(k => goalLower.includes(k))) return 'action_command';

  // Default: unknown means require action proof
  return 'unknown';
}
```

Then modify `isGoalComplete()`:

```typescript
function isGoalComplete(
  scratchpad: ScratchpadStep[],
  goalIntent: GoalIntent
): boolean {
  const lastStep = scratchpad[scratchpad.length - 1];
  if (!lastStep) return false;

  // If goal requires action, verify action skill was called
  if (goalIntent.startsWith('action_')) {
    const actionSkillsUsed = scratchpad.filter(s =>
      !['conversational_response', 'think', 'plan'].includes(s.action)
    );

    if (actionSkillsUsed.length === 0) {
      // No action skills used - cannot be complete
      return false;
    }

    // Verify the required skill type was called
    const requiredSkillPrefix = {
      'action_file': 'fs_',
      'action_web': 'web_',
      'action_command': 'shell_',
      'action_memory': 'memory_'
    }[goalIntent];

    const hasRequiredSkill = actionSkillsUsed.some(s =>
      s.action.startsWith(requiredSkillPrefix)
    );

    if (!hasRequiredSkill) {
      return false;  // Required action not taken
    }
  }

  // For query goals, conversational_response is OK
  if (lastStep.action === 'conversational_response' &&
      !lastStep.observation.startsWith('Error:')) {
    return true;
  }

  return false;
}
```

#### Option B: Require Action Verification in Prompt

Modify the planning prompt to explicitly forbid conversational completion for action goals:

```typescript
const PLANNING_PROMPT_SUFFIX = `
CRITICAL RULES:
1. If the goal requires creating a file, you MUST call fs_write skill
2. If the goal requires searching, you MUST call web_search or memory_search skill
3. NEVER use conversational_response to describe what you would do - DO IT
4. conversational_response is ONLY for presenting final results to user AFTER completing actions
5. If you haven't called an action skill yet, you have NOT completed the task
`;
```

#### Option C: Post-Completion Validation

Add a validation step after `isGoalComplete()` returns true:

```typescript
async function validateCompletion(
  goal: string,
  scratchpad: ScratchpadStep[],
  result: string
): Promise<{ valid: boolean; reason?: string }> {
  // Quick heuristics first
  const goalLower = goal.toLowerCase();
  const hasFileGoal = ['write', 'create', 'save'].some(k => goalLower.includes(k));
  const hasFileAction = scratchpad.some(s => s.action.startsWith('fs_'));

  if (hasFileGoal && !hasFileAction) {
    return {
      valid: false,
      reason: 'Goal requires file operation but no fs_* skill was called'
    };
  }

  // If heuristics pass, optionally use LLM validation
  // (expensive but thorough)
  return { valid: true };
}
```

**Recommended Approach**: Implement Option A (goal classification) + Option B (prompt enhancement).

---

### Phase 1: Critical Bug Fix (IMMEDIATE)

| Task | File | Description |
|------|------|-------------|
| Add goal intent classification | `operator-react.ts` | `classifyGoalIntent()` function |
| Modify `isGoalComplete()` | `operator-react.ts` | Check action skills were actually called |
| Update planning prompt | `operator-react.ts` | Forbid conversational completion for action goals |
| Add completion validation | `operator-react.ts` | Post-check before returning success |
| Add tests | `operator-react.test.ts` | Verify file goals require fs_write |

### Phase 2: UI Improvements (MEDIUM)

| Task | File | Description |
|------|------|-------------|
| Add reviewBypass toggle | `AgencySettings.svelte` | Radio buttons for bypass setting |
| Wire to API | `/api/agency/config` | PUT handler for config updates |

### Phase 3: Integration (LOW)

| Task | File | Description |
|------|------|-------------|
| Wire proactive generator | `etc/agents.json` | Add to scheduler |
| Add execution streaming | `AgencyDashboard.svelte` | Real-time progress updates |

---

### ✅ COMPLETED (Previous Sessions)

| Phase | Tasks | Date |
|-------|-------|------|
| Storage Migration | Migrated all nodes to folder-based storage | 2025-12-04 |
| Desire Upgrade Logic | Similar desire detection, reinforcement, depreciation | 2025-12-04 |
| Stage Tracking | DesireStage type, currentStage field, stageIterations | 2025-12-04 |
| Execution Output | Save to `executions/attempt-NNN.json` | 2025-12-04 |
| Retry Loop | `desire-retry.json` graph with lessons learned | 2025-12-04 |
| SSE Streaming | `generate-plan-stream.ts` for real-time LLM output | 2025-12-04 |
| Auth Fix | Cookie passthrough for internal API calls | 2025-12-04 |
| Error Handler | Fixed undefined `goal` in operator catch block | 2025-12-04 |

---

## Cognitive Graphs (7 Total)

All graphs located in `etc/cognitive-graphs/`

| Graph | File | Purpose | Status |
|-------|------|---------|--------|
| Desire Generator | `desire-generator.json` | Detects desires from user input, upgrades similar | ✅ Complete |
| Proactive Generator | `desire-generator-proactive.json` | Analyzes memories for implicit desires | ✅ Complete |
| Desire Planner | `desire-planner.json` | Generates execution plans | ✅ Complete |
| Desire Reviewer | `desire-reviewer.json` | Reviews alignment and safety | ✅ Complete |
| Desire Executor | `desire-executor.json` | Runs via Big Brother operator | ⚠️ Has false completion bug |
| Outcome Reviewer | `outcome-reviewer.json` | Evaluates outcomes, routes by verdict | ✅ Complete |
| Desire Retry | `desire-retry.json` | Re-plan on retry verdict with lessons | ✅ Complete |

### Graph Flow

```
                    ┌──────────────────┐
                    │ desire-generator │  ← User input / Memory pattern
                    └────────┬─────────┘
                             │ creates/upgrades desire
                             ▼
                    ┌──────────────────┐
                    │  desire-planner  │  ← When strength >= threshold
                    └────────┬─────────┘
                             │ generates plan
                             ▼
                    ┌──────────────────┐
                    │ desire-reviewer  │
                    └────────┬─────────┘
                       ┌─────┴─────┐
                       ▼           ▼
              ┌──────────────┐  ┌───────────────────┐
              │ Auto-Approve │  │ Approval Queue    │
              └──────┬───────┘  └─────────┬─────────┘
                     │                    │ user approves
                     └────────┬───────────┘
                              ▼
                    ┌──────────────────┐
                    │ desire-executor  │  ← Calls Big Brother
                    └────────┬─────────┘
                             │ execution result
                             ▼
                    ┌──────────────────┐
                    │ outcome-reviewer │
                    └────────┬─────────┘
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
         ┌──────────┐  ┌───────────┐  ┌──────────┐
         │ Complete │  │ Retry     │  │ Escalate │
         └──────────┘  └─────┬─────┘  └──────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  desire-retry    │  ← Lessons learned
                    └────────┬─────────┘
                             │ back to planner
                             └───────────────────→ desire-planner
```

---

## Node Inventory

### Agency Nodes (14 Total)

Location: `packages/core/src/nodes/agency/`

| Node ID | File | Purpose | Status |
|---------|------|---------|--------|
| `desire_detector` | desire-detector.node.ts | LLM detection + similar desire upgrade | ✅ Complete |
| `desire_folder_creator` | desire-folder-creator.node.ts | Creates folder + scratchpad | ✅ Complete |
| `desire_memory_analyzer` | desire-memory-analyzer.node.ts | Loads unanalyzed memories | ✅ Complete |
| `desire_loader` | desire-loader.node.ts | Loads by ID or status filter | ✅ Complete |
| `desire_enricher` | desire-enricher.node.ts | Merges critique + outcome lessons | ✅ Complete |
| `desire_plan_generator` | desire-plan-generator.node.ts | LLM generates plans | ✅ Complete |
| `desire_alignment_reviewer` | desire-alignment-reviewer.node.ts | LLM alignment scoring (temp=0.2) | ✅ Complete |
| `desire_safety_reviewer` | desire-safety-reviewer.node.ts | LLM safety scoring (temp=0.1) | ✅ Complete |
| `desire_verdict` | desire-verdict.node.ts | Synthesizes reviews + auto-approve | ✅ Complete |
| `approval_queue` | approval-queue.node.ts | Queues for user review | ✅ Complete |
| `desire_executor` | desire-executor.node.ts | Runs via operator + saves output | ✅ Complete |
| `desire_updater` | desire-updater.node.ts | Updates status/plan/stage | ✅ Complete |
| `outcome_reviewer` | outcome-reviewer.node.ts | LLM evaluates outcomes | ✅ Complete |
| `verdict_router` | verdict-router.node.ts | Routes by verdict (3 paths) | ✅ Complete |

### Cognitive Nodes Used by Agency

| Node ID | File | Purpose |
|---------|------|---------|
| `plan_validator` | plan-validator.node.ts | Validates plan constraints |
| `audit_logger` | cognitive/audit-logger.node.ts | Audit logging |
| `tool_catalog_builder` | cognitive/tool-catalog-builder.node.ts | Lists available skills |
| `policy_loader` | cognitive/policy-loader.node.ts | Loads decision rules |
| `semantic_search` | context/semantic-search.node.ts | Memory search |

---

## Storage Structure

### Per-User Desire Storage
```
profiles/<username>/persona/desires/
├── folders/                    # NEW: Folder-based storage
│   └── desire-<id>/
│       ├── manifest.json
│       ├── scratchpad/
│       ├── plans/
│       ├── reviews/
│       └── executions/
├── nascent/                    # LEGACY: Status-based flat files
├── pending/
├── active/
├── awaiting_approval/
├── completed/
├── rejected/
├── abandoned/
├── plans/
├── reviews/
├── metrics/
│   └── agency-stats.json
├── config.json                 # User overrides
└── generator-scratchpad.json   # Memory analysis tracking
```

**Note**: Legacy status-based directories exist for backwards compatibility but all new desires should use folder-based storage.

---

## Configuration

### System Config (etc/agency.json)

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
  "riskPolicy": {
    "reviewBypass": "trust_based",
    "autoApproveRisk": ["none", "low"],
    "requireApprovalRisk": ["medium", "high", "critical"],
    "blockRisk": ["critical"],
    "autoApproveTrustLevel": "bounded_auto"
  }
}
```

### User Overrides

User-specific config saved to `profiles/<username>/persona/desires/config.json` merged with system config.

---

## API Endpoints (Needed)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agency/config` | GET/PUT | Get/set agency configuration |
| `/api/agency/desires` | GET | List all desires |
| `/api/agency/desires/:id` | GET/PUT/DELETE | Desire CRUD |
| `/api/agency/desires/:id/approve` | POST | Approve pending desire |
| `/api/agency/desires/:id/reject` | POST | Reject pending desire |
| `/api/agency/desires/:id/critique` | POST | Submit critique for re-planning |
| `/api/agency/desires/:id/scratchpad` | GET | Get scratchpad entries |
| `/api/agency/metrics` | GET | Get agency metrics |

---

## Summary

### System Status: 90% Complete

The Agency system is **functionally complete** with one critical bug blocking full operation:

| Layer | Status | Notes |
|-------|--------|-------|
| **Storage** | ✅ 100% | Folder-based, scratchpad, metrics |
| **Types** | ✅ 100% | DesireStage, StageIterations, ReviewBypass |
| **Nodes** | ✅ 100% | All 14 agency nodes implemented |
| **Graphs** | ✅ 100% | All 7 cognitive graphs wired |
| **Config** | ✅ 100% | Trust-based auto-approval logic |
| **API** | ✅ 95% | All endpoints working, auth fixed |
| **Operator** | ⚠️ 80% | **False completion bug** blocks execution |
| **UI** | ⚠️ 70% | Dashboard works, settings toggle missing |

### Critical Next Step

**Fix the false completion bug in `operator-react.ts`** (see [Fix Plan](#fix-plan) above):

1. Add `classifyGoalIntent()` to detect action vs query goals
2. Modify `isGoalComplete()` to require action skills for action goals
3. Update planning prompt to forbid conversational completion for actions

### What's Working

- ✅ Desire creation with folder structure
- ✅ Similar desire detection and upgrade (prevents duplicates)
- ✅ Threshold-based activation
- ✅ Plan generation with LLM
- ✅ Alignment + Safety review
- ✅ Trust-based auto-approval (never/trust_based/always)
- ✅ Approval queue integration
- ✅ Execution output saved to folder
- ✅ Outcome review with verdict routing
- ✅ Retry loop with lessons learned
- ✅ Real-time SSE streaming for plan generation

### What's Broken

- ❌ Operator claims success without executing action skills
- ❌ File/web/command goals complete without actual action
- ⚠️ Settings UI toggle for reviewBypass not implemented
