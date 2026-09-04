# Robot Active Operator Roadmap

Status: active product roadmap; source reconciled 2026-09-01

This roadmap describes intended Robot Active Operator outcomes and the evidence
required to accept them. It is not architecture authority and does not authorize
implementation. Current work must follow
[`MAINTAINED_SURFACE.md`](../technical/MAINTAINED_SURFACE.md), the live
manifests and entrypoints, and an explicit Installation Owner instruction.

## Product intent

MetaHuman should be able to act as an intelligent robot companion while keeping
user authority, body safety, and evidence-based completion explicit.

- **Reactive**: respond to user and environment events; do not admit timed or
  inactivity-based autonomy.
- **Semi-autonomous**: admit configured scheduled and idle work through the
  existing coordinator.
- **Fully autonomous**: let Robot Operator admit one bounded robot workflow chain
  at a time, with later work beginning only after completion and cooldown.
- **Embodied execution**: express high-level semantic intentions. The Ainekio
  body runtime remains responsible for actuator timing, balance, collision
  avoidance, emergency stop, and other fast safety control.

A completed queue item or accepted transport request is not proof that a
physical action achieved its semantic goal. Acceptance must distinguish
admission, terminal software completion, external acknowledgement, fresh
observation, and physical result.

## Current owner path

```text
Active Operator mode
  -> Robot Operator service timing and admission
  -> Robot Status or one boredom planner graph
  -> one-pass Robot Autonomy Executor
  -> Environment selector and specialized evidence inputs
  -> Environment Bridge transport
  -> Ainekio body runtime and safety
  -> correlated result and fresh observation
  -> one-pass Robot Action Result evaluation
  -> Robot Status Out task and action update
  -> later Robot Goal Review when the mode permits and the objective remains incomplete
```

The maintained owners are:

| Responsibility | Canonical owner |
| --- | --- |
| Reactive, Semi, and Full mode transitions | `packages/core/src/active-operator/mode-controller.ts` |
| Full-mode completion/cooldown admission | `brain/services/robot-operator.ts` |
| Finite-work ordering and execution admission | `packages/core/src/queue/queue-system.ts` |
| Robot Status, Goal Review, and boredom timing/admission | `brain/services/robot-operator.ts` |
| Reusable profile-resolved situational snapshot | `packages/core/src/robot-status.ts` and `etc/cognitive-graphs/robot-status-mode.json` |
| Contextual autonomous intentions | `boredom-observer-mode.json`, `boredom-movement-mode.json`, and `boredom-reflection-mode.json` |
| One-pass autonomous action selection and execution | `etc/cognitive-graphs/boredom-autonomy-mode.json` |
| Reactive user-instruction execution | `etc/cognitive-graphs/environment-mode.json` |
| Correlated result interpretation | `etc/cognitive-graphs/robot-action-result-mode.json` |
| Later unfinished-goal review | `etc/cognitive-graphs/robot-goal-review-mode.json` |
| Objective continuity and persisted status | `packages/core/src/robot-status.ts` and `packages/core/src/nodes/robot-status/out.node.ts` |
| Terminal feedback correlation and visual frame selection | `feedback.node.ts` and `image-input.node.ts` |
| External-environment connection and transport | `brain/agents/environment-bridge` |
| Device translation and physical safety | The configured external adapter and Ainekio body runtime |

Robot Status is supporting context, not a completion authority. Fresh correlated
observations and action results remain authoritative. No planner, graph, API
route, or body adapter may create a private queue, scheduler, objective store,
bridge, or retry loop around these owners.

## Reconciled source status

| Area | Current source state | Evidence still required |
| --- | --- | --- |
| Active Operator modes | Implemented in the mode controller and coordinator contracts | Current-build runtime transition and suppression evidence |
| Robot Operator admission | Registered as a persistent service with five finite child workflows | Current-build Agent Monitor and queue admission evidence |
| Robot Status | Implemented as one bounded graph and profile-resolved snapshot owner | Current profile read/write and downstream-consumption evidence |
| Boredom planning | Three separate planner graphs feed one-pass Robot Autonomy Executor runs | Repeated runtime cycles proving no competing execution path |
| Environment execution | Environment Mode and Robot Autonomy Executor choose one action; Robot Action Result evaluates returned evidence once | Success, explicit failure, cancellation, and repeated-invocation evidence |
| Goal continuation | Robot Goal Review reads Robot Status and may delegate one later instruction | Semi timer and Full sequential-review evidence |
| Environment transport | One Environment Bridge service owns the external connection | Authenticated adapter connection and correlated round-trip evidence |
| Physical behavior | Body runtime owns device-specific execution and safety | Fresh, correlated physical observation for each claimed behavior |

