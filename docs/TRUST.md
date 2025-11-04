# Trust Levels and Autonomy

## Overview

The trust system controls how autonomous the MetaHuman OS operator can be. It defines what skills are available and whether actions require explicit approval before execution.

**Core Principle**: Trust is earned progressively. Start conservative (`observe`) and increase as the system proves reliable.

## Trust Levels

### 1. `observe` - Monitoring Only

**Philosophy**: "Watch and learn, don't act"

**Behavior**:
- The operator can read files and search memory
- Cannot make any changes or execute commands
- All actions are suggestions that require approval
- Useful for learning patterns without risk

**Available Skills**:
- ✅ `fs_read` - Read files
- ✅ `search_index` - Search memory
- ❌ `fs_write` - Write files
- ❌ `run_agent` - Run agents
- ❌ `shell_safe` - Execute commands

**Approval Required**: All skills

**Use Case**:
- Initial setup and testing
- Learning the system's behavior
- Building confidence in the operator model

---

### 2. `suggest` - Recommendation Mode

**Philosophy**: "Propose actions, but always ask first"

**Behavior**:
- Can propose running agents based on patterns
- Suggests file writes or memory organization
- Every action must be manually approved
- Operator builds a plan, user executes

**Available Skills**:
- ✅ `fs_read` - Read files
- ✅ `search_index` - Search memory
- ✅ `run_agent` - Run agents (with approval)
- ❌ `fs_write` - Write files
- ❌ `shell_safe` - Execute commands

**Approval Required**: All skills

**Use Case**:
- After observing for a while, operator can now suggest actions
- User reviews and approves/rejects each suggestion
- Builds trust through successful suggestions

---

### 3. `supervised_auto` - Supervised Automation

**Philosophy**: "Auto-execute low-risk actions, ask for high-risk ones"

**Behavior**:
- Can automatically read files and search memory (low risk)
- Can write to allowed directories **with approval**
- Can run agents **with approval**
- High-risk actions still require explicit confirmation

**Available Skills**:
- ✅ `fs_read` - Read files (auto)
- ✅ `search_index` - Search memory (auto)
- ✅ `fs_write` - Write files (requires approval)
- ✅ `run_agent` - Run agents (requires approval)
- ❌ `shell_safe` - Execute commands

**Approval Required**:
- ❌ `fs_read`, `search_index` (auto-execute)
- ✅ `fs_write`, `run_agent` (require approval)

**Use Case**:
- After successful supervised suggestions
- Operator can autonomously gather information
- User approves meaningful state changes

---

### 4. `bounded_auto` - Bounded Autonomy

**Philosophy**: "Full autonomy within safe boundaries"

**Behavior**:
- Full autonomy for file operations in allowed directories
- Can run agents and execute whitelisted commands
- **Still requires approval for high-risk actions**
- Bounded by directory permissions and command whitelist

**Available Skills**:
- ✅ `fs_read` - Read files (auto)
- ✅ `search_index` - Search memory (auto)
- ✅ `fs_write` - Write files (requires approval)
- ✅ `run_agent` - Run agents (requires approval)
- ✅ `shell_safe` - Execute whitelisted commands (requires approval)

**Approval Required**:
- ❌ `fs_read`, `search_index` (auto-execute)
- ✅ `fs_write`, `run_agent`, `shell_safe` (require approval)

**Use Case**:
- After extensive successful supervised operation
- Operator handles routine tasks autonomously
- User approves significant changes or risky operations

---

## Trust Progression

```
observe
   │
   │  Demonstrates reliable read-only behavior
   ▼
suggest
   │
   │  Makes good suggestions consistently
   ▼
supervised_auto
   │
   │  Executes low-risk actions reliably
   ▼
bounded_auto
   │
   │  Full autonomy within safe boundaries
   ▼
adaptive_auto (future)
   └─ Self-expands boundaries based on learning
```

### Progression Criteria

**observe → suggest**:
- Operator has run for 7+ days
- No errors or unexpected behavior
- Demonstrates understanding of goals and context

**suggest → supervised_auto**:
- 80%+ of suggestions approved by user
- No rejected suggestions with risk > low
- Consistent alignment with user preferences

**supervised_auto → bounded_auto**:
- 95%+ of actions successful without intervention
- No rollbacks or corrections in past 30 days
- Demonstrated respect for boundaries

## Skill-Specific Approval Rules

Some skills **always** require approval regardless of trust level:

| Skill | Trust Level | Auto-Execute? | Approval Required? |
|-------|-------------|---------------|---------------------|
| `fs_read` | observe+ | Yes (suggest+) | No |
| `search_index` | observe+ | Yes (suggest+) | No |
| `fs_write` | supervised_auto+ | No | **Always** |
| `run_agent` | suggest+ | No | **Always** |
| `shell_safe` | bounded_auto+ | No | **Always** |

**Rationale**:
- Reading is safe → can be automated early
- Writing is permanent → always requires approval
- Agent execution can be expensive → always requires approval
- Shell commands can be risky → always requires approval

## Directory Boundaries

