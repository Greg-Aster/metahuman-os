# Trigger Manager Runtime and UI Consolidation Plan

Status: complete

Date: 2026-07-15

Completed: 2026-07-15

Primary owners: `packages/core/src/queue`, `packages/core/src/api/handlers`, `apps/site/src/components`

Related contract: `docs/implementation-plans/operator-queue-work-coordinator.md`

## Implementation record — 2026-07-15

All ten phases and every definition-of-done item in this plan are complete.
The implementation retained TriggerManager as a bounded producer, made the
Work Coordinator the only finite-work execution owner, and separated persistent
service lifecycle into Agent Monitor plus `etc/services.json`.

| Phase | Result | Primary evidence |
| --- | --- | --- |
| 0 — Characterization | complete | Focused runtime, API, catalog, service-lifecycle, UI-architecture, and work-owner contracts cover the former seams. |
| 1 — Config and snapshot | complete | `TriggerConfigService` validates and atomically persists revisions; TriggerManager applies them live; read, control, config, and SSE handlers expose one sanitized snapshot. |
| 2 — Lifecycle and modes | complete | TriggerManager remains observable in reactive, semi, and full; suppression and admission are distinct from coordinator pause; finite startup and service boot policies are separate. |
| 3 — Execution ownership | complete | Finite API, UI, and CLI actions submit coordinator work; persistent services use the shared process runner; Audio Organizer has no implicit boot path. |
| 4 — Dashboard | complete | Full dashboard, overview card, timeline, correlations, health, and controls consume the shared TriggerManager store. |
| 5 — Queue | complete | The compact Queue summary identifies upcoming triggers and correlates the latest admitted work id/state. |
| 6 — Three modes | complete | Conversation, Active Operator settings, Dashboard, Queue, API, and shared labels use `reactive`, `semi`, and `full`; entry into full mode is confirmed. |
| 7 — Settings | complete | `TriggerManagerSettings.svelte` replaces Scheduler settings and edits only trigger-owned fields through the canonical API. |
| 8 — Cleanup | complete | The maintenance service is truthfully named, event and reload links are attached, the placeholder trigger node is removed, services read the service config, and stale ownership paths are audited. |
| 9 — End-to-end validation | complete | Focused contracts, 71 Agent Monitor checks, architecture guardrails, the production site build, lifecycle restart, Node runtime, live HTTP startup, and scoped type diagnostics pass. |

Scheduling configuration is intentionally system-scoped at
`etc/agents.json`: it controls one machine-owned runtime rather than personal
profile content. The API reports `scope: system`, and the Settings UI edits the
same `TriggerConfigService` instance applied by the running TriggerManager.
This explicit choice eliminates the former root/profile resolution split.

## Purpose

Integrate the existing `TriggerManager` into MetaHuman OS as an observable,
configurable part of the Work Coordinator instead of leaving it as a mostly
hidden timer implementation. This plan also closes the remaining scheduler,
boot-agent, direct-process, UI, and documentation seams that can create
duplicate execution paths or misleading system state.

This is a consolidation, not a second scheduling system. The intended runtime
relationship is:

```text
Active Operator mode + Trigger configuration
                    |
                    v
             TriggerManager
        (clock and admission producer)
                    |
                    v
            Work Coordinator
     (durable order, lanes, retry, cancel)
                    |
                    v
           finite agent execution

Persistent services -----------------> one service supervisor
```

## Decisions

1. Retain `TriggerManager`. Its timer-to-durable-work design is better than
   restoring the deleted `AgentScheduler` queue.
2. Do not let `TriggerManager` execute agents directly. It may only submit
   finite work to the Work Coordinator.
3. Do not represent persistent processes as scheduled one-shot work. Services
   such as the Environment Bridge belong to one service lifecycle owner and
   must appear in Agent Monitor while running.
4. Keep the TriggerManager runtime initialized in all three Active Operator
   modes so its state is observable. Mode policy decides whether a due trigger
   is admitted, not whether the clock and status object exist.
5. Use one core configuration owner and one shared browser state store. The
   dashboard, Queue panel, Settings, and conversation control must not each
   invent their own state or polling loop.
