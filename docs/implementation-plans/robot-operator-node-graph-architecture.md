# Robot Operator Node-Graph Architecture

Status: Phase 1 and bounded Environment refinement implemented at code level;
physical validation remains open, updated 2026-08-03

This document records the current understanding of the MetaHuman robot system
and the intended boundary for the next Robot Operator implementation. It exists
because the change crosses service admission, graph execution, conversation,
movement, and eventually private inner dialogue. Runtime implementation should
preserve these boundaries instead of incrementally adding semantic behavior to
service code.

This document refines `robot-active-operator-roadmap.md` for graph and buffer
ownership. The roadmap continues to own Active Operator mode philosophy, safety
gates, physical validation, and its explicit permission boundaries. This
document supersedes the older statement in `robot-operator.md` that Environment
Mode must remain the only robot decision graph.

## Owner decisions recorded here

| Decision | Status |
| --- | --- |
| Add a dedicated configurable Robot Operator decision graph | Decided |
| Make Robot Operator Mode a higher-level intention and routing graph | Decided |
| Keep Environment Mode as the only graph that decides how to execute robot speech and actions | Decided |
| Keep Robot Operator itself deterministic and non-LLM | Decided |
| Agents collect or produce data but never invoke an LLM directly | Decided |
| LLM prompts and semantic instructions live in node-graph configuration | Decided |
| Environment Bridge remains transport rather than a decision-maker | Decided |
| Reuse the Work Coordinator, model router, memory owners, and four canonical buffers | Decided |
| Keep spoken conversation and unspoken inner dialogue as different outputs | Decided |
| Focus the first implementation on conversation, observation, and movement | Decided |
| Record each delegated Robot Operator intention in Inner Dialogue before execution | Decided |
| Keep the existing Environment Task Validator as the sole task-completion authority | Decided and implemented |
| Let a graph-owned refiner author a new prompt only after that validator reports incomplete | Decided and implemented |
| Generate additional free-form autonomous reflections or curiosity thoughts | Deferred |
| Allow a private thought to become speech automatically | Not allowed; a later Robot Operator intention and Environment Mode action decision are required |

## Phase 1 implementation status

Implemented on 2026-08-03:

- the dedicated `robot-operator-mode.json` high-level graph;
- persona, bounded conversation history, and correlated image context;
- strict `environment` or `wait` decision parsing;
- deterministic delegation of one intention and the same observation to
  Environment Mode;
- pre-dispatch admission of that clean authored intention to the canonical
  Inner Dialogue Buffer, without long-term-memory capture;
- Robot Observer and Boredom Movement routing through the configured Robot
  Operator graph without agent-owned LLM calls;
- one bounded Environment completion loop in which the existing Environment Task
  Validator either closes the objective or emits one typed incomplete result;
- one graph-owned Environment Task Refiner that turns only that validated result
  into a narrower prompt and candid user-visible update;
- reuse of the canonical Conversation Buffer, Environment Workflow Command, and
  Work Coordinator for each refined attempt, with no second validator, buffer,
  queue, or execution path;
- Node Editor discovery, graph validation, and focused contract coverage.

Not yet claimed: stable live model quality, physical completion-loop reliability,
completion-driven Full operation after a whole objective terminates, or
additional free-form autonomous reflection and curiosity workflows.

## Non-negotiable boundary

Robot-related agents do not trigger LLM calls, construct prompts, or decide what
the robot should do. They may collect data and emit a typed result. Robot
Operator receives that result, applies deterministic admission rules, and
submits the configured node graph through the existing Work Coordinator. The
node graph owns every LLM call and every semantic instruction given to an LLM.

The difference is important:

- an agent may produce a new `RobotStimulus`;
- the agent may not call an LLM or turn that stimulus into a behavioral command;
- Robot Operator may admit the stimulus but may not interpret its meaning;
- Robot Operator Mode decides whether the information warrants a high-level
  intention and whether to delegate that intention;
- Environment Mode receives the intention plus the same observation and decides
  how to express or execute it;
- deterministic validators decide whether Environment Mode's proposed result is
  permitted;
- existing output owners execute or persist the validated result.

Code may still enforce invariants that must not be editable model behavior:
authentication, capability checks, correlation, idempotency, resource leases,
schema validation, action budgets, stop behavior, and physical safety limits.
Code must not contain object-specific behavioral rules or prose instructing an
LLM how to interpret a scene, continue a task, speak, or choose an action.

## Current maintained system

