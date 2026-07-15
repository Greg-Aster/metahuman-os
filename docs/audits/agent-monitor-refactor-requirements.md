# Agent Monitor Refactor Requirements

> Historical audit: the outbound game-adapter bridge described below was removed
> on 2026-07-14. The current Robot Bridge is a server-owned Ainekio HTTP/SSE
> service; see `docs/implementation-plans/ENVIRONMENT_INTERFACE_BRIDGE.md`.

Date: 2026-07-08

## Purpose

The Agent Monitor should be a lightweight runtime view for agents that are actually running, plus a clear way to start available agents on demand and configure which agents start at boot. It should not present stale audit history as live state, silently fail on start actions, or show inactive implementation inventory as if it were current runtime status.

This file captures the requested product requirements and the current implementation map before code cleanup begins.

## User Requirements

1. Keep an Agent Monitor tab.
2. Replace the current broad inactive-agent list with a list of agents that are actually running.
3. Add a start-agent flow with a dropdown menu for available agents, so inactive agents are discoverable on demand but not always shown in the monitor list.
4. Make status icons represent current runtime truth:
   - running means a live process or live service registration exists;
   - stopped means no live runtime entry exists;
   - error means the current or most recent attempted run failed and the user can inspect why.
5. Do not show stale error states after a clean restart unless the current run failed.
6. Do not let agent start actions fail silently. The UI must show either a started PID, already-running status, permission error, missing executable/path error, or recent stderr/audit failure.
7. Add a boot manager under System Settings that controls which agents are active on startup.
8. Build an error monitoring path that is easy to diagnose from the UI and/or terminal.
9. Add an Agent Data section in the Agent Monitor tab below the active-agent list. This section must show selected-agent runtime data, a text output log of tasks performed, and editable fields for agent variables.
10. Agent variables must be configurable where the agent exposes them. A different target port is a clear required example; similar fields include adapter id, endpoint/host, room/session name, graph name, model/user context, interval, retry policy, and feature toggles.
11. Agent variable edits should apply live whenever the agent can safely accept them without restart. Use Svelte reactive UI and event-driven backend updates where possible.
12. No polling for agent data, logs, or live field state. Updates should arrive through the same event-driven monitor channel or a focused agent-data stream.
13. Keep the implementation lightweight and well coded:
   - no periodic polling for normal monitor state;
   - no duplicated backup systems;
   - no legacy code kept "just in case";
   - remove dead/cruft code as part of the refactor.

## Current Runtime State Observed

At inspection time, `logs/agents/running.json` contained only:

```json
{
  "scheduler-service": {
    "pid": 5875,
    "startTime": "2026-07-08T16:15:39.223Z"
  }
}
```

`logs/run/locks/service-scheduler.lock` also pointed at the scheduler service:

```json
{"pid":5922,"startedAt":"2026-07-08T16:15:40.600Z","name":"service-scheduler"}
```

That means the current monitor showing a broad list is not showing "currently running agents"; it is mostly combining discovered agent code with audit-derived history.

For the specific `environment-bridge` symptom, today's audit log does contain current errors even though the UI does not expose them usefully. The latest observed failures were:

- `2026-07-08T17:23:59.873Z`: `[environment-bridge] Megameal socket error: connect ECONNREFUSED 127.0.0.1:4322`
- `2026-07-08T17:23:59.897Z`: `agent_stopped`, `exitCode: 1`, source `api/agents/run`
- `2026-07-08T17:24:12.770Z`: another `ECONNREFUSED 127.0.0.1:4322`
- `2026-07-08T17:24:12.792Z`: another `agent_stopped`, `exitCode: 1`

So the immediate `environment-bridge` failure is not invisible in the audit trail; it is invisible from the monitor workflow. The likely proximate cause is that the Megameal relay on `127.0.0.1:4322` was not accepting connections when the bridge agent started.

## Current Implementation Map

Note: this map started as the pre-refactor inspection record. Superseding implementation details are captured in the implementation log below; stale startup and agent-control bullets have been corrected where they would otherwise point at removed active systems.

### UI surfaces

- `apps/site/src/components/RightSidebar.svelte`
  - Defines the sidebar tab named `Agent Monitor`.
  - Renders `AgentMonitor` in compact mode.

- `apps/site/src/pages/monitor.astro`
  - Full-page Agent Monitor route.
  - Renders `AgentMonitor` in non-compact mode.

- `apps/site/src/components/AgentMonitor.svelte`
  - 487 lines.
  - Opens `new EventSource('/api/monitor/stream')`.
  - Stores received `agents` in local component state.
  - Sorts agents by last activity and status.
  - Shows every agent returned by the backend stream.
  - Hardcodes display descriptions for a subset of agents.
  - Lets non-service cards call `POST /api/agents/run`.
  - Does not show start failure feedback per agent; `runAgent()` logs errors to the browser console only.
  - Has stop-all and restart-core buttons wired to `POST /api/agents/control`.
  - Has local logic that treats `scheduler-service`, `boredom-service`, and `sleep-service` as persistent services.

- `apps/site/src/components/SchedulerSettings.svelte`
  - 421 lines.
  - Loads and saves `GET/POST /api/scheduler-config`.
  - Shows scheduler/global settings and categorized agent toggles.
  - Changes `enabled`, intervals, and inactivity thresholds.
  - Does not currently serve as a boot manager, even though the config schema includes `runOnBoot`.

- `apps/site/src/components/SystemSettings.svelte`
  - Already talks to `/api/scheduler-config` for some agent-related settings.
  - This is the right UI home for the requested boot manager, or it can host a linked boot-manager subpanel.

### Monitor API

- `packages/core/src/api/handlers/monitor-stream.ts`
  - 173 lines.
  - Streams SSE to `/api/monitor/stream`.
  - Sends an initial `connected` message.
  - Sends a metrics update immediately.
  - Uses two `setInterval(..., 30000)` timers:
    - one checks the audit file for new agent-like lines;
    - one sends metrics regardless of events.
  - Rebuilds each agent card by calling `listAvailableAgents()`, `getAgentStatuses()`, and `getAgentMetrics()`.
  - This violates the requested "no polling" direction and makes the view inventory-oriented rather than runtime-oriented.

- `packages/core/src/api/handlers/monitor.ts`
  - Handles `GET /api/monitor`.
  - Also builds an overview from all `listAvailableAgents()`.
  - Supports `view=agent` and `view=logs`.