6. Replace or migrate existing scheduler surfaces; do not leave a new Trigger
   Manager UI beside an independent `SchedulerSettings` implementation.
7. Delete suspected orphan code only after both static reference discovery and
   runtime entrypoint discovery agree that it has no owner.

## Pre-implementation system map (resolved baseline)

This table records the state found before implementation. It is retained as
audit context and is not a description of the current runtime.

| Concern | Current owner | Current behavior |
| --- | --- | --- |
| Work coordination | `packages/core/src/queue/queue-system.ts` | Owns durable queue, execution engine, TriggerManager, persistence, and resource lanes. |
| Timer admission | `packages/core/src/queue/trigger-manager.ts` | Loads agent trigger configuration and enqueues idempotent work. Starts only when proactive scheduling is enabled. |
| Autonomy policy | `packages/core/src/active-operator/mode-controller.ts` | Supports `reactive`, `semi`, and `full`; enables timer admission in semi/full and policy evaluation only in full. |
| Server ownership | `apps/site/src/middleware.ts` | Claims coordinator ownership and starts it when the maintained Astro server module loads. |
| Trigger read API | `GET /api/unified-queue/triggers` | Returns configured triggers, limited run counters, and next-run timestamps. |
| Trigger configuration | `GET/POST /api/scheduler-config` | Reads and writes root `etc/agents.json`; a successful write does not reload the live TriggerManager. |
| Full queue UI | `apps/site/src/components/QueuePanel.svelte` | Displays coordinator lifecycle, active work, history, pause, cancel, and clear controls. It does not explain timer admissions. |
| Main dashboard | `apps/site/src/components/CenterContent.svelte` | Has Overview, Tasks, Approvals, and Active Operator tabs. It has no Trigger Manager tab. |
| Agent schedule settings | `apps/site/src/components/SchedulerSettings.svelte` | Edits trigger-like fields, global settings, and curiosity settings. Some displayed global fields are not enforced by TriggerManager. |
| Conversation mode control | `apps/site/src/components/ChatInterface.svelte` | Presents an on/off button even though the backend has three modes. The toggle path also compares returned mode with the obsolete value `active`. |
| Process startup | `packages/cli/src/mh-new.ts` and `packages/core/src/agent-process-runner.ts` | Starts every enabled `runOnBoot` entry as a direct OS process. Several UI actions also invoke `/api/agents/run` directly. |
| Maintenance process | `brain/services/scheduler-service.ts` | Performs lock and log maintenance only, despite retaining the scheduler name. |
| Agent Monitor boot model | `packages/core/src/agent-monitor-descriptors.ts` | Synthesizes `scheduler-service` and `audio-organizer`; both default to run on boot when absent from config. |

## Confirmed fragmentation and drift (resolved baseline)

Every item in this section was an implementation input. Final disposition and
validation are recorded below and in
`docs/audits/trigger-manager-orphan-audit-2026-07-15.md`.

### Runtime and configuration

- `TriggerManager.reloadConfig()` has no maintained caller. Settings can say an
  agent is disabled while its existing timer continues to use the old in-memory
  configuration until a restart or mode transition.
- `TriggerManager.triggerEvent()` has no maintained caller. Event trigger
  configuration is therefore an exposed capability without a live event-bus
  attachment.
- `TriggerManager` resolves configuration through `storageClient`, while the
  scheduler-config handler and Agent Monitor directly target root
  `etc/agents.json`. These paths can disagree in a profile-aware runtime.
- `runOnBoot` currently means two different things: an interval trigger can fire
  immediately when TriggerManager starts, and the CLI can spawn the same agent
  as a direct process at system startup. This creates duplicate-run risk.
- `autoRestart` describes process supervision, but it is stored beside finite
  timer configuration and is not a TriggerManager responsibility.
- Scheduler settings expose concurrency and activity-pause fields that are not
  the source of truth for the coordinator's resource lanes or current
  TriggerManager behavior.
- In reactive mode the TriggerManager is stopped, so the UI cannot truthfully
  show its loaded configuration, calculated next times, or why admissions are
  suppressed.

### Execution ownership

- `/api/agents/run`, Agent Monitor, Memory Controls, Task Manager, Sync Manager,
  Auth Gate startup actions, CLI `mh agent run`, CLI boot, and runtime-mode code
  can start agent processes outside the Work Coordinator.
