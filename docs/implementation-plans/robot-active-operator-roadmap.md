# Robot Active Operator: Current Status and Full Feature Roadmap

Status: working architecture and implementation authority, started 2026-08-03

This document records the current robot-autonomy implementation, the intended
behavior of each Active Operator mode, and the boundary for future work. It is
the working contract for robot-environment autonomy until the owner replaces or
retires it.

The existing `docs/implementation-plans/robot-operator.md` remains useful as a
historical implementation record. When its earlier plan language conflicts with
this document's mode philosophy or scope boundary, this document governs new
robot-autonomy work.

## Owner Direction

MetaHuman OS is the robot's brain. The robot controller owns hardware execution
and reports observations and action completion through Environment Bridge.
MetaHuman owns perception, reasoning, task selection, and semantic action
admission.

The modes must represent different philosophies, not merely different timer or
rate settings:

- `reactive`: respond only to user- or environment-originated input.
- `semi`: limited embodied agency inside a user-owned objective, plus bounded
  boredom behavior. Unsolicited perception stops at observe, understand, and
  report.
- `full`: continuous, completion-driven embodied agency. When one task finishes,
  the LM queues a successor decision task and may observe, act, invoke curiosity,
  run an allow-listed background process, or deliberately wait/listen.

Full autonomy must not be driven by Robot Operator inactivity timers. It must be
driven by observations, user input, mode entry, bridge readiness, task results,
and completion events.

## Hard Scope Boundary

### Pre-authorized implementation surfaces

Robot-environment work may alter only these surfaces without additional owner
permission:

1. Node Editor surfaces used to author and inspect Environment Mode:
   - `apps/site/src/components/flow-editor/**`
2. Environment Mode graph and node implementations:
   - `etc/cognitive-graphs/environment-mode.json`
   - `packages/core/src/nodes/environment/**`
3. Robot-environment agents and their narrowly owned definitions, handlers,
   configuration, and focused tests:
   - `brain/services/robot-operator.ts`
   - `brain/agents/environment-bridge/**`
   - `packages/core/src/robot-operator.ts`
   - `packages/core/src/robot-operator.spec.ts`
   - `packages/core/src/queue/robot-observer-handler.ts`
   - `packages/core/src/queue/boredom-movement-handler.ts`
   - the `robot-operator`, `environment-bridge`, `robot-observer`, and
     `boredom-movement` entries in `etc/services.json` and `etc/agents.json`
   - `etc/boredom-movement.json`

An edit inside a shared file is authorized only when it is confined to one of
the named robot-agent entries. This is not blanket permission to refactor the
rest of that file or subsystem.

### Explicit permission required

Stop and ask the owner before modifying any other MetaHuman OS feature,
including:

- generic Active Operator policy or mode-controller code;
- Work Coordinator, Trigger Manager, or generic execution-engine behavior;
- generic Environment Interface storage, action queues, or API handlers;
- Chat Interface or the header mode control;
- conversation memory, persona, model routing, TTS, STT, or Curiosity internals;
- general Agent Monitor behavior;
- Ainekio controller, gateway, firmware, or hardware code outside this repo;
- any unrelated cleanup, migration, or architectural refactor.

The robot autonomy feature should call existing public owners where possible.
For example, Full mode may admit the existing Curiosity agent, but changing the
Curiosity service itself requires explicit permission.

If an implementation cannot be completed within the pre-authorized surfaces,
record the exact dependency and ask for permission. Do not work around the
boundary by creating a duplicate queue, memory store, bridge, scheduler, or
policy service.

## Current Architecture

```text
Robot controller / Ainekio gateway
  <-> Environment Bridge agent
  <-> environment observation and command work
  <-> Work Coordinator
  <-> Environment Mode graph
  <-> semantic action or response
```

Robot-specific autonomous admission currently follows a second path:

```text
Active Operator Semi or Full
  -> Robot Operator inactivity timers
  -> Robot Observer or Boredom Movement
  -> Work Coordinator
  -> Environment Mode / Environment Bridge
```

That second path is the primary target of this roadmap because Semi and Full
currently share the same robot philosophy.

## Current Status Snapshot

Snapshot date: 2026-08-03. Runtime facts are time-sensitive and must be
refreshed before implementation or physical validation.