- `packages/core/src/agent-monitor.ts`
  - 548 lines.
  - Owns the running registry at `logs/agents/running.json`.
  - Discovers available agents by scanning `brain/agents` for legacy `.ts` files and modular directories with `index.ts`.
  - Reads current-day audit logs from `logs/audit/<date>.ndjson`.
  - Derives run metrics by fuzzy matching audit event names and message text.
  - Derives status from:
    - running registry entries;
    - limited service lock fallback for names ending in `-service`;
    - recent audit errors/completions.
  - Cleans stale registry entries when the PID no longer exists.
  - Provides stop helpers for registry-backed processes only.

Current issue: `getAgentStatuses()` iterates over every discovered available agent. That makes the monitor show inactive agents by design. It can also mark an agent as `error` from recent audit history when nothing is currently running.

### Agent control APIs

- `packages/core/src/api/handlers/agent.ts`
  - `POST /api/agents/run`
    - Requires authentication.
    - Uses a hardcoded `ALLOWED_AGENTS` list.
    - Calls the shared `startAgentProcess(...)` path.
    - Resolves executable paths through the shared core resolver.
    - Captures stdout/stderr for direct monitor feedback.
    - Registers the PID in `logs/agents/running.json`.
    - Audits start and stop.
    - Uses short fast-exit detection for direct action feedback.
  - `POST /api/agents/control`
    - Supports `stop-all` and `restart-core`.
    - `restart-core` restarts agents selected by the Boot Manager snapshot.
  - The older `POST /api/agent` route and duplicate `handleStartAgent()` implementation have been removed.

Current status: the UI calls `/api/agents/run`, and start failures now return direct action feedback plus a failure-registry entry that appears in Recent Failures and Agent Data.

### Boot and startup

- `start.sh`
  - Starts background services by running `bin/start-services --background`.
  - Starts the web server on port 4321.
  - Cleans stale pid/lock/registry files on shutdown/startup cleanup.

- `bin/run-with-agents`
  - Used by app dev scripts.
  - Now prints that services are started from the in-app terminal.
  - Stops agents/services on exit.

- `packages/cli/src/mh-new.ts`
  - `startServices()` starts configured Boot Manager agents when not in headless mode.
  - CLI `mh agent run <name>` uses the shared process runner and bootstrap wrapper.
  - CLI `mh agent ps` shows registry-backed running agents.

- `packages/core/src/api/handlers/system.ts`
  - `GET /api/boot` returns UI initialization data but does not start agents.
  - Boot-managed process startup belongs to `start.sh` -> `bin/start-services` -> `mh start`; explicit manual restart and headless-mode resume remain separate operator actions.

- `etc/agents.json`
  - Contains scheduler config and per-agent fields including `enabled`, `runOnBoot`, and `autoRestart`.
  - Boot paths now use these fields through the Agent Monitor snapshot.
  - `environment-bridge` is present as a boot-eligible connection agent.

Current status: "what starts at boot" is owned by the Boot Manager snapshot from `etc/agents.json`, and page-load requests no longer replay completed one-shot agents.

### Environment bridge

- `brain/agents/environment-bridge/index.ts`
  - Exports agent metadata for `environment-bridge`.

- `brain/agents/environment-bridge/cli.ts`
  - Initializes the global logger.
  - Runs `runEnvironmentBridgeAgent()`.
  - Exits with code 1 when the agent returns failure or throws.

- `brain/agents/environment-bridge/core.ts`
  - Sets the environment bridge enabled state.
  - Requires a configured adapter and endpoint instead of using a baked URL fallback.
  - Starts the Megameal bridge adapter when enabled.
  - Watches bridge state changes so valid Agent Data connection edits can reload the adapter without restarting the agent process.
  - Waits until stopped by signal unless `persist: false`.
  - On adapter failure, logs/audits errors and exits.

Current status: a missing or unavailable Environment Bridge endpoint is surfaced in Agent Monitor as configuration/dependency state. Valid connection edits can now be applied live to the running bridge process by reloading the adapter connection without restarting the agent process.

## Current Failure Modes

1. Inventory is mixed with runtime state.
   - The monitor backend lists all discovered agents.
   - The UI therefore displays inactive agents even when only one service is actually running.

2. Error state can be stale.
   - Agent status can become `error` from recent audit lines when the agent is not currently running.
   - Error details are shown only inside expanded cards and are not tied cleanly to a current run attempt.

3. Start actions are optimistic.
   - `/api/agents/run` reports spawn success before proving the agent stayed alive or reached readiness.
   - Fast failures appear later as audit events, not as direct action feedback.

4. There are multiple start paths.
   - `/api/agents/run`, `/api/agent`, CLI `mh agent run`, `startServices()`, `/api/boot`, and scheduler config all overlap.
   - These paths do not share one agent descriptor, boot policy, readiness contract, or error result shape.

5. The SSE stream still polls.
   - `monitor-stream.ts` uses 30-second intervals.
   - This is lightweight compared to aggressive polling, but it is still not event-driven and can lag or show stale state.

6. Boot configuration is fragmented.
   - `etc/agents.json` has `runOnBoot`, but current boot code uses hardcoded lists.
   - The user cannot reliably configure startup agents from System Settings.

7. Error monitoring lacks a first-class UI/terminal contract.
   - Errors exist in audit logs.
   - Some agent stdout/stderr is inherited, some ignored, some piped to server logs.
   - The monitor does not offer a clear "why did this fail?" path after clicking start.

## Target Architecture

### Agent descriptor owner

Create one source of truth for agent descriptors in core or agent-runtime. It should expose:

- agent id;
- display name;
- kind: service, scheduled, manual, connection, one-shot;
- executable path or runtime module;
- allowed UI actions;
- boot eligibility;
- external dependencies;
- readiness behavior;
- log/error source.

The UI should not hardcode descriptions for normal operation. Descriptions should come from descriptors or agent metadata.

### Runtime state owner

Separate runtime state from historical metrics:

- `running`: live PID or live service lock verified now;
- `starting`: process spawned but not yet ready;
- `stopping`: stop requested;
- `stopped`: no live runtime state;
- `failed`: latest attempted run failed;
- `unhealthy`: live process exists but dependency/readiness health check fails.

The Agent Monitor list should default to `running`, `starting`, `stopping`, `failed`, and `unhealthy` current-session entries. Stopped/inactive agents belong in the start dropdown, not the main list.

### Event-driven monitor stream

Replace interval-driven monitor refresh with an event source tied to runtime state changes:

- emit when an agent is registered;
- emit when readiness succeeds/fails;
- emit when stderr/error audit entry occurs for a running or starting agent;
- emit when an agent exits;
- emit when boot manager config changes.

If file watching is used for compatibility, use `fs.watch`/append-tail with backpressure and a fallback reconnect, not periodic full recomputation. The stream payload should include a compact snapshot plus incremental events.

### Start-agent workflow

The monitor should have:

- a dropdown of startable agents from the descriptor owner;
- a primary Start button;
- inline progress for the selected agent;
- explicit result:
  - started, with PID and readiness status;
  - already running;
  - missing executable;
  - blocked by permissions;
  - dependency unavailable;
  - failed with last stderr/audit excerpt.

For long-running connection agents like `environment-bridge`, startup should include a readiness/dependency check. For the current Megameal bridge, a refusal from `127.0.0.1:4322` should be shown as "Megameal relay unavailable" with the host/port, not as a silent exit.

### Agent Data Panel

The Agent Monitor tab should include an Agent Data section below the active-agent list. This section is for the selected active, starting, failed, or startable agent. It should not expand the main list into a dense wall of inactive cards.

The panel should expose:

- current lifecycle state, PID, uptime, readiness, and dependency health;
- current task or latest task summary;
- text output log of tasks performed, lifecycle events, and important agent messages;
- recent structured errors with timestamp, source, exit code, and diagnosis fields;
- editable agent variables defined by the agent descriptor;
- save/apply status for each edited field;
- indication of whether a field applies live, on next restart, or only at boot.

Agent variables must be typed by descriptor metadata rather than hardcoded per component. Required field kinds:

- text;
- number;
- port;
- URL;
- select;
- multiselect;
- toggle;
- secret reference, without revealing secret values;
- read-only computed fields.

The `environment-bridge` case must support a configurable target/adapter endpoint instead of a baked `4322` default. If no target is configured, the agent should show a clear configuration-required state instead of trying a fallback URL.

Live updates should be event-driven:

- UI field changes call one configuration/action endpoint;
- accepted updates publish an agent-data event;
- running agents that support hot reload receive the update without restart;
- agents that cannot hot reload report "restart required" or "next boot" explicitly.

Use Svelte for the Agent Data panel so field state, validation, save feedback, and streamed log lines update reactively without browser refresh or manual polling.

### Boot manager

System Settings should include a Boot Manager panel backed by the same descriptor/config owner:

- list boot-eligible agents only;
- enable/disable run on boot;
- distinguish services from one-shot scheduled agents;
- show dependency notes;
- persist to the active config, not only the root template if user profiles own runtime config;
- apply changes without requiring code edits.

Startup paths should read the same boot config:

- `start.sh` and `bin/start-services`;
- CLI `mh start`;
- `/api/boot`, if it remains necessary.

Hardcoded startup lists should be deleted or reduced to an emergency minimal bootstrap where explicitly documented.

### Error monitoring

Provide one diagnosis path per agent:

- latest lifecycle events;
- last stderr/stdout excerpt or structured error;
- exit code and duration;
- dependency health result;
- link or command hint for the log file when needed.

This can live in the monitor as an expandable details panel and also be mirrored to terminal logs. The important requirement is that a failed click is visible without opening developer tools.

The Agent Data panel should be the primary place for this in the UI. Terminal output remains useful, but the monitor must not require opening devtools, tailing raw audit files, or reading server logs to understand a failed agent action.

## Cleanup Candidates

These should be reviewed for deletion or consolidation during implementation:

1. `POST /api/agent` in `packages/core/src/api/handlers/agent.ts`
   - Overlaps with `POST /api/agents/run`.
   - Uses a different request body and different stdio behavior.

2. Hardcoded `agentInfo` in `apps/site/src/components/AgentMonitor.svelte`
   - Should be replaced by descriptor metadata.

3. Monitor status derivation from all available agents.
   - The main monitor should not map `listAvailableAgents()` into cards.

4. Fuzzy audit-message status classification.
   - Historical metrics can keep parsing if needed, but current status should come from lifecycle state.

5. Hardcoded boot lists in `/api/boot` and `mh-new.ts`.
   - Should be replaced by boot config where possible.

6. Duplicate start implementations.
   - UI, CLI, boot, and scheduler should call one shared start/stop service instead of each spawning agents independently.

## Acceptance Criteria

The refactor is done when:

1. Agent Monitor shows only current runtime agents and current failed/starting entries by default.
2. Inactive agents are available from a dropdown start menu.
3. Clicking Start gives visible success/failure feedback without browser console inspection.
4. `environment-bridge` failure to connect to its configured adapter/endpoint is shown as an actionable dependency failure, and `127.0.0.1:4322` is not assumed unless explicitly configured.
5. Status icons are derived from live lifecycle state, not stale audit history.
6. Boot Manager in System Settings can configure startup agents.
7. Boot/startup code reads the boot manager config instead of hardcoded lists, except for explicitly documented minimal bootstrap services.
8. Monitor updates are event-driven in normal operation and do not use 30-second polling loops.
9. Duplicate legacy start/control code is removed rather than retained as backup.
10. Agent Monitor includes an Agent Data section below the active-agent list.
11. Agent Data shows a live text output log of task/lifecycle activity for the selected agent.
12. Agent descriptors expose typed editable variables, including configurable target port/endpoint where relevant.
13. Live-editable variables update without restart and without polling; non-live variables clearly show restart/next-boot requirements.
14. `environment-bridge` no longer has a baked `4322` fallback. Its target adapter/endpoint is configurable, and missing configuration is reported clearly.
15. A focused validation path exists:
    - start one manual one-shot agent;
    - start one long-running service/connection agent;
    - simulate dependency failure;
    - edit a live variable and verify the running agent receives it;
    - edit a restart-required variable and verify the UI labels it correctly;
    - restart MetaHuman OS and verify boot manager choices;
    - verify no inactive agents appear in the main monitor list.

## First Implementation Slice

The safest first slice should be narrow and behavior-preserving:

1. Add an agent descriptor/read model that merges available agent metadata, running registry, service locks, and scheduler config without changing start behavior.
2. Extend that read model with typed agent variable descriptors, current variable values, live-edit capability, and log/event source metadata.
3. Change the monitor backend to return separate `runningAgents`, `recentFailures`, `startableAgents`, and selected-agent data.
4. Change the monitor UI to render `runningAgents` plus a start dropdown.
5. Add the Svelte Agent Data panel below the active-agent list.
6. Add direct action feedback for `/api/agents/run`, including fast-exit detection and latest error lookup.
7. Only then remove inactive cards and legacy UI cruft.

The boot manager should come after the monitor read model is stable, because it depends on the same descriptor/config ownership.

## Implementation Log

### 2026-07-08 - Initial Agent Monitor Refactor Slice

