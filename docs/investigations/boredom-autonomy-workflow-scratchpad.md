# Boredom Autonomy Workflow Scratchpad

Status: active design and implementation scratchpad, 2026-08-24

## Implementation status

Implemented at source level on 2026-08-24:

- added the editable `boredom-autonomy-mode.json` executive graph;
- routed Observer image feedback and Movement/Reflection delegation into it;
- supplied separate bounded Conversation and Inner Buffer context, active
  persona, delegated reflection memory, current correlated images, action
  feedback, and the complete advertised capability schema;
- reused the existing Environment action parser, optional Movement Generator,
  Environment Task State, Bridge Out, Robot Buffer, Conversation Buffer, Inner
  Dialogue Buffer, and TTS nodes;
- made Environment Task State the sole lifecycle and consequence-admission owner
  for both reactive Environment Mode and Boredom Autonomy;
- returned model-selected presentation directly from the existing action parser,
  avoiding a second response-routing or synthesis pass;
- routed physical results back to Boredom Autonomy through the existing bounded
  robot-observer cycle;
- made the same executive model call author or revise a short-lived objective in
  the existing Environment Task State before selecting one consequence;
- carried only Task State's serialized lifecycle contract as the originating
  instruction for the next correlated action-result pass;
- removed the competing Robot Autonomy Episode State node, nested output
  contract, self-instruction feedback authority, and episode presentation
  metadata;
- made the existing Environment Action Parser enforce the existing strict
  selector JSON contract at runtime instead of accepting prose or partial JSON;
- removed the movement trigger's stationary/posture preference and restored the
  single configured Robot Operator cycle step ceiling for every boredom child;
- kept the three trigger graphs free of LLM, persona, history, speech, and
  semantic action-selection nodes;
- authorized the new graph to reuse the one canonical server-owned robot speech
  route without opening robot TTS to arbitrary workflows.

Still unproven: live model quality, physical movement, fresh-frame correlation,
TTS completion ordering, and Semi/Full interruption behavior on the actual
robot. Those require a restarted runtime and hardware tests.

## Product intent

MetaHuman OS should let Ainekio behave like an interactive familiar or pet, not
only a voice-command appliance. When the robot has been idle, Robot Operator
may trigger observation, movement, or reflection. Those triggers supply an
autonomous stimulus; they do not decide or execute the consequence.

The consequence can be broad and persona-dependent: a private thought, speech,
an advertised movement, a fresh observation, or a short sequence that changes
as action results and images arrive. Activities must be inferred from current
evidence, persona, recent conversation, private reflection, sampled memory, and
available capabilities. They must not be encoded as scene-specific rules or a
hard-coded activity catalog.

Environment Mode remains the reactive workflow for user-authored instructions.
Autonomous boredom needs its own editable workflow because it has a different
decision contract: choose what to do during an idle episode, act once, inspect
the result, and reconsider. It is not trying to satisfy a user's one-shot task.

## Ownership boundaries

- Robot Operator is the only boredom scheduler and admission owner.
- Boredom Observer, Movement, and Reflection are finite trigger workflows owned
  by Robot Operator.
- Boredom Autonomy is the editable semantic executive for those triggers.
- The Work Coordinator remains the only queue and interruption surface.
- Existing Environment action parsing, capability admission, movement
  generation, bridge transport, TTS, and canonical buffers remain the execution
  owners. The new workflow reuses their nodes; it does not clone their code.
- The Environment Bridge transports observations, actions, and correlated
  results. It does not decide behavior.
- Sleep remains separately owned by Sleep Workflow.
- User work, Reactive mode, Sleep, and emergency stop may cancel autonomy.

## Current state and gap

The three boredom triggers and Boredom Autonomy are visible graphs. A first
implementation added a second Robot Autonomy Episode State lifecycle beside
Environment Task State and fed its `selfInstruction` back as execution
authority. That split ownership allowed the selector to continue a named
gesture while bypassing the canonical objective/evidence reducer. The repair
deleted the duplicate lifecycle and stores the executive's current objective in
Environment Task State, which already owns evidence, step limits, and feedback.

Robot Operator already supplies most of the control plane that is needed:

- Semi uses independent randomized inactivity timers.
- Full rotates the three triggers between configured cooldowns.
- active robot-autonomy work prevents overlapping boredom cycles.
- each cycle has correlation metadata and a small step budget.
- action results can select a feedback graph.
- the coordinator can preempt autonomy for user work.