| Capability | Status | Current truth |
| --- | --- | --- |
| Header mode control | Implemented | Cycles `reactive -> semi -> full -> reactive`. |
| Environment Bridge process | Implemented | Boot-managed, event-driven, and transports observations, semantic actions, and feedback. |
| Audio command path | Implemented, still being refined | Robot audio can enter Environment Mode; semantic commands and correlated completion return through the bridge. |
| Environment image input | Implemented | Bounded JPEG observations can enter the Environment Mode vision path. |
| Robot Observer | Partially implemented | Can queue a correlated `captureImage` request and route a returned image into Environment Mode. |
| Boredom Movement | Implemented as a limited behavior | Uses a timer and randomly chooses one allowed stationary command; it does not reason from a new image first. |
| Completion feedback | Implemented | Action results update coordinator work and can return to Environment Mode. |
| User-task completion validator | Implemented, partially physically validated | `Environment Task Validator` consumes a structured LM decision, owns current action admission, blocks repeats and out-of-mode continuations, and emits at most one bounded workflow command. Conditional actions have repeated physically, but stop-condition and long-loop behavior still need refinement. |
| Environment workflow command node | Implemented, partially physically validated | A reusable node admits a validated `nextInstruction` to the existing Work Coordinator as a separate Environment Mode run and exposes its task ID/status. Physical tests have demonstrated bounded successor admission. |
| Semi philosophy | Partially implemented and physically exercised | User-owned terminal results can queue one bounded next instruction; conditional tasks now continue beyond one action in some tests. Boredom/report-only behavior and reliable end-to-end termination still need validation. |
| Full philosophy | Missing | Full starts a generic bounded policy service, but robot work still uses the same inactivity timers and workflows as Semi. |
| Completion-driven successor work | Partially implemented | Completed bounded user tasks, and bounded Full autonomy tasks, can queue one validated Environment successor; the perpetual Full successor policy is not implemented. |
| Full curiosity/background selection | Missing | The robot LM does not choose Curiosity or background work as part of one embodied successor policy. |
| Physical observe-decide-act capability | Partial | The latest physical `ainekio-01` snapshot advertises `captureImage`, `robotCommand`, `robotMotionPlan`, and `sendText`; command reliability and autonomous policy remain incomplete. |
| Observe/report safety behavior | In progress | Current working-tree Environment nodes route candidate actions through the validator, treat terminal completion feedback as reportable evidence, and suppress unsupported continuations. |
| Robot speech command lifecycle | Degraded; queue blocker confirmed | A robot-routed `tts-out` command can remain leased without correlated terminal feedback. Later commands on the same `environment:ainekio-01` resource remain queued behind it. This failure is separate from validator continuation logic. |

At the latest diagnostic snapshot, Active Operator was `semi`. The Agent Monitor
processes for Robot Operator and Environment Bridge were running, the physical
body was authenticated, and bridge observations continued moving while the
robot speech command lane was stuck.

The worktree already contains uncommitted Environment Mode and Environment
Bridge changes. They belong to existing work and must be preserved. Future
implementation must review them as current local truth before editing the same
files.

## Mode Contracts

### Reactive

Reactive is externally initiated and has no proactive robot task admission.

Allowed behavior:

- receive audio, text, sensor observations, and explicit user commands;
- answer through Environment Mode;
- execute an explicitly authorized semantic action;
- receive and report completion feedback;
- run a manually requested Robot Observer or Boredom Movement workflow.

Disallowed behavior:

- self-initiated observation;
- boredom work;
- autonomous continuation after the user's request is satisfied;
- autonomous Curiosity or background selection;
- autonomous movement.

### Semi-autonomous

Semi is limited embodied agency. The user remains the source of objectives.

Semi supports two bounded sources of work:

1. User-owned tasks
   - When the user gives a potentially multi-step objective, Environment Mode
     records the objective for the current coordinator task.
   - After each response, observation, or action result, a validator decides
     whether that objective is complete.
   - If incomplete, the validator may admit one next step that is necessary to
     complete the same objective.
   - If blocked, unsafe, ambiguous, or over budget, it asks the user rather than
     inventing a new objective.
2. Boredom behavior
   - A bounded idle timer may admit an observation or one safe stationary
     behavior.
   - An unsolicited observation follows `observe -> understand -> report`.
   - It may not turn that observation into self-directed movement.

Example: `Find the red ball.`

```text
user objective
  -> observe
  -> understand current image
  -> choose one necessary action
  -> receive completion / new image
  -> validate objective
     -> complete: report result and stop
     -> incomplete: queue one next objective-bound step
     -> blocked: ask the user
```

Semi does not chain unrelated work after the user objective completes.

### Fully autonomous

Full is a completion-driven embodied task loop. It does not use Robot Operator
inactivity timers as its source of robot work.

Entry events may include:

- transition into Full mode;
- Environment Bridge becoming ready;
- a new audio, image, sensor, or text observation;
- user input;
- completion, failure, cancellation, or expiry of robot work;
- completion of an allow-listed Curiosity or background task.

