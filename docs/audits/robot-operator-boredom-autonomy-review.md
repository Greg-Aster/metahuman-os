# Robot Operator Boredom Autonomy Review

Date: 2026-08-25

Scope: maintained Robot Operator scheduling, the three boredom planner graphs,
the shared Boredom Autonomy executor, correlated Environment execution, Agent
Monitor visibility, and graph-editor inspectability. Conversational Trigger
Manager and Sleep Workflow are adjacent systems, not owners of awake robot
boredom behavior.

## Baseline failure

Manual Agent Monitor runs reached the robot path but repeatedly ended in one of
four incorrect states:

- a planner-shaped sentence was treated as though it were an executable
  Environment decision;
- the generic Environment selector had to invent both the boredom intention and
  its technical consequence in one pass;
- correlated results restarted a generic idle decision instead of revising the
  active interest;
- strict downstream checks rejected missing action purpose, evidence, motion
  class, or out-of-range generated joints after the model had already produced
  misleading intention prose.

The previous partial repair also left the removed generic Robot Operator graph
registered as a compatibility path, copied prior action context into new cycles,
limited runs with a second minute-based counter, and described the three child
graphs as non-LLM triggers. That did not implement the requested two-graph
planner/executor boundary.

## Canonical ownership

```text
Active Operator mode and Sleep state
  -> Robot Operator
       schedule, cooldown, mutual exclusion, admission
       -> Boredom Observer planner
       -> Boredom Movement planner
       -> Boredom Reflection planner
            -> Boredom Autonomy executor
                 -> Environment Task State
                 -> Environment Action Parser / Movement Generator
                 -> Environment Bridge Out
                 -> Robot Buffer / Conversation Buffer / TTS
            <- correlated action or image result
```

- Robot Operator is the only automatic boredom scheduler.
- Work Coordinator is the only queue and interruption owner.
- The three boredom graphs own trigger-specific contextual planning.
- Boredom Autonomy is the only shared boredom consequence executor.
- Environment Task State is the only objective lifecycle, evidence,
  action-budget, and completion owner.
- Environment Action Parser owns structured shape and capability admission.
- Movement Generator may author a body-local plan only when that capability is
  advertised; the physical motion validator remains authoritative.
- Environment Bridge Out transports one admitted consequence and correlated
  results. It does not decide behavior.
- Conversation Buffer and TTS are the only outward response path. There is no
  private presentation mode for boredom results.

## Planner contract

Each planner is an editable cognitive graph with one bounded LLM call.

- Observer first requests one correlated camera image, then plans from that
  image, persona, current state, recent conversation and reflection, verified
  action history, and advertised capabilities. A closed image gate skips the
  model call rather than sending an empty request.
- Movement plans from persona, current body and environment state, recent
  context, verified action history, and the complete advertised capability
  schema. It does not preselect a command or generated joint plan.
- Reflection samples one user-scoped memory inside its graph and treats it as
  historical inspiration alongside persona and current context. It does not
  request a camera image merely to permit reflection.

All three return exactly `observed`, `instruction`, and `reason`. The
instruction is high-level and model-authored. Scene statements, activity lists,
technical commands, evidence contracts, joint values, and action sequences are
not hardcoded in runtime policy.

## Executor contract

`boredom-autonomy-mode.json` receives only a validated planner instruction. On
each pass it reads current Task State, active persona, bounded recent
conversation and reflection, verified robot history, sampled memory when
present, current state, advertised capabilities, and correlated evidence.

The executor chooses at most one supported consequence: a meaningful response,
one advertised action, or one supported body-local movement request. A claimed
action must be present in structured output; prose cannot dispatch or prove it.
After an action or image request, its correlated result returns to the same
executor. The model then interprets what changed and Task State preserves or
revises the objective before another consequence is admitted. Action completion
is evidence, not automatic episode completion.

This is a receding-horizon loop, not a second scheduler or an unbounded graph
execution. Semi and Full determine when Robot Operator admits episodes. Task
State's existing action limit, coordinator preemption, Sleep, Reactive mode,
emergency stop, capability admission, bridge readiness, and physical validation
remain deterministic boundaries.

## Consolidation performed

- Deleted `etc/cognitive-graphs/robot-operator-mode.json` and its service,
  built-in-template, editor-template, and audio-routing references.
- Removed direct instruction dispatch and trigger-authored lifecycle contracts;
  planner dispatch accepts only the validated three-field decision.
- Removed the hidden minute-based autonomy limiter and stopped copying stale
  feedback/action context into new trigger cycles.
- Removed the undocumented `workflow.robot-observer` handler and requester
  alias; `workflow.boredom-observer` is now the sole observer admission name.
- Removed the static observer instruction injected by the execution engine.
- Removed the redundant thinking-strip node from Boredom Autonomy.
- Removed duplicate-plan and repetition policy; prior actions remain context for
  model judgment, not a deterministic anti-repetition block.
- Preserved the complete advertised capability catalog through planner and
  executor admission.
- Added the registered node property schemas required for the graph editor to
  display planner context, decision parser, dispatch, and model-router details.
- Added a strict model-facing motion-plan schema with the same joint bounds as
  physical validation. Invalid output is rejected; it is not clamped, retried,
  or converted into apparent success.

No queue, scheduler, store, lifecycle reducer, validator, service, retry path,
fallback, or compatibility layer was added.

## Acceptance evidence

Source-level acceptance requires:

1. all three planners contain their own persona/context/LLM/parser/dispatch path;
2. Observer makes no planner inference before a correlated image or result;
3. only Boredom Autonomy contains execution, Task State, buffer, and TTS nodes;
4. results re-enter Boredom Autonomy with the same episode correlation;
5. a new trigger starts without copied feedback or action context;
6. no legacy graph, alternate executor, hidden step limiter, direct dispatch,
   repetition policy, or stale registration remains;
7. graph validation, focused owner tests, applicable type checks, architecture
   checks, and `git diff --check` pass.

Live runtime and physical acceptance remain separate. Source checks cannot prove
that the configured LLM follows the JSON schema, the bridge returns a fresh
correlated frame, a servo moves, TTS finishes, or a user interruption stops an
already-dispatched physical action.

## Validation result

- Nine focused Robot Operator, planner/executor, Task State, parser, motion,
  bridge-correlation, and TTS test files pass.
- All 29 cognitive graphs validate, and all 280 graph nodes have registered
  executors.
- Core, Brain, and Site type checks plus the production Site build pass. Site
  type checking reports zero errors, warnings, or hints.
- Node defaults pass; Agent Monitor passes 69/69 checks.
- Architecture validation reports zero current violations. `./bin/audit check`
  passes with only the existing warning for the tracked Environment selector
  development corpus.
- The maintained-source inventory was refreshed at 1,587 maintained files and
  1,315 code files.
- No live LLM inference or physical robot action was used as validation.
