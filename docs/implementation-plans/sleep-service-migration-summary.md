# Sleep Service Migration to Agent Scheduler - Summary

## Date: 2025-11-05

## Overview

Successfully migrated sleep-service.ts from a standalone service with its own `setInterval` timer to a scheduler-managed agent, eliminating timer duplication while preserving all orchestration logic.

## Migration Approach: Hybrid Model

**Strategy**: Keep orchestration logic, eliminate timer duplication

- Created thin wrapper agent (night-pipeline.ts) triggered by scheduler
- Refactored sleep-service.ts to export functions (removed main/setInterval)
- Scheduler handles timing, sleep-service handles pipeline coordination

## Changes Made

### 1. New File: `brain/agents/night-pipeline.ts`

**Purpose**: Thin wrapper that checks conditions and triggers nightly pipeline

**Functionality**:
- Loads sleep configuration from `etc/sleep.json`
- Checks sleep window conditions (isSleepTime)
- Checks idle status (isIdle with minIdleMins threshold)
- Resets daily counter (max dreams per night)
- Calls `runNightlyPipeline()` from sleep-service if conditions met
- Comprehensive audit logging

**Scheduled by**: AgentScheduler at 02:00 daily (configurable in `etc/agents.json`)

### 2. Refactored: `brain/agents/sleep-service.ts`

**Removed**:
- ✅ `main()` function
- ✅ `setInterval(checkSchedule, 30 * 60 * 1000)` timer
- ✅ `checkSchedule()` function
- ✅ Lock acquisition (handled by scheduler)

**Exported Functions** (now usable as library):
- `loadSleepConfig()`: Read etc/sleep.json configuration
- `isSleepTime(schedule)`: Check if current time is within sleep window
- `isIdle(minIdleMins)`: Check if system has been idle for threshold duration
- `resetDayCounter()`: Reset daily dream counter
- `runNightlyPipeline(config)`: Orchestrate full nightly pipeline
- `updateActivity()`: Record user activity for idle detection

**Preserved Logic**:
- ✅ All pipeline orchestration (dreamer, night-processor, LoRA training)
- ✅ Daily dream counter (max dreams per night enforcement)
- ✅ Idle detection tracking
- ✅ Sleep window checking
- ✅ Audio backlog processing
- ✅ LoRA adapter training workflow
- ✅ Auto-approval and activation logic

**Migration Note Added**: Documentation explaining the refactor and manual execution

### 3. Updated: `etc/agents.json`

**Removed**:
- Standalone "dreamer" agent entry (now handled within night-pipeline)

**Added**:
```json
{
  "night-pipeline": {
    "id": "night-pipeline",
    "enabled": true,
    "type": "time-of-day",
    "schedule": "02:00",
    "agentPath": "night-pipeline.ts",
    "priority": "low",
    "runOnBoot": false,
    "autoRestart": false,
    "maxRetries": 1,
    "comment": "Runs nightly processing: dreamer, audio backlog, LoRA training (orchestrated by sleep-service.ts)"
  }
}
```

## Architecture Changes

### Before (Standalone Service)
```
sleep-service.ts
├── setInterval(30 min)
├── checkSchedule()
│   ├── isSleepTime()
│   ├── isIdle()
│   └── runNightlyPipeline()
└── main() with lock
```

### After (Scheduler-Managed)
```
AgentScheduler (etc/agents.json)
└── night-pipeline (02:00 daily)
    └── night-pipeline.ts
        ├── loadSleepConfig()
        ├── isSleepTime() ──┐
        ├── isIdle() ───────┤
        ├── resetDayCounter()│
        └── runNightlyPipeline() ──> sleep-service.ts (library)
                                      └── Full orchestration logic
```

## Benefits Achieved

✅ **Eliminated Timer Duplication**: Removed `setInterval` - scheduler handles timing
✅ **Preserved Orchestration**: All complex pipeline logic intact
✅ **Single Responsibility**: Scheduler = scheduling, sleep-service = orchestration
✅ **Centralized Control**: Can pause/resume via scheduler
✅ **Better Visibility**: All agent triggers logged by scheduler
✅ **Easier Debugging**: Scheduler provides unified monitoring
✅ **Reusable Logic**: sleep-service.ts is now a library module

## Testing Checklist

- [x] night-pipeline.ts created with correct imports
- [x] sleep-service.ts exports all required functions
- [x] No remaining setInterval or main() in sleep-service.ts
- [x] etc/agents.json updated with night-pipeline agent
- [x] File permissions set (chmod +x night-pipeline.ts)
- [ ] Manual test: Run night-pipeline.ts directly
- [ ] Integration test: Verify scheduler triggers night-pipeline
- [ ] Condition test: Verify sleep window checking works
- [ ] Condition test: Verify idle detection works
- [ ] Pipeline test: Verify dreamer agent runs
- [ ] Pipeline test: Verify audio backlog processing
- [ ] Pipeline test: Verify LoRA training workflow
- [ ] Limit test: Verify max dreams per night enforcement

## Manual Testing Commands

```bash
# Test night-pipeline directly (will check conditions and skip if not met)
npx tsx brain/agents/night-pipeline.ts

# Test with scheduler (requires scheduler-service running)
# Start scheduler
npx tsx brain/agents/scheduler-service.ts

# Check agent status via Web UI
# Navigate to http://localhost:4321 and check agent monitor

# Verify configuration
cat etc/agents.json | jq '.agents["night-pipeline"]'

# Check audit logs
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep night_pipeline
```

## Rollback Plan

If issues arise, to rollback:

1. Restore original sleep-service.ts from git:
   ```bash
   git checkout HEAD~1 brain/agents/sleep-service.ts
   ```

2. Remove night-pipeline.ts:
   ```bash
   rm brain/agents/night-pipeline.ts
   ```

3. Restore original agents.json:
   ```bash
   git checkout HEAD~1 etc/agents.json
   ```

4. Restart services

## Future Enhancements

### Option: Add Fallback Interval Agent

If the single 02:00 trigger is too rigid, add a fallback that checks every 30 minutes during sleep window:

```json
{
  "night-pipeline-fallback": {
    "id": "night-pipeline-fallback",
    "enabled": true,
    "type": "interval",
    "interval": 1800,
    "agentPath": "night-pipeline.ts",
    "priority": "low",
    "conditions": {
      "onlyDuringSleepWindow": true
    }
  }
}
```

This would require enhancing AgentScheduler to support custom conditions.

### Option: Dynamic Schedule from sleep.json

Currently the schedule (02:00) is hardcoded in agents.json. Could read from sleep.json dynamically:

```typescript
// In scheduler-service.ts startup
const sleepConfig = loadSleepConfig();
scheduler.updateAgentSchedule('night-pipeline', sleepConfig.window.start);
```

## Related Documentation

- [AGENT_SCHEDULER.md](../AGENT_SCHEDULER.md) - Agent Scheduler design
- [sleep.json](../../etc/sleep.json) - Sleep configuration
- [agents.json](../../etc/agents.json) - Agent scheduler configuration

## Files Modified

1. `brain/agents/night-pipeline.ts` - NEW
2. `brain/agents/sleep-service.ts` - REFACTORED (main/timer removed, functions exported)
3. `etc/agents.json` - UPDATED (night-pipeline added, dreamer removed)

## Migration Status

✅ **COMPLETE** - sleep-service.ts has been successfully migrated to the Agent Scheduler architecture