### Current robot path

The maintained runtime currently follows this broad path:

```text
Robot controller / Ainekio adapter
  <-> Environment Bridge
  <-> Environment observations and semantic commands
  <-> Work Coordinator
  <-> Environment Mode graph
  <-> conversation, TTS, memory, Robot Buffer, or robot action
```

Robot-specific idle admission currently follows:

```text
Active Operator Semi or Full
  -> Robot Operator timer
  -> Robot Observer or Boredom Movement workflow
  -> Work Coordinator
  -> Environment Mode
```

Robot Operator is already a persistent `usesLLM: false` service. It owns the
Robot Observer and Boredom Movement inactivity timers and submits finite work to
the Work Coordinator. Phase 1 configuration now selects the high-level
`graph: "robot-operator"` and delegates accepted intentions to
`environmentGraph: "environment"`.

Environment Bridge already transports observations, images, semantic actions,
and correlated action feedback. It is not the reasoning owner.

Environment Mode already demonstrates most of the reusable graph pieces:

- observation and image input;
- conversation history;
- context routing and semantic memory search;
- persona loading and formatting;
- model routing;
- structured action parsing;
- task validation and graph-owned bounded refinement;
- semantic movement generation;
- Environment Bridge output;
- Conversation Buffer, Robot Buffer, TTS, and memory capture.

The new Robot Operator graph should reuse the maintained observation, image,
conversation-history, persona, model-routing, and coordinator owners. It should
not duplicate Environment Mode's action parsing, movement generation, speech,
Conversation/Robot Buffer, or memory branches. It may reuse the canonical Inner
Dialogue Buffer node for one bounded unspoken intention checkpoint. A new graph
is a new configurable deliberation and routing workflow, not a second execution
pipeline, model router, queue, bridge, memory system, or buffer implementation.

### Current canonical buffer ownership

MetaHuman already has four canonical per-profile buffers:

| Buffer | Meaning | Robot Operator use |
| --- | --- | --- |
| Conversation Buffer | Spoken user/persona conversation | Spoken robot responses and user-facing questions |
| Inner Dialogue Buffer | Unspoken thoughts, reflections, dreams, and reasoning records | One clean delegated intention before execution; additional free-form thought remains deferred |
| System Buffer | Service, workflow, warning, failure, and lifecycle events | Operational failures or lifecycle records when appropriate |
| Robot Buffer | Structured robot commands and delivery/completion state | Validated robot action lifecycle records |

Each buffer is admitted through its designated graph node and all four reuse the
canonical core buffer service. The Robot Operator work must not add a fifth
buffer or write a buffer directly from an agent or service.

Conversation and Inner Dialogue remain isolated persistence surfaces. The
existing Conversation History node may include a bounded amount of Inner
Dialogue in conversational context only when Unified Consciousness is enabled.
That read-time configuration does not merge the buffers and does not turn an
inner thought into spoken conversation.

### Remaining current gaps

The current implementation still has these gaps:

1. Robot Operator admits timer-owned child workflows but is not the single
   event ingress and lifecycle owner for all embodied work.
2. The bounded Environment task-refinement loop is contract-tested but has not
   yet been shown reliable through repeated physical completion feedback.
3. Full robot autonomy still lacks the higher-level event-driven decision that
   selects a new objective after the current objective completes.
4. Some LLM-facing instructions are embedded in TypeScript in the environment
   execution engine, observation formatter, instruction interpreter, and
   movement generator.
5. Beyond the bounded delegated-intention record, the system has no general
   typed distinction between a private autonomous thought and a statement
   intended for the user.

## Target architecture

```text
Robot-related agent result ───────────────┐
Environment Bridge observation/image ────┤
Environment Bridge terminal feedback ────┼─> Robot Operator
User-owned robot task ────────────────────┤      (no LLM)
Mode entry / bridge readiness ────────────┘        |
                                                   | deterministic admission,
                                                   | correlation, mode, budget,
                                                   | session and graph selection
                                                   v
                                            Work Coordinator
                                                   |
                                                   v
                                      robot-operator-mode.json
                                      ├─ stimulus normalization
                                      ├─ conversation context
                                      ├─ optional configured inner context
                                      ├─ persona
                                      ├─ image/environment evidence
                                      ├─ graph-owned LLM prompts
                                      ├─ high-level intention decision
                                      └─ deterministic route parser
                                                   |
                                      delegate or wait
                                           |       |
                                           |       └──────────────> complete
                                           v
                              Environment Mode graph
                              ├─ interpret intention + image
                              ├─ decide how to respond
                              ├─ validate semantic action and task completion
                              ├─ conversation / TTS
                              └─ Environment Bridge / Robot Buffer
                                           |
                                           v
                                    terminal outcome
                                           |
                                           v
                              existing Environment Task Validator
                                  | complete         | incomplete, step < 8
                                  v                  v
                                 stop       Environment Task Refiner LLM
                                                     |
                                                     v
                                  canonical Conversation Buffer / TTS
                                                     |
                                                     v
                                  existing Environment Workflow Command
                                                     |
                                                     v
                                      Work Coordinator -> Environment Mode

After the whole objective closes, a later Full-mode phase may return that
terminal objective outcome to Robot Operator to select a new objective.
```

