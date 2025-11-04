## Security & Trust Model

### Trust Levels (Progressive Autonomy)
1. **`observe`** - Monitor only, learn patterns (no autonomous actions)
2. **`suggest`** - Propose actions, require manual approval
3. **`supervised_auto`** - Execute within pre-approved categories
4. **`bounded_auto`** - Full autonomy within defined boundaries
5. **`adaptive_auto`** - Self-expand boundaries based on learning (experimental)

### Trust Progression
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

### Trust Progression Criteria
- **observe → suggest**: Operator has run for 7+ days, no errors, demonstrates understanding of goals
- **suggest → supervised_auto**: 80%+ of suggestions approved, no high-risk rejects, consistent alignment
- **supervised_auto → bounded_auto**: 95%+ success rate, no rollbacks in 30 days, respect for boundaries

### Trust Levels and Skill Availability

| Trust Level       | Available Skills | Auto-Execute? | Approval Required? |
|-------------------|------------------|---------------|--------------------|
| `observe`         | fs_read, search_index | No | All skills |
| `suggest`         | fs_read, search_index, run_agent | No | All skills |
| `supervised_auto` | All except shell_safe | Yes (low risk) | High-risk only |
| `bounded_auto`    | All | Yes (all) | High-risk only |

### Skill-Specific Approval Rules
Some skills **always** require approval regardless of trust level:
- `fs_write` - Write files (requires approval)
- `run_agent` - Run agents (requires approval)
- `shell_safe` - Execute whitelisted commands (requires approval)

**Rationale**:
- Reading is safe → can be automated early
- Writing is permanent → always requires approval
- Agent execution can be expensive → always requires approval
- Shell commands can be risky → always requires approval

### Directory Boundaries

#### Read Permissions (all trust levels)
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

#### Write Permissions (supervised_auto+)
Can write to:
- ✅ `memory/episodic/` - New memories
- ✅ `memory/semantic/` - Knowledge entries
- ✅ `memory/procedural/` - Workflows
- ✅ `memory/tasks/` - Task files
- ✅ `out/` - Generated outputs
- ✅ `logs/` - Log files

Cannot write to (protected):
- ❌ `persona/` - Identity kernel protected
- ❌ `brain/` - Code execution risk
- ❌ `packages/` - Core system
- ❌ `apps/` - Application code
- ❌ `etc/` - Critical configuration

### Command Whitelist (bounded_auto only)
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

Not allowed:
- `rm`, `mv`, `cp` - File manipulation (use fs_write skill instead)
- `sudo` - Privilege escalation
- `curl`, `wget` - Network access (future: web_fetch skill)
- `ssh`, `scp` - Remote access
- Anything with shell metacharacters (pipes, redirects) unless explicitly allowed

### View Current Trust Level
```bash
./bin/mh trust
```

### Set Trust Level
```bash
./bin/mh trust bounded_auto
```

**Configured in:** `persona/decision-rules.json`

### Security & Privacy

#### Local-First by Design
- All data stays on your machine
- No cloud services required
- Ollama runs locally

#### Complete Audit Trail
Every operation is logged to `logs/audit/YYYY-MM-DD.ndjson` with:
- Timestamp
- Actor (human, agent name, or system)
- Category (system, action, data_change, security, decision)
- Level (info, warn, error)
- Full context and metadata

#### Progressive Trust
Start with `observe` mode and gradually increase autonomy as you build trust.

#### Human-Readable Data
All memories, tasks, and configuration are JSON files you can inspect and edit directly.

### Trust Boundaries (Per Skill)

Each skill is classified by risk level and has associated boundaries:

**Read-Only Skills:**
- Can access information but not modify
- Safe for autonomous operation at any trust level
- Examples: `fs_read`, `search_index`, `list_tasks`

**Low-Risk Skills:**
- Minor changes with minimal consequences
- Can auto-execute at `supervised_auto` level
- Examples: notifications, drafts, scheduling suggestions
- Easily reversible if mistakes occur

**Medium-Risk Skills:**
- Requires approval below certain thresholds
- May execute autonomously if within approved categories
- Examples: sending messages, minor purchases (< $X), file modifications
- Impact is moderate but manageable

**High-Risk Skills:**
- Always requires approval regardless of trust level
- Significant impact or irreversible consequences
- Examples: financial transactions, legal documents, account modifications
- Human review mandatory

**Forbidden Skills:**
- Never autonomous, even at highest trust levels
- Critical operations requiring human judgment
- Examples: account deletion, major commitments, system-wide changes
- Safety override prevents execution

### Safety Mechanisms

MetaHuman OS implements multiple layers of safety to ensure autonomous operation remains safe and controllable:

**1. Dry-Run Mode:**
- Preview all changes before execution
- See exactly what the system plans to do
- Test workflows without side effects
- Validate skill parameters

**2. Undo Buffer:**
- Reversible actions with rollback capability
- File versioning for all writes
- Memory of previous states
- Quick recovery from mistakes

**3. Rate Limits:**
- Prevent runaway behavior
- Maximum actions per hour/day
- Cooldown periods for high-risk operations
- Throttling for API calls

**4. Confidence Thresholds:**
- Escalate when uncertainty is high
- Require approval for low-confidence decisions
- Learn from corrections to improve confidence
- Adaptive threshold adjustment

**5. Kill Switch:**
- Instant halt of all autonomous operations
- Emergency stop button
- Revert to observe mode immediately
- Preserve state for debugging

**6. Complete Audit Trail:**
- Logs of all reasoning and actions
- Full context for every decision
- Immutable append-only log
- Query and analyze past behavior

**7. Regular Reviews:**
- Weekly human oversight of autonomous decisions
- Monthly audit reports
- Pattern analysis for anomalies
- Continuous alignment checks

### Approval Queue Workflow

When a skill requires approval:

1. **Skill Execution Attempted** - Agent or system tries to execute a high-risk skill
2. **Queued for Approval** - Item added to approval queue with full context
3. **User Notified** - Badge appears in web UI sidebar
4. **User Reviews** - See skill name, description, parameters, and risk level
5. **Decision Made** - User approves or rejects the execution
6. **Action Taken** - If approved, skill executes immediately with full audit logging

**View Approval Queue:**
- Web UI: Click "Approvals" in left sidebar
- CLI: `./bin/mh approvals list`

**Approve/Reject:**
- Web UI: Click "Approve & Execute" or "Reject" buttons
- CLI: `./bin/mh approvals approve <id>` or `./bin/mh approvals reject <id>`

### Emergency Procedures

**Stop All Agents:**
```bash
./bin/mh agent stop-all
```

**Revert to Observe Mode:**
```bash
./bin/mh trust observe
```

**Review Recent Actions:**
```bash
./bin/mh audit --since "1 hour ago"
```

**Clear Approval Queue:**
```bash
./bin/mh approvals clear
```

---

