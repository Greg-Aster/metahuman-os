# How to Run Comprehensive Codebase Audit with Claude Code

This system allows you to run multiple Claude Code instances in parallel to audit your entire codebase.

## Setup (Run Once)

```bash
# Initialize the audit system - discovers all files
pnpm tsx scripts/audit-init.ts
```

This creates `audit-state.json` with all source files ready to audit.

## Running Claude Code Agents

### Terminal 1 - Agent 1
```bash
claude code
```

Then give Claude this prompt:
```
Your agent name is "Agent-1".

Read and follow the instructions in AUDIT-INSTRUCTIONS.md EXACTLY.

Start by claiming your first file from audit-state.json and begin the comprehensive audit.

Re-read AUDIT-INSTRUCTIONS.md every 3 files to stay on track.
```

### Terminal 2 - Agent 2
```bash
claude code
```

Then give Claude:
```
Your agent name is "Agent-2".

Read and follow the instructions in AUDIT-INSTRUCTIONS.md EXACTLY.

Start by claiming your first file from audit-state.json and begin the comprehensive audit.

Re-read AUDIT-INSTRUCTIONS.md every 3 files to stay on track.
```

### Terminal 3, 4, 5... (Run as many as you want)

Repeat with Agent-3, Agent-4, etc.

## Monitoring Progress

### Check Status Anytime
```bash
pnpm tsx scripts/audit-status.ts
```

Shows:
- Overall completion percentage
- Which agents are working on what
- Issues found/fixed
- Critical issues flagged
- Next pending files

### Watch Real-Time
```bash
watch -n 10 'pnpm tsx scripts/audit-status.ts'
```

Updates every 10 seconds.

## How It Works

1. Each Claude Code instance claims a pending file from `audit-state.json`
2. Claude follows the comprehensive 8-step checklist in `AUDIT-INSTRUCTIONS.md`
3. Claude fixes all issues found (not just documents them)
4. Claude updates `audit-scratchpad.md` with findings
5. Claude marks file complete in `audit-state.json`
6. Claude commits the changes
7. Claude moves to next file

## Coordination

Claude instances coordinate via:
- **audit-state.json** - File claiming prevents duplicates
- **audit-scratchpad.md** - Share findings, blockers, patterns
- **Git commits** - Each file gets committed immediately

## Validation (When Complete)

```bash
# Check if audit is complete and meets all quality standards
pnpm tsx scripts/audit-validate.ts
```

This verifies:
- All files reviewed
- No critical issues unresolved
- No TODOs/FIXMEs remain
- TypeScript compiles
- All files have proper logging

## Expected Timeline

- **Per file**: 60-90 minutes (comprehensive review)
- **With 1 agent**: ~350 hours total
- **With 5 agents**: ~70 hours total
- **With 10 agents**: ~35 hours total

The agents work in parallel, so more agents = faster completion.

## Tips

1. **Run overnight** - Let agents work while you sleep
2. **Monitor for blockers** - Check scratchpad for issues needing attention
3. **Trust the process** - The instructions prevent Claude from cutting corners
4. **Commit often** - Each agent commits after every file

## Files

- `AUDIT-INSTRUCTIONS.md` - Instructions for Claude Code (the agent reads this)
- `audit-state.json` - Tracks which files are pending/in-progress/completed
- `audit-scratchpad.md` - Shared communication between agents
- `scripts/audit-init.ts` - Initialize the audit
- `scripts/audit-status.ts` - Check progress
- `scripts/audit-validate.ts` - Verify completion

## Emergency: Stop All Agents

If you need to stop:
1. In each terminal, tell Claude: "Stop auditing and exit"
2. Check `audit-state.json` to see what was in-progress
3. Change in-progress files back to "pending" if needed
4. Restart agents when ready

## Resuming After Interruption

Just restart Claude Code instances with the same prompt. They'll pick up where they left off by claiming new pending files.

---

**Now go start your Claude Code instances and let them audit!**
