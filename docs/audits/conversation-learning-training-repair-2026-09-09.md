# Conversation learning and training repair

Date: September 9, 2026. Status: source repair complete, with the validation boundaries below. The installed site and remote training image were not redeployed.

The existing personalization system has been repaired at its canonical owners. Conversation capture, Curator storage, dataset selection, training execution, candidate review, model assignment, and automatic admission now form one path. The research report was updated with the supplied independent review before implementation. Its original observations remain a dated baseline; this document records the resulting implementation and its validation limits.

Initial revision: `b57d205895d785d96194b9b9893f7c0b07838447`. Changes are uncommitted. Concurrent Environment, Robot Operator, durable-execution, and Flow Editor work remains in the worktree; those changes are not claimed as this repair.

## What was broken and what owns the repair

The baseline failed at several separate boundaries: capture could depend on successful response generation; changed-content retries could appear successful; encrypted storage could fall back to plaintext; Curator records could lose their relationship to source messages; training pairs could reverse time or be reformatted twice; data selection and user controls disagreed; local dependencies were incompatible; worker success and provider cleanup were ambiguous; and training, backend configuration, and legacy adapter flags offered competing model-selection paths.

The pre-edit focused baseline passed six of ten files and failed four, covering conversation/inner-buffer idempotency and the bundled Curator graph. Dependency inspection found missing TorchAO and TorchAudio incompatible with installed PyTorch. These observations established failures before the repairs.

| Responsibility | Canonical owner after repair | User access |
| --- | --- | --- |
| Durable messages and encryption | Core memory, storage client, conversation/inner buffers and memory saver nodes | Existing conversation and inner-dialogue graphs in the graph editor |
| Source interpretation and review | Core Curator contracts, source assembler, curated store and save-then-mark graph | Existing Curator agent, editable graph and preprocessing controls |
| Training settings and data | Core training config, browser-safe training schema and training dataset owner | Wizard, Automatic Training and existing configuration APIs |
| Dataset freezing | Existing Brain personalization dataset pipeline | Dataset preview, preprocessing/window controls and run artifacts |
| Job admission and process history | Core training launcher and training process owner | Wizard, CLI, History, Monitor and cancellation |
| Optimization and artifact evaluation | Shared Python trainer under `docker/runpod-trainer` | Local LoRA, remote LoRA, remote full fine-tune; specialist maintainer CLI |
| Provider resources | Core RunPod provider; finite Brain SSH orchestration | RunPod settings and explicit cleanup recovery in History |
| Candidate review and selection | Core adapters, model registry/resolver and actual provider bridge | History preparation/comparison/decision controls, Backend setup, Model Settings and rollback |
| Automatic scheduling | Existing Sleep Workflow and Work Coordinator | Automatic Training enable switch, thresholds, cooldown and runtime limit |

No new scheduler, queue, activation registry, or parallel training service was added.

## Capture and curation

The four maintained conversation graphs persist the admitted user message before model execution and the assistant message before delivery. Exact whitespace is retained. Input capture has explicit passthrough wiring, so its receipt precedes downstream work. Inner-dialogue producers retain their existing buffer and memory saver owners. Model failure therefore leaves the already admitted input available for review.

Capture uses atomic persistence. A repeated occurrence must match the stored content, response, type, timestamp and idempotency identity. A conflicting retry fails without replacing the original message. Locked encrypted profiles fail before writing; the plaintext fallback and its downstream warning fields were removed. Encryption keys resolve through the actual profile root.

Curator policy version 2 records source hashes, source kind, session identity, cognitive-mode provenance and available model/prompt provenance. Recorded exchanges preserve exact text. Generated examples remain explicitly synthetic. Feedback is a visible rejection rather than a silently converted positive demonstration. Sessionless, orphan or reversed legacy turns are not guessed into training pairs.

A durable Curator decision must exist before source metadata is marked. Training verifies the decision ID, filename, policy version and source hashes against the current source. Missing, changed, obsolete or malformed records remain visible and require review. Existing memories and legacy artifacts were not deleted or bulk migrated.

Capture proof covers admitted message records and configured producer paths. It does not claim to archive unavailable provider-internal reasoning or every partial streaming token.

