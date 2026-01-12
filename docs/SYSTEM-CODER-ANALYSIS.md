# System Coder Analysis & Babysitter Implementation Plan

**Date**: 2026-01-12
**Status**: Analysis Complete, Implementation Pending

---

## System Coder Current State

### Architecture Overview

The System Coder is **implemented and functional**, but operates in a **reactive, single-shot mode**:

```
User → Error Occurs → Capture → Request Fix → Claude CLI → Parse → Review → Apply
          ↓                         ↓
    (manual)                   (one-shot)
```

### Components

1. **UI**: [RightSidebar.svelte](apps/site/src/components/RightSidebar.svelte)
   - Tab 1: System Coder (lazy-loaded)
   - Tab 2: Agent Monitor
   - Tab 3: Server Status

2. **Dashboard**: [SystemCoderDashboard.svelte](apps/site/src/components/SystemCoderDashboard.svelte)
   - 4 sub-tabs: Request, Errors, Fixes, Maintenance
   - Shows health status, error counts, fix stats
   - Full CRUD for errors and fixes

3. **Core Logic**: [packages/core/src/system-coder/](packages/core/src/system-coder/)
   - `error-capture.ts` - Captures and stores errors
   - `fix-generator.ts` - Generates fixes via Big Brother
   - `fix-management.ts` - CRUD for proposed fixes
   - `coding-requests.ts` - User-submitted coding requests
   - `maintenance-runner.ts` - Proactive codebase checks

4. **Big Brother Integration**: [big-brother-terminal.ts](packages/core/src/big-brother-terminal.ts)
   - WebSocket server on port 3099
   - Stream-json protocol with Claude CLI
   - Real-time terminal visibility

5. **Escalation Backend**: [escalation-backend.ts](packages/core/src/escalation-backend.ts)
   - Multi-backend support (Claude Code, Open Interpreter, Aider, Gemini, Qwen)
   - Unified interface for all backends
   - Configured via `tool-executor.json`

### Current Flow

```typescript
// User clicks "Request Fix" on an error
generateFixForError(username, errorId)
  → buildFixPrompt(error)  // Creates structured prompt with file context
  → callClaudeForFix(prompt)  // Routes through escalation-backend
    → escalate(prompt)  // Sends to Big Brother (Claude CLI)
  → parseFixResponse(response)  // Extracts title, explanation, changes, risk
  → createFix(username, errorId, parsedFix)  // Stores ProposedFix
  → User reviews and approves/applies
```

### What Works

✅ **Error Capture**: Captures errors from terminal, web console, build, test, runtime
✅ **Fix Generation**: Calls Claude CLI to analyze and propose fixes
✅ **Fix Management**: Stores, reviews, applies, reverts fixes
✅ **Maintenance Checks**: Runs proactive scans (type errors, security, docs drift)
✅ **Big Brother Integration**: Real-time terminal visibility on port 3099
✅ **Multi-Backend Support**: Can use Claude Code, Open Interpreter, Aider, etc.

### What's Missing (Why It Feels Useless)

❌ **Proactive Monitoring**: Only captures errors manually triggered
❌ **Real-Time Log Tailing**: Doesn't watch logs continuously
❌ **Self-Healing**: Waits for user approval, doesn't auto-fix low-risk issues
❌ **Pattern Detection**: Doesn't identify recurring problems
❌ **Periodic Reports**: No scheduled health summaries
❌ **Multi-Source Aggregation**: Doesn't correlate logs from Node.js, servers, Big Brother, browser

---

## Babysitter System Design

### Objective

**A proactive, self-healing monitoring system that watches all system logs, detects issues, automatically fixes low-risk problems, and generates periodic health reports.**

### Data Sources to Monitor

