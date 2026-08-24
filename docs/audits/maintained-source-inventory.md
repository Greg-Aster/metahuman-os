# Maintained Source Inventory

Generated: 2026-08-24T22:57:52.544Z

Total maintained files: 1776
Code files: 1370
Policy: `docs/technical/MAINTAINED_SURFACE.md`

## By Area

- agent-runtime: 10
- agents: 83
- bin: 22
- brain-policy: 3
- brain-scripts: 4
- brain-services: 5
- cli: 14
- config: 80
- core-engine: 693
- docs: 214
- external-integration: 6
- local-model-service: 6
- mobile-interface: 45
- mobile-runtime: 2
- repo-root: 24
- scripts: 29
- server-package: 7
- tests: 3
- training: 27
- web-interface: 499

## By Kind

- code: 1370
- docs: 221
- json: 95
- other: 57
- shell: 31
- yaml: 2

## First Audit Batches

1. `packages/core` boundary and storage engine files.
2. `apps/site/src/pages/api` transport routes and handlers.
3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.
4. `packages/cli` command ownership and smoke behavior.
5. Oversized UI/core files and orphan candidates.

## Oversized Code Files

- packages/core/src/voice-training.ts: 3009 lines
- apps/site/src/components/ChatInterface.svelte: 2806 lines
- apps/site/src/components/AgencyDashboard.svelte: 2651 lines
- packages/core/src/nodes/schemas.ts: 2175 lines
- packages/core/src/profile.ts: 2058 lines
- packages/core/src/api/handlers/agency.ts: 1998 lines
- apps/site/src/lib/client/composables/useMicrophone.ts: 1957 lines
- apps/site/src/components/BackendSettings.svelte: 1845 lines
- brain/training/lora-trainer.ts: 1808 lines
- apps/site/src/components/CenterContent.svelte: 1782 lines
- packages/cli/src/main.ts: 1754 lines
- packages/core/src/api/handlers/agency-workflows.ts: 1649 lines
- packages/core/src/agency/storage.ts: 1618 lines
- brain/agents/psychoanalyzer/core.ts: 1605 lines
- packages/core/src/vllm.ts: 1589 lines
- apps/site/src/components/TrainingWizard.svelte: 1564 lines
- apps/site/src/components/VoiceTrainingWidget.svelte: 1563 lines
- packages/core/src/nodes/environment/task-state.node.spec.ts: 1556 lines
- packages/core/src/api/router.ts: 1551 lines
- brain/agents/desire-generator/core.ts: 1535 lines
- apps/site/src/components/AuthGate.svelte: 1455 lines
- packages/core/src/memory.ts: 1407 lines
- packages/core/src/function-memory.ts: 1384 lines
- apps/site/src/components/SecuritySettings.svelte: 1344 lines
- apps/site/src/components/ProfileLocation.svelte: 1343 lines
- packages/core/src/context-builder.ts: 1329 lines
- packages/core/src/agency/types.ts: 1300 lines
- apps/site/src/lib/client/profile-sync.ts: 1299 lines
- apps/site/src/components/SystemSettings.svelte: 1284 lines
- packages/core/src/active-operator/operator-proposals.ts: 1282 lines
- packages/core/src/profile-migration.ts: 1273 lines
- packages/core/src/nodes/environment/helpers.ts: 1261 lines
- apps/site/src/components/AdapterDashboard.svelte: 1203 lines
- packages/core/src/api/handlers/voice-settings.ts: 1198 lines
- apps/site/src/components/VoiceSettings.svelte: 1187 lines
- packages/core/src/nodes/operator/response-synthesizer.node.ts: 1157 lines
- apps/site/src/components/LeftSidebar.svelte: 1150 lines
- packages/core/src/environment-interface/compatibility.spec.ts: 1138 lines
- brain/agents/desire-outcome-reviewer/core.ts: 1119 lines
- apps/site/src/components/PersonaEditor.svelte: 1086 lines
- packages/core/src/api/handlers/auth.ts: 1069 lines
- apps/site/src/components/NetworkServerSettings.svelte: 1042 lines
- packages/core/src/providers/bridge.ts: 1041 lines
- apps/site/src/lib/client/local-memory.ts: 1031 lines
- packages/core/src/graph-executor.ts: 970 lines
- apps/site/src/components/SyncManager.svelte: 968 lines
- brain/agents/desire-planner/core.ts: 965 lines
- packages/core/src/llm-backend.ts: 943 lines
- brain/agents/environment-bridge/core.ts: 939 lines
- brain/training/full-cycle.ts: 936 lines
- apps/site/src/lib/client/composables/useTTS.ts: 925 lines
- apps/site/src/components/PersonaGenerator.svelte: 904 lines
- apps/site/src/components/TaskManager.svelte: 904 lines
- brain/training/environment-action-selector/development-cases.ts: 888 lines
- packages/core/src/nodes/robot-operator/robot-operator-mode.spec.ts: 879 lines
- apps/site/src/components/ServerStatus.svelte: 879 lines
- packages/core/src/api/handlers/persona-chat.ts: 868 lines
- packages/core/src/ollama.ts: 859 lines
- packages/core/src/environment-interface/motion-plan.spec.ts: 839 lines
- packages/core/src/user-data-collector.ts: 838 lines
- apps/site/src/lib/client/memory-sync.ts: 831 lines
- packages/core/src/api/handlers/profile-sync.ts: 827 lines
- packages/core/src/nodes/environment/task-state.node.ts: 820 lines
- packages/core/src/connectors/chat-ingestor.ts: 815 lines
- packages/core/src/queue/trigger-manager.ts: 807 lines
- apps/site/src/components/ChatLayout.svelte: 807 lines

Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.
