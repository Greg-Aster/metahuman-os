# Full Autonomy Workflow Owner Audit

Status: source repaired and validated on 2026-09-05; live-runtime and physical
evidence are recorded separately below.

## Ownership result

Full autonomy has one scheduling owner and one contextual decision path:

`Robot Operator -> Robot Autonomy Controller -> selected finite agent or Robot
Autonomy Executor -> Robot Action Result -> Robot Goal Review when needed`.

Robot Operator admits work through Work Coordinator. No graph schedules or
re-enters itself. The controller chooses from the canonical Agent Catalog; it
does not rotate choices. The Executor chooses at most one advertised action or
one generated body-local motion. Action Result records one later correlated
result. Goal Review owns the next semantic objective decision.

## Robot Autonomy Controller

| Node | One responsibility | Audit result |
| --- | --- | --- |
| `robot-input` | Read the correlated Robot Operator trigger | Kept |
| `observation` | Read saved Environment Bridge state and capabilities | Kept; saved data is not labelled current evidence |
| `image-input` | Select a valid triggering frame or the saved frame correlated to the latest Robot Status action result | Kept; it reports verified evidence separately from a triggering observation |
| `robot-status` | Load the canonical Robot Status snapshot | Kept |
| `conversation-history` | Load bounded recent dialogue including the latest user turn | Kept |
| `inner-history` | Load bounded private reflection | Kept |
| `robot-history` | Load canonical Robot Buffer action records | Kept |
| `persona-loader` | Load the active persona | Kept |
| `persona-formatter` | Format persona data for the model | Kept |
| `active-desires` | Load bounded active Agency desires | Kept |
| `autonomy-activity` | Load bounded terminal receipts for tasks previously selected by this controller | Added; this is execution history, not another scheduler or decision maker |
| `task-catalog` | Advertise configured, currently executable Agent Catalog tasks | Kept |
| `policy` | Supply the editable Full-autonomy decision instructions | Kept |
| `context` | Assemble the bounded controller evidence package and JSON contract | Kept; all sources are isolated inside one structured user envelope rather than masquerading as prior assistant speech |
| `llm` | Make one contextual choice | Kept; sole decision maker in this graph |
| `parser` | Validate the choice against the exact supplied catalog | Kept; Executor choices now structurally require an intention |
| `agent-dispatch` | Submit one selected finite catalog task | Kept |
| `executor-dispatch` | Submit one selected embodied intention to the Executor | Kept |
| `conversation` | Persist optional outward speech | Kept |
| `conversation-memory` | Capture optional speech through the existing memory owner | Kept |
| `tts` | Deliver optional speech through the existing TTS path | Kept |

## Robot Autonomy Executor

| Node | One responsibility | Audit result |
| --- | --- | --- |
| `robot-operator-input` | Read the delegated high-level intention and cycle | Kept |
| `intent-orchestrator` | Select the context/action routes useful for that intention | Kept; it neither rewrites nor executes the intention |
| `executive-policy` | Supply the editable one-consequence execution contract | Kept |
| `observation` | Load Environment Bridge facts for selected environment routes | Kept |
| `image-input` | Select valid triggering or Robot Status-correlated images | Kept |
| `conversation-history` | Load bounded dialogue when selected | Kept |
| `inner-history` | Load bounded private reflection when selected | Kept |
| `robot-history` | Load verified prior action outcomes when selected | Kept |
| `robot-status` | Load the canonical current snapshot when selected | Kept |
| `memory-router` | Retrieve semantic memory only when selected | Kept |
| `persona-loader` | Load the active persona | Kept |
| `persona-formatter` | Format persona data for the model | Kept |
| `autonomy-context` | Assemble selected evidence, capability meanings, and output contract | Kept |
| `autonomy-selector` | Choose one consequence from the supplied intention and capabilities | Kept; sole action chooser in this graph |
| `action-parser` | Validate the selected consequence | Kept |
| `movement-generator` | Generate a novel motion only for a selected movement request | Kept as the preset fallback branch |
| `bridge-out` | Send at most one selected action and end | Kept |
| `robot-buffer` | Record the outbound action | Kept |
| `robot-status-out` | Persist only the LLM-authored task/status change for this pass | Kept |
| `conversation-buffer` | Persist optional outward speech | Kept |
| `conversation-memory` | Capture optional speech through the existing memory owner | Kept |
| `tts-out` | Deliver optional speech through the existing TTS path | Kept |

## Robot Action Result

| Node | One responsibility | Audit result |
| --- | --- | --- |
| `observation` | Read the returned bridge observation | Kept |
| `action-context` | Match it to the sent Work Coordinator action | Kept |
| `feedback` | Select the terminal report for that action | Kept |
| `image` | Select correlated before/after camera evidence | Kept; its verified result now reaches the evaluator explicitly |
| `robot-input` | Read the correlated Robot Operator cycle | Kept |
| `robot-status` | Load Robot Status before interpretation | Kept |
| `policy` | Supply the editable result-interpretation contract | Kept |
| `context` | Assemble only matched result evidence | Kept |
| `llm` | Interpret the result once | Kept; sole semantic evaluator in this graph |
| `parser` | Validate the result decision | Kept |
| `status-out` | Save the result to canonical Robot Status | Kept |
| `conversation` | Persist optional result speech | Kept |
| `conversation-memory` | Capture optional speech through the existing memory owner | Kept |
| `tts` | Deliver optional result speech through the existing TTS path | Kept |

## Robot Goal Review

| Node | One responsibility | Audit result |
| --- | --- | --- |
| `robot-input` | Read the Goal Review cycle | Kept |
| `observation` | Read current bridge facts without fabricating current sight | Kept |
| `image-input` | Select valid triggering or latest-result camera evidence | Kept; a saved frame must match the current Robot Status action result |
| `robot-status` | Load the objective and latest recorded result | Kept |
| `conversation-history` | Load bounded dialogue including the latest user turn | Kept |
| `inner-history` | Load bounded private reflection | Kept |
| `robot-history` | Load verified prior action outcomes | Kept |
| `persona-loader` | Load the active persona | Kept |
| `persona-formatter` | Format persona data for the model | Kept |
| `active-desires` | Load bounded active Agency desires | Kept |
| `policy` | Supply the editable outcome-choice contract | Kept |
| `context` | Assemble the goal evidence package | Kept |
| `llm` | Choose complete, continue, wait, request, abandon, and/or speech | Kept; sole objective decision maker in this graph |
| `parser` | Validate the outcome and expose an intention only for continuation | Kept |
| `status-out` | Save the selected objective outcome | Kept |
| `prompt-out` | Delegate one continuation intention to the Executor | Kept |
| `conversation` | Persist optional review speech | Kept |
| `conversation-memory` | Capture optional speech through the existing memory owner | Kept |
| `tts` | Deliver optional review speech through the existing TTS path | Kept |

## Repaired owner defects

- Robot Operator admissions and their selected children now share one cycle ID.
  A child no longer rejects itself because its parent is still active.
- Model-backed Robot Operator work uses the configured local-model lane, so a
  parent decision finishes before its selected model-backed child begins.
- Saved observations remain available as context but are explicitly not current
  evidence. Real bridge arrivals alone carry current-observation provenance.
- Boredom Observer feeds its newly captured frame status to its planner instead
  of the stale trigger status.
- New explicit user turns retain user provenance in Robot Status even when they
  restate an existing objective.
- The production start/stop scripts target the maintained agent bootstrap path;
  the obsolete bootstrap process pattern is removed.
- The controller JSON schema requires a non-empty plain-language intention when
  it selects any downstream task, so the chosen specialist receives the reason
  it was selected without constraining which specialist the LLM may choose.
- Controller-selected task receipts are supplied as a separate bounded history;
  conversation and inner dialogue remain narrative context instead of proof that
  an agent or physical action ran.
- Robot Status and Robot Goal Review are lifecycle-owned work and are no longer
  advertised as ordinary controller choices. An unresolved correlated action
  result is still reviewed by the Robot Operator-owned lifecycle path.
- Action Result and Goal Review derive the current objective from canonical
  Robot Status. Their LLMs assess that objective but cannot silently rename or
  replace it in structured output.
- Outward speech is distinct from private lifecycle fields. `continue`, `wait`,
  and workflow labels belong to structured control output rather than the chat
  response field.
- A physical action or expression may leave `taskDecision` null; durable task
  state is written only when the LLM actually changes an objective.
- Saved camera evidence is admitted only when its action ID matches the latest
  terminal result in Robot Status. The absence of such evidence is no longer
  presented as a camera-health failure.

## Validation

- Focused Robot Operator, Robot Status, image-evidence, result-contract, and
  Desire-generation owner suites: pass.
- Root production build, including all workspace type checks, maintained test
  chain, and Site build: pass.
- Cognitive graph validation: 38 of 38 pass.
- Graph executor coverage: 344 nodes checked, none missing.
- Architecture guardrail: zero violations.
- Live runtime and physical behavior: pending the production build/restart run.
