# Autonomous Agents

Agents are background processes that monitor, plan, and act autonomously within trust boundaries.

## Agent Types

### 1. Event-Driven Agents
Triggered by specific events (file changes, calendar updates, incoming messages).

**Example**: `email-monitor` - watches for new emails, flags urgent ones, drafts responses.

### 2. Scheduled Agents
Run on a fixed schedule (hourly, daily, weekly).

**Example**: `morning-brief` - generates daily summary at 7 AM.

### 3. Continuous Agents
Always running, continuously monitoring and acting.

**Example**: `opportunity-scanner` - constantly searches for relevant information.

## Agent Manifest Format

```json
{
  "name": "morning-brief",
  "version": "0.1.0",
  "description": "Generate daily morning brief with priorities and context",
  "type": "scheduled",
  "schedule": {
    "cron": "0 7 * * *",
    "timezone": "local"
  },
  "permissions": ["read:memory", "read:calendar", "notifications"],
  "riskLevel": "low",
  "enabled": true,
  "config": {
    "lookbackDays": 1,
    "includeCalendar": true,
    "includeActiveTasks": true
  }
}
```

## Agent Lifecycle

1. **Load**: Read manifest, validate permissions
2. **Initialize**: Set up event listeners or schedule
3. **Execute**: Run agent logic
4. **Act**: Execute skills within trust boundaries
5. **Log**: Record all decisions and actions
6. **Pause/Resume**: Can be paused by user or system
7. **Shutdown**: Clean up resources

## Phase 0 Agents

Starting with simple, safe agents:

### `morning-brief`
- **Trigger**: Daily at 7 AM
- **Actions**: Generate brief, send notification
- **Risk**: Low (read-only + notifications)

### `task-watcher`
- **Trigger**: Task changes
- **Actions**: Update dependencies, check for blockers
- **Risk**: Low (task management only)

## Building an Agent

Agents are TypeScript classes that implement the `Agent` interface:

```typescript
interface Agent {
  name: string;
  manifest: AgentManifest;

  initialize(): Promise<void>;
  execute(context: ExecutionContext): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  shutdown(): Promise<void>;
}
```

See `packages/core/src/agents/` for implementation details.
