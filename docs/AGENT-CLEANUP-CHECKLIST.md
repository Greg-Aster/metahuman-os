# Agent System Cleanup Checklist

**Status: CLEANUP COMPLETE** (2024-12-15)

All legacy single-file agents have been removed. The modular agent system is now the only implementation.

## Cleanup Summary

### Legacy Files Removed (20 files)
All of these legacy single-file agents have been deleted:
- ~~desire-generator.ts~~ → `desire-generator/`
- ~~desire-planner.ts~~ → `desire-planner/`
- ~~desire-executor.ts~~ → `desire-executor/`
- ~~desire-outcome-reviewer.ts~~ → `desire-outcome-reviewer/`
- ~~digest.ts~~ → `digest/`
- ~~transcriber.ts~~ → `transcriber/`
- ~~audio-organizer.ts~~ → `audio-organizer/`
- ~~system-coder.ts~~ → `coder/`
- ~~train-of-thought.ts~~ → `train-of-thought/`
- ~~curiosity-researcher.ts~~ → `curiosity-researcher/`
- ~~psychoanalyzer.ts~~ → `psychoanalyzer/`
- ~~reflector.ts~~ → `reflector/`
- ~~dreamer.ts~~ → `dreamer/`
- ~~organizer.ts~~ → `organizer/`
- ~~ingestor.ts~~ → `ingestor/`
- ~~curiosity-service.ts~~ → `curiosity-service/`
- ~~inner-curiosity.ts~~ → `inner-curiosity/`
- ~~profile-sync.ts~~ → `profile-sync/`
- ~~night-processor.ts~~ → `night-pipeline/`
- ~~curator.ts~~ → `curator/`

### Modular Agents (21 directories)
All agents now use the new structure with `core.ts`, `cli.ts`, and `index.ts`:
```
brain/agents/
├── audio-organizer/
├── coder/
├── curator/
├── curiosity-researcher/
├── curiosity-service/
├── desire-executor/
├── desire-generator/
├── desire-outcome-reviewer/
├── desire-planner/
├── digest/
├── dreamer/
├── ingestor/
├── inner-curiosity/
├── night-pipeline/
├── operator/
├── organizer/
├── profile-sync/
├── psychoanalyzer/
├── reflector/
├── train-of-thought/
└── transcriber/
```

### Files Kept (utilities/services)
These are NOT agents - they're utilities or services:
- `sleep-service.ts` - Utility module used by night-pipeline
- `scheduler-service.ts` - Service entry point
- `operator-react.ts` - Operator system
- `memory-sync.ts` - Sync utility
- Training scripts: `adapter-builder.ts`, `fine-tune-*.ts`, `lora-trainer.ts`, etc.

## Remaining Cleanup (Optional)

### 1. agent-scheduler.ts - Legacy Fallback
The scheduler still has legacy spawn code as fallback. Can be removed once verified:

```typescript
// Lines ~757-823 in runAgentFile() - legacy spawn fallback
// Can be removed once all agents are confirmed working via runtime
```

### 2. /api/agents/run.ts - Legacy Path Resolution
Can simplify `resolveAgentPath()` to only check for modular agents:

```typescript
// Remove legacy fallback check for *.ts files
```

### 3. agent-monitor.ts - Updated
Already updated to discover both legacy files AND modular directories.

## Testing Status

- [x] Web server: Agent monitor shows all modular agents
- [x] Web server: Manual agent triggers via `/api/agents/run` work
- [ ] Mobile: All agents run via mobile-scheduler
- [x] Scheduler starts without errors
- [x] No import errors

---

Created: 2024-12-14
Completed: 2024-12-15
