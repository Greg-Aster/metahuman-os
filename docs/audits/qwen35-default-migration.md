# Qwen3.5 Default Migration Audit

Date: 2026-07-17

## Scope and original failure

- The installed Ollama chat model is `qwen3.5:9b`; the previously configured model was not installed.
- `etc/llm-backend.json` already selects Ollama and names `qwen3.5:9b`, but role resolution reads each user's `etc/models.json` first.
- Maintained and profile registries assigned roles to the retired model. Those assignments overrode the backend default and produced Ollama 404 responses.

## Maintained runtime owners

### `packages/core/src/llm-backend.ts` and API handlers

- Owner: core backend configuration and API fallbacks.
- Technical debt: runtime fallbacks repeated the retired tag, so a missing or partial configuration silently restored a model that was not present.
- Recommended action: define one core Ollama default and use it from the backend manager and API handlers.

### `etc/models.json`

- Owner: sanitized registry copied into new profiles.
- Security/privacy finding: its active-adapter block contained a personal absolute path and an incompatible adapter, despite this file being a system default.
- Technical debt: active roles and optional discovery entries exposed a retired model, including an obsolete cloud entry.
- Recommended action: make all local default chat roles use `qwen3.5:9b`, clear the personal adapter state, and remove the legacy optional entries.

### `apps/site` and `apps/react-native`

- Owner: browser/mobile interface defaults and the maintained React Native runtime bundle.
- Technical debt: browser fallback labels and bundled runtime registries/config still advertised the retired model.
- Recommended action: use small browser-safe constants for UI fallbacks and align the React Native bundle with the maintained Qwen3.5 backend defaults.

## Confirmed orphaned files

- `scripts/update-models-json.ts` has no caller, hard-codes personal profile paths, and only performs a superseded one-time registry update.
- `etc/model_map.json` has no reader and maps Qwen3 names to unrelated Qwen1.5 repositories.
- `etc/models-qwen-coder-30b-bu.json` is an unreferenced backup of an old registry.
- `etc/agent.json.template` belongs to the superseded single-model configuration path and has no reader.

Recommended action: delete these files instead of updating dead parallel configuration paths.

## Implementation outcome

- Core, browser, React Native, LoRA-training, and full-fine-tune defaults now resolve from maintained Qwen 3.5 constants or matching JSON configuration.
- The Unsloth trainer follows the current Qwen 3.5 text-only recipe: `FastLanguageModel`, 16-bit LoRA, and language attention/MLP targets. The retired 16GB/4-bit preset was removed because Unsloth discourages QLoRA for this family.
- The full-fine-tune path uses the multimodal model/processor classes required by the Qwen 3.5 architecture.
- Local profile configuration copies and the active external Greggles profile were migrated. Incompatible adapter selections were disabled and obsolete single-model files were removed.
- Historical user memories, training logs, and generated outputs were preserved as user-owned data; they do not participate in model selection.
- An ignored, unreferenced compiled `packages/core/dist` tree was removed so stale generated fallbacks cannot be mistaken for maintained runtime code.

## Training and history cleanup

- LoRA and full-fine-tune defaults now use the Qwen3.5 9B repositories.
- Incompatible adapter selections are disabled rather than relabeled.
- Training history retains run/output evidence but describes the removed base generically.
- Active, archived, and implementation-history documentation no longer publishes the retired identifier.

## Acceptance checks

- No maintained runtime fallback, training config, compatibility fixture, or profile config names the retired model.
- New and existing profiles resolve normal chat roles to `qwen3.5:9b` and use Qwen3.5 training bases.
- Model-default and adapter compatibility tests, Python syntax checks, architecture audit, site build, and live Ollama inference pass.