This documentation cleanup did not start the application, connect an adapter,
or command a robot. Dated runtime and physical evidence belongs in
[`robot-operator-motion-control-progress.md`](../audits/robot-operator-motion-control-progress.md);
it must not be presented as proof of the current build without a fresh retest.

## Remaining roadmap

### 1. Keep the source contract coherent

- Keep the five Robot Operator child workflows registered through the existing
  Agent Catalog and Work Coordinator.
- Keep planner graphs contextual; Robot Autonomy Executor performs one action and
  never owns its own continuation.
- Keep feedback correlation and image selection in their specialized Environment
  nodes. Robot Action Result interprets one return, Robot Status Out persists it,
  and a later Robot Goal Review owns any continuation decision.
- Reject unsupported capabilities, malformed results, missing correlations, and
  exhausted action budgets explicitly.
- Remove superseded nodes, graph wiring, configuration, tests, and documentation
  in the same change whenever an owner path changes.

Acceptance evidence:

- graph and node-default validation;
- focused coordinator, mode, Robot Operator, Robot Status, and bridge tests;
- architecture and remote-safety checks;
- final searches for retired graphs, direct execution, and duplicate owners.

### 2. Prove current-build software behavior

Exercise Reactive, Semi, and Full modes against the current build and record:

- which event or clock admitted each work item;
- the coordinator work ID, handler, resource lease, and terminal state;
- the selected planner and executor graph trace;
- objective correlation and bounded revision state;
- cancellation, timeout, retry, and repeated-invocation behavior;
- explicit failure when the adapter or required capability is unavailable.

Acceptance requires observable terminal outcomes. Queue admission alone is not
completion, and a graph trace alone is not an external effect.

### 3. Prove stationary embodied behavior

Before locomotion work, validate low-risk stationary actions with the configured
adapter and physical robot:

- authenticated bridge connection;
- one semantic action per correlated objective;
- body-side admission and terminal acknowledgement;
- a fresh post-action frame or sensor observation;
- emergency stop and cancellation;
- disconnect/reconnect without duplicated action;
- bounded failure when evidence is missing.

Physical acceptance must pair the requested objective with a fresh observation;
a transport acknowledgement is insufficient.

### 4. Extend embodied skills only through existing owners

New semantic skills may be considered only after an explicit scoped request.
They must enter through the existing capability contract, Robot Status task
record, Environment Bridge, and body-runtime safety layer. Fast feedback control
must remain body-side; MetaHuman must not perform per-frame LLM steering or send
raw actuator commands.

Locomotion, mapping, search, following, and multi-step manipulation each require
their own capability schema, limits, stop behavior, simulator evidence, and
physical acceptance plan. Cross-repository Ainekio changes require separate
explicit authority.

### 5. Define long-running autonomy policy

Before broad unattended operation, the Installation Owner must decide:

- allowed semantic actions by autonomy mode;
- quiet hours, user-presence rules, and hourly/action budgets;
- when the robot may ask the user versus wait;
- privacy and retention rules for camera, audio, observations, and memories;
- how curiosity, desires, and conversation may propose work without bypassing
  the coordinator;
- required supervision, rollback, and emergency-stop behavior.

These decisions configure the existing owners; they do not justify a second
policy service, queue, scheduler, memory store, or execution graph.

## Evidence gates

Every implementation handoff must report these layers separately:

1. **Source validation**: tests, graph validation, type/build checks, architecture
   checks, and stale-reference searches.
2. **Runtime admission**: current process status, mode, trigger, work ID, and
   coordinator lifecycle.
3. **Terminal software result**: executor completion, failure, cancellation, or
   timeout with correlated evidence.
4. **External confirmation**: adapter/body acknowledgement and transport result.
5. **Physical proof**: a fresh correlated observation demonstrating the requested
   real-world outcome.

No earlier layer may be used as proof of a later one.

## Historical records

Completed and superseded implementation records are retained locally under
`docs/archive/plans-and-migrations/`. They explain prior decisions but do not
override current source, tracked technical authorities, or explicit Installation
Owner direction.
