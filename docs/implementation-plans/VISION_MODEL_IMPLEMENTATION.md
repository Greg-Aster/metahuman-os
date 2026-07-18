# Vision Model Implementation

Status: backend compatibility correction implemented; native 4-bit Qwen3.5 9B
checkpoint download and live vLLM image smoke in progress

## Goal

MetaHuman OS must accept image-bearing model messages as a general platform
capability without creating a second model-selection system.

The configured user model, role/cognitive-mode mapping, active backend, and
provider bridge remain authoritative. Image content may change how the selected
provider serializes a request, but it must never cause core code to replace the
resolved provider or model.

The Environment Bridge is one generic image ingress path. MetaHuman OS must not
contain Ainekio model names, protocols, camera drivers, commands, or service
control. Ainekio and MetaHuman OS remain separately shippable programs.

## Correction Notice

The first implementation violated the repository architecture. It added a
parallel `vision` block to `etc/llm-backend.json`, detected images inside
`callProvider()`, then replaced the provider and model that the normal resolver
had already selected. This bypassed:

- the user's model registry in `profiles/<user>/etc/models.json`;
- role and cognitive-mode resolution in `model-resolver.ts`;
- active-backend selection and service ownership in `llm-backend.ts`;
- the existing model-assignment API and standard sidebar dropdown;
- the rule that only the active GPU chat backend controls model loading.

The result could call Ollama directly while vLLM was the active backend. The
hardcoded-looking `image -> qwen3.5:9b` status row was a symptom of that parallel
system. It was not a normal model assignment and had no normal dropdown.

Passing image bytes to Ollama successfully proved an Ollama payload shape, but
it did not prove a valid MetaHuman model-routing implementation. The previous
completion checkboxes and completion claim are therefore invalid.

## Existing Owners and Canonical Data Flow

The maintained system already has the required owners:

```text
Caller or graph node
  -> ProviderMessage with text/image content parts
  -> callLLM(role, cognitiveMode, user)
  -> model-resolver reads the user's models.json
  -> active-backend rules resolve the final provider/model
  -> callProvider(final provider, messages, final model options)
  -> selected provider adapter serializes the same messages
  -> configured backend service
```

- `packages/core/src/providers/types.ts` owns the provider-neutral message
  contract. It already supports `text` and `image_url` parts.
- `packages/core/src/model-resolver.ts` owns model definitions, role assignments,
  cognitive-mode mappings, and active-backend overrides.
- `packages/core/src/model-router.ts` owns role-based calls, option merging,
  response identity, and LLM audit records.
- `packages/core/src/llm-backend.ts` owns which backend is active, which local
  service may start, and which vLLM model is loaded.
- `packages/core/src/providers/bridge.ts` dispatches the already-resolved call.
  It must not run a second model resolver based on message content.
- `packages/core/src/ollama.ts` and `packages/core/src/vllm.ts` own native
  provider request shapes.
- `packages/core/src/api/handlers/model-registry.ts` and the existing sidebar
  role rows own model assignment UI and persistence.
- Environment nodes may validate and assemble visual input, but may not choose,
  start, or call an LLM provider directly.

## Architectural Rules

1. Images are message content, not a backend and not a routing exception.
2. An image request uses the same provider and model a text request with the
   same user, role, cognitive mode, and backend configuration would resolve.
3. Provider adapters may inspect content only to validate and serialize it.
   They may not change `providerName`, `model`, backend state, or role.
4. A provider that cannot preserve image content must reject the request. It
   must never flatten the request to text and continue.
5. Response and audit `modelId`, provider, and model must report the actual
   normal resolver result. No synthetic `vision.<provider>` identity is allowed.
6. Model capability and image-related model options belong to normal model
   definitions/options in the user's registry. Provider/model names do not
   belong in core branching logic.
7. `etc/llm-backend.json` remains backend service configuration. It must not
   contain a separately routed image model.
8. Only the configured active backend may own the local GPU chat path. Image
   content must not start or call a second local backend behind its back.
9. A dedicated model role is not required for image support. Environment Mode
   can use its existing node role plus a normal cognitive-mode assignment. If a
   dedicated role is ever added, it must be a canonical `ModelRole` handled by
   the existing registry, resolver, API, status, and dropdown paths—never a
   special status/config branch.

## Configuration Behavior

Image-capable models are configured exactly like other LLMs:

- The active local engine remains `activeBackend` in `llm-backend.json`.
- The model definition and role/cognitive-mode assignment remain in the
  authenticated user's `models.json`.