## Dataset and training contract

The objective is explicit. **My next reply** learns a recorded human continuation after an earlier assistant message in the same session. **Persona / assistant reply** learns the recorded or explicitly curated assistant continuation. Cognitive mode does not reverse speaker roles. The default preserves the human-continuation objective; changing it is a user control.

The shared selection owner applies source weights, persona context, synthetic-data ceilings, sample limits and deterministic replay. Zero weights exclude a source. A null maximum includes all eligible data rather than silently imposing the former 5,000-row ceiling. Exact duplicates are removed. Synthetic examples require recorded examples and respect the ceiling in both partitions.

Whole sessions stay in one partition. Immutable prior manifests preserve source, group and content exposure when seeds or settings change; contradictory exposure is excluded. Only completed training sample IDs count toward completed-data novelty. Failed or prepared runs still conservatively preserve exposure for future splitting. Frozen manifests bind configuration, cutoff, source hashes, sample IDs, partitions and exact JSONL bytes. Missing independent evaluation data fails visibly.

The Python engine uses the tokenizer's native template once. Only the final continuation and native end-of-turn tokens receive loss; prompt and padding tokens are masked. Missing templates, ambiguous boundaries, empty targets and overlong examples fail rather than inventing a wrapper or silently truncating data. The same engine supports LoRA and full-parameter updates. The Environment Action Selector retains its explicit action-message contract and development-fold policy; it is not converted into a personalization task.

Personalization compares base and candidate on an independent partition. The final serialized weights and tokenizer are loaded in a fresh process for evaluation. The holdout does not select intermediate checkpoints. Receipts include finite losses, quality-gate status, supervision policy, file hashes and the explicit requirement for serving review. GGUF conversion is confined to this run's conversion directory and requested quantization.

The pinned setup contract is shared by the local installer and Docker image: PyTorch 2.8.0, TorchVision 0.23.0, TorchAudio 2.8.0, TorchAO 0.13.0, Unsloth/Unsloth Zoo 2026.8.3, Transformers 5.5.0, TRL 0.23.0, PEFT 0.18.1, Accelerate 1.11.0, Datasets 4.3.0, bitsandbytes 0.48.2, xFormers 0.0.32.post2 and GGUF 0.17.1. The local environment passes `pip check`. The initial recipe uses 4B BF16/FP16 LoRA; inference and specialist role assignments were not changed to that training default. The smaller cached 0.8B checkpoint is used for synthetic GPU validation, not as a claimed personalization-quality result.

## Launch, cancellation and provider recovery

Wizard, APIs, CLI and Sleep use the same Core launcher. It validates and freezes the effective configuration before starting the real worker PID. Local LoRA, remote LoRA and remote full fine-tuning delegate to the existing shared Brain cycle. The worker owns dataset preparation, trainer invocation, candidate verification and terminal reporting; it does not activate its output.

The process owner tracks profile, run label, work directory and log identity. It reconciles dead workers and preserves cancellation and terminal evidence. History, Monitor and console APIs read that same profile-owned history. A disappeared PID does not mean training succeeded, and one profile cannot read another profile's training log.

Remote orchestration persists the unique pod name before a single allocation request. An ambiguous allocation is recovered by that exact identity rather than retried. SSH transfer and output streams must settle before cleanup. Upload/download hashes are checked. Provider termination must be followed by inventory evidence that the exact resource is absent; an acknowledgement alone is insufficient.

Unconfirmed cleanup survives restart and blocks another launch. History exposes **Terminate remaining pod and verify cleanup** and a RunPod console link. The recovery action uses the existing provider owner and saved receipt. Optional S3 backup remains explicit and off by default. Required backup or cleanup failures remain failures.

Automatic training is one finite Sleep stage after Organizer and Curator. Readiness considers selected examples, new sample IDs, cooldown including failed attempts, current work and required credentials. The Sleep start time freezes the source cutoff. The worker checks Sleep identity, owner, active stage and deadline; cancellation or waking ends its authority. The watchdog cannot schedule a new job. All runs leave candidates for explicit review.

## Candidate review and connected controls

