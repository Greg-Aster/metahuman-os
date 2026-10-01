# llama.cpp backend and System settings repair

## Baseline and ownership

- The installation's existing llama-server passed direct text and image requests,
  but the live MetaHuman configuration endpoint rejected `llama-cpp` with HTTP
  400. `BackendType`, the provider bridge, and System settings lacked that option.
- `packages/core/src/llm-backend.ts` owns deployment selection and readiness;
  `model-resolver.ts` owns device-aware role resolution; the provider bridge owns
  dispatch and input validation. The existing node-llama-cpp local-model service
  exposes a different protocol and remains a separate embedding/text service.
- The owner explicitly approved adding the backend contract, text/image support,
  and the System GUI, then requested cleanup of the affected configuration UI.
- A real browser reproduced a second failure: Local Models rendered
  `status.embedder.loaded`, but the API returns `status.loadedModels.embedder`.
  This exception interrupted settings rendering, leaving the save button stuck.
  The panel also opened a nonexistent same-origin events route and added retry
  timers, while its model cards read metadata from the wrong response level.

## Changes and removals

- Added the llama.cpp transport under the existing provider bridge, with bounded
  health/model checks, cancellation, visible transport/response failures, text and
  image message preservation, structured output and generation controls.
- Extended the canonical backend configuration, API, CLI and GUI. Server process
  lifecycle remains with the installation's existing launcher; no new service,
  process manager, registry, scheduler, dependency or remote inference path exists.
- Local chat/action roles resolve to the selected device model without rewriting
  synced profile registries. Embedding and explicit cloud/remote-server roles
  retain their owners. The registry view projects the same resolver result.
- Consolidated duplicated Auto-backend status branches and removed the redundant
  resolver fallback wrapper and an empty retired override branch.
- System → Backend now has a llama.cpp selector and editable endpoint, served
  model, context/output budgets, sampling, image capability and thinking settings.
  Backend status and model displays identify the effective provider.
- Removed Server Status's periodic polling and delayed refresh callbacks. Status
  refresh is driven by visibility, backend changes, completed actions and the
  existing refresh button. Request deadlines remain bounded failure handling.
- Repaired Local Models' status envelope and nested inventory metadata. Removed
  the nonexistent events subscription, accumulating reconnect timers and dead
  percentage-progress UI. Download admission is reported honestly; the refresh
  control obtains completion/status from the existing service. No new download
  was performed as part of this backend setup.
- Removed the handler's fabricated offline model list. Unavailable/unreadable
  inventory produces HTTP 503/502, and settings show the error. The service owns
  the actual model catalog.

## Validation

- Focused tests cover text/images, structured output, input rejection, HTTP and
  malformed-response failures, cancellation during body consumption, health
  timeout, model identity, configuration validation, owner authorization, role
  and profile isolation, UI inventory projection, and Local Models contracts.
- The running application passed text and synthetic-image inference through
  `/api/llm/chat`. Its canonical role router also returned schema-constrained JSON
  from llama.cpp. Chat/action roles resolve to the configured local model, and
  the live registry endpoint shows one effective local choice.
- All 14 focused tests pass (`llama-cpp.spec.ts`, `local-models.spec.ts`,
  `provider-contract.spec.ts`, and `vllm-multimodal.spec.ts`). The existing vLLM
  runtime-configuration and model-default tests also pass.
- Core, CLI and Site type checks pass. Site reports zero errors, warnings and
  hints across 366 files. Architecture checks report zero violations.
- The production Site build passes; compiled-runtime verification confirms Core
  matches source and validates 38 workflows. The rebuilt application was started
  through its existing launcher.
- Authenticated Chromium verification opened System → Backend, confirmed the
  selected llama.cpp model and image capability, and saved the configuration
  through its real button. Save succeeded with zero uncaught browser errors.
  The screenshot is local ignored output at `out/repairs/llama-cpp-settings.png`.
- The installation's existing inference service is running and enabled at user
  login. Model weights, launcher, process ownership and profile registries were
  preserved; no inference download was necessary.
- Full workspace and physical-robot validation were not run; no physical command
  was issued. Long persona conversations beyond the installed context budget and
  other hardware/models remain unverified.
