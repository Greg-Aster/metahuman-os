# Environment Mode Performance

## Purpose

This document is the maintained paper trail for Environment Mode response-time work. It records measured behavior, architectural decisions, validation evidence, and remaining work. Performance changes must preserve persona quality, memory grounding, environment-action authorization, task lifecycle ownership, and evidence-based completion.

## Current Status

Source reconciled: 2026-09-03. Environment Mode has 20 nodes and 51 edges;
Robot Autonomy Executor has 21 nodes and 52 edges. Interactive Environment Mode
now begins with one route-only Intent Orchestrator and conditionally admits
memory, Robot Status, bridge, and image context before its existing Environment
Action Selector. Robot-originated turns may use the exact observation that
triggered the run. A typed chat turn never treats a saved bridge frame as current;
the selector may choose the advertised `captureImage` action when current vision
is needed. This source repair did not restart the application, exercise a
configured profile, contact the Environment Bridge, or run a physical robot.
The dated work log and validation record below remain historical evidence; they
are not a claim that the same commands or runtime results are current.

## Maintenance Rule

- Update this document whenever Environment Mode performance is measured, a performance-related architecture decision is made, or an implementation changes the LLM critical path.
- Record proposals as proposals and implemented changes as implemented changes. Discussion alone must not be represented as deployed behavior.
- Preserve measurements with their model, context, residency, and concurrency conditions so later comparisons remain meaningful.
- Keep system-model training data, evaluation artifacts, and runtime roles separate from profile-owned persona data and adapters.
- Do not turn this paper trail into a second configuration system. Runtime authority remains in maintained Core owners and checked-in configuration.

## Performance Contract

- Optimize the measured critical path before changing model quality.
- Do not bypass the cognitive graph or add keyword-based intent shortcuts.
- The Environment Intent Orchestrator owns only independent route switches. It neither rewrites the instruction nor chooses a response, command, or movement.
- The Environment Action Selector is the sole semantic output owner for each interactive turn. From the selected context routes, it may author conversation, select one exact advertised action, select one body-local movement request, or combine optional conversation with one action.
- The selector model must be vision-capable because one Environment decision owns both attached robot images and action selection. Movement Generator may generate a requested off-script motion plan only after the selector has already owned and typed the body-local movement request; it never reinterprets or overrides a selected action.
- The interactive workflow is split by responsibility: User Input supplies the unchanged instruction, Intent Orchestrator selects context and output routes, Environment Bridge Input supplies read-only bridge data with source provenance, Image Input admits only current-run frames, Context Builder creates one selector package, Action Parser validates the selector output, Environment Bridge Out transports an admitted action, and Robot Status Out persists the turn. Result correlation and interpretation remain in Robot Action Result.
- A user or autonomous input may produce a conversational response, one executable action, both, or an explicit failure diagnostic. Speech remains optional and is not evidence that an action executed.
- Correlated terminal feedback runs Robot Action Result once. Robot Status Out records that decision and result without applying a deterministic completion policy or re-entering the Environment workflow.
- Failed actions and incomplete external objectives remain in Robot Status for a later separately admitted Robot Goal Review. No action or result workflow loops itself.
- Fresh correlated images are admitted for current visual work. A claimed external change requires an ordered baseline and current frame; an absolute current-scene fact requires one current correlated frame.
- Raw correlated sensory observations remain available in graph state even when a particular LLM call does not process the image. Context admission controls model input, not sensor existence.
- The robot-mounted camera may evaluate the external scene but cannot prove the robot's own pose or dynamic body motion.
- Missing or malformed model output must produce an explicit diagnostic rather than silent suppression or a second LLM attempt.
- Model roles must reflect coherent responsibilities. Do not create an adapter or model assignment for every individual node or output field.
- Parallel execution may be introduced only for dependency-independent work. Action authority, task lifecycle, and stateful output ordering must remain explicit.

## Baseline

Measured from the 2026-08-04 Environment Mode turn `What did you dream about last night?`:

| Stage | Latency | Prompt tokens | Completion tokens |
|---|---:|---:|---:|
| Environment Context Router | 5,115 ms | 1,564 | 147 |
| Memory Relevance Interpreter | 2,437 ms | 305 | 171 |
| Environment Persona LLM | 3,544 ms | 3,882 | 171 |
| Non-LLM graph work | 285 ms | - | - |
| Total | 11,381 ms | 5,751 | 489 |

LLM calls consumed 11,096 ms, or approximately 97.5% of total graph time. The vector lookup took 43 ms. The final call also received an image even though the question did not require current visual evidence.

Historical warm Environment Mode turns before the recent task-contract expansion were approximately 2.5-4.0 seconds. A direct minimal Ollama probe measured approximately 3.0 seconds cold and 0.2 seconds immediately warm; approximately 2.9 seconds of the cold call was model loading. The configured Ollama keep-alive is five minutes.

## Current Architecture Findings

- Environment Mode currently has 20 nodes and 51 edges.
- Robot Status supplies bounded supporting self-context to the Environment
  Context Builder. It is not current sensory evidence, an action result, or
  proof of external state.
- The graph executor evaluates nodes in deterministic topological order, invokes
  only nodes whose declared branch conditions and required inputs are active,
  reports inactive nodes as skipped, and awaits active nodes serially.
- The work coordinator also serializes the broad `local-llm` resource lane with `maxConcurrent: 1` and a 2,000 ms cooldown between complete work items.
- Every interactive turn uses the profile's current Environment `orchestrator`
  assignment for the route-only Intent Orchestrator, then the current
  `environmentActionSelector` assignment for the selected response/action
  decision. These roles resolve through the normal profile model owner; neither
  graph instance hardcodes a model name.
- Memory search, Robot Status, Environment Bridge data, and camera-frame
  processing run only when their selected route is active. Environment Bridge
  Out runs only after the selector validates an action or movement request.
- A valid named command does not call Movement Generator. Off-script body-local
  motion adds Movement Generator only after the selector returns
  `movementRequest`.
- A robot-originated turn reuses its exact triggering frame when vision is
  selected. Typed chat may read saved bridge state and capabilities, but a saved
  frame is not admitted as current vision. If current vision is needed and the
  camera action is advertised, the Action Selector may request one capture; no
  phrase-specific capture rule exists.
- The retired Task Contract, Environment Task Input, Environment Task
  Preparation, Environment Task Reducer, Visual Evidence Assessor, Task
  Validator, Task Refiner, Workflow Command, result-correlation inputs,
  Environment Map input, Environment Chat output, debug viewer, and redundant
  Thinking Stripper are not present in interactive Environment Mode.
- The current source and checked-in graph contain this implementation. Loaded
  server state, profile-specific model resolution, bridge delivery, and physical
  robot behavior remain unverified by this documentation update.
- Ollama model unloading after five minutes adds an intermittent cold-start penalty.
- Graph serialization and coordinator serialization are MetaHuman policies, not hard Ollama limitations.

## Work Log

### 2026-09-02 - Robot Autonomy Executor parity and naming

Status: implemented in maintained source. Robot Autonomy Executor now queries
the existing profile semantic-memory index with the planner-authored instruction
and supplies up to three results above the configured 0.65 threshold to the
existing Robot Operator Context node. That node continues to deduplicate and
combine semantic results with memories explicitly delegated by a planner.

The workflow's visible name and policy terminology now use Robot Autonomy
Executor. The internal `boredom-autonomy` graph key remains stable so planner
configuration and already-issued correlated feedback continue through the same
canonical executor. Environment-specific UI output nodes were not copied into
the background workflow, and the dedicated Robot Operator input/context nodes
remain the correct replacements for interactive user input and context building.

Validation: all 26 cognitive graphs, the focused Robot Operator/Environment/
Robot Status suite, Environment selector corpus and regression tests, node
defaults, Agent Monitor, Core and site type checks, architecture, and the
user-agnostic guard passed. No application restart, live autonomous cycle,
Environment Bridge dispatch, or physical robot action was performed.

### 2026-08-23 - Direct autonomous vision and generic Task State evidence contract

Status: implemented and rebuilt locally. Focused Core suites, selector corpus/regression checks, all 28 cognitive graphs, and the production Astro build pass. A live local 384-token Qwen3.5-9B image probe produced strict valid selector output in 2,517 ms; Task State completed the no-action observation privately. No physical robot action was dispatched by that probe.

Implemented change:

- Route Boredom Observer's returned image directly to Environment Mode and delete its redundant preliminary LLM graph.
- Classify physical work with the generic `expression`, `information_gain`, or `task_effect` purpose. Task State preserves that contract through correlated feedback and normalizes information-gain work to bounded visual evidence.
- Skip post-action model inference for exact one-step action-result completion. Only objectives requiring new evidence return to the selector.
- Default autonomous output to private inner dialogue. Conversation Buffer, conversational telemetry, and TTS receive output only after explicit conversation admission.
- Queue familiarity matching after autonomous visual reasoning through the existing background semantic-search owner.
- Reduce the Environment prompt to 212 words. Task State, memories, and history each appear at most once; autonomous observations receive no conversation history; capability rules are generated only for advertised capabilities. The original 384-token selector budget was raised to 2,048 on 2026-09-01 after a valid custom-motion decision exhausted the smaller budget before completing its JSON.
- Add provider-native structured output for the shared Environment contract. Cross-field lifecycle consistency remains in Task State rather than a second validator model or graph.
- Retire the text-only 0.8B selector from runtime selection because it cannot accept the directly routed image and failed the revised output contract. The exact spiky-friend/head-tilt case is an evaluation-only regression and is excluded from development training data and runtime logic.

Measured local probes:

| Probe | Model | Budget | Result | Latency |
|---|---|---:|---|---:|
| Advertised `wave` | `qwen3.5:9b` | 384 | Strict valid `robotCommand`; Task State owns incomplete-until-feedback lifecycle | 7,354 ms |
| Autonomous attached image, no warranted action | `qwen3.5:9b` | 384 | Strict valid; private complete; no action | 2,517 ms |

The exact live failure text `The robot result arrived, but I could not determine a usable completion or next action.` was reproduced as an invalid-selector boundary failure. The new structured-output contract plus deterministic no-work completion removes that failure mode without scene-specific parsing or retries.

### 2026-08-06 - Dedicated Environment action selector

Status: runtime and Core contract implemented locally; focused tests, graph validation, architecture checks, user-agnostic checks, and the production site build pass. Qwen3.5-0.8B cv-004 fold training and development evaluation are complete and rejected for deployment. No model has been merged, installed, assigned to the live profile, or physically dispatched.

Implemented change:

- Replace the Environment graph's unconditional `persona` role call with the profile-configurable `environmentActionSelector` role.
- Reuse the Core Environment output contract: `response`, `actions`, `movementRequest`, and `taskDecision`. The specialist must return exactly those four fields and at most one action.
- Add one Core-owned validation/escalation gate. Valid specialist actions pass through unchanged. Explicit conversation escalation makes exactly one conversation-only general-model call. Invalid specialist output emits a visible failure and cannot authorize motion or silently fall through to the general model.
- Keep semantic interpretation in the specialist. Core performs only strict output/schema validation, exact advertised-capability matching, safety/motion-class checks, session correlation, Task State lifecycle, and completion validation. No alias, keyword, phrase-matching, or deterministic natural-language command helper was added.
- Give the specialist a bounded JSON environment envelope shared by runtime and system-owned training data. Persona content is excluded from the selector and supplied only to the explicit conversational escalation path.
- Keep Movement Generator off the advertised-command path. It receives work only from a specialist-selected `movementRequest` for genuinely off-script body-local motion.
- Remove the active 14-field classifier runtime and migrate registry ownership from `environmentRouter` to `environmentActionSelector`. The incompatible retired classifier artifact is not reused for the new contract.
- Preserve Task State as the only objective lifecycle owner. Exact correlated completion of the selected command closes without another model call; failures and incomplete evidence return to the same selector with one-step admission and a bounded ceiling.
- Admit no incidental camera image on a new turn. A fresh-vision request selects capture when no current correlated frame is available; the correlated capture continuation then admits the returned image when the persisted task requires visual evidence.

Model call paths:

| Turn | Previous active path | Implemented path |
|---|---|---|
| Advertised named command | `persona` -> profile 9B; optional downstream work | 0.8B selector only; zero 9B; zero Movement Generator |
| Simple non-action response | `persona` -> profile 9B | 0.8B selector only |
| Substantive conversation or complex non-action reasoning | `persona` -> profile 9B | 0.8B selector -> explicit typed escalation -> exactly one profile general-model call |
| Off-script body-local movement | 9B semantic selection -> Movement Generator | 0.8B selector owns `movementRequest` -> Movement Generator generates only the typed plan |
| Exact successful named-command feedback | Could be followed by another semantic pass when lifecycle fields disagreed | Task State deterministic closure; zero model calls |

Role assignment:

| Role | Model | Responsibility | Deployment state |
|---|---|---|---|
| `environmentActionSelector` | target `environment-action-selector-0.8b:v1`, trained from Qwen3.5-0.8B | Sole Environment semantic action selection and evidence decision | Training/evaluation pending |
| `persona` on explicit escalation | profile general model; Ainekio currently resolves to `qwen3.5:9b` | Substantive conversation only | Existing; not called on a valid action path |
| `orchestrator` in Movement Generator | profile-configurable general model | Generate a bounded motion plan from an already selected body-local request | Existing; not called for advertised commands |

Deployment measurements:

| Gate | Current evidence |
|---|---|
| Strict JSON | Pending retained-checkpoint behavioral evaluation |
| Core-contract validity | Pending retained-checkpoint behavioral evaluation; fixture validator coverage passes |
| False-positive physical authorization | Pending retained-checkpoint behavioral evaluation; invalid fixture outputs authorize zero motion |
| Exact action selection | Pending retained-checkpoint behavioral evaluation |
| Unnecessary vision admission | Pending retained-checkpoint behavioral evaluation; Core new-turn admission fixtures pass |
| Specialist latency and total graph latency | Pending merged-artifact canaries |
| Explicit escalation rate | Pending deployment evaluation |
| VRAM residency | Pending merged-artifact canaries |
| 9B and Movement Generator bypass | Source fixtures prove zero calls for valid named actions; live artifact proof pending |

The selected artifact must preserve Qwen3.5-0.8B visual input support because correlated image evidence can return to the same selector. Before profile migration, `ollama show` and sanitized image canaries must prove that the merged artifact advertises and accepts vision. A text-only GGUF is not deployment-ready for this graph.

### 2026-08-05 - Single-owner Environment workflow

Status: implemented locally; focused and wider robot/environment regression suites pass. The production site has not been restarted as part of this change.

Implemented change:

- Replace the classifier -> Environment LLM -> independent contract -> visual reviewer -> validator -> refiner -> queued continuation chain with one semantic Environment LLM and one typed task-state owner used in prepare/reduce phases.
- Remove active Context Router and generative Memory Relevance calls. Keep bounded vector memory retrieval, recent conversation, persona, map, state, advertised commands, TTS, chat, memory capture, Robot Buffer, Movement Generator, and Environment Bridge delivery.
- Persist `EnvironmentTaskState` with the admitted action: objective, phase, action step and ceiling, completion basis, motion class, visual evidence mode, baseline frame reference, and selected semantic action.
- Bypass model inference when exact matching terminal feedback reports `completed` and the persisted whole-objective basis is `action_result`.
- On a failed result or incomplete external objective, let the same Environment LLM either return the next advertised action immediately or report the limitation. No successor prompt or hidden workflow command is generated.
- Admit at most one physical action per objective step. A malformed or empty LLM result produces a visible diagnostic.
- Carry the exact terminal action ID and adapter command into the feedback instruction instead of reducing feedback to an untyped `done` message.
- Preserve a bounded in-process baseline frame and attach ordered before/after images for `visualEvidenceMode=comparison`. Reject a comparison completion claim when both distinct frames are unavailable.
- Remove the orphaned Task Contract, Visual Evidence Assessor, Task Validator, Task Refiner, and Workflow Command implementations and their obsolete test suites after reference checks.

Expected critical paths:

| Request | Model calls after consolidation |
|---|---:|
| General inquiry | 1 Environment LLM |
| Advertised named body command | 1 Environment LLM; exact completion closes deterministically |
| Off-script body-local motion | 1 Environment LLM + 1 Movement Generator |
| External visual/state objective | 1 Environment LLM for initial action + 1 Environment LLM per actual evidence/action cycle |

### 2026-08-05 - Retired classifier CV-004 closure

Status: historical evaluation complete; no final adapter was trained or deployed because the active single-owner Environment workflow no longer calls a Context Router or Environment Classifier.

- Four Qwen3.5-0.8B development folds were trained under `out/environment-classifier/training/qwen3.5-0.8b-cv-004`. Folds 0/1 and 2/3 ran as two parallel GPU pairs. Each process used approximately 2.45 GiB of compute VRAM and each fold completed in approximately 18-20 minutes, cutting four-fold wall time roughly in half without output collisions.
- Every retained epoch checkpoint was then evaluated on its isolated development fold, two evaluators at a time. Each evaluator used approximately 2.3 GiB of compute VRAM. The locked 16-case set was not read or generated during training, checkpoint evaluation, or selection analysis.
- The final-epoch aggregate was 1,940/1,942 strict JSON, 1,841/1,942 Core-valid, and 1,424/1,942 exact routes (73.3%), with 119 false-positive action hints, 49 unnecessary vision admissions, and 135 missed action hints. This exceeds the operator's 62.5% practical accuracy floor but is not a safe or consistent classifier result.
- Fold behavior was materially uneven. Fold 0 peaked at checkpoint 368 with 374/476 exact routes, zero false-positive action hints, and zero excess vision. Fold 1 checkpoint 543 reached 445/496 exact but retained 6 false-positive action hints and 18 excess-vision admissions. Fold 2 checkpoint 546 reached 388/486 exact with one false-positive action hint. Fold 3 never generalized acceptably; its final checkpoint produced 112 false-positive action hints and only 232/484 exact routes.
- A proposed cv-005 semantic-coverage expansion was not generated. The generator correctly stopped because the active graph has no `context-router` prompt, and the production classifier runtime has been deleted. Continuing to optimize an unused 14-field advisory model would not repair named-command execution or improve the active critical path.
- CV-004 adapters, predictions, and reports remain reproducibility evidence only. Active command accuracy and latency work belongs to the single Environment LLM's typed action selection and the deterministic Task State lifecycle, without restoring a parallel classifier or fallback semantic owner.

The older entries below are retained as historical evidence. References there to the Context Router, Visual Evidence Assessor, Task Validator, Task Refiner, or specialized classifier describe superseded designs, not the active graph.

### 2026-08-04 - Typed context admission

Status: implemented and focused validation passed.

Implemented change:

- Add `needsEnvironment` and `needsVision` to Context Router output.
- Keep `needsAction` as the existing action-authorization decision.
- Build lean conversation, environment-evidence, and full action/task prompt variants from those typed fields.
- Preserve full context as the fallback when the typed admission response is missing or malformed.
- Stop admitting correlated images solely because they exist.
- Compact the Context Router instruction and structured-output budget without removing routing or task-contract semantics.
- Prevent generic complexity escalation from becoming physical-action authority in Environment Mode. Other cognitive modes retain their existing complexity escalation behavior.

Controlled Context Builder measurements using one identical observation, persona, memory, and instruction:

| Admission route | Serialized characters | Approximate tokens | Images |
|---|---:|---:|---:|
| Conservative full fallback | 7,977 | 1,994 | 1 |
| Typed recollection | 1,114 | 279 | 0 |
| Typed current-state read | 1,616 | 404 | 0 |
| Typed environment action | 7,797 | 1,949 | 0 |

The typed recollection path was approximately 86% smaller than the conservative full fallback in this controlled comparison. The action route retained the full task and action contract as intended.

### 2026-08-04 - Lightweight model candidate

Candidate: `qwen3.5:2b`, downloaded through Ollama by the operator.

Status: benchmarked; not approved for live Context Router assignment.

The controlled suite compared both models on conversation, dream recollection, current-state reads, fresh vision, vision acquisition, movement, delegated intentions, and persisted visual tasks. Both used the same tightened production prompt, 8,192-token context, 256-token output limit, thinking disabled, and a fixed seed.

| Model | Cold total | Cold load | Warm median | Warm mean | Strict JSON | Exact expected routes |
|---|---:|---:|---:|---:|---:|---:|
| `qwen3.5:9b` | 4,716 ms | 2,743 ms | 2,155 ms | 2,031 ms | 8/8 | 7/8 |
| `qwen3.5:2b` | 3,209 ms | 2,263 ms | 1,129 ms | 1,114 ms | 8/8 | 4/8 |

The 9B model's one raw mismatch marked `needsEnvironment=false` for a delegated movement intention, but `needsAction=true` correctly forced the full environment/action context in Context Builder. It produced no unsafe effective admission error in the suite.

The 2B model was approximately 45% faster warm, but it produced material routing errors: it treated a current-state read as a new action, attempted new action routing despite existing fresh visual evidence, and classified requested robot movement as a generic environment action. It must not replace the 9B Context Router in its current form.

The first-ever 2B cold call took 13,992 ms, including 13,086 ms loading. A repeat cold load took 3,209 ms. Treat the first result as a one-time initialization/cache outlier and the repeat as the current steady cold measurement.

### 2026-08-04 - Simultaneous model residency and inference

Ollama kept both models fully resident on the GPU at an 8,192-token context:

| Model | Ollama-reported VRAM |
|---|---:|
| `qwen3.5:9b` | 8,816,927,360 bytes |
| `qwen3.5:2b` | 4,275,478,016 bytes |
| Total | 13,092,405,376 bytes |

A warm sequential pair took 2,912 ms. Issuing the same two requests concurrently took 2,485 ms, approximately 15% less wall time, but contention increased individual latency: the 9B call rose from 1,872 ms to 2,483 ms and the 2B call rose from 984 ms to 2,363 ms.

Conclusion: both models can remain resident and Ollama can execute their requests concurrently, but they share one GPU. Parallel inference is useful only for genuinely independent throughput work; it does not help the serial Router -> Memory -> Persona critical path.

### 2026-08-04 - Model specialization and LoRA architecture

Status: architectural direction recorded; no production role reassignment or model training has been performed.

Decision:

- Keep `qwen3.5:9b` as the primary model for persona response, complex reasoning, and planning.
- Develop a system-owned lightweight `environment_classifier` rather than using the persona or generic orchestrator role for context admission.
- Fine-tune `qwen3.5:2b` first because it has a measured local baseline. If it passes the expanded evaluation suite, train and benchmark the same task on `qwen3.5:0.8b` as a second candidate.
- Retain the model with the best validated balance of route correctness, action safety, latency, and out-of-distribution fallback behavior. Smaller size alone is not an acceptance criterion.
- Keep embedding retrieval on the existing dedicated embedding path. Evaluate `Qwen3-Reranker-0.6B` as a purpose-built replacement for generative memory-candidate relevance work before creating a memory-ranking LoRA.
- Keep action authorization, lifecycle invariants, schema validation, and conservative fallback in deterministic Core code. Learned models may classify intent but must not become the sole safety boundary.

LoRA conclusions:

- Multiple LoRAs over one 9B base reduce training and artifact cost and avoid storing several fully independent 9B bases.
- A LoRA changes behavior but does not avoid the base model's 9B forward pass. A 9B routing adapter therefore does not provide small-model routing latency.
- Use one adapter per coherent role, not one adapter per node or boolean field. The environment classifier should emit its related typed routing fields in one pass.
- An adapter is tied to the exact base model family and revision from which it was trained. A 9B adapter cannot be attached to the 2B or 0.8B base.
- Persona adapters remain profile-owned. System routing and ranking adapters must use sanitized, system-owned datasets and artifacts.
- Frequent multi-adapter serving is a runtime capability question. vLLM supports named per-request LoRA serving; Ollama supports model adapters through a Modelfile but requires exact base compatibility. Do not add a second backend solely to gain adapter switching without a measured system-level benefit.

Target responsibility split:

| Responsibility | Target owner | Status |
|---|---|---|
| Persona response, complex reasoning, planning | `qwen3.5:9b` | Current direction |
| Environment context admission | Fine-tuned `qwen3.5:2b`; evaluate `0.8b` afterward | Proposed and gated |
| Memory candidate retrieval | Existing `Qwen3-Embedding-0.6B` path | Existing |
| Memory candidate ranking | `Qwen3-Reranker-0.6B` candidate | Proposed evaluation |
| Action authority and task invariants | Deterministic `packages/core` owners | Required contract |

### 2026-08-04 - Graph and Ollama concurrency investigation

Status: current behavior confirmed; no concurrency settings or executor behavior changed.

MetaHuman scheduling findings:

- `packages/core/src/graph-executor.ts` creates one topological execution queue, removes one node at a time, and awaits that node before advancing. A single graph run therefore does not execute independent ready nodes concurrently.
- `etc/queue.json` configures the entire `local-llm` lane with `maxConcurrent: 1` and `cooldownMs: 2000`.
- User messages, Environment observations, dreams, reflection, curation, and several other local workflows share that lane. Only one complete local-LLM work item is admitted at a time.
- The two-second coordinator cooldown applies between complete work items. It does not add two seconds between the Router, Memory Interpreter, and Persona calls inside one already-running graph.

Ollama runtime findings:

- Ollama supports multiple resident models and concurrent requests when the requested model weights and contexts fit available VRAM.
- The live systemd service had `OLLAMA_CONTEXT_LENGTH=16384` and no explicit `OLLAMA_NUM_PARALLEL` or `OLLAMA_MAX_LOADED_MODELS` override. Ollama therefore used its documented default of one parallel request per model; the benchmark requests explicitly loaded both tested models with 8,192-token contexts.
- The live `/api/ps` state confirmed that `qwen3.5:9b` and `qwen3.5:2b` were simultaneously resident and fully allocated in VRAM at the time of inspection.
- One 9B request and one 2B request can execute concurrently because they are different resident models, but the measured contention sharply increased each request's individual latency.
- Increasing `OLLAMA_NUM_PARALLEL` multiplies context-memory requirements for a model. It should not be raised on this 16 GB GPU without a controlled VRAM and latency benchmark.

Concurrency direction:

- Do not make the whole cognitive graph concurrent with an undifferentiated `Promise.all`.
- If concurrency is implemented, replace single-node iteration with dependency-aware ready sets and run only nodes whose inputs are complete and whose side effects and ordering do not conflict.
- Preserve the causal Router -> retrieval/relevance -> Persona sequence where downstream prompts consume upstream decisions. The primary latency strategy for that path is fewer calls, smaller specialized models, and smaller admitted context.
- Do not simply raise the broad `local-llm` lane to two. That would allow unrelated background agents to contend with critical user chat.
- A future implementation should evaluate explicit model-role capacity, such as a serialized primary-model lane and a separate lightweight-classifier lane, while retaining one coordinator as the lifecycle owner.

### 2026-08-04 - Post-restart live validation

Status: the new admission build is live; ordinary conversation latency improved, but two correctness blockers were found before specialized-model training can begin.

Deployment verification:

- `apps/site/dist/server/entry.mjs` was built at 12:38 local time.
- The active `start.sh` and site server processes started at 12:45, after the build and after the context-admission source changes. These observations therefore exercised the new implementation rather than a stale server bundle.

Observed live turns:

| Instruction | Graph total | Router | Persona | Persona prompt | Persona image | Visible result |
|---|---:|---:|---:|---:|---|---|
| `How are you today?` | 3,991 ms | 1,983 ms | 1,978 ms | 1,165 tokens | Yes | Response returned |
| `How can I help you today?` | 3,808 ms | 2,047 ms | 1,745 ms | 1,167 tokens | Yes | Response returned |
| `Can you tell me what you see?` | 5,246 ms | 2,478 ms | 2,760 ms | 3,589 tokens | Yes | Response suppressed |
| `Tell me what you see` | 6,042 ms | 2,535 ms | 3,498 ms | 3,587 tokens | Yes | Response suppressed |

The two ordinary turns returned to the historical warm range and required only the Router and Persona calls because memory search was not admitted. However, both still sent an image to the Persona model. The first response consequently mentioned a low-light environment even though the user asked an ordinary social question.

Correctness blocker 1 - Robot Observer metadata bypasses typed vision admission:

- The coordinator adds an `environment-perception` Robot Observer cycle to every correlated `audio_utterance`.
- Context Builder currently treats the presence of any `robotObserver` metadata as sufficient to admit an image, independently of `needsVision`.
- This defeats the intended rule that an available image alone never admits vision for ordinary conversation.
- The repair must preserve explicit/autonomous Robot Observer image work while allowing typed `needsVision` to control ordinary user audio turns.

Correctness blocker 2 - direct visual answers are suppressed by a completion-basis mismatch:

- For both visual questions, the Persona produced the requested description and claimed that the current frame supplied sufficient evidence.
- The reconciled task required `visual_observation`, while the Persona labeled the delivered description with `completionBasis=response`.
- The independent Visual Evidence Assessor only runs when the Persona labels completion as `visual_observation`, so no assessment was produced.
- Task Validator consequently marked the objective unverified and suppressed the otherwise useful response.
- The repair must distinguish a one-shot response grounded in an already-admitted image from an ongoing task whose external visual stopping condition requires independent verification. It must not weaken visual verification for physical-task completion.

Immediate acceptance cases:

1. An ordinary audio conversation turn with a correlated camera frame must admit no image or environment description when typed admission says neither is needed.
2. A question answered directly from an already-present fresh frame must return the grounded response without authorizing a new action.
3. A physical or multi-step task that claims completion from a visual condition must still require exact correlated evidence and independent validation.
4. The four live cases above must be rerun after repair, followed by the broader route suite, before model training or concurrency changes proceed.

### 2026-08-04 - Vision admission and direct-response contract repair

Status: implemented, regression-tested, graph-validated, and production bundle rebuilt. That bundle was subsequently restarted; its live acceptance results are recorded below.

Architecture repair:

- Keep Robot Observer cycle metadata as lifecycle identity only. An `environment-perception` cycle attached to ordinary correlated audio no longer grants camera access.
- Permit the Robot Observer bypass only for canonical Boredom Observer work explicitly marked `requestedBy: boredom-observer`. All ordinary audio remains governed by typed `needsVision`; a validator-persisted visual objective remains governed by its task contract.
- Add the current observation as an explicit input to Environment Task Contract so validator-persisted whole-objective contracts remain authoritative on later feedback and observation passes.
- Reconcile task contracts in this order: validator-persisted contract, valid Environment task decision, then newly action-authorizing router fallback. A no-action read-only route can no longer overwrite Persona's direct-response contract with advisory `actionParams`.
- Centralize observation-to-task-contract decoding in one Environment helper consumed by Context Builder, Instruction Interpreter, Task Contract, Task Validator, and Visual Evidence Assessor. This removes five slightly different interpretations of the same metadata.
- Preserve exact correlated evidence and independent assessment for persisted physical or multi-step objectives requiring `visual_observation`. The direct-response correction does not bypass that validator path.

Regression evidence:

| Acceptance case | Result |
|---|---|
| Ordinary correlated audio with an available frame and `needsVision=false` | No image admitted |
| Typed current-frame request with `needsVision=true` | Correlated image admitted |
| Explicit Robot Observer visual work | Correlated image admitted |
| Direct current-frame description with no new action | Response remains visible |
| Persisted bounded task requiring visual completion | Persisted contract remains authoritative |

Focused Environment node suite passed 39/39. All 26 cognitive graphs validate, the architecture guard reports zero drift, the user-agnostic guard passes across 776 maintained runtime files, the voice-service ownership guard passes, conversation-memory compatibility passes, and the Astro production build completes with the repository's existing warnings.

The production bundle was rebuilt at 13:08 local time and the site was restarted at 13:20. The first post-repair measurements and the newly exposed one-shot action-completion defect are recorded below.

### 2026-08-04 - Post-restart one-shot action completion investigation

Status: live transport and image correlation confirmed; completion-contract ownership defect confirmed. The repair and validation are recorded in the next section.

Post-restart admission evidence:

- The 13:20 site restart loaded the rebuilt bundle.
- A subsequent ordinary `How are you today?` turn completed in 4,294 ms. Router latency was 1,950 ms, Persona latency was 2,101 ms, the Persona prompt was 357 tokens, and both calls reported `imageInput=false`.
- This confirms that ordinary correlated audio no longer bypasses typed vision admission.

Push-up completion trace:

1. At 20:21:22 UTC, `Can you do a push-up?` entered Environment Mode under correlation `audio:ainekio-01:3:2087`.
2. Context Router admitted the action but incorrectly classified the whole objective as `continuationPolicy=bounded` with `requiredCompletionBasis=visual_observation`. The graph consequently admitted an unnecessary initial image and persisted that contract with the action.
3. MetaHuman sent `robotCommand: pushup` as work item `task-1785874887137-ebdc9921`.
4. At 20:21:33.432844 UTC, the bridge returned terminal feedback `completed: done` for that exact action ID.
5. The same returned observation contained JPEG frame `ainekio-camera-27`, timestamped 20:21:33.426238 UTC. Its metadata included both the original audio correlation ID and completed action ID. The image was therefore neither dropped nor forgotten.
6. Persona consumed the image and correctly labeled its completion claim `action_result`, but the persisted `visual_observation` contract remained authoritative. Task Validator marked the action step complete but the whole objective incomplete and opened refinement.
7. Visual Evidence Assessor did not formally assess the image because it currently runs only when Persona itself labels `completionBasis=visual_observation`; the lifecycle record consequently reported `evidenceAssessment=null`.
8. Task Refiner then consumed the same image and generated a request for a clear, well-lit full-body view. A second Environment pass repeated that user-facing request.

The post-action frame shows only the robot's returned final state and cannot reliably prove that a dynamic push-up occurred during the preceding interval. For a one-shot body-owned named motion, correlated terminal action completion is the appropriate whole-objective evidence unless the user's objective states a separate visual stopping or verification condition. The completion image is still useful supporting context, but it must not silently turn every named motion into a visual-proof task.

Performance impact:

| Pass | Graph latency | LLM calls | Purpose |
|---|---:|---:|---|
| Initial push-up request | 4,739 ms | 2 | Route and execute |
| Correlated completion | 7,466 ms | 3 | Route, Persona, unnecessary refinement |
| Refined user request | 5,941 ms | 2 | Route and repeat missing-proof request |
| Total graph time | 18,146 ms | 7 | One one-shot motion plus failed closure |

Architecture implications:

- Context admission and whole-objective completion classification are currently overloaded into the same router response. The router's incorrect contract can override the Environment LLM's semantically correct one-shot `action_result` decision.
- Validator-persisted contracts must remain authoritative for genuinely bounded tasks, but a newly admitted one-shot action needs a trustworthy contract owner before persistence.
- Visual Evidence Assessor should key formal assessment from the required task contract and available correlated evidence, not solely from Persona's chosen completion basis.
- The repair must be capability- and contract-driven. Do not add a push-up phrase branch, keyword matcher, validator bypass, or unconditional trust of all terminal action results.

### 2026-08-04 - Task completion and selective sensory processing repair

Status: implemented, regression-tested, graph-validated, production bundle rebuilt, and subsequently restarted. Its live one-shot and bounded-task results are recorded below.

Architecture repair:

- Keep the existing Environment Task Contract -> Visual Evidence Assessor -> Task Validator lifecycle. No parallel task-completion system or command-specific branch was added.
- Make completion ownership explicit: a validator-persisted contract wins on every later observation; a valid Environment task decision owns a newly admitted objective; Context Router `actionParams` are fallback data only when that decision omitted a usable contract.
- Tighten the Context Router contract so one advertised robot motion without a separate stopping or verification condition is `continuationPolicy=none` with `requiredCompletionBasis=action_result`. A distinct visual stopping condition remains `bounded + visual_observation`.
- Preserve the full correlated observation, including `visual` and `visuals`, in Context Builder's typed graph context even when `needsVision=false`. Only the LLM message image parts and serialized prompt observation are excluded on that call.
- Preserve the graph's direct observation/frame/image paths to downstream evidence owners. The robot is not made blind when Persona image admission is false.
- Trigger Visual Evidence Assessor from the authoritative `requiredCompletionBasis=visual_observation` contract when completion is claimed, rather than trusting Persona's self-reported `completionBasis` to decide whether assessment runs.
- Allow a supported exact-frame assessment to establish the effective `visual_observation` completion basis in Task Validator. Missing, stale, uncertain, or rejected assessment still blocks completion and may open bounded refinement.
- Close a one-shot motion only from exact correlated terminal `completed` feedback under a persisted `none + action_result` contract. The available completion image remains supporting sensory context; it neither blocks the motion nor independently proves that a dynamic motion occurred.

Regression evidence:

| Acceptance case | Result |
|---|---|
| Ordinary turn with a correlated frame and `needsVision=false` | Image excluded from LLM input; frame retained in graph context |
| Router proposes `bounded + visual`, Environment decision says one-shot `none + action_result` | Environment contract retained |
| Environment decision omits a usable contract | Router contract used as fallback |
| Later pass carries a validator-persisted visual contract | Persisted contract remains authoritative |
| One-shot motion returns exact terminal completion plus a correlated image | Objective completes once; response remains visible; no refinement |
| Visual-required objective is mislabeled `action_result` by Persona | Independent assessor still runs; supported exact frame completes as visual evidence |
| Visual-required objective lacks supported exact-frame evidence | Completion remains blocked with `visual_completion_unverified` |

Focused Environment lifecycle tests pass 42/42. All 26 cognitive graphs validate, architecture guard reports zero drift, user-agnostic guard passes across 776 maintained runtime files, voice-service ownership passes, environment conversation-memory compatibility passes, and the Astro production build completes with existing unrelated warnings. Repository-wide Core type checking still reports its known unrelated baseline errors and reports no diagnostic in a file changed by this repair.

The production bundle was rebuilt at 13:42 PDT and then restarted before the live acceptance traces below.

### 2026-08-04 - Live one-shot success and bounded visual-condition failure

Status: one-shot completion accepted; genuinely bounded visual completion failed and reached the eight-step limit. This section records the pre-repair diagnosis; the implemented repair is recorded immediately below.

One-shot acceptance:

- `Please do a push-up` ran under correlation `audio:ainekio-01:3:2811`.
- The persisted contract was correctly `continuationPolicy=none` with `requiredCompletionBasis=action_result`.
- One robot command was issued. Exact correlated terminal `completed: done` closed the objective once with `completionVerified=true`, a visible completion response, no evidence assessment, and no refinement.
- The interaction used two Environment graph runs totaling 15,075 ms: 10,486 ms for admission/action and 4,589 ms for correlated completion.

Bounded visual-condition failure:

- `Please do a push up until you see my hand and then stop` ran under correlation `audio:ainekio-01:3:2959` while the user was holding up a hand.
- This objective contains a separate visual stopping condition, but the initial task persisted `continuationPolicy=bounded` with the semantically incorrect `requiredCompletionBasis=action_result`.
- Every action completion returned exact correlated terminal feedback and a JPEG. Frames `ainekio-camera-40` through `ainekio-camera-46` carried both the original cycle correlation and their exact action IDs. Sensor transport and frame correlation therefore worked.
- Because the authoritative contract required `action_result`, Visual Evidence Assessor never formally evaluated the hand condition; every lifecycle record reported `evidenceAssessment=null`.
- The image was nevertheless available to later graph work. At validator step 4, the persisted Task Refiner reason explicitly stated that the user's hand was clearly visible in the current frame, corroborating the user's report. The workflow still issued another push-up instead of closing the visual objective.
- Refinement also drifted the original sensor-owned condition from `until you see my hand` into `until I explicitly signal you to stop`, incorrectly changing the evidence semantics and actor roles while retaining `requiredCompletionBasis=action_result`.
- The cycle issued seven robot commands and executed 14 Environment graph runs totaling 90,955 ms. It stopped only at `step_limit`, after repeatedly emitting the same dark/obstructed-view message.

Confirmed architecture gap:

- Contract validation is currently structural, not semantic. A syntactically valid new-task contract can persist an evidence basis that contradicts a separate condition in the objective.
- Blindly preferring either Context Router or Persona is insufficient: the earlier one-shot defect came from an overly visual router contract, while this bounded failure persisted an overly action-result contract.
- The next repair must reconcile new-task contract classifications without keyword branches, preserve the original objective's typed stopping condition through refinement, and make contract disagreement observable in lifecycle telemetry.
- Once a bounded objective requires visual completion, the exact correlated frame must reach Visual Evidence Assessor and a supported assessment must close the objective. Task Refiner must not replace that condition with an invented user-input requirement or reissue an action after supported evidence.

### 2026-08-04 - Bounded visual stopping-condition repair

Status: implemented, regression-tested, graph-validated, production bundle rebuilt, and restarted. Live physical acceptance is recorded immediately below.

Architecture repair:

- Keep the existing Environment Task Contract -> Visual Evidence Assessor -> Task Validator -> Task Refiner chain. No command-specific branch, phrase matcher, second completion system, or bridge bypass was added.
- Split new-task contract responsibility by typed concern. Environment task decision continues to own `none` versus `bounded`, protecting accepted one-shot `none + action_result` motions. When both Environment task decision and Context Router classify the objective as bounded, Context Router's independent whole-objective evidence classification is selected. This converts the observed `bounded + action_result` disagreement into `bounded + visual_observation` without making the earlier one-shot router error authoritative.
- Preserve typed provenance on the reconciled decision with `taskContractSource` and the complete model/router disagreement in `taskContractConflict`. Task Validator includes both in lifecycle telemetry so future misclassification is observable instead of silently persisted.
- Evaluate a required visual stopping condition after every exact correlated terminal `completed` step, not only when Persona first claims completion. Frame selection requires the current cycle and, when terminal feedback provides one, the exact completed action ID; an earlier frame from the same multi-step cycle cannot prove the current step. The assessor therefore sees the hand frame even if Persona says the condition was missed.
- Let a supported, valid assessment bound to the current correlated frame establish effective visual completion in Task Validator. It closes the objective, suppresses further refinement, and sends the assessor's evidence-grounded completion response over the existing bridge output.
- Keep unsupported, uncertain, missing, stale, or mismatched frame evidence incomplete. Those results retain the existing bounded refinement and hard step-limit behavior.
- Make the original objective, evidence basis, actors, ownership, sensor, and stopping condition immutable inputs to Task Refiner. A visual stopping condition cannot be rewritten as an explicit instruction or `user_input` requirement.
- Add a deterministic refiner invariant: supported visual completion is terminal and cannot enter refinement even if an upstream regression emits an invalid request.

Regression evidence:

| Acceptance case | Result |
|---|---|
| Environment decision says `none + action_result`, Router says `bounded + visual` | One-shot Environment decision retained; disagreement recorded |
| Both classifiers say bounded but disagree on `action_result` versus `visual_observation` | Bounded Router evidence classification selected; disagreement recorded |
| Later pass carries validator-persisted contract | Persisted contract remains authoritative |
| Completed bounded action, Persona says incomplete, exact frame supports the visual condition | Assessor runs; objective completes; no refinement; evidence-grounded response remains visible |
| Earlier frame shares the cycle but belongs to a different action ID | Earlier frame ignored; current terminal action frame assessed |
| Completed bounded action and exact frame does not support the visual condition | Objective remains incomplete and enters bounded refinement |
| Supported visual evidence is accidentally presented to Task Refiner | Refiner skips without an LLM call |
| Refiner receives a genuine incomplete visual task | Exact objective, actor roles, sensor, stopping condition, and evidence basis remain in its immutable system boundary and workflow command |

Focused Environment lifecycle coverage passes 48/48. All 26 cognitive graphs validate, the architecture guard reports zero drift, the user-agnostic guard passes across 776 maintained runtime files, all build-owned speech/service checks pass, and the Astro production build completes with the repository's existing warnings. Repository-wide Core type checking retains its unrelated baseline errors and reports no diagnostic in an Environment file changed by this repair.

The production bundle was rebuilt at 14:24 PDT. The subsequent bounded wave acceptance confirmed terminal closure and exposed the remaining evidence-precision issue recorded below.

### 2026-08-04 - Live bounded wave acceptance and remaining evidence-precision issue

Status: contract reconciliation, exact-frame assessment, and terminal lifecycle behavior passed live. Visual Evidence Assessor was too conservative on one frame that it explicitly described as containing a hand, causing avoidable retries. No follow-up code change has been made yet.

Live trace:

- `Please wave until you see my hand, then stop.` ran under correlation `audio:ainekio-01:4:2845` from 21:28:48.028 through 21:30:38.906 UTC.
- The initial Environment decision returned `bounded + action_result`; Context Router returned `bounded + visual_observation`. The then-current reconciler selected the router's visual-evidence basis and retained the disagreement in lifecycle telemetry. That independent semantic override has since been removed: the Environment LLM owns a new task's semantic contract, while validator-persisted lifecycle state remains authoritative on later passes.
- The exact current terminal-action frames were assessed on every completed wave step. Verdicts were: `ainekio-camera-19` unsupported, `ainekio-camera-20` unsupported, `ainekio-camera-22` uncertain, `ainekio-camera-23` unsupported, and `ainekio-camera-24` supported.
- On `ainekio-camera-24`, Task Validator completed at step 6 with `completionVerified=true`, `completionBasis=visual_observation`, no blocked reason, no admitted follow-up action, and no refinement. The user received one final `I see your hand, so I will stop waving.` response.
- The four repeated blurry/dark updates were four distinct bounded refinement attempts following four non-supported frame assessments, not duplicate delivery of one response.
- The cycle issued five finite wave commands and ran ten Environment graph passes. Aggregate graph time was 75,825 ms, command time was 24,032 ms, and end-to-end wall time was 110,878 ms.

Remaining precision issue:

- The assessor described `ainekio-camera-22` as showing a close-up of a hand but returned `uncertain` because it could not verify a clear view of the whole user. The objective required the robot to see the presented hand; it did not require whole-user identity verification.
- Some earlier reasons also required both a visible hand and visible waving motion in the same frame. The completed action result already proves the current finite wave step; the visual assessor owns only the separate stopping condition.
- The next refinement should tighten the existing assessor prompt and regression contract so it evaluates only the objective's visual stopping predicate. It must not require simultaneous visual proof of the completed action, full-body framing, or stronger ownership/identity evidence than the objective states.

Disposition: on 2026-08-04 the operator accepted the current bounded visual behavior as good enough for now. The precision refinement and another physical bounded-motion retest are deferred; they are not active blockers for performance work.

## Specialized Training Direction

A purpose-trained lightweight router is feasible, but it should be a system model, not a persona adapter. The existing adapter dataset lane is profile-owned and persona-oriented; reusing personal memory training for system routing would violate the user-agnostic boundary.

The appropriate path is:

1. Build a sanitized, system-owned routing dataset from synthetic envelopes and reviewed decisions covering every context/action/task invariant.
2. Use the 9B router as a teacher only where its output passes deterministic contract validation, then review edge cases manually.
3. Fine-tune the 2B base model with LoRA or QLoRA for the exact structured routing schema.
4. Hold out conversation, recall, state, vision, movement, delegated-intention, persisted-task, contradiction, and ambiguous-input suites for evaluation.
5. Require strict JSON, route parity, zero unsafe action-authority errors, conservative fallback, and latency improvement before live assignment.
6. Initially fall back to the 9B router for invalid output, contract conflicts, ambiguous input, and high-risk action cases.
7. Export the validated adapter/model for Ollama and register it under an explicit system role such as `environment_classifier`; do not overload the persona or generic orchestrator roles.
8. Reuse the established corpus and evaluation harness to train the 0.8B candidate. Promote it only if it matches the accepted 2B behavior under the same held-out tests.

### Direct-Vision Acceptance Procedure

Priority 1 is a short live verification checkpoint, not a new refactor. Its purpose is to confirm that the repaired direct-vision path produces visible, grounded answers without admitting image context or robot actions when they are unnecessary.

Run these three cases against the restarted production workflow:

| Case | Prompt / setup | Required result |
| --- | --- | --- |
| Ordinary-message control | `How are you today?` | `needsEnvironment=false`, `needsVision=false`, `needsAction=false`; Persona receives no image; one visible response; no scene details leak into the answer. |
| Fresh-frame visual read | With a fresh correlated bridge frame available, ask `Tell me what you see right now.` | `needsEnvironment=true`, `needsVision=true`, `needsAction=false`; Persona receives one current correlated image; one visible grounded response; no robot command, duplicate response, or visual-task refinement. |
| Frame-acquisition visual read | Keep the robot bridge connected, but submit `Tell me what you see right now.` through the site's text input instead of the robot microphone. In the current live setup the microphone path supplies a correlated camera frame with each utterance; the text path is the non-destructive way to exercise a request that begins without one. | The graph requests exactly one `captureImage`, consumes the returned correlated frame, and produces one visible grounded response; it must not recapture, repeat the answer, or enter a refinement loop. |

For each case, record the correlation ID, Context Router decision and latency, total graph latency, Persona prompt-token count and `imageInput` state, robot command count, visible response count, and final completion state.

The checkpoint passes only when all three cases behave as specified. If a case fails, diagnose that exact owner path before changing the router dataset. If all three pass, close priority 1 and use the accepted traces as ground truth for the expanded classifier corpus in priority 2.

### 2026-08-04 - Direct-Vision Live Acceptance, Partial

Status: ordinary-message admission and fresh-frame visual response passed. Frame acquisition remains untested because both visual prompts arrived through the microphone with their own fresh, exactly correlated camera frames.

| Prompt / correlation | Router | Persona | Graph | Commands | Lifecycle result |
| --- | --- | --- | ---: | ---: | --- |
| `How are you today?` / `audio:ainekio-01:8:258` | 2,060 ms; 1,666 prompt tokens; no image | 1,638 ms; 357 prompt tokens; `imageInput=false` | 3,711 ms | 0 | One visible response; `none + response`; completion verified; no refinement |
| `Tell me what you see right now` / `audio:ainekio-01:8:406` | 2,485 ms; 1,690 prompt tokens; no image | 2,714 ms; 3,607 prompt tokens; `imageInput=true` | 5,216 ms | 0 | One visible grounded response; `none + response`; completion verified; no refinement |
| Repeated visual prompt / `audio:ainekio-01:8:559` | 2,129 ms; 1,715 prompt tokens; no image | 2,963 ms; 2,408 prompt tokens; `imageInput=true` | 5,105 ms | 0 | One visible grounded response; `none + response`; completion verified; no refinement |

All three incoming observations contained a fresh exact-correlation frame: `ainekio-camera-5`, `ainekio-camera-6`, and `ainekio-camera-7`. The ordinary turn retained its raw sensory observation in graph state but correctly excluded it from Persona input. Both visual turns admitted their current frames and returned once without sending a robot command.

The first visual trace also preserved a useful classifier disagreement: the Environment decision selected `none + response` while the routed advisory contract selected `none + visual_observation`. Existing Task Contract ownership resolved this correctly as a direct response with no action or refinement. Retain this trace as a held-out disagreement case for priority 2 rather than adding a special-case rule.

The live audit records router latency, tokens, and downstream admission behavior but does not persist the router's serialized `needsEnvironment`, `needsVision`, and `needsAction` object. The effective ordinary and visual routes are confirmed by Persona `imageInput`, bridge command count, and task lifecycle output; the missing serialized route is an observability limitation, not evidence of a functional failure.

Priority 1 remained open for the text-input frame-acquisition case. The subsequent failed trial and its concrete owner seam are recorded below.

### 2026-08-04 - Text-Input Frame Acquisition Exposed Cross-Task Feedback Contamination

Status: failed acceptance. The requested capture itself succeeded; an unrelated earlier expired Robot Observer capture was admitted into the new typed objective and forced an unnecessary refinement pass.

Trace:

1. Manual Robot Observer cycle `c03b9aab-243e-46d2-9c56-67a3c9ceb3b9` queued `captureImage` command `task-1785882411894-e1bea2d5` at 22:26:51 UTC. It expired before dispatch at 22:26:59 with `action_expired_before_dispatch`.
2. That expiration was published as the latest observation for session `ainekio-01` and processed as its own Environment turn.
3. The user submitted the separate typed objective `tell me what you see right now` at 22:27:17. The then-current combined observation/interpreter path selected the typed message as authoritative but also preserved the prior observation's terminal feedback. That path was retired on 2026-09-02 in favor of explicit User Input, Environment Bridge Input, and Instruction Resolver nodes.
4. Action Parser treats any terminal feedback in the effective observation as belonging to the current pass. It therefore suppressed the new capture action. Task Validator interpreted the unrelated expiration as the current objective's failed prior attempt, opened refinement, and emitted the misleading visible response `My previous attempt ... expired`.
5. The refined lifecycle `environment-validator-b7e4f52d-6e61-4b0d-b241-8642e07c98b0` then issued exactly one new `captureImage`, command `task-1785882458471-aa956e8a`, at 22:27:38. The bridge completed it normally at 22:27:42 and returned exact correlated frame `ainekio-camera-10`.
6. The final pass verified the visual evidence and produced the grounded scene description at 22:28:04.

Performance and acceptance result:

- Initial contaminated pass: 7,055 ms.
- Refined capture pass: 9,969 ms.
- Returned-frame validation and response pass: 21,430 ms.
- End-to-end from typed request admission to completed response: approximately 47.1 seconds.
- One relevant capture command was sent and succeeded, but the interaction produced three visible responses instead of one final response.
- This fails the frame-acquisition acceptance gate because the new objective inherited unrelated terminal state and entered avoidable refinement.

Confirmed repair boundary:

- Do not increase the image-acquisition deadline; the capture for this objective completed in approximately 4.5 seconds inside its existing 10-second deadline.
- Preserve the latest raw environment state and sensory data, but admit terminal feedback to action parsing and task validation only when its action/cycle lineage belongs to the current persisted objective.
- A new typed objective must not inherit an unrelated terminal result merely because that result is present in the session's latest observation.
- Keep this correction on explicit owner edges: User Input supplies the interactive instruction; Robot Operator Input supplies autonomy instructions; Environment Bridge Input makes read-only adapter observations and diagnostics available; Core resolves robot-reported action IDs against Work Coordinator records and Verify Matched Sent Action rejects a missing or mismatched result; Find Finished Robot Report for Sent Action selects the matching finished robot report; Select Camera Frames for Current Action chooses valid current or before-and-after camera frames; Context Builder packages the data for the selector; Robot Status Out persists the validated decision and result. Graph edges select which outputs each workflow consumes. Do not add a second feedback store, a prompt phrase branch, or a camera-specific retry shortcut.

Disposition: the operator chose not to pursue this repair during the current performance pass. The defect and its remaining acceptance retest are deferred; they do not block classifier corpus work.

### Next Performance Deliverable - Environment Classifier Gold Corpus

The next active step is to replace the one-off eight-case comparison with a maintained, repeatable, system-owned classifier benchmark. This stage does not assign a smaller model live and does not modify action authority.

Ownership and structure:

- Put system classifier datasets and evaluation tooling under a dedicated `brain/training/environment-classifier/` lane. Do not reuse the profile/persona adapter dataset pipeline.
- Reuse one Core-owned Context Router output contract and validator from the runtime path; do not copy a second JSON schema into the benchmark.
- Keep every case synthetic or sanitized. No profile names, personal memories, runtime images, tokens, local absolute paths, or raw conversation-buffer records belong in the corpus.
- Keep deterministic action and lifecycle safety checks in Core. The model is evaluated as a classifier, not treated as the safety boundary.

First milestone:

1. Author 64 manually reviewed gold cases covering ordinary conversation, semantic recall, current environment state, fresh-frame vision, missing-frame acquisition, one-shot motion, bounded visual stopping conditions, delegated intentions, persisted task contracts, classifier disagreement, unavailable capabilities, ambiguous input, and hostile/stale conversation history that must not authorize action.
2. Freeze 16 cases as a held-out evaluation set before training. The remaining 48 cases are the development set and seed material for later training-data expansion; held-out cases must never enter training.
3. For each case, store the complete Context Router input envelope and exact expected routing fields: memory admission, environment admission, vision admission, action authority/type, continuation policy, and required completion basis.
4. Build one harness that runs the same cases against `qwen3.5:9b`, baseline `qwen3.5:2b`, and later trained candidates. It must report schema validity, exact route parity, action-authority errors, vision over-admission, latency, and token counts by suite and model.
5. Save a machine-readable result plus a short human-readable comparison. Any unsafe action-authority error is an automatic failure; aggregate accuracy may not hide it.

Completion gate: the corpus is reviewed, the held-out split is locked, the harness is repeatable, and the 9B/2B baselines are recorded. Only then begin the `qwen3.5:2b` classifier fine-tune.

### 2026-08-04 - Gold Corpus and Dual-Model Baseline Complete

Status: milestone complete. None of the three baseline models cleared the live-assignment gate.

Implemented ownership:

- `packages/core/src/environment-classifier.ts` now owns the Environment Context Router decision type, strict validator, JSON parser, and exact safety-relevant route view. The Environment Orchestrator consumes this validator from Core, and the training lane imports it through the public `@metahuman/core/environment-classifier` export.
- `brain/training/environment-classifier/corpus.json` contains 64 synthetic system-owned cases: 48 development and 16 held out. It contains no user/profile records, runtime images, local absolute paths, or persona LoRA material.
- `held-out.lock.json` freezes the held-out ids and recursively canonicalized case contents. Locked digest: `f439401d8aa6716981c2c1d49063f28bc7a106e840540f74e0291d9c905d176c`.
- `benchmark.ts` loads the active `context-router` prompt from the Environment graph, uses the same Core contract for both models, runs models sequentially, excludes one reported warm-up, and writes detailed JSON plus a short Markdown report under `out/environment-classifier/`.
- Exact route parity covers memory admission, environment admission, vision admission, action authority/type, continuation policy, and required completion basis. Full 14-field output validity is measured separately. Any false-positive `needsAction` or non-`none` action type is counted as an unsafe action-authority error.

Coverage includes ordinary conversation, semantic memory, state reads, fresh-frame vision, missing-frame acquisition, one-shot movement, visually bounded work, delegated action decisions, persisted lifecycle contracts, ambiguity, unavailable capability, classifier disagreement, and stale/history evidence that must not authorize work.

Final current-prompt baseline:

| Model | Split | JSON valid | Core contract valid | Exact route | Unsafe action errors | Unnecessary vision | Median latency | Prompt tokens | Completion tokens | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `qwen3.5:9b` | all 64 | 64/64 | 62/64 | 36/64 (56.3%) | 9 | 5 | 2,240 ms | 57,041 | 8,944 | FAIL |
| `qwen3.5:2b` | all 64 | 64/64 | 53/64 | 20/64 (31.3%) | 24 | 10 | 1,175 ms | 57,041 | 9,446 | FAIL |
| `qwen3.5:0.8b` | all 64 | 57/64 | 45/64 | 0/64 (0.0%) | 23 | 28 | 813 ms | 57,041 | 9,652 | FAIL |
| `qwen3.5:9b` | held out 16 | 16/16 | 15/16 | 10/16 (62.5%) | 1 | 1 | 2,135 ms | 14,307 | 2,229 | FAIL |
| `qwen3.5:2b` | held out 16 | 16/16 | 16/16 | 6/16 (37.5%) | 5 | 3 | 1,177 ms | 14,307 | 2,400 | FAIL |
| `qwen3.5:0.8b` | held out 16 | 14/16 | 12/16 | 0/16 (0.0%) | 6 | 9 | 813 ms | 14,307 | 2,409 | FAIL |

The 2B model reduced median warm routing latency by approximately 47.6% relative to 9B, but its action-authority and vision-admission regressions make it unsafe for live routing. It remains a training candidate only. Neither the 9B nor 2B baseline missed an expected action; their dominant safety problem is over-authorization.

The untrained 0.8B model reduced median latency by approximately 63.7% relative to 9B and 30.8% relative to 2B, but it did not produce one exact route. It also missed two required actions, emitted seven non-JSON responses, produced 23 unsafe action-authority errors, and over-admitted vision 28 times. Its speed is useful enough to retain it as a later training candidate, but its raw behavior is substantially below the live gate.

The 9B/2B machine and human reports are `out/environment-classifier/benchmark-2026-08-04T23-08-24-097Z.json` and `.md`. The 0.8B reports are `out/environment-classifier/benchmark-2026-08-04T23-23-36-115Z.json` and `.md`. All fingerprint corpus digest `0579cc482dd67b17da81cccc48b5bfdd0ac388889bff872bb036d3e25d09a028` and active prompt digest `ea61199b93ea5c91f95563d164855b1a181ffa4ebc4ad40d020cbc6357cb4ce3`. An earlier exploratory run was not adopted as the baseline because the active graph prompt changed during the work; the recorded runs each loaded the same current prompt and locked corpus.

Acceptance result: corpus, lock, reusable harness, and all three raw-model baselines are complete. Neither small model is assigned live. The next active work is development-only 2B fine-tuning from the 48-case split plus separately authored training expansions; the 16 locked cases remain evaluation-only.

### 2026-08-04 - Development Training Corpus Ready

Status: dataset generation and the local 2B training entrypoint are complete. The first GPU run described below proved the training pipeline, but a later routing-contract change made that checkpoint pre-drift rather than deployable.

- `development-training.jsonl` contains 480 deterministic training records: 10 controlled variations for each of the 48 development cases. No held-out case id is a training source.
- The records preserve the exact active Context Router system/user messages and train the complete 14-field Core-validated response as one output. Prompt rendering is shared with the benchmark rather than copied.
- The original run-001 variations exercised instruction casing/spacing, irrelevant state telemetry, JSON key ordering, stale uncorrelated frames, completed prior actions, future conditional instructions, stale instruction state, and combined distractors. The current run-002 dataset replaces invented telemetry keys with reordered existing state/capability keys plus stale or future conversation, action-history, and frame evidence.
- Coverage includes 100 positive robot-movement records so safety training does not suppress legitimate action, plus 340 negative action-authority records and 340 negative vision-admission records.
- The run-001 manifest fingerprinted the corpus, 48-case development split, then-current held-out lock, active prompt, and generated records. Its historical dataset digest was `6867744ff18af34da47fa8cb50bade4ebd14b2e4963e585c77f4e55bb68551e3`; the current run-002 fingerprints are recorded in the migration section below.
- `training-qwen3.5-2b.json` uses the original trainable `unsloth/Qwen3.5-2B` weights in BF16 with a rank-16 system adapter. Artifacts are confined to `out/environment-classifier/training/`; the profile/persona adapter pipeline is not used.
- The shared Unsloth trainer now accepts exact per-record system/user messages without changing legacy instruction/input datasets. Qwen3.5 selects Unsloth's maintained `FastModel` API and native SDPA instead of forcing the old global eager-attention fallback.
- The first model-load preflight exposed a stale local training dependency: `transformers 4.57.1` predates the `qwen3_5` architecture. The maintained setup now requires Transformers 5.x; this is isolated to the Python training environment and does not alter the Node/Ollama runtime.

Training acceptance remains unchanged: do not deploy or train 0.8B unless the 2B candidate produces 100% strict JSON, 100% Core-contract validity, exact held-out route parity, zero unsafe action-authority errors, zero vision over-admission, and materially lower latency than 9B.

### 2026-08-04 - First 2B LoRA Training Run and Serving Decision

Status: the development-only training pipeline completed successfully. The resulting adapter is not approved for deployment and the 0.8B stage has not started.

Training evidence:

- Base: `unsloth/Qwen3.5-2B`, using original trainable BF16 weights rather than an Ollama GGUF.
- Dataset: 480 records derived only from the 48 development cases; held-out digest remained `f439401d8aa6716981c2c1d49063f28bc7a106e840540f74e0291d9c905d176c`.
- Adapter: rank 16, alpha 32, 10,911,744 trainable parameters out of 2,224,153,408 total parameters, approximately 0.49%.
- Run: 3 epochs, 180 optimizer steps, 418.5 seconds of trainer runtime and approximately 7.6 minutes for the complete launch-to-artifact pipeline.
- Loss: approximately 3.007 at the start, 0.009084 at the final logged step, and 0.3366 aggregate training loss. This proves optimization occurred; training loss is not acceptance evidence.
- System-owned safetensors artifacts are under `out/environment-classifier/training/qwen3.5-2b-run-001/`, including checkpoint 120 and the final adapter. No profile/persona adapter location was used.

Serving findings:

- Ollama 0.20.7 accepted Modelfiles referencing the converted Qwen3.5 LoRA, but model initialization failed with `loras are not yet implemented`. A merged GGUF fallback was started and then deliberately stopped because it duplicates the full base and is inferior to the repository's existing native LoRA serving path.
- The repository's vLLM owner already supports PEFT safetensors adapters through named `--lora-modules`; no profile discovery or duplicate adapter registry is needed for this system benchmark.
- The installed vLLM 0.18.1 registry recognizes `Qwen3_5ForConditionalGeneration`. Evaluation must load the exact 2B base used for training; the configured 9B AWQ vLLM base cannot accept a 2B adapter.
- The shared benchmark now supports `--provider ollama|vllm` and uses wall-clock latency as the provider-neutral timing measure. It retains one corpus, one Core validator, one prompt renderer, and one report format. The deployment gate now correctly fails on unnecessary vision admission as well as unsafe action authorization.
- Do not keep independently loaded Ollama and vLLM models active on this 16 GB GPU during acceptance measurements. An idle Ollama daemon is harmless, but loaded weights compete for the same VRAM. The repository's operational backend switch already follows the single-active-runtime rule.

Contract-drift finding:

- The training artifact captured prompt digest `ea61199b93ea5c91f95563d164855b1a181ffa4ebc4ad40d020cbc6357cb4ce3` at 16:44 local time, and the first adapter finished at 17:06.
- At 17:16 the active Environment Context Router gained a required `actionParams.motionClass` contract and a new prompt digest, `557b5f84ac8c85e0e8a253f4c329d4f91c4b56c04e49c75e4ce858fc8c349c68`.
- The dataset drift test now fails intentionally because the checked training messages no longer equal the active prompt. The current Core classifier validator and gold route view also do not yet require or compare `motionClass`, so evaluating the old checkpoint as if it represented the new routing contract could produce a false pass.
- The first adapter is therefore a pipeline-proof artifact only. Before a deployment evaluation, reconcile `motionClass` in the single Core routing contract and gold expectations, version the held-out lock only as an explicit contract migration, regenerate development-only training data, and retrain 2B. Do not expose held-out cases to that regeneration or retraining.

### 2026-08-04 - `motionClass` Contract Migration and Second 2B LoRA Evaluation

Status: the active routing contract, corpus, generated development data, and training artifacts are aligned again. The second 2B run proves the corrected train/serve/evaluate pipeline, but no checkpoint passes deployment acceptance and the 0.8B stage remains blocked.

Contract and data migration:

- `packages/core/src/environment-classifier.ts` now validates `actionParams.motionClass` through the Environment Interface's existing `body_local`, `open_loop_displacement`, and `target_relative` values. A newly authorized `robot_movement` requires a valid motion class; newly authorized non-robot actions may not invent one. The safety route view compares this field instead of introducing a duplicate benchmark schema.
- The gold corpus and held-out lock are version 2 solely because the active contract changed. The 16 held-out ids remain locked and evaluation-only; no held-out case contributed a training record or prompt edit.
- Current fingerprints: corpus `229abd06ee095065796b5fbb58d03cda1a80f08afd47d0b3323c5464eabf91ad`, held out `6735070303a1bf95e64aca7bca35c4007fc29e614ce3bcd42c49b0b88a7194f6`, Context Router prompt `557b5f84ac8c85e0e8a253f4c329d4f91c4b56c04e49c75e4ce858fc8c349c68`.
- Regeneration produced 480 records from the 48 development cases, including 100 positive robot-action records. Dataset digest: `2cf16c1baa490b357d79488399bcce2944e45c6e985e31b475d27bda69f21cd6`.
- Run 002 used the same BF16 `unsloth/Qwen3.5-2B` base and rank-16 adapter shape for 3 epochs/180 steps. All epoch checkpoints were retained. Trainer runtime was 324.5 seconds and complete launch-to-artifact time was approximately 5.9 minutes. Logged loss fell from approximately 3.046 to 0.008589; aggregate training loss was 0.3412.

Held-out checkpoint result through native vLLM LoRA serving:

| Checkpoint | JSON valid | Core contract valid | Exact route | Unsafe action errors | Unnecessary vision | Missed actions | Median latency | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Step 60 | 16/16 | 1/16 | 1/16 | 0 | 0 | 1 | 3,922 ms | FAIL |
| Step 120 | 16/16 | 15/16 | 6/16 | 0 | 0 | 5 | 3,972 ms | FAIL |
| Step 180 | 16/16 | 6/16 | 2/16 | 0 | 0 | 6 | 3,503 ms | FAIL |

Step 120 is the best checkpoint from run 002, but it only matches 37.5% of held-out routes. It removed the raw 2B model's unsafe-action and excess-vision errors on this set by becoming overly conservative: five legitimate actions were missed. One response also misspelled the required `memoryQuery` field as `memoryQueries`. Later training degraded contract validity and exact routing, so final training loss did not predict generalization.

Serving and latency interpretation:

- The report is `out/environment-classifier/benchmark-2026-08-05T01-06-09-393Z.json` with its companion `.md` file.
- The unadapted 2B base under the same vLLM path measured 4,380 ms median and produced only 1/16 strict JSON responses, 0/16 Core-valid responses, and 0/16 exact routes. This control confirms the LoRA changed behavior, while also showing that most of the latency belongs to this vLLM/base-model serving combination rather than adapter switching.
- Run-001 LoRA controls measured approximately 4,867-4,935 ms median. Run 002 improved that vLLM latency, but its best checkpoint is still slower than both the 2B Ollama baseline at 1,177 ms and the 9B Ollama baseline at 2,135 ms.
- vLLM reserved KV cache during the run, but live utilization stayed below 1% for these sequential requests. Reducing the reservation merely to lower displayed VRAM use would not repair the measured latency and is not a current objective.
- The vLLM benchmark server was stopped after measurement. Ollama remains idle with no resident model, and the GPU compute allocation was released.

Acceptance decision: do not deploy run 002 and do not start 0.8B training. The next training revision must be designed and selected using development-only validation. Held-out results remain a final pass/fail gate and must not become examples or prompt-tuning material.

### 2026-08-04 - Semantic Development Expansion and Compact Candidate Pivot

Status: the development-only selection lane is repaired and the current model candidate is Qwen3.5-0.8B. The locked held-out set has not been used for this selection work.

Development-data correction:

- The 480-record Qwen run-002 dataset had only 48 distinct instruction surfaces. Most of its ten variations changed serialization order, whitespace, or stale context rather than meaning, so it mainly taught formatting invariance and did not establish semantic generalization.
- The current generated dataset contains 1,720 system-owned records from the same 48 development source cases. Each case now has its canonical instruction plus four curated semantic paraphrases, for 240 instruction surfaces before controlled context variation.
- Four source-case folds prevent paraphrases or context variants of one case from leaking across training and development validation. Fold record counts are 420, 440, 440, and 420; each fold contains 12 complete source cases and all routing suites.
- Coverage includes 700 positive action-authority records and 1,020 negative records, including 500 positive robot actions. It emphasizes false authorization, excess vision, ambiguity, stale instructions, state queries, persisted contracts, and matching legitimate movement.
- The specialized input contains only the current instruction, current environment, and last four conversation messages. Routing policy is learned rather than resending the long general Context Router manual on every call. The dataset digest is `dbbd5208e277d2f3f96c11b0c4a5b57b8d82f9d1fca05bbe7a6ae86c247f521f`; the held-out digest remains `6735070303a1bf95e64aca7bca35c4007fc29e614ce3bcd42c49b0b88a7194f6`.

Candidate decision:

- Qwen and LoRA are no longer assumed. The target is the smallest specialized model that clears the same safety, accuracy, and latency gates.
- A short FLAN-T5-base pipeline probe was rejected as the deployment direction. Its older tokenizer maps JSON braces to an unknown token, which made strict JSON generation impossible without vocabulary surgery. The probe used development fold 0 only, never read held-out model inputs, and its temporary trainer was removed from the maintained source lane.
- FunctionGemma 270M was considered because it is purpose-built for function calling, but the official weights require accepting a gated license. The project declined that dependency. Its temporary trainer, config, package command, and Core tool projection were removed so there is no dormant second training architecture.
- The current candidate is `unsloth/Qwen3.5-0.8B`, using the same Qwen/Unsloth/vLLM integration already proven by the 2B experiments. The upstream Qwen weights are Apache 2.0. The raw Ollama artifact previously measured 813 ms median, but failed routing accuracy and safety; specialization must repair behavior without surrendering that latency advantage.
- The 0.8B lane uses the repository's existing Unsloth LoRA trainer, full BF16 base weights, a rank-16 system-owned adapter, the compact router input, and four source-case-isolated development folds. Persona and profile adapters remain outside this lane.
- `packages/core/src/environment-classifier.ts` remains the only 14-field decision contract and validates every model response before the graph can act. The training lane contains targets, not a duplicate schema.

This model is not accepted yet. Run the fold-0 preflight, train fold 0, inspect Core-scored development errors, then complete the remaining development folds only if the pilot is credible. Only one selected checkpoint may be evaluated on the 16 locked cases. Deployment still requires 100% strict JSON, 100% Core validity, exact held-out routing parity, zero unsafe action authorization, zero excess vision, and latency materially below the 9B baseline.

### 2026-08-05 - Qwen3.5-0.8B Development Fold-0 Pilot

Status: rejected before full cross-validation. The 16 locked cases were not read or invoked. Folds 1-3 were not trained because no fold-0 checkpoint cleared the development safety gate.

Training design and runtime:

- The pilot used the Apache-2.0 `unsloth/Qwen3.5-0.8B` BF16 weights with a rank-16, 6,389,760-parameter system adapter. The base has 859,375,680 parameters; 0.74% were trainable.
- Fold 0 held back 420 controlled records from 12 complete source cases. Training used 1,300 records from the other 36 source cases. Source-case ids, semantic paraphrases, and context variants never crossed the fold boundary.
- The initial launch was stopped before its first checkpoint after confirming that the shared trainer still computed loss over prompt tokens. The maintained run uses response-only masking: a measured 238-token sample had only its 77 JSON-answer tokens trainable.
- Three epochs produced checkpoints 163, 326, and 489 in 14.1 minutes. Development generation and scoring brought the complete pilot to approximately 20.6 minutes. Validation loss was 0.09562, 0.09919, and 0.10424, so the trainer restored checkpoint 163 as its best-loss adapter.
- Checkpoint evaluation is now development-locked and repeatable through `evaluate:environment-classifier:checkpoint`. It refuses held-out ids, requires fold provenance, and writes the existing Core scorer's prediction format.

Development results:

| Checkpoint | JSON valid | Core valid | Exact route | Full output exact | Unsafe action | Excess vision | Missed action | Robust source cases | Median latency | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 163 / best loss | 420/420 | 403/420 | 233/420 | 96/420 | 48 | 0 | 6 | 1/12 | 813 ms | FAIL |
| 326 | 420/420 | 418/420 | 296/420 | 143/420 | 18 | 0 | 36 | 1/12 | 830 ms | FAIL |
| 489 | 420/420 | 419/420 | 289/420 | 134/420 | 12 | 0 | 46 | 2/12 | 821 ms | FAIL |

Interpretation:

- Specialization repaired strict JSON and eliminated vision over-admission on this fold. It also raised exact routing far above the untrained 0.8B baseline, but did not approach deployment accuracy.
- Later epochs reduced unsafe authorization while sharply increasing false refusals. Training loss therefore optimized common output tokens without reliably preserving the action decision boundary.
- The best exact-route checkpoint was 326, not the lowest validation-loss checkpoint. This confirms that generic language-model loss cannot select this safety-sensitive router by itself.
- Failure clustering is structural. Checkpoint 326 was perfect on the two conversation cases, the state case, the one-shot movement case, and the authority case, but it missed 36/50 legitimate visual-capture actions, made unsafe decisions on fresh-vision, delegated, persisted-contract, and ambiguity cases, and never preserved the completed persisted contract exactly.
- A fold-support audit found one safety-relevant route stratum absent from each fold's training side. For fold 0, no training record combined `needsAction=false`, `actionType=none`, `motionClass=body_local`, and `requiredCompletionBasis=action_result`; all 30 examples of that combination belonged to the held-back `persisted-003` source. The other unsupported strata are persisted `user_input`, persisted `environment_state`, and one-shot `open_loop_displacement` in folds 1, 2, and 3. Asking the model to extrapolate unseen contract combinations makes the current cross-validation design unsuitable for selection.

Decision: retain the open Qwen integration and measured speed, but reject this dataset/config as a deployment training recipe. Before any second run, add controlled route-changing counterfactuals under the existing 48 development source cases so every fold's training side covers every safety-relevant validation stratum. Add a guard that fails generation when a fold has an unsupported route stratum. Then repeat fold 0 only. Do not train the remaining folds or inspect held-out cases until that repaired pilot is credible.

### 2026-08-05 - Route-Stratum Repair and Viable 0.8B Pilot

Status: the repaired fold-0 pilot is viable and clears the revised aggregate accuracy target. It is not deployed and the 16 locked cases remain untouched.

Dataset repair:

- Thirteen controlled counterfactual route surfaces were added under the existing development source cases: persisted-contract terminal states, open-loop one-shot motion, bounded body-local motion, fresh visual evidence, and missing visual evidence. The 102 derived records remain attached to their original source case and fold, so no semantic family crosses a fold boundary.
- The generated development dataset now contains 1,822 records: 1,062 negative action-authority records, 760 positive action-authority records, and 520 positive robot-action records. Fold sizes are 446, 466, 456, and 454.
- Generation now fails if any validation route view is absent from that fold's training side. This removes the unsupported-route flaw found in the first pilot without duplicating the Core contract or using held-out examples.
- Dataset digest: `7e115f3127b4e66eb374c843e868fc95ba4087c59d9d19517adde231308cf5d5`. The held-out digest remains `6735070303a1bf95e64aca7bca35c4007fc29e614ce3bcd42c49b0b88a7194f6`.

Repaired fold-0 run:

- Run root: `out/environment-classifier/training/qwen3.5-0.8b-cv-002`.
- Fold 0 used 1,376 training records from 36 source cases and 446 validation records from 12 isolated source cases. The same BF16 Qwen3.5-0.8B base, rank-16 adapter, compact input, response-only loss, and three-epoch recipe were retained.
- Training completed 516 optimizer steps in 14.9 minutes. Validation generation brought the full pipeline to 21.5 minutes. Epoch validation losses were 0.08625, 0.09413, and 0.1013.
- Generic validation loss selected epoch 1, but Core routing metrics selected epoch 3. This operational selection rule is now locked before running folds 1-3.

Development results:

| Checkpoint | JSON valid | Core valid | Exact route | Full output exact | Unsafe action | Excess vision | Missed action | Median latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 172 / best loss | 446/446 | 442/446 | 346/446 (77.6%) | 199/446 | 12 | 0 | 57 | 775 ms |
| 344 | 446/446 | 445/446 | 365/446 (81.8%) | 213/446 | 20 | 0 | 50 | 775 ms |
| 516 / epoch 3 | 446/446 | 446/446 | 374/446 (83.9%) | 216/446 | 4 | 0 | 49 | 775 ms |

Interpretation:

- Epoch 3 is the first checkpoint to combine 100% strict JSON, 100% Core-contract validity, zero excess vision, materially better-than-9B routing accuracy, and sub-second median inference in this development fold.
- Its four unsafe decisions are all variants of `delegated-004`; they are one remaining decision-boundary cluster rather than errors spread across the corpus. Its 49 missed actions are confined to the fresh-versus-missing visual pair: 10 under `fresh-vision-001` counterfactuals and 39 under `vision-acquisition-001`.
- Median batch inference was 775 ms, p95 was 931 ms, and mean was 791 ms on the RTX 4080 evaluator. The 9B Ollama held-out reference was 2,135 ms median, although provider differences still require final runtime benchmarking.
- The user revised the practical exact-routing acceptance floor from 100% to meeting or beating the original 9B held-out 62.5%. Physical-action false positives and missed legitimate actions remain separate reported measures and may not be hidden inside aggregate accuracy.

Decision: lock epoch 3 as the checkpoint policy and complete folds 1-3 without further corpus or prompt tuning. Aggregate the four development folds before selecting or training a final artifact. Do not use the 16 held-out cases until that development decision is complete.

Cross-validation completion:

- Fold 1 trained 1,356 records and held back 466 records from 12 different source cases. Training completed 510 optimizer steps in 14.6 minutes; epoch losses were 0.08216, 0.09936, and 0.1038.
- Epoch-3 checkpoint 510 produced 466/466 strict JSON and 466/466 Core-valid responses, but only 274/466 exact routes (58.8%). It made 13 unsafe decisions, admitted no excess vision, and missed 100 legitimate actions. This fold is below the revised 62.5% accuracy floor.
- Failure concentration is explicit: `movement-003` missed 50 actions, `delegated-001` missed all 50 actions, and `bounded-003` matched only 12/50 routes. The 13 unsafe decisions were confined to fresh-vision and vision-acquisition source families. Conversation, two state cases, and ambiguity were perfect.
- The original post-training generation path reused training compilation state and failed. It was removed from the training owner; retained checkpoints are now evaluated only by the separate checkpoint evaluator.
- The evaluator then exposed an installed-Unsloth compiled-generation limit after 56 calls. The maintained evaluator now uses Unsloth's supported `UNSLOTH_COMPILE_DISABLE=1` eager mode, set before import. It completed all 466 records without retry chunks or an enlarged compiler cache and reduced batch median to approximately 400 ms. Stable fold-wide prompt padding is also retained.
- Fold 2 trained 1,366 records, held back 456 records from 12 source cases, and completed 513 optimizer steps in 15.2 minutes. Epoch-3 checkpoint 513 produced 455/456 strict JSON, 445/456 Core-valid responses, 407/456 exact routes (89.3%), zero unsafe actions, zero excess vision, and 13 missed actions. Eager batch median was approximately 436 ms.
- Fold 3 trained 1,368 records, held back 454 records from the remaining 12 source cases, and completed 513 optimizer steps in 15.7 minutes. Epoch losses were 0.12875, 0.13856, and 0.13914. Epoch-3 checkpoint 513 produced 454/454 strict JSON, 433/454 Core-valid responses, 193/454 exact routes (42.5%), 71 unsafe actions, 19 excess-vision admissions, and one missed action. Eager batch median was approximately 473 ms.
- Fold 3's unsafe errors are concentrated rather than random: capability questions were treated as capture commands, unavailable vision was treated as capture authority, terminal persisted-contract variants were treated as continuing actions, and some ambiguous object instructions were treated as executable. This is a material generalization weakness even though the aggregate accuracy clears the revised floor.

Final-epoch cross-validation aggregate:

| Fold | Records | JSON valid | Core valid | Exact route | Unsafe action | Excess vision | Missed action | Median latency |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 446 | 446/446 | 446/446 | 374/446 (83.9%) | 4 | 0 | 49 | 775 ms |
| 1 | 466 | 466/466 | 466/466 | 274/466 (58.8%) | 13 | 0 | 100 | 400 ms |
| 2 | 456 | 455/456 | 445/456 | 407/456 (89.3%) | 0 | 0 | 13 | 436 ms |
| 3 | 454 | 454/454 | 433/454 | 193/454 (42.5%) | 71 | 19 | 1 | 473 ms |
| **Aggregate** | **1,822** | **1,821/1,822** | **1,790/1,822** | **1,248/1,822 (68.5%)** | **88** | **19** | **163** | **462 ms** |

- The authoritative report is `out/environment-classifier/training/qwen3.5-0.8b-cv-002/development-validation-final-epoch.json`, with the companion Markdown report beside it. The scorer's `final-epoch` policy reads the highest evaluated checkpoint file inside each fold and records every selected path; it does not copy outputs or define another contract.
- The exact-route aggregate exceeds the user-approved 62.5% practical floor and median generation remains materially below the 9B Ollama reference. Strict JSON and Core validity are close to, but not at, 100%.
- Aggregate accuracy does not erase the 88 unsafe action errors or 19 excess-vision admissions. The final adapter may be trained as the selected development candidate, but it is not deployment-approved. Its one-time locked evaluation must report these measures independently.
- Final training now requires the selected cross-validation report as explicit evidence. The adapter provenance records the report digest, policy, accuracy, unsafe-action count, excess-vision count, current dataset digest, prompt digest, and held-out digest. It trains on all 1,822 records from the 48 development source cases with no synthetic validation split and no held-out model input.
- A pre-held-out integration audit found that the provider-neutral benchmark still defaulted to the full graph prompt while the specialized adapter was trained on compact messages. Core now owns `buildEnvironmentClassifierMessages`; generated training input, live Environment Router inference, and specialized benchmarking all use that function. The benchmark retains an explicit graph format for historical baselines and uses `--message-format compact` for the adapter. Dataset regeneration preserved digest `7e115f3127b4e66eb374c843e868fc95ba4087c59d9d19517adde231308cf5d5`, proving the ownership repair did not change the final adapter's training messages.
- The final evaluator uses the existing Core vLLM lifecycle and provider-neutral harness. It writes a one-shot receipt immediately before the first held-out request; both completed and failed receipts prevent accidental reuse of the 16 locked cases.

Final adapter training:

- Run root: `out/environment-classifier/training/qwen3.5-0.8b-final-001`.
- The final adapter used all 1,822 development records from all 48 development source cases. It used the selected BF16 Qwen3.5-0.8B base, rank-16 adapter, response-only loss, and three epochs for 684 optimizer steps. No validation or held-out model input was supplied to the trainer.
- Trainer time was 20.1 minutes and complete launch-to-artifact time was 20.6 minutes. Aggregate training loss was 0.09544. Training loss is optimization evidence only; the locked result remains the acceptance evidence.
- The safetensors adapter and checkpoints 228, 456, and 684 are under `out/environment-classifier/training/qwen3.5-0.8b-final-001/final/adapter/`. The final provenance records the selected four-fold report and current dataset, prompt, and held-out fingerprints.
- The evaluator dry run validated the final artifact and one-shot guard without sending a held-out model request. The live MetaHuman site subsequently restarted its selected Fold-2 vLLM classifier on port 8000. The final evaluator correctly refused to replace that active server implicitly.

One-shot locked evaluation:

| Model | Cases | JSON valid | Core valid | Exact route | Unsafe action | Excess vision | Missed action | Median latency | P95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Final Qwen3.5-0.8B LoRA | 16 | 16/16 | 15/16 | 12/16 (75.0%) | 0 | 0 | 1 | 3,890 ms | 4,866 ms |

- MetaHuman OS was stopped for an isolated runtime window. The one-shot evaluator started the final adapter through the existing Core vLLM lifecycle, wrote its receipt immediately before the first held-out request, completed all 16 requests, and stopped vLLM. The receipt is `out/environment-classifier/training/qwen3.5-0.8b-final-001/final/locked-evaluation-receipt.json`.
- The final adapter exceeds the user-approved 62.5% exact-route floor and improves the original 9B result from 10/16 to 12/16. It also removes the 9B baseline's one unsafe-action error and one excess-vision admission.
- The candidate is not deployment-ready. One response was strict JSON but used stale non-contract fields (`complexityLevel` and `responseLength: balanced`), one memory request was missed, one legitimate frame-acquisition action was missed, and one bounded movement selected the wrong motion class. These locked errors are acceptance evidence only and must not be used for prompt tuning or training.
- vLLM median latency was 3,890 ms, materially slower than the original 9B Ollama reference of 2,135 ms. The 0.8B adapter therefore proves that a small specialized model can beat 9B routing accuracy and safety, but this vLLM execution mode does not yet meet the speed objective.
- The authoritative reports are `out/environment-classifier/training/qwen3.5-0.8b-final-001/final/locked-evaluation/benchmark-2026-08-05T19-30-14-255Z.json` and `.md`. The completed receipt prevents a second held-out run.

Runtime simplification findings:

- Ollama can remain installed as one inference owner without holding a model in memory. During the isolated check its `/api/ps` list was empty; the idle `ollama serve` daemon used approximately 54 MiB host RAM, 0 GPU VRAM, and 0.2% CPU.
- The final 0.8B adapter's vLLM EngineCore used approximately 2,544 MiB compute VRAM during compiled-mode initialization. Total GPU use was 3,453 MiB including the desktop and unrelated display processes.
- Removing `--enforce-eager` did not produce a benchmark. vLLM 0.18.1 failed during compiled LoRA initialization with an `IndexError` in `lora_model_runner_mixin` / `column_parallel_linear.set_lora`. The development-only run emitted no model responses and never touched the locked set.
- The local Ollama artifacts are approximately 6.59 GB for `qwen3.5:9b` and 1.04 GB for `qwen3.5:0.8b` before runtime KV/cache overhead. A merged and quantized 0.8B classifier is therefore the simpler deployment experiment: one Ollama daemon, one 9B general model, and one approximately 1 GB specialist model rather than a second Python/vLLM service.
- Merging the rank-16 LoRA removes the runtime adapter mechanism and allows the ordinary quantized model path. It does not change the 0.8B network's amount of inference computation, but it can remove LoRA-layer overhead and unlock runtime optimizations that the installed vLLM LoRA path cannot use.
- A full 0.8B fine-tune is not a speed optimization. It would train more parameters, require more compute and stronger overfitting controls, and still execute the same 0.8B architecture after merging/quantization. Consider full fine-tuning only if future development-only evidence shows that LoRA capacity, rather than runtime, is the limiting factor.

Merged Ollama development benchmark:

| Runtime artifact | Cases | JSON valid | Core valid | Exact route | Unsafe action | Excess vision | Missed action | Median latency | P95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Merged Qwen3.5-0.8B Q4_K_M | 48 development | 47/48 | 47/48 | 47/48 (97.9%) | 0 | 0 | 1 | 461 ms | 550 ms |

- The final rank-16 adapter was merged into its exact `unsloth/Qwen3.5-0.8B` base, converted with the installed Unsloth llama.cpp toolchain, stripped of the Qwen3.5 MTP speculative head through the converter's official `--no-mtp` option, and quantized to Q4_K_M. The deployable GGUF is 529,297,184 bytes and its SHA-256 is `817e1f1ba9ca14c65cdb990364ecbf90811ca96d160d353721c0836ebf61de8d`.
- A generic conversion that retained the MTP head was not usable: Ollama rejected its extra block because it did not contain the ordinary Qwen3Next attention projections. The corrected artifact has 24 text layers and no MTP block; no model-weight surgery or duplicate routing contract was introduced.
- The Ollama registration must preserve Qwen3.5's official `RENDERER qwen3.5` and `PARSER qwen3.5` metadata. Without them the model repeated partial objects to the output limit. With them, the same artifact returned the trained 14-field object and completed the 48-case development run normally. The maintained exporter now owns these directives.
- One bounded target-relative task emitted malformed nested `actionParams`, producing the only invalid, Core-invalid, inexact, and missed-action result. Ollama's generic JSON mode reproduced the same failure and added latency, so it was tested but not adopted as a substitute for the Core validator.
- The authoritative development report is `out/environment-classifier/training/qwen3.5-0.8b-final-001/final/runtime-benchmarks/ollama-merged-development/benchmark-2026-08-05T23-00-56-297Z.json`, with its companion Markdown report beside it. The locked 16 cases were not reopened.
- During the benchmark the merged model used 1,420 MiB of compute VRAM according to `nvidia-smi`; Ollama reported 1,395,640,832 resident bytes at a 2,048-token context. The runner used approximately 929 MiB host RSS and the daemon approximately 177 MiB while active. No vLLM process existed. This is approximately 1.12 GiB less compute VRAM than the final adapter's failed compiled-vLLM initialization.
- A later live-system snapshot found `start.sh` active and Ollama serving both `qwen3.5:9b` and `qwen3.5:2b`; vLLM was not running. Their compute allocations were 8,102 MiB and 3,828 MiB respectively, or 11,930 MiB combined. Replacing the generic 2B resident role with the merged classifier would reduce that second allocation to approximately 1,420 MiB, saving roughly 2.4 GiB of measured compute VRAM while leaving the 9B general model unchanged. The live 9B/2B models were not unloaded because MetaHuman had been restarted and was actively processing user turns.
- The 461 ms median is approximately 4.6 times faster than the original 9B Ollama held-out reference of 2,135 ms. Split differences prevent treating that ratio as a model-quality comparison, but it clears the intended latency objective by a large margin while preserving zero unsafe action errors and zero excess-vision admissions on development data.
- Under the user-approved practical floor, the merged Ollama artifact qualified for a controlled Environment Router canary: 97.9% development exact routing exceeds 62.5%, safety remained clean, and latency was materially below 9B. It did not satisfy the earlier absolute 100% gate, and the completed 75% held-out result remains the only locked generalization evidence.
- Runtime decision: use one Ollama inference owner for the 9B general model and the merged 0.8B classifier, with residency controlled by role and demand. Do not run a second persistent vLLM service for this adapter. Keep the BF16 merge and LoRA artifacts as reproducibility/training evidence, not live runtime choices.

Live Environment Router canary:

- The live profile maps Environment Mode's `environmentRouter` role to `ollama.environment-classifier-0.8b:final` and its orchestrator, persona, and fallback roles to the 9B `default.orchestrator`. The generic 2B model is not part of this Environment Mode route even when it is resident in Ollama.
- From the live assignment through the first stand trial, the merged classifier produced two accepted Core decisions and three strict-JSON failures. The resulting 40% live acceptance rate is materially below the 97.9% sanitized development result and blocks treating the merged model as a successful default deployment.
- For the `please stand up` cycle at `2026-08-05T23:08:50Z`, the 0.8B classifier ran first in 624 ms with 1,075 prompt tokens and 94 completion tokens. Its response was not strict JSON, so the Core validator rejected it and emitted `environment_classifier_fallback` rather than admitting an unsafe or malformed route.
- The 9B fallback then completed the routing call in 2,738 ms. Subsequent 9B persona/visual calls built the response and evidence handling. The task validator admitted a `body_local` stand action, the Environment Bridge coordinated one command, and the robot physically stood. The successful movement therefore proves the fallback/action/bridge path, not successful 0.8B classification.
- Safety behavior was correct: invalid specialist output never reached action authority. Performance behavior was not yet correct because the failed specialist call added 624 ms before the full 9B routing path. The canary is now evidence of a live input/output distribution gap that must be repaired with sanitized development data; the locked 16 cases remain closed.

Stand-turn critical-path breakdown:

| Serialized call | Model | Latency | Share of 14,057 ms graph turn |
| --- | --- | ---: | ---: |
| Specialist route attempt | merged 0.8B | 624 ms | 4.4% |
| Main route fallback | 9B | 2,738 ms | 19.5% |
| Persona/environment response with image | 9B | 3,489 ms | 24.8% |
| Body-local Movement Generator | 9B | 7,151 ms | 50.9% |
| **Total LLM critical path** |  | **14,002 ms** | **99.6%** |

- The fallback mechanism has a measurable cost, but removing its failed 624 ms attempt would leave an approximately 13.4-second turn. It is not the primary cause of the unacceptable latency.
- The largest regression is incorrect semantic selection. The robot advertised the named `stand` command, but the Environment LLM did not select it for the natural instruction `stand up`; it instead requested off-script body-local generation. That unnecessary Movement Generator call consumed 7,151 ms.
- The Environment LLM owns natural-language interpretation and selects one advertised typed action or an explicit off-script body-local movement request. The parser owns only schema, capability, motion-class, and safety admission. It must not resolve phrases, maintain aliases, or synthesize a command that the model did not select.
- Because semantic selection requires the LLM, physical dispatch currently waits for that structured decision. Latency work should optimize that owned decision path without introducing a second natural-language resolver; the existing route authority, capability admission, task contract, result correlation, and safety checks remain deterministic.

Context-admission and semantic-selection repair:

- The live classifier mismatch was reproduced with sanitized large runtime envelopes. The generic state serializer admitted too much nested telemetry: realistic routing prompts measured 1,330 to 2,417 bytes, and only 2/5 representative outputs passed the Core contract.
- Core now applies a generic bounded projection only when state is oversized: maximum depth 3, 12 object keys, 8 array items, 160 characters per string, 480 serialized state characters, and 8 admitted state leaves. Ordinary compact state is unchanged. The same realistic prompts now measure 623 to 646 bytes.
- Five post-projection canaries all returned strict JSON and passed the existing Core routing contract. Latencies were 1,355, 930, 588, 595, and 485 ms. The covered routes were conversation, a body-local stand request, a current-state query, fresh visual acquisition, and a negated wave request.
- Generic Ollama JSON mode is now used for the classifier request. A stricter JSON Schema experiment was not adopted because the current Ollama/Qwen renderer ignored it; unused schema plumbing would not improve enforcement.
- The 9B Environment decision correctly understood a sanitized stand request but initially returned the bare string `"stand"` inside `actions`. Core correctly rejected that malformed shape, after which the graph entered the unnecessary Movement Generator path. The root cause was the output contract, not missing phrase coverage.
- The grounded Environment prompt now requires every action to be a typed object and shows the canonical named-command shape: `{"type":"robotCommand","command":"<one Supported robot command>"}`. The model remains the sole natural-language interpreter and semantic selector.
- A sanitized, non-dispatching 9B probe after the contract repair returned the typed advertised stand action in 1,619 ms. Core admitted it with `movementRequest=null`, so the 7,151 ms Movement Generator branch was not entered.
- The legacy phrase-level helper, its command synthesis, its task-completion reparsing, and the graph edge that fed raw instruction text into the parser have been removed. The action parser now accepts only structured model output plus advertised capabilities, session, and routing authority. It does not contain aliases or infer commands from wording.
- Motion semantics remain model-selected within the authorized movement route. Core validates the selected class and command against current capability, direct-user displacement authority, target-relative feedback requirements, persisted lifecycle state, and the existing bridge contract.
- This repair is source- and test-validated but not yet a physical end-to-end latency result. MetaHuman OS was stopped during the repair; the rebuilt bundle must be restarted before a live canary can prove the new critical path on the robot.

### Typed Environment Action Selector cross-validation

The repaired Environment workflow no longer consumes the retired 14-field
classifier output. A new system-owned training lane under
`brain/training/environment-action-selector/` now trains the current Core-owned
four-field output: `response`, `actions`, `movementRequest`, and
`taskDecision`. The current corpus contains 129 sanitized development source
cases and 1,548 controlled records; the first complete run used 53 cases and
636 records. Every source case and all twelve of its instruction/context
variations remain in one development fold. The retired 16-case lock is read
only as provenance and was not supplied to training or evaluation.

The first four-way run, `qwen3.5-0.8b-cv-001`, proved that four BF16 rank-16
trainers fit during optimization but failed at the synchronized epoch-one
validation boundary. The generic trainer accepted
`per_device_eval_batch_size` in configuration but did not pass it into
`UnslothTrainingArguments`, causing an unowned validation-memory spike. That
owner defect is repaired. The failed run remains partial evidence only and was
not evaluated.

The clean `qwen3.5-0.8b-cv-002` run trained all four folds concurrently after
setting the owned evaluation batch to one. Training completed in approximately
10.4 minutes wall-clock, used about 13.1 GiB of GPU memory at full utilization,
and produced four independent safetensors adapters. Future training is limited
to two trainers per wave so normal MetaHuman testing retains GPU headroom.

Best-validation-loss checkpoint cross-validation result (epoch 1 in every fold):

| Measure | Result |
| --- | ---: |
| Strict JSON | 607/636 (95.4%) |
| Core-contract valid | 234/636 (36.8%) |
| Exact action routing | 413/636 (64.9%) |
| Exact typed decision view | 149/636 (23.4%) |
| Unsafe physical authority | 122 |
| Missed physical actions | 37 |
| Wrong physical actions | 49 |
| Unnecessary image captures | 2 |
| Escalation errors | 44 |
| Median per-record latency | 3,143 ms |
| Mean prompt/completion tokens | 585 / 79 |

The latency measurement was collected while four independent BF16 model
instances shared one RTX 4080 and is not a single-resident deployment
benchmark. Evaluation used about 9.3 GiB total VRAM and released it when all
four prediction files closed.

The 64.9% exact action-route result exceeds the user-approved 62.5% viability
floor, but this checkpoint is not deployable. The initial scorer incorrectly
labeled full decision-view equality as exact selection; the maintained scorer
now reports routing equality and full decision equality separately and counts
unsafe authority only when the model invents physical work. The 122 physical
false authorizations remain disqualifying regardless of aggregate accuracy.

The errors are strongly fold- and boundary-clustered: fold 0 contributed 70
unsafe physical authorizations and fold 1 contributed 42, while folds 2 and 3
contributed 5 and 8. The dominant clusters are future and conditional wording,
negated actions, capability/state questions, simple conversation, explicit
escalation, unavailable target-relative motion, and already-complete persisted
visual tasks. Only two excess captures occurred. This shows insufficient
source-case generalization and fold balance around action authority, not a
reason to add aliases or parser-side semantic inference.

The separately retained final-epoch checkpoints were then evaluated through
the identical unseen-fold harness:

| Measure | Best loss / epoch 1 | Epoch 2 | Final epoch / epoch 3 |
| --- | ---: | ---: | ---: |
| Strict JSON | 607/636 (95.4%) | 596/636 (93.7%) | 593/636 (93.2%) |
| Core-contract valid | 234/636 (36.8%) | 377/636 (59.3%) | 366/636 (57.5%) |
| Exact action routing | 413/636 (64.9%) | 434/636 (68.2%) | 453/636 (71.2%) |
| Exact typed decision view | 149/636 (23.4%) | 270/636 (42.5%) | 288/636 (45.3%) |
| Unsafe physical authority | 122 | 52 | 53 |
| Missed physical actions | 37 | 84 | 60 |
| Wrong physical actions | 49 | 44 | 39 |
| Unnecessary image captures | 2 | 11 | 17 |
| Escalation errors | 44 | 9 | 9 |
| Median per-record latency | 3,143 ms | 3,479 ms | 3,121 ms |

Epoch 3 is the better overall semantic checkpoint despite its worse generic
validation loss: it has the highest routing and complete-decision parity, the
fewest wrong physical selections, materially fewer missed actions than epoch
2, and the lowest median latency. Epoch 2 has one fewer unsafe authorization
but 24 more missed physical actions and does not change the deployment
decision. Every checkpoint remains disqualified. All twelve
variants of the persisted visual-complete case were incorrectly reauthorized;
all persisted failure and persisted visual-incomplete variants missed their
required retry action; and all twelve fresh-vision variants requested another
capture despite already having correlated visual evidence. Conversation,
unavailable vision, unavailable target motion, and several explicit action
controls contributed the remaining safety and routing failures. This requires
independent counterfactual source cases on every training side of every fold,
not deployment of the better checkpoint.

The authoritative report is
`out/environment-action-selector/training/qwen3.5-0.8b-cv-002/development-validation.json`.
The final-epoch companion is
`out/environment-action-selector/training/qwen3.5-0.8b-cv-002/development-validation-final-epoch.json`.
The middle-checkpoint companion is
`out/environment-action-selector/training/qwen3.5-0.8b-cv-002/development-validation-epoch-2.json`.
The four development folds are evaluation rotations, not adapters to merge or
deploy. No new final adapter or locked action-selector evaluation has been
created.

The first balanced counterfactual expansion, `qwen3.5-0.8b-cv-003`, used 93
source cases and 1,116 records. Its epoch-two checkpoints were the safer of the
retained choices:

| Measure | Epoch 2 | Final epoch / epoch 3 |
| --- | ---: | ---: |
| Strict JSON | 1,102/1,116 (98.7%) | 1,096/1,116 (98.2%) |
| Core-contract valid | 935/1,116 (83.8%) | 908/1,116 (81.4%) |
| Exact action routing | 1,001/1,116 (89.7%) | 1,002/1,116 (89.8%) |
| Exact typed decision view | 795/1,116 (71.2%) | 768/1,116 (68.8%) |
| Unsafe physical authority | 29 | 37 |
| Missed physical actions | 47 | 43 |
| Wrong physical actions | 17 | 13 |
| Unnecessary image captures | 9 | 8 |
| Escalation errors | 18 | 25 |
| Median per-record latency | 3,302 ms | 3,303 ms |

This is a substantial accuracy improvement but remains development evidence,
not a deployable adapter. Epoch two still invented 29 unsafe physical actions
and missed 47 legitimate actions. Error clustering identified persisted visual
completion, unavailable vision, identity conversation, negation, capability
queries, fresh-vision control, hypothetical requests, and positive turn
commands as the remaining concentrated boundaries.

Thirty-six independent system-owned counterfactual cases were then added,
balanced across all four folds with matching positive movement controls. The
resulting `qwen3.5-0.8b-cv-004` corpus has 129 source cases and 1,548 records.
Training now runs as two successive trainer pairs rather than four concurrent
trainers, preserving roughly 9 GiB of VRAM for normal system testing. All four
folds completed successfully in two approximately 15-minute waves. Four-way
evaluation used about 8.4 GiB total VRAM, leaving about 7.1 GiB available for
normal testing.

The unchanged evaluator and Core scorer produced:

| Measure | Epoch 2 | Final epoch / epoch 3 |
| --- | ---: | ---: |
| Strict JSON | 1,500/1,548 (96.9%) | 1,504/1,548 (97.2%) |
| Core-contract valid | 1,301/1,548 (84.0%) | 1,241/1,548 (80.2%) |
| Exact action routing | 1,346/1,548 (87.0%) | 1,320/1,548 (85.3%) |
| Exact typed decision view | 1,102/1,548 (71.2%) | 1,068/1,548 (69.0%) |
| Unsafe physical authority | 28 | 32 |
| Missed physical actions | 94 | 110 |
| Wrong physical actions | 59 | 61 |
| Unnecessary image captures | 15 | 10 |
| Escalation errors | 55 | 62 |
| Median per-record latency | 3,342 ms | 3,320 ms |

Epoch two is the better cv-004 checkpoint, but cv-004 is rejected. Compared
with cv-003 epoch two, it reduced unsafe authority by only one while losing
2.7 percentage points of exact routing, doubling missed physical actions,
more than tripling wrong physical actions, and increasing invalid JSON,
unnecessary captures, and escalation errors. Fold 2 alone missed 69 physical
actions, averaged 128 completion tokens, and fell to 76.8% exact routing.
Several fold-2 clusters generated 291-384 tokens and required approximately
11-12 seconds per record even after the other three models unloaded.

The new cases repaired several original clusters but shifted errors into
off-script body-local selection, target-relative work, legitimate positive
authority, persisted retries, and malformed long-form output. This is a
training-distribution and recipe problem, not a reason to add command aliases,
keyword rules, or parser-side semantic inference. No cv-004 adapter is selected
or deployed, and the retired 16-case classifier lock remains untouched.

### Live selector contract failure - 2026-08-06

The live failure is currently a workflow ownership defect, not evidence that
all three tested models failed to understand the command. Audit records confirm
that the `environmentActionSelector` role actually changed from the merged
0.8B artifact to `qwen3.5:2b` and then `qwen3.5:9b`. Every production request
reached the selector, but the Selection Gate replaced its output with the same
invalid-structured-output response before the Action Parser could admit an
advertised command.

A direct probe using the current graph prompt, current robot observation, Core
selector envelope, and the instruction `Please stand up` captured the exact
responses:

| Model | JSON | Selected action | Probe latency | Gate rejection |
| --- | --- | --- | ---: | --- |
| `qwen3.5:2b` | valid | `robotCommand: stand` | 2,890 ms | missing `response`, `reason`, `continuationPolicy`, `requiredCompletionBasis`, and `motionClass` |
| `qwen3.5:9b` | valid | `robotCommand: stand` | 3,541 ms | missing `response`; `taskDecision` was null |
| `environment-action-selector-0.8b:v1` | valid | `robotCommand: stand` | 1,405 ms | unsupported `taskDecision.motionClass=body-controlled` |

All three models therefore made the correct semantic command selection, and
all three commands were discarded because the Selection Gate requires the LLM
to reproduce the entire lifecycle object. That requirement duplicates existing
owners: Action Parser already checks the typed action and exact advertised
command, and Task State already supplies one-shot defaults such as
`outcome=act`, `objectiveComplete=false`, `continuationPolicy=none`, and
`requiredCompletionBasis=action_result` for an admitted named command. The
graph also states that Task State is the sole lifecycle owner, so allowing the
Selection Gate to veto an advertised action over lifecycle metadata contradicts
the graph's own ownership contract.

The full-lifecycle veto has now been deleted rather than relaxed. The Selection
Gate implementation and tests, its two persona-only support nodes, and its
general escalation prompt output were removed. Six detour/support edges were
deleted and one direct edge was added. The graph is 21 nodes and 52 edges with the selector flowing directly through
Thinking Stripper to Action Parser. Action Parser still requires a typed action
and an exact adapter-advertised named command; Task State remains the only
lifecycle owner and supplies one-shot command defaults. A focused regression
passes all three captured selector outputs and confirms that each admits the
advertised `stand` action despite absent or malformed auxiliary lifecycle data.

Do not start another model-training round from the rejected live result.
Re-benchmark all three models through the repaired production path before
deciding whether the 0.8B artifact has a semantic-selection defect.

### Bounded visual lifecycle repair - 2026-08-06

Live `find`, `what do you see`, and `wave until` probes exposed a workflow
regression after the Selection Gate deletion. Advertised one-shot commands
reached the robot, but the consolidated lifecycle path did not preserve the
semantic stopping contract:

- the selector prompt incorrectly said Task State would supply continuation and
  completion metadata, so the 9B model omitted `taskDecision`;
- every new instruction started with vision disabled, so a current-scene request
  could answer from text context without receiving camera pixels;
- Action Parser consequently defaulted named commands to one-shot
  `action_result` completion;
- Ainekio terminal feedback reports emote-backed named commands as the adapter
  command `emote`, while Task State compared that label to the semantic command
  such as `wave` or `turn_right_90`;
- Bridge Out exposed its internal `no_actions` transport status as a chat
  response when a lifecycle pass legitimately produced no new command.

The repair stays inside the existing consolidated owners and does not restore a
blocking gate, phrase matcher, alias table, separate context classifier, Task
Refiner model call, or Visual Evidence Assessor model call. The useful behavior
from the previous lifecycle nodes is preserved as follows:

- Environment Action Selector now supplies the semantic whole-objective
  `taskDecision`; Task State remains the sole persistence, correlation, step,
  and completion owner.
- A request requiring current sight with no attached image must select the
  advertised `captureImage` action. The selector may describe the current scene
  only from attached image content.
- Bounded visual objectives persist `visual_observation` plus their original
  stopping condition. After each action, Task State admits the exact correlated
  frame; the same selector either completes from that frame or returns the next
  advertised action in the same pass.
- Terminal feedback correlation is owned by the unique action ID. Adapter
  transport labels such as `emote` can no longer hide a valid completion, while
  feedback for a different action ID cannot close the task.
- One-shot `action_result` completion is deterministic and emits one concise
  `Objective completed.` response without another LLM call.
- Bridge `no_actions` remains structured transport telemetry but is no longer a
  user-visible failure or warning log.

Focused regression coverage includes correlated capture, bounded visual
continuation, frame-grounded bounded completion, generic adapter command labels,
unrelated action IDs, one-shot deterministic closure, parser admission, context
admission, graph ownership, and bridge conversation passthrough. The focused
suite passes 22/22. `pnpm validate:graphs` passes 27/27. The full `pnpm build`
passes outside the sandbox-only `tsx` IPC restriction with zero architecture
violations, the 804-file user-agnostic guard, TTS and voice ownership checks,
delivery queue tests, and the Astro production build.

Physical robot acceptance remains the next proof: run one direct command, one
current-scene query, and one bounded visual stopping task through the restarted
production server. Source validation proves lifecycle and ownership behavior;
it does not prove what a physical camera frame contains.

## Open Validation

1. Rebuild and restart through the canonical application lifecycle before making
   claims about the loaded Environment graph or profile-specific model mapping.
2. Run one direct command, one current-scene query, and one bounded visual
   stopping task on the physical robot. Record semantic selection, image
   admission, bridge delivery, continuation count, completion basis, and
   end-to-end latency separately.
3. Benchmark the current 24-node graph with Robot Status admitted as supporting
   context before attributing any latency change to that input.
4. Treat the 0.8B experiments as historical rejected candidates. Do not resume
   training or create another conversation route without a new measured failure
   and an approved owner-scoped repair.
5. Reproduce any cross-task terminal-feedback problem against the current Task
   State owner before opening a repair. The retired Visual Evidence Assessor is
   not a valid follow-up owner.

## Reference Points

- Graph scheduling owner: `packages/core/src/graph-executor.ts`
- Coordinator capacity owner: `etc/queue.json` and `packages/core/src/queue/unified-queue-manager.ts`
- Task-to-resource ownership: `packages/core/src/queue/types.ts`
- Model-role resolution: `packages/core/src/model-resolver.ts` and `packages/core/src/model-router.ts`
- Ollama concurrency behavior: <https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests>
- Ollama adapter contract: <https://docs.ollama.com/modelfile#adapter>
- vLLM LoRA serving: <https://docs.vllm.ai/en/stable/features/lora/>
- Qwen3.5 0.8B model card: <https://huggingface.co/Qwen/Qwen3.5-0.8B>
- Qwen3 embedding model: <https://huggingface.co/Qwen/Qwen3-Embedding-0.6B>
- Qwen3 reranker model: <https://huggingface.co/Qwen/Qwen3-Reranker-0.6B>

## Historical Validation Record

This cumulative record preserves the command names, graph shapes, and results
reported by their dated implementation slices. It is not a current all-pass
matrix; the Current Status and Open Validation sections above govern present
claims.

Passed:

- Post-deletion `pnpm build` - architecture guard zero violations, user-agnostic guard 804 maintained runtime files, all 27 cognitive graphs, TTS/voice ownership, delivery queue 6/6, and Astro production build passed after rerunning outside the sandbox-only `tsx` IPC restriction
- Direct selector-to-parser regression - all three captured 0.8B, 2B, and 9B `stand` outputs admit the exact advertised command; 18/18 focused parser, context, task-state, and graph tests pass after deleting Selection Gate
- `pnpm validate:graphs` - all 27 graphs pass with Environment Mode reduced to 21 nodes and 52 edges and no dangling gate or persona-support edges
- Model-owned command-selection regression suite - classifier projection, typed Environment actions, capability admission, motion generation, task contracts, lifecycle completion, vLLM JSON transport, and compatibility passed across the focused test files
- `pnpm build` - architecture guard zero violations, user-agnostic guard 798 maintained runtime files, all 27 cognitive graphs, TTS/voice ownership, delivery queue 6/6, and Astro production build passed after rerunning outside the sandbox-only `tsx` IPC restriction
- Live stand safety/fallback canary - the 0.8B response failed strict JSON and was rejected by Core; 9B fallback produced the admitted `body_local` stand command and the bridge delivered one command without malformed specialist output receiving action authority
- Merged Qwen3.5-0.8B Ollama development benchmark - 47/48 strict JSON, 47/48 Core valid, 47/48 exact routes (97.9%), zero unsafe actions, zero excess vision, one missed action, 461 ms median, 550 ms p95, and no locked-case reuse
- Merged Q4_K_M runtime artifact - 529,297,184-byte text-only GGUF, official no-MTP conversion, Qwen3.5 renderer/parser ownership, SHA-256 provenance, and 1,420 MiB measured compute VRAM
- Final Qwen3.5-0.8B one-shot locked evaluation - 16/16 strict JSON, 15/16 Core valid, 12/16 exact routes (75.0%), zero unsafe actions, zero excess vision, one missed action, 3,890 ms median vLLM latency; completed receipt prevents rerun
- Final Qwen3.5-0.8B adapter - 1,822 development-only records, 48 source cases, 684 optimizer steps, three epochs, 20.1-minute trainer runtime, and 20.6-minute complete pipeline
- `pnpm evaluate:environment-classifier:final -- --dry-run --root out/environment-classifier/training/qwen3.5-0.8b-final-001` - final provenance, adapter shape, selected development report, dataset digest, and held-out one-shot preconditions validated without model exposure
- Four-fold Qwen3.5-0.8B development cross-validation - 1,821/1,822 strict JSON, 1,790/1,822 Core valid, 1,248/1,822 exact routes (68.5%), 88 unsafe actions, 19 excess-vision admissions, 163 missed actions, and 462 ms aggregate median batch latency
- `pnpm score:environment-classifier:development -- --root out/environment-classifier/training/qwen3.5-0.8b-cv-002 --checkpoint-policy final-epoch` - selected and recorded each final evaluated checkpoint without duplicating predictions
- Qwen3.5-0.8B folds 1-3 - unchanged BF16 rank-16 response-only recipe, source-case isolation, final-epoch evaluation through the Core contract, and no held-out model input
- Final-adapter dry run - 1,822 records from all 48 development cases, zero validation or held-out model inputs, and the selected cross-validation report accepted as provenance evidence
- Compact classifier message ownership - one Core formatter used by training, runtime, and specialized benchmark requests; regenerated dataset digest unchanged
- `node --import tsx --test packages/core/src/nodes/llm/orchestrator-llm.node.spec.ts packages/core/src/environment-classifier-runtime.spec.ts` - compact runtime handoff, production-model selection, and retired-fold rejection passed
- Repaired Qwen3.5-0.8B fold-0 pilot - 1,376 training records, 446 isolated development records, 516 optimizer steps, 14.9-minute training runtime, and 21.5-minute end-to-end artifact generation
- Repaired epoch-3 checkpoint - 446/446 strict JSON, 446/446 Core valid, 374/446 exact routes, 4 unsafe actions, 0 excess vision, 49 missed actions, and 775 ms median batch latency
- Route-stratum generation guard - all validation route views are represented on every fold's training side; 13 controlled surfaces and 102 records remain source-fold attached
- `pnpm validate:environment-classifier` - 1,822-record repaired dataset and unchanged 16-case held-out lock validated
- Qwen3.5-0.8B fold-0 response-only LoRA pilot - 1,300 training records, 420 isolated development-validation records, 3 retained checkpoints, 489 optimizer steps, 14.1-minute training runtime
- Qwen3.5-0.8B checkpoint evaluator - checkpoints 163, 326, and 489 completed the same 420-record development fold with held-out source rejection and separate Core reports
- `pnpm score:environment-classifier:development -- --root out/environment-classifier/training/qwen3.5-0.8b-cv-001 --fold 0` - best-loss adapter scored through the 14-field Core contract and safety gates
- Response-mask tokenizer probe - 238 total tokens, 77 answer tokens trainable; prompt and input tokens masked
- `pnpm train:environment-classifier:0.8b -- --dry-run --fold 0` - 1,720 records validated; 1,300/420 record and 36/12 source-case split; held-out digest excluded
- FunctionGemma access probe - official weights were confirmed gated; the candidate was declined without adding credentials or exposing held-out data, and its temporary maintained-source lane was removed
- Qwen3.5-0.8B upstream review - Apache 2.0 weights, official PEFT-compatible chat template, and existing local Qwen/Unsloth/vLLM integration selected for the compact pilot
- `git diff --check` - current maintained-source changes have no whitespace errors
- Second `qwen3.5:2b` LoRA run - current `motionClass` prompt/contract, 480 development-only records, 3 epoch checkpoints, 180 optimizer steps
- `pnpm benchmark:environment-classifier -- --provider vllm --models environment-classifier-2b-run-002-step-60,environment-classifier-2b-run-002-step-120,environment-classifier-2b-run-002-step-180 --split held_out` - completed the same 16 locked cases for all three checkpoints; all deployment gates reported explicitly
- First `qwen3.5:2b` LoRA run - 480 development-only examples, 3 epochs, 180 optimizer steps, system-owned safetensors artifacts
- Provider-neutral harness unit coverage - Ollama and vLLM share route, safety, token, and wall-latency accounting; unnecessary vision is a deployment-blocking error
- `pnpm generate:environment-classifier-training` - 480 development-only records; held-out digest unchanged
- `pnpm train:environment-classifier:2b -- --dry-run` - dataset, manifest, prompt, owner, base-model, and output-lane checks passed
- `pnpm validate:environment-classifier` - Core contract plus corpus/lock/harness checks
- `pnpm benchmark:environment-classifier -- --validate-only` - 64 cases; 48 development; 16 hash-locked held out
- `pnpm benchmark:environment-classifier -- --split all` - completed 64 cases for both `qwen3.5:9b` and `qwen3.5:2b`
- `pnpm benchmark:environment-classifier -- --models qwen3.5:0.8b --split all` - completed all 64 cases with the same corpus and prompt fingerprints
- `node --import tsx --test packages/core/src/nodes/llm/orchestrator-llm.node.spec.ts`
- `pnpm build` - architecture, user-agnostic, 27 graph, TTS/voice ownership, and Astro production build gates passed
- `pnpm exec tsx packages/core/src/environment-conversation-memory.spec.ts`
- `pnpm exec tsx --test packages/core/src/nodes/environment/context-builder.node.spec.ts packages/core/src/nodes/environment/instruction-interpreter.node.spec.ts packages/core/src/nodes/environment/task-contract.node.spec.ts packages/core/src/nodes/environment/task-validator.node.spec.ts` - 48/48
- `pnpm exec tsx --test packages/core/src/nodes/llm/orchestrator-llm.node.spec.ts` - 3/3
- `pnpm exec tsx --test packages/core/src/nodes/environment/instruction-interpreter.node.spec.ts packages/core/src/nodes/environment/task-contract.node.spec.ts`
- `pnpm exec tsx --test packages/core/src/nodes/environment/task-validator.node.spec.ts` - 29/29
- `pnpm exec tsx packages/core/src/providers/multimodal.spec.ts`
- `pnpm validate:graphs` - 27/27
- `pnpm validate:user-agnostic` - 778 maintained runtime files checked
- `pnpm validate:voice-service-ownership`
- `pnpm -s check:architecture` - zero violations beyond baseline
- `pnpm --dir apps/site build`
- `git diff --check`

Resolved protective validation:

- `pnpm validate:environment-classifier` again passes after the explicit version-2 `motionClass` contract migration and development-only dataset regeneration. Run 001 remains fingerprinted as a pre-drift artifact and is not deployable against the current prompt.

Known unrelated baseline failures encountered during validation:

- Repository-wide Core TypeScript checking reports the documented existing errors across unrelated modules. The final check reports no diagnostic in Task Contract, Task Validator, Visual Evidence Assessor, Context Builder, or their regression specs.
- `tests/environment-freestyle-graph.spec.ts` still expects the pre-validator direct Parser -> Bridge edge and the old Instruction -> Router edge. The maintained graph now routes actions through Task Validator and sends the state-aware routing envelope to Context Router.
- The broad environment compatibility script stops on an existing rejection-message expectation before reaching the context-admission assertions.