History exposes preparation of the exact artifact, baseline backend/model selection, three to eight representative prompts, side-by-side responses, per-response checks, notes, acceptance/rejection and review reopening. A full vLLM candidate may use an Ollama baseline so both models need not fit in the same vLLM instance. The existing Backend and Model Settings navigation is connected directly from this flow.

Ollama preparation imports the verified GGUF. vLLM preparation verifies the served artifact root, exact training base for LoRA and tokenizer template. Acceptance and role assignment recheck the artifact and serving identity. Normal provider dispatch applies the same approval owner to the model actually being served, including backend aliases; direct comparison calls remain available for review. Explicit vLLM LoRA selection now reaches the request instead of being replaced with the base model.

The obsolete global adapter toggle no longer selects a model. The Model Resolver node delegates to normal profile role/cognitive-mode resolution. Persona controls and Model Settings share the profile's model-settings owner, preserving role assignments. Active personalization status is a projection of the actual persona role. Unavailable enabled vLLM adapters can be removed from Backend settings, so stale selections do not leave an unrepairable startup failure.

**Suspend approval and start a new serving review** blocks further normal use until a fresh comparison is accepted. Model Settings selects the intended role or restores a previous model. Acceptance does not itself assign a role. A changed artifact or serving template cannot silently reuse the old approval.

The wizard loads saved values and applies presets only on an explicit click. Numeric controls expose supported epochs, rank, alpha, learning rate, batch size, accumulation and context length, including valid values outside old preset lists. Dataset preview shows exclusions and independent partitions. Automatic controls expose minimum new data, cooldown and maximum runtime. Local readiness checks the training venv and actual GPU memory; RunPod secrets are not copied into browser local storage.

## Removed or consolidated

Removed the Brain curated aggregator, mode formatter, training exporter, training-window helper and test, duplicate fine-tune config helper and test; Core schema manager, mode validator and unused training-lineage registry; the duplicate full-fine-tune Python trainer; four manual chat-wrapper schemas; three mode-specific training configs; and the duplicate fine-tune/local config seeds. Their callers and public exports were removed or redirected to the existing owners. Curator's private atomic-JSON helper was replaced by the storage owner. Legacy global adapter selection and root-config writes from persona controls were removed.

Thin local/remote/full CLI entrypoints remain because they are supported interfaces; all delegate to the same launcher and worker. Existing runtime data, weights and old model files remain local and unmodified. The new schema and domain functions live in existing Core responsibilities and have callers, controls or focused tests.

## Validation evidence and limits

| Evidence layer | Result and scope |
| --- | --- |
| Focused TypeScript contracts | 28 training/storage/capture/provider/dataset/specialist test files passed, including real role assignment, provider dispatch, legacy-toggle removal and shared persona settings. The settings/history slice also passed separately as four files. |
| Curator | 14/14 passed, including encrypted persistence, source reconciliation, feedback handling and an isolated graph build. |
| Python and GPU | 10/10 passed: eight trainer contracts plus real optimizer/reload tests for cached Qwen 3.5 0.8B LoRA and a tiny locally initialized full Llama. Both changed weights and produced finite improved evaluation loss after reload. |
| Complete local job | Passed through the real Core launcher, source/review inspection, dataset freezing, Brain worker, cached Qwen 3.5 0.8B GPU LoRA, fresh-process artifact evaluation, candidate verification and terminal history. The run used eight training examples and one independent evaluation example, completed in 58 seconds, released its PID receipt and left the candidate unassigned. |
| Browser interaction | Actual Svelte components and built styles passed 13 assertions for preparation, comparisons, decisions, reopening, cleanup, navigation and persistence; a separate launch check verified saved numeric settings and explicit terminal failure. API responses were synthetic. |
| Type/build | Core, Brain, CLI and Site type checks pass; Site reports 365 files with zero errors/warnings. Astro production build passed into a temporary output directory without replacing the served build. |
| Guardrails | 38/38 graphs, node defaults, 14/14 security routes, user-agnostic paths and architecture/remote-safety guardrail passed. Architecture reports zero current violations. |
| Environment | Local pinned venv passes dependency checks and GPU smoke. Docker image build/deployment was not performed. |

