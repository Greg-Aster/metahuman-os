# Maintained Source Inventory

Generated: 2026-08-25T20:38:25.596Z

Total maintained files: 1577
Code files: 1309
Policy: `docs/technical/MAINTAINED_SURFACE.md`

## By Area

- agent-runtime: 10
- agents: 86
- bin: 21
- brain-policy: 3
- brain-scripts: 3
- brain-services: 4
- cli: 12
- config: 69
- core-engine: 685
- docs: 85
- external-integration: 7
- local-model-service: 6
- mobile-interface: 47
- mobile-runtime: 2
- repo-root: 24
- scripts: 19
- tests: 4
- training: 24
- web-interface: 466

## By Kind

- code: 1309
- docs: 95
- json: 87
- other: 55
- shell: 29
- yaml: 2

## First Audit Batches

1. `packages/core` boundary and storage engine files.
2. `apps/site/src/pages/api` transport routes and handlers.
3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.
4. `packages/cli` command ownership and smoke behavior.
5. Oversized UI/core files and orphan candidates.

## Oversized Code Files

- apps/site/src/components/ChatInterface.svelte: 2738 lines
- apps/site/src/components/AgencyDashboard.svelte: 2653 lines
- packages/core/src/voice-training.ts: 2312 lines
- packages/core/src/nodes/schemas.ts: 2203 lines
- packages/core/src/profile.ts: 2034 lines
- packages/core/src/api/handlers/agency.ts: 1970 lines
- apps/site/src/lib/client/composables/useMicrophone.ts: 1957 lines
- brain/training/lora-trainer.ts: 1807 lines
- packages/cli/src/main.ts: 1788 lines
- apps/site/src/components/BackendSettings.svelte: 1781 lines
- apps/site/src/components/CenterContent.svelte: 1748 lines
- packages/core/src/nodes/environment/task-state.node.spec.ts: 1706 lines
- packages/core/src/agency/storage.ts: 1622 lines
- packages/core/src/vllm.ts: 1615 lines
- brain/agents/psychoanalyzer/core.ts: 1605 lines
- apps/site/src/components/TrainingWizard.svelte: 1525 lines
- packages/core/src/api/router.ts: 1471 lines
- apps/site/src/components/AuthGate.svelte: 1455 lines
- brain/agents/desire-generator/core.ts: 1432 lines
- packages/core/src/memory.ts: 1393 lines
- packages/core/src/function-memory.ts: 1384 lines
- apps/site/src/components/ProfileLocation.svelte: 1344 lines
- apps/site/src/lib/client/profile-sync.ts: 1290 lines
- packages/core/src/active-operator/operator-proposals.ts: 1282 lines
- packages/core/src/agency/types.ts: 1275 lines
- packages/core/src/profile-migration.ts: 1273 lines
- packages/core/src/nodes/environment/helpers.ts: 1268 lines
- packages/core/src/context-builder.ts: 1226 lines
- apps/site/src/components/VoiceSettings.svelte: 1182 lines
- packages/core/src/nodes/operator/response-synthesizer.node.ts: 1157 lines
- packages/core/src/environment-interface/compatibility.spec.ts: 1156 lines
- apps/site/src/components/SecuritySettings.svelte: 1156 lines
- apps/site/src/components/LeftSidebar.svelte: 1144 lines
- apps/site/src/components/PersonaEditor.svelte: 1086 lines
- packages/core/src/api/handlers/agency-workflows.ts: 1075 lines
- packages/core/src/api/handlers/auth.ts: 1069 lines
- apps/site/src/lib/client/local-memory.ts: 1031 lines
- apps/site/src/components/NetworkServerSettings.svelte: 1014 lines
- packages/core/src/api/handlers/voice-settings.ts: 989 lines
- apps/site/src/components/SystemSettings.svelte: 981 lines
- packages/core/src/graph-executor.ts: 969 lines
- apps/site/src/components/SyncManager.svelte: 968 lines
- packages/core/src/llm-backend.ts: 943 lines
- brain/agents/environment-bridge/core.ts: 939 lines
- brain/agents/desire-planner/core.ts: 932 lines
- apps/site/src/lib/client/composables/useTTS.ts: 925 lines
- packages/core/src/ollama.ts: 910 lines
- apps/site/src/components/TaskManager.svelte: 910 lines
- apps/site/src/components/PersonaGenerator.svelte: 904 lines
- packages/core/src/providers/bridge.ts: 894 lines
- brain/training/environment-action-selector/development-cases.ts: 888 lines
- apps/site/src/components/ServerStatus.svelte: 878 lines
- packages/core/src/api/handlers/persona-chat.ts: 868 lines
- packages/core/src/environment-interface/motion-plan.spec.ts: 851 lines
- packages/core/src/nodes/robot-operator/boredom-autonomy.spec.ts: 831 lines
- apps/site/src/lib/client/memory-sync.ts: 831 lines
- packages/core/src/api/handlers/profile-sync.ts: 819 lines
- packages/core/src/connectors/chat-ingestor.ts: 815 lines
- packages/core/src/queue/trigger-manager.ts: 807 lines
- apps/site/src/components/ChatLayout.svelte: 807 lines
- packages/core/src/nodes/environment/task-state.node.ts: 804 lines

Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.
