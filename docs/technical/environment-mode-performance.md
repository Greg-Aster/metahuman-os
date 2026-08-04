# Environment Mode Performance

## Purpose

This document is the maintained paper trail for Environment Mode response-time work. It records measured behavior, architectural decisions, validation evidence, and remaining work. Performance changes must preserve persona quality, memory grounding, environment-action authorization, task lifecycle ownership, and evidence-based completion.

## Maintenance Rule

- Update this document whenever Environment Mode performance is measured, a performance-related architecture decision is made, or an implementation changes the LLM critical path.
- Record proposals as proposals and implemented changes as implemented changes. Discussion alone must not be represented as deployed behavior.
- Preserve measurements with their model, context, residency, and concurrency conditions so later comparisons remain meaningful.
- Keep system-model training data, evaluation artifacts, and runtime roles separate from profile-owned persona data and adapters.
- Do not turn this paper trail into a second configuration system. Runtime authority remains in maintained Core owners and checked-in configuration.

## Performance Contract

- Optimize the measured critical path before changing model quality.
- Do not bypass the cognitive graph or add keyword-based intent shortcuts.
- Context Router owns typed context admission. Context Builder consumes that decision; it does not independently reinterpret user intent.
- Ordinary conversation must not receive robot action, sensor, task-lifecycle, or image context.
- Current-state questions may receive environment evidence without receiving action authority.
- Environment actions and persisted tasks retain the full execution, capability, evidence, and completion contracts.
- Fresh correlated images are admitted only when the typed route or persisted objective requires visual evidence.
- Raw correlated sensory observations remain available in graph state even when a particular LLM call does not process the image. Context admission controls model input, not sensor existence.
- Validator-persisted completion contracts are authoritative on later passes. For newly admitted work, the Environment task decision owns one-shot versus bounded continuation. When both independent classifiers identify bounded work, Context Router owns the required whole-objective evidence classification; it remains the complete fallback only when the task decision omitted a usable contract.
- Missing or malformed admission data must fall back to the full conservative context.
- A smaller model may serve a specialized role only after measured route parity and automatic fallback to the primary model are demonstrated.
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

- Environment Mode currently has 29 nodes and 76 edges. The recently added task/evidence nodes early-return on ordinary conversation and are not the direct latency source.
- The graph executor visits nodes in topological order and awaits them serially.
- The work coordinator also serializes the broad `local-llm` resource lane with `maxConcurrent: 1` and a 2,000 ms cooldown between complete work items.
- The example turn required three serial LLM calls: route, memory relevance, and final response.
- The router, memory interpreter, and persona currently resolve to `qwen3.5:9b` for the active setup.
- The final context was oversized because task/action contracts and correlated vision were admitted without a typed relevance decision.
- Ollama model unloading after five minutes adds an intermittent cold-start penalty.
- Graph serialization and coordinator serialization are MetaHuman policies, not hard Ollama limitations.

## Work Log

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
- Permit the Robot Observer bypass only for work explicitly marked `requestedBy: robot-observer`. All ordinary audio remains governed by typed `needsVision`; a validator-persisted visual objective remains governed by its task contract.
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
- The initial Environment decision returned `bounded + action_result`; Context Router returned `bounded + visual_observation`. Environment Task Contract correctly selected `bounded_router_evidence`, persisted `visual_observation`, and retained the disagreement in lifecycle telemetry.
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
3. The user submitted the separate typed objective `tell me what you see right now` at 22:27:17. Environment Observation correctly read the latest session snapshot. Instruction Interpreter correctly selected the typed message as the authoritative instruction, but it also preserved the prior observation's terminal feedback.
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
- Keep this correction in the existing Environment Observation -> Instruction Interpreter -> Action Parser -> Task Validator lifecycle. Do not add a second feedback store, a prompt phrase branch, or a camera-specific retry shortcut.

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

## Current Priorities

1. Build the Environment Classifier Gold Corpus and repeatable 9B/2B benchmark defined above.
2. Fine-tune and evaluate `qwen3.5:2b` as `environment_classifier`; do not assign it live before it clears the acceptance gates.
3. Train and benchmark the same classifier task on `qwen3.5:0.8b` after the 2B pipeline is proven.
4. Evaluate `Qwen3-Reranker-0.6B` against the current Memory Relevance Interpreter using relevance quality and end-to-end latency.
5. Measure whether explicit model-role resource lanes improve user latency without allowing background work to contend with the primary model.
6. Evaluate longer Ollama keep-alive separately from prompt, routing, and concurrency architecture.

Deferred, accepted for now:

- Tighten Visual Evidence Assessor around the exact stopping predicate and physically retest another bounded motion if this behavior becomes a practical blocker.
- Repair cross-task terminal-feedback admission and rerun the text-input frame-acquisition acceptance case if the defect becomes a practical blocker.

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

## Validation Record

Passed:

- `pnpm exec tsx packages/core/src/environment-conversation-memory.spec.ts`
- `pnpm exec tsx --test packages/core/src/nodes/environment/context-builder.node.spec.ts packages/core/src/nodes/environment/instruction-interpreter.node.spec.ts packages/core/src/nodes/environment/task-contract.node.spec.ts packages/core/src/nodes/environment/task-validator.node.spec.ts` - 48/48
- `pnpm exec tsx --test packages/core/src/nodes/llm/orchestrator-llm.node.spec.ts` - 3/3
- `pnpm exec tsx --test packages/core/src/nodes/environment/instruction-interpreter.node.spec.ts packages/core/src/nodes/environment/task-contract.node.spec.ts`
- `pnpm exec tsx --test packages/core/src/nodes/environment/task-validator.node.spec.ts` - 29/29
- `pnpm exec tsx packages/core/src/providers/multimodal.spec.ts`
- `pnpm validate:graphs` - 26/26
- `pnpm validate:user-agnostic` - 776 maintained runtime files checked
- `pnpm validate:voice-service-ownership`
- `pnpm -s check:architecture` - zero violations beyond baseline
- `pnpm --dir apps/site build`
- `git diff --check`

Known unrelated baseline failures encountered during validation:

- Repository-wide Core TypeScript checking reports the documented existing errors across unrelated modules. The final check reports no diagnostic in Task Contract, Task Validator, Visual Evidence Assessor, Context Builder, or their regression specs.
- `tests/environment-freestyle-graph.spec.ts` still expects the pre-validator direct Parser -> Bridge edge and the old Instruction -> Router edge. The maintained graph now routes actions through Task Validator and sends the state-aware routing envelope to Context Router.
- The broad environment compatibility script stops on an existing rejection-message expectation before reaching the context-admission assertions.
