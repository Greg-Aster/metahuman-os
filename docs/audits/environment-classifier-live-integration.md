# Environment Classifier Live Integration

Date: 2026-08-05

Status: retired from the production workflow later on 2026-08-05. This file is retained only as training and deployment history.

## Scope and ownership

- Environment Mode now uses one Environment LLM and one deterministic Task State owner. No `environmentRouter` model role is resolved, warmed, called, reported by backend status, or rendered in the production UI.
- The shared training checkpoints remain under `out/environment-classifier/training/`; profiles store model ids and shared adapter references rather than copied weights.
- The maintained classifier schema and training tools remain offline evaluation surfaces. The production classifier runtime and public export were deleted.
- The machine-wide `etc/llm-backend.json` continues to own the default chat backend.
- No shadow execution lane, classifier fallback, or parallel graph remains active.

## Historical selectable checkpoints

The following folds were temporarily exposed during development validation. They are retained here as historical evidence but are no longer discovered, listed, or loadable by the production model registry.

The repaired four-fold development report currently exposes:

| Fold / checkpoint | Exact route | Core valid | Unsafe actions | Excess vision | Missed actions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fold 0 / 516 | 83.86% | 100% | 4 | 0 | 49 |
| Fold 1 / 510 | 58.80% | 100% | 13 | 0 | 100 |
| Fold 2 / 513 | 89.25% | 97.59% | 0 | 0 | 13 |
| Fold 3 / 513 | 42.51% | 95.37% | 71 | 19 | 1 |

The reported approximately 83% checkpoint is Fold 0 checkpoint 516, not Fold 8. At the time of live validation, the Ainekio profile selected Fold 2 checkpoint 513 through the status widget.

## Historical Fold 2 serving configuration

The following configuration and measurements record the earlier Fold 2/vLLM validation. They are retained as deployment evidence, but they are no longer the selected Ainekio runtime.

- Main model: Ollama `qwen3.5:2b`.
- Selected specialist: vLLM `unsloth/Qwen3.5-0.8B` with the profile-selected rank-16 LoRA alias.
- The specialist is text-only (`--language-model-only`), BF16, eager mode, 23% vLLM GPU allocation, and a 2,048-token context window with a 512-token output limit.
- vLLM uses the base model tokenizer because the Unsloth checkpoint labels its tokenizer class `TokenizersBackend`, which the installed Transformers runtime cannot construct. The checkpoint and cached base `tokenizer.json` and `chat_template.jinja` files have identical SHA-256 digests; only `tokenizer_config.json` differs.
- Requests use greedy temperature-zero generation with an explicit seed. Every result must pass the existing 14-field Core Environment Router contract.

## Historical Fold 2 live validation

- The profile warm-up API loaded Fold 2 checkpoint 513 successfully after the final configuration change. Cold starts measured about 59-65 seconds.
- After the final production rebuild and restart, the authenticated model-registry status reported Fold 2 checkpoint 513 as selected, enabled, configured, and loaded. The main backend reported Ollama `qwen3.5:2b`, and warming the existing `orchestrator` role made that model resident without bypassing profile model resolution.
- In that final post-restart state, vLLM used approximately 3.96 GiB and Ollama used approximately 3.83 GiB of GPU memory. No trainer process was present at that point.
- GPU coexistence was observed on the RTX 4080 during training: trainer approximately 2.4 GiB, Ollama Qwen 2B approximately 3.8 GiB, vLLM Environment Router approximately 2.3 GiB, and Blender approximately 0.3 GiB.
- vLLM advertised both the `unsloth/Qwen3.5-0.8B` base and the exact Fold 2 adapter alias through `/v1/models`.
- A compact, non-motion development request completed through Core with a valid 14-field decision and the expected no-memory/no-environment/no-vision/no-action route. Its observed end-to-end classifier latency was 4.2 seconds under concurrent GPU load.
- Repeating that same deterministic request exposed a deployment-quality gap: only one of three direct Core calls passed the strict contract. The other two omitted `memoryTier`, `memoryQuery`, and `memoryTypes` and were rejected.
- Repeating the same request through the real Environment Orchestrator node produced the same pattern: one specialist decision was accepted and two invalid specialist generations fell back to Ollama `qwen3.5:2b`.
- No code fills in missing model fields or converts incomplete output into action authority. The measured offline Fold 2 contract-valid rate therefore must not be treated as proof of equivalent live vLLM reliability.

## Current Ollama final runtime

- The completed adapter was merged and quantized as a Q4_K_M GGUF, then installed in Ollama as `environment-classifier-0.8b:final`.
- The Ainekio profile's existing `environmentRouter` default and its environment-mode mapping now both select `ollama.environment-classifier-0.8b:final`. The machine-wide main model remains Ollama `qwen3.5:2b`; no graph ownership or node wiring changed.
- The profile records the specialist as text-only with a 2,048-token context window and thinking disabled. The Environment Router remains enabled and uses the same strict 14-field Core validation and main-model fallback as before.
- The transition used the existing model-registry and backend APIs: disable the specialist, stop vLLM, assign the Ollama model to the existing role, re-enable it, and warm the selected model.
- Two non-motion calls through the Core Environment Classifier runtime returned valid 14-field decisions from provider `ollama` and model `environment-classifier-0.8b:final`. Observed latencies were 2.694 seconds and 1.437 seconds; both selected no memory, environment, vision, or action work.
- A mode-neutral warm-up also resolved the final Ollama model in 372 ms. The Core assignment handler now keeps the Environment Router default and environment-mode mapping synchronized, preventing a stale default provider from being revived by mode-neutral startup or warm-up paths.
- No vLLM process or listener on port 8000 remained after the transition, and vLLM did not restart during the live Core calls or the mode-neutral warm-up. Fold checkpoints are now training evidence only and cannot restart vLLM through the production Environment Router path.

## Historical operator controls and rollback

Before retirement, the left status widget was the profile-owned control surface:

- select an installed production Environment Router model;
- see the selected model and loaded state without development-fold inventory;
- load the current selection;
- turn the specialist off for the current profile.

Backend Settings previously identified whether the profile router used Ollama or vLLM.

The historical rollback procedure was:

1. Turn the Environment Router off in the left status widget to use the main Environment orchestrator immediately.
2. Select a different installed model in the same widget to replace the role mapping for that profile.
3. Revert the maintained source changes if the feature itself is removed; profile and `out/` data remain outside maintained source commits.

## Production fold-loader retirement

- The production runtime no longer scans `out/environment-classifier/training/`, synthesizes fold/checkpoint registry entries, or starts a fold-specific vLLM server.
- The sidebar no longer receives or renders the development-fold catalog or an Environment Router role.
- Stale `environment-classifier.<run>.fold-<n>.checkpoint-<n>` profile ids are ignored and rejected for reassignment. Their on-disk weights and reports are preserved as reproducibility evidence.
- Final-artifact vLLM configuration remains under `brain/training/environment-classifier/` for isolated evaluation tooling; it is no longer exported by the production runtime.
- The merged Ollama `environment-classifier-0.8b:final` artifact and profile history were not deleted, but the production workflow no longer resolves or calls them.

## Validation record

Passed:

- targeted Environment Classifier, runtime discovery, and Orchestrator node tests;
- `pnpm validate:environment-classifier`;
- architecture guard with zero violations;
- user-agnostic guard across 798 maintained runtime files;
- all 27 cognitive graph validations;
- TTS and voice ownership checks;
- Astro production build;
- `git diff --check`.

The production build continues to report pre-existing accessibility and Rollup warnings outside this integration.