### Component ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| Robot-related agent | Finite data acquisition or domain result | LLM calls, prompts, graph selection, robot behavior |
| Environment Bridge | Physical transport, observations, action handoff, correlated feedback | Interpretation, conversational policy, autonomous decisions |
| Robot Operator | Embodied ingress, admission, graph selection, cycle lifecycle, deterministic mode and budget gates | Prompts, LLM calls, semantic scene interpretation, action invention |
| Work Coordinator | The one finite-work queue, leases, retries, cancellation, visible lifecycle | Robot-specific semantic policy |
| Robot Operator graph | Persona-aware high-level deliberation, intention creation, and route selection | Robot command selection, movement generation, TTS, direct buffer writes |
| Environment Mode graph | Interpret the delegated intention and decide how to speak, observe, or act | Invent an autonomous objective without an admitted human or Robot Operator instruction |
| Environment Task Validator | Sole task-completion decision, completion-evidence checks, and bounded incomplete-result admission | Writing a retry prompt, open-ended scene interpretation, queues, or persistence |
| Environment Task Refiner | Graph-configured LLM authorship of one narrower prompt and visible update after the validator reports incomplete | Revalidating completion, direct action execution, queues, or persistence |
| Other validator nodes | Schema, capability, correlation, and physical safety enforcement | Task-completion ownership or open-ended scene interpretation |
| Buffer and memory nodes | Canonical admission and policy-controlled persistence | Behavioral decision-making |
| Robot controller | Hardware execution and physical completion reporting | MetaHuman conversation or autonomy policy |

## Dedicated Robot Operator graph

The implemented graph is:

```text
etc/cognitive-graphs/robot-operator-mode.json
```

Robot Operator configuration selects it with:

```json
{
  "graph": "robot-operator"
}
```

The existing graph loader resolves that key to `robot-operator-mode.json`.
Agents and incoming events do not provide or override the graph name. A future
allow-listed graph profile may be selected by Robot Operator configuration, but
never by untrusted event payload or LLM output.

### Separation from Environment Mode

Environment Mode remains the execution workflow for both human-authored robot
instructions and Robot Operator-authored intentions. Robot Operator Mode sits
above it only for autonomous robot stimuli.

The two graphs execute different stages of one autonomous turn:

```text
autonomous observation
  -> Robot Operator Mode: what, if anything, do I want to do?
  -> Environment Mode: how do I carry out or communicate that intention?
```

This is not duplicate deliberation. Robot Operator Mode must not select a robot
command, joint motion, TTS operation, or buffer destination. It emits a bounded
first-person intention such as `I see a red ball and want to investigate it.`
Environment Mode receives that intention plus the original image and chooses
the supported semantic action or spoken response.

Human text/audio robot instructions continue to enter Environment Mode directly.
Robot Operator Mode is the autonomous equivalent of the human input step, not a
replacement for Environment Mode.

### Phase 1 graph responsibilities

The first graph supports only high-level autonomous deliberation:

- accept one typed stimulus;
- load current persona;
- load bounded Conversation history;
- optionally read bounded Inner Dialogue only through the existing Unified
  Consciousness setting;
- consume the current image, environment state, capabilities, and source
  metadata;
- decide whether there is a useful intention to delegate;
- express a delegated intention as concise first-person natural language;
- admit that clean authored intention to the canonical Inner Dialogue Buffer;
- pass the intention and unchanged correlated observation to Environment Mode;
- do nothing when no response is justified;
- expose a typed, inspectable dispatch result.

Phase 1 does not select physical actions, synthesize speech, write Conversation
or Robot Buffer, capture long-term memory, or generate an additional free-form
private thought. It records only the thinking-stripped delegated intention in
Inner Dialogue; all execution effects remain in Environment Mode and its
established downstream owners.