The source repair now carries one Environment Task State contract through the
existing robot-observer cycle. Remaining proof is runtime and physical: the
configured model must produce a valid objective and consequence, the adapter
must return correlated action evidence, and the next pass must use that state
on hardware.

## Research findings

### Durable software agents

OpenAI Codex `/goal` keeps one objective across turns, works in checkpoints,
validates progress, and exposes pause, resume, clear, and status controls. Its
important architectural idea is a durable contract and resumable progress, not
an unbounded model call. A boredom episode differs because it begins without a
user-defined end state. The reusable part is checkpointed continuation; the
robot should choose a short-lived intention and yield after each consequence.

OpenAI's agent guidance treats a result as a continuation surface and resumable
snapshot. Background work is cancellable, and long histories can be compacted.
This supports storing compact objective state rather than replaying a growing
transcript or keeping one graph execution alive indefinitely.

### Robot executives

ROS 2 Actions model physical behavior as goal, feedback, result, and
cancellation/preemption. BehaviorTree.CPP and Nav2 add an event-driven executive
that yields while actions run, rechecks conditions between steps, and separates
recovery from primary behavior. The useful pattern is an interruptible executive
around asynchronous actions. Installing a second behavior-tree runtime in
MetaHuman would duplicate the existing graph engine and coordinator.

PlanSys2 demonstrates PDDL-based multi-step planning. It is appropriate when a
robot has a formal domain, explicit goals, and known predicates. Boredom is
open-ended and persona-driven, so PDDL would add a domain-maintenance burden
without solving the central selection problem. It may become useful later for
bounded household missions, not for the idle familiar loop.

### LLM embodied agents

ReAct interleaves reasoning summaries, actions, and observations so an agent can
track and revise a course of action instead of restarting after each tool result.
Inner Monologue applies the same closed-loop principle to robots using scene,
success, and interaction feedback. The applicable part here is a bounded,
inspectable objective state rather than an exposed chain-of-thought transcript.

SayCan separates semantic usefulness from physical affordance: an LLM proposes
skills while learned affordances prevent infeasible choices. MetaHuman already
has the lean equivalent: the model sees the current advertised capability and
robot-command catalog, while deterministic parsers and bridge admission reject
unsupported actions.

PaLM-E combines current sensor input with language reasoning and updates a plan
as the world changes, while a lower-level policy translates text to actions.
The applicable pattern is to make fresh correlated perception and action
feedback first-class inputs while preserving the existing lower-level action
owners.

Voyager combines an exploration curriculum, reusable skills, and iterative
prompting with environment feedback and self-verification. Its strongest fit is
the feedback loop. Its automatic curriculum and code-generating skill library
would be excessive for this robot today; the advertised motion catalog already
is the skill library.

## Recommended architecture

Use a hybrid, receding-horizon executive:

```text
Robot Operator timer or manual Agent Monitor run
  -> one specialized boredom trigger graph
  -> Boredom Autonomy graph
       read current correlated observation/result
       read bounded persona + conversation + inner reflection + sampled memory
       choose one consequence
       capability-check and execute at most one action
       publish speech or private reflection when selected
  -> yield to Work Coordinator
  -> correlated action result/image re-enters Boredom Autonomy
  -> choose one next consequence or end the episode
```

This is a one-step model-predictive or receding-horizon loop: decide only the
next meaningful consequence using the latest state. It is more robust and less
expensive than asking the model to author and repeatedly validate a long plan.

### Mode semantics

- Reactive: no automatic episode; manual Agent Monitor runs remain possible.
- Semi: a timer admits one bounded boredom episode, then that trigger returns to
  its inactivity timer.
- Full: after a cycle ends and the cooldown/user-presence gates clear, Robot
  Operator admits the next trigger. It does not keep a graph call alive.
- Sleep: cancels/dormants awake boredom work and runs only Sleep Workflow.

### Lifecycle state

The existing correlated robot-observer metadata carries:

- `cycleId`
- `step` and `maxSteps`
- `requestedBy`
- `triggerSource`
- `graph`
- latest correlated image/action feedback
- one serialized `EnvironmentTaskState` contract containing the current
  model-authored objective, phase, action step, evidence contract, presentation,
  baseline frame reference, and selected action

This adds no database or transcript. The visible graph prepares the existing
Task State before the executive call and reduces the returned consequence
afterward. The same generic owner serves user and autonomous objectives; only
the executive prompt and requirement that autonomy author an objective differ.

### Deliberation contract

One model pass may choose exactly one of:

1. one supported action, optionally with a brief spoken or private response;
2. conversation without a physical action;
3. substantive private reflection without a physical action.

The model receives the complete currently advertised robot-command catalog.
Novel body-local gesture generation is available only through the existing
Movement Generator and only when `robotMotionPlan` is advertised. Memories are
historical inspiration, never current-world evidence. A claimed action must be
present in the structured action field; prose such as “I will stretch” does not
count as execution.

After an action, the next pass sees its correlated result and any new image. It
may continue, change direction, speak, reflect, or stop. The graph step limit,
coordinator preemption, capability admission, bridge readiness, and physical
safety checks remain deterministic.

## Efficiency rules

- one executive LLM call per graph pass;
- zero trigger-owned LLM calls;
- at most one physical action per pass;
- a second Movement Generator call only for a deliberately selected novel
  body-local motion;
- small bounded context: recent conversation and inner reflection, up to three
  sampled memories, one persona representation, and current correlated evidence;
- a roughly 150-250 word executive prompt;
- a roughly 384-token executive output budget;
- queue-level re-entry after results, never an unbounded graph back-edge;
- no conversation-history replay growth and no new persistence owner;
- no second scheduler, action validator, behavior-tree runtime, or planning
  service.

## Implementation order

1. Add the visible `boredom-autonomy-mode.json` workflow using existing generic
   nodes.
2. Route Observer camera feedback and Movement/Reflection delegation into it.
3. Reuse the Environment structured action schema, parser, Movement Generator,
   Bridge Out, Robot Buffer, Conversation Buffer, Inner Dialogue Buffer, and
   TTS nodes.
4. Use Environment Task State for objective persistence, evidence consistency,
   generated-movement admission, and serialized feedback continuation.
5. Keep the existing cycle correlation and step limit as the bounded episode.
6. Validate source contracts, all cognitive graphs, architecture boundaries,
   and focused autonomous cases.
7. Physically test Semi and Full separately. Source validation cannot prove a
   servo moved, a frame was fresh, TTS finished, or a user interruption stopped
   an already-dispatched body action.

## Evaluation cases

- Observer sees an ordinary but interesting object and chooses speech,
  reflection, or one supported action; it does not only caption the image.
- Movement selects any exact command from the live advertised catalog and the
  terminal shows an actual bridge command, not intention prose.
- Reflection uses a concrete memory once and may choose movement or speech
  without treating the memory as current evidence.
- An action result re-enters Boredom Autonomy with the same cycle and incremented
  step; the next decision sees and may preserve or revise the same self-authored
  Task State objective.
- No action produces a substantive conversation/private reflection and ends the
  episode cleanly.
- A user message preempts queued/active autonomy; Reactive and Sleep prevent new
  automatic admission.
- Full mode never overlaps two boredom cycles and observes cooldowns.
- The final step cannot dispatch another physical action.

## Deferred questions

- Whether a completed Full-mode episode should expose a one-line summary to the
  next episode beyond canonical action and narrative history. Measure first.
- Whether TTS completion needs durable cross-process admission state rather than
  the current in-process pause signal.
- Whether useful repeated behaviors should later be ranked as learned skills.
  Do not add a skill-learning store until real episodes produce enough evidence.
- Whether formal planning is needed for explicit household missions. If so,
  evaluate it as a separate goal workflow, not as part of boredom.

## Primary sources

- [OpenAI Codex: Follow a goal](https://learn.chatgpt.com/use-cases/follow-goals)
- [OpenAI Agents SDK: Orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [OpenAI Agents SDK: Results and state](https://developers.openai.com/api/docs/guides/agents/results)
- [OpenAI API: Background mode](https://developers.openai.com/api/docs/guides/background)
- [OpenAI API: Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [ROS 2 Actions](https://docs.ros.org/en/rolling/Concepts/Basic/About-Actions.html)
- [BehaviorTree.CPP: Reactive and asynchronous behaviors](https://www.behaviortree.dev/docs/3.8/tutorial-basics/tutorial_04_sequence/)
- [Nav2 behavior-tree walkthrough](https://docs.nav2.org/behavior_trees/overview/detailed_behavior_tree_walkthrough)
- [PlanSys2](https://plansys2.github.io/)
- [SayCan](https://say-can.github.io/)
- [PaLM-E](https://research.google/blog/palm-e-an-embodied-multimodal-language-model/)
- [Voyager](https://voyager.minedojo.org/)
- [ReAct](https://arxiv.org/abs/2210.03629)
- [Inner Monologue](https://arxiv.org/abs/2207.05608)
