# Agent System Cleanup Checklist

After verifying the new modular agent system works correctly, use this checklist to remove legacy code.

## Pre-Cleanup Testing

Run these tests before removing any legacy code:

- [ ] Web server: All agents run successfully via scheduler
- [ ] Web server: Manual agent triggers via `/api/agents/run` work
- [ ] Mobile: All agents run via mobile-scheduler
- [ ] Verify agent locks work (no duplicate runs)
- [ ] Verify agent results are logged to audit

## Legacy Single-File Agents to Remove

These files have been replaced by modular directories (`brain/agents/<name>/`):

```
brain/agents/
├── desire-generator.ts      → brain/agents/desire-generator/
├── desire-planner.ts        → brain/agents/desire-planner/
├── desire-executor.ts       → brain/agents/desire-executor/
├── desire-outcome-reviewer.ts → brain/agents/desire-outcome-reviewer/
├── digest.ts                → brain/agents/digest/
├── transcriber.ts           → brain/agents/transcriber/
├── audio-organizer.ts       → brain/agents/audio-organizer/
├── system-coder.ts          → brain/agents/coder/
├── train-of-thought.ts      → brain/agents/train-of-thought/
├── curiosity-researcher.ts  → brain/agents/curiosity-researcher/
├── psychoanalyzer.ts        → brain/agents/psychoanalyzer/
├── reflector.ts             → brain/agents/reflector/
├── dreamer.ts               → brain/agents/dreamer/
├── organizer.ts             → brain/agents/organizer/
├── ingestor.ts              → brain/agents/ingestor/
├── curiosity-service.ts     → brain/agents/curiosity-service/
├── inner-curiosity.ts       → brain/agents/inner-curiosity/
├── profile-sync.ts          → brain/agents/profile-sync/
├── night-processor.ts       → brain/agents/night-pipeline/
└── curator.ts               → brain/agents/curator/
```

**DO NOT REMOVE** (still in use as utilities or not migrated):
- `sleep-service.ts` - Utility module used by night-pipeline
- `scheduler-service.ts` - Service entry point (not an agent)
- `operator.ts` / `operator-react.ts` - Operator system (separate from agents)
- `memory-sync.ts` - May still be referenced

## Files to Check for Legacy Imports

After removing legacy agents, search for and update any remaining imports:

```bash
# Find imports of old agent files
grep -r "from.*brain/agents/[a-z-]*\.js" packages/ apps/
grep -r "from.*brain/agents/[a-z-]*\.ts" packages/ apps/

# Specific patterns to check
grep -r "desire-generator\.js" --include="*.ts"
grep -r "desire-planner\.js" --include="*.ts"
grep -r "digest\.js" --include="*.ts"
```

## Code to Simplify After Cleanup

### 1. agent-scheduler.ts - Remove Legacy Fallback
Once all agents use the runtime, remove the legacy spawn code:

```typescript
// REMOVE this fallback block in runAgentFile():
// Fall back to legacy tsx spawn for non-modular agents
console.log(`[AgentScheduler] Running agent '${config.agentPath}' via legacy spawn`);
return new Promise((resolve, reject) => {
  // ... spawn code
});
```

### 2. mobile-agents.ts - Consider Using Runtime Directly
The wrapper functions could potentially be replaced with direct runtime calls:

```typescript
// Current: Individual wrapper functions
async function runOrganizer(context: MobileAgentContext): Promise<void> { ... }

// Future: Could use runtime directly
// const result = await runtime.run('organizer', ctx, input);
```

### 3. /api/agents/run.ts - Remove Legacy Path Resolution
Once all agents are modular, simplify `resolveAgentPath()`:

```typescript
// REMOVE legacy fallback:
// Legacy single-file agent
const legacyPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
if (fs.existsSync(legacyPath)) {
  return legacyPath;
}
```

## etc/agents.json Updates

Update agent paths from legacy to new structure:

```json
// Before
"agentPath": "reflector.ts"

// After (optional - the system auto-derives ID)
"agentPath": "reflector/cli.ts"
```

## Cleanup Commands

```bash
# After testing passes, remove legacy files:
cd /home/greggles/metahuman

# Remove legacy single-file agents (BE CAREFUL - test first!)
rm brain/agents/desire-generator.ts
rm brain/agents/desire-planner.ts
rm brain/agents/desire-executor.ts
rm brain/agents/desire-outcome-reviewer.ts
rm brain/agents/digest.ts
rm brain/agents/transcriber.ts
rm brain/agents/audio-organizer.ts
rm brain/agents/system-coder.ts
rm brain/agents/train-of-thought.ts
rm brain/agents/curiosity-researcher.ts
rm brain/agents/psychoanalyzer.ts
rm brain/agents/reflector.ts
rm brain/agents/dreamer.ts
rm brain/agents/organizer.ts
rm brain/agents/ingestor.ts
rm brain/agents/curiosity-service.ts
rm brain/agents/inner-curiosity.ts
rm brain/agents/profile-sync.ts
rm brain/agents/night-processor.ts
rm brain/agents/curator.ts

# Verify nothing breaks
pnpm build
```

## Post-Cleanup Verification

- [ ] `pnpm build` succeeds
- [ ] No import errors in logs
- [ ] Web UI agent controls work
- [ ] Scheduler starts without errors
- [ ] Mobile app agents work

## Notes

- The new modular agents in `brain/agents/<name>/core.ts` re-export from the legacy files in many cases
- Once legacy files are removed, you may need to move the actual logic into `core.ts`
- Some agents have large implementations (desire-generator: 1243 lines) - consider whether to keep them separate or inline

---

Created: 2024-12-14
Status: Pending user testing