- Some of those direct starts are valid persistent-service operations; finite
  one-shot and scheduled agent starts are coordinator bypasses and must migrate.
- `packages/core/src/nodes/thought/agent-trigger.node.ts` reports a successful
  trigger but contains placeholder execution logic. No maintained graph
  reference was found in the initial scan.
- The existing `scheduler-service` description still says it runs the timer bus,
  but its implementation explicitly says it is maintenance-only.

### UI and documentation

- The backend and `ActiveOperatorSettings.svelte` already support three modes,
  but the high-use conversation button reduces them to two.
- Queue state includes only `nextTriggers` and omits why a trigger was skipped,
  which task it admitted, whether configuration is current, and whether the
  timer subsystem is healthy.
- `SchedulerSettings.svelte` duplicates trigger types and agent labels locally
  instead of consuming a canonical schema/read model.
- Maintained documentation still contains statements that `scheduler-service`
  coordinates or watches scheduled agents. Those statements no longer match
  runtime behavior.
- Stop/start scripts still contain scheduler-service and audio-organizer process
  patterns. Each must be classified as a valid service cleanup path, a temporary
  migration alias, or stale code.

## Target runtime contract

### TriggerManager is always observable

`QueueSystem` initializes and starts the TriggerManager clock/status subsystem
whenever the coordinator starts. Active Operator mode supplies an admission
policy:

| Mode | Timer state | Configured trigger admission | Bounded policy producer |
| --- | --- | --- | --- |
| Reactive | Running and visible | Suppressed with reason `mode:reactive` | Off |
| Semi-autonomous | Running and visible | Enabled triggers may enqueue low-priority work | Off |
| Fully autonomous | Running and visible | Same as semi-autonomous | On |

Manual user actions and necessary system/environment events remain available in
reactive mode, subject to their own authorization and safety policy. They are
not disguised as proactive timer work.

The TriggerManager's own global pause controls admissions. The Work
Coordinator's pause controls execution. These are separate states and the UI
must label them separately.

### Finite work versus persistent services

Every configured item receives an explicit lifecycle classification:

- `scheduled-work`: interval, time-of-day, inactivity, event, or manual work
  that reaches a terminal result. It always enters the coordinator.
- `service`: a process or connection intended to remain alive. It is started,
  stopped, restarted, and monitored by one service supervisor.
- `workflow`: a finite coordinator item that can enqueue child work through the
  same coordinator contract.

`runOnBoot` must be split by meaning:

- Service lifecycle uses `startOnSystemBoot` under the service owner.
- Scheduled work uses an explicit `startupPolicy`: `skip`, `run-once`, or
  `recover-missed`. The default is `skip`.
- One-shot utilities such as Audio Organizer must never silently default to a
  boot run merely because their descriptor is missing from configuration.

### Canonical configuration owner

Add a core `TriggerConfigService` (exact filename can follow local naming
conventions) that exclusively owns:

- resolving the effective system/profile configuration path;
- parsing and validating the schema;
- applying defaults;
- atomic persistence;
- incrementing a configuration revision;
- reloading the live TriggerManager after a successful write;
- returning the applied revision and runtime revision;
- audit events for before/after field names without recording personal data.

Keep `agents.json` as the scheduling catalog during migration rather than
introducing a parallel trigger file. Remove service-supervision fields from its
trigger schema after their migration to the service lifecycle owner. The API
must expose whether the effective data is system or profile scoped without
leaking a personal filesystem path.

The validated trigger schema needs:

- stable `id`, display name, description, lifecycle class, enabled flag;
- trigger type: interval, time-of-day, inactivity, event, or manual;
- timezone and local schedule for time-of-day triggers;
- interval/inactivity duration with minimum and maximum bounds;
- priority, resource class, retry limit, probability, jitter, and conditions;
- allowed autonomy modes or an equivalent admission policy;
- startup policy for finite work;
- canonical handler id and validation that the execution engine can resolve it.

Unknown fields and impossible combinations must return a validation error rather
than being accepted and ignored.

### Live state model

Expose a single sanitized TriggerManager snapshot containing:

- manager lifecycle: `starting`, `running`, `paused`, `degraded`, or `stopped`;
- Active Operator mode and whether proactive admission is permitted;
- server time, timezone, next wake time, last evaluation time, and clock lag;
- loaded config scope, persisted revision, runtime revision, last reload time,
  and reload error;
- global pause and quiet-hours state;
- per-trigger configuration summary;
- per-trigger last due time, next due time, due-in milliseconds, last admitted
  time, last outcome, run/error/suppression counts, and last suppression reason;
- the most recent admitted queue task id and its current coordinator state;
- whether the handler is registered and whether its source is resolvable.

Suppression reasons should be explicit values such as `disabled`,
`mode:reactive`, `global-pause`, `quiet-hours`, `condition`, `probability`,
`duplicate`, `invalid-handler`, and `queue-unavailable`. A skipped timer must not
look like a successful agent run.

The server supplies authoritative timestamps. The browser may render a local
countdown between state events, but it must periodically reconcile with server
time and show the configured timezone.

## API plan

Keep business logic in `packages/core/src/api/handlers` and Astro transports
thin.

### Read and stream

- `GET /api/trigger-manager`: complete sanitized runtime/config snapshot.
- `GET /api/trigger-manager/stream`: SSE state changes and a low-frequency
  reconciliation heartbeat. It must clean up listeners on abort.

The existing `GET /api/unified-queue/triggers` can temporarily delegate to the
new read model, then be removed or retained as a documented compatibility
alias. Do not maintain two implementations.

### Controls

- `POST /api/trigger-manager/control`
  - `pause-admission`
  - `resume-admission`
  - `reload-config`
  - `run-now` with a trigger id
- `PATCH /api/trigger-manager/config`: validated global or per-trigger changes,
  owner-only, persisted atomically, then applied live.

`run-now` must enqueue through the coordinator and return the durable work id.
It must not spawn a child process directly. Starting/stopping persistent services
remains an Agent Monitor/service-supervisor operation, not a TriggerManager
control.

### Shared browser store

Create one client-side TriggerManager store that owns the SSE connection,
snapshot reconciliation, mutations, and optimistic-control rollback. The full
dashboard, compact Queue summary, Settings, and conversation mode indicator all
consume it. This prevents four network loops and four subtly different state
models.

## UI plan

### Left Dashboard: full Trigger Manager view

Add a `Trigger Manager` tab beside Overview, Tasks, Approvals, and Active
Operator in the existing Dashboard view. Lazy-load a new
`TriggerManagerDashboard.svelte` from `CenterContent.svelte`.

The full view contains:

1. Runtime header: lifecycle, Active Operator mode, admission state, server
   clock/timezone, config revision, live/reconnecting state, pause/resume, and
   reload controls.
2. Timeline: the next scheduled triggers in chronological order with absolute
   time, countdown, agent, trigger type, mode eligibility, and predicted action.
3. Trigger table/cards: enabled state, timing rule, last due, last admitted,
   latest queue outcome, run/error/suppression totals, and a clear suppression
   explanation.
4. Recent admissions: links between TriggerManager events and coordinator work
   ids so the user can follow `due -> admitted -> queued -> running -> terminal`.
5. Health findings: stale config revision, missing handler, unresolved source,
   invalid schedule, clock lag, or stream disconnection.
6. Safe controls: pause/resume admissions, reload, run now, and navigate to
   Trigger Manager settings. Destructive or autonomy-expanding actions require
   clear confirmation.

Also add a small Trigger Manager summary card to Dashboard Overview. It should
link to the full tab and show only lifecycle, mode, admission state, and the next
due trigger.

### Right Queue tab: compact Trigger Manager view

Add a compact `TriggerManagerSummary.svelte` above the global work order in
`QueuePanel.svelte`. It shows:

- manager state and admission state;
- current Active Operator mode;
- server-relative time to next due trigger;
- the next three eligible or suppressed triggers;
- the most recent task admitted by TriggerManager and its queue state;
- a direct link to the full Dashboard tab.

The compact view is explanatory, not a second settings panel. Keep only
pause/resume and navigation controls there. Queue pause remains in the Work
Coordinator header.

### Conversation: three-state Active Operator button

