# Organizer Agent - Migration to Nightly Pipeline

**Date**: 2025-11-09
**Change**: Moved organizer from interval-based (every 60s) to nightly execution
**Reason**: Resource efficiency, privacy, and appropriate scheduling

---

## Problem Statement

The organizer agent was running every 60 seconds with high priority, which had several issues:

1. **Resource Waste**: Running LLM calls every minute for all users, even when no new memories exist
2. **Privacy Concerns**: Processing memories for users who aren't logged in
3. **Inappropriate Frequency**: Memory enrichment doesn't need real-time processing
4. **Console Logging**: Exposed usernames in logs during background processing

---

## Solution

### Changes Made

#### 1. Disabled Interval-Based Execution ([etc/agents.json:27-38](etc/agents.json#L27-L38))

```json
"organizer": {
  "id": "organizer",
  "enabled": false,  // Changed from true
  "type": "interval",
  "priority": "high",
  "agentPath": "organizer.ts",
  "interval": 60,
  "runOnBoot": false,
  "autoRestart": true,
  "maxRetries": 3,
  "comment": "Disabled in favor of nightly pipeline execution (runs once per night via night-pipeline)"
}
```

#### 2. Added to Nightly Pipeline ([sleep-service.ts:161-163](brain/agents/sleep-service.ts#L161-L163))

```typescript
// Step 1: Run organizer to enrich unprocessed memories
console.log('[sleep-service] Running organizer to enrich memories...');
await runAgent('organizer', 'Enrich unprocessed memories with tags and entities');
```

**Pipeline Order**:
1. **Organizer** - Enrich unprocessed memories with tags/entities
2. **Dreamer** - Generate dreams from enriched memories
3. **Night Processor** - Handle audio backlog (transcription + organization)
4. **LoRA Trainer** - Train adapters if enabled

#### 3. Privacy-Friendly Logging ([organizer.ts:247-273](brain/agents/organizer.ts#L247-L273))

**Before**:
```typescript
console.log(`[Organizer] Processing user: ${username}`);
console.log(`[Organizer]   No new memories for ${username}`);
console.log(`[Organizer]   Completed ${username} ✅`);
console.error(`[Organizer] Failed to process user ${username}:`, error);
```

**After**:
```typescript
console.log(`[Organizer] Processing user profile...`);
console.log(`[Organizer]   No new memories found`);
console.log(`[Organizer]   Completed processing ✅`);
console.error(`[Organizer] Failed to process profile:`, error);
```

**Main Cycle** ([organizer.ts:290-317](brain/agents/organizer.ts#L290-L317)):
```typescript
console.log(`[Organizer] Scanning for unprocessed memories...`);
// ... processes each user with isolated context
console.log(`[Organizer] Cycle finished. Processed ${totalProcessed} memories across ${userCount} profiles. ✅`);
```

---

## Benefits

### 1. Resource Efficiency
- **Before**: 1440 agent runs per day (every 60 seconds)
- **After**: 1 agent run per day (during sleep window)
- **Savings**: 99.93% reduction in execution frequency

### 2. Privacy Improvements
- No background processing of inactive users' data during the day
- Only runs during designated sleep window (typically 2:00 AM)
- Console logs no longer expose usernames
- Audit logs still track operations for security/compliance

### 3. Cost Reduction
- Each organizer cycle makes LLM calls (curator role) for unprocessed memories
- Running once per night instead of every minute = massive LLM cost savings
- Fewer wasted calls when no new memories exist

### 4. Appropriate Timing
- Memory enrichment is a **maintenance task**, not real-time requirement
- Running at night ensures:
  - System is likely idle
  - Fresh memories from the day are processed together
  - Results are ready when user returns next day

---

## Behavior

### When Organizer Runs

The organizer now executes:
- **Trigger**: Night pipeline (scheduled at 2:00 AM by default)
- **Conditions** (must meet all):
  - Sleep system enabled (`etc/sleep.json`)
  - Current time within sleep window (2:00 AM - 8:00 AM default)
  - System idle for configured duration (default: 30 minutes)

### What It Does

For each user profile:
1. Scan episodic memory directory for unprocessed files
2. For each unprocessed memory:
   - Extract content
   - Call LLM (curator role) to extract tags and entities
   - Merge results with existing metadata
   - Mark as `processed: true` with timestamp
3. Log aggregate statistics (no individual usernames)

### Multi-User Processing

- Uses `withUserContext()` for isolated context per user
- Automatic cleanup prevents cross-user contamination
- Each user's memories processed in their own profile directory
- Failures in one profile don't affect others

---

## Configuration

### Sleep Window ([etc/sleep.json](etc/sleep.json))

```json
{
  "enabled": true,
  "window": {
    "start": "02:00",
    "end": "08:00"
  },
  "minIdleMins": 30,
  "maxDreamsPerNight": 3,
  "adapters": {
    "lora": true
  }
}
```

### Night Pipeline Schedule ([etc/agents.json:39-49](etc/agents.json#L39-L49))

```json
"night-pipeline": {
  "id": "night-pipeline",
  "enabled": true,
  "type": "time-of-day",
  "priority": "low",
  "agentPath": "night-pipeline.ts",
  "schedule": "02:00",
  "runOnBoot": false,
  "autoRestart": false,
  "maxRetries": 1,
  "comment": "Runs nightly processing: organizer, dreamer, audio backlog, LoRA training (orchestrated by sleep-service.ts)"
}
```

---

## Migration Impact

### For Existing Deployments

**No migration required**. Changes are backward-compatible:
- Existing unprocessed memories will be enriched on next nightly run
- No data format changes
- Audit logs remain consistent

### For Users

**Transparent change**. Users will notice:
- ✅ Memories still get enriched with tags/entities
- ✅ Enrichment happens overnight instead of real-time
- ✅ No performance impact during active hours
- ⚠️ New memories may not be enriched until next morning

### Manual Trigger (if needed)

To run organizer manually outside the nightly pipeline:

```bash
# Direct execution
tsx brain/agents/organizer.ts

# Via CLI (if available)
./bin/mh agent run organizer
```

---

## Monitoring

### Check Last Run

```bash
# View audit logs for organizer
./bin/mh audit stream | grep organizer

# Check nightly pipeline logs
./bin/mh audit stream | grep night_pipeline
```

### Verify Processing

```bash
# Count unprocessed memories (example for one user)
grep -r '"processed": false' profiles/*/memory/episodic/ | wc -l

# Count processed memories
grep -r '"processed": true' profiles/*/memory/episodic/ | wc -l
```

---

## Rollback (if needed)

To restore interval-based execution:

1. Edit [etc/agents.json](etc/agents.json):
   ```json
   "organizer": {
     "enabled": true,  // Change back to true
     ...
   }
   ```

2. Remove from [sleep-service.ts](brain/agents/sleep-service.ts):
   ```typescript
   // Comment out or remove these lines:
   // console.log('[sleep-service] Running organizer to enrich memories...');
   // await runAgent('organizer', 'Enrich unprocessed memories with tags and entities');
   ```

3. Restart agent scheduler

---

## Future Enhancements

Potential improvements:
- **Smart triggering**: Only run if new memories detected
- **Rate limiting**: Process max N memories per user per night
- **User preferences**: Allow users to opt-out of background processing
- **On-demand enrichment**: Enrich memories in real-time when user requests it

---

## Related Documentation

- [Performance Optimizations](PERFORMANCE-OPTIMIZATIONS.md)
- [Sleep Service Documentation](../etc/sleep.json)
- [Agent Scheduler](AGENT-SCHEDULER.md)
- [Privacy & Multi-User System](MULTI-USER-SYSTEM.md)