- Added a core Agent Monitor snapshot/read model in `packages/core/src/agent-monitor.ts`.
- Split monitor data into `runningAgents`, `recentFailures`, `startableAgents`, and `agentData`.
- Added descriptor-backed agent names, descriptions, kinds, boot eligibility, and typed variables.
- Added scheduler-backed editable variables for enabled state, boot state, auto-restart, retries, intervals, and idle thresholds.
- Added `environment-bridge` variables for adapter, endpoint URL, room, and graph name so the target port/endpoint is explicit data rather than hidden UI/code behavior.
- Added `POST /api/monitor/agent-variable` for owner-only variable updates.
- Changed `/api/monitor` overview to return the new split monitor snapshot while preserving `agents` as a running-agent compatibility alias.
- Changed `/api/monitor/stream` to emit snapshot payloads from filesystem/watch events instead of 30-second polling loops.
- Replaced `AgentMonitor.svelte` with a Svelte runtime-first UI:
      - active agents list limited to currently running agents;
      - separate recent-failure diagnostic list;
  - startable-agent dropdown;
  - selected-agent Agent Data panel;
  - lifecycle/readiness/health fields;
  - editable variable controls;
  - task/lifecycle output log.
- Removed the baked `http://localhost:4322/` fallback from `brain/agents/environment-bridge/core.ts`; the agent now requires configured adapter endpoint data or returns a structured missing-configuration failure.

### 2026-07-08 - Boot Manager And Startup Config Slice

- Added `bootAgents` to the core Agent Monitor snapshot so System Settings can render startup configuration from the same descriptor/config owner as the Agent Monitor.
- Ensured descriptor-only boot agents such as `scheduler-service`, `audio-organizer`, and `environment-bridge` are included even when they are not already present in `etc/agents.json`.
- Added default scheduler config creation for boot-eligible agents when a boot variable is saved, so the Boot Manager can persist settings instead of failing on agents missing from the old scheduler config.
- Added a Boot Manager panel under `SystemSettings.svelte`:
  - lists boot-eligible agents only;
  - distinguishes service, scheduled, connection, one-shot, and manual agents;
  - toggles `runOnBoot`, `enabled`, and `autoRestart`;
  - edits retry count;
  - shows dependency notes for agents such as `environment-bridge`;
  - saves through `POST /api/monitor/agent-variable`.
- Changed `/api/boot` to read `getAgentMonitorSnapshot().bootAgents` instead of the hardcoded `boredom-service`/`audio-organizer` startup list.
- Changed CLI `mh start` to keep only `headless-watcher` as a documented minimal bootstrap and start configured boot agents from the same boot-manager snapshot when not in headless mode.
- Verified the new snapshot shape with a runtime probe; `bootAgents` is populated with configured `enabled` and `runOnBoot` values.

### 2026-07-08 - Start Feedback Slice

- Changed `POST /api/agents/run` to capture spawned agent stdout/stderr instead of inheriting output silently.
- Added a short fast-exit detection window for start requests:
  - immediate spawn errors return a failed API result;
  - immediate non-zero exits return `success: false`, `exitCode`, and stderr/stdout excerpts;
  - immediate clean one-shot exits return `success: true` with `completed: true`;
  - still-running agents return the existing started PID success shape.
- This gives the Agent Monitor Start button direct failure text for cases such as `environment-bridge` missing configuration or dependency refusal instead of requiring browser console or audit-log inspection.

### 2026-07-08 - Legacy Start Cleanup And Current Failure State Slice

- Removed the legacy `POST /api/agent` route from `packages/core/src/api/router.ts`.
- Deleted the duplicate `handleStartAgent()` implementation from `packages/core/src/api/handlers/agent.ts`; source callers now use `POST /api/agents/run`.
- Migrated `MemoryControls.svelte` and `TaskManager.svelte` from `/api/agent` to `/api/agents/run`, preserving CLI option arguments for memory pruning and curator runs.
- Added `memory-pruner` to the allowed `/api/agents/run` allowlist so the migrated Memory Controls action remains functional.
- Added a current-session failure registry at `logs/agents/failures.json` owned by `packages/core/src/agent-monitor.ts`.
- Changed `getAgentStatuses()` so current status is no longer inferred from fuzzy audit-log errors; audit logs remain available for metrics/log history, but live status is registry-backed.
- Changed Agent Monitor `recentFailures` and failed Agent Data panels to come from the failure registry, including stderr/stdout excerpts and exit codes recorded by start/control paths.
- Updated `/api/agents/run` and `/api/agents/control` to record non-zero agent exits into the failure registry and clear failures on successful starts/exits.
- Changed `/api/agents/control` restart behavior to restart the documented minimal `headless-watcher` plus configured boot-manager agents instead of a hardcoded `CORE_SERVICES` list.
- Changed the Agent Monitor restart button label to "Restart Startup" to match the boot-manager-backed behavior.
- Verified with a runtime probe that a recorded `environment-bridge` failure appears in `recentFailures` and Agent Data as `lifecycle: error`, then verified the synthetic failure was cleared.

### 2026-07-08 - Focused Validation Script Slice

- Added `scripts/validate-agent-monitor.ts` as a repeatable focused validation path for the refactor.
- Added `pnpm validate:agent-monitor` to `package.json`.
- The validator checks:
  - `runningAgents` contains only running cards;
  - startable agents do not overlap active or failed agents;
  - Boot Manager data is exposed and includes `scheduler-service` and `environment-bridge`;
  - `environment-bridge` Agent Data exposes adapter, endpoint URL, room, and graph variables;
  - `environment-bridge` core has no baked `http://localhost:4322/` fallback;
  - monitor stream has no 30-second polling loop;
  - monitor stream watches runtime state changes under `logs/run`;
  - legacy `POST /api/agent` route is removed;
  - current failure registry entries appear in `recentFailures` and Agent Data;
  - clearing a failure removes the failed card.
- Changed `monitor-stream.ts` to watch `systemPaths.run`, so Environment Bridge state writes can emit monitor snapshots without polling.
- Ran `pnpm validate:agent-monitor`; it passed `17/17` checks.
- Confirmed the synthetic validation failure is removed from `logs/agents/failures.json` after the validator runs.

### 2026-07-08 - Structured Error Details Slice

- Changed `AgentDataPanel.errors` from plain log entries to structured error records with:
  - timestamp;
  - agent id;
  - message;
  - source;
  - PID;
  - exit code;
  - stderr excerpt;
  - stdout excerpt.
- Added conversion helpers in `packages/core/src/agent-monitor.ts` so audit-derived errors and current failure-registry errors share one UI-facing shape.
- Added a Recent Errors panel to `AgentMonitor.svelte` above the Task Log, showing source, exit code, PID, message, stderr, and stdout when available.
- Extended `scripts/validate-agent-monitor.ts` to verify structured failure details from a synthetic failure-registry entry.
- Ran `pnpm validate:agent-monitor`; it passed `18/18` checks.

### 2026-07-08 - Runtime Start Failure Validation Slice

