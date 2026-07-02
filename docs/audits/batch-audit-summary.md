# Maintained Source Batch Audit Summary

Remote-safe maintained-source audit summary for the consolidation plan. This is a sampled batch classification, not a line-edit pass over the 1,869-file inventory.

## Inputs

- `docs/audits/maintained-source-inventory.json`
- `docs/audits/maintained-source-inventory.md`
- `docs/audits/consolidation-progress.md`
- `docs/technical/AUDIT_PROTOCOL.md`
- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/technical/architecture-guardrail-baseline.json`
- `scripts/check-architecture.ts`
- `bin/audit`

## Method

- Used the maintained inventory as the file universe: 1,869 maintained files, 1,282 code files.
- Kept sampling at owner-group granularity: dependency direction, API ownership, runtime-data fences, entrypoints, oversized files, and guardrail coverage.
- Did not copy personal/runtime values into this report.
- Did not audit or refactor `apps/code-oss/**` as maintained source.
- Did not mutate source files.

## Current Audit Baseline

- Inventory by largest maintained areas: `core-engine` 560, `web-interface` 487, `docs` 275, `repo-root` 108, `agents` 83, `config` 83, `mobile-interface` 77, `tests` 64, `scripts` 49.
- Oversized code clusters are concentrated in `packages/core`, `apps/site`, `brain/agents`, `brain/training`, and `packages/cli`.
- The checked-in architecture baseline records 8,981 violations:
  - `forbidden-tracked-path`: 8,795
  - `brain-deep-core-import`: 55
  - `core-layer-inversion`: 14
  - `custom-api-route`: 114
  - `site-client-core-import`: 2
  - `agent-contract`: 1
- Verification during this audit lane ran `pnpm check:architecture` successfully outside the sandbox after `tsx` hit a sandbox IPC permission error. The live guardrail result reported no new drift, 179 current violations, and 8,802 stale baseline entries:
  - Current: `agent-contract` 1, `brain-deep-core-import` 50, `core-layer-inversion` 13, `custom-api-route` 113, `site-client-core-import` 2.
  - Stale baseline: `forbidden-tracked-path` 8,795, plus 7 resolved architecture-route/import entries.

## Batch 1: Remote-Safety Fence

- Sampled owner groups: root/config/docs inventory surfaces, local-tool fences, runtime-data path patterns, legacy bulk exclusions.
- Classification: remote-safety cleanup must land before strict architecture cleanup can be considered done. Most baseline debt is tracked local/runtime/generated/legacy content, not source dependency shape.
- High-risk groups:
  - Credential-like and runtime capture files.
  - Local editor/agent state directories.
  - Runtime profile, memory, log, output, and browser-data directories.
  - Backup archives, signing keys, model/build artifacts.
  - Legacy bulk and deprecated mobile app paths outside the maintained surface.
- Recommended action: remove tracked runtime/local/generated/bulk paths or replace intentionally public examples with sanitized templates.
- Next acceptance checks:
  - `pnpm check:architecture` reports zero `forbidden-tracked-path` violations.
  - `git ls-files` has no matches for the forbidden path families in `scripts/check-architecture.ts`.
  - Any remaining example data is explicitly documented as sanitized fixture/template content.

## Batch 2: Guardrail And Entrypoint Map

- Sampled owner groups: `scripts/check-architecture.ts`, `scripts/create-audit-inventory.ts`, `bin/audit`, root package scripts, test/config entrypoints.
- Inventory sample: 237 files if grouped by guardrail, scripts, tests, config, bin, and root entrypoints; 96 code files.
- Classification: guardrail scripts are the enforcement owner; `bin/audit` is the fast local wrapper; package scripts expose the current validation surface.
- High-risk files:
  - `scripts/check-architecture.ts`: owns remote-safety, core/brain direction, API route adapter, site-client core import, and agent contract checks.
  - `bin/audit`: writes local audit logs and runs the architecture guardrail.
  - `scripts/create-audit-inventory.ts`: determines the maintained file universe.
  - `package.json`: exposes `check:architecture`, `audit:inventory`, `audit:fast`, `typecheck:core`, `typecheck:cli`, and `typecheck:site`.
- Finding: `scripts/check-architecture.ts` references `options.allowStaleBaseline`, but the declared `Options` type and argument parser do not define it. That should be fixed or intentionally added before relying on TypeScript checks for the guardrail owner.
- Recommended action: keep guardrails small and explicit; add new rule coverage only when the target boundary is clear.
- Next acceptance checks:
  - `pnpm check:architecture`
  - `pnpm audit:inventory`
  - `./bin/audit check`
  - Type-check the guardrail owner after the `allowStaleBaseline` option is resolved.

## Batch 3: Core Foundation

- Sampled owner groups: core exports, profile/path/auth/session/config/storage/security/model routing foundation.
- Inventory sample: 28 foundation-like core files, about 13,893 code lines.
- Classification: this batch owns the public engine base that apps, CLI, and brain code should call through.
- High-risk files:
  - `packages/core/src/profile.ts`
  - `packages/core/src/profile-migration.ts`
  - `packages/core/src/index.ts`
  - `packages/core/src/users.ts`
  - `packages/core/src/security-policy.ts`
  - `packages/core/src/storage-client.ts`
  - `packages/core/src/path-security.ts`
  - `packages/core/src/llm-backend.ts`
- Boundary issues:
  - `packages/core/src/storage-client.ts` is already identified as an inversion because core reaches into `brain/services/storage-router.ts`.
  - Foundation exports are broad; downstream fixes should prefer public exports over new deep imports.
- Recommended action: break core-to-brain ownership first, then stabilize the public exports needed by `brain/*`, CLI, and API handlers.
- Next acceptance checks:
  - `pnpm typecheck:core`
  - `pnpm check:architecture` reports zero `core-layer-inversion` for foundation files.
  - Targeted smoke: `./bin/mh status` after storage/path/profile changes.

## Batch 4: Core API Ownership

- Sampled owner groups: unified API router, Astro adapter, HTTP/mobile adapters, handler modules under `packages/core/src/api`.
- Inventory sample: 153 files, about 29,546 code lines.
- Classification: core API handlers are the intended business-logic owner for web API transport routes.
- High-risk files:
  - `packages/core/src/api/router.ts`
  - `packages/core/src/api/adapters/astro.ts`
  - `packages/core/src/api/handlers/auth.ts`
  - `packages/core/src/api/handlers/profile-sync.ts`
  - `packages/core/src/api/handlers/persona-chat.ts`
  - `packages/core/src/api/handlers/status.ts`
  - `packages/core/src/api/handlers/agency.ts`
- Boundary issues:
  - API handler coverage exists, but 114 Astro routes still bypass the adapter pattern.
  - Agency, voice/settings, adapter dataset, terminal/process, and training routes need owner-by-owner routing decisions before splits.
- Recommended action: migrate web route logic into existing core handlers where ownership is clear; document exceptions for routes that must remain web/process transport.
- Next acceptance checks:
  - `pnpm typecheck:core`
  - `pnpm typecheck:site`
  - `pnpm check:architecture` custom API route count decreases without adding new handler duplication.

## Batch 5: Core Domain Systems

- Sampled owner groups: memory, profile, agency, voice training, active operator, model/provider, scheduler, connectors, system operator.
- Inventory sample: 208 domain-system files, about 84,450 code lines.
- Classification: domain systems contain most of the core complexity and should be split only after owner boundaries are clear.
- High-risk files:
  - `packages/core/src/voice-training.ts`
  - `packages/core/src/agency/storage.ts`
  - `packages/core/src/active-operator/task-executor.ts`
  - `packages/core/src/active-operator/operator-proposals.ts`
  - `packages/core/src/function-memory.ts`
  - `packages/core/src/memory.ts`
  - `packages/core/src/context-builder.ts`
  - `packages/core/src/agency/types.ts`
- Boundary issues:
  - Several files mix orchestration, persistence, path access, side effects, and API-facing data shapes.
  - Large files should not be split before the API/core/brain owner relationship is settled.
- Recommended action: prioritize behavior-preserving extraction around storage adapters, side-effect boundaries, and public types. Avoid parallel memory/profile/agency systems.
- Next acceptance checks:
  - `pnpm typecheck:core`
  - Domain-specific smoke through existing CLI/API routes after each owner move.
  - `pnpm check:architecture` has no new core dependency exceptions.

## Batch 6: Core Graph And Nodes

- Sampled owner groups: graph executor, graph streaming, node schemas, node types, node implementations, cognitive graph schema.
- Inventory sample: 181 files, about 26,817 code lines.
- Classification: graph and node code is a core engine subsystem, but browser UI needs only safe schema/type surfaces.
- High-risk files:
  - `packages/core/src/nodes/schemas.ts`
  - `packages/core/src/graph-executor.ts`
  - `packages/core/src/graph-streaming.ts`
  - `packages/core/src/cognitive-graph-schema.ts`
  - `packages/core/src/nodes/operator/response-synthesizer.node.ts`
  - `packages/core/src/nodes/agency/desire-executor.node.ts`
- Boundary issues:
  - Site client flow-editor imports currently account for 2 `site-client-core-import` baseline violations.
  - `brain/agents/desire-planner/core.ts` deep-imports a node implementation instead of using a public graph/node API.
- Recommended action: expose browser-safe schema/color/type data through an explicit public surface or API response; keep node execution server-side.
- Next acceptance checks:
  - `pnpm validate:graphs`
  - `pnpm typecheck:core`
  - `pnpm typecheck:site`
  - `pnpm check:architecture` reports zero `site-client-core-import` and no new graph deep imports from `brain/*`.

## Batch 7: Interface Packages And CLI

- Sampled owner groups: `packages/cli`, `packages/agent-runtime`, `packages/server`, `packages/local-model-service`.
- Inventory sample: 37 files, 29 code files, about 10,018 code lines.
- Classification: these packages are interface/runtime shells above core; durable business behavior should delegate to core or documented agent-runtime APIs.
- High-risk files:
  - `packages/cli/src/mh-new.ts`
  - `packages/cli/src/commands/persona.ts`
  - `packages/cli/src/commands/adapter.ts`
  - `packages/cli/src/commands/kokoro.ts`
  - `packages/server/src/providers/runpod.ts`
  - `packages/local-model-service/src/model-manager.ts`
  - `packages/agent-runtime/src/loader.ts`
- Boundary issues:
  - CLI command modules are large and can own too much durable behavior.
  - Server/local-model packages should stay behind explicit core/runtime interfaces, not become alternate engines.
- Recommended action: keep CLI parsing and process wiring in CLI; move reusable operations into core or agent-runtime only when a clear owner already exists.
- Next acceptance checks:
  - `pnpm typecheck:cli`
  - `./bin/mh help`
  - `./bin/mh status`
  - Package-specific smoke for changed command groups.

## Batch 8: Web App Transport And UI

- Sampled owner groups: Astro API routes, server API adapter, server utilities, Svelte components, stores, client composables, flow editor.
- Inventory sample: 487 files, 476 code files, about 87,064 code lines.
- Classification: web should be transport and UI. Business logic should move to core handlers or documented services.
- High-risk files:
  - `apps/site/src/pages/api/voice-settings.ts`
  - `apps/site/src/pages/api/adapters/index.ts`
  - Agency desire routes under `apps/site/src/pages/api/agency/desires/**`
  - `apps/site/src/components/ChatInterface.svelte`
  - `apps/site/src/components/AgencyDashboard.svelte`
  - `apps/site/src/lib/client/composables/useMicrophone.ts`
  - `apps/site/src/components/TrainingWizard.svelte`
  - `apps/site/src/lib/client/profile-sync.ts`
- Boundary issues:
  - 114 API routes still do custom route work.
  - Large Svelte/client files mix UI state, transport calls, and workflow logic.
  - Flow-editor client imports runtime core schema/type surfaces.
- Recommended action: migrate first-priority API routes to `astroHandler` backed by core handlers before splitting UI files. Then split UI files by interaction/workflow ownership.
- Next acceptance checks:
  - `pnpm typecheck:site`
  - `pnpm check:architecture` custom API route count decreases.
  - Browser/client bundles do not import runtime-heavy `@metahuman/core` modules.

## Batch 9: Brain Agents, Services, And Training

- Sampled owner groups: `brain/agents`, `brain/services`, `brain/training`, `brain/scripts`.
- Inventory sample: 102 files, 100 code files, about 28,514 code lines.
- Classification: brain code is above the core engine and should call public `@metahuman/core` exports.
- High-risk files:
  - `brain/training/lora-trainer.ts`
  - `brain/agents/psychoanalyzer/core.ts`
  - `brain/agents/desire-generator/core.ts`
  - `brain/agents/babysitter.ts`
  - `brain/agents/desire-outcome-reviewer/core.ts`
  - `brain/agents/desire-planner/core.ts`
  - `brain/training/full-cycle.ts`
  - `brain/services/storage-router.ts`
- Boundary issues:
  - 55 `brain-deep-core-import` baseline violations.
  - `brain/agents/desire-explorer` fails the current agent directory contract.
  - Training utility ownership is unresolved for schema/model/storage helpers.
- Recommended action: convert easy deep imports to public exports first; move only truly engine-owned utilities into core; keep training-specific orchestration in training.
- Next acceptance checks:
  - `pnpm check:architecture` reports zero `brain-deep-core-import` and zero `agent-contract`.
  - `rg "packages/core/src|\\.\\./\\.\\./packages/core/src|\\.\\./\\.\\./\\.\\./packages/core/src" brain` has no source hits.
  - Agent smoke for any changed agent: CLI entrypoint plus one non-writing dry run where available.

## Batch 10: Mobile And Secondary Apps

- Sampled owner groups: `apps/react-native`, generated mobile handler assets, secondary interface glue.
- Inventory sample: 77 files, 11 code files, about 1,526 code lines.
- Classification: React Native is a maintained interface only if actively used; deprecated `apps/mobile` is outside the maintained surface.
- High-risk files:
  - `apps/react-native/App.tsx`
  - `apps/react-native/nodejs-assets/nodejs-project/main.js`
  - `apps/react-native/scripts/build-handlers.mjs`
  - `packages/core/src/mobile-handlers/mobile-agents.ts`
- Boundary issues:
  - Core mobile handlers currently import brain agent implementations, producing core-layer inversion debt.
  - Generated or bundled mobile node assets need a clear source-of-truth owner before edits.
- Recommended action: move mobile agent registration/adaptation above core or expose core-neutral agent descriptors through agent-runtime.
- Next acceptance checks:
  - `pnpm check:architecture` reports no mobile-related `core-layer-inversion`.
  - Mobile handler generation is reproducible from the declared source.
  - React Native smoke/build command is documented before broad mobile edits.

## Batch 11: Support Scripts, Tests, Config, And Docs

- Sampled owner groups: `scripts`, `tests`, `bin`, root config, focused docs.
- Inventory sample: 606 files when grouped with repo-root/docs/config/support surfaces; 109 code files, about 15,837 code lines.
- Classification: support files should enforce and document the maintained architecture without becoming separate product owners.
- High-risk files/groups:
  - Historical audit scripts now marked deprecated.
  - Public orientation docs that still point at stale plans.
  - Test/setup scripts that may contain local-only assumptions.
  - Root package and tool config that still references legacy apps.
- Boundary issues:
  - Stale docs can contradict the maintained-surface and refactor-blueprint authority.
  - Support scripts that create or inspect local users/profiles must not commit live data values.
- Recommended action: mark stale public docs archive-only or update them to point at the tracked authority docs. Keep support scripts either maintained and tested or explicitly historical.
- Next acceptance checks:
  - `pnpm audit:inventory`
  - `pnpm audit:fast`
  - `pnpm check:architecture`
  - Public docs link to `MAINTAINED_SURFACE.md`, `REFACTOR_BLUEPRINT.md`, and `AUDIT_PROTOCOL.md` as the active authority.

## Cross-Batch Acceptance Order

1. Remove/sanitize remote-unsafe tracked paths.
2. Fix guardrail type/option drift and verify the guardrail owner.
3. Break core-to-brain inversions.
4. Convert brain deep imports to public core exports.
5. Move first-priority web API custom logic behind core handlers.
6. Replace site-client runtime core imports with browser-safe schema/type surfaces.
7. Resolve the single agent contract violation.
8. Regenerate the maintained inventory and refresh the guardrail baseline only after intentional cleanup.
9. Run final checks:
   - `pnpm check:architecture`
   - `pnpm audit:inventory`
   - `pnpm audit:fast`
   - `pnpm typecheck:core`
   - `pnpm typecheck:cli`
   - `pnpm typecheck:site`
   - `pnpm validate:graphs`

## Disposition

This lane is complete for maintained-source audit batching: each planned batch has a remote-safe owner-group classification, sampled high-risk files, and next acceptance checks. Implementation remains for the refactor lanes that own source edits.
