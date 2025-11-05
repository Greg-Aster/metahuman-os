# Agent Scheduler Design

## Problem Statement

Currently, MetaHuman OS has multiple independent services that manage their own timers and triggers:

- **boredom-service.ts**: Manages reflector agent on interval-based triggers
- **sleep-service.ts**: Manages dreamer agent on time-of-day triggers
- **organizer.ts**: Runs on interval-based triggers
- Future agents will need similar scheduling capabilities

This creates a "jumble of monitors" where each agent maintains its own timing logic, leading to:
- Code duplication
- Inconsistent scheduling patterns
- No central visibility into what agents are running when
- Difficult to coordinate between agents
- Hard to implement features like "pause all agents" or "quiet hours"

## Proposed Solution: Central Agent Scheduler

Create a unified **Agent Scheduler** that acts as a central event bus for all agent triggers.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Agent Scheduler                        │
│  (packages/core/src/agent-scheduler.ts)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  • Interval-based triggers (every N seconds/minutes)    │
│  • Time-of-day triggers (daily at 02:00)               │
│  • Event-based triggers (on memory created, etc)        │
│  • Activity-based triggers (15min of inactivity)        │
│  • Dependency triggers (after agent X completes)        │
│                                                          │
│  Features:                                               │
│  - Global pause/resume                                   │
│  - Quiet hours configuration                             │
│  - Agent priority scheduling                             │
│  - Audit logging for all triggers                        │
│  - Health monitoring (detect hung agents)                │
│                                                          │
└─────────────────────────────────────────────────────────┘
           │              │              │
           ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Reflector│   │ Organizer│   │  Dreamer │
    │  Agent   │   │   Agent  │   │   Agent  │
    └──────────┘   └──────────┘   └──────────┘
```

### API Design

```typescript
import { AgentScheduler } from '@metahuman/core';

// Initialize scheduler (singleton)
const scheduler = AgentScheduler.getInstance();

// Register interval-based agent
scheduler.register({
  id: 'reflector',
  type: 'interval',
  interval: 900, // seconds (15 minutes)
  agent: 'reflector.ts',
  enabled: true,
  priority: 'normal',
  autoStart: true,
  runOnBoot: false, // Don't trigger immediately on startup
});

// Register time-of-day agent
scheduler.register({
  id: 'dreamer',
  type: 'time-of-day',
  schedule: '02:00', // Daily at 2 AM
  agent: 'dreamer.ts',
  enabled: true,
  conditions: {
    requiresSleepMode: true, // Only run if user is in "sleep mode"
  },
});

// Register activity-based agent
scheduler.register({
  id: 'boredom-maintenance',
  type: 'activity',
  inactivityThreshold: 900, // 15 minutes of no user activity
  agent: 'operator.ts',
  task: 'Summarize docs/README.md',
  enabled: true,
  priority: 'low',
});

// Register event-based agent
scheduler.register({
  id: 'organizer',
  type: 'event',
  eventPattern: 'memory_created',
  debounce: 60, // Wait 60s after last event
  agent: 'organizer.ts',
  enabled: true,
});

// Control scheduler
scheduler.pause(); // Pause all agents
scheduler.resume(); // Resume all agents
scheduler.setQuietHours('22:00', '08:00'); // No agents during these hours