- Extended `scripts/validate-agent-monitor.ts` with restart-behavior coverage:
  - verifies `POST /api/agents/control` restart reads the boot-manager snapshot;
  - verifies restart keeps `headless-watcher` as the minimal bootstrap agent instead of returning to a hardcoded inactive-agent list.
- Added an opt-in runtime validation mode: `pnpm validate:agent-monitor -- --runtime`.
- Runtime mode invokes the real `handleRunAgent()` path for `environment-bridge` with an explicit invalid URL argument, avoiding the saved user connection while still exercising:
  - API-level start failure reporting;
  - captured stderr;
  - non-zero fast-exit handling;
  - failure-registry recording;
  - Recent Failures and Agent Data error rendering data.
- Runtime mode preserves and restores any pre-existing `environment-bridge` failure registry entry, then clears its own test failure.
- Added a clean validator exit after the report so imported background clients cannot keep validation commands open.
- Ran `pnpm validate:agent-monitor`; it passed `20/20` checks.
- Ran `pnpm validate:agent-monitor -- --runtime`; it passed `24/24` checks.
- Confirmed `logs/agents/failures.json` was restored to `{}` after validation.

### 2026-07-08 - Right Panel And Curated Start Surface Slice

- Re-read the requirements after the right-sidebar Agent Monitor still appeared too similar to the old monitor.
- Added a dedicated `compact={true}` branch in `AgentMonitor.svelte` for the right-side panel instead of squeezing the full monitor layout into the sidebar.
- The compact right panel now prioritizes:
  - live stream/running count;
  - Start Agent dropdown and Start button;
  - running-only rows;
  - current failure rows;
  - selected Agent Data with variables, latest error, and task log.
- Changed `packages/core/src/agent-monitor.ts` so unknown/discovered/config-only agents are not automatically treated as maintained UI agents.
- Added an explicit `managed` flag to agent descriptors, monitor cards, and Agent Data panels.
- Restricted the Start dropdown to managed descriptors only.
- Restricted Boot Manager data to managed boot-eligible descriptors only.
- Existing legacy agents such as `update-check` and `babysitter` are not new agents from this refactor. They already existed in `brain/agents` and `etc/agents.json`.
- Current snapshot evidence after the change:
  - running: `update-check` unmanaged, `scheduler-service` managed, `babysitter` unmanaged;
  - startable: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`;
  - boot manager: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`, `scheduler-service`.
- Added validator checks that `update-check` and `babysitter` do not appear in `startableAgents` or `bootAgents`.
- Ran `pnpm validate:agent-monitor`; it passed `29/29` checks.
- Ran direct Svelte compiler checks for `AgentMonitor.svelte` and `RightSidebar.svelte`; both compiled successfully.
- Remaining cleanup decision: unmanaged agents that are already running are still shown as runtime truth, but labeled unmanaged. Removing or disabling currently running legacy agents such as `babysitter` should be an explicit cleanup action, not silently hidden as if they are not running.

### 2026-07-08 - Legacy Agent Deletion And Runtime Cleanup Slice

- Implemented the explicit cleanup decision to delete legacy active agent surfaces instead of hiding them behind the temporary `managed` workaround.
- Deleted active `babysitter` runtime/API/config surfaces:
  - `brain/agents/babysitter.ts`;
  - `etc/babysitter.json`;
  - `packages/core/src/api/handlers/babysitter.ts`;
  - `apps/site/src/pages/api/babysitter/*`;
  - current babysitter completion/consolidation docs that presented it as active maintained behavior.
- Deleted active `update-check` agent source:
  - `brain/agents/update-check/cli.ts`;
  - `brain/agents/update-check/core.ts`;
  - `brain/agents/update-check/index.ts`.
- Removed `babysitter` and `update-check` from active boot/start/config surfaces:
  - `etc/agents.json`;
  - `apps/react-native/nodejs-assets/nodejs-project/etc/agents.json`;
  - `packages/core/src/api/router.ts`;
  - `packages/core/src/api/handlers/index.ts`;
  - `packages/core/src/api/handlers/agent.ts`;
  - current agent/sync docs.
- Removed the temporary `managed`/`unmanaged` Agent Monitor UI workaround after deleting the legacy agents.
- Added source-aware registry cleanup in `packages/core/src/agent-monitor.ts` so stale running-registry entries for deleted/nonexistent agents are pruned instead of rendered.
- Verified current monitor snapshot after cleanup:
  - running: `scheduler-service`;
  - failed: none;
  - startable: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`;
  - boot manager: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`, `scheduler-service`.
- Verified `logs/agents/running.json` was cleaned to only `scheduler-service`.
- Ran direct Svelte compiler checks for `AgentMonitor.svelte` and `RightSidebar.svelte`; both compiled successfully.
- Ran `pnpm validate:agent-monitor`; it passed `29/29` checks.
- Ran `pnpm validate:agent-monitor -- --runtime`; it passed `33/33` checks.
- Ran targeted core typecheck grep for touched monitor/agent/router/startup files; no matching errors were reported.

### 2026-07-08 - Right Panel Source Verification Slice

- Fixed `RightSidebar.svelte` tab persistence so the default `queue` tab no longer overwrites the saved `mh_right_sidebar_tab` value before `onMount()` restores it.
- Renamed the active compact monitor surface to match the refactor requirements:
  - visible `Agent Monitor` header;
  - visible `Start Agent` dropdown label;
  - visible `Active Agents` running-only list label;
  - `Agent Data` and `Task Log` remain below the active-agent/start controls.
- Routed `apps/site/src/pages/monitor.astro` through the same maintained compact monitor surface as the right sidebar so there is no separate active full-page UI path.
- Started the current-source Astro dev server at `http://127.0.0.1:4323/` because the existing `4321` server was serving `dist/server/entry.mjs` and could be stale.
- Browser-verified the right-side panel against current source with a public guest profile:
  - `Agent Monitor`: present;
  - `Start Agent`: present;
  - `Active Agents`: present;
  - `Agent Data`: present;
  - `Task Log`: present;
  - running list shows `Scheduler Service`;
  - start dropdown includes `Audio Organizer`, `Environment Bridge`, `Mind Wandering`, and `Organizer`;
  - `update-check`: absent;
  - `babysitter`: absent.
