# Sleep Service Documentation

## Overview

The Sleep Service is a core component of MetaHuman OS that manages system idle detection, scheduled maintenance tasks, and autonomous adaptation processes. It operates during designated "sleep windows" when the system detects extended periods of inactivity.

## Architecture

The sleep service consists of several interconnected components:

```
┌─────────────────────────────────────┐
│           Sleep Service             │
│                                     │
│  ┌───────────────────────────────┐   │
│  │    Activity Detection     │   │
│  │                           │   │
│  │  • Timer-based (legacy)   │   │
│  │  • UI-based (current)     │   │
│  └───────────────────────────────┘   │
│                                     │
│  ┌───────────────────────────────┐   │
│  │    Schedule Management    │   │
│  │                           │   │
│  │  • Sleep window detection │   │
│  │  • Idle time monitoring   │   │
│  └───────────────────────────────┘   │
│                                     │
│  ┌───────────────────────────────┐   │
│  │   Nightly Pipeline Orchestration │   │
│  │                           │   │
│  │  • Dream generation       │   │
│  │  • Audio processing       │   │
│  │  • LoRA adaptation        │   │
│  └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Activity Detection

### Legacy Mode (Timer-Based)
Previously, the sleep service used a fixed timer to periodically update the activity timestamp:
```javascript
// Every 5 minutes, system assumed to be active
setInterval(updateActivity, 5 * 60 * 1000);
```

### Current Mode (UI-Based)
The improved system now detects actual user activity through the chat interface:

1. **Frontend Detection**:
   - Keypress events in the chat input field
   - Message submission events
   - Debounced API calls to prevent excessive requests

2. **Backend API Endpoint**:
   - POST `/api/activity-ping` endpoint
   - Calls `updateActivity()` to refresh the timestamp
   - Returns JSON response confirming activity update

3. **Implementation Details**:
   - 3-second debounce to avoid spamming the API
   - Timeout cleanup in component onDestroy lifecycle
   - Automatic clearing of timeouts to prevent memory leaks

## Configuration

The sleep service is configured through `etc/sleep.json`:

```json
{
  "enabled": true,
  "window": { 
    "start": "23:00", 
    "end": "06:30" 
  },
  "minIdleMins": 15,
  "maxDreamsPerNight": 3,
  "showInUI": true,
  "evaluate": true,
  "adapters": { 
    "prompt": true, 
    "rag": true, 
    "lora": false 
  }
}
```

## Nightly Pipeline

During sleep windows when the system is idle, the service executes a comprehensive pipeline:

### 1. Dream Generation
- Runs the `dreamer` agent to generate overnight learnings
- Creates dream memories with source citations
- Extracts preferences and behavioral patterns

### 2. Audio Processing
- Transcribes audio inbox files
- Organizes transcripts into semantic memory
- Archives processed audio files

### 3. LoRA Adaptation (Conditional)
When enabled, performs automated adaptation:
- Builds instruction datasets from recent memories
- Auto-approves quality datasets
- Trains LoRA adapters using Axolotl
- Evaluates adapter quality
- Activates successful adapters

## API Integration

### Frontend Implementation
Located in `apps/site/src/components/ChatInterface.svelte`:

```javascript
function signalActivity() {
  // Clear existing timeout
  if (activityTimeout) {
    clearTimeout(activityTimeout);
  }
  
  // Set a new timeout - signal activity after 3 seconds of no further input
  activityTimeout = window.setTimeout(() => {
    fetch('/api/activity-ping', { method: 'POST' })
      .then(response => {
        if (!response.ok) {
          console.error('Failed to signal activity');
        }
      })
      .catch(error => console.error('Error signaling activity:', error));
  }, 3000); // 3000ms = 3 seconds debounce
}
```

### Backend Implementation
Located in `apps/site/src/pages/api/activity-ping.ts`:

```typescript
import type { APIRoute } from 'astro';
import { updateActivity } from '../../../../../brain/agents/sleep-service';

