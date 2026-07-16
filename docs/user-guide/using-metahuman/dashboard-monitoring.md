# Dashboard & Monitoring

The Dashboard provides a comprehensive overview of your MetaHuman OS system status, including memory statistics, agent activity, model information, and system health metrics.

## Overview

The Dashboard displays:
- **System Status**: Overall health and running services
- **Memory Statistics**: Episode counts, storage usage, index status
- **Agent Activity**: Running agents and recent activity
- **Model Information**: Active LLM models and adapters
- **Task Summary**: Active and completed task counts
- **Recent Activity**: Latest memories and events
- **Service Status**: TTS, STT, and other background services

## Accessing the Dashboard

1. Open the web UI at `http://localhost:4321`
2. Click **Dashboard** in the left sidebar
3. Dashboard loads with real-time data

Alternatively via CLI:
```bash
# Check system status
./bin/mh status

# View agent status
./bin/mh agent status

# Monitor agent activity
./bin/mh agent monitor
```

## Dashboard Sections

### System Overview

**Displays:**
- MetaHuman OS version
- Active cognitive mode (Dual/Agent/Emulation)
- Current user profile
- System uptime
- Trust level

**Actions:**
- Quick mode switching
- Profile management
- Trust level adjustment

### Memory Statistics

**Displays:**
- Total episodic memories
- Breakdown by type (conversations, observations, inner dialogue, dreams, tasks)
- Storage usage (MB)
- Vector index status
- Recent memory growth rate

**Example:**
```
Total Memories: 1,247
├─ Conversations: 342
├─ Observations: 189
├─ Inner Dialogue: 456
├─ Dreams: 92
└─ Tasks: 168

Storage: 45.2 MB
Vector Index: Built (1,247 vectors)
Last 7 days: +87 memories
```

### Agent Monitor

**Displays:**
- Running agents with PID
- Agent statistics (runs, success rate)
- Last execution time
- Processing status
- Agent logs (recent 50 entries)

The Agent Monitor uses the canonical Agent Catalog for names, executable health,
and lifecycle authorization. Persistent services are started as processes;
finite agents are admitted to the Work Coordinator.

**Actions:**
- Start, stop, and restart persistent services
- Submit finite agent work through the Work Coordinator
- View detailed logs
- Monitor coordinator work items and terminal history

### Agent Catalog

**Displays:**

- every maintained installed agent and persistent service;
- Trigger Manager registration and enabled state;
- installed-but-unscheduled agents;
- source aliases and workflow-parent relationships;
- privileged/destructive risk, LLM use, source health, and ownership.

Use **System → Agent Catalog** to register an installed finite agent with its
safe default trigger, unregister it without deleting source or history, enable
or disable registered triggers, and submit manual runs. Scheduling details remain
under **System → Trigger Manager**.

The **Mood** catalog card also exposes its per-user review settings and current
review state. Its smaller Trigger Manager/Queue display reports the counted
message trigger and next idle-baseline deadline; it appears in the running
process list only while a queued Mood run is actually executing.

### Model Information

**Displays:**
- Active LLM model and provider (Ollama, OpenAI, etc.)
- LoRA adapter status (if using dual-adapter system)
  - Historical adapter: Consolidated long-term memory
  - Recent adapter: Last 14 days training
- Model role assignments (orchestrator, persona, curator, fallback)
- Cognitive mode mappings

**Example:**
```
Active Model: greggles-dual-2025-11-22
├─ Historical: history-merged.gguf
└─ Recent: 2025-11-22/adapter.gguf

Roles:
├─ persona: greggles-dual-2025-11-22
├─ orchestrator: default.coder
└─ curator: default.coder
```

### Task Summary

**Displays:**
- Active tasks count
- In-progress tasks
- Completed today
- Overdue tasks
- Upcoming due dates

**Quick Actions:**
- View all tasks
- Create new task
- Mark tasks complete

### Recent Activity

**Displays:**
- Last 10 memories created
- Recent agent runs
- Recent skill executions
- System events

**Filterable by:**
- Memory type
- Time range
- Agent/source

## Developer Sidebar (Right Sidebar)

### Audit Stream

**Enhanced Task Grouping:**
- Live events collapsed into high-level task cards
- ReAct iterations, summarizer cycles, approvals visible at a glance
- Expandable detail for chronological sub-events
- Timestamp, severity badge, actor, and summary for each event

**Detail Drawer:**
- "View JSON" action opens slide-out panel
- Full payload with copy-to-clipboard
- Keeps main list uncluttered while preserving raw access