The complete local job began at 22:34:43 UTC and ended at 22:35:41 UTC on September 9. Its synthetic arithmetic holdout loss changed from 1.069643 to 0.000706 after serialized reload. This single simple holdout demonstrates execution and receipt integrity, not generalization or personal usefulness. Organizer/model-based Curator generation was skipped for that run because the temporary source records already had fixture reviews written and marked through the real Curator storage owners; their separate graph and failure tests provide the preceding-stage evidence. The temporary verification script initially used an unexported history accessor after training had completed; an independent read through the actual history owner then verified the completed receipt and candidate without rerunning optimization.

The broader `providers/multimodal.spec.ts` test still fails at its Environment image assertion: the existing fixture omits `observationCurrent` and `routingAnalysis.needsVision`. The same omission was reproduced using the starting revision's context builder and helper; supplying those inputs preserves the image. That unrelated test and concurrent Environment implementation were not changed to manufacture a pass. The final focused training bundle is reported separately.

Sandbox-only failures were rerun with the required access: Curator's isolated child build, the architecture guardrail's Git subprocess, Chrome/localhost checks, and GPU visibility. Node-default validation reports existing schema-documentation and graph-migration debt; Vite reports existing chunking warnings. Neither is represented as zero-warning repository-wide validation.

The browser harness verifies component interactions and contracts, not authenticated operation of the installed site. No personal-data training, paid RunPod allocation, GGUF import into the installed Ollama server, candidate activation, installed-service restart or physical action was performed. Synthetic results do not prove useful personalization or the quality of the 4B recipe. Remote image compatibility, actual GGUF/vLLM serving of a new output, and a real overnight wake/recovery cycle remain operational validation boundaries. The next real candidate must pass its serving and task review before role assignment.

## Research decisions retained

This repair implements reproducible supervised adaptation and replay, the necessary baseline for comparing more advanced methods. It does not claim that nightly weight updates are inherently beneficial. Data capture and review may run frequently; training is conditional. Prompt/procedural-context improvements, preference learning such as DPO/KTO, outcome-linked specialist learning, On-Policy Replay and self-distillation remain experiments described in the [research comparison](conversation-learning-training-review-2026-09-09.md), rather than additional active production pipelines.

Primary compatibility references used during implementation: [native chat templates](https://huggingface.co/docs/transformers/en/chat_templating), [TRL 0.23 SFT](https://huggingface.co/docs/trl/v0.23.0/en/sft_trainer), [Unsloth Qwen 3.5 training](https://unsloth.ai/docs/models/qwen3.5/fine-tune), [TorchAudio installation](https://docs.pytorch.org/audio/main/installation.html), and [TorchAO releases](https://github.com/pytorch/ao/releases). Provider behavior was checked against [RunPod GraphQL](https://graphql-spec.runpod.io/), [RunPod SSH](https://docs.runpod.io/pods/configuration/use-ssh), [Ollama import](https://docs.ollama.com/import), and [vLLM LoRA serving](https://docs.vllm.ai/en/latest/features/lora/).

Operational controls and artifact locations are documented in the [training guide](../user-guide/training-personalization/ai-training.md).

### Repeatable validation entrypoints

```sh
node --import tsx --test packages/core/src/training-*.spec.ts packages/core/src/adapters-*.spec.ts brain/training/personalization/dataset-pipeline.spec.ts
node --import tsx packages/core/src/nodes/curator/curator-contract.spec.ts
pnpm typecheck:core
pnpm typecheck:brain
pnpm typecheck:cli
pnpm typecheck:site
pnpm validate:graphs
pnpm validate:node-defaults
pnpm validate:security-routes
pnpm validate:user-agnostic
pnpm check:architecture
venv/bin/python3 -m pip check
venv/bin/python3 -m unittest discover -s docker/runpod-trainer -p test_train_unsloth.py -v
```

The Python command runs CPU contracts and explicitly skips the two GPU cases unless `METAHUMAN_TRAINING_SMOKE_MODEL` points to a compatible native model. The completed GPU validation used the cached Qwen 3.5 0.8B snapshot and real accelerator access. Curator's build check also needs child-process access. Use an isolated Astro output directory for build verification while the installed server is running.