### Implemented Phase 1 topology

```text
Robot Stimulus Input
  -> Observation + Image Input
  -> Conversation History -------------------┐
  -> Persona Loader / Formatter --------------┤
                                              v
                              Robot Operator Context
                                              |
                                              v
                                  Robot Operator LLM
                                              |
                                              v
                                  Thinking Stripper
                                              |
                                              v
                                  Intention/Route Parser
                                      |               |
                                      v               v
                         Inner Dialogue Buffer       wait
                                      |
                                      v
                           Environment Dispatch
                                      |
                                      v
                              Environment Mode
```

The graph reuses Environment Observation, Environment Image Input, Conversation
History, Persona Loader/Formatter, Model Router, Thinking Stripper, and Inner
Dialogue Buffer. It adds only a prompt-configurable Robot Operator Context node,
a strict decision parser, and a deterministic Environment dispatch node.

### Graph-owned prompt policy

All semantic instructions to an LLM must be visible and configurable in graph
node properties. This includes:

- how to interpret autonomous observations;
- how to distinguish user goals from background stimuli;
- what context to use;
- the open-ended robot decision prompt;
- the structured intention/route output contract;
- how to distinguish a useful delegated intention from waiting;
- repair prompts after malformed model output.

Node TypeScript may substitute bounded structured facts into configured prompt
templates. It may not supply a hidden fallback prompt containing semantic
behavior. Missing required prompt configuration should fail graph validation or
produce a visible configuration error rather than silently fall back to coded
instructions.

Safety schemas and numeric hardware limits remain deterministic code. The graph
can decide that it wants to move; it cannot redefine servo bounds, supported
action types, emergency stop, authentication, or resource ownership.

## Typed stimulus and result contracts

The exact schema should be finalized beside implementation, but the ownership
shape is:

```ts
interface RobotStimulus {
  id: string
  kind:
    | 'user_task'
    | 'agent_result'
    | 'observation'
    | 'action_result'
    | 'mode_entry'
    | 'bridge_ready'
  source: string
  occurredAt: string
  username: string
  sessionId?: string
  cycleId?: string
  correlationId?: string
  objectiveId?: string
  payload: unknown
  evidenceRefs?: string[]
}
```

An agent result carries facts and evidence, not an LLM prompt. A user task may
carry the user's original words because those words are authoritative input,
but the agent or Robot Operator may not rewrite them into semantic model
instructions.

The graph returns a structured result similar to:

```ts
interface RobotOperatorDecision {
  route: 'environment' | 'wait'
  reason: string
  instruction: string | null
}
```

`reason` is a concise decision explanation suitable for validation and audit. It
is not hidden chain-of-thought and must not be treated as private inner
dialogue. `instruction` is required only for the `environment` route and states
an intention or desired interaction, not an actuator command. Environment Mode
owns all later speech/action parsing and validation.

## Conversation versus Inner Dialogue

The robot can have a thought without saying it, and it can say something without
creating a private-thought record. These are different product events.

### Spoken response

A spoken response is intentional communication to a person. It:

- is explicitly selected by Environment Mode while executing a human
  instruction or a delegated Robot Operator intention;
- passes through the existing persona-response path;
- is admitted to the Conversation Buffer;
- may be sent through TTS and Environment Bridge;
- is eligible for normal conversation memory according to existing policy.

### Private thought

A private thought is an authored, unspoken reflection. It:

- is never inferred from raw model reasoning or `<think>` output;
- is never sent directly to TTS;
- is admitted only through the Inner Dialogue Buffer node;
- may affect later conversation only through existing configured context rules;
- does not become a user-visible question merely because it contains a question.

### Phase 1 operator intention record

When Robot Operator Mode chooses the `environment` route, its clean
`instruction` is an authored unspoken intention. The graph admits that text to
Inner Dialogue before Environment dispatch. It does not store the parser's
`reason`, hidden `<think>` content, or a second generated reflection. A `wait`
decision has an empty instruction and therefore creates no Inner Dialogue
entry. Long-term-memory capture is disabled for this checkpoint.

### Curious thought versus curious spoken question

Examples:

- `I wonder why that object was moved.` is a possible private curiosity record.
- `Did you move the red object?` is a spoken question and belongs in the
  Conversation Buffer.

