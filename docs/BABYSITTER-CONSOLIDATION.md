# Babysitter System - Consolidation Plan

**Date**: 2026-01-12
**Status**: Architecture Complete, Implementation Starting

---

## Discovered Existing Systems

### 1. System Coder ([packages/core/src/system-coder/](packages/core/src/system-coder/))

**What it does**:
- Captures errors from: terminal, web console, build, test, runtime
- Generates fixes via Big Brother (Claude CLI)
- Stores proposed fixes with risk assessment
- User approval workflow (review → approve → apply → revert)
- Maintenance checks (type errors, security, docs drift)

**Limitations**:
- ❌ **Reactive only** - no proactive monitoring
- ❌ **No real-time log tailing** - manual error capture
- ❌ **No auto-healing** - always requires user approval
- ❌ **No pattern detection** - doesn't track recurring issues

**Storage**:
- Errors: `profiles/<user>/state/system-coder/errors/`
- Fixes: `profiles/<user>/state/system-coder/fixes/`
- Requests: `profiles/<user>/state/system-coder/requests/`

### 2. Active Operator Self-Healing ([packages/core/src/active-operator/self-healing.ts](packages/core/src/active-operator/self-healing.ts))

**What it does**:
- Runs `tsc --noEmit` to find TypeScript errors
- Analyzes errors with LLM (via `callLLM`)
- Creates fix proposals stored in `state/code-proposals/`
- Triggered by Big Brother reviewer when stuck/errors detected
- Integrated with operator scratchpad

**Limitations**:
- ❌ **TypeScript errors only** - no runtime, server, or log errors
- ❌ **No log monitoring** - only runs on-demand via Big Brother
- ❌ **No auto-apply** - always requires approval
- ❌ **Operator-centric** - not a standalone monitoring system

**Config**:
```json
// etc/active-operator.json
{
  "enableSelfHealing": true,
  "stuckTimeoutMs": 300000,
  "maxConsecutiveErrors": 10
}
```

### 3. Lizard Brain Triggers ([packages/core/src/active-operator/lizard-brain.ts](packages/core/src/active-operator/lizard-brain.ts))

**What it does**:
- **Massive trigger system** with 15+ triggers:
  - `idle_reflection`, `idle_curiosity`, `idle_inner_curiosity`
  - `inbox_ingestion` - monitors `memory/inbox/`
  - `memory_staleness` - checks for unprocessed memories
  - `failed_agent_retry` - detects agent failures in `state/agent-failures/`
  - `calendar_focus_window` - calendar integration
  - `desire_exploration`, `desire_advancement`, `desire_execution`, `desire_review`
  - `help_ticket_review` - user feedback system
- **Circadian rhythm system** - time-of-day appropriate activities
- **Focus constraints** - pauses during calendar events
- **Used by cognitive graphs** - `etc/cognitive-graphs/lizard-brain.json`

**Limitations**:
- ❌ **No direct log monitoring** - only checks files/state
- ❌ **No error capture** - focused on task scheduling
- ❌ **Agent failures not integrated with System Coder** - separate tracking

**Strengths** (to preserve):
- ✅ Circadian rhythm system (night, morning, afternoon, evening)
- ✅ Calendar integration for focus windows
- ✅ Failed agent retry logic
- ✅ Comprehensive trigger system

---

## The Problem: Three Overlapping Systems

```
System Coder          Active Operator         Lizard Brain
    ↓                    Self-Healing             Triggers
    |                        |                       |
captureError          runTypeCheck           checkFailedAgents
    |                        |                       |
requestFix            analyzeError           evaluateTrigger
    |                        |                       |
generateFix           saveProposal           makeUnifiedDecision
    |                        |                       |
[Manual Approval]     [Manual Approval]      [Execute Agent]
```

**Issues**:
1. **Duplicate Error Tracking**: System Coder errors vs. Active Operator proposals
2. **Duplicate Fix Generation**: Both use LLM to analyze errors
3. **No Coordination**: Failed agents tracked separately from code errors
4. **Missing Piece**: Real-time log monitoring NOT in any system

---

## Unified Babysitter Architecture

### Core Principle

**One system to rule them all**: The Babysitter watches EVERYTHING and routes issues to the appropriate handler.

