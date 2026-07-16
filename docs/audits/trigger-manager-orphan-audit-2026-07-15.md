# Trigger Manager Orphan and Ownership Audit — 2026-07-15

Scope: maintained MetaHuman source, excluding `apps/code-oss`, runtime/user data,
generated output, and historical documents under `docs/archive`.

## Entry-point and ownership findings

| Surface | Evidence before consolidation | Disposition |
| --- | --- | --- |
| Trigger runtime | `QueueSystem` was the only maintained constructor, but mode changes stopped timer observability. | Retained as the single runtime owner; TriggerManager now remains running in reactive, semi, and full modes and records suppression. |
| Trigger config | Scheduler settings and curiosity/boredom handlers wrote `etc/agents.json` independently. | `TriggerConfigService` is the only trigger-file writer. Domain handlers delegate to it and receive live revision application. |
| Persistent service config | Boot/restart fields shared `agents.json` with finite schedules. | Moved to `etc/services.json`; Agent Monitor is the service lifecycle owner. |
| Finite UI runs | Memory, task, sync, auth, and monitor UI paths called `/api/agents/run`. | Migrated finite actions to Trigger Manager `run-now`, returning one durable coordinator task id. `/api/agents/run` remains only for Agent Monitor service/connection control. |
| Audio Organizer boot | A synthesized descriptor could make the one-shot utility boot-eligible. | Boot eligibility and the synthesized boot default were removed. It is finite work and can only be explicitly admitted through the coordinator. |
| `scheduler-service` | `brain/services/scheduler-service.ts` performed maintenance but its name implied schedule ownership. | Renamed to `maintenance-service`; source, service config, monitor descriptor, validator, and start/stop patterns now use the bounded maintenance name. |
| `agent-trigger.node.ts` | Exported from the thought-node barrel but had no graph, registry, API, CLI, or runtime caller; it returned success without submitting work. | Confirmed placeholder orphan; removed rather than preserving a false execution path. |
| Event triggers | `TriggerManager.triggerEvent()` had no maintained caller. | Attached once to the canonical event-bus client in `QueueSystem`; configured exact/prefix event patterns are the admission allowlist. |
| Reload path | Trigger settings did not change the live runtime. | Config writes notify the running TriggerManager and the public snapshot reports matching persisted/runtime revisions. |
| Settings UI | `SchedulerSettings.svelte` maintained a second browser schema and displayed queue-capacity controls it did not own. | Replaced with `TriggerManagerSettings.svelte`; queue lanes remain owned by `etc/queue.json`. The duplicate component was removed. |
| Active Operator chat control | Boolean UI called the legacy `toggle` action and compared the response to the nonexistent `active` mode. | Replaced with explicit reactive/semi/full mode selection and shared browser-safe mode definitions. |
| Environment Bridge config | The persistent service still read `etc/agents.json`, so service edits under the new owner could be ignored. | Reattached to `etc/services.json`; the architecture contract now prohibits the old lookup. |
| Service process lock | Maintenance used the old scheduler-derived process lock and duplicate starts could return success while leaving a WebSocket/stdio handle alive. | The shared runner maps service ids to their real lock, checks/repairs ownership before spawn, writes detached stdout/stderr to durable per-service logs, and makes Event Bus reconnect/socket handles non-owning. Maintenance acquires its singleton lock before work and releases it on shutdown. |
| Scheduler compatibility API | An older transport path remained useful to non-UI clients. | Retained only as a thin compatibility alias that delegates reads/writes to `TriggerConfigService`; the maintained UI has no caller and no second config state exists. |

## Link checks

- Trigger transports route through core handlers; Astro endpoints contain no
  scheduling business logic.
- Trigger-to-work correlation uses producer metadata plus the durable task id
  exposed in Dashboard and Queue views.
- Trigger SSE subscribes to TriggerManager and queue state and removes both
  listeners on abort.
- Service shutdown patterns now match the actual `maintenance-service` process.
- No maintained graph references `AgentTriggerNode`; the only source reference
  was its thought-node barrel export.
- The Environment Bridge and Maintenance Service both resolve lifecycle fields
  from `etc/services.json`; finite trigger config contains no service or
  `runOnBoot` fields.
- The shared service runner checks the process-specific lock before reporting a
  successful start, so Agent Monitor cannot manufacture duplicate service cards.

## Live entrypoint and process findings

The live inventory was repeated in the host launch environment rather than
inferred from the agent sandbox.

| Finding | Evidence | Disposition |
| --- | --- | --- |
| Old scheduler process | One already-running `scheduler-service` process predated this implementation. | Stopped during migration; no maintained launcher, config, resolver, or source path can recreate it. |
| Duplicate Maintenance children | Early restart probes exposed duplicate processes that had returned from the service body while an Event Bus socket kept the Node process alive. | Root cause fixed in the shared runner, service lock contract, and Event Bus client; stale probe processes were stopped. |
| Maintenance lifecycle | A host lifecycle contract started the service from a bounded launcher, proved it survived the launcher's exit, observed exactly one Agent Monitor card, restarted it to one different PID, still observed one card, and stopped it in `finally`. | Valid persistent service with one start/restart/stop owner; retained. |
| Full-system launcher | A supported `bash ./start.sh` process, its built Astro `entry.mjs`, and the Environment Bridge were observed; the site returned HTTP 200. | Valid current runtime. It was observed, not spawned or left behind by the audit. |
| One-shot completions | Agent Monitor reported Audio Organizer under completed one-shot runs, not active services. | Correct historical run accounting; no evidence of a live Audio Organizer service. |

No diagnostic `tail`, shell, or validation server was left running. A bounded
production-entry smoke test restored the durable queue file byte-for-byte and
terminated its server before completion.

## Maintained-source search result

Static searches excluded `apps/code-oss`, deprecated `apps/mobile`, generated
mobile/build output, runtime data, and archived documentation. Current source
contains no `scheduler-service` implementation, resolver, startup config, or
ownership claim. Remaining occurrences are intentionally limited to:

- this dated audit and pre-implementation baseline;
- historical investigations/audits;
- architecture tests that prohibit the deleted paths;
- the thin `/api/scheduler-config` compatibility transport and security-route
  inventory, both delegating to the canonical config owner.

The Audio Organizer identifier remains in its finite agent implementation,
catalog, CLI help, monitor descriptor, coordinator API allowlist, and bounded
global-shutdown cleanup. None is a boot scheduler or persistent-service owner.

## Historical material

Archived user guides and completed investigation/audit records may retain the
old scheduler name as historical evidence. They are not live architecture or
startup authority. Maintained docs are updated to name TriggerManager, Work
Coordinator, and Maintenance Service according to their current ownership.

## Validation evidence

| Probe | Result |
| --- | --- |
| TriggerManager runtime/API/catalog contracts | passed; config validation/live revision, all modes, suppression, correlations, SSE abort cleanup, and 18 finite handlers |
| Work Coordinator and work-owner contracts | passed |
| TriggerManager UI architecture contract | passed |
| `pnpm -s check:architecture` | passed; zero current violations |
| `node --import tsx scripts/validate-agent-monitor.ts` | passed; 71/71 checks and two boot services |
| Host `service-lifecycle.spec.ts` | passed; survive-launcher/start/restart/single-card/stop lifecycle |
| `node scripts/check-node-runtime.mjs` | passed on Node.js 22.22.0 |
| Site production build | passed with only existing non-scoped Svelte accessibility/CSS warnings |
| `git diff --check` | passed |