The central invariant is:

> Every terminal Full-mode task outcome queues exactly one successor decision
> task, unless safety shutdown, mode change, missing authorization, or a hard
> resource limit prevents admission.

The successor is a deliberation task, not necessarily a movement. It may choose:

- `observe`: request a fresh image or other current sensor input;
- `act`: enqueue one capability-advertised semantic robot action;
- `curiosity`: admit the existing Curiosity service for a bounded question;
- `background`: admit one allow-listed background process;
- `report`: communicate a useful observation or result;
- `request_user`: ask for authority or missing information;
- `wait/listen`: remain receptive without inventing physical work.

Waiting must not be implemented as an untracked Robot Operator `setTimeout`
loop. The continuation should be durable coordinator work or be awakened by an
external event. Full mode must also avoid a zero-delay busy loop; waiting,
backoff, and resource availability are explicit policy outcomes.

Full may independently observe the surroundings and decide what to do, but only
inside capability, safety, action-count, and resource budgets.

## Environment Task Validator

The first feature is now implemented as a dedicated Environment Mode validator
node. It is the mode-aware authority for deciding whether a task is complete and
whether a proposed successor instruction is permitted.

Implemented node identity:

- display name: `Environment Task Validator`
- implementation family: `packages/core/src/nodes/environment/**`
- graph owner: `etc/cognitive-graphs/environment-mode.json`

Instruction ownership is intentionally split:

- The existing Environment LLM proposes a structured `taskDecision` and, when
  needed, one `nextInstruction` for the same objective.
- `Environment Task Validator` deterministically checks mode, source, terminal
  feedback, original objective, repeated-action risk, and the bounded cycle. It
  does not invent an instruction when the LM omitted one.
- `Environment Workflow Command` rechecks mode and bounds, wraps the original
  objective with the next instruction, and admits one `environment_observation`
  item to the existing Work Coordinator.
- The next instruction therefore runs as a separate, visible Environment Mode
  execution. It does not execute as a hidden second action in the completion
  pass.

Required inputs:

- Active Operator mode;
- task source: user, semi boredom, or full autonomy;
- original objective and current bounded step;
- latest image and environment state;
- semantic action that was requested;
- correlated terminal feedback;
- connected-session capabilities and available semantic commands;
- current cycle budget and previous validator decisions;
- coordinator result summary for the current task.

Required structured outcomes:

- `complete`: the current objective is satisfied;
- `continue`: the same objective needs another bounded step;
- `observe`: fresh perception is required before deciding;
- `act`: one semantic action is justified;
- `report`: communicate without another physical action;
- `curiosity`: Full mode may admit an allow-listed Curiosity task;
- `background`: Full mode may admit an allow-listed background task;
- `request_user`: authority or information is missing;
- `wait`: no useful task is currently justified.

Mode enforcement:

- Reactive accepts no autonomous successor.
- Semi may continue only the active user objective. Semi boredom observations
  may end only in `report` or `wait`.
- Full must emit one successor outcome after every terminal task result and may
  select a new bounded objective when the prior objective is complete.

The validator must not write a second task store or conversation-memory system.
It should consume the existing graph context, coordinator work, Environment
Mode conversation/history services, and correlated observation metadata.

The command node calls the existing coordinator owner; it is not a second queue.
Its output exposes `queued`, `taskId`, `status`, and the admitted instruction so
the handoff is inspectable in the Node Editor and focused tests.

## Full-mode Task Selection

Full task selection should use one allow-listed decision contract rather than
several competing timer agents.

Initial candidate work classes:

- obtain a current camera observation;
- investigate a visually notable change;
- perform one safe, capability-advertised stationary action;
- continue an incomplete user objective;
- run a bounded Curiosity question;
- run an allow-listed memory or organization task when robot work is not useful;
- report a meaningful result;
- wait and listen.

The Full-mode LM may rank these choices, but deterministic gates remain
authoritative:

- one active robot cycle per physical session;
- one admitted successor per terminal result;
- current bridge subscriber required;
- current physical-body authentication required for body actions;
- action must be advertised by the same session that supplied perception;
- semantic command must be in the controller-advertised catalog;
- stop and emergency-stop always take precedence;
- cycle, rate, consecutive-action, and failure budgets are enforced outside LM
  prose;
- no raw servo or joint commands from the LM;
- no action based only on stale conversation or stale images.

## Implementation Phases

### Phase 1: Make completion explicit in Environment Mode

- Implemented: added the Environment Task Validator node and executable Node
  Editor definition.