| Source | Location | Format | Purpose |
|--------|----------|--------|---------|
| **Node.js Terminal** | `stdout/stderr` of main process | Plain text | Dev server errors, TypeScript errors |
| **Agent Logs** | `logs/run/agents/` | NDJSON | Agent crashes, processing errors |
| **Server Logs** | `logs/server.log`, `logs/run/*.log` | Plain text | Web server, voice server, RVC server errors |
| **Big Brother Output** | `logs/run/big-brother-output.log` | Stream-JSON + plain text | Claude CLI errors, tool failures |
| **Audit Trail** | `logs/audit/YYYY-MM-DD.ndjson` | NDJSON | All system operations, security events |
| **Web Console** | Browser DevTools via WebSocket | JSON | Frontend errors, React warnings |
| **Build Logs** | `pnpm` output | Plain text | Build failures, dependency issues |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Babysitter Agent (brain/agents/babysitter.ts)             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Log Watchers │  │   Pattern    │  │    Health    │     │
│  │   (Tails)    │─>│   Detector   │─>│   Reporter   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │             │
│         ↓                  ↓                  ↓             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Error Parser │  │  Auto-Healer │  │  Escalation  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                           │                                 │
│                           ↓                                 │
│              ┌────────────────────────┐                     │
│              │  System Coder API      │                     │
│              │  (captureError, etc.)  │                     │
│              └────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Log Watchers (Tails)

```typescript
interface LogWatcher {
  source: string;  // 'node', 'server', 'big-brother', 'audit', etc.
  path: string;    // File path or stream
  parser: (line: string) => ParsedLogEntry | null;
  buffer: string[];  // Recent lines for context
}

class LogTailer {
  watchers: Map<string, LogWatcher>;

  async watchFile(path: string, callback: (line: string) => void): Promise<void> {
    // tail -f equivalent using fs.watch or chokidar
  }

  async watchStream(stream: NodeJS.ReadableStream, callback: (chunk: string) => void): Promise<void> {
    // Attach to stdout/stderr
  }

  async watchWebSocket(url: string, callback: (msg: any) => void): Promise<void> {
    // Connect to Big Brother WebSocket
  }
}
```

#### 2. Pattern Detector

```typescript
interface ErrorPattern {
  signature: string;  // Error message pattern
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  sources: string[];  // Which logs it appeared in
  autoFixable: boolean;
}

class PatternDetector {
  patterns: Map<string, ErrorPattern>;

  detectPattern(error: ParsedError): ErrorPattern | null {
    // Match against known patterns
    // Update occurrence counts
    // Identify recurring issues
  }

  isRecurring(pattern: ErrorPattern): boolean {
    // Occurred 3+ times in last hour
  }

  suggestFix(pattern: ErrorPattern): string | null {
    // Return cached fix ID if we've solved this before
  }
}
```

#### 3. Auto-Healer

```typescript
interface HealingPolicy {
  maxRisk: 'low' | 'medium';  // Only auto-apply low/medium risk fixes
  requireApproval: boolean;   // For high/critical
  testFirst: boolean;         // Run test commands before applying
}

class AutoHealer {
  policy: HealingPolicy;

  async attemptAutoFix(error: CapturedError): Promise<FixResult> {
    // 1. Generate fix via Big Brother
    const fix = await generateFixForError(username, error.id);

    // 2. Check risk level
    if (fix.risk === 'none' || fix.risk === 'low') {
      // 3. Run tests if configured
      if (this.policy.testFirst && fix.testCommands) {
        const testsPassed = await this.runTests(fix.testCommands);
        if (!testsPassed) return { success: false, reason: 'Tests failed' };
      }

      // 4. Apply fix
      await applyFix(username, fix.id);

      // 5. Log the auto-heal
      audit({
        level: 'info',
        category: 'action',
        event: 'babysitter_auto_healed',
        details: { errorId: error.id, fixId: fix.id },
        actor: 'babysitter',
      });

      return { success: true, fixId: fix.id };
    } else {
      // High/critical risk - escalate to user
      return { success: false, reason: 'Requires manual approval', fix };
    }
  }
}
```

#### 4. Health Reporter

```typescript
interface HealthReport {
  timestamp: Date;
  period: string;  // 'last_hour', 'last_day', 'last_week'
  summary: {
    errorsDetected: number;
    errorsAutoFixed: number;
    errorsEscalated: number;
    patternsIdentified: number;
  };
  topIssues: Array<{
    pattern: string;
    count: number;
    severity: string;
    status: 'fixed' | 'pending' | 'recurring';
  }>;
  systemHealth: {
    nodeServer: 'ok' | 'degraded' | 'down';
    agents: Record<string, 'ok' | 'error'>;
    bigBrother: 'ok' | 'down';
  };
}

class HealthReporter {
  async generateReport(period: string): Promise<HealthReport> {
    // Aggregate stats from last hour/day/week
    // Query system-coder for error/fix counts
    // Check agent monitor for agent health
    // Ping Big Brother for status
  }

  async scheduleReports(): Promise<void> {
    // Every hour: Light summary
    // Every day: Full health report
    // Every week: Deep analysis with trends
  }
}
```