**Filtering & Search:**
- Filter chips: info/warn/error, category, actor
- Search bar for specific events
- Category filters: system, action, data_change, security, decision
- Performance: Recent groups in memory, older ones load on demand

### Agent Monitor

**Real-time Stats:**
- Agent execution counts
- Success/failure rates
- Average execution time
- Processing queue length

**Agent Controls:**
- Start/stop individual agents
- View agent logs
- Monitor processing status

### Boredom Control

**Settings:**
- Reflection frequency: high (~1 min), medium (~5 mins), low (~15 mins), off
- Configures `etc/agents.json`
- Applied live by TriggerConfigService and evaluated by TriggerManager
- Controls boredom-maintenance agent activity

### Model Selector

**Quick Switching:**
- Dropdown list of available Ollama models
- Switch active model for chat/persona
- See current model and adapter status
- Reload model registry

## System Metrics

### GPU Monitor

**If GPU available:**
- GPU utilization percentage
- VRAM usage (used/total)
- Temperature
- Process-specific GPU usage
- Multi-GPU support

**Displays:**
- Real-time graphs
- Historical metrics
- GPU model and driver version

### Service Status

**Monitored Services:**
- **Kokoro TTS**: Text-to-speech server status
- **Whisper STT**: Speech-to-text server status
- **Cloudflare Tunnel**: Public URL status (if enabled)
- **Maintenance Service**: Lock, audit-log, and embedding-preload maintenance
- **Environment Bridge**: Configured environment-adapter connection
- **Background Agents**: Individual agent health

**Status Indicators:**
- 🟢 Running
- 🔴 Stopped
- 🟡 Starting/Error

### Network Status

**Cloudflare Tunnel:**
- Public URL (if configured)
- Tunnel status
- Connection health
- Traffic statistics

**Local Network:**
- Web UI port (default: 4321)
- TTS server port (if running)
- STT server port (if running)

## CLI Monitoring Commands

```bash
# System status overview
./bin/mh status

# Agent statistics
./bin/mh agent status

# Live agent monitoring
./bin/mh agent monitor

# List running agents
./bin/mh agent ps

# Check Ollama status
./bin/mh ollama status

# List Ollama models
./bin/mh ollama list

# Vector index status
./bin/mh index status

# Task overview
./bin/mh task

# Memory statistics
./bin/mh remember --stats
```

## Alerts & Notifications

### System Alerts

**Dashboard shows alerts for:**
- Low disk space
- Agent failures
- Model loading errors
- Service crashes
- High memory usage
- Training failures

### Agent Alerts

**Monitors:**
- Stale lock files (crashed agents)
- Processing queue backlog
- Repeated failures
- Long-running operations

### Resource Alerts

**Monitors:**
- CPU usage spikes
- Memory (RAM) pressure
- GPU VRAM exhaustion (if applicable)
- Disk I/O saturation

## Performance Metrics

### Memory Performance

- Episodic memory write speed (events/sec)
- Vector index query latency
- Memory search response time
- Embedding generation rate

### Agent Performance

- Average execution time per agent
- Success rate percentage
- Queue processing rate
- Failed operation count

### LLM Performance

- Average response time
- Tokens per second
- Context window usage
- Model load time

## Dashboard Customization

### Widget Configuration

**Customizable widgets:**
- Reorder dashboard sections
- Show/hide specific metrics
- Adjust refresh intervals
- Set alert thresholds

**Saved per user:**
- Dashboard layout
- Widget preferences
- Alert settings

### Refresh Intervals

**Configurable refresh rates:**
- System status: 30 seconds
- Agent monitor: 10 seconds
- Memory stats: 60 seconds
- GPU metrics: 5 seconds

## Best Practices

### Regular Monitoring

1. Check dashboard daily for system health
2. Review agent statistics for failures
3. Monitor storage usage and clean up if needed
4. Verify model and adapter status after training

### Performance Optimization

1. Monitor slow agents and optimize
2. Check GPU usage during training
3. Review memory growth rate
4. Archive old memories to reduce index size

### Troubleshooting

1. Use audit stream to diagnose issues
2. Check agent logs for error messages
3. Verify service status (TTS, STT, etc.)
4. Review system alerts for warnings

## Next Steps

- Monitor your [Autonomous Agents](../advanced-features/autonomous-agents.md) activity
- Track [AI Training](../training-personalization/ai-training.md) progress
- Review [Memory System](memory-system.md) growth and organization
- Check [Voice Features](voice-features.md) service status