Replace the boolean `activeOperatorEnabled` model with the shared
`AutonomyMode` union. The compact button must visibly distinguish:

- Reactive: neutral color and `R` badge;
- Semi-autonomous: amber color and `S` badge;
- Fully autonomous: violet/red-attention color and `F` badge.

Use explicit `set-mode` requests. Do not call the legacy two-state `toggle`
action and do not compare a returned mode with `active`. A click can advance
`reactive -> semi -> full -> reactive`; entering full mode should require a
confirmation or an explicit selection menu to avoid accidental escalation.
Tooltips and accessible labels must describe what the selected mode admits.

Mode constants, labels, colors, and descriptions should come from one
browser-safe module shared with `ActiveOperatorSettings.svelte`.

### Left System settings: Trigger Manager configuration

Rename or replace the existing Scheduler tab with `Trigger Manager`. Evolve
`SchedulerSettings.svelte` in place or migrate it to
`TriggerManagerSettings.svelte`, but remove the old duplicate surface in the
same phase.

The settings view provides:

- global admission pause and quiet hours;
- explicit timezone;
- per-agent enabled toggle;
- trigger type;
- interval, inactivity duration, event pattern, or time-of-day editor as
  appropriate;
- allowed autonomy modes;
- startup policy for finite work;
- priority, retries, and optional jitter/probability under advanced settings;
- validation errors next to the relevant field;
- live applied/persisted revision status;
- `Run now` for finite work;
- links to the full runtime dashboard and current queued work.

Coordinator resource-lane concurrency belongs in Work Coordinator settings,
not Trigger Manager settings. Service start-on-boot and restart policy belong in
Agent Monitor/service settings. Curiosity-specific product settings may remain
embedded only if they update the same canonical trigger config transaction;
otherwise link to their domain settings instead of dual-writing.

## Orphan process and broken-link audit

### Initial findings and final disposition

| Surface | Finding | Final disposition |
| --- | --- | --- |
| `brain/services/scheduler-service.ts` | Name and UI description said scheduler; implementation performed maintenance only. | Replaced by `maintenance-service`; service config, process lock, monitor descriptor, validator, and lifecycle controls use the bounded name. |
| `packages/core/src/nodes/thought/agent-trigger.node.ts` | Placeholder reported success without submitting or executing work; no maintained graph reference existed. | Removed with its barrel export; the architecture contract prevents its return. |
| `TriggerManager.triggerEvent()` | No maintained caller existed. | Attached once to canonical incoming Event Bus delivery in `QueueSystem`; the configured event pattern is the allowlist. |
| Trigger config reload | No maintained live-reload caller existed. | `TriggerConfigService` notifies the running TriggerManager and exposes persisted/runtime revisions and reload errors. |
| `/api/agents/run` and UI callers | Finite agents bypassed the coordinator. | Finite callers use TriggerManager `run-now`; `/api/agents/run` is limited to persistent service lifecycle. |
| CLI boot and `runOnBoot` | Direct spawns overlapped timer startup semantics. | `etc/services.json` owns `startOnSystemBoot`; finite triggers use `startupPolicy`; Audio Organizer is manual/skip by default. |
| `SchedulerSettings.svelte` | Useful UI was mixed with unenforced fields and duplicated metadata. | Replaced by `TriggerManagerSettings.svelte`; queue and service settings remain with their own owners. |
| Agent Monitor scheduler descriptor | Claimed a maintenance process owned timer admission. | Replaced by a truthful Maintenance Service descriptor and two-service boot catalog. |
| Start/stop/PM2 scripts | Contained obsolete ownership names and comments. | Scheduler process patterns were removed/renamed; PM2 now explicitly owns only the web server. Audio cleanup remains only as bounded shutdown compatibility for an in-flight finite worker. |
| Maintained user docs | Several pages assigned scheduling to the maintenance process. | Updated to TriggerManager + Work Coordinator; historical investigation/audit records remain clearly historical. |
| Existing coordinator plan | Needed a follow-up after the finite-run and service split. | Reconciled with a dated TriggerManager follow-up and current validation evidence. |

### Required search procedure

Run this against the maintained source only; exclude `apps/code-oss`, deprecated
`apps/mobile`, generated builds, runtime logs, and user data.

