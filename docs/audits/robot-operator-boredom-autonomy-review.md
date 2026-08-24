# Robot Operator Boredom Autonomy Review

Date: 2026-08-23

Scope: maintained Robot Operator scheduling, autonomous robot stimulus workflows,
Environment Mode delegation, memory-inspired robot reflection, and operator UI
visibility. Conversational Trigger Manager scheduling and the Sleep Workflow are
adjacent systems, not owners of robot boredom behavior.

## Executive finding

The current implementation collapses three responsibilities into one path:

1. `brain/services/robot-operator.ts` owns private Robot Observer and Boredom
   Movement timers.
2. Both timer children enter the same `robot-operator-mode.json` deliberation
   graph.
3. That graph can delegate a high-level intention to Environment Mode for as
   many as eight correlated action/observation steps.

This makes Robot Operator appear to be a god controller, hides the individual
autonomy triggers from the operator UI, lets recent inner dialogue obscure the
true trigger identity, and gives observation opportunities the same action
shape as movement opportunities.

The correct boundary is to keep Robot Operator as the robot-domain controller
analogous to, but separate from, conversational Trigger Manager. Robot Operator
owns clocks, cooldowns, child selection, mutual exclusion, and finite Work
Coordinator admission. It does not interpret camera images, choose robot
commands, speak, or own Environment objective continuation.

## Target ownership

```text
Active Operator mode + Sleep state
  -> Robot Operator controller
       -> Boredom Observer workflow
       -> Boredom Movement workflow
       -> Boredom Reflection workflow
            -> Boredom Autonomy executive graph
                 -> canonical Environment Task State
                 -> private reflection, deliberate conversation, or
                 -> one bounded advertised robot consequence
                      -> Environment Bridge
```

- Semi mode: Robot Operator admits each enabled child on its configured idle
  cadence with jitter.
- Full mode: Robot Operator selects enabled children continuously between the
  configured Active Operator cooldowns, subject to sleep, ownership, queue, and
  active-cycle guards.
- Reactive mode and Sleep: automatic robot boredom admission is dormant.
- Manual runs remain finite Work Coordinator tasks and do not create a second
  scheduler.

## brain/services/robot-operator.ts

- Owner: robot-domain autonomy scheduling and child admission.
- Summary: currently owns two private timers and also supplies the shared
  deliberation prompt used by both children.
- Boundary issues: the controller knows child prompt details; child schedules
  and next-run state are visible only in logs; Full mode still uses child idle
  periods rather than one completion/cooldown-driven selection loop.
- Technical debt: no Boredom Reflection child; no durable inspectable runtime
  status; child naming mixes generic Robot Observer with the boredom domain.
- Security/privacy notes: user resolution must remain owner-scoped; runtime
  status must not contain memory text or image payloads.
- Test gap: no focused test for three-child scheduling, Full rotation, sleep
  dormancy, or runtime status shape.
- Recommended action: retain this service as controller, move deliberation into
  specialized graphs, add Boredom Reflection, and publish sanitized runtime
  state for the existing Active Operator dashboard.

## packages/core/src/queue/robot-autonomy-trigger-handler.ts

- Owner: finite robot autonomy trigger admission into the environment pipeline.
- Summary: both existing workflows request a camera image and attach a shared
  Robot Observer cycle envelope.
- Boundary issues: Movement does not begin as a movement opportunity; it first
  behaves exactly like Observer. Reflection has no entry path. The file name
  and helper names imply one agent even though it handles multiple producers.
- Resolution: trigger-specific graph, step budget, and initial stimulus are
  selected from one shared finite trigger boundary without introducing another
  scheduler or executor.
- Security/privacy notes: preserve connected-session, camera, subscriber,
  owner, Active Operator mode, and one-active-cycle checks.
- Test gap: no contract proving Observer starts with a camera request while
  Movement and Reflection start with non-action autonomous stimuli.
- Recommended action: make this the shared finite autonomy-trigger handler.
  Observer alone requests an initial image. Movement and Reflection enqueue a
  structured stimulus into their specialized graphs. None directly selects a
  command.

## etc/cognitive-graphs/robot-operator-mode.json

- Owner: current generic high-level robot deliberation.
- Summary: combines current stimulus, persona, recent conversation and inner
  context, publishes an Idle Thought, and optionally delegates to Environment.
- Boundary issues: unrelated trigger types share one prompt and one graph;
  recent inner dialogue has caused a Robot Observer cycle to describe itself as
  Boredom Movement; the trigger-specific Idle Thought is model-authored rather
  than UI provenance.
- Technical debt: an eight-step default is too broad for routine boredom
  episodes; the graph also routes its private thought to TTS even though speech
  should be an Environment decision.
- Security/privacy notes: current image is evidence; conversation and memory are
  context only and must not be represented as current surroundings.
- Test gap: no graph-level separation of observer, movement, and memory-inspired
  reflection contracts.
