# Operator Queue and Work Coordinator Implementation

Status: verification
Started: 2026-07-14
Owner: `packages/core/src/queue`
Scope: maintained MetaHuman OS work coordination, autonomy scheduling, chat work, and environment/Ainekio work

## Authority and purpose

This document is the implementation contract for consolidating MetaHuman OS work scheduling. It is subordinate to:

- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/technical/AUDIT_PROTOCOL.md`
- `docs/audits/consolidation-progress.md`

The 660-line supporting audit was verified, consolidated into this contract on 2026-07-14, and deleted after implementation so it would not remain as a second permanent architecture document.

The goal is one understandable work coordinator, not another wrapper around the existing queues. Replaced owners must be migrated and removed. Compatibility shims are temporary and must have a deletion step in the phase that introduces them.

This system is distinct from the ReAct chat/tool operator documented in the older reactive-operator plans. In this document:

- **Work coordinator** means the deterministic owner in `packages/core/src/queue`.
- **Active Operator** means the autonomy-mode controller above the coordinator.
- **Operator Policy Graph** means the optional LLM policy used only by fully autonomous mode.
- **Executor** means a handler that claims a coordinator work item for a real resource.
- **Transport buffer** means bounded SSE, audio, socket, or firmware buffering that is not executable OS work.

## Product goals

1. Make `packages/core/src/queue` the sole maintained source of truth for executable MetaHuman work.
2. Keep the work coordinator deterministic and operational even when all LLMs and node graphs are unavailable.
3. Support three explicit autonomy modes:
   - `reactive`: user, system, and environment events only; proactive producers paused.
   - `semi`: configured timer, time-of-day, and inactivity producers may enqueue work.
   - `full`: semi-autonomous behavior plus a bounded Operator Policy Graph that may select or propose one useful next action.
4. Route chat, scheduled agents, Active Operator work, Ainekio commands, and Ainekio observations through durable coordinator work IDs.
5. Preserve semantic robot commands, stop priority, short motion deadlines, session isolation, and body-owned hard safety.
6. Leave no maintained duplicate queue, direct execution bypass, orphan compatibility path, stale route, or misleading legacy documentation in this scope.

## Non-goals

- No Redis, distributed broker, cloud scheduler, or new service.
- No refactor of `apps/code-oss`, deprecated `apps/mobile`, graph traversal arrays, SSE chunk buffers, TTS playback buffers, or robot firmware RX buffers.
- No raw-servo or hardware-specific command generation in MetaHuman OS.
- No autonomous physical movement without the existing trust and approval gates.
- No unrelated UI redesign or broad cleanup outside work coordination.

## Architecture contract

### One coordinator

Only `packages/core/src/queue` may:

- assign durable work IDs;
- persist executable work state;
- order runnable work;
- claim and dispatch work;
- retry, cancel, expire, or complete work;
- publish authoritative work lifecycle events.

Other systems may produce work, execute claimed work, or maintain bounded projections. They may not keep a second executable work list.

### Deterministic scheduling

The coordinator selects the highest-priority runnable work item, then the oldest item in that priority. Hard constraints are evaluated before selection:

1. safety and cancellation;
2. work state and time bounds;
3. executor availability and concurrency;
4. dependency and approval state;
5. priority and age.

An LLM cannot change these rules. It cannot bypass a blocked state, execute an unknown task ID, reorder a higher-priority task, or dispatch a robot action directly.

### Optional policy graph

The Operator Policy Graph is invoked only by full autonomy after deterministic gates allow it. Its bounded inputs are:

- runnable queue summaries;
- recent completed graph/work summaries;
- user activity, timers, budget, and cooldown state;
- connected environment session and observation summary;
- explicit autonomy mode and per-work cognitive mode.

Its strict output is one of:

```json
{ "decision": "execute", "taskId": "task-id", "reason": "..." }
```

```json
{ "decision": "wait", "reason": "...", "wakeAt": "ISO timestamp" }
```

```json
{ "decision": "request_input", "taskId": "task-id", "reason": "..." }
```

```json
{ "decision": "propose", "handler": "registered-handler", "reason": "..." }
```

`execute` must reference an existing eligible task ID. `propose` may create at most one low-priority work item through coordinator validation. `wait` stores a wake condition; it does not create a recurring idle task. `request_input` blocks only the affected workflow.

### Autonomy modes

#### Reactive

- The coordinator remains running.
- User messages, manual work, approvals, robot observations, faults, and safety stops run normally.
- Scheduled, inactivity, boredom, curiosity, reflection, dream, maintenance, and Lizard Brain producers do not enqueue new work.
- Existing proactive work is retained as visibly waiting or cancelled by explicit user action; it is not silently discarded.

#### Semi-autonomous

- Reactive behavior remains active.
- `TriggerManager` is a producer only.
- Configured interval, time-of-day, and inactivity events enqueue idempotent work with explicit handler identity.
- Deterministic coordinator priority decides execution. No scheduling LLM is required.

#### Fully autonomous

- Semi-autonomous behavior remains active.
- When no ordinary runnable work remains, full-autonomy gates may invoke the Operator Policy Graph once.
- The graph may select an eligible task, request input, wait, or propose one low-priority task.
- Full autonomy is event-driven, not a busy LLM loop.
- Minimum cooldown, maximum consecutive autonomous work, per-hour work/token budgets, deduplication, and user-presence gates are enforced outside the graph.

### Cognitive mode

Autonomy mode and cognitive mode are separate axes. Every LLM or graph work item records its intended cognitive mode (`dual`, `agent`, `emulation`, or `environment`). The policy context may describe that value, but it must not blindly inherit a newly selected global UI mode after enqueue.

### Minimum work record

The local implementation must support at least:

```ts
interface WorkItem {
  id: string
  type: string
  handler: string
  state: 'queued' | 'leased' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'needs_review'
  priority: 'critical' | 'high' | 'normal' | 'low' | 'background'
  source: 'user' | 'system' | 'timer' | 'autonomy' | 'environment'
  username: string
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment'
  resource: string
  createdAt: string
  notBefore?: string
  deadline?: string
  parentTaskId?: string
  correlationId?: string
  idempotencyKey?: string
  attempt: number
  maxAttempts: number
  input?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean }
}
```

The initial implementation remains local and single-process. Atomic state transitions and restart recovery are required; a distributed lease service is not.

### Ainekio contract

- `environment_command` is coordinator work targeted at one connected environment session.
- Normal environment concurrency is one command per session.
- `stop` is `critical`, cancels queued non-stop motion for that session, and dispatches first.
- Non-replayable motion has a short deadline and expires rather than replaying after uncertainty or restart.
- Command dispatch completes when the adapter durably accepts the command.
- Completion, location, sound, image, and fault messages create correlated `environment_observation` work.
- Robot observations are `high` priority and outrank low/background autonomy.
- Environment state may retain bounded session, telemetry, delivery, and history projections, but not an independent executable queue.
- Firmware and hardware emergency stops remain body-owned and do not depend on MetaHuman OS.

## Implementation phases

### Phase 0: contract and characterization

Goal: freeze expected behavior before changing owners.

- [x] Create this implementation contract.
- [x] Verify each relevant finding in the supporting audit against the current worktree.
- [x] Add focused tests for lifecycle, priority, chat bypass, Lizard direct execution, timer admission, and environment split ownership.
- [x] Record every current executable queue/loop with a keep, migrate, or delete disposition.

Exit gate: the current broken or split behaviors are represented by focused tests and the owner inventory has no unknown disposition.

#### Verified current-state findings

Verified on 2026-07-14 against the dirty worktree, not inferred from the supporting audit:

| Finding | Evidence | Verdict |
| --- | --- | --- |
| Core queue is not started from a maintained boot path | `getQueueSystem().start()` is reachable through manual queue control, but no maintained server boot owner starts it | verified |
| Queue configuration is loaded but not applied to the singleton manager | `QueueSystem` obtains `getQueueManager()` before `loadConfig()` and does not configure it afterward; `etc/queue.json` also differs from the `QueueConfig` type | verified |
| Queue startup awaits its infinite execution loop | `QueueSystem.start()` now calls `this.executionEngine.start()` without awaiting it | stale audit claim; no longer current |
| User chat is executed outside the coordinator engine | `packages/core/src/api/handlers/unified-queue.ts` owns `userTaskExecutions`, polling, dequeue, persona/response execution, replay, and completion | verified |
| Core scheduler is lane-first rather than globally priority-first | `getNextExecutable()` checks local, remote, then vector lanes and excludes `user_message` | verified |
| Clear/delete can misrepresent cancellation | `clearQueued()` removes running records and resets capacity without stopping the underlying executor | verified |
| Active Operator owns a second executable queue and direct executor | `active-operator/unified-queue.ts`, duplicate queue persistence, `service-manager.ts`, and `task-execution.node.ts` remain maintained references | verified |
| Full-autonomy graph executes a synthetic task directly | `task-execution.node.ts` constructs a `graph-*` task and calls the legacy Active Operator executor | verified |
| Timer manager has global pause authority and loses exact handler identity | `TriggerManager.recordActivity()` can pause the queue; trigger mapping reduces agent identity to broad task types | verified |
| Environment adapter owns an independent executable action list | environment store, send-action node, bridge stream, and result handler operate on `queuedActions` outside the core coordinator | verified |
| Vector indexing and the older agent scheduler own additional processing queues | `vector-index-queue.ts` and `agent-scheduler.ts` retain private pending/running state and loops | verified |
| Current queue/Active Operator changes already existed in the worktree | targeted `git diff` shows in-progress chat handoff, shared singleton, running-task tracking, and removal of an older AO user-message fallback | verified and preserved as concurrent work |

#### Executable owner inventory

| Current owner | Current authority | Disposition |
| --- | --- | --- |
| `packages/core/src/queue` | lane queues, resource capacity, retries, remote callbacks, triggers, partial persistence | **keep and correct** as the sole coordinator |
| unified-queue API handler | chat dequeue/execution, process-local replay, queue mutation controls | **migrate** execution and replay into coordinator handlers/events; keep transport-thin API |
| Active Operator `UnifiedQueue` and state persister queue/current task | autonomous ordering, retry, persistence | **delete** after active state is explicitly reconciled |
| Active Operator service loop and task-execution node | LLM decision loop and direct task execution | **migrate** to bounded mode policy that may only select/propose coordinator work |
| `TriggerManager` | timers, inactivity admission, queue pause/resume | **reduce** to idempotent producer; mode controller owns proactive admission |
| environment interface `queuedActions` | robot action ordering, claiming, expiry, cancellation, result state | **migrate** executable authority to coordinator; retain bounded environment projections only |
| `vector-index-queue.ts` | persistent index pending list and retry loop | **migrate then delete** in favor of a vector executor |
| `agent-scheduler.ts` | in-memory LLM request priority queue and activity state | **migrate then delete**; activity moves to `system-activity` |
| `brain/services/sleep-service.ts` | private scheduled multi-step night workflow | **migrate** to explicit coordinator workflow work |
| maintained React Native scheduler | local executable scheduling | **adapt** to coordinator API; retain only documented offline transport buffering |
| `packages/server/src/queue/index.ts` | unused queue scaffold export | **delete or quarantine** after entrypoint proof |
| approval, SSE, TTS, WebSocket, graph traversal, and firmware buffers | bounded approval/transport/media/algorithm state | **retain and classify**; these do not order MetaHuman OS work |

Phase 0 focused contracts are `packages/core/src/queue/work-coordinator.spec.ts` and `packages/core/src/queue/work-owner-architecture.spec.ts`. They are expected to remain red only while the corresponding migration phase is active; Phase 8 requires both to pass.

### Phase 1: sole coordinator foundation

Goal: make the existing core queue truthful, deterministic, restart-aware, and always available.

- [x] Validate and apply one queue configuration before accepting work.
- [x] Provide explicit `starting`, `running`, `paused`, `degraded`, `stopping`, and `stopped` lifecycle states.
- [x] Start the coordinator once from the maintained server boot path.
- [x] Replace lane-first selection with global highest-priority runnable selection.
- [x] Add explicit handler identity, source, state, cognitive mode, time bounds, idempotency, correlation, and parent fields.
- [x] Register executor handlers through one core registry.
- [x] Persist queued, waiting, and in-progress state atomically and reconcile interrupted work on restart.
- [x] Implement truthful cancellation and expiry; never delete a running record while its executor continues invisibly.
- [x] Replace fixed-rate idle polling with an event wake plus bounded timer fallback.
- [x] Retain bounded terminal history for UI, debugging, and policy context.

Exit gate: server boot produces a running coordinator; priority, cancellation, expiry, idempotency, restart, and lifecycle tests pass; one ordinary non-chat task executes without opening the UI.

Evidence: the focused coordinator contract covers lifecycle, priority/age, unavailable handlers, cancellation/abort, expiry, idempotency, bounded history, retry, and restart/stale-work recovery. The site middleware claims the sole owner and starts it. A live service-token submission returned HTTP 202 and reached `completed` through the registered `generic` handler.

### Phase 2: chat and direct execution migration

Goal: remove API-handler execution ownership.

- [x] Register chat/persona and response-pipeline handlers in the coordinator.
- [x] Make the unified-queue API transport-only for enqueue, status, cancellation, and event observation.
- [x] Replace process-local `userTaskExecutions` ownership with coordinator lifecycle/events.
- [x] Preserve SSE streaming and reconnect by task ID without resubmission.
- [x] Enforce per-user/owner authorization and redact queue payload previews.

Exit gate: chat enqueues once, executes through a coordinator claim, survives observer reconnect, and has no handler-owned polling worker.

Evidence: `chat.persona` and `chat.response-pipeline` are registered handlers, the API filters task state by user/owner, non-owners cannot enqueue system work, and `work-owner-architecture.spec.ts` prohibits the deleted `userTaskExecutions` owner.

### Phase 3: scheduled producers and semi-autonomous mode

Goal: use existing configured timers without giving them execution authority.

- [x] Convert `TriggerManager` to producer-only behavior.
- [x] Preserve exact agent/workflow handler identity rather than collapsing it to a broad task type.
- [x] Add idempotency across queued and running work.
- [x] Stop pausing the global queue on user activity; suppress only proactive admission.
- [x] Implement `reactive` and `semi` autonomy-mode state and controls.
- [x] In reactive mode, stop new proactive admissions while keeping user, manual, approval, fault, and environment work operational.
- [x] In semi mode, admit configured interval, time-of-day, and inactivity work at low/background priority unless explicitly user-requested.

Exit gate: reactive mode produces no curiosity/dream/reflection/maintenance work; semi mode produces each configured due task once; user work always wins the next compatible slot.

Evidence: admission and preemption cases are covered in `work-coordinator.spec.ts`; `TriggerManager.recordActivity()` records activity without pausing the coordinator, and idempotency spans queued and active work.

### Phase 4: Active Operator and full-autonomy graph

Goal: remove Active Operator execution authority and retain bounded autonomous reasoning as policy.

- [x] Remove `packages/core/src/active-operator/unified-queue.ts` after state disposition.
- [x] Remove Active Operator queue/current-task persistence and direct task execution paths.
- [x] Make Active Operator the autonomy-mode controller, not a queue owner.
- [x] Replace Lizard Brain synthetic task execution with durable task-ID selection or one low-priority proposal.
- [x] Add the Operator Policy Graph with queue, history, mode, timer, activity, budget, and environment context inputs.
- [x] Add deterministic decision validation after the LLM node.
- [x] Implement `wait`, `wakeAt`, and `request_input` without blocking unrelated work.
- [x] Enforce cooldown, maximum consecutive autonomous tasks, deduplication, budget, and user-presence gates outside the graph.
- [x] Make emergency stop cancel active policy work and enqueue the semantic environment stop when an environment session is connected.

Exit gate: the Active Operator owns no queue and invokes no executor directly; full mode can select/propose one valid task or wait; invalid policy output cannot bypass coordinator rules.

Evidence: the duplicate queue, service loop, direct executor, synthetic execution node, and Lizard Brain graph were deleted. The replacement policy graph is a registered coordinator handler with an abort signal and a deterministic post-LLM gate. Emergency stop aborts policy work and enqueues a critical semantic stop for each connected environment session.

### Phase 5: Ainekio environment migration

Goal: make robot work visible and ordered by the sole coordinator without weakening body safety.

- [x] Add registered `environment_command` and `environment_observation` handlers.
- [x] Route Environment Mode output into correlated coordinator command work.
- [x] Make adapter streaming claim compatible command work for its authenticated session.
- [x] Complete command dispatch on durable adapter acceptance.
- [x] Ingest action results and observations as correlated lifecycle events and high-priority follow-up work.
- [x] Enforce session isolation, concurrency one, stop supersession, idempotent feedback, and stale-motion expiry.
- [x] Remove `queuedActions` from environment scheduling ownership; retain only bounded projections needed for status/history.
- [x] Preserve the current service-token authentication boundary.

Exit gate: two commands dispatch deterministically, stop supersedes pending motion, stale motion never replays, observations preempt autonomy, and multiple sessions cannot claim one another's work.

Evidence: `compatibility.spec.ts` covers two-command ordering, multi-session isolation, stop supersession, stale expiry, observation priority, lifecycle feedback, bridge authorization, image context, and emergency stop. Environment observations now execute their graph inside the registered coordinator handler; the deleted private promise chain and API-owned `runGraph()` bypass are prohibited by the architecture test.

### Phase 6: remaining maintained work-owner migration

Goal: remove maintained hidden schedulers that contradict the sole-coordinator contract.

- [x] Move vector index pending work and retry processing into a registered coordinator executor; migrate or explicitly expire existing pending records.
- [x] Remove the old `AgentScheduler` LLM queue after activity callers move to `system-activity`.
- [x] Convert sleep/night processing into explicit coordinator workflow tasks rather than a private invisible execution chain.
- [x] Adapt maintained React Native work scheduling to the coordinator API; keep only explicitly documented offline transport buffering.
- [x] Remove or quarantine the unused `packages/server` queue scaffold after a static-reference check.
- [x] Classify remaining structures named queue as executable work, approval state, transport buffer, media buffer, or algorithm-local traversal.

Exit gate: static and entrypoint discovery find no maintained executable scheduler outside `packages/core/src/queue`.

Evidence: the vector, agent, mobile, server, and sleep-service owners were deleted. Cross-process vector producers use the authenticated server handoff instead of importing a process-local singleton. The React Native offline runtime instantiates the same core coordinator package and no longer owns a separate scheduler implementation.

### Phase 7: UI, documentation, and cleanup

Goal: leave one truthful control surface and no misleading legacy surface.

- [x] Update the right-side Queue panel to show one globally ordered work list with resource/handler badges.
- [x] Show truthful lifecycle, waiting reason, retry, expiry, cancellation, degraded state, and terminal history.
- [x] Remove or relabel controls that only delete state without cancelling work.
- [x] Update Active Operator settings for reactive, semi, and full modes.
- [x] Mark older Active Operator queue documents as superseded or remove them when they have no remaining historical value.
- [x] Update architecture and user documentation to name the sole coordinator and distinguish it from the ReAct chat operator.
- [x] Delete unused exports, files, routes, schemas, tests, configuration fields, persistence files, and comments belonging to replaced owners.
- [x] Run static reference, route, export, and package-script audits after deletion.

Exit gate: the UI and documentation expose one work coordinator; reference audits find no orphan compatibility code or stale owner claims.

Evidence: the Queue panel was reduced to one coordinator view; obsolete Active Operator, Lizard Brain, night-processor, lane-metric, and queue controls/routes/exports/configuration were removed. The maintained-source inventory was regenerated after teaching its generator to exclude deleted worktree paths.

### Independent regression audit resolution

An independent agent reviewed the in-progress consolidation before this exit gate. Its five findings were resolved as follows:

| Finding | Resolution evidence | Status |
| --- | --- | --- |
| Environment work bypassed the coordinator through a private promise chain and direct `runGraph()` | Deleted the private environment coordinator; the API only enqueues and `environment.observation` runs the graph inside the registered handler with coordinator cancellation/capacity | resolved |
| Vector indexing submitted to process-local queue singletons | `memory.ts` uses `submitCoordinatorWork`; a thin service-token site route hands work to the one server-owned coordinator | resolved |
| Startup helper ignored a false `start()` result | `ensureQueueSystemStarted()` now throws when the process is not the owner or startup returns false | resolved |
| Competing agent, mobile, server, and desire execution owners remained | Deleted the three scheduler/scaffold files; desire review now submits coordinator work | resolved |
| Architecture tests did not detect the new environment bypass | The owner contract now prohibits the private coordinator, direct API `runGraph()`, process-local memory enqueue, deleted owners, legacy import aliases, and temporary compatibility exports | resolved |

### Reduction and ownership evidence

Measured over maintained production source and configuration in this consolidation scope, excluding documentation, tests, generated inventory, and runtime data:

| Metric | Result |
| --- | ---: |
| Tracked production additions | 3,932 lines |
| Untracked production additions | 1,302 lines |
| Total production additions | 5,234 lines |
| Production deletions | 19,080 lines |
| Net maintained production change | **-13,846 lines** |
| Executable work owners | **11 inventoried owners to 1 maintained owner package** |

The retained structures named queue are bounded and non-authoritative: Event Bus event buffering is transport state; Graph Runtime's async queue is algorithm-local streaming; the browser connection pool orders client connections; the TTS queue is a ten-item media playback buffer; approval collections hold human-review state; firmware RX buffers remain outside MetaHuman OS.

### Phase 8: final verification and closeout

Goal: prove the implementation contract and record evidence.

- [ ] Run all focused coordinator, chat, autonomy, timer, environment, recovery, cancellation, security, and UI tests.
- [ ] Run graph, node-default, security-route, and architecture validators.
- [ ] Run core typecheck and site build; resolve all scoped diagnostics.
- [ ] Run Python Ainekio gateway tests if the adapter contract changes.
- [ ] Run `git diff --check` over all scoped changes.
- [ ] Record exact validation results and any explicitly out-of-scope pre-existing debt below.
- [ ] Change this document status to `complete` only after every required item and finish criterion is satisfied.

## Definition of finished

This implementation is finished only when all of the following are true:

1. `packages/core/src/queue` is the only maintained executable work-ordering and persistence owner.
2. The coordinator starts with the server, reports truthful lifecycle, and continues serving reactive user and safety work in every autonomy mode.
3. Priority and age deterministically select the highest-priority runnable item; unavailable resources do not block other runnable work.
4. Chat, scheduled agents, Active Operator policy, Ainekio commands, Ainekio observations, vector work, sleep workflows, and maintained mobile scheduling either use coordinator work IDs or are explicitly proven to be non-executable transport/algorithm buffers.
5. Reactive, semi, and full mode behavior matches this document and has focused tests.
6. The Operator Policy Graph cannot execute work directly or bypass coordinator validation.
7. Robot stop, session isolation, stale-motion expiry, semantic commands, adapter authentication, and body-owned hard safety remain intact.
8. Cancellation, expiry, retry, idempotency, restart recovery, correlation, and bounded history are visible and tested.
9. The Queue UI is a truthful view of coordinator state and cannot claim cancellation when it only deletes a record.
10. Replaced queue classes, direct execution loops, persistence files, routes, exports, configuration fields, comments, and documentation are deleted or explicitly retained as non-work buffers with a current owner.
11. Static reference and entrypoint discovery find no orphan or competing maintained scheduler.
12. Focused tests, architecture checks, graph validation, security-route validation, site build, and scoped typechecking pass.
13. Validation evidence is recorded in this document, all checkboxes are complete, and status is changed to `complete`.

No item may be marked complete from documentation alone. Completion requires source evidence and the relevant validation gate.

## Cleanup register

Every migration must update this register before its phase closes.

| Current owner or path | Disposition | Replacement | Removal evidence | Status |
| --- | --- | --- | --- | --- |
| `packages/core/src/queue/*` | keep and correct | sole coordinator | focused contract passes; live boot/handoff task completed | complete |
| `packages/core/src/api/handlers/unified-queue.ts` execution loop | remove execution ownership | coordinator handlers/events | no `userTaskExecutions`, dequeue, or polling worker; architecture contract passes | complete |
| `packages/core/src/active-operator/unified-queue.ts` | delete after state disposition | core coordinator | file deleted; zero maintained execution references | complete |
| Active Operator queue/current-task persistence | remove | coordinator work state | queue/current-task persistence removed from operator state | complete |
| Lizard Brain direct task executor | remove | policy decision plus coordinator claim/proposal | executor, service loop, synthetic node, and graph deleted | complete |
| `packages/core/src/queue/trigger-manager.ts` execution/pause authority | reduce to producer | autonomy admission plus coordinator | no global pause call; admission/idempotency tests pass | complete |
| `packages/core/src/agent-scheduler.ts` LLM queue | delete/migrate | coordinator plus `system-activity` | file deleted; activity uses `system-activity` | complete |
| `packages/core/src/vector-index-queue.ts` processing loop | migrate/delete | vector handlers plus authenticated handoff | file deleted; handlers registered; process-local import prohibited | complete |
| `packages/core/src/environment-interface/store.ts` executable action queue | remove scheduling ownership | environment coordinator handlers | no `queuedActions`; environment contract passes | complete |
| `brain/services/sleep-service.ts` private execution chain | migrate | `workflow.sleep` parent/children | file deleted; workflow child completion test passes | complete |
| maintained React Native scheduler | adapt | same core coordinator in offline runtime | duplicate mobile scheduler deleted; offline boundary documented | complete |
| `packages/server/src/queue/index.ts` | delete | none | file deleted; architecture contract checks absence | complete |
| SSE, TTS, socket, firmware, and graph traversal buffers | retain as bounded non-work buffers | current transport/media/algorithm owners | inspected and classified above | complete |

## Validation record

Pre-closeout evidence on 2026-07-14:

- `node --import tsx packages/core/src/queue/work-owner-architecture.spec.ts` — passed.
- `node --import tsx packages/core/src/queue/work-coordinator.spec.ts` — passed.
- `node --import tsx packages/core/src/environment-interface/compatibility.spec.ts` — passed.
- `node --import tsx scripts/validate-security-routes.ts` — passed, 12/12 routes.
- `pnpm validate:graphs` — passed, 20/20 graphs.
- `pnpm --dir apps/site build` — passed.
- `git diff --check` — passed.
- Live current-build service handoff — HTTP 202; task `task-1784083458051-ee1ac9e7` reached `completed` through handler `generic` with `{ accepted: true }`.

Phase 8 remains open until the complete final command set is rerun and recorded here.