- Implemented: added the reusable Environment Workflow Command node for explicit
  coordinator admission.
- Implemented: placed completion validation after action parsing and before the
  separate successor-command branch. Parser candidates no longer bypass the
  validator: validated current actions and movement requests flow from the
  validator to Environment Bridge Out and Movement Generator.
- Implemented: terminal feedback stays reportable, and an incomplete explicit
  user objective may produce one different, bounded `nextInstruction`.
- Implemented in focused node tests: complete/continue gating, Reactive denial,
  Semi report-only action gating, repeat denial, Full bounded admission, step
  limits, and queue payload ownership.

Exit condition: a user-owned conditional objective can complete multiple bounded
steps in Semi without losing its termination criterion or inventing an unrelated
objective.

Code-level exit checks pass. Live coordinator and physical-robot validation are
still required before this phase is considered operationally complete.

### Phase 2: Finish Semi semantics

- Implemented at code level: route user-owned objectives through the validator.
- Keep boredom timer admission bounded and separate from user objectives.
- Enforce report-only behavior for unsolicited Semi observations.
- Implemented at code level: stop cleanly when objective completion is supported
  by an available evidence source or when the bounded step budget is exhausted.

Exit condition: Semi behaves differently from both Reactive and Full under
tests and visible graph execution.

### Phase 3: Replace Full robot timers with successor admission

- Disable Robot Operator inactivity timers while mode is Full.
- Admit an initial Full deliberation from a permitted entry event.
- After every terminal task result, admit exactly one successor decision.
- Represent wait/listen without a Robot Operator timer or busy loop.

Exit condition: Full continues through task results while Semi still uses its
limited timer and user-objective behavior.

### Phase 4: Integrate curiosity and background work

- Give the Full validator an explicit allowlist of existing agent handlers.
- Admit Curiosity and background work through public coordinator interfaces.
- Return their outcomes to the same successor-decision contract.
- Do not alter Curiosity or background-agent internals without permission.

Exit condition: Full can choose useful non-physical work without creating a
parallel scheduler or bypassing the Work Coordinator.

### Phase 5: Finish embodied observe-decide-act

- Require one connected physical session to advertise both perception and the
  semantic actions it can actually execute.
- Select the target session by required capability and identity.
- Validate image freshness and correlation before physical decisions.
- Permit a Full observation to produce one bounded semantic action and a
  verification result.

This phase may expose a required change in the generic Environment Interface or
the external Ainekio controller. Such a dependency must be documented and
explicitly authorized before editing those surfaces.

## 2026-08-03 Validator Implementation Log

- Extended the existing Environment LLM JSON contract with a structured
  `taskDecision`; no second LLM call was added.
- Added `Environment Task Validator` and `Environment Workflow Command` as
  reusable Environment nodes automatically exposed by the executable node
  registry used by the editor.
- Rewired only the Environment Mode graph. Current parser candidates now pass
  through the validator before Environment Bridge Out or Movement Generator;
  completion decisions use the separate validator-to-command branch.
- The command node strips terminal feedback before the queued run, preserves the
  original objective in a bounded instruction envelope, reuses correlated cycle
  metadata, applies an idempotency key, and returns the coordinator task ID.
- Completion now uses a generic task-state contract rather than matching words in
  the objective: the decision declares whether the objective is complete, its
  evidence basis and evidence, and whether a continuation advances or repeats.
- A completed action or response completes one workflow step, not automatically
  the whole objective. Incomplete user-owned work can queue exactly one later
  step in Semi; a user-authorized repeat remains bounded by the same cycle limit.
- The validator checks that the declared evidence source is currently available.
  Visual completion requires a fresh image correlated to the active cycle.
- Response-only successors advance the persisted cycle step when queued. An
  action-result successor retains its current step and advances only when its
  next physical action is admitted, preventing the same continuation from
  spending the cycle budget twice.
- User-owned robot cycles allow up to eight bounded steps. This supports a real
  conditional loop while preserving the existing hard ceiling and the separate
  coordinator rate limit.
- An incomplete decision can no longer stall because the model omitted optional
  continuation refinements. The validator re-admits the original objective for
  one fresh bounded evaluation, while explicit narrower instructions still take
  precedence.
- A narrower continuation instruction is admitted only when its structured type
  is present in the same decision. Partial suggestions cannot replace the
  original user-owned objective, and queued passes suppress conversational
  history so speaker and actor roles cannot drift.
- Once an objective is known to depend on external robot evidence, a generated
  response alone cannot prove completion. The evidence must come from an allowed
  current external basis such as correlated vision, environment state, an action
  result, or current user input.
