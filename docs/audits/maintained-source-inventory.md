# Maintained Source Inventory

Generated: 2026-09-04T17:36:41.609Z

Total maintained files: 1629
Code files: 1386
Policy: `docs/technical/MAINTAINED_SURFACE.md`

## By Area

- agent-runtime: 4
- agents: 86
- bin: 21
- brain-services: 2
- cli: 12
- config: 81
- core-engine: 760
- docs: 51
- external-integration: 7
- local-model-service: 6
- mobile-interface: 49
- mobile-runtime: 2
- repo-root: 23
- scripts: 19
- tests: 4
- training: 31
- web-interface: 471

## By Kind

- code: 1386
- docs: 59
- json: 99
- other: 54
- shell: 29
- yaml: 2

## First Audit Batches

1. `packages/core` boundary and storage engine files.
2. `apps/site/src/pages/api` transport routes and handlers.
3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.
4. `packages/cli` command ownership and smoke behavior.
5. Oversized UI/core files and orphan candidates.

## Oversized Code Files

- apps/site/src/components/ChatInterface.svelte: 2742 lines
- packages/core/src/nodes/schemas.ts: 2650 lines
- apps/site/src/components/AgencyDashboard.svelte: 2574 lines
- packages/core/src/voice-training.ts: 2312 lines
- packages/core/src/profile.ts: 1979 lines
- apps/site/src/lib/client/composables/useMicrophone.ts: 1957 lines
- packages/core/src/api/handlers/agency.ts: 1926 lines
- brain/training/personalization/lora-trainer.ts: 1798 lines
- apps/site/src/components/BackendSettings.svelte: 1781 lines
- packages/core/src/memory.ts: 1735 lines
- apps/site/src/components/CenterContent.svelte: 1678 lines
- packages/core/src/vllm.ts: 1615 lines
- packages/core/src/agency/storage.ts: 1614 lines
- apps/site/src/components/TrainingWizard.svelte: 1571 lines
- packages/cli/src/main.ts: 1571 lines
- packages/core/src/api/router.ts: 1434 lines
- apps/site/src/components/AuthGate.svelte: 1433 lines
- packages/core/src/function-memory.ts: 1384 lines
- apps/site/src/components/ProfileLocation.svelte: 1344 lines
- packages/core/src/agency/types.ts: 1284 lines
- packages/core/src/active-operator/operator-proposals.ts: 1282 lines
- packages/core/src/profile-migration.ts: 1273 lines
- brain/agents/desire-generator/core.ts: 1188 lines
- apps/site/src/components/VoiceSettings.svelte: 1182 lines
- packages/core/src/nodes/operator/response-synthesizer.node.ts: 1157 lines
- apps/site/src/components/SecuritySettings.svelte: 1156 lines
- apps/site/src/components/LeftSidebar.svelte: 1144 lines
- packages/core/src/environment-interface/compatibility.spec.ts: 1139 lines
- packages/core/src/context-builder.ts: 1113 lines
- apps/site/src/components/flow-editor/FlowEditor.svelte: 1097 lines
- apps/site/src/components/PersonaEditor.svelte: 1086 lines
- packages/core/src/api/handlers/auth.ts: 1069 lines
- brain/training/environment-action-selector/development-cases.ts: 1031 lines
- packages/core/src/nodes/environment/helpers.ts: 1020 lines
- packages/core/src/api/handlers/voice-settings.ts: 989 lines
- packages/core/src/nodes/robot-operator/boredom-autonomy.spec.ts: 989 lines
- apps/site/src/lib/client/composables/useTTS.ts: 984 lines
- apps/site/src/components/SystemSettings.svelte: 981 lines
- brain/agents/desire-planner/core.ts: 975 lines
- apps/site/src/components/NetworkServerSettings.svelte: 973 lines
- packages/core/src/environment-interface/motion-plan.spec.ts: 969 lines
- brain/agents/environment-bridge/core.ts: 962 lines
- packages/core/src/graph-executor.ts: 945 lines
- packages/core/src/llm-backend.ts: 943 lines
- packages/core/src/vector-index.ts: 912 lines
- packages/core/src/ollama.ts: 910 lines
- apps/site/src/components/TaskManager.svelte: 910 lines
- packages/core/src/api/handlers/persona-chat.ts: 907 lines
- apps/site/src/components/PersonaGenerator.svelte: 904 lines
- packages/core/src/providers/bridge.ts: 894 lines
- apps/site/src/lib/client/local-memory.ts: 888 lines
- apps/site/src/components/ServerStatus.svelte: 878 lines
- brain/agents/psychoanalyzer/core.ts: 864 lines
- packages/core/src/queue/trigger-manager.ts: 847 lines
- apps/site/src/lib/client/memory-sync.ts: 831 lines
- packages/core/src/cognitive-graph-schema.ts: 821 lines
- packages/core/src/connectors/chat-ingestor.ts: 815 lines
- apps/site/src/components/ChatLayout.svelte: 807 lines

Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.