- For Environment Mode, the model used by its Model Router node is selected by
  the normal `environment` cognitive-mode mapping for that node's role.
- Model capability metadata such as `capabilities: ["text", "image"]` may be
  added to the existing model definition schema. It is advisory/validation
  metadata, not permission to reroute.
- Model-specific limits such as image count, image byte limit, allowed MIME
  types, context window, and reasoning behavior belong in existing model
  `options` if they must be operator-configurable. The model-registry handler
  and UI should edit those options instead of creating another backend config.
- The Environment Image Input node may keep a narrower, graph-visible transport
  limit for real-time frames. That is input-node policy, not model routing.

Qwen3.5 9B remains a local validation target, not a core default or a hardcoded
branch. It should be discovered/registered and assigned through the same model
registry controls as Qwen3 or any other model.

## Qwen3 and Qwen3.5 Residency

The corrected design does not secretly keep a text model in vLLM while calling
an Ollama image model.

- With Ollama as the active backend, normal role or cognitive-mode assignments
  may reference both Qwen3 and Qwen3.5. Ollama loads the model requested by the
  resolved call and controls residency through its normal `keep_alive` behavior.
  Whether both remain in RAM/VRAM is an Ollama/runtime capacity decision, not a
  MetaHuman vision exception.
- With vLLM as the active backend, vLLM serves one configured model. Image input
  works only if that active model and its chat template support images. If they
  do not, the request must fail clearly.
- To use the Ollama Qwen3.5 model after running vLLM, switch the active backend
  through the existing backend control. The existing switch path stops/unloads
  the other GPU backend before starting the selected one.
- Remote providers may coexist only through their already-supported provider
  routing. Image support does not create a new coexistence rule.

### Retired AWQ label versus loaded checkpoint

An earlier AWQ label in Greggles' Model Settings did not identify the checkpoint
vLLM actually served that morning. Live artifact, telemetry, manifest, and
launch-history inspection on 2026-07-15 established that the cached repository
contained tokenizer/config metadata but no safetensors weights, while the launch
used a GGUF from Ollama's blob store. Complete-artifact discovery therefore
omits that partial snapshot instead of presenting it as an installed checkpoint.
The later Qwen 3.5 migration removed the stale registry identity and retired
incompatible adapter selections.

## Backend Model Compatibility Correction — 2026-07-15

The Ollama `qwen3.5:9b` artifact is a GGUF checkpoint stored in Ollama's blob
layout. Pointing vLLM at that blob with `--load-format gguf` failed before the
server could start because the installed vLLM/Transformers environment does not
support the GGUF `qwen35` architecture. The fact that a model appears in the
shared local-model dropdown is therefore not sufficient evidence that every
backend can load that artifact.

This is corrected in the existing backend-control architecture rather than with
a Qwen-specific exception:

- [x] Read generic architecture, model type, file type, and quantization
  metadata from Ollama artifact config blobs during normal artifact discovery.
- [x] Add a vLLM artifact preflight owned by `packages/core/src/vllm.ts` that
  checks the installed vLLM model registry, Transformers/GGUF loaders, and
  safetensors quantization methods before any running backend is stopped.
- [x] Enforce the same preflight from the core backend switch/start path so API,
  UI, and future callers cannot bypass it.
- [x] Expose preflight through the existing thin vLLM handler and display its
  result in Backend Settings. Incompatible artifacts are labelled and cannot be
  saved, started, or restarted as vLLM models.
- [x] Keep model path, load format, quantization, tokenizer, and served name in
  the existing vLLM configuration. Backend Settings may derive these values
  from the selected artifact, while Advanced Settings remains available for
  operators who need an explicit checkpoint.
- [x] Add a normal quantization control to Backend Settings rather than encoding
  a model-specific launch branch.
- [x] Extend the generic local artifact inventory to include complete
  safetensors snapshots in the Hugging Face cache. Cached checkpoints now use
  the same Backend Settings dropdown and installed-vLLM architecture preflight
  as Ollama-store artifacts; partial downloads are never advertised.
- [x] Make the normal `vllm.active` registry slot report the checkpoint selected
  by Backend Settings while retaining the authenticated user's registry-owned
  roles, capabilities, and options. This removes stale Qwen3 identity after a
  backend model change without creating a second assignment system.
- [x] Complete and discover the official `Qwen/Qwen3.5-9B` BF16 checkpoint,
  then verify its `Qwen3_5ForConditionalGeneration` architecture against the
  installed vLLM 0.18.1 model registry. This checkpoint is 19,306,310,880
  weight bytes and was removed after compatibility validation because it is
  not an acceptable deployment target for this 16 GB system.
- [x] Correct the shared preflight parser so informational lines emitted by
  vLLM before its JSON result do not turn a compatible checkpoint into an
  `unknown` result.
- [ ] Download and discover a native 4-bit Qwen3.5 9B vision checkpoint. The
  selected deployment target is `sanskar003/Qwen3.5-9B-AWQ`, a W4A16
  compressed-tensors checkpoint with an 8,550,134,696-byte weight file. This
  replaces the earlier in-flight BitsAndBytes plan because load-time
  quantization reduces VRAM use but still requires the full BF16 download on
  disk.
- [ ] Configure the quantized checkpoint through `etc/llm-backend.json`, start
  it through the normal vLLM manager, and prove text plus image requests.

No provider or model name is hardcoded into routing. The selected checkpoint is
an operator configuration value and may be replaced through the same Backend
Settings controls as any other compatible vLLM model.

## vLLM Runtime Controls Upgrade — 2026-07-15

The Backend tab now exposes vLLM capabilities through the existing backend
configuration and profile model channels. These controls are generic vLLM
features and contain no Qwen, vision, Environment Bridge, or Ainekio-specific
branching.

### GPU allocation and context

- [x] Preserve fixed `gpuMemoryUtilization` for operators who want a stable
  total-device allocation.
- [x] Extend the existing automatic allocation mode with configurable VRAM
  headroom and an automatic-allocation ceiling. Each vLLM start reads live free
  and total VRAM, subtracts the requested headroom, and converts the remainder
  into vLLM's total-device utilization fraction.
- [x] Show the calculated allocation and current GPU-memory explanation in the
  Backend tab without saving or starting a service.
- [x] Support vLLM's native `--max-model-len auto` policy. vLLM profiles the
  loaded weights and KV cache, uses the checkpoint's maximum context if it
  fits, and otherwise selects the largest context that fits the memory budget.
- [x] Retain a manual token limit for reproducible deployments.
- [x] Add an optional explicit GPU KV-cache budget. A non-zero value maps to
  `--kv-cache-memory-bytes`; zero leaves KV sizing under vLLM's normal memory
  profiler.

Model file size is not used as a context estimate. Quantization, runtime dtype,
vision-encoder memory, CUDA workspaces, KV dtype, model architecture, and active
GPU consumers all affect the real budget. The authoritative calculation is
therefore performed by vLLM after it loads the selected checkpoint. MetaHuman's
automatic allocator only establishes how much physical VRAM vLLM may use and
how much must remain free for the desktop and other GPU services.

### CPU offloading

- [x] Add configurable model-weight offload in GiB through
  `--cpu-offload-gb`.
- [x] Add configurable KV-cache offload in GiB through
  `--kv-offloading-size`.
- [x] Expose the installed native vLLM KV offloader and optional LMCache
  backend. The UI states that LMCache requires its separate Python dependency.
- [x] Keep every offload value at zero by default. Offloading is a capacity
  fallback because CPU/GPU transfers reduce inference speed.

### LoRA serving

- [x] Reuse the existing authenticated profile `models.json` LoRA registry and
  `/api/vllm/loras` handler; do not duplicate adapter selection in the system
  backend file.
- [x] Add adapter selection and metadata to the Backend tab, with controls for
  maximum rank, active adapters per batch, CPU-cached adapters, and LoRA dtype.
- [x] Pass the same profile settings to manual API start/restart, launcher-owned
  CLI start/restart, and provider auto-start paths.
- [x] Map these settings to `--enable-lora`, `--lora-modules`,
  `--max-lora-rank`, `--max-loras`, `--max-cpu-loras`, and `--lora-dtype`.
- [x] Continue rejecting PEFT LoRA loading on the GGUF startup path. The UI
  explains that a compatible Hugging Face checkpoint is required.
- [x] Validate adapter names and installed vLLM rank/dtype/count constraints
  before persisting profile configuration.
- [x] Filter enabled adapters at launch using a generic model-family and
  parameter-scale compatibility key. Equivalent quantized repositories may
  share an adapter, while a 14B adapter is never attached to a 9B checkpoint.

Existing Qwen3 adapters are not silently attached to Qwen3.5. Adapter metadata
remains visible, while the launch owner excludes incompatible base-model
adapters even if they remain enabled for later use with their original model.

## Ollama Backend Controls Upgrade — 2026-07-15

The Ollama card in Settings -> Backend -> Local Service Control now uses the
same backend configuration, shared artifact inventory, profile adapter source,
and provider bridge already owned by the maintained system. It does not add an
Ollama-specific model router or image route.

### Installed model and generation controls

- [x] Replace the free-text-only default model field with an installed-model
  dropdown populated by the shared local artifact registry. Keep an explicit
  custom model-name fallback for remote or nonstandard Ollama endpoints.
- [x] Show discovered architecture, quantization, and artifact size for the
  selected installed model.
- [x] Add context-window and maximum-output-token controls to the normal
  `ollama` backend configuration.
- [x] Add advanced temperature, top-p, top-k, min-p, repeat-penalty, optional
  seed, keep-alive, endpoint, and model-native-thinking controls.
- [x] Correct the existing endpoint handoff so backend status and provider
  inference configure the shared Ollama client from the persisted endpoint;
  the endpoint field is no longer display-only.
- [x] Validate every new backend setting in the existing core configuration
  handler before it is persisted.
- [x] Apply saved Ollama settings in the existing provider bridge only as
  defaults. Explicit model-registry or cognitive-graph request options remain
  authoritative and can override them.
- [x] Extend the native Ollama request builder with `min_p` and `seed`; no
  direct request code was added to the settings UI.

### Ollama LoRA behavior

Ollama does not expose vLLM-style per-request PEFT adapter selection. Its
supported workflow packages the exact base model and adapter into a derived
Ollama model using `FROM`, `ADAPTER`, and `ollama create`. The derived result is
then an ordinary installed model and uses the same dropdown, backend config,
provider bridge, status, and image pipeline as every other Ollama model.

- [x] Reuse the existing authenticated profile adapter discovery and generic
  base-family/parameter-scale compatibility check; do not scan or persist a
  second adapter registry.
- [x] Add a core-owned packaging action using argument-safe process execution,
  a private temporary Modelfile, the configured Ollama endpoint, a bounded
  timeout, cleanup, and an audit event.
- [x] Make `Build & use` select the newly created normal Ollama model through
  `ollama.defaultModel`; no runtime LoRA routing exception remains afterward.
- [x] Disable incomplete adapters, exact-base mismatches, and safetensors
  adapter families Ollama does not support, with the reason visible in the UI.
- [x] Keep already merged and previously derived models in the main installed
  model dropdown rather than presenting them as hot-loadable LoRAs.
- [x] Do not attach existing Qwen3 14B adapters to Qwen3.5 9B. Current Ollama
  documentation lists safetensors adapter import for Llama, Mistral, and Gemma
  families, so Qwen PEFT rows remain visible but direct Ollama packaging is
  disabled; vLLM remains the supported PEFT path for those adapters.