The system must not promote the first into the second through buffer routing.
Speaking requires an explicit Environment Mode action decision; a later Robot
Operator thought may supply an intention, but it cannot directly select TTS or
write Conversation Buffer. This keeps privacy, user experience, and physical
speech auditable.

## Deferred free-form private-thought phase

Additional autonomous reflection and curiosity generation is deliberately
deferred until the conversational and movement operator is stable. This is
separate from Phase 1's bounded record of an already-selected intention.

The preferred later design is a separate configured inner workflow rather than
an extra output accidentally attached to every robot turn:

```text
Robot Operator graph chooses an allow-listed reflection/curiosity outcome
  -> Work Coordinator admits configured inner workflow
  -> inner workflow generates one explicit private-thought record
  -> Inner Dialogue Buffer
  -> optional long-term memory through existing policy
  -> typed completion returns to Robot Operator
```

Existing Curiosity, Reflector, Daydreamer, and Inner Dialogue Buffer graph
owners should be evaluated for reuse before creating a robot-specific inner
graph. Their persistence must be reused even if a new robot-specific inner
workflow is justified.

A later stimulus may cause the Robot Operator graph to consider whether to
speak, but the inner workflow must never call TTS or Conversation Buffer
directly. This preserves the established separation between private cognition
and communication.

## Mode behavior through the new graph

The new graph does not replace deterministic mode enforcement.

### Reactive

- Human-initiated robot inputs continue directly through Environment Mode.
- A manually requested Robot Observer may run Robot Operator Mode after its
  image returns.
- Explicit user robot tasks may observe, speak, or act within validation.
- No timer, agent result, or completion event may create unrelated autonomous
  work.

### Semi

- User-owned multi-step tasks may continue through bounded validated graph
  decisions.
- A bounded idle observation may be admitted.
- Unsolicited perception may produce speech/report or wait, but not
  self-directed movement.
- Boredom behavior must be decided in the graph rather than randomly selecting
  a coded robot command.

### Full

- Full begins with a permitted event, not a periodic LLM call inside an agent.
- Every terminal embodied task returns to Robot Operator.
- Robot Operator admits exactly one next graph decision when mode, safety,
  authorization, and budgets permit.
- Robot Operator Mode may delegate a high-level intention or wait. Environment
  Mode decides how a delegated intention becomes observation, action, speech,
  report, or a user question.
- Waiting is event-driven or durable coordinator state, not a zero-delay LLM
  loop or an untracked Robot Operator timer.

## Implementation phases

### Phase 0: Contract and collision audit

- Preserve the current dirty Environment Mode and Environment Bridge work.
- Reconcile this document with the active roadmap before changing runtime
  ownership.
- Inventory every robot stimulus producer and every direct Environment Mode
  admission path.
- Identify all hardcoded LLM prompt prose that must move to graph properties.
- Record which required changes cross the roadmap's explicit-permission
  boundary.

Exit condition: every current producer has one named target owner and no
existing local work is overwritten.

### Phase 1: New graph and high-level intention path

- Add and validate `robot-operator-mode.json`.
- Add the typed stimulus and decision contracts needed by the graph.
- Put Robot Operator Mode's LLM instructions in graph node properties.
- Reuse existing observation, image, Conversation History, persona, Model
  Router, Thinking Stripper, and Work Coordinator owners.
- Reuse Inner Dialogue Buffer to record the clean delegated intention before
  dispatch, with long-term-memory capture disabled.
- Delegate selected intentions with the same correlated observation to the
  existing Environment Mode graph.
- Configure Robot Operator with `graph: "robot-operator"`.
- Keep additional free-form private-thought generation disabled.

Exit condition: one Robot Observer image can run through Robot Operator Mode,
produce a bounded high-level intention, and queue exactly one Environment Mode
execution carrying the same image. The delegated intention is admitted to Inner
Dialogue first. A wait decision writes and queues nothing.

### Phase 2: Make Robot Operator the autonomous embodied ingress

- Route Robot Observer results through Robot Operator.
- Replace Boredom Movement's coded/random action choice with a typed stimulus.
- Route autonomous Environment Bridge images, state, readiness, and terminal
  results through Robot Operator admission.
- Preserve one Work Coordinator and one Environment Bridge.
- Keep human text/audio inputs on their direct Environment Mode path.

Exit condition: every autonomous physical robot stimulus is correlated,
admitted once, and handled by exactly one configured decision graph before any
delegated Environment Mode execution.

### Phase 3: Completion-driven Full operation