### Implementation: Where Does It Live?

**Option 1: New Agent** (Recommended)

```
brain/agents/babysitter.ts
```

- Runs as a background service via scheduler
- Scheduled every 5 minutes (or real-time with log streaming)
- Configuration in `etc/agents.json`:

```json
{
  "babysitter": {
    "enabled": true,
    "schedule": "*/5 * * * *",  // Every 5 minutes
    "config": {
      "watchSources": ["node", "server", "big-brother", "audit"],
      "autoHeal": {
        "enabled": true,
        "maxRisk": "low",
        "testFirst": true
      },
      "reporting": {
        "hourly": true,
        "daily": true,
        "weekly": true
      }
    }
  }
}
```

**Option 2: Enhance System Coder** (Alternative)

- Add a "Monitor" tab to SystemCoderDashboard
- Real-time log streaming in the UI
- Auto-capture errors when detected
- Less clean separation of concerns

**Recommendation**: Go with **Option 1** (New Agent) because:
- System Coder is for reactive fixes
- Babysitter is for proactive monitoring
- Clear separation makes codebase maintainable
- Agent can run independently of UI

### Integration Points

#### With System Coder

```typescript
// Babysitter detects an error in logs
const error = parseLogLine(line);

// Auto-capture to System Coder
const capturedError = await captureError(username, {
  source: 'babysitter',
  severity: error.severity,
  message: error.message,
  stack: error.stack,
  context: {
    file: error.file,
    line: error.line,
    output: error.context,
  },
});

// Attempt auto-heal
await autoHealer.attemptAutoFix(capturedError);
```

#### With Big Brother Terminal

```typescript
// Watch Big Brother output for errors
await logTailer.watchWebSocket('ws://localhost:3099', (msg) => {
  if (msg.type === 'error' || msg.type === 'stderr') {
    // Parse and capture
    const error = parseBigBrotherError(msg.data);
    captureError(username, error);
  }
});
```

#### With Web UI

