# Consolidation Progress

This document tracks the MetaHuman cleanup/refactor. The kickoff and first full-plan cleanup are complete. The active goal is now the bounded follow-up consolidation plan below.

## Active Follow-Up Consolidation Goal

Started on 2026-07-01 after the architecture baseline reached 75 remaining `custom-api-route` violations.

This follow-up goal is finished only when all of these are true:

- The architecture guardrail has no active drift:
  `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline` passes.
- The guardrail baseline has either zero violations or only explicitly documented non-actionable exceptions with owner, rationale, and next review trigger.
- Every remaining custom Astro API route in the current 75-route baseline is handled in one of these ways:
  - converted to thin `astroHandler` transport over a core or documented brain/service owner,
  - replaced by an existing unified route,
  - or documented as an exception because it is intentionally app-local transport/process glue.
- `packages/core` still has no imports from apps, brain, Astro, Svelte, or local runtime data.
- `brain/*` uses public `@metahuman/core` exports instead of deep `packages/core/src/...` imports.
- The remote-safety checks remain green and no personal/runtime/local agent data is added back to tracked source.
- `pnpm -s typecheck:core` is either green, or every remaining failure is grouped in a scoped TypeScript debt report under `docs/audits/` with owner area and non-blocking rationale.
- Six coding helper-agent lanes for this active goal have reported patches/findings and are closed.
- Final verification results are recorded in this document.

The plan must stop at those criteria. New product features, UI redesigns, unrelated cleanups, and full line-by-line rewrites require a new goal.

## Active Follow-Up Helper-Agent Lanes

Launched on 2026-07-01:

- McClintock: non-streaming agency desire workflow routes.
- Russell: agency desire streaming/model workflow routes.
- Gauss: queue, operator proposal, and agent API routes.
- Godel: adapters, addons, and training setup routes.
- Volta: service/status/process/stream API routes outside the other lanes.
- Wegener: focused core TypeScript debt and unified API type mismatches.

All six lanes are closed for this active follow-up. Their route migrations, behavior notes, and validation results have been integrated into the sections below.

## Active Follow-Up Baseline

Current starting point for this active goal:

- `custom-api-route`: 75 remaining Astro API routes that still own custom logic.
- `pnpm -s typecheck:core`: red due broad existing TypeScript debt.

The active implementation sequence is:

1. Integrate helper-agent route migration patches by disjoint owner area.
2. Refresh the architecture baseline only after intentional cleanup or documented exceptions.
3. Keep `./bin/audit check`, `git diff --check`, and `pnpm --dir apps/site build` green after each accepted batch.
4. Drive `pnpm -s typecheck:core` toward green; if full green is not technically practical within the route consolidation scope, record the remaining grouped debt under `docs/audits/` before finishing.
5. Mark this active goal complete only after the finish criteria above are satisfied.

## Active Follow-Up Progress - 2026-07-01

Completed locally after creating the active goal:

- Added this active follow-up goal, stop criteria, helper-agent lane list, and implementation sequence to this progress document.
- Launched six coding helper-agent lanes:
  - McClintock: non-streaming agency desire workflow routes.
  - Russell: agency desire streaming/model workflow routes.
  - Gauss: queue, operator proposal, and agent API routes.
  - Godel: adapters, addons, and training setup routes.
  - Volta: service/status/process/stream API routes outside the other lanes.
  - Wegener: focused core TypeScript debt and unified API type mismatches.
- Converted `/api/response-pipeline` to a thin `astroHandler` route over `packages/core/src/api/handlers/response-pipeline.ts`.
- Registered `POST /api/response-pipeline` in the unified core router.
- Extended the response-pipeline result type to match existing failure payload fields.
- Refreshed the architecture baseline from 75 to 71 `custom-api-route` violations. This removed `/api/response-pipeline` plus three already-thin babysitter routes that had been stale in the baseline.

Validation for this local batch:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 71 baselined `custom-api-route` violations.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due existing broad TypeScript debt; the previous `response-pipeline.ts` result-shape errors are no longer reported.

Integrated helper-agent coding lanes:

- McClintock: moved nine non-streaming agency desire workflow routes into core handlers and thin Astro transport.
- Russell: moved seven streaming/model agency desire workflow routes into `agency-workflows` core handlers while preserving SSE formats.
- Gauss: moved queue, operator proposal, and agent control routes into core handlers and thin transport; added abort-signal propagation for SSE cleanup.
- Godel: moved adapters, addons, and training setup routes into core handlers while keeping long-running training execution in `brain/training` scripts.
- Volta: moved the three read-only babysitter service/status routes into core handlers.
- Wegener: reduced core TypeScript handler debt; after a local `trainingEnv` type fix, `pnpm -s typecheck:core` no longer reports `src/api/handlers/*` diagnostics.

