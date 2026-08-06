# Environment Classifier Live Integration

Date: 2026-08-05

## Scope and ownership

- The Environment Router is an ordinary `environmentRouter` model role in the existing per-profile model registry. The selected model, enable state, and model serving options persist in `profiles/<username>/etc/models.json`.
- The shared training checkpoints remain under `out/environment-classifier/training/`; profiles store model ids and shared adapter references rather than copied weights.
- `packages/core` owns checkpoint discovery, model serving, compact request construction, strict response validation, and fallback. The site only exposes those existing Core handlers through the left model-status widget and Backend Settings.
- The machine-wide `etc/llm-backend.json` continues to own the default chat backend. It selects Ollama with `qwen3.5:2b`; it does not override the profile's Environment Router role.
- No shadow execution lane or parallel graph was added. The existing Environment Orchestrator node calls the selected router live. A Core-valid specialist decision is authoritative; a missing, disabled, unavailable, or invalid result continues through the pre-existing main Environment orchestrator.

## Selectable checkpoints

Core discovers only development-scored reports whose owner is `environment-classifier`, whose locked held-out set was not used, and whose referenced adapter files and base-model contract are present. Aggregate cross-fold reports are expanded into individual selectable checkpoints.

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
- No vLLM process or listener on port 8000 remained after the transition, and vLLM did not restart during the live Core calls or the mode-neutral warm-up. Fold 2 remains available only as an explicit rollback selection; choosing it would intentionally start its vLLM server.

## Operator controls and rollback

The left status widget is the profile-owned control surface:

- select any scored checkpoint or another registered local Environment Router;
- see fold, checkpoint, quality, and loaded state;
- load the current selection;
- turn the specialist off for the current profile.

Backend Settings identifies whether the profile router uses Ollama or vLLM and keeps the main chat-backend settings separate.

Rollback does not require graph edits:

1. Turn the Environment Router off in the left status widget to use the main Environment orchestrator immediately.
2. Select a different checkpoint/model in the same widget to replace the role mapping for that profile.
3. Revert the maintained source changes if the feature itself is removed; profile and `out/` data remain outside maintained source commits.

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
