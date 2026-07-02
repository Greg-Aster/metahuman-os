# Maintained Source Inventory

Generated: 2026-07-01T18:12:38.243Z

Total maintained files: 1820
Code files: 1282

## By Area

- agent-runtime: 10
- agents: 83
- bin: 27
- brain-services: 6
- cli: 11
- config: 83
- core-engine: 560
- docs: 275
- local-model-service: 6
- mobile-interface: 76
- repo-root: 60
- scripts: 49
- server-package: 10
- tests: 64
- training: 13
- web-interface: 487

## By Kind

- code: 1282
- docs: 291
- json: 117
- other: 80
- shell: 46
- yaml: 4

## First Audit Batches

1. `packages/core` boundary and storage engine files.
2. `apps/site/src/pages/api` transport routes and handlers.
3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.
4. `packages/cli` command ownership and smoke behavior.
5. Oversized UI/core files and orphan candidates.

## Oversized Code Files

- packages/core/src/voice-training.ts: 3009 lines
- apps/site/src/components/ChatInterface.svelte: 2720 lines
- apps/site/src/components/AgencyDashboard.svelte: 2674 lines
- packages/cli/src/mh-new.ts: 2491 lines
- packages/core/src/profile.ts: 2075 lines
- apps/site/src/lib/client/composables/useMicrophone.ts: 1905 lines
- brain/training/lora-trainer.ts: 1806 lines
- packages/core/src/nodes/schemas.ts: 1725 lines
- apps/site/src/components/CenterContent.svelte: 1713 lines
- packages/core/src/agency/storage.ts: 1618 lines
- brain/agents/psychoanalyzer/core.ts: 1605 lines
- apps/site/src/components/TrainingWizard.svelte: 1567 lines
- apps/site/src/components/VoiceTrainingWidget.svelte: 1563 lines
- brain/agents/desire-generator/core.ts: 1535 lines
- packages/core/src/active-operator/task-executor.ts: 1456 lines
- packages/core/src/active-operator/operator-proposals.ts: 1410 lines
- apps/site/src/components/AuthGate.svelte: 1398 lines
- packages/core/src/function-memory.ts: 1384 lines
- packages/core/src/memory.ts: 1378 lines
- brain/agents/babysitter.ts: 1371 lines
- apps/site/src/components/ProfileLocation.svelte: 1343 lines
- apps/site/src/components/SecuritySettings.svelte: 1338 lines
- packages/core/src/context-builder.ts: 1328 lines
- apps/site/src/lib/client/profile-sync.ts: 1304 lines
- packages/core/src/agency/types.ts: 1296 lines
- packages/core/src/profile-migration.ts: 1273 lines
- packages/core/src/agent-scheduler.ts: 1221 lines
- apps/site/src/components/AdapterDashboard.svelte: 1213 lines
- packages/core/src/api/router.ts: 1210 lines
- apps/site/src/components/VoiceSettings.svelte: 1177 lines
- apps/site/src/components/BackendSettings.svelte: 1154 lines
- packages/core/src/active-operator/system-state.ts: 1152 lines
- apps/site/src/lib/client/local-memory.ts: 1131 lines
- apps/site/src/components/LeftSidebar.svelte: 1129 lines
- brain/agents/desire-outcome-reviewer/core.ts: 1120 lines
- packages/core/src/active-operator/lizard-brain.ts: 1112 lines
- packages/core/src/vllm.ts: 1098 lines
- apps/site/src/components/SystemSettings.svelte: 1087 lines
- packages/core/src/big-brother-terminal.ts: 1062 lines
- apps/site/src/components/PersonaEditor.svelte: 1048 lines
- packages/core/src/api/handlers/auth.ts: 1032 lines
- apps/site/src/components/NetworkServerSettings.svelte: 1032 lines
- packages/core/src/active-operator/big-brother-tasks.ts: 998 lines
- apps/site/src/components/SyncManager.svelte: 977 lines
- brain/agents/desire-planner/core.ts: 959 lines
- apps/site/src/components/SystemCoderDashboard.svelte: 946 lines
- brain/training/full-cycle.ts: 943 lines
- apps/site/src/components/ServerStatus.svelte: 934 lines
- packages/core/src/graph-executor.ts: 923 lines
- packages/core/src/providers/bridge.ts: 919 lines
- apps/site/src/components/TaskManager.svelte: 911 lines
- apps/site/src/components/PersonaGenerator.svelte: 904 lines
- packages/core/src/queue/trigger-manager.ts: 899 lines
- apps/react-native/nodejs-assets/nodejs-project/main.js: 861 lines
- packages/core/src/user-data-collector.ts: 838 lines
- apps/site/src/lib/client/memory-sync.ts: 831 lines
- packages/core/src/api/handlers/profile-sync.ts: 827 lines
- brain/agents/reflector/core.ts: 824 lines
- packages/core/src/nodes/operator/response-synthesizer.node.ts: 822 lines
- apps/site/src/lib/client/composables/useTTS.ts: 821 lines
- packages/core/src/api/handlers/persona-chat.ts: 817 lines
- packages/core/src/connectors/chat-ingestor.ts: 817 lines
- packages/core/src/api/handlers/status.ts: 805 lines
- apps/site/src/components/ChatLayout.svelte: 800 lines

Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.