- Recommended action: retain the shared parser, context, and Environment
  dispatch node implementations, but create three separately editable graph
  definitions with fixed provenance and smaller step budgets. Private thoughts
  go only to Inner Dialogue. Desired speech is delegated to Environment.

## brain/agents/reflector and reflector-mode.json

- Owner: conversational/private memory reflection.
- Summary: samples associative user memories and writes an internal reflection.
- Boundary issues: it is not a robot autonomy trigger and must not become the
  scheduler or executor for embodied behavior.
- Technical debt: its memory sampling primitives are useful but coupled to the
  existing reflector workflow.
- Security/privacy notes: memory remains user-scoped; memory content must never
  enter system runtime status.
- Test gap: no robot-specific memory inspiration graph that distinguishes
  remembered information from present-world evidence.
- Recommended action: leave the conversational Reflector intact. Boredom
  Reflection is a separate Robot Operator child that reuses a user-scoped
  memory sampler node, treats memories as historical inspiration, and delegates
  any desired speech or action to Environment Mode.

## apps/site/src/components/ActiveOperatorDashboard.svelte

- Owner: inspectable Active Operator and robot-autonomy runtime status.
- Summary: currently shows mode, policy counters, and active coordinator work.
- Boundary issues: it does not show Robot Operator lifecycle, child schedules,
  last admissions, selected graphs, or current robot-autonomy episode.
- Technical debt: the chat's Reflection card labels all unknown producers as
  `Idle Thought`, hiding structured autonomy provenance.
- Security/privacy notes: expose identifiers, times, outcomes, and bounded task
  summaries only; do not expose prompts, memory text, images, or chain of
  thought.
- Test gap: no UI contract for boredom child visibility or source labels.
- Recommended action: add a Robot Operator section to Dashboard -> Active
  Operator and fixed Reflection-card labels for the three child graph sources.

## Acceptance criteria

1. Robot Operator is the only automatic scheduler for robot boredom children;
   Trigger Manager has no boredom schedule.
2. Boredom Observer, Movement, and Reflection are separate enabled workflow
   agents in Agent Catalog and `etc/agents.json`.
3. Each child has its own cognitive graph and inspectable `dialogueSource`.
4. Observer's initial operation is one correlated camera capture.
5. Movement and Reflection do not directly enqueue robot commands. They enqueue
   an autonomous stimulus; any speech or action is selected by Environment.
6. Movement objectives require a bounded post-action assessment and cannot
   become open-ended room surveys.
7. Reflection consumes user-scoped memory as historical context and may choose
   private reflection, speech, or a bounded embodied intention.
8. Only one robot-autonomy episode is admitted at a time.
9. Reactive and Sleep suppress automatic boredom admission. Semi is timer
   driven. Full selects another child between cooldowns.
10. Dashboard -> Active Operator exposes child schedules, latest outcomes, and
    current episode provenance without private content.

## Implemented resolution

The maintained source now follows the target boundary:

- Robot Operator owns three child schedules. Semi mode arms independent idle
  timers; Full mode rotates enabled children against the Active Operator
  cooldown; Reactive mode and an active Sleep Workflow publish a dormant state.
  Entering a dormant state also cancels already-admitted automatic boredom work
  while leaving explicitly requested manual work alone.
- Each child is marked `runtimeOwner: robot-operator`; Trigger Manager excludes
  those entries from its runtime and rejects attempts to patch, register, or
  unregister them through Trigger Manager controls.
- Boredom Observer alone starts with `captureImage`. Boredom Movement and
  Boredom Reflection enqueue non-visual autonomous stimuli and cannot select a
  robot command in their trigger handler.
- `boredom-observer-mode.json`, `boredom-movement-mode.json`, and
  `boredom-reflection-mode.json` are finite trigger graphs. They contain no
  executive LLM, TTS, or semantic action-selection node and feed the editable
  `boredom-autonomy-mode.json` graph.
- Boredom Autonomy reuses the canonical Environment action parser, Task State,
  Movement Generator, Bridge Out, buffers, and TTS. Task State is the sole
  objective/evidence lifecycle owner; no boredom-specific state store,
  validator, queue, or executor exists.
- Boredom Reflection reuses the user-scoped curiosity sampler, with sampled
  memories explicitly represented as historical, non-current context.
- Robot Operator publishes sanitized runtime schedule state under `logs/run`.
  The existing Active Operator status endpoint combines that state with recent
  coordinator episodes for the Dashboard -> Active Operator view.
- Legacy `robot-operator-mode.json` remains only to finish already-admitted old
  cycles safely. Its conversation-history and direct-TTS paths were removed.
- Spoken robot audio now falls back directly to the configured Environment
  graph instead of entering the legacy Robot Operator graph.

Validation performed without dispatching physical robot work: specialized
Robot Operator and environment compatibility tests, cognitive-graph validation,
architecture guard, production site build, and whitespace/error diff check.