```typescript
// New API endpoint: /api/babysitter/status
export const GET: APIRoute = async () => {
  const status = await babysitter.getStatus();
  return new Response(JSON.stringify(status), { status: 200 });
};

// WebSocket endpoint for real-time log streaming
// Client connects to ws://localhost:4321/api/babysitter/logs
// Server broadcasts parsed log entries
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

- [ ] Create `brain/agents/babysitter.ts`
- [ ] Implement `LogTailer` class with file watching
- [ ] Add configuration to `etc/agents.json`
- [ ] Test with single log source (e.g., `server.log`)

### Phase 2: Error Detection (Week 1-2)

- [ ] Implement `ErrorParser` for different log formats
- [ ] Add error pattern matching
- [ ] Connect to System Coder's `captureError()`
- [ ] Test auto-capture from Node.js terminal

### Phase 3: Pattern Detection (Week 2)

- [ ] Implement `PatternDetector` class
- [ ] Track recurring errors
- [ ] Store patterns in `logs/run/babysitter-patterns.json`
- [ ] Identify auto-fixable patterns

### Phase 4: Auto-Healing (Week 3)

- [ ] Implement `AutoHealer` class
- [ ] Add healing policy configuration
- [ ] Integrate with System Coder fix generation
- [ ] Test auto-apply for low-risk fixes
- [ ] Add rollback mechanism for failed auto-heals

### Phase 5: Health Reporting (Week 3-4)

- [ ] Implement `HealthReporter` class
- [ ] Generate hourly/daily/weekly reports
- [ ] Store reports in `logs/run/babysitter-reports/`
- [ ] Add API endpoint for retrieving reports

### Phase 6: UI Integration (Week 4)

- [ ] Add "Babysitter" tab to RightSidebar
- [ ] Real-time log stream viewer
- [ ] Pattern detection dashboard
- [ ] Auto-heal history
- [ ] Health report viewer

### Phase 7: Advanced Features (Week 5+)

- [ ] WebSocket streaming from browser console
- [ ] Machine learning for pattern prediction
- [ ] Anomaly detection (deviation from normal behavior)
- [ ] Integration with GitHub Issues (auto-create tickets for critical errors)
- [ ] Slack/Discord notifications for critical failures

---

## Configuration Schema

```json
// etc/babysitter.json
{
  "enabled": true,
  "monitoring": {
    "sources": [
      {
        "type": "file",
        "name": "server",
        "path": "logs/server.log",
        "parser": "plain-text"
      },
      {
        "type": "directory",
        "name": "agents",
        "path": "logs/run/agents/",
        "parser": "ndjson"
      },
      {
        "type": "websocket",
        "name": "big-brother",
        "url": "ws://localhost:3099",
        "parser": "stream-json"
      },
      {
        "type": "stream",
        "name": "node",
        "stream": "stdout",
        "parser": "plain-text"
      }
    ],
    "pollInterval": 5000,
    "bufferSize": 100
  },
  "errorDetection": {
    "patterns": [
      {
        "name": "typescript-error",
        "regex": "TS\\d+:",
        "severity": "error"
      },
      {
        "name": "unhandled-rejection",
        "regex": "UnhandledPromiseRejection",
        "severity": "critical"
      }
    ],
    "minSeverity": "warning"
  },
  "autoHealing": {
    "enabled": true,
    "maxRisk": "low",
    "testFirst": true,
    "maxRetries": 3,
    "cooldownPeriod": 3600000,
    "blacklist": [
      "database-schema-change",
      "production-deployment"
    ]
  },
  "patternDetection": {
    "enabled": true,
    "minOccurrences": 3,
    "timeWindow": 3600000,
    "storePath": "logs/run/babysitter-patterns.json"
  },
  "reporting": {
    "hourly": {
      "enabled": true,
      "recipients": ["system-dashboard"]
    },
    "daily": {
      "enabled": true,
      "time": "09:00",
      "recipients": ["user-email", "system-dashboard"]
    },
    "weekly": {
      "enabled": true,
      "day": "monday",
      "time": "09:00",
      "recipients": ["user-email"]
    },
    "outputPath": "logs/run/babysitter-reports/"
  }
}
```

---

## API Endpoints

```typescript
// Get babysitter status
GET /api/babysitter/status
→ { enabled, watching, errorsDetected24h, autoFixed24h, patterns }

// Get recent errors
GET /api/babysitter/errors?limit=50
→ [ { timestamp, source, severity, message, autoFixed, fixId } ]

// Get patterns
GET /api/babysitter/patterns
→ [ { signature, occurrences, firstSeen, lastSeen, sources } ]

// Get latest health report
GET /api/babysitter/reports/latest
→ HealthReport

// Get historical reports
GET /api/babysitter/reports?period=week
→ HealthReport[]

// WebSocket for real-time log streaming
WS /api/babysitter/logs
→ { type: 'log', source: 'server', level: 'error', message: '...' }
```

---

## Summary

### System Coder Today

✅ Functional but **reactive only**
✅ Good Big Brother integration
✅ Multi-backend support
❌ No proactive monitoring
❌ No self-healing

### Babysitter Tomorrow

✅ **Proactive monitoring** of all log sources
✅ **Real-time error detection** with pattern matching
✅ **Self-healing** for low-risk issues
✅ **Periodic health reports** (hourly/daily/weekly)
✅ **Comprehensive visibility** across Node.js, servers, Big Brother, browser

### Next Steps

1. Review this design with the team
2. Start with Phase 1 (Core Infrastructure)
3. Iterate and add features incrementally
4. Consider AI-powered anomaly detection in Phase 7

**Estimated Timeline**: 4-5 weeks for full implementation (Phases 1-6)

---

**Questions to Resolve:**

1. Should Babysitter be a separate agent or part of System Coder?
   - **Recommendation**: Separate agent for clean architecture

2. How aggressive should auto-healing be?
   - **Recommendation**: Conservative (low-risk only) with optional user override

3. Should reports be emailed or just stored locally?
   - **Recommendation**: Both (configurable recipients)

4. What's the priority order for log sources?
   - **Recommendation**: Start with Node.js + server.log, expand to others

5. Should Babysitter have its own UI or integrate into System Coder?
   - **Recommendation**: New tab in RightSidebar for dedicated monitoring view