- No object name, gesture, command sentence, or conditional-task phrase is
  embedded in validator control logic.
- No generic Work Coordinator, execution engine, Active Operator controller,
  Environment Interface, bridge transport, Chat Interface, or controller code
  was modified for this feature.
- Focused validator/command tests pass (18 tests), the Robot Operator contract
  tests pass (8 tests), and all 25 cognitive graphs pass schema validation.
- A broader compatibility run passes 19 of 20 tests. Its only failure is an
  exact-string assertion in the generic Environment Interface suite that still
  requires the superseded `context only` completion wording. That out-of-scope
  test was not edited without permission; the focused Environment-node test now
  owns the objective-authority behavior.
- The full core typecheck remains red on pre-existing diagnostics. After the one
  validator-local diagnostic was corrected, no reported diagnostic referenced
  the new validator or workflow-command files.

## 2026-08-03 Robot Speech Queue Diagnosis

This diagnosis is based on the live physical `ainekio-01` session and is
separate from the Environment Task Validator implementation.

- The oldest active work item, `task-1785792277214-765b6155`, is an
  `environment_command` with action type `speak`, owner `tts-out`, and an
  expected speech duration of 8.975 seconds. It entered `leased` state at
  `2026-08-03T21:24:37.215Z` under `environment-adapter:ainekio-01` and still had
  no result, error, or completion timestamp more than ten minutes later.
- Four later robot speech items were queued behind it during the investigation.
  They share the serialized resource `environment:ainekio-01`, so the first
  unresolved lease prevents those items from being claimed.
- MetaHuman successfully synthesized and enqueued the speech, and the Environment
  Bridge claimed its staged PCM artifact. The physical Ainekio operations log
  subsequently recorded TTS start/end traffic along with repeated
  `tts_overflow` and `tts_orphan` body events.
- The checked-in Ainekio gateway contract intends to wait for the TTS start
  sequence to reach a terminal body result and then return correlated
  `environment.feedback` (`completed`, `cancelled`, `failed`, or `rejected`). No
  correlated speech feedback reached MetaHuman for the leased item, even though
  bridge observations and unrelated coordinator work continued.
- The generic queue releases this lease only when action-result feedback is
  recorded. It has restart recovery, but no live timeout that terminates an
  indefinitely leased environment command. The missing speech terminal result
  therefore becomes a persistent queue lock.

The primary repair is to make the speech lifecycle produce exactly one bounded,
correlated terminal result even when playback overflows, the robot reconnects,
or the controller never confirms completion. The preferred result is real
controller/gateway feedback. A bounded Environment Bridge failure fallback may
be added as defense in depth, but it must report failure rather than claim that
playback completed. A generic queue lease watchdog or a TTS/resource-lane change
would touch explicitly permissioned MetaHuman surfaces and is not the first-line
repair.

No queue item was cancelled and no generic queue, TTS, Ainekio gateway, or
firmware code was changed during this diagnosis. A controller/gateway repair or
generic queue/TTS mitigation requires explicit owner permission under this
roadmap's scope boundary.

## Validation and Safety Gates

Every implementation batch must include:

- `git diff --name-only` review proving edits stayed inside the authorized
  surface;
- Environment Mode graph validation;
- focused Environment node and Robot Operator tests;
- proof that Reactive admits no autonomous successor;
- proof that Semi cannot convert an unsolicited observation into movement;
- proof that Semi can continue an incomplete user objective and then stop;
- proof that Full admits exactly one successor per terminal result;
- proof that Full does not use Robot Operator inactivity timers;
- proof that stale images, missing capabilities, bridge disconnects, and action
  failures produce `wait`, `request_user`, or safe stop rather than movement;
- queue and feedback evidence for every physical test.

Physical movement, firmware changes, and controller changes require a separate
explicit validation decision. Passing simulator or contract tests is not proof
that the physical robot completed an action.

## Open Decisions

These decisions must be resolved before Full physical autonomy is enabled:

1. Which semantic commands are safe for Full self-initiation?
2. May Full locomote, or is it initially limited to observation, speech, and
   stationary actions?
3. What rate and consecutive-action budgets should apply?
4. Which Curiosity and background handlers belong on the Full allowlist?
5. What constitutes a visually meaningful change worth investigating?
6. How should Full enter and recover from `wait/listen` without timer-driven
   robot work?
7. What user-presence or proximity conditions suppress self-directed movement?
8. What physical test sequence is required before Full may command the body?

Until those decisions are recorded, Full implementation should remain bounded
to graph, agent, and simulated coordinator validation.
