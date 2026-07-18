# Maintained Source Inventory

Generated: 2026-07-17T21:08:07.948Z

Total maintained files: 1970
Code files: 1411

## By Area

- agent-runtime: 10
- agents: 86
- bin: 27
- brain-services: 4
- cli: 11
- config: 78
- core-engine: 640
- docs: 292
- local-model-service: 6
- mobile-interface: 76
- repo-root: 89
- scripts: 56
- server-package: 9
- tests: 63
- training: 13
- web-interface: 510

## By Kind

- code: 1411
- docs: 308
- json: 119
- other: 81
- shell: 47
- yaml: 4

## First Audit Batches

1. `packages/core` boundary and storage engine files.
2. `apps/site/src/pages/api` transport routes and handlers.
3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.
4. `packages/cli` command ownership and smoke behavior.
5. Oversized UI/core files and orphan candidates.

## Oversized Code Files

- packages/core/src/voice-training.ts: 3009 lines
- apps/site/src/components/ChatInterface.svelte: 2939 lines
- apps/site/src/components/AgencyDashboard.svelte: 2651 lines
- packages/cli/src/mh-new.ts: 2407 lines
- packages/core/src/profile.ts: 2067 lines
- packages/core/src/nodes/schemas.ts: 2018 lines
- packages/core/src/api/handlers/agency.ts: 2015 lines
- apps/site/src/lib/client/composables/useMicrophone.ts: 1961 lines
- apps/site/src/components/BackendSettings.svelte: 1845 lines
- brain/training/lora-trainer.ts: 1807 lines
- apps/site/src/components/CenterContent.svelte: 1785 lines
- packages/core/src/api/handlers/agency-workflows.ts: 1667 lines
- packages/core/src/api/router.ts: 1622 lines
- packages/core/src/agency/storage.ts: 1618 lines
- brain/agents/psychoanalyzer/core.ts: 1605 lines
- apps/site/src/components/TrainingWizard.svelte: 1564 lines
- apps/site/src/components/VoiceTrainingWidget.svelte: 1563 lines
- packages/core/src/vllm.ts: 1555 lines
- brain/agents/desire-generator/core.ts: 1535 lines
- apps/site/src/components/AuthGate.svelte: 1444 lines
- packages/core/src/function-memory.ts: 1384 lines
- packages/core/src/memory.ts: 1371 lines
- packages/core/src/active-operator/operator-proposals.ts: 1367 lines
- packages/core/src/api/handlers/voice-settings.ts: 1354 lines
- apps/site/src/components/ProfileLocation.svelte: 1343 lines
- apps/site/src/components/SecuritySettings.svelte: 1338 lines
- packages/core/src/context-builder.ts: 1328 lines
- apps/site/src/components/SystemSettings.svelte: 1314 lines
- apps/site/src/lib/client/profile-sync.ts: 1304 lines
- packages/core/src/agency/types.ts: 1296 lines
- packages/core/src/profile-migration.ts: 1273 lines
- apps/site/src/components/AdapterDashboard.svelte: 1203 lines
- apps/site/src/components/VoiceSettings.svelte: 1177 lines
- apps/site/src/components/LeftSidebar.svelte: 1167 lines
- packages/core/src/nodes/operator/response-synthesizer.node.ts: 1157 lines
- apps/site/src/lib/client/local-memory.ts: 1131 lines
- brain/agents/desire-outcome-reviewer/core.ts: 1120 lines
- apps/site/src/components/PersonaEditor.svelte: 1086 lines
- packages/core/src/big-brother-terminal.ts: 1062 lines
- packages/core/src/api/handlers/auth.ts: 1032 lines
- apps/site/src/components/NetworkServerSettings.svelte: 1032 lines
- packages/core/src/providers/bridge.ts: 1014 lines
- packages/core/src/active-operator/big-brother-tasks.ts: 998 lines
- apps/site/src/components/SyncManager.svelte: 968 lines
- brain/agents/desire-planner/core.ts: 959 lines
- apps/site/src/components/SystemCoderDashboard.svelte: 946 lines
- brain/training/full-cycle.ts: 946 lines
- packages/core/src/llm-backend.ts: 943 lines
- packages/core/src/graph-executor.ts: 930 lines
- apps/site/src/components/PersonaGenerator.svelte: 904 lines
- apps/site/src/components/TaskManager.svelte: 904 lines
- apps/site/src/components/ServerStatus.svelte: 879 lines
- apps/react-native/nodejs-assets/nodejs-project/main.js: 861 lines
- packages/core/src/ollama.ts: 859 lines
- packages/core/src/user-data-collector.ts: 838 lines
- apps/site/src/lib/client/memory-sync.ts: 831 lines
- packages/core/src/api/handlers/profile-sync.ts: 827 lines
- brain/agents/reflector/core.ts: 824 lines
- apps/site/src/lib/client/composables/useTTS.ts: 821 lines
- packages/core/src/connectors/chat-ingestor.ts: 817 lines
- apps/site/src/components/ChatLayout.svelte: 806 lines
- packages/core/src/api/handlers/persona-chat.ts: 801 lines

Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.