### Read Permissions (all trust levels)

Can read from:
- ✅ `memory/` - All memory types
- ✅ `persona/` - Identity and configuration
- ✅ `logs/` - Audit and agent logs
- ✅ `out/` - Generated outputs
- ✅ `etc/` - Configuration files
- ✅ `docs/` - Documentation

Cannot read from:
- ❌ `brain/` - Code execution risk
- ❌ `packages/` - Core system code
- ❌ `apps/` - Application code
- ❌ `node_modules/` - Dependencies

### Write Permissions (supervised_auto+)

Can write to:
- ✅ `memory/episodic/` - New memories
- ✅ `memory/semantic/` - Knowledge entries
- ✅ `memory/procedural/` - Workflows
- ✅ `memory/tasks/` - Task files
- ✅ `out/` - Generated outputs
- ✅ `logs/` - Log files

**Cannot write to** (protected):
- ❌ `persona/` - Identity kernel protected
- ❌ `brain/` - Code execution risk
- ❌ `packages/` - Core system
- ❌ `apps/` - Application code
- ❌ `etc/` - Critical configuration

## Command Whitelist (bounded_auto only)

Allowed commands:
- `ls` - List files
- `cat` - View files
- `grep` - Search text
- `find` - Find files
- `git` - Version control (status, log, diff only)
- `pnpm` - Package management (list, why only)
- `node` - Run scripts (within metahuman only)
- `tsx` - Run TypeScript (within metahuman only)
- `pwd` - Print working directory
- `whoami` - Current user

**Not allowed**:
- `rm`, `mv`, `cp` - File manipulation (use fs_write skill instead)
- `sudo` - Privilege escalation
- `curl`, `wget` - Network access (future: web_fetch skill)
- `ssh`, `scp` - Remote access
- Anything with shell metacharacters (pipes, redirects) unless explicitly allowed

## Changing Trust Level

### Via CLI

```bash
# View current trust level
./bin/mh trust

# Set trust level
./bin/mh trust observe
./bin/mh trust suggest
./bin/mh trust supervised_auto
./bin/mh trust bounded_auto
```

### Via API

```typescript
import { setTrustLevel, loadTrustLevel } from '@metahuman/core';

const current = loadTrustLevel();
console.log('Current trust level:', current);

setTrustLevel('supervised_auto');
```

### Manual Edit

Edit `persona/decision-rules.json`:

```json
{
  "trust_level": "supervised_auto",
  ...
}
```

## Audit Trail

All trust level changes are audited:

```json
{
  "timestamp": "2025-10-20T12:34:56.789Z",
  "level": "info",
  "category": "security",
  "event": "trust_level_changed",
  "details": {
    "oldLevel": "suggest",
    "newLevel": "supervised_auto"
  },
  "actor": "human"
}
```

## Safety Mechanisms

### 1. Approval Queue

High-risk actions are queued and require explicit approval:

```
┌──────────────────────────────────────┐
│ Pending Approval: fs_write          │
│                                      │
│ Path: memory/tasks/active/task1.json│
│ Content: { "title": "..." }         │
│                                      │
│ Risk: HIGH                           │
│                                      │
│ [Approve] [Reject] [View Details]   │
└──────────────────────────────────────┘
```

### 2. Rollback

All file writes are versioned:

```bash
# View version history
./bin/mh history memory/tasks/active/task1.json

# Rollback to previous version
./bin/mh rollback memory/tasks/active/task1.json --version 2
```

### 3. Dry Run Mode

Test operator actions without execution:

```bash
./bin/mh operator --dry-run "Organize my memories from last week"
```

Shows what would be executed without actually doing it.

### 4. Emergency Stop

```bash
# Stop all running agents
./bin/mh agent stop --all

# Revert to observe mode
./bin/mh trust observe
```

## Best Practices

1. **Start Conservative**: Begin with `observe`, even if you trust the system
2. **Monitor the Audit Log**: Review `logs/audit/` regularly for unexpected behavior
3. **Approve Thoughtfully**: Don't blindly approve high-risk actions
4. **Use Dry Run**: Test new workflows in dry-run mode first
5. **Progressive Trust**: Increase trust gradually based on demonstrated reliability
6. **Define Boundaries**: Customize directory permissions and command whitelist for your needs
7. **Regular Reviews**: Periodically review the trust level and adjust as needed

## Future Enhancements

### Adaptive Trust (Phase 3)

The system will automatically suggest trust level changes:

```
The operator has successfully executed 100 actions over 30 days
with 0 failures. Consider increasing trust level to 'bounded_auto'.

[Accept] [Decline] [Review Stats]
```

### Context-Aware Trust

Different trust levels for different contexts:

```json
{
  "trust_levels": {
    "default": "supervised_auto",
    "memory_organization": "bounded_auto",
    "code_generation": "observe",
    "external_api": "suggest"
  }
}
```

### Time-Based Trust

Higher trust during certain hours:

```json
{
  "trust_schedule": {
    "weekdays_9_to_5": "observe",
    "evenings_and_weekends": "bounded_auto"
  }
}
```