- Disable Robot Operator idle timers as the Full-mode control loop.
- Admit an initial Full decision from a permitted event.
- Admit exactly one successor graph decision after each terminal result.
- Enforce rate, action, failure, and session budgets outside model prose.
- Validate conversation, observation, movement, and wait outcomes before
  physical Full autonomy is enabled.

Exit condition: Full is event/completion driven while Reactive and Semi retain
their separate contracts.

### Later phase: Private thought and curiosity integration

- Decide whether existing Curiosity/Reflector graphs are sufficient.
- Add an explicitly configured private-thought workflow only if required.
- Route authored private thoughts only to Inner Dialogue Buffer.
- Return completion to Robot Operator without automatically speaking.
- Add a separate later Robot Operator graph decision when an outward
  communication intention may be appropriate; Environment Mode still decides
  whether and how it is spoken.

Exit condition: tests prove private thoughts cannot leak to Conversation Buffer
or TTS and spoken questions cannot be mislabeled as inner dialogue.

## Validation requirements

Each implementation batch must prove:

- Robot Operator and robot-related agents import no LLM invocation utility;
- robot-related agents do not construct prompts or accept graph names from
  event payloads; graph routing comes from Robot Operator configuration;
- all Robot Operator LLM prompt prose is present in graph configuration;
- one autonomous stimulus runs one Robot Operator decision and queues at most
  one Environment Mode execution;
- Conversation, Inner Dialogue, System, and Robot Buffer ownership remains
  unchanged;
- Phase 1 writes only the thinking-stripped delegated intention to Inner
  Dialogue, before Environment dispatch and without long-term-memory capture;
- Robot Operator Mode contains no speech, action, memory-capture,
  Conversation Buffer, System Buffer, or Robot Buffer node;
- Environment Mode remains the owner of Conversation/TTS and robot action
  routing;
- no raw model reasoning is persisted;
- Reactive admits no autonomous work;
- Semi cannot turn unsolicited perception into movement;
- Full admits at most one successor per terminal result;
- stale images, missing capabilities, disconnects, and invalid model output
  fail closed;
- `pnpm validate:graphs` and focused Robot Operator, Environment, buffer, and
  bridge contract tests pass;
- physical behavior is not claimed from simulator or contract tests alone.

## Explicit non-goals

- no second Work Coordinator, Trigger Manager, scheduler, or policy service;
- no second Environment Bridge or hardware command queue;
- no new conversation, inner-dialogue, robot, or memory store;
- no direct agent or Robot Operator LLM call;
- no hardcoded Robot Operator scene-specific or command-specific LLM behavior
  in TypeScript;
- no raw servo, PWM, calibration, or unrestricted joint command from the
  decision LLM;
- no automatic conversion of private thoughts into speech;
- no capture of hidden chain-of-thought;
- no unrelated Active Operator, conversation, memory, Curiosity, or Ainekio
  refactor under the name of this feature.

## Dependencies requiring an explicit implementation decision

The active roadmap currently pre-authorizes Environment Mode graph/node and
named robot-agent surfaces, but this design will likely require narrowly scoped
changes outside that list:

- adding a new built-in graph to graph validation and Node Editor discovery;
- removing hardcoded robot prompts from the generic execution engine;
- routing physical Environment Bridge observations to Robot Operator before
  graph selection;
- potentially extending shared graph input/result types;
- confirming existing memory policy for sensor-only autonomous observations;
- integrating existing Curiosity or other background workflows in Full.

These dependencies must be authorized and implemented at their existing owners.
They must not be worked around with duplicate routing, persistence, queues, or
service-local LLM calls.

## Remaining product decisions

Before physical Full autonomy is enabled, the owner still needs to decide:

1. Which semantic commands Full may self-initiate.
2. Whether Full begins with observation, speech, and stationary movement only,
   or may locomote.
3. When an autonomous spoken observation is helpful versus disruptive.
4. Which event classes are allowed to wake a waiting Full operator.
5. Which sensor-only observations deserve long-term memory.
6. Whether a later private-thought workflow reuses Curiosity/Reflector directly
   or warrants a dedicated robot-inner graph.
7. Whether Unified Consciousness should be enabled for Robot Operator context by
   default or remain a per-user conversation setting.
8. Which rate, consecutive-action, failure, and silence budgets apply.
9. What staged physical test sequence is required before movement in Full.

Until those decisions and the cross-owner permissions are recorded, Phase 1
should remain limited to graph construction, deterministic contracts, simulated
execution, and focused validation.