1. Build an entrypoint inventory from package scripts, `start.sh`, `start.py`,
   CLI commands, Astro middleware, API routes, service files, systemd user units,
   cron, PM2, and process registries.
2. Search all identifiers, filenames, API paths, handler ids, event names, lock
   names, and config keys for the deleted `AgentScheduler`, current
   TriggerManager, scheduler-service, and every configured agent.
3. For every configured trigger, prove:
   - source exists;
   - handler registration exists;
   - API/CLI/UI link reaches the canonical owner;
   - result appears in coordinator state;
   - no second timer or direct spawn path exists.
4. For every live process, prove:
   - who started it;
   - which lock/registry tracks it;
   - which UI owns its controls;
   - how shutdown and restart work;
   - whether it is a service or finite task.
5. For every suspected orphan, require both zero static references and zero
   runtime/entrypoint reachability before deletion.
6. Search maintained docs and tests separately. A stale test that asserts an old
   system is required is drift, not proof that the old system is still correct.
7. Record each finding under `docs/audits/` with owner, evidence, disposition,
   and validation command before deleting source.

The initial one-shot process check from the agent sandbox did not find a
matching user systemd unit or cron entry. Its process namespace is isolated, so
it cannot prove that the host has no matching process. Repeat the live-process
inventory from the actual MetaHuman launch environment during implementation.
No persistent diagnostic terminal is required for this audit.

## Implementation sequence

### Phase 0: characterization and guardrails

- [x] Capture current config, API shapes, mode behavior, coordinator state, process
  startup ownership, and all direct-run callers.
- [x] Add characterization tests for live config reload, three modes,
  suppression reasons, trigger-to-work correlation, and boot duplication.
- [x] Add an architecture guardrail that finite agent UI/API execution cannot call
  `startAgentProcess` directly.

Exit gate: **complete** — baseline seams are captured by the focused contracts
and orphan audit.

### Phase 1: canonical config and runtime snapshot

- [x] Add the core TriggerConfigService and schema validation.
- [x] Add config revisions and atomic live reload.
- [x] Expand TriggerManager state and suppression accounting.
- [x] Add the read and SSE APIs with thin Astro transports.

Exit gate: **complete** — saving a trigger immediately updates live timing and
the API reports matching persisted/runtime revisions.

### Phase 2: lifecycle and autonomy semantics

- [x] Keep TriggerManager observable in all modes.
- [x] Apply reactive/semi/full admission policy without stopping the clock state.
- [x] Separate admission pause from coordinator execution pause.
- [x] Split scheduled-work startup policy from service boot/restart policy.

Exit gate: **complete** — mode transitions change admission eligibility exactly
once without restarting the coordinator or losing schedule visibility.

### Phase 3: execution-path consolidation

- [x] Migrate finite `/api/agents/run` callers and CLI/manual actions to coordinator
  submission.
- [x] Retain a narrowly named service lifecycle path for persistent processes.
- [x] Verify every configured trigger handler and delete invalid catalog entries or
  restore their owner.
- [x] Remove Audio Organizer's synthesized boot default.

Exit gate: **complete** — every finite run has one durable work id and no finite
agent is both spawned on boot and admitted by a timer.

### Phase 4: full Dashboard view

- [x] Add the Trigger Manager Dashboard tab and overview card.
- [x] Implement runtime clock, timeline, trigger details, recent admissions, health,
  and safe controls using the shared store.

Exit gate: **complete** — the Dashboard explains what will run next, when, why,
and under which mode.

### Phase 5: compact Queue integration

- [x] Add the compact Trigger Manager summary to QueuePanel.
- [x] Correlate producer metadata with queue work and recent history.

Exit gate: **complete** — Queue shows the originating trigger, durable id, and
current work state.

### Phase 6: three-state conversation control

- [x] Replace boolean chat state with `AutonomyMode`.
- [x] Use explicit mode changes and shared labels.
- [x] Remove or deprecate the backend two-state toggle after all callers migrate.

Exit gate: **complete** — reactive, semi, and full remain correct after reload
and agree in conversation, settings, dashboard, Queue, and API.

### Phase 7: Settings consolidation