```
┌─────────────────────────────────────────────────────────────┐
│                     BABYSITTER AGENT                        │
│                   (brain/agents/babysitter.ts)              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  LOG WATCHERS (Real-time monitoring)                 │  │
│  │  - Node.js terminal (stdout/stderr)                  │  │
│  │  - Server logs (logs/server.log, logs/run/*.log)    │  │
│  │  - Big Brother terminal (ws://localhost:3099)       │  │
│  │  - Audit logs (logs/audit/*.ndjson)                 │  │
│  │  - Web console (browser via WebSocket)              │  │
│  │  - Agent logs (logs/run/agents/*.log)               │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ERROR CLASSIFIER                                    │  │
│  │  - TypeScript error → System Coder                  │  │
│  │  - Runtime error → System Coder                     │  │
│  │  - Agent failure → Failed Agent Retry (Lizard)     │  │
│  │  - Server crash → High priority escalation         │  │
│  │  - Pattern detected → Auto-heal or escalate        │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PATTERN DETECTOR                                    │  │
│  │  - Track recurring errors (signature + count)       │  │
│  │  - Identify auto-fixable patterns                   │  │
│  │  - Store in logs/run/babysitter-patterns.json       │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AUTO-HEALER                                         │  │
│  │  - Policy: Auto-apply LOW + MEDIUM risk fixes      │  │
│  │  - Test first if testCommands provided             │  │
│  │  - Escalate HIGH/CRITICAL to user approval         │  │
│  │  - Rollback on failure                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  INTEGRATIONS                                        │  │
│  │  - System Coder: captureError, generateFix         │  │
│  │  - Lizard Brain: checkFailedAgents trigger         │  │
│  │  - Active Operator: scratchpad updates             │  │
│  │  - Big Brother: terminal visibility                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  HEALTH REPORTER                                     │  │
│  │  - Hourly: Light summary (local notification)      │  │
│  │  - Daily: Full health report                        │  │
│  │  - Weekly: Deep analysis with trends                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### What Gets Consolidated

| Component | Old Location | New Location | Action |
|-----------|-------------|--------------|--------|
| Error capture | System Coder | Babysitter → System Coder | **Keep** System Coder, add real-time feed |
| TypeScript checks | Active Operator | Babysitter → System Coder | **Migrate** to unified flow |
| Fix generation | Both systems | System Coder (via Big Brother) | **Consolidate** to one path |
| Fix proposals | `code-proposals/` + `system-coder/fixes/` | System Coder only | **Merge** storage |
| Failed agents | Lizard Brain trigger | Babysitter → Lizard trigger | **Keep** trigger, enhance reporting |
| Log monitoring | None | Babysitter | **NEW** feature |
| Auto-healing | None | Babysitter | **NEW** feature |
| Pattern detection | None | Babysitter | **NEW** feature |
| Health reports | None | Babysitter | **NEW** feature |

### Configuration

```json
// etc/babysitter.json
{
  "enabled": true,
  "monitoring": {
    "sources": [
      { "type": "stream", "name": "node", "stream": "stdout", "parser": "plain-text" },
      { "type": "file", "name": "server", "path": "logs/server.log", "parser": "plain-text" },
      { "type": "websocket", "name": "big-brother", "url": "ws://localhost:3099", "parser": "stream-json" },
      { "type": "directory", "name": "agents", "path": "logs/run/agents/", "parser": "ndjson" },
      { "type": "file", "name": "audit", "path": "logs/audit/", "parser": "ndjson" }
    ],
    "pollInterval": 5000,
    "bufferSize": 100
  },
  "errorDetection": {
    "patterns": [
      { "name": "typescript-error", "regex": "TS\\d+:", "severity": "error" },
      { "name": "unhandled-rejection", "regex": "UnhandledPromiseRejection", "severity": "critical" },
      { "name": "react-warning", "regex": "Warning: ", "severity": "warning" },
      { "name": "vite-error", "regex": "\\[vite\\] .*error", "severity": "error" }
    ],
    "minSeverity": "warning"
  },
  "autoHealing": {
    "enabled": true,
    "maxRisk": "medium",
    "testFirst": true,
    "maxRetries": 3,
    "cooldownPeriod": 3600000,
    "blacklist": ["database-schema-change", "production-deployment"]
  },
  "patternDetection": {
    "enabled": true,
    "minOccurrences": 3,
    "timeWindow": 3600000,
    "storePath": "logs/run/babysitter-patterns.json"
  },
  "reporting": {
    "hourly": { "enabled": true },
    "daily": { "enabled": true, "time": "09:00" },
    "weekly": { "enabled": true, "day": "monday", "time": "09:00" },
    "outputPath": "logs/run/babysitter-reports/"
  },
  "integrations": {
    "systemCoder": { "enabled": true, "autoCaptureErrors": true },
    "lizardBrain": { "enabled": true, "reportFailedAgents": true },
    "activeOperator": { "enabled": true, "updateScratchpad": true },
    "bigBrother": { "enabled": true, "monitorTerminal": true }
  }
}
```

---

## Implementation Strategy

### Phase 1: Core Infrastructure (NOW)

**Goal**: Create the Babysitter agent with basic log monitoring

```
brain/agents/babysitter.ts
```

**Features**:
- LogTailer class (file watching with chokidar)
- ErrorParser (regex-based log parsing)
- Integration with System Coder's `captureError()`
- Monitor 3 sources: Node.js stdout, server.log, Big Brother WebSocket

**Storage**:
- Errors → System Coder (`captureError`)
- Patterns → `logs/run/babysitter-patterns.json`
- State → `profiles/<user>/state/babysitter/state.json`

### Phase 2: Pattern Detection & Auto-Healing

**Goal**: Make it self-healing

**Features**:
- PatternDetector class (track recurring errors)
- AutoHealer class (policy-based auto-fix)
- Integration with System Coder's `generateFixForError()`
- Auto-apply for LOW + MEDIUM risk fixes
- Escalate HIGH/CRITICAL to user

### Phase 3: Consolidate Active Operator Self-Healing

**Goal**: Remove duplication

**Actions**:
- **Deprecate** `active-operator/self-healing.ts`
- **Migrate** `runTypeCheck()` to Babysitter
- **Merge** `code-proposals/` into `system-coder/fixes/`
- **Update** Big Brother reviewer to call Babysitter instead

### Phase 4: Enhance Lizard Brain Integration

**Goal**: Unified failure tracking

**Actions**:
- Keep `failed_agent_retry` trigger in Lizard Brain
- Make Babysitter report agent failures to Lizard Brain
- Add `checkSystemHealth()` trigger to Lizard Brain
- Babysitter publishes health metrics for Lizard to consume

### Phase 5: Health Reporting & UI

**Goal**: Visibility and periodic summaries

**Features**:
- HealthReporter class (hourly/daily/weekly reports)
- Reports stored in `logs/run/babysitter-reports/`
- New tab in RightSidebar: "Babysitter"
- Real-time log stream viewer
- Pattern detection dashboard
- Auto-heal history

---

## Migration Path

### Immediate (Phase 1)

1. ✅ Create `brain/agents/babysitter.ts`
2. ✅ Implement LogTailer (file + stream + WebSocket)
3. ✅ Add to `etc/agents.json`
4. ✅ Test with server.log monitoring

### Short-term (Phase 2-3)

1. Add PatternDetector and AutoHealer
2. Integrate with System Coder
3. Deprecate Active Operator self-healing
4. Consolidate storage

### Long-term (Phase 4-5)

1. Full Lizard Brain integration
2. Health reporting
3. UI dashboard
4. Advanced features (ML, anomaly detection)

---

## Benefits of Consolidation

### Before (3 systems)

- ❌ Duplicate error tracking
- ❌ Duplicate fix generation
- ❌ No real-time monitoring
- ❌ Manual triggering required
- ❌ Separate storage locations
- ❌ TypeScript-only vs. runtime errors

### After (1 unified system)

- ✅ Single source of truth for errors
- ✅ Real-time log monitoring
- ✅ Auto-healing with policy control
- ✅ Pattern detection for recurring issues
- ✅ Unified storage (System Coder)
- ✅ Comprehensive: TypeScript + runtime + servers + agents
- ✅ Health reporting
- ✅ Lizard Brain integration (failed agents, triggers)

---

## Testing Plan

### Phase 1 Testing

1. **Log Tailing**:
   - Start dev server
   - Babysitter detects errors in real-time
   - Captured in System Coder

2. **Big Brother Monitoring**:
   - Run Big Brother terminal
   - Babysitter watches WebSocket
   - Claude errors auto-captured

3. **Agent Failures**:
   - Trigger agent failure
   - Babysitter detects from logs
   - Reports to Lizard Brain

### Phase 2 Testing

1. **Pattern Detection**:
   - Generate same error 3+ times
   - Babysitter identifies pattern
   - Stored in patterns.json

2. **Auto-Healing**:
   - LOW risk error → auto-fixed without user
   - MEDIUM risk error → auto-fixed after tests
   - HIGH risk error → escalated to user

---

## Next Steps

**RIGHT NOW** (Starting Phase 1):

1. Create `brain/agents/babysitter.ts`
2. Implement LogTailer class
3. Add configuration to `etc/babysitter.json`
4. Integrate with System Coder's `captureError()`
5. Test with server.log monitoring

Ready to code!