Primary behavior references: [Ollama Modelfile reference](https://docs.ollama.com/modelfile)
and [Ollama model import guide](https://docs.ollama.com/import).

## Removal-First Work

No replacement implementation should be accepted until the parallel route is
removed. These removals are mandatory.

### Delete the parallel vision subsystem

- [x] Delete `packages/core/src/vision.ts` rather than refactoring it in place.
  It mixes content validation, backend config, provider clients, model routing,
  readiness, and status in one new owner.
- [x] Delete `packages/core/src/vision.spec.ts`; replace it later with tests of
  the normal resolver/router/provider chain.
- [x] Delete or completely rewrite `scripts/smoke-vision.ts`. A valid smoke must
  call `callLLM()` or execute Environment Mode with user context. It must not
  call `resolveVisionModelRoute()` or directly select `callProvider()`.
- [x] Remove the `./vision` package export and root core re-export.

### Remove the second configuration source

- [x] Remove the entire `vision` object from `etc/llm-backend.json`.
- [x] Remove `VisionProvider`, `VisionModelConfig`, `BackendConfig.vision`, its
  defaults, deep merge, and save merge from `llm-backend.ts`.
- [x] Remove vision validation from `llm-backend-config.ts`.
- [x] Remove vision config/status assembly from `llm-backend-status.ts`.
- [x] Do not migrate the removed values to another hidden system config. Any
  desired model/options must be saved through the existing user model registry.

### Remove routing overrides and false identity

- [x] Remove all image-triggered provider/model replacement from
  `providers/bridge.ts`, including `resolveVisionModelRoute()`,
  `getVisionModelStatus()`, `requireVision`, and the direct Ollama/vLLM branches.
- [x] Restore the normal backend health check, Big Brother decision, and active
  backend dispatch. Add content rejection only at adapters that cannot preserve
  images; never use rejection as a reason to choose another provider.
- [x] Remove `requireVision`, vision-only `contextWindow`, and vision-only
  `enableThinking` flags from `ProviderOptions`. If context/reasoning options are
  later needed generally, reintroduce them as normal model options for every
  call, with no image condition.
- [x] Remove synthetic `vision.<provider>` model IDs from `model-router.ts`.
  Keep the resolved model ID and actual provider response identity.
- [x] Remove `VisionInputError` coupling from `llm-proxy.ts`. Any multimodal
  validation error must be provider-neutral and must not own routing.

### Remove special API and UI branches

- [x] Remove `systemHealth.visionModel` from the unified status handler.
- [x] Remove the standalone Image Model panel, state, and save method from
  `BackendSettings.svelte`.
- [x] Remove the hardcoded image row and `VisionModelStatus` state from
  `LeftSidebar.svelte`.
- [x] Use the normal role/cognitive-mode model dropdown and standard status data.
  If capability is shown, render it as metadata on the normally resolved model.

### Detach Environment nodes from the deleted subsystem

- [x] Remove the `vision.ts` import from `environment/image-input.node.ts` and
  restore or replace its small local/provider-neutral frame validator.
- [x] Keep the generic Image Input to Context Builder graph edge, subject to a
  topology test. Changing nodes/graph wiring is the allowed integration seam.
- [x] Keep prompt sanitization that prevents base64 image bytes from being
  duplicated into textual context.
- [x] Change graph comments that mention a separately configured vision model
  to describe the normally selected model.

## Proper Implementation Work

### 1. Preserve content through the existing router

- [x] The shared `ProviderMessageContent` type already represents structured
  `text` and `image_url` parts.
- [x] The vLLM client already preserves structured content arrays in its
  OpenAI-compatible request.
- [x] Ensure every maintained API that accepts messages preserves structured
  content and supplies authenticated user context to normal model resolution.
- [x] Keep `callLLM()` model resolution unchanged by content modality.
- [x] Add provider-neutral validation in the narrowest existing input/provider
  owner. It may validate data URLs, size, MIME type, and count, but it must not
  import backend config or provider clients and must expose no routing/status
  functions.

### 2. Serialize in the selected provider adapter

- [x] In the Ollama adapter, convert selected request content into Ollama's
  native `messages[].content` plus `messages[].images` shape. Use the model name
  already passed in `ProviderOptions`.
- [x] In the vLLM adapter, keep passing OpenAI-compatible content arrays without
  rewriting them.
- [x] Reject image content before any text-flattening adapter path such as an
  unsupported Big Brother, legacy mobile, local-model, or remote provider.
- [x] Never fetch remote image URLs server-side unless a separate, reviewed
  security contract explicitly adds that behavior.

### 3. Use normal model capability/configuration data

- [x] Extend the existing model definition schema with generic input modality
  capability metadata if runtime discovery alone is insufficient.
- [x] Populate capabilities from provider discovery where authoritative (for
  example, Ollama's reported model capabilities); do not infer capability from
  names such as `qwen`, `llava`, or `vision`.
- [x] Make the standard model assignment UI show or filter image-capable models
  when configuring a graph/cognitive-mode mapping.
- [x] Ensure a missing/incorrect capability produces a clear error for the
  selected model and does not fall back to another model or backend.
- [x] Store configurable image model options through the existing user model
  registry handler and Settings/Tools model controls.

### 4. Wire Environment Mode through normal selection

- [x] Environment Observation, Image Input, and Context Builder are generic and
  contain no Ainekio-specific behavior.
- [x] Context Builder can produce a normal structured model message.
- [x] Configure Environment Mode's Model Router node with a normal existing role
  and resolve that role through `cognitiveModeMappings.environment`.
- [x] Add a normal user-registry migration/configuration path for the
  `environment` mapping; do not edit live user data from core request code.
- [x] Execute the graph through `callLLM()` with authenticated user context.
- [x] Keep Ainekio responsible only for publishing generic visual observations
  through the Environment Bridge.

### 5. Reuse standard status and settings channels

- [x] Make status compute the same effective default plus cognitive-mode role
  assignments as the model-registry API.
- [x] Show the normally resolved role/model/backend and optional capability
  metadata in the standard sidebar row/dropdown.
- [x] Keep backend Settings limited to backend/service configuration.
- [x] Put model selection and model options in the existing model registry
  controls. Do not recreate an Image Model panel under another name.

## Validation Gates

### Gate A: prove the bypass is gone

- [x] A repository search finds no `resolveVisionModelRoute`,
  `getVisionModelStatus`, `requireVision`, `VisionModelConfig`, or
  `systemHealth.visionModel` in maintained source.
- [x] `etc/llm-backend.json` has no `vision` key.
- [x] Sending the same role/user/cognitive mode with text-only and image-bearing
  messages resolves the same model ID and provider.
- [x] An image request cannot start or call Ollama when vLLM is the selected
  active backend.

### Gate B: prove provider serialization

- [x] A captured Ollama request contains the exact selected model, text, and raw
  base64 in `messages[].images`.
- [x] A captured vLLM request contains the exact selected model and unchanged
  OpenAI-compatible content array.
- [x] Every unsupported adapter fails explicitly before discarding image parts.
- [x] Audit output reports the actual resolved model/provider and may record
  image count without inventing a second model identity.

### Gate C: prove normal configuration and Environment Mode

- [ ] Configure Qwen3.5 9B through the authenticated user's normal model
  registry/role/cognitive-mode controls.
- [x] Confirm the sidebar uses the same dropdown component and assignment API as
  other model rows; no hardcoded image row exists.
- [ ] Send a deterministic bounded JPEG through the generic Environment Bridge,
  Image Input, Context Builder, Model Router, and selected provider.
- [x] The smoke test uses `callLLM()`/graph execution and fails if the registry
  assignment or active backend is wrong.
- [ ] Repeat with a text-only model selected and confirm a clear unsupported
  image error with no fallback.

### Gate D: repository acceptance

- [x] `pnpm validate:graphs`
- [x] `pnpm -s check:architecture`
- [x] focused router/provider/environment tests
- [x] `pnpm --dir apps/site build`
- [x] focused core typecheck for changed files; record unrelated existing debt
- [x] `git diff --check`

## Completion Requirements

This goal is complete only when:

1. The parallel vision config, resolver, status, UI, and direct smoke path have
   been removed.
2. Images remain in the general provider message contract from maintained API or
   graph input to the already-selected provider adapter.
3. Model and backend selection use only the normal user registry, role/cognitive
   mapping, resolver, and active-backend path.
4. Ollama and vLLM serialize images correctly when they are the selected backend
   and model.
5. Unsupported selected models/providers fail clearly without rerouting or
   flattening image content.
6. Settings and the left status widget reuse normal model controls and truth.
7. A generic Environment Bridge observation reaches the normally resolved model
   without Ainekio code in MetaHuman OS.
8. Automated payload, routing, graph, status/UI, architecture, and build checks
   pass, followed by one real local image smoke through the normal route.
9. This document records the final diff and validation evidence before its
   status returns to complete.

## Work Log

- [x] 2026-07-15: Reviewed the maintained architecture contracts and current
  model registry, resolver, router, backend, provider, API, Environment Mode,
  status, and Settings/Tools owners.
- [x] 2026-07-15: Identified the image-triggered provider/model override and
  standalone backend/status/UI configuration as a parallel system.
- [x] 2026-07-15: Withdrew the previous completion claim and replaced it with
  this removal-first correction plan.
- [x] 2026-07-15: Deleted the parallel vision module/tests/config/export and
  removed image-driven provider/model overrides, synthetic identities, special
  status data, the special backend panel, and the hardcoded sidebar image row.
- [x] 2026-07-15: Added provider-neutral image validation and options to the
  existing provider message contract. Remote URLs are rejected; JPEG, PNG, and
  WebP data URLs remain structured until the selected adapter serializes them.
- [x] 2026-07-15: Added native Ollama image serialization and preserved the
  existing OpenAI-compatible vLLM content array. Unsupported text-flattening
  adapters now reject image content before conversion.
- [x] 2026-07-15: Extended the normal model registry/resolver/status data with
  generic capabilities and model options. Ollama discovery maps its reported
  `completion` and `vision` capabilities to `text` and `image` without model
  name inference.
- [x] 2026-07-15: Added Environment Mode assignment and per-model input controls
  under normal Model Settings, plus capability badges on the standard sidebar
  model row/dropdown.
- [x] 2026-07-15: Rewrote `scripts/smoke-vision.ts` and added
  `pnpm smoke:vision`. It resolves the authenticated user's Environment Mode
  `persona` assignment through `callLLM()` and never selects a provider/model.
- [x] 2026-07-15: Confirmed local `qwen3.5:9b` metadata reports `completion`,
  `vision`, `tools`, and `thinking`. It is a discovery/configuration target,
  not a core default.
- [x] 2026-07-15: Confirmed Greggles' registry initially resolved Environment
  Mode to a stale metadata-only AWQ identity while vLLM actually launched an
  Ollama-store GGUF. The later Qwen 3.5 migration removed that stale identity.
- [x] 2026-07-15: Reproduced the vLLM startup failure for the Ollama
  `qwen3.5:9b` GGUF and confirmed its architecture is `qwen35`, which the
  installed vLLM/Transformers GGUF loaders reject.
- [x] 2026-07-15: Added artifact metadata discovery, cached vLLM compatibility
  preflight, switch/start enforcement, and Backend Settings compatibility
  feedback. The current unsupported GGUF is now rejected before the active
  backend is disrupted.
- [x] 2026-07-15: Extended compatibility evidence to include a discovered
  safetensors checkpoint's quantization method. The installed vLLM 0.18.1
  environment registers both `Qwen3_5ForConditionalGeneration` and
  `compressed-tensors`; unsupported quantization formats now fail before start.
- [x] 2026-07-15: Corrected `vllm.active` runtime identity so the resolver and
  model-registry UI reflect the configured backend checkpoint rather than a
  stale model name persisted during an earlier assignment.
- [x] 2026-07-15: Added complete Hugging Face safetensors cache discovery and
  vLLM model-registry preflight so the official checkpoint becomes a verified
  installed-model dropdown option after download.
- [x] 2026-07-15: Added native vLLM LoRA, model-weight offload, KV-cache
  offload, explicit KV budget, live headroom-based GPU allocation, and
  memory-fitted context settings through the existing core backend/profile
  owners and Backend tab.
- [x] 2026-07-15: Corrected launcher parity so enabled profile LoRAs are used by
  launcher-owned CLI starts as well as authenticated API and provider
  auto-start paths.
- [x] 2026-07-15: Reproduced an empty Environment response after switching the
  active backend to Ollama. The model and service were healthy; Qwen3.5 used
  Ollama's native `message.thinking` channel and exhausted the graph's
  2048-token output budget before producing `message.content`.
- [x] 2026-07-15: Made the existing per-model `enableThinking` option
  authoritative in the generic Ollama adapter. Unspecified/disabled thinking
  now sends `think: false`; explicitly enabled native reasoning is preserved
  separately, and a reasoning-only truncated result becomes a clear incomplete
  response instead of an empty graph result.
- [x] 2026-07-15: Increased the Server Status request allowance from 5 to 15
  seconds and stopped reporting expected status-request timeouts as backend
  failures. This removes the misleading right-sidebar `AbortError` burst while
  retaining real network/server errors.
- [x] 2026-07-15: Upgraded the existing Ollama Local Service Control card with
  an installed-model dropdown, context/output limits, advanced sampling and
  residency controls, thinking defaults, and profile LoRA compatibility.
- [x] 2026-07-15: Routed every Ollama setting through the existing backend
  config handler and provider bridge. Compatible LoRAs are packaged as normal
  derived Ollama models; unsupported or mismatched adapters are never attached.
- [x] 2026-07-15: The official `Qwen/Qwen3.5-9B` BF16 safetensors download
  completed and shared discovery found all four weight shards. After fixing
  the preflight stdout parser, installed vLLM 0.18.1 reported
  `Qwen3_5ForConditionalGeneration` compatible.
- [x] 2026-07-15: Rejected the full BF16 checkpoint as the deployment artifact.
  Native 4-bit weights are required so both storage and runtime loading match
  the 16 GB GPU constraint; in-flight BitsAndBytes was not sufficient because
  it only changes the loaded representation.
- [x] 2026-07-15: Removed the completed 19 GB unquantized Hugging Face cache
  after recording discovery and compatibility evidence. The active download is
  now only the 8.55 GB native 4-bit deployment checkpoint.
- [ ] 2026-07-15: Native 4-bit Qwen3.5 9B download, discovery, and live
  text/image evidence remain open.
- [ ] Operator Gate C remains: switch the active backend through existing
  Backend Settings if Ollama is desired, assign `qwen3.5:9b` through Model
  Settings, then run the real bounded image smoke and the text-only negative
  case. Live user configuration was intentionally not mutated by implementation
  or test code.

## Implemented Vision-Scope Diff

- General contracts and routing: `providers/types.ts`, `model-resolver.ts`,
  `model-router.ts`, and `providers/bridge.ts`.
- Native payload owners: `ollama.ts` and the existing `vllm.ts` client.
- Maintained APIs and status: `llm-proxy.ts`, `model-registry.ts`, and
  `status.ts` handlers.
- Environment seam: Image Input, Context Builder/helper sanitation, and the
  `environment-mode.json` image edge to the normal Model Router node.
- Standard UI: `ModelRegistrySettings.svelte`, `SystemSettings.svelte`, and
  capability metadata in `LeftSidebar.svelte`.
- Configuration/template: the normal `cognitiveModeMappings.environment`
  entry in `etc/models.json`; no image model exists in `llm-backend.json`.
- Verification: provider payload tests and the normal-route
  `scripts/smoke-vision.ts` command.

## Validation Evidence — 2026-07-15

- `node --import tsx packages/core/src/providers/multimodal.spec.ts`: pass.
  Covers limits, MIME/data URL handling, no remote fetch, unsupported adapter
  rejection, selected text-model rejection, Ollama native payload and thinking
  normalization, Environment node flow, resolution invariance, graph topology,
  and forbidden old owners.
- `node --import tsx packages/core/src/vllm-multimodal.spec.ts`: pass. Captured
  request builder retains the selected model and unchanged structured content.
- `node --import tsx packages/core/src/vllm-runtime-config.spec.ts`: pass.
  Covers live-memory planning math, automatic context arguments, explicit KV
  budgeting, CPU weight/KV offload arguments, LoRA serving arguments, and the
  GGUF LoRA guard.
- `node --import tsx packages/core/src/ollama-lora.spec.ts`: pass. Covers model
  naming, Modelfile generation, supported-family checks, exact-base matching,
  and clear Qwen safetensors rejection for Ollama packaging.
- `node --import tsx packages/core/src/providers/multimodal.spec.ts`: pass after
  extending the native request assertions for context, output tokens, top-k,
  min-p, seed, and keep-alive.
- `pnpm -s check:architecture`: pass, 0 current violations after rerunning
  outside the restricted tsx IPC sandbox.
- `pnpm --dir apps/site build`: pass with the repository's existing warnings;
  the upgraded Ollama settings and thin `/api/ollama/loras` transport compile
  into the production server/client bundles.
- Direct profile launch-resolution check: pass. Retired adapters do not resolve
  for the Qwen3.5-9B target, so incompatible training output cannot be selected.
- `pnpm validate:graphs`: pass, 20 valid / 0 invalid.
- `pnpm -s check:architecture`: pass, 0 current violations.
- `pnpm --dir apps/site build`: pass. Existing repository warnings remain.
- Live host Ollama checks: `/api/llm-backend/status` returned healthy Ollama in
  28 ms; direct `qwen3.5:9b` chat returned `OLLAMA_OK`; the maintained source
  `callLLM()` route with Greggles' Environment/persona assignment returned
  `SOURCE_ROUTE_OK` from provider `ollama`, model `qwen3.5:9b`.
- `pnpm smoke:vision -- --user greggles --image
  vendor/llama.cpp/tools/mtmd/test-1.jpeg`: pass through the normal
  Environment/persona resolver and active Ollama backend. With an unambiguous
  bounded-image prompt, Qwen3.5 returned `MEN WALK ON MOON`. This proves the
  maintained image payload/provider path; the full live Environment Bridge
  graph gate still requires the rebuilt server process to be restarted.
- Core TypeScript check: 113 existing diagnostic output lines overall and zero
  diagnostics in the vision-scope files after the two introduced diagnostics
  were fixed.
- `git diff --check`: pass.
- Forbidden-owner search: no maintained-source matches.
- JSON parse checks for `llm-backend.json`, `models.json`, and Environment Mode:
  pass.
- The persisted backend remains on its previous fixed 0.75 GPU allocation,
  4096-token context, and zero offload values. Validation did not restart vLLM
  or change the user's active model; the new automatic controls take effect
  only after the operator saves them and starts/restarts the service.
- `node --import tsx scripts/smoke-vision.ts -- --user greggles --resolve-only`:
  pass; it reports the current normal vLLM target and `ready: false`, correctly
  indicating that the current selected model has not been configured as
  image-capable. The operator-facing wrapper is `pnpm smoke:vision`.

## Deferred Beyond This Goal

- Continuous video ingestion and video-model APIs.
- Camera drivers, frame capture, and hardware codecs.
- Ainekio-specific transport, motion, safety, or simulator behavior.
- Durable image/video archives.
- Image generation and editing; this goal concerns image input to language
  models.