// Query scheduler state
scheduler.getActiveAgents(); // List currently running agents
scheduler.getNextTriggers(); // Show upcoming scheduled triggers
scheduler.getAgentStatus('reflector'); // Check specific agent status
```

### Configuration File: `etc/agents.json`

```json
{
  "$schema": "https://metahuman.dev/schemas/agents.json",
  "version": "1.0.0",
  "globalSettings": {
    "pauseAll": false,
    "quietHours": {
      "enabled": false,
      "start": "22:00",
      "end": "08:00"
    },
    "maxConcurrentAgents": 3
  },

  "agents": {
    "reflector": {
      "enabled": true,
      "type": "interval",
      "interval": 900,
      "priority": "normal",
      "runOnBoot": false,
      "autoRestart": true
    },

    "organizer": {
      "enabled": true,
      "type": "interval",
      "interval": 60,
      "priority": "high",
      "runOnBoot": false,
      "autoRestart": true
    },

    "dreamer": {
      "enabled": true,
      "type": "time-of-day",
      "schedule": "02:00",
      "priority": "low",
      "conditions": {
        "requiresSleepMode": true
      }
    },

    "boredom-maintenance": {
      "enabled": true,
      "type": "activity",
      "inactivityThreshold": 900,
      "priority": "low",
      "task": {
        "goal": "Summarize docs/README.md and save to out/summaries/",
        "autoApprove": true,
        "profile": "files"
      }
    }
  }
}
```

### Benefits

1. **Centralized Control**: Single place to pause/resume/configure all agents
2. **Visibility**: Easy to see what agents are scheduled and when they'll run
3. **Coordination**: Agents can depend on each other (e.g., "run organizer after memory created")
4. **Debugging**: All agent triggers logged to audit trail
5. **User Experience**:
   - No agents trigger on boot (configurable)
   - Quiet hours support
   - Activity detection (don't interrupt user)
6. **Resource Management**:
   - Prevent too many agents running simultaneously
   - Priority-based scheduling
   - Detect hung agents and restart

### Implementation Plan

**Phase 1: Core Scheduler** (2-3 hours)
- Create `packages/core/src/agent-scheduler.ts`
- Implement interval-based triggers
- Implement time-of-day triggers
- Add configuration loading from `etc/agents.json`
- Add audit logging for all triggers

**Phase 2: Migrate Existing Agents** (1-2 hours)
- Migrate boredom-service.ts to use scheduler
- Migrate sleep-service.ts to use scheduler
- Migrate organizer.ts to use scheduler
- Remove duplicated timer logic

**Phase 3: Advanced Features** (2-3 hours)
- Implement activity-based triggers
- Add event-based triggers
- Add quiet hours support
- Add pause/resume API
- Create UI for agent management

**Phase 4: Web UI Integration** (1-2 hours)
- Add agent scheduler status widget
- Add controls to pause/resume agents
- Add visualization of upcoming triggers
- Add agent logs viewer

### Migration Example: Boredom Service

**Before:**
```typescript
// boredom-service.ts manages its own timers
function startBoredomTimer() {
  const intervalSeconds = config.intervals[currentLevel];
  if (intervalSeconds && intervalSeconds > 0) {
    boredomInterval = intervalSeconds * 1000;
    activeIntervalId = setInterval(runReflectorAgent, boredomInterval);
  }
}
```

**After:**
```typescript
// boredom-service.ts just registers with scheduler
import { AgentScheduler } from '@metahuman/core';

const scheduler = AgentScheduler.getInstance();
const config = getBoredomConfig();

scheduler.register({
  id: 'reflector',
  type: 'interval',
  interval: config.intervals[config.level],
  agent: 'reflector.ts',
  enabled: config.level !== 'off',
  runOnBoot: false,
});

// Scheduler handles all timing, restarts, logging, etc.
```

### Future Extensions

- **Conditional Triggers**: Only run agent if certain conditions are met
- **Rate Limiting**: Prevent agents from running too frequently
- **Health Monitoring**: Detect hung agents and auto-restart
- **Agent Chains**: Run agent B after agent A completes
- **User Override**: Let user manually trigger any agent
- **Statistics**: Track agent execution time, success rate, etc.

### File Structure

```
packages/core/src/
├── agent-scheduler.ts          # Main scheduler implementation
├── agent-scheduler.test.ts     # Unit tests
└── types/
    └── agent-scheduler.ts      # TypeScript interfaces

etc/
└── agents.json                 # Agent configuration file

brain/
└── agents/
    ├── scheduler-service.ts    # Background service that runs scheduler
    ├── reflector.ts           # Modified to work with scheduler
    ├── organizer.ts           # Modified to work with scheduler
    └── dreamer.ts             # Modified to work with scheduler
```

## Decision: Proceed?

This is a significant architectural improvement that will:
- Eliminate code duplication
- Improve user experience (no boot delays)
- Make agent coordination much easier
- Provide better visibility and control

Estimated time: **6-10 hours** for full implementation

Should we proceed with this design?
