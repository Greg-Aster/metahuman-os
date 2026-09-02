# Dashboard and Monitoring

The web interface separates user status, work admission, process activity, and service health. Use the surface that owns the question you are trying to answer instead of treating one green indicator as proof that an entire workflow succeeded.

## Dashboard Tabs

Select **Dashboard** in the left sidebar. The center view provides these tabs:

- **Overview** — identity, trust, task counts, voice status, system health, memory index status, recent activity, and configured model roles.
- **Tasks** — the task-management view.
- **Approvals** — work waiting for explicit approval.
- **Active Operator** — operator mode, policy, and related activity.
- **Sleep** — sleep-cycle status and controls.
- **Agent Catalog** — installed finite agents and persistent services, their source health, and their supported controls.
- **Trigger Manager** — configured schedules and event triggers.

Some tabs and actions are owner-only.

## Overview

The Overview refreshes its status data every 30 seconds. Its sections can include:

- active profile identity, role, trust level, and cognitive mode;
- active, in-progress, and blocked task counts;
- selected TTS provider and collected voice samples;
- Ollama connectivity, audit-log size, and profile storage use;
- memory file and semantic-index status;
- recently run agents and any currently processing agent;
- profile values, goals, recent activity, and model-role assignments.

Values are omitted when their backing status endpoint has no data. A displayed process or provider state is not proof of an external effect such as audible speech, a connected robot, or a completed remote action.

## Right Sidebar

The right sidebar has three operational views:

- **Queue** shows admitted work, execution state, and terminal results.
- **Agent Monitor** is owner-only and controls or inspects supported agent and service lifecycles.
- **Server Status** reports maintained shared services such as voice servers.

Use Queue for a finite job, Agent Monitor for agent or persistent-service activity, and Server Status for shared server readiness. They answer different questions.

## Agent Catalog and Trigger Manager

The **Agent Catalog** is the current inventory and manual-control surface. It distinguishes finite agents from persistent services and shows whether an installed agent is registered with Trigger Manager.

The **Trigger Manager** owns schedules and event-driven admission. Registering or enabling a trigger does not mean work is currently running; it means eligible events may submit work. A manual **Run now** action submits through the same managed execution path.

## Interpreting Status Correctly

Follow the chain appropriate to the feature:

1. **Configured** — the feature has valid settings.
2. **Available** — its provider or service is reachable.
3. **Admitted** — work appears in Queue or its coordinator.
4. **Running** — an owner reports active execution.
5. **Terminal** — the work finished or failed.
6. **Semantically complete** — the requested result was actually produced.
7. **Externally or physically confirmed** — a remote system, browser, or device shows the effect.

Do not infer later stages from an earlier one.

## CLI Checks

Run commands from the repository root:

```bash
./bin/mh status
./bin/mh backend status
./bin/mh agent list
./bin/mh agent status
./bin/mh voice-server status --all
```

`mh status` is a system summary. The more specific commands are better for isolating model, agent, or voice-service problems.

## Common Problems

### Dashboard says to initialize

Run:

```bash
./bin/mh init
```

Then restart through the normal start path and reload the page.

### Data looks old

Wait for the next 30-second refresh or reload the page. If Queue, Agent Monitor, and Overview disagree, use the feature's canonical owner and recent terminal record rather than the summary card.

### A service is running but the feature fails

Check the next boundary. For example, a running Whisper service still requires browser microphone permission and valid audio; a running TTS service still requires queue delivery and browser playback.

## Related Guides

- [Autonomous Agents](/user-guide#autonomous-agents)
- [Agent Catalog and Trigger Manager](/user-guide#autonomous-agents)
- [Voice Features](/user-guide#voice-features)
- [Troubleshooting](/user-guide#troubleshooting)
