# Policy Layer

Policies define rules, constraints, and decision logic that govern autonomous behavior.

## Policy Types

### 1. Trust Policies
Define what actions can be taken autonomously at each trust level.

**File**: `trust-boundaries.json`

```json
{
  "observe": {
    "allowedActions": ["read", "search", "analyze"],
    "deniedActions": ["write", "send", "execute", "delete"]
  },
  "suggest": {
    "allowedActions": ["read", "search", "analyze", "draft"],
    "requiresApproval": ["all_write_actions"]
  },
  "supervised_auto": {
    "allowedActions": ["read", "write:memory", "notify", "task_update"],
    "requiresApproval": ["send_message", "schedule_meeting", "file_operations"]
  }
}
```

### 2. Safety Policies
Hard constraints that can never be violated.

**File**: `safety-constraints.json`

```json
{
  "constraints": [
    {
      "rule": "never_delete_without_approval",
      "scope": "all",
      "exception": "temporary_files"
    },
    {
      "rule": "rate_limit",
      "maxActionsPerHour": 50,
      "maxActionsPerDay": 500
    },
    {
      "rule": "confidence_threshold",
      "minimumConfidence": 0.7,
      "escalateIfBelow": true
    }
  ]
}
```

### 3. Decision Policies
Rules and heuristics for making choices.

**File**: `decision-heuristics.json`

Stored in `persona/decision-rules.json` (already created).

### 4. Learning Policies
How to learn from outcomes and update preferences.

**File**: `learning-rules.json`

```json
{
  "rules": [
    {
      "name": "preference_reinforcement",
      "trigger": "consistent_choices",
      "threshold": 3,
      "action": "create_or_strengthen_preference"
    },
    {
      "name": "confidence_update",
      "trigger": "decision_outcome",
      "formula": "bayesian_update",
      "parameters": {"prior_weight": 0.3}
    }
  ]
}
```

## Policy Enforcement

The Policy Enforcer checks every action against:
1. Current trust level capabilities
2. Safety constraints (hard rules)
3. Skill permissions
4. Risk level assessment
5. Rate limits

If any check fails, the action is either:
- Denied (if violates hard rule)
- Escalated (if requires approval)
- Queued (if rate limited)

## Policy Files Structure

```
brain/policies/
├── trust-boundaries.json      # Trust level capabilities
├── safety-constraints.json    # Hard safety rules
├── risk-assessment.json       # Risk scoring rules
├── approval-workflows.json    # When/how to request approval
└── learning-rules.json        # Learning and adaptation policies
```

These policies are loaded at startup and can be updated via the CLI or web UI.