- [x] Replace the Scheduler tab with Trigger Manager settings.
- [x] Move queue capacity and service lifecycle controls to their actual owners.
- [x] Remove local duplicate schemas and metadata.

Exit gate: **complete** — every visible control has an observed runtime effect
or was removed.

### Phase 8: orphan and broken-link cleanup

- [x] Complete the maintained-source and live-entrypoint audit.
- [x] Reattach valid event, handler, transport, monitor, and shutdown links.
- [x] Remove confirmed placeholders, stale scripts, tests,
  and documentation.
- [x] Retain only the thin `/api/scheduler-config` compatibility alias, which
  delegates to `TriggerConfigService` and has no independent state or logic.
- [x] Reconcile the coordinator plan and architecture docs with verified behavior.

Exit gate: **complete** — architecture checks find no duplicate finite-work
owner, broken trigger handler, stale scheduler-service ownership claim, or
orphan process owned by the former scheduler path.

### Phase 9: end-to-end validation

- [x] Build the site and type-check touched packages.
- [x] Run coordinator and architecture tests.
- [x] Start through the supported full-system path.
- [x] Exercise each mode, a timed trigger, inactivity trigger, manual run, config
  edit, admission pause, queue pause, restart recovery, and service restart.
- [x] Verify UI consistency through the live SSE handoff, not enqueue success alone.

Exit gate: **complete** — all definition-of-done items below have direct
evidence.

## Validation matrix

| Scenario | Required result |
| --- | --- |
| Start in reactive mode | Trigger clock and schedule are visible; timer admissions are suppressed with `mode:reactive`; no proactive work is enqueued. |
| Change to semi | Eligible configured timers can enqueue low-priority work exactly once; policy producer remains off. |
| Change to full | Semi behavior remains; bounded policy producer starts exactly once. |
| Change a trigger time | Persisted and runtime revisions match; next due time changes without server restart. |
| Disable an agent | Existing timer is cancelled/rescheduled safely; no further admission occurs. |
| Run now | One coordinator id is returned and visible in Queue history. |
| Pause TriggerManager | New timer admissions stop; already queued work is unchanged. |
| Pause Work Coordinator | Execution stops according to coordinator semantics; TriggerManager UI explains whether admissions continue or are globally paused. |
| Restart system | Service lifecycle entries start once; finite startup-policy work is admitted at most once; no Audio Organizer default run. |
| Missing handler/source | Trigger is degraded/invalid and cannot report a successful run. |
| SSE reconnect | All surfaces converge on the same snapshot and no listener/connection leak remains. |
| Multi-user/profile resolution | API reports effective scope and TriggerManager applies the same scope the Settings UI edited. |

Minimum command set, adjusted if package scripts change:

```bash
pnpm -s check:architecture
pnpm validate:agent-monitor
node --import tsx packages/core/src/queue/work-coordinator.spec.ts
node --import tsx packages/core/src/queue/work-owner-architecture.spec.ts
pnpm --dir apps/site build
./bin/audit check
```

Add focused TriggerManager configuration/API/UI tests rather than relying only
on the existing broad validation scripts.

## Definition of done

- [x] TriggerManager has one runtime owner, one configuration owner, and one public
  state model.
- [x] Dashboard has a full live Trigger Manager view.
- [x] Queue has a compact producer view correlated with admitted work.
- [x] System Settings fully configures supported triggers and applies changes live.
- [x] Conversation, Settings, Dashboard, and API agree on all three Active Operator
  modes.
- [x] Every timer displays authoritative next-run time and timezone.
- [x] Every due event records admission or a visible suppression/failure reason.
- [x] Every finite triggered agent passes through the Work Coordinator exactly once.
- [x] Every persistent service appears in Agent Monitor while running and has one
  startup/shutdown owner.
- [x] Audio Organizer does not run at boot unless the user explicitly configures an
  appropriate finite startup policy.
- [x] Placeholder/orphan paths are implemented, reattached, or removed with audit
  evidence.
- [x] No maintained documentation claims the maintenance service owns scheduling.
- [x] No personal/runtime data is added to tracked source.

## Completion evidence