Combined state after all six helper lanes:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 37 baselined `custom-api-route` violations.
- Remaining baseline is now entirely service/status/process routes.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due non-handler TypeScript debt in graph execution, cognitive layers, connectors, encryption manager, event bus, legacy CLI adapters, and node schemas.

## Active Follow-Up Godel API Pass - 2026-07-01

Completed for the adapters/addons/training setup lane:

- Moved `/api/adapters` management logic into `packages/core/src/api/handlers/adapters.ts`.
- Kept adapter dataset metadata/config ownership in core while routing long-running LoRA/training work to `brain/training` scripts.
- Extended `packages/core/src/api/handlers/addons.ts` to own addon install, install-stream, and toggle behavior.
- Preserved addon streaming as unified SSE through `astroHandler`; no scoped addon route remains an explicit exception.
- Extended `packages/core/src/api/handlers/training.ts` for training launch, load-model, and operation-status routes.
- Converted these scoped Astro routes to thin `astroHandler` transport:
  `/api/adapters`, `/api/addons/install`, `/api/addons/install-stream`, `/api/addons/toggle`,
  `/api/training/[operation]`, `/api/training/launch`, and `/api/training/load-model`.
- Refreshed the architecture baseline to 37 `custom-api-route` violations after integrating current route migrations in the worktree.

Validation:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 37 baselined `custom-api-route` violations.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s exec tsc --noEmit --project packages/core/tsconfig.json --pretty false`: still not green due existing broad TypeScript debt; focused filtering found no errors in the changed API handler/router files.

## Active Follow-Up Final Route Consolidation - 2026-07-01

Completed the remaining current `custom-api-route` baseline.

Final route batches moved into core handlers and thin Astro transport:

- Lizard-brain/event/system service routes: `/api/lizard-brain/logs`, `/api/lizard-brain/trigger-review`, `/api/event-bus-status`.
- Sync/status/process routes: `/api/memory/sync/[id]`, `/api/template-watch`, `/api/astro-servers`, `/api/process-stream`, `/api/tts-queue-stream`.
- Voice training/upload routes: `/api/rvc-training`, `/api/sovits-training`, `/api/voice-training`, `/api/audio/upload`, `/api/voice-profile/upload`.
- Big Brother and local process routes: `/api/big-brother-status`, `/api/big-brother-input`, `/api/big-brother/terminal-events`, `/api/node-pipeline`, `/api/boot`, `/api/claude-session`.
- Encryption/profile routes: `/api/encryption/setup`, `/api/profile-path/encrypt`, `/api/profile-path/decrypt`.
- Service control routes: `/api/kokoro-addon`, `/api/kokoro-server`, `/api/rvc-addon`, `/api/rvc-server`, `/api/sovits-server`, `/api/whisper-server`.
- Final SSE routes: `/api/buffer-stream`, `/api/monitor/stream`, `/api/tts-stream`.

Core owners added for the final batch include:

- `packages/core/src/api/handlers/tts-service-routes.ts`
- `packages/core/src/api/handlers/whisper-server.ts`
- `packages/core/src/api/handlers/buffer-stream.ts`
- `packages/core/src/api/handlers/monitor-stream.ts`
- `packages/core/src/api/handlers/tts-stream.ts`

Final active follow-up status:

- Architecture baseline: zero violations in `docs/technical/architecture-guardrail-baseline.json`.
- No remaining `custom-api-route` exceptions are documented because none are currently active.
- Six helper-agent lanes are closed.
- The active follow-up goal stops here; new feature work, UI redesign, and deeper TypeScript cleanup require a new scoped goal.

Final validation:

- `pnpm -s check:architecture:update-baseline`: pass, `Current violations recorded: 0`.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, `Current architecture violations: 0`.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox; reports `Current architecture violations: 0`.
- `pnpm --dir apps/site build`: pass with existing Svelte accessibility and Vite bundling warnings.
- `git diff --check`: pass.
- `pnpm -s typecheck:core`: still red, but no diagnostics remain for the newly migrated route handler files. The previous consolidated-surface registry typing diagnostics in `src/api/handlers/adapters.ts`, `src/api/handlers/gpu-info.ts`, `src/api/handlers/status.ts`, and `src/nodes/llm/model-resolver.node.ts` were fixed.

Scoped TypeScript debt exception for this finish:

- Executor/graph typing: `agent-graph-executor.ts`.
- Cognitive/persona typing: `cognitive-layers/*`, `context-builder.ts`, `identity.ts`, persona nodes.
- Connector metadata/tool-parameter typing: calendar, document, and photo connectors.
- Storage/encryption config typing: `encryption-manager.ts`, `conversation-buffer.ts`.
- Event bus WebSocket typing: `infrastructure/event-bus/*`.
- Legacy CLI adapter result typing: `legacy-cli-adapters.ts`.
- Model routing/node schema typing: `model-router.ts`, active-operator nodes, agency nodes, cognitive nodes, dreamer/input nodes, `tool-executor-config.ts`.

These failures are grouped as future TypeScript debt because the architecture-route consolidation target is complete and the remaining errors are outside the route ownership changes.

## Active Full-Plan Finish Goal

The full consolidation plan is finished only when all of these are true:

- Tracked personal, runtime, generated, local-tool, and legacy bulk paths are removed from the remote source surface or replaced with sanitized templates.
- `pnpm check:architecture` passes without relying on forbidden tracked-path debt.
- Remaining architecture exceptions, if any, are explicitly documented in the guardrail baseline with owner and rationale.
- Core/brain dependency inversions are removed or converted into documented public interfaces.
- Web API routes identified as first-priority custom logic are moved toward thin transport or documented as scoped follow-up exceptions.
- The maintained-source audit batches have remote-safe summaries under `docs/audits/`.
- Stale public docs either point at the new authority docs or are clearly marked archive-only.
- Six helper-agent lanes for the active full plan have reported findings or patches and are closed.
- Final verification commands have been run and their results are recorded here.

The plan is not allowed to expand beyond these finish criteria without a new goal.

## Active Helper-Agent Lanes

- Remote-safety cleanup verification: complete, report in `docs/audits/remote-safety-cleanup.md`.
- Core/brain architecture refactor: complete for storage ownership, report in `docs/audits/core-brain-boundary.md`.
- Web/API consolidation: complete for `voice-settings`, report in implementation notes below.
- Stale docs authority: complete, report in `docs/audits/stale-docs.md`.
- Maintained-source audit batches: complete, report in `docs/audits/batch-audit-summary.md`.
- Guardrail hardening: complete, report in `docs/audits/guardrail-hardening.md`.

## Final Full-Plan Status

Completed on 2026-07-01:

- Removed tracked personal/runtime/local-tool/legacy-bulk path classes from the Git index while preserving local files with `git rm --cached`.
- Tightened ignore rules so removed persona/profile/runtime files do not reappear as untracked add candidates.
- Removed `apps/code-oss/**` from the tracked maintained source surface.
- Removed tracked credential/runtime classes from the source surface: `credentials.txt`, `data/user-data/**`, `.claude/**`, `.obsidian/**`, `tmp/**`, `apps/site/logs/**`, `audit-state*.json`, `report.json`, `docs/audit-scratchpad.md`, debug keystore, backup tarball, root `persona/**`, and live profile folders.
- Kept `profiles/README.md` tracked as the sanitized profile placeholder.
- Moved storage routing ownership into `packages/core/src/storage-client.ts`.
- Replaced `brain/services/storage-router.ts` with a compatibility adapter over `@metahuman/core/storage-client`.
- Added the public `@metahuman/core/storage-client` export.
- Moved `/api/voice-settings` logic into `packages/core/src/api/handlers/voice-settings.ts`.
- Converted `apps/site/src/pages/api/voice-settings.ts` to the thin `astroHandler` adapter.
- Registered `GET` and `POST /api/voice-settings` in the core API router.
- Updated public/stale docs so current orientation points at `MAINTAINED_SURFACE`, `REFACTOR_BLUEPRINT`, `AUDIT_PROTOCOL`, and this progress document.
- Regenerated the maintained-source inventory after cleanup: 1820 maintained files, 1282 code files.
- Refreshed the architecture guardrail baseline after cleanup: 179 current documented violations.
- Closed the edit-every-file audit workflow and replaced it with report-first audit batch summaries.

Final verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass.
- `./bin/audit check`: pass.
- Forbidden tracked path audit target count: 0.
- `git diff --check`: pass.
- JSON parse check for package manifests, inventory, and architecture baseline: pass.
- Focused import smoke for storage adapter and voice handler: pass.
- `pnpm -s typecheck:core`: not green because broad pre-existing strict TypeScript debt remains across agents, API handlers, graph nodes, event bus, connectors, and legacy adapters. The moved `voice-settings` handler no longer appears in the error list after cleanup.

No remaining required steps are open for this bounded full-plan goal. Remaining architecture debt is documented as future follow-up, not an active expansion of this goal.

## Follow-Up Implementation Pass - 2026-07-01

Implemented the first scoped follow-up pass against the previous 179-violation architecture baseline.

Completed:

- Moved mobile concrete agent registration out of `packages/core` into `brain/mobile-agents.ts` and `brain/mobile-handlers.ts`.
- Reduced `packages/core/src/mobile-handlers/mobile-agents.ts` to scheduler compatibility helpers with injected registrations.
- Updated the React Native handler bundle entry to use the brain-owned mobile handler surface.
- Added public core exports needed by brain services/training code: `adapters`, `schema-manager`, `model-registry`, `llm-backend`, `s3-upload`, `mode-validator`, `path-builder`, and `mobile-handlers`.
- Replaced all current `brain/*` deep imports of `packages/core/src/...` with public `@metahuman/core` exports.
- Exposed desire question generation through a public core agency service and removed the desire planner's direct node implementation import.
- Added the missing `cli.ts` and `index.ts` for `brain/agents/desire-explorer`.
- Removed the stale tracked `packages/core/test_skills.ts` inversion.
- Replaced runtime client imports in the flow editor with type-only core imports plus API-fed schema caching.
- Migrated these API route families to core handlers and thin `astroHandler` route files:
  - `active-operator`
  - `unified-queue`
  - `window-session`
  - `persona/generator`
  - `terminal`
  - first agency desire subroute batch: `approve`, `reject`, `reset`, `retry`, and `executions`
- Fixed router parameter extraction for agency desire subroutes and window-session heartbeat routes.
- Refreshed the architecture baseline from 179 violations to 80 violations, all remaining in `custom-api-route`.

Six implementation helper agents were launched and closed for this follow-up pass:

- Active operator API migration: complete.
- Unified queue API migration: complete.
- Window session API migration: complete.
- Agency desire subroute migration: complete for the first non-streaming batch.
- Persona generator API migration: complete.
- Terminal route migration: complete.

Follow-up verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 80 baselined `custom-api-route` violations.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox.
- `git diff --check`: pass.
- `node apps/react-native/scripts/build-handlers.mjs`: pass; bundle now enters through `brain/mobile-handlers.ts`.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due broad existing TypeScript debt across core API handlers, graph nodes, connectors, event bus, encryption manager, and legacy adapters.

## Follow-Up Local State API Pass - 2026-07-01

Continued the web/API consolidation against the 80-route custom API baseline.

Completed:

- Moved `/api/server-info` network/server discovery into `packages/core/src/api/handlers/server-info.ts`.
- Moved `/api/profile-sync-state` and `/api/update-state` log-backed state reads into `packages/core/src/api/handlers/local-state.ts`.
- Moved `/api/pause-state` Active Operator pause updates into `packages/core/src/api/handlers/pause-state.ts`.
- Converted `/api/training-data` from a duplicate Astro implementation to the already-registered core training-data handlers.
- Preserved the existing `/api/training-data` authentication and default-response contract while moving it through the unified router.
- Converted those five Astro API routes to thin `astroHandler` transport files.
- Refreshed the architecture baseline from 80 violations to 75 violations, all remaining in `custom-api-route`.

Verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: stale-baseline failure before refresh, confirming exactly five resolved routes.
- `pnpm -s check:architecture:update-baseline`: pass, 75 baselined `custom-api-route` violations.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass after refresh.
- `./bin/audit check`: pass.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due the existing broad TypeScript backlog; this run did not report the new local-state API handler files.

## Finish Goal

The kickoff is complete when all of these are true:

- Remote-safe architecture authority exists in tracked docs.
- A maintained-source inventory exists for the line-by-line audit.
- Fast guardrails exist and pass with an explicit baseline for current debt.
- The old edit-every-file audit process is marked deprecated.
- Six helper-agent lanes have reported findings or implementation notes.
- The resulting next refactor tickets are recorded without personal/runtime data.

This kickoff does not require fixing all technical debt. It establishes the blueprint, guardrails, inventory, and first tickets so the long audit can proceed without open-ended coding.

## Completed So Far

- Added `docs/technical/MAINTAINED_SURFACE.md` to define maintained source vs runtime/personal/generated/non-system areas.
- Added `docs/technical/REFACTOR_BLUEPRINT.md` to define the app/interface vs core-engine vs agents dependency contract.
- Added `docs/technical/AUDIT_PROTOCOL.md` for line-by-line audit output that does not mutate code while auditing.
- Added `docs/audits/README.md` for remote-safe audit reports.
- Updated `docs/technical/ARCHITECTURE.md` with the monorepo boundary contract.
- Marked `docs/AUDIT-INSTRUCTIONS.md`, `docs/AUDIT-README.md`, and `docs/CLEANUP-PLAN.md` as deprecated historical docs.
- Added `scripts/check-architecture.ts` with guardrails for tracked runtime data, dependency direction, API route ownership, site client imports, and agent contracts.
- Generated an initial guardrail baseline at `docs/technical/architecture-guardrail-baseline.json`.
- Replaced `bin/audit` with a scoped wrapper that checks maintained tracked files and calls the architecture guardrail.
- Added package scripts for architecture checks, baseline refresh, audit inventory, fast audit, and package typechecks.
- Added `scripts/create-audit-inventory.ts` to generate the maintained-source audit inventory.
- Generated `docs/audits/maintained-source-inventory.md` and `docs/audits/maintained-source-inventory.json`.
- Launched six helper-agent lanes for core boundaries, web boundaries, remote safety, audit batching, guardrail review, and docs authority.
- Integrated helper findings into this progress document.
- Marked `docs/AUDIT-QUICKSTART.md`, `docs/AGENT-PROMPT.txt`, and the old `scripts/audit-*` workflow as deprecated historical materials.
- Updated local-only `AGENTS.md` to point future agents at the tracked blueprint while keeping it out of the remote source tree.

## Current Known Baseline Debt

The architecture baseline now records no active architecture violations. Current baseline count: 0 violations.

- `custom-api-route`: 0 Astro API routes in the current scanner baseline own custom logic.

Resolved since the 179-violation baseline:

- `brain-deep-core-import`: 50 resolved.
- `core-layer-inversion`: 13 resolved.
- `site-client-core-import`: 2 resolved.
- `agent-contract`: 1 resolved.
- `custom-api-route`: all current custom-route debt resolved; final current count is 0.

## Helper Agent Lanes

Six helper agents were launched for:

- Core/engine boundary violations.
- Web interface and API boundary violations.
- Remote-safety and cruft cleanup.
- Line-by-line maintained-source audit batching.
- Guardrail script review.
- Documentation authority review.

All six lanes returned findings. Reported findings have been merged into `Next Tickets`, and the guardrail-review lane's implementation notes were integrated into `scripts/check-architecture.ts` and `bin/audit`.

## Residual Follow-Up Tickets

These are future scoped goals. They are not open required steps for the completed consolidation goal above.

### Remote-Safety Cleanup

1. If credential-like files were pushed to GitHub, rotate credentials first and consider history rewriting for the critical path set.
2. Decide whether any sanitized fixtures should replace removed live profile/persona data.
3. Decide whether removed unmapped external gitlinks should be restored as declared submodules or kept out of the remote source surface.

### Architecture Boundary Refactors

1. Normalize training utility ownership:
   decide whether `schema-manager`, `mode-validator`, `model-registry`, `s3-upload`, and `llm-backend` are public core APIs or training-owned helpers.
2. Continue TypeScript debt cleanup by owner group; `pnpm -s typecheck:core` is still the broad failing signal.

### Web/API Consolidation

1. Keep the zero-violation API route baseline strict; any new Astro API route must use `astroHandler` or document a non-actionable exception with owner and rationale.
2. Add focused regression tests for the newly migrated service/stream routes before changing their behavior.
3. Audit oversized UI/client files after route owners are clear: `ChatInterface.svelte`, `AgencyDashboard.svelte`, `useMicrophone.ts`, `CenterContent.svelte`, `TrainingWizard.svelte`, `VoiceTrainingWidget.svelte`, `AuthGate.svelte`, `ProfileLocation.svelte`, `SecuritySettings.svelte`, and `profile-sync.ts`.

### Audit Batches

1. Remote-safety fence.
2. Guardrail and entrypoint map.
3. Core foundation.
4. Core API ownership.
5. Core domain systems.
6. Core graph and nodes.
7. Interface packages and CLI.
8. Web app transport and UI.
9. Brain agents/services/training.
10. Mobile and secondary apps.
11. Support scripts, tests, config, and docs.

### Stale Docs and Scripts

1. Update stale public orientation docs:
   `README.md`, `STARTUP.md`, and any `docs/technical/README.md` references that point at missing or stale files.
2. Mark historical planning/status docs as archive-only unless refreshed:
   `docs/NEXT-STEPS.md`, `docs/MOBILE-IMPLEMENTATION.md`, `docs/UNIFIED-API-LAYER.md`, `docs/REMAINING-WORK.md`, and `docs/OPTIONAL-NEXT-STEPS-STATUS.md`.