export const POST: APIRoute = async ({ request }) => {
  try {
    updateActivity(); // Call the function to update the timestamp
    return new Response(JSON.stringify({ message: 'Activity updated' }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to update activity:', error);
    return new Response(JSON.stringify({ error: 'Failed to update activity' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

## Sleep Service Core Logic

Located in `brain/agents/sleep-service.ts`:

### Key Functions

#### `updateActivity()`
Updates the last activity timestamp:
```typescript
let lastActivityTime = Date.now();

function updateActivity() {
  lastActivityTime = Date.now();
}
```

#### `isIdle(minIdleMins: number)`
Determines if the system has been idle for the specified time:
```typescript
function isIdle(minIdleMins: number): boolean {
  const now = Date.now();
  const idleTimeMs = now - lastActivityTime;
  const idleTimeMins = idleTimeMs / (60 * 1000);
  return idleTimeMins >= minIdleMins;
}
```

#### `checkSchedule()`
Main scheduling function that runs every 30 minutes:
```typescript
function checkSchedule() {
  const config = loadSleepConfig();
  
  if (!config.enabled) {
    console.log('[sleep-service] Sleep system is disabled in configuration.');
    return;
  }
  
  resetDayCounter();
  
  const inSleepWindow = isSleepTime(config.window);
  const systemIdle = isIdle(config.minIdleMins);
  
  if (inSleepWindow && systemIdle) {
    console.log('[sleep-service] Sleep conditions met (in window + idle). Starting nightly pipeline...');
    runNightlyPipeline(config).catch(err => {
      console.error('[sleep-service] Nightly pipeline failed:', err);
    });
  }
}
```

## Dual Adapter Integration

The sleep service seamlessly integrates with the dual adapter system:

### LoRA Orchestration
When `adapters.lora` is enabled in configuration:
1. Builds datasets from recent memories
2. Auto-approves quality datasets
3. Trains adapters with automatic GGUF conversion
4. Evaluates adapter quality
5. Activates successful adapters with Ollama integration

### Historical Adapter Merging
- Automatically merges historical adapters using time-weighted averaging
- Creates consolidated `history-merged.gguf` adapter
- Maintains both historical context and recent personalization

## Monitoring and Audit

The sleep service integrates with the system's audit logging:

### Audit Events
- `sleep_service_started` - Service initialization
- `sleep_started` - Sleep window entry
- `nightly_pipeline_started` - Pipeline execution
- `adapter_builder_triggered` - Dataset generation
- `lora_training_started` - Adapter training
- `adapter_activated` - Successful activation

### Log Output
All activities are logged with timestamps and detailed information:
```
[sleep-service] Sleep window: 23:00 - 06:30
[sleep-service] Min idle time: 15 minutes
[sleep-service] Sleep conditions met (in window + idle). Starting nightly pipeline...
```

## Error Handling and Recovery

The service includes comprehensive error handling:

### Graceful Degradation
- Individual pipeline steps can fail without stopping the entire process
- Failed steps are logged and skipped
- System continues with remaining steps

### Retry Logic
- Automatic retry mechanisms for transient failures
- Exponential backoff for network/API calls
- Manual intervention prompts for persistent issues

## Performance Considerations

### Resource Management
- Single-instance guard to prevent multiple concurrent executions
- Efficient memory usage with proper cleanup
- Minimal CPU footprint during idle detection

### Scalability
- Configurable sleep windows to accommodate different usage patterns
- Adjustable idle time thresholds
- Modular pipeline design for easy extension

## Future Enhancements

### Planned Features
1. **Machine Learning-Based Activity Prediction**
   - Predict user activity patterns
   - Adaptive idle time thresholds
   - Proactive system preparation

2. **Cross-Platform Integration**
   - Mobile device activity synchronization
   - Multi-device idle detection
   - Cloud-based coordination

3. **Advanced Power Management**
   - System power state integration
   - Hardware-level power optimization
   - Battery-aware scheduling on mobile devices

### Integration Opportunities
- Calendar integration for scheduled downtime
- Hardware sensors for presence detection
- Network activity monitoring for remote access detection

## Troubleshooting

### Common Issues

#### Activity Detection Not Working
1. **Check**: Ensure the frontend event listeners are properly attached
2. **Verify**: API endpoint `/api/activity-ping` is accessible
3. **Confirm**: Network requests are not being blocked by CORS

#### Sleep Window Not Triggering
1. **Verify**: `etc/sleep.json` configuration is correct
2. **Check**: System clock and timezone settings
3. **Confirm**: Idle time threshold is being met

#### Pipeline Failures
1. **Review**: Audit logs for specific error messages
2. **Check**: Required dependencies (Axolotl, Ollama, etc.)
3. **Verify**: Disk space and system resources

### Debugging Commands
```bash
# Check sleep service status
./bin/mh status

# View recent audit logs
tail -f logs/audit/*.ndjson | grep sleep-service

# Manually trigger sleep service check
./bin/mh agent run sleep-service
```

## Best Practices

### Configuration Recommendations
1. **Set appropriate idle times** based on actual usage patterns
2. **Configure sleep windows** during typical low-activity hours
3. **Enable logging** for monitoring and debugging

### Maintenance Tips
1. **Regularly review audit logs** for unusual patterns
2. **Monitor disk space** for adapter storage
3. **Update dependencies** to maintain compatibility

### Security Considerations
1. **Protect API endpoints** with authentication if exposed externally
2. **Validate input** to prevent injection attacks
3. **Limit adapter execution** to trusted models only

## Conclusion

The Sleep Service is a sophisticated system that balances autonomous operation with user awareness. By transitioning from timer-based to UI-based activity detection, it provides more accurate idle state monitoring while maintaining the system's ability to perform maintenance tasks and adaptations during optimal times.