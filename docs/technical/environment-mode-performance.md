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

## Current Priorities

1. Repair the Robot Observer metadata override so ordinary correlated audio does not bypass typed vision admission.
2. Repair the one-shot visual-response completion contract without weakening independent evidence checks for physical-task completion.
3. Add focused regression cases for ordinary audio with an available frame, direct current-frame description, and multi-step visual completion; then rerun the four live cases above.
4. Expand the eight-case benchmark into a larger sanitized, system-owned held-out routing corpus.
5. Fine-tune and evaluate `qwen3.5:2b` as `environment_classifier`; do not assign it live before it clears the acceptance gates.
6. Train and benchmark the same classifier task on `qwen3.5:0.8b` after the 2B pipeline is proven.
7. Evaluate `Qwen3-Reranker-0.6B` against the current Memory Relevance Interpreter using relevance quality and end-to-end latency.
8. Measure whether explicit model-role resource lanes improve user latency without allowing background work to contend with the primary model.
9. Evaluate longer Ollama keep-alive separately from prompt, routing, and concurrency architecture.

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
- `pnpm exec tsx --test packages/core/src/nodes/llm/orchestrator-llm.node.spec.ts` - 3/3
- `pnpm exec tsx --test packages/core/src/nodes/environment/instruction-interpreter.node.spec.ts packages/core/src/nodes/environment/task-contract.node.spec.ts`
- `pnpm exec tsx --test packages/core/src/nodes/environment/task-validator.node.spec.ts` - 29/29
- `pnpm exec tsx packages/core/src/providers/multimodal.spec.ts`
- `pnpm validate:graphs` - 26/26
- `pnpm -s check:architecture` - zero violations beyond baseline
- `pnpm --dir apps/site build`
- `git diff --check`

Known unrelated baseline failures encountered during validation:

- Repository-wide Core TypeScript checking reports existing errors across unrelated modules; none were reported in the files changed for this performance work.
- `tests/environment-freestyle-graph.spec.ts` still expects the pre-validator direct Parser -> Bridge edge and the old Instruction -> Router edge. The maintained graph now routes actions through Task Validator and sends the state-aware routing envelope to Context Router.
- The broad environment compatibility script stops on an existing rejection-message expectation before reaching the context-admission assertions.
