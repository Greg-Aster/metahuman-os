# System Coder Agent - Implementation Plan

## Overview

The **System Coder** is an autonomous agent that monitors, maintains, and fixes the MetaHuman OS codebase. It captures errors, suggests fixes, maintains documentation, and performs periodic code reviews - all with user approval before any changes are applied.

This agent extends the existing Big Brother protocol and integrates with the approval workflow system.

---

## Research Summary

### Industry Best Practices (2025)

Based on research into autonomous coding agents:

1. **Multi-Agent Architecture** ([AgentCoder](https://zencoder.ai/blog/best-autonomous-coding-solutions)): Specialized agents for different tasks (Programmer, Test Designer, Test Executor) achieve 91.5% success rates while using 56% fewer tokens.

2. **Self-Healing CI** ([Harness AI](https://www.harness.io/blog/unscripted-2025-announcements)): When build failures occur, AI analyzes issues, generates fixes, creates branches, and submits PRs automatically - reducing MTTR dramatically.

3. **CodeMender Pattern** ([Google DeepMind](https://deepmind.google/blog/introducing-codemender-an-ai-agent-for-code-security/)): Uses static analysis, dynamic analysis, differential testing, and SMT solvers. LLM-based critique tools verify changes don't introduce regressions.

4. **Claude Code Best Practices** ([Anthropic](https://www.anthropic.com/engineering/claude-code-best-practices)):
   - Test-Driven Development with agentic coding
   - Research-first approach (plan before code)
   - Subagent pipelines (analyst → architect → implementer → tester)
   - Human-in-the-loop (HITL) approval patterns
   - Deny-all baseline with allowlists per subagent

5. **Progressive Tool Expansion**: Begin with carefully scoped tools, expand as behavior validates.

---

## Architecture

### Components

```
System Coder Agent
├── Error Capture Service
│   ├── Terminal Log Monitor
│   ├── Web Console Capture
│   └── Build/Test Output Monitor
├── Code Analysis Engine
│   ├── Static Analysis (TypeScript)
│   ├── Pattern Detection
│   └── Architecture Drift Detection
├── Fix Generator (via Big Brother/Claude)
│   ├── Error Analysis
│   ├── Fix Proposal
│   └── Test Generation
├── Documentation Maintainer
│   ├── SYSTEM-INIT.md (architecture doc)
│   ├── User Guide Updates
│   └── CLAUDE.md Sync
├── Approval Workflow
│   ├── Code Draft Staging
│   ├── UI Review Panel
│   └── Apply/Reject Actions
└── Scheduler
    ├── On-Demand (user triggered)
    ├── Error-Triggered (auto-capture)
    └── Periodic Maintenance
```

### Data Flow

```
Error Occurs → Capture → Analyze → Generate Fix → Stage → User Review → Apply/Reject
                                                           ↓
                                               Update Documentation
```

---

## Implementation Phases

### Phase 1: Error Capture System

**Goal**: Capture and store errors from terminal, web console, and build processes.

#### 1.1 Error Log Storage

Create `profiles/{username}/state/system-coder/` directory structure:

```
system-coder/
├── errors/                    # Captured errors
│   └── {timestamp}-{hash}.json
├── reviews/                   # Code review requests
│   └── {timestamp}-{type}.json
├── fixes/                     # Staged fixes (pending approval)
│   └── {timestamp}-{file-hash}.json
├── maintenance/               # Periodic review logs
│   └── {date}.json
└── config.json                # Agent configuration
```

#### 1.2 Error Capture Types

```typescript
interface CapturedError {
  id: string;
  timestamp: string;
  source: 'terminal' | 'web_console' | 'build' | 'test' | 'runtime';
  severity: 'error' | 'warning' | 'critical';
  message: string;
  stack?: string;
  context: {
    file?: string;
    line?: number;
    command?: string;
    output?: string;
  };
  status: 'new' | 'reviewing' | 'fixed' | 'ignored' | 'wont_fix';
  fixId?: string; // Link to staged fix
}
```

#### 1.3 Terminal Log Integration

Extend `TerminalManager.svelte` to capture error patterns:
- Watch for common error patterns (npm ERR!, TypeScript errors, etc.)
- Auto-save error context to state directory
- Show notification badge when errors captured

#### 1.4 Web Console Capture

Add client-side error capture in `ChatLayout.svelte`:
```typescript
window.onerror = (msg, url, line, col, error) => {
  // POST to /api/system-coder/capture-error
};
window.addEventListener('unhandledrejection', (event) => {
  // Capture promise rejections
});
```

### Phase 2: System Coder Agent Core

**Goal**: Create the main agent that processes errors and generates fixes.

#### 2.1 Agent File: `brain/agents/system-coder.ts`

```typescript
// Core responsibilities:
// 1. Process captured errors
// 2. Analyze codebase for related issues
// 3. Generate fix proposals via Big Brother
// 4. Stage fixes for approval
// 5. Update documentation when fixes applied
```

Key functions:
- `processError(errorId: string)`: Analyze error and generate fix
- `runMaintenance()`: Periodic code review
- `generateFix(analysis: ErrorAnalysis)`: Use Claude to propose fixes
- `stageFix(fix: ProposedFix)`: Save to approval queue
- `updateDocumentation(appliedFix: AppliedFix)`: Sync docs

#### 2.2 Big Brother Integration

Extend existing `big-brother.ts` with code-specific prompts:

```typescript
interface CodeFixRequest extends EscalationRequest {
  errorDetails: CapturedError;
  relatedFiles: string[];
  existingPatterns: string[];
  testRequirements: string[];
}
```

#### 2.3 Configuration: `etc/system-coder.json`

```json
{
  "enabled": true,
  "mode": "supervised",

  "errorCapture": {
    "enabled": true,
    "autoCapture": true,
    "patterns": [
      "Error:", "ERR!", "TypeError", "ReferenceError",
      "ENOENT", "EACCES", "Cannot find module"
    ]
  },

  "maintenance": {
    "enabled": true,
    "intervalHours": 24,
    "scope": ["packages/core", "apps/site/src", "brain/agents"],
    "checks": [
      "type_errors",
      "unused_exports",
      "deprecated_apis",
      "security_vulnerabilities",
      "documentation_drift"
    ]
  },

  "fixes": {
    "autoStage": true,
    "requireApproval": true,
    "testBeforeApprove": true,
    "maxPendingFixes": 20
  },

  "documentation": {
    "autoUpdate": true,
    "targets": [
      "CLAUDE.md",
      "docs/user-guide/",
      "docs/SYSTEM-INIT.md"
    ]
  }
}
```

### Phase 3: SYSTEM-INIT.md - Architecture Documentation

**Goal**: Create comprehensive system documentation for the coder agent.

#### 3.1 Create `docs/SYSTEM-INIT.md`

This document serves as the "brain dump" for the system coder - comprehensive documentation of:

1. **System Architecture**
   - Directory structure with purpose of each folder
   - Package dependencies and relationships
   - Data flow diagrams
   - Key design patterns used

2. **Core Subsystems**
   - Memory system (episodic, semantic)
   - Agent framework (scheduling, locks, audit)
   - Operator system (ReAct, skills, Big Brother)
   - Cognitive pipeline (layers, modes)
   - Authentication and profiles

3. **Code Conventions**
   - TypeScript patterns used
   - Error handling conventions
   - API endpoint structure
   - Svelte component patterns
   - State management patterns

4. **Common Issues & Solutions**
   - Known gotchas (from CLAUDE.md)
   - Typical error patterns
   - Debug strategies
   - Recovery procedures

5. **Change Log Format**
   - How to document changes
   - Required metadata
   - Linking to related files

#### 3.2 Auto-Generation Script

Create `scripts/generate-system-init.ts`:
- Scan codebase structure
- Extract exports from packages/core
- Document API endpoints
- Generate dependency graph
- Compile into SYSTEM-INIT.md

### Phase 4: UI Components

**Goal**: Add UI for error review, fix approval, and maintenance status.

#### 4.1 System Coder Dashboard (`SystemCoderDashboard.svelte`)

Three tabs:
1. **Errors** - List of captured errors with status
2. **Pending Fixes** - Staged fixes awaiting approval
3. **Maintenance** - Periodic review results

#### 4.2 Error Card Component

Shows:
- Error message and stack trace
- Source (terminal/console/build)
- Timestamp and severity
- Actions: "Request Fix", "Ignore", "Mark Won't Fix"

#### 4.3 Fix Review Modal

Shows:
- Original error context
- Proposed fix (diff view)
- Explanation from Claude
- Test commands to verify
- Actions: "Approve & Apply", "Request Revision", "Reject"

#### 4.4 Maintenance Report View

Shows:
- Last run timestamp
- Issues found by category
- Suggested improvements
- Documentation drift alerts

### Phase 5: API Endpoints

#### 5.1 Error Management

```
POST /api/system-coder/capture-error     # Capture new error
GET  /api/system-coder/errors            # List captured errors
POST /api/system-coder/errors/{id}/fix   # Request fix for error
POST /api/system-coder/errors/{id}/ignore # Mark as ignored
```

#### 5.2 Fix Management

```
GET  /api/system-coder/fixes             # List staged fixes
GET  /api/system-coder/fixes/{id}        # Get fix details
POST /api/system-coder/fixes/{id}/approve # Approve and apply
POST /api/system-coder/fixes/{id}/reject  # Reject fix
POST /api/system-coder/fixes/{id}/revise  # Request revision
```

#### 5.3 Maintenance

```
POST /api/system-coder/maintenance/run   # Trigger maintenance run
GET  /api/system-coder/maintenance/status # Get last run status
GET  /api/system-coder/maintenance/report # Get detailed report
```

#### 5.4 Documentation

```
POST /api/system-coder/docs/sync         # Sync documentation
GET  /api/system-coder/docs/drift        # Check for drift
```

### Phase 6: Scheduler Integration

#### 6.1 Add to `etc/agents.json`

```json
{
  "system-coder": {
    "enabled": true,
    "schedule": "0 3 * * *",  // Daily at 3 AM
    "type": "maintenance",
    "runOnStartup": false,
    "timeout": 1800000
  },
  "system-coder-error-processor": {
    "enabled": true,
    "type": "activity",
    "trigger": "error_captured",
    "cooldown": 300
  }
}
```

### Phase 7: Documentation Sync System

#### 7.1 Documentation Targets

1. **CLAUDE.md** - AI instruction file
   - Keep in sync with actual codebase structure
   - Update when new agents/skills added
   - Reflect API changes

2. **docs/user-guide/** - User documentation
   - Update feature descriptions
   - Add new feature docs
   - Fix outdated information

3. **docs/SYSTEM-INIT.md** - Technical architecture
   - Auto-generated sections
   - Manual annotation sections
   - Change history

#### 7.2 Drift Detection

Compare documentation against actual code:
- Check if documented APIs still exist
- Verify file paths mentioned are valid
- Detect undocumented new features
- Flag removed features still documented

---

## Security Considerations

1. **Approval Required**: All code changes require explicit user approval
2. **Sandbox Execution**: Test commands run in isolated environment
3. **Audit Trail**: All operations logged to audit system
4. **Rollback Support**: Keep backup of modified files
5. **Scope Limits**: Agent can only modify designated directories
6. **Rate Limits**: Max fixes per day, cooldown between operations

---

## Files to Create

### New Files

1. `brain/agents/system-coder.ts` - Main agent
2. `packages/core/src/system-coder/` - Core library
   - `error-capture.ts`
   - `fix-generator.ts`
   - `documentation-sync.ts`
   - `maintenance-runner.ts`
   - `types.ts`
3. `etc/system-coder.json` - Configuration
4. `docs/SYSTEM-INIT.md` - Architecture documentation
5. `scripts/generate-system-init.ts` - Doc generator
6. `apps/site/src/components/SystemCoderDashboard.svelte`
7. `apps/site/src/components/ErrorCard.svelte`
8. `apps/site/src/components/FixReviewModal.svelte`
9. `apps/site/src/stores/systemCoder.ts`
10. API endpoints (8 files in `apps/site/src/pages/api/system-coder/`)

### Modified Files

1. `CLAUDE.md` - Add system coder documentation
2. `apps/site/src/components/LeftSidebar.svelte` - Add menu item
3. `apps/site/src/components/CenterContent.svelte` - Add view routing
4. `apps/site/src/components/TerminalManager.svelte` - Error capture
5. `apps/site/src/components/ChatLayout.svelte` - Console capture
6. `etc/agents.json` - Add scheduler entries
7. `packages/core/src/index.ts` - Export new modules
8. `docs/user-guide/index.md` - Add documentation links

---

## Implementation Order

1. **Week 1**: Error Capture System
   - Create state directory structure
   - Implement error capture from terminal
   - Add web console capture
   - Create basic API endpoints

2. **Week 2**: Core Agent
   - Create system-coder.ts agent
   - Integrate with Big Brother
   - Implement fix generation
   - Add fix staging

3. **Week 3**: UI Components
   - SystemCoderDashboard
   - ErrorCard and FixReviewModal
   - Integrate into LeftSidebar
   - Add stores

4. **Week 4**: Documentation System
   - Create SYSTEM-INIT.md
   - Implement generate-system-init.ts
   - Add drift detection
   - Documentation sync API

5. **Week 5**: Maintenance & Polish
   - Periodic maintenance runner
   - Scheduler integration
   - Testing and refinement
   - Update CLAUDE.md and user guide

---

## Success Metrics

1. **Error Capture Rate**: % of errors automatically captured
2. **Fix Success Rate**: % of proposed fixes that pass tests
3. **Approval Rate**: % of fixes approved by user
4. **Documentation Drift**: # of outdated docs detected/fixed
5. **MTTR**: Mean time from error to fix applied

---

## Open Questions for User

1. **Scope**: Should the coder be able to modify ALL files, or only certain directories?
2. **Auto-apply**: Should low-risk fixes (typos, formatting) be auto-applied without approval?
3. **External APIs**: Should the coder be able to search Stack Overflow or documentation sites?
4. **Test Requirements**: Must all fixes include automated tests?
5. **Notification**: How should the user be notified of captured errors? (Badge, sound, email?)

---

## References

- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Harness AI Self-Healing CI](https://www.harness.io/blog/unscripted-2025-announcements)
- [Google CodeMender](https://deepmind.google/blog/introducing-codemender-an-ai-agent-for-code-security/)
- [Zencoder Autonomous Agents](https://zencoder.ai/blog/autonomous-coding-agents)
- Existing: `packages/core/src/big-brother.ts`
- Existing: `apps/site/src/pages/api/code-approvals/`
- Existing: `brain/agents/operator-react.ts`
