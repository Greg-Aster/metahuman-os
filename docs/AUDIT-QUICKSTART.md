# Deprecated Audit Quickstart

This workflow is retained for historical context only. Do not use it for current refactor work.

Current audit authority:

- `docs/technical/AUDIT_PROTOCOL.md`
- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/audits/consolidation-progress.md`

The old workflow asked agents to mutate every file, write local scratchpad state, and commit per file. That crosses the current architecture and remote-safety rules. Current audit work must inventory and report first, then create scoped refactor tickets.

---

# Historical Audit Quickstart - 3 Steps to Start

## Step 1: Initialize (30 seconds)

```bash
pnpm tsx scripts/audit-init.ts
```

This discovers all your source files and sets up `audit-state.json`.

## Step 2: Start Claude Code Instances (2 minutes per agent)

Open as many terminal windows as you want (recommended: 5-10).

In each terminal:

```bash
claude code
```

Then copy-paste this (change the number for each agent):

```
Your agent name is "Agent-1".

Read and follow the instructions in AUDIT-INSTRUCTIONS.md EXACTLY.

Start by claiming your first file from audit-state.json and begin the comprehensive audit.

Re-read AUDIT-INSTRUCTIONS.md every 3 files to stay on track.
```

Replace "Agent-1" with "Agent-2", "Agent-3", etc. for each terminal.

## Step 3: Monitor Progress

In a separate terminal, run:

```bash
# Check once
pnpm tsx scripts/audit-status.ts

# Or watch continuously (updates every 10 sec)
watch -n 10 'pnpm tsx scripts/audit-status.ts'
```

---

## That's it!

The Claude agents will:
1. Claim files from audit-state.json
2. Audit them comprehensively (60-90 min each)
3. Fix all issues found
4. Update audit-scratchpad.md
5. Commit changes
6. Move to next file

You just monitor progress and let them work.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pnpm tsx scripts/audit-init.ts` | Initialize audit system |
| `pnpm tsx scripts/audit-status.ts` | Check progress |
| `pnpm tsx scripts/audit-validate.ts` | Verify completion |
| `cat AGENT-PROMPT.txt` | See copy-paste prompt template |

---

## When Complete

Run validation:

```bash
pnpm tsx scripts/audit-validate.ts
```

This checks:
- ✅ All files reviewed
- ✅ No critical issues
- ✅ No TODOs/FIXMEs
- ✅ TypeScript compiles
- ✅ All files have proper logging

If validation passes: **AUDIT COMPLETE!** 🎉

If not: The script tells you what's missing.