- Saved browser evidence screenshot to `/tmp/metahuman-agent-monitor-right-panel-dev.png`.
- Ran `pnpm validate:agent-monitor`; it passed `29/29` checks after the right-panel changes.
- Ran a focused snapshot probe; it reported:
  - running: `scheduler-service`;
  - startable: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`;
  - boot manager: `audio-organizer`, `environment-bridge`, `reflector`, `organizer`, `scheduler-service`;
  - removed legacy agents: none.
- Validation caveats:
  - `pnpm typecheck:site` cannot currently run because `@astrojs/check` is not installed;
  - direct `svelte-check` is blocked by existing unrelated repo-wide issues, including `OperatorProposalCard.svelte` PostCSS `font-inherit` failure and many pre-existing Svelte/type errors;
  - `pnpm typecheck:core --pretty false` is blocked by existing unrelated core TypeScript errors outside the touched agent monitor files.

### 2026-07-08 - Interface Code Cleanup Slice

- Removed the duplicate fallback Agent Monitor UI branch from `apps/site/src/components/AgentMonitor.svelte`.
- The removed branch was legacy interface code with old card classes, `Stop All`, and fallback active/start/data sections that could confuse future edits even though current callers were routed through `compact={true}`.
- The component now has one maintained visible monitor interface:
  - `Agent Monitor` header;
  - `Start Agent` dropdown;
  - `Active Agents` running-only section;
  - selected-agent `Agent Data`;
  - `Task Log`;
  - current failure/error detail rendering.
- Kept `apps/site/src/components/RightSidebar.svelte` and `apps/site/src/pages/monitor.astro` both pointed at the same maintained monitor surface.
- Ran `pnpm validate:agent-monitor`; it passed `29/29` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Searched the active monitor source for old interface markers (`agent-monitor-container`, `agent-card`, `agent-action-btn`, `Stop All`, `Agent Runtime`, old broad agent names); no matches remained in the active monitor source.

### 2026-07-08 - Agent Data Variable Visibility Slice

- Removed the now-unused `compact` prop from `apps/site/src/components/AgentMonitor.svelte`.
- Removed `compact={true}` from the Agent Monitor callers:
  - `apps/site/src/components/RightSidebar.svelte`;
  - `apps/site/src/pages/monitor.astro`.
- Removed the unused `sleepStatus` import from `AgentMonitor.svelte`.
- Changed Agent Data variable rendering from a compact slice to the full variable list, so important fields such as `environment-bridge.endpointUrl` cannot be hidden below an arbitrary five-field cutoff.
- Extended `scripts/validate-agent-monitor.ts` with guardrails that fail if:
  - `AgentMonitor.svelte` reintroduces `variables.slice(...)`;
  - `AgentMonitor.svelte` reintroduces a duplicate `compact` branch/prop.
- Ran `pnpm validate:agent-monitor`; it passed `31/31` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.

### 2026-07-08 - Descriptor Ownership Extraction Slice

- Added `packages/core/src/agent-monitor-types.ts` as the single public type owner for Agent Monitor snapshots, cards, data panels, boot entries, logs, errors, and variable descriptors.
- Added `packages/core/src/agent-monitor-descriptors.ts` as the owner for maintained agent descriptors, scheduler config reads/writes, boot-entry construction, environment-bridge variables, and environment-bridge variable persistence.
- Reduced `packages/core/src/agent-monitor.ts` so it imports those owners and focuses on runtime registry cleanup, status calculation, metrics/log reading, failure records, snapshot composition, and variable dispatch.
- Removed duplicate descriptor/config/Environment Bridge variable code from `agent-monitor.ts` instead of keeping it as a backup path.
- Ran `pnpm validate:agent-monitor`; the sandboxed run failed because `tsx` could not create `/tmp/tsx-1000/*.pipe`, then the escalated rerun passed `31/31` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and chunk warnings unrelated to this slice.

### 2026-07-08 - Environment Action Feed Routing Slice

- Investigated why a programmed environment action appeared in the main conversation feed as:
  - `[agent] action: move`;
  - `[agent] argument: {"direction": "forward", "distance": 5}`.
- Identified this as graph/node workflow output being selected by the generic chat answer path, not a normal assistant conversation response.
- Attempted a narrow routing fix, then immediately reverted it after user clarification that this was a question and no code change was wanted.
- Reverted the attempted changes in:
  - `packages/core/src/api/handlers/persona-chat.ts`;
  - `packages/core/src/agent-monitor.ts`;
  - `apps/site/src/components/chat/message-discriminator.ts`.
- No active code change from this investigation remains.
- If this becomes a requested fix later, the likely owner is the graph output selection path that allows node workflow output to become a chat answer.

### 2026-07-08 - Registry Ownership Extraction Slice

- Added `packages/core/src/agent-monitor-registry.ts` as the owner for:
  - `logs/agents/running.json` reads/writes;
  - `logs/agents/failures.json` reads/writes;
  - process liveness checks;
  - register/unregister;
  - failure record/clear/list;
  - stop one / stop all / running-agent list helpers.
- Updated `packages/core/src/agent-monitor.ts` to import registry state helpers from the new owner module.
- Preserved the existing public `agent-monitor.ts` exports for `registerAgent`, `unregisterAgent`, `stopAllAgents`, `isAgentRunning`, `recordAgentFailure`, `clearAgentFailure`, and related callers, so external imports do not need to move yet.
- Removed the duplicated registry/failure/control implementation from `agent-monitor.ts`; the monitor file now remains focused on source discovery, audit-log interpretation, status calculation, metrics, snapshots, and variable dispatch.
- Ran duplicate-owner search for registry and stop/control functions; only `agent-monitor-registry.ts` defines them now.
- Ran `pnpm validate:agent-monitor`; the sandboxed run failed on the known `tsx` `/tmp/tsx-1000/*.pipe` permission issue, then the escalated rerun passed `31/31` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and chunk warnings unrelated to this slice.

### 2026-07-08 - Legacy Monitor CSS Cleanup Slice

- Removed the stale global Agent Monitor CSS block from `apps/site/src/styles/tailwind.css`.
- Deleted unused selectors for the removed legacy monitor interface:
  - `.agent-monitor-container`;
  - `.agent-monitor-header`;
  - `.agent-status-dot`;
  - `.agent-progress-bar`;
  - `.agent-progress-fill`;
  - `.agent-card`;
  - `.agent-action-btn`;
  - `.agent-expand-toggle`;
  - `.agent-sparkline`;
  - `.agent-sparkline-bar`;
  - legacy `pulse-glow` and `bar-pulse` keyframes.
- Verified those selectors no longer appear in active `apps/site/src`, `packages/core/src`, or `scripts`.
- Added a `scripts/validate-agent-monitor.ts` guardrail that fails if the removed legacy Agent Monitor CSS selectors return.
- Ran `pnpm validate:agent-monitor`; the sandboxed run failed on the known `tsx` `/tmp/tsx-1000/*.pipe` permission issue, then the escalated rerun passed `31/31` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and chunk warnings unrelated to this slice.

### 2026-07-08 - Legacy CSS Guardrail Slice

- Extended `scripts/validate-agent-monitor.ts` with `Agent Monitor legacy global CSS is removed`.
- The check fails if old global selectors such as `agent-monitor-container`, `agent-card`, `agent-action-btn`, `agent-expand-toggle`, or `agent-sparkline` are reintroduced into `apps/site/src/styles/tailwind.css`.
- Ran `pnpm validate:agent-monitor`; the sandboxed run failed on the known `tsx` `/tmp/tsx-1000/*.pipe` permission issue, then the escalated rerun passed `32/32` checks.

### 2026-07-08 - Boot Persistence And Start Visibility Slice

- Investigated the reported `environment-bridge` boot issue and confirmed the current scheduler file, `etc/agents.json`, did not contain an `environment-bridge` entry even though the monitor descriptor exposed it as boot-eligible.
- Updated `packages/core/src/agent-monitor.ts` so saving `runOnBoot: true` through Agent Data / Boot Manager also persists `enabled: true`; this matches the boot filter, which intentionally starts only agents that are both enabled and configured to run on boot.
- Added the missing `environment-bridge` scheduler entry to `etc/agents.json` with:
  - `enabled: true`;
  - `runOnBoot: true`;
  - `agentPath: "environment-bridge/cli.ts"`;
  - `autoRestart: true`;
  - `maxRetries: 3`.
- Updated `apps/site/src/components/AgentMonitor.svelte` so manual start and bulk control actions immediately refresh `/api/monitor` after the API call, instead of relying only on the SSE watcher; this fixes the stale UI state where an agent can report "Starting..." but not appear until a full site refresh.
- Updated boot-time process handling in:
  - `packages/cli/src/mh-new.ts`;
  - `packages/core/src/api/handlers/system.ts`.
- Boot-started agents now record non-zero exits and spawn errors into the same Agent Monitor failure registry used by manual starts, so a startup crash should appear as a visible failed agent with source metadata instead of silently disappearing.
- Extended `scripts/validate-agent-monitor.ts` with `boot-manager run-on-boot enables agent for startup`.
- Ran `pnpm validate:agent-monitor`; it passed `33/33` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.
- Remaining operational caveat: `environment-bridge` can now be boot-selected and should become visible on start, but it still requires a valid configured adapter endpoint in Agent Data before it can stay healthy.

### 2026-07-08 - Shared Agent Process Runner Slice

- Added `packages/core/src/agent-process-runner.ts` as the shared owner for agent process launch behavior:
  - agent/service executable resolution;
  - `tsx` and `NODE_PATH` resolution;
  - bootstrap-wrapper startup;
  - direct startup with arguments for API-triggered manual runs;
  - registry registration/unregistration;
  - lifecycle audit events;
  - stdout/stderr capture;
  - immediate fast-exit detection;
  - failure registry recording and clearing.
- Exported the shared runner from `packages/core/src/index.ts`.
- Replaced the duplicated detached background starter in `packages/core/src/api/handlers/agent.ts` with `startAgentProcess(...)`.
- Kept `/api/agents/run` behavior compatible with existing UI/runtime validation by using direct mode with a short fast-exit wait and argument support.
- Replaced the direct spawn logic in `packages/core/src/api/handlers/system.ts` `/api/boot` with `startAgentProcess(...)`, so boot starts now use the same bootstrap and failure handling as the monitor start path.
- Replaced the duplicated `mh start` launch logic in `packages/cli/src/mh-new.ts` with `startAgentProcess(...)`.
- Replaced the duplicated `mh agent run` registry/audit/failure lifecycle code with `startAgentProcess(...)`.
- Added guardrails to `scripts/validate-agent-monitor.ts` that verify:
  - the shared runner owns spawn lifecycle;
  - the Agent API uses the shared runner and has no local spawn;
  - the boot API uses the shared runner and has no local spawn;
  - CLI agent startup uses the shared runner and does not reintroduce direct `spawn('tsx', ...)` agent launching.
- Verified source scan: only `packages/core/src/agent-process-runner.ts` now contains the agent process `spawn(resolveTsx(), ...)`, `registerAgent(...)`, `unregisterAgent(...)`, `clearAgentFailure(...)`, and `recordAgentFailure(...)` lifecycle calls across the monitored startup owners.
- Ran `pnpm validate:agent-monitor`; it passed `37/37` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.
- Remaining consolidation caveat: the bootstrap wrapper still has its own internal module-resolution logic when importing the selected agent; the process-launch lifecycle is now shared, but executable resolution could be further reduced by moving bootstrap resolution behind a smaller shared resolver.

### 2026-07-08 - Environment Bridge Dependency Diagnosis Slice

- Reviewed the current `environment-bridge` code path:
  - missing adapter/endpoint configuration already returns a clear configuration-required failure;
  - configured endpoint socket refusal still arrived as low-level stderr such as `ECONNREFUSED 127.0.0.1:4322`.
- Updated `packages/core/src/agent-process-runner.ts` so `environment-bridge` failures with `ECONNREFUSED` are recorded with an actionable Agent Monitor error message:
  - the configured endpoint is unavailable;
  - the user should check the Agent Data endpoint URL;
  - the external adapter should be started before starting the bridge.
- Kept the original stderr excerpt in the failure record for diagnosis detail.
- Added a guardrail to `scripts/validate-agent-monitor.ts` requiring the shared runner to keep the `environment-bridge` endpoint-refusal diagnosis.
- Ran `pnpm validate:agent-monitor`; it passed `38/38` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.

### 2026-07-08 - Start Dropdown Discovery Regression Slice

- Investigated why the Agent Monitor start-agent dropdown showed only a limited set of agents after the runtime-first refactor.
- Root cause:
  - the main monitor list correctly stopped rendering every inactive implementation;
  - but `normalizedAgentIds()` also stopped including all runnable agents from `brain/agents` and `etc/agents.json`;
  - `buildAgentDescriptor()` defaulted non-curated descriptors to `startable: false`.
- Updated `packages/core/src/agent-monitor.ts` so the monitor snapshot includes:
  - curated descriptors;
  - runnable agents discovered from `brain/agents`;
  - scheduler-configured agents from `etc/agents.json`;
  - running agents;
  - current failure records.
- Updated `packages/core/src/agent-monitor-descriptors.ts` so non-curated agents with a runnable source are startable by default.
- Preserved the requirement that the main monitor list only shows current runtime agents and current failed agents; the full inactive agent inventory is available through the dropdown, not as a wall of cards.
- Added guardrails to `scripts/validate-agent-monitor.ts` requiring the start dropdown model to include representative runnable agents:
  - `coder`;
  - `curator`;
  - `profile-sync`.
- Ran `pnpm validate:agent-monitor`; it passed `41/41` checks and showed the dropdown model now includes the modular runnable agents again.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.

### 2026-07-08 - Environment Bridge Readiness State Slice

- Added richer dependency health states to the Agent Data model:
  - `configured`;
  - `connecting`;
  - `unavailable`.
- Updated `packages/core/src/agent-monitor.ts` so `environment-bridge` Agent Data now evaluates readiness/dependency state from:
  - configured adapter;
  - configured endpoint URL;
  - current lifecycle;
  - recent failure text such as endpoint refusal.
- `environment-bridge` now reports:
  - missing config as `readiness: not-ready`, `dependencyHealth: missing`;
  - endpoint refusal as `readiness: failed`, `dependencyHealth: unavailable`;
  - configured but stopped as `readiness: not-ready`, `dependencyHealth: configured`;
  - running with configuration as `readiness: ready`, `dependencyHealth: ok`.
- Updated `apps/site/src/components/AgentMonitor.svelte` so Agent Data shows separate `Ready` and `Dependency` fields instead of a single generic health field.
- Added a visible latest-task/status summary line under the Agent Data stats for configuration/dependency messages.
- Extended `scripts/validate-agent-monitor.ts` with checks that `environment-bridge` Agent Data exposes readiness and dependency health state.
- Ran `pnpm validate:agent-monitor`; it passed `43/43` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.
- Ran `pnpm validate:agent-monitor -- --runtime`; it passed `44/44` checks by explicitly skipping the destructive fast-failure spawn because `environment-bridge` was already running.

### 2026-07-08 - Live Variable Support Audit Slice

- Audited current hot-reload support for Agent Data variables.
- Findings:
  - `environment-bridge` captures the selected adapter connection when the process starts; endpoint, adapter, room, and graph changes are therefore restart-required today.
  - scheduler/boot fields are persisted to `etc/agents.json`, but currently active scheduled trigger ownership is not a clean hot-reload contract in the agent monitor path.
  - the monitor stream already updates Agent Data after config writes through file watching, but that is UI state refresh, not a running-agent hot reload.
- Decision:
  - keep `environment-bridge` variables labeled `restart`;
  - keep `runOnBoot` labeled `nextBoot`;
  - do not label any field `live` until a real running-agent update contract exists.
- This preserves the requirement to avoid stale/misleading state: the UI now tells the truth about when changes apply instead of claiming live behavior that the runtime does not support yet.

### 2026-07-08 - Deprecated Headless Watcher Cleanup Slice

- Found `brain/services/headless-watcher.ts` was explicitly deprecated and exited immediately, but active startup code still attempted to start it as a "minimal bootstrap" service.
- Removed `headless-watcher` from `mh start` in `packages/cli/src/mh-new.ts`.
- Removed `headless-watcher` from restart-core behavior in `packages/core/src/api/handlers/agent.ts`.
- Removed `headless-watcher` from process resolver maps in:
  - `packages/core/src/agent-process-runner.ts`;
  - `brain/scripts/_bootstrap.ts`.
- Deleted the deprecated service file:
  - `brain/services/headless-watcher.ts`.
- Updated `packages/core/src/runtime-mode.ts` so exiting headless mode resumes agents from the Boot Manager snapshot via `startAgentProcess(...)`, not a hardcoded default list.
- Added validator guardrails requiring:
  - restart-core to exclude `headless-watcher`;
  - active startup resolvers to exclude `headless-watcher`;
  - runtime-mode resume to use boot-manager snapshot and the shared runner.
- Ran `pnpm validate:agent-monitor`; it passed `45/45` checks.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility and Rollup chunk warnings unrelated to this slice.

### 2026-07-08 - Final Cruft, Shared Resolver, And Live Bridge Variable Slice

- Completed a final active-source cruft scan for removed agent systems:
  - `headless-watcher`;
  - `babysitter`;
  - `update-check`.
- Deleted the active stale Babysitter planning document:
  - `docs/SYSTEM-CODER-ANALYSIS.md`.
- Updated active user/operator docs so they no longer instruct the user to run the removed `headless-watcher` service:
  - `docs/user-guide/advanced-features/headless-mode.md`;
  - `docs/user-guide/advanced-features/autonomous-agents.md`;
  - `docs/user-guide/configuration-admin/configuration-files.md`;
  - `docs/robot-friend.md`;
  - `docs/SECURITY-FIXES-2025-11-20.md`.
- Left remaining removed-agent matches only where they are historical audit entries, generated inventory snapshots, or validator guardrails.
- Added `packages/core/src/agent-executable-resolver.ts` as the shared owner for:
  - `tsx` resolution;
  - `NODE_PATH` construction;
  - service/modular/legacy agent executable resolution.
- Updated `packages/core/src/agent-process-runner.ts` to use the shared resolver instead of owning path resolution itself.
- Updated `brain/scripts/_bootstrap.ts` to use `@metahuman/core/agent-executable-resolver`, removing its duplicate local service override, agent script override, and path-resolution logic.
- Exported the resolver through:
  - `packages/core/src/index.ts`;
  - `packages/core/package.json`.
- Implemented event-driven live update support for Environment Bridge connection variables:
  - `packages/core/src/environment-interface/store.ts` now exposes `watchEnvironmentBridgeState(...)`;
  - bridge state writes publish immediate in-process subscriber events;
  - the watcher also uses `fs.watch` for separate running agent processes;
  - no polling loop was added.
- Updated `brain/agents/environment-bridge/core.ts` so a running bridge watches connection state changes and reloads the Megameal adapter when a valid adapter, endpoint, room, or graph change is saved through Agent Data.
- Updated Environment Bridge Agent Data fields to `applyMode: live` for:
  - `adapter`;
  - `endpointUrl`;
  - `roomName`;
  - `graphName`.
- Superseded the earlier live-variable audit decision for `environment-bridge`; scheduler variables remain restart-required and `runOnBoot` remains next-boot.
- Extended `scripts/validate-agent-monitor.ts` with guardrails for:
  - shared executable resolver ownership;
  - bootstrap no longer owning path resolution;
  - Environment Bridge evented live reload support;
  - active docs no longer instructing `headless-watcher` use;
  - Environment Bridge endpoint edits being labeled live;
  - Environment Bridge variable edits publishing a state watcher event.
- Ran `pnpm validate:agent-monitor`; it passed `49/49` checks.
- Ran `pnpm validate:agent-monitor -- --runtime`; it passed `50/50` checks, with the runtime fast-failure spawn safely skipped because `environment-bridge` was already running.
- Ran `pnpm --dir apps/site build`; it completed successfully and rebuilt `apps/site/dist`.
- Build caveat: the build still emits existing repo-wide Svelte accessibility, browser-data, and Rollup chunk warnings unrelated to this slice.
