# System Coder Agent

The **System Coder** is an autonomous agent that monitors, maintains, and fixes the MetaHuman OS codebase. It captures errors, suggests fixes, maintains documentation, and performs periodic code reviews — all with user approval before any changes are applied.

---

## Overview

The System Coder serves as an automated code health monitor that:

- **Captures errors** from web console and terminal
- **Generates fix proposals** via Big Brother (Claude CLI)
- **Tracks technical debt** and maintenance needs
- **Verifies documentation** matches actual implementation
- **Suggests refactoring** opportunities

All code changes require explicit user approval before being applied.

---

## Features

### Error Capture

Errors are automatically captured from:

| Source | Method | Auto-Capture |
|--------|--------|--------------|
| Web Console | `window.onerror`, `unhandledrejection` | Yes |
| Terminal | Manual capture or pattern detection | Partial |
| Build Output | TypeScript/Astro build errors | Manual |
| Runtime | Server-side exceptions | Yes |

Captured errors include:
- Error message and stack trace
- Source file and line number
- Timestamp and severity
- Context (URL, user agent, command)

### Health Status

The System Coder maintains a health status indicator:

| Status | Meaning |
|--------|---------|
| 🟢 Green | No new errors, few pending fixes |
| 🟡 Yellow | Some errors or pending fixes |
| 🔴 Red | Many errors or significant issues |

Health thresholds are configurable in `etc/system-coder.json`.

### Fix Generation

When you request a fix for an error:

1. Agent analyzes the error and related files
2. Escalates to Big Brother (Claude CLI) for fix generation
3. Proposes changes with explanation
4. Stages fix for your review
5. You approve/reject via the dashboard
6. Approved fixes are applied to the codebase

### Maintenance Tasks

Periodic maintenance includes:

- **Type checking** - Run `tsc --noEmit` to find type errors
- **Dead code detection** - Find unused exports
- **Documentation sync** - Verify user guide matches code
- **Security audit** - Check for common vulnerabilities

---

## Web UI

Access the System Coder dashboard from the left sidebar (🔧 icon).

### Errors Tab

View all captured errors:
- Filter by status (new, reviewing, fixed, ignored)
- Filter by source (web_console, terminal, build)
- Filter by severity (error, warning, critical)
- Request fix or mark as ignored

### Fixes Tab

Review staged fix proposals:
- View proposed changes (diff view)
- Read Claude's explanation
- Run test commands to verify
- Approve, reject, or request revision

### Maintenance Tab

View maintenance status:
- Last maintenance run timestamp
- Issues found by category
- Documentation drift alerts
- Suggested improvements

---

## Configuration

Configuration file: `etc/system-coder.json`

```json
{
  "enabled": true,
  "mode": "supervised",

  "errorCapture": {
    "enabled": true,
    "autoCapture": true,
    "patterns": ["Error:", "ERR!", "TypeError", "ReferenceError"],
    "rateLimitPerMinute": 10,
    "dedupeWindowSeconds": 300
  },

  "maintenance": {
    "enabled": true,
    "intervalHours": 24,
    "scope": ["packages/core", "apps/site/src", "brain/agents"],
    "checks": [
      "type_errors",
      "unused_exports",
      "deprecated_apis",
      "documentation_drift"
    ]
  },

  "fixes": {
    "autoStage": true,
    "requireApproval": true,
    "testBeforeApprove": true,
    "maxPendingFixes": 20,
    "autoApproveRisk": ["none", "low"],
    "requireApprovalRisk": ["medium", "high", "critical"]
  },

  "bigBrother": {
    "useForFixes": true,
    "maxRetries": 2,
    "timeout": 120000
  },

  "healthThresholds": {
    "green": { "maxNewErrors": 0, "maxPendingFixes": 5 },
    "yellow": { "maxNewErrors": 5, "maxPendingFixes": 15 },
    "red": { "errorCountAbove": 5, "pendingFixesAbove": 15 }
  }
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable/disable the agent | `true` |
| `mode` | `supervised` requires approval, `auto` applies low-risk fixes | `supervised` |
| `errorCapture.autoCapture` | Automatically capture web console errors | `true` |
| `errorCapture.patterns` | Error patterns to capture | Common JS errors |
| `maintenance.intervalHours` | Hours between maintenance runs | `24` |
| `maintenance.scope` | Directories to include in maintenance | Core dirs |
| `fixes.autoApproveRisk` | Risk levels that can auto-apply | `["none", "low"]` |
| `bigBrother.useForFixes` | Use Claude CLI for fix generation | `true` |

---

## Scheduler Integration

The System Coder runs via the agent scheduler with two entries:

```json
// etc/agents.json
{
  "system-coder": {
    "type": "interval",
    "interval": 3600,
    "comment": "Hourly maintenance and error processing"
  },
  "system-coder-error-processor": {
    "type": "activity",
    "inactivityThreshold": 300,
    "comment": "Process errors 5 minutes after capture"
  }
}
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system-coder/capture-error` | POST | Capture a new error |
| `/api/system-coder/errors` | GET | List captured errors |
| `/api/system-coder/errors/{id}/ignore` | POST | Mark error as ignored |
| `/api/system-coder/errors/{id}/fix` | POST | Request fix generation |
| `/api/system-coder/status` | GET | Get health status |
| `/api/system-coder/fixes` | GET | List staged fixes |
| `/api/system-coder/fixes/{id}/approve` | POST | Approve and apply fix |
| `/api/system-coder/fixes/{id}/reject` | POST | Reject fix |

---

## CLI Commands

```bash
# Run system coder manually
./bin/mh agent run system-coder

# Check agent status
./bin/mh agent status system-coder

# View captured errors (via API)
curl http://localhost:4321/api/system-coder/errors

# Get health status
curl http://localhost:4321/api/system-coder/status
```

---

## Design Documents

The System Coder uses these documents for guidance:

| Document | Purpose |
|----------|---------|
| `docs/CODER-AGENT-PLAYBOOK.md` | Design intent, maintenance tasks, checklists |
| `docs/SYSTEM-INIT.md` | Technical architecture reference |
| `docs/user-guide/` | Source of truth for feature specifications |
| `CLAUDE.md` | Codebase conventions and patterns |

---

## Security Considerations

1. **User Approval Required** - All code changes need explicit approval
2. **Audit Trail** - All operations logged to audit system
3. **Sandbox Execution** - Test commands run in isolated environment
4. **File Scope** - Configurable directory restrictions
5. **Rate Limits** - Prevent runaway error capture

---

## Troubleshooting

### Errors Not Being Captured

1. Check `etc/system-coder.json` → `errorCapture.enabled`
2. Verify web UI is using ChatLayout (contains error handlers)
3. Check browser console for capture failures

### Fixes Not Generating

1. Ensure Big Brother is enabled in `etc/operator.json`
2. Check Claude CLI is installed: `claude --version`
3. Verify `etc/system-coder.json` → `bigBrother.useForFixes`

### Health Status Stuck on Red

1. Review pending errors in dashboard
2. Mark false positives as "ignored"
3. Process or dismiss queued fixes
4. Adjust thresholds in config if too sensitive

---

## Related Documentation

- [Autonomous Agents](08-autonomous-agents.md) - Overview of all agents
- [Security & Trust Model](../operations/10-security-trust.md) - Approval patterns
- [Configuration Files](../core-features/14-configuration-files.md) - Config reference
- [Big Brother Mode](24-agency-system.md#big-brother-integration) - Claude CLI escalation