| Contract | Evidence |
| --- | --- |
| One runtime/config/state owner | `QueueSystem`, `TriggerConfigService`, and `TriggerManagerSnapshot`; architecture guardrail reports zero violations. |
| Live UI | Dashboard, overview, Queue summary, Settings, and conversation mode consume one ref-counted SSE browser store. |
| Three modes | Runtime tests cover reactive suppression, semi admission, and full policy behavior; the UI architecture contract prohibits the legacy boolean/toggle model. |
| Timing and reasons | Server clock, timezone, next due time, lag, outcomes, counts, and suppression reasons are in the canonical snapshot. |
| Exactly-once finite work | Trigger admissions carry producer/trigger metadata and one durable coordinator id; handler, mode, interval, event, activity, and manual paths are covered. |
| Service lifecycle | `service-lifecycle.spec.ts` starts Maintenance through a bounded launcher, proves the service survives that launcher's exit, observes one Agent Monitor card, restarts to one new PID, and stops it. Durable service logs replace terminal-owned pipes. |
| Audio Organizer | Catalog contract proves it is `scheduled-work`, manual, disabled from timer admission, `startupPolicy: skip`, and absent from the two-service boot catalog. |
| Orphans and links | The dated audit records the removed placeholder, renamed service, restored Event Bus/config/service links, process cleanup, and maintained-source search. |
| Production path | A supported `./start.sh` launch was observed serving HTTP 200 from the built Astro entry; a bounded production-entry probe also returned HTTP 200 and reached the Trigger Manager route's auth guard. |

The exact final command results are recorded below after the implementation
source and documentation were reconciled.

## Final validation record

Validation completed on 2026-07-15:

| Command or probe | Result |
| --- | --- |
| `node --import tsx packages/core/src/queue/trigger-manager.spec.ts` | passed; live revisions, field validation, reactive/semi/full policy, interval/activity/event/manual admission, pauses, suppression, and correlation |
| `node --import tsx packages/core/src/queue/trigger-manager-api.spec.ts` | passed; initial snapshot and abort cleanup without listener leakage |
| `node --import tsx packages/core/src/queue/trigger-manager-catalog.spec.ts` | passed; 18 finite triggers, resolvable handlers/sources, zero health findings, Audio Organizer manual/skip, two boot services |
| `node --import tsx packages/core/src/queue/work-coordinator.spec.ts` | passed; includes idempotency, pause, retry, cancellation, and restart recovery |
| `node --import tsx packages/core/src/queue/work-owner-architecture.spec.ts` | passed; one finite-work owner and deleted/broken-path guardrails |
| `node --import tsx packages/core/src/queue/trigger-manager-ui-architecture.spec.ts` | passed; shared store, four surfaces, three modes, and no legacy Scheduler UI |
| Host `node --import tsx packages/core/src/queue/service-lifecycle.spec.ts` | passed; Maintenance survives a bounded launcher, has exactly one monitor card, restarts to a new PID, and stops |
| `node --import tsx scripts/validate-agent-monitor.ts` | passed, 71/71 checks; exactly two boot services |
| `pnpm -s check:architecture` | passed; zero current violations |
| `./bin/audit check` | passed in the host environment; architecture and tracked-source/package gates clear |
| `node --import tsx scripts/create-audit-inventory.ts` | passed; regenerated 1,920 maintained files and 1,360 code files without deleted legacy paths |
| `pnpm --dir apps/site build` | passed; existing broad Svelte accessibility, circular-export, and CSS warnings remain non-fatal and outside this consolidation |
| Scoped core TypeScript diagnostic filter | passed with `SCOPED_DIAGNOSTICS=0` for queue, Active Operator, trigger/agent APIs, service runner/monitor/locks, and Event Bus client |
| `node scripts/check-node-runtime.mjs` | passed on Node.js 22.22.0 |
| Supported full-system/live HTTP probes | built Astro entry returned HTTP 200; Trigger Manager route reached its expected owner-auth guard; no diagnostic server remained |
| `git diff --check` | passed after final documentation and inventory regeneration |

The full core typecheck still reports pre-existing diagnostics elsewhere in the
repository, as documented in the related Work Coordinator closeout. No
diagnostic points at the TriggerManager, coordinator, Active Operator,
service-lifecycle, or touched API ownership surfaces.
