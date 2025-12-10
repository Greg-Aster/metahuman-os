/**
 * Unified API Router
 *
 * Routes requests to handlers based on path and method.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type {
  UnifiedRequest,
  UnifiedResponse,
  UnifiedHandler,
  RouteDefinition,
} from './types.js';
import {
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from './types.js';

// Import handlers (will be populated as we migrate routes)
// For now, start with a few proof-of-concept routes
import { handleBoot } from './handlers/system.js';
import { handleGetStatus } from './handlers/status.js';
import { handleCapture, handleListMemories, handleSearchMemories } from './handlers/memories.js';
import { handleListTasks, handleCreateTask, handleUpdateTask, handleDeleteTask } from './handlers/tasks.js';
import { handleGetMe, handleLogin, handleLogout, handleListUsers, handleSyncUser, handleRegister, handleCreateSyncUser, handleGuest, handleChangePassword, handleResetPassword, handleChangeUsername, handleUpdateProfile } from './handlers/auth.js';
import { handleExportProfile, handleImportProfile, handleExportPriorityProfile, handleGetProfileMetadata, handleGetProfileMemories, handleGetProfileTasks, handleGetProfileChanges } from './handlers/profile-sync.js';
import { handleGetPersona, handleGetPersonaSummary, handleGetPersonaCore, handleUpdatePersonaCore, handleGetPersonaRelationships, handleGetPersonaRoutines, handleGetPersonaDecisionRules } from './handlers/persona.js';
import { handleGetCognitiveMode, handleSetCognitiveMode } from './handlers/cognitive-mode.js';
import { handleGetBuffer, handleAppendBuffer, handleClearBuffer } from './handlers/conversation.js';
import {
  handleGetUsage,
  handleListProviders,
  handleSetProvider,
  handleSaveCredentials,
  handleDeleteCredentials,
} from './handlers/chat.js';
import {
  handleGetStatus as handleGetSystemCoderStatus,
  handleCaptureError,
  handleListErrors,
  handleGetError,
  handleIgnoreError,
  handleRequestFix,
  handleSubmitRequest,
  handleListRequests,
  handleGetRequest,
  handleUpdateRequest,
  handleListFixes,
  handleGetFix,
  handleApproveFix,
  handleRejectFix,
  handleApplyFix,
  handleRevertFix,
  handleGetMaintenanceStatus,
  handleRunMaintenance,
  handleGetMaintenanceReport,
  handleListMaintenanceReports,
} from './handlers/system-coder.js';
import {
  handleListDesires,
  handleGetDesire,
  handleCreateDesire,
  handleUpdateDesire,
  handleDeleteDesire,
  handleApproveDesire,
  handleRejectDesire,
  handleResetDesire,
} from './handlers/agency.js';
import {
  handleGetBoredom,
  handleSetBoredom,
  handleGetCuriosityConfig,
  handleSetCuriosityConfig,
} from './handlers/config.js';
import {
  handleGetAddons,
  handleToggleAddon,
  handleMarkAddonInstalled,
  handleUninstallAddon,
} from './handlers/addons.js';
import {
  handleListCodeApprovals,
  handleGetCodeApproval,
  handleApproveCodeChange,
  handleRejectCodeChange,
} from './handlers/code-approvals.js';
import {
  handleGetTrainingConfig,
  handleUpdateTrainingConfig,
  handleGetTrainingData,
  handleUpdateTrainingData,
} from './handlers/training.js';
import {
  handleGetProfileVisibility,
  handleSetProfileVisibility,
  handleListProfiles,
} from './handlers/profiles.js';
import { handleGetVoiceSample } from './handlers/voice-samples.js';
import { handleGetEncryption } from './handlers/encryption.js';
import { handleGetProfilePath, handleSwitchProfilePath, handleResetProfilePath, handleValidateProfilePath } from './handlers/profile-path.js';
import { handleLockProfile, handleUnlockProfile } from './handlers/encryption-profile.js';
import { handleListStorageDevices } from './handlers/storage-devices.js';
import {
  handleGetOnboardingState,
  handleUpdateOnboardingState,
  handleSkipOnboarding,
  handleCompleteOnboarding,
} from './handlers/onboarding.js';
import {
  handleGetChatSettings,
  handleUpdateChatSettings,
  handleApplyChatPreset,
} from './handlers/chat-settings.js';
import {
  handleGetTrust,
  handleSetTrust,
} from './handlers/trust.js';
import {
  handleGetAgentConfig,
  handleSetAgentConfig,
} from './handlers/agent-config.js';
import {
  handleGetAuditControl,
  handleSetAuditControl,
} from './handlers/audit-control.js';
import {
  handleGetCognitiveLayersConfig,
  handleSetCognitiveLayersConfig,
} from './handlers/cognitive-layers-config.js';
import { handleGetSystemStatus } from './handlers/system-status.js';
import {
  handleGetTrustCoupling,
  handleSetTrustCoupling,
} from './handlers/trust-coupling.js';
import {
  handleGetLoggingConfig,
  handleSetLoggingConfig,
} from './handlers/logging-config.js';
import { handleGetAudit } from './handlers/audit.js';
import { handleGetLoraState } from './handlers/lora-state.js';
import { handleGetSleepStatus } from './handlers/sleep-status.js';
import { handleGetMemoryMetrics } from './handlers/memory-metrics.js';
import { handleGetLoraToggle, handleSetLoraToggle } from './handlers/lora-toggle.js';
import {
  handleGetEmbeddingsControl,
  handleSetEmbeddingsControl,
} from './handlers/embeddings-control.js';
import { handleGetModelInfo } from './handlers/model-info.js';
import { handleListFunctions } from './handlers/functions.js';
import { handleGetGpuStatus } from './handlers/gpu-status.js';
import { handleGetMonitor } from './handlers/monitor.js';
import { handleGetVoiceStatus } from './handlers/voice-status.js';
import { handleGetApprovals, handlePostApproval } from './handlers/approvals.js';
import { handleGetSecurityPolicy } from './handlers/security-policy.js';
import { handleGetRuntimeMode, handleSetRuntimeMode } from './handlers/runtime-mode.js';
import { handleSelectProfile, handleDeleteProfile, handleCreateProfile } from './handlers/profiles-manage.js';
import { handleGetRecoveryCodes, handleRegenerateRecoveryCodes } from './handlers/recovery-codes.js';
import { handleDeleteMemory } from './handlers/memories-delete.js';
import { handleValidateMemory } from './handlers/memories-validate.js';
import { handleClearAudit } from './handlers/audit-clear.js';
import { handleGetSchedulerConfig, handleSetSchedulerConfig } from './handlers/scheduler-config.js';
import { handleGetBigBrotherConfig, handleSetBigBrotherConfig } from './handlers/big-brother-config.js';
import { handleGetCuriosityQuestions } from './handlers/curiosity-questions.js';
import { handleGetPersonaToggle, handleSetPersonaToggle } from './handlers/persona-toggle.js';
import { handleGetStorageStatus } from './handlers/storage-status.js';
import { handleGetAgencyConfig, handleSetAgencyConfig } from './handlers/agency-config.js';
import { handleActivityPing } from './handlers/activity-ping.js';
import { handleGetRunpodConfig } from './handlers/runpod-config.js';
import { handleValidateRunpodKey } from './handlers/runpod-validate.js';
import { handleGetConversationSummary } from './handlers/conversation-summary.js';
import { handleSemanticTurn } from './handlers/semantic-turn.js';
import { handleGetTrainingModels } from './handlers/training-models.js';
import { handleWarmupModel } from './handlers/warmup-model.js';
import { handleGetVoiceModels } from './handlers/voice-models.js';
import { handleGetTrainingHistory } from './handlers/training-history.js';
import { handleGetMemoryContent, handlePutMemoryContent } from './handlers/memory-content.js';
import { handleListPersonaArchives, handlePersonaArchiveAction } from './handlers/persona-archives.js';
import { handleGetKokoroVoices } from './handlers/kokoro-voices.js';
import { handleGetAppVersion, handleAppVersionOptions } from './handlers/app-version.js';
import { handleGetPsychoanalyzerConfig, handleSetPsychoanalyzerConfig } from './handlers/psychoanalyzer-config.js';
import { handleGetDriftConfig, handleSetDriftConfig } from './handlers/drift-config.js';
import { handleGetDriftHistory } from './handlers/drift-history.js';
import { handleGetPersonaFacet, handleSetPersonaFacet } from './handlers/persona-facet.js';
import { handleBigBrotherEscalate } from './handlers/big-brother-escalate.js';
import { handleGetAgencyMetrics } from './handlers/agency-metrics.js';
import { handleGetAgencyPlans, handleUpdateAgencyPlan } from './handlers/agency-plans.js';
import { handleGetAgencyScratchpad } from './handlers/agency-scratchpad.js';
import { handleGetCognitiveGraph, handleCreateCognitiveGraph, handleDeleteCognitiveGraph } from './handlers/cognitive-graph.js';
import { handleListCognitiveGraphs } from './handlers/cognitive-graphs.js';
import { handleGetGraphTraces } from './handlers/graph-traces.js';
import { handleExecuteGraph } from './handlers/execute-graph.js';
import { handleGetNodeSchemas } from './handlers/node-schemas.js';
import { handleGetPersonaCoreManage, handleUpdatePersonaCoreManage } from './handlers/persona-core-manage.js';
import { handleGetPersonaFacetsManage, handleUpdatePersonaFacetsManage } from './handlers/persona-facets-manage.js';
import { handleGetDriftSummary } from './handlers/drift-summary.js';
import { handleGetDriftReports } from './handlers/drift-reports.js';
import { handleGetLlmBackendConfig, handleSetLlmBackendConfig } from './handlers/llm-backend-config.js';
import { handleGetLlmBackendStatus } from './handlers/llm-backend-status.js';
import { handleSwitchLlmBackend } from './handlers/llm-backend-switch.js';
import { handleOllamaControl } from './handlers/llm-backend-ollama.js';
import { handleVllmControl } from './handlers/llm-backend-vllm.js';
import { handleGetModels, handleSetModels } from './handlers/models.js';
import { handleGetFineTuneModels } from './handlers/fine-tune-models.js';
import { handleGetDriftReport } from './handlers/drift-report.js';
import { handleGetCloudflareStatus, handleCloudflareStart, handleCloudflareStop, handleCloudflareToggle } from './handlers/cloudflare.js';
import { handleGetTrainingStatus } from './handlers/training-status.js';
import { handleLifelineTrigger } from './handlers/lifeline-trigger.js';
import { handleGetTrainingConsoleLogs } from './handlers/training-console-logs.js';
import { handleGetTrainingRunning } from './handlers/training-running.js';
import { handleGetTrainingDatasetStats } from './handlers/training-dataset-stats.js';
import { handleGetTrainingLogs } from './handlers/training-logs.js';
import { handleGetVeracryptStatus } from './handlers/veracrypt-status.js';
import { handleGetTrainingLogFile } from './handlers/training-log-file.js';
import { handleExportConversations } from './handlers/export-conversations.js';
import { handleGetGpuInfo } from './handlers/gpu-info.js';
import { handleGetMobileVersion } from './handlers/mobile-version.js';
import { handleResetFactory, handleResetFactoryGet } from './handlers/reset-factory.js';
import { handleExecuteCommand } from './handlers/execute.js';
import { handleGetPersonaIcon } from './handlers/persona-icon.js';
import { handleGetMobileDownload } from './handlers/mobile-download.js';
import { handleMemorySyncPull, handleMemorySyncPushCreate, handleMemorySyncPushUpdate } from './handlers/memory-sync.js';
import { handleGetCredentialsSync, handleSaveCredentialsSync } from './handlers/credentials-sync.js';
import { handleStt } from './handlers/stt.js';
import { handleStartAgent } from './handlers/agent.js';
import { handleGetChatHistory } from './handlers/chat-history.js';
import { handleGetSimpleBuffer } from './handlers/buffer.js';
import { handleTtsGenerate, handleTtsStatus } from './handlers/tts.js';
import { handleGetAllMemories } from './handlers/memories-all.js';
import { handleGetIndex, handleBuildIndex } from './handlers/vector-index.js';
import { handleFileOperation, handleFileOperationsStatus } from './handlers/file-operations.js';
import { handleGetModelRegistry, handleAssignModelRole, handleUpdateModelSettings } from './handlers/model-registry.js';
import { handlePersonaChat, handleClearPersonaChat, handleCancelPersonaChat } from './handlers/persona-chat.js';
import { handleGetServerUpdate, handlePostServerUpdate, handleRestartServer } from './handlers/server-update.js';
// Note: Some complex routes (persona generator, kokoro-training, etc.) kept in Astro files

// ============================================================================
// Route Registry
// ============================================================================

const routes: RouteDefinition[] = [
  // System
  { method: 'GET', pattern: '/api/status', handler: handleGetStatus },
  { method: 'GET', pattern: '/api/boot', handler: handleBoot },

  // Auth
  { method: 'GET', pattern: '/api/auth/me', handler: handleGetMe },
  { method: 'POST', pattern: '/api/auth/login', handler: handleLogin },
  { method: 'POST', pattern: '/api/auth/logout', handler: handleLogout },
  { method: 'POST', pattern: '/api/auth/register', handler: handleRegister },
  { method: 'POST', pattern: '/api/auth/guest', handler: handleGuest },
  { method: 'POST', pattern: '/api/auth/sync-user', handler: handleCreateSyncUser },
  { method: 'GET', pattern: '/api/auth/users', handler: handleListUsers },
  { method: 'POST', pattern: '/api/auth/change-password', handler: handleChangePassword, requiresAuth: true },
  { method: 'POST', pattern: '/api/auth/reset-password', handler: handleResetPassword },  // No auth - uses recovery code
  { method: 'POST', pattern: '/api/auth/change-username', handler: handleChangeUsername, requiresAuth: true },
  { method: 'PUT', pattern: '/api/auth/update-profile', handler: handleUpdateProfile, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/user', handler: handleSyncUser, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/export', handler: handleExportProfile, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/export-priority', handler: handleExportPriorityProfile, requiresAuth: true },
  { method: 'POST', pattern: '/api/profile-sync/import', handler: handleImportProfile, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/metadata', handler: handleGetProfileMetadata, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/memories', handler: handleGetProfileMemories, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/tasks', handler: handleGetProfileTasks, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-sync/changes', handler: handleGetProfileChanges, requiresAuth: true },

  // Memories
  { method: 'POST', pattern: '/api/capture', handler: handleCapture, requiresAuth: true },
  { method: 'GET', pattern: '/api/memories', handler: handleListMemories, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/memories\/search/, handler: handleSearchMemories, requiresAuth: true },

  // Tasks
  { method: 'GET', pattern: '/api/tasks', handler: handleListTasks },  // Anonymous returns empty list
  { method: 'POST', pattern: '/api/tasks', handler: handleCreateTask, requiresAuth: true },
  { method: 'PATCH', pattern: '/api/tasks', handler: handleUpdateTask, requiresAuth: true },  // taskId from body
  { method: ['PUT', 'PATCH'], pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleUpdateTask, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleDeleteTask, requiresAuth: true },

  // Persona
  { method: 'GET', pattern: '/api/persona', handler: handleGetPersona, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona/summary', handler: handleGetPersonaSummary },
  { method: 'GET', pattern: '/api/persona-core', handler: handleGetPersonaCore, requiresAuth: true },
  { method: 'POST', pattern: '/api/persona-core', handler: handleUpdatePersonaCore, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona-relationships', handler: handleGetPersonaRelationships, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona-routines', handler: handleGetPersonaRoutines, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona-decision-rules', handler: handleGetPersonaDecisionRules, requiresAuth: true },

  // Cognitive Mode
  { method: 'GET', pattern: '/api/cognitive-mode', handler: handleGetCognitiveMode },
  { method: 'POST', pattern: '/api/cognitive-mode', handler: handleSetCognitiveMode, requiresAuth: true, guard: 'owner' },

  // Conversation Buffer
  { method: 'GET', pattern: /^\/api\/conversation-buffer/, handler: handleGetBuffer },
  { method: 'POST', pattern: '/api/conversation-buffer', handler: handleAppendBuffer, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/conversation-buffer/, handler: handleClearBuffer, requiresAuth: true },

  // Persona Chat (full cognitive graph pipeline - SAME for web and mobile)
  { method: ['GET', 'POST'], pattern: '/api/persona_chat', handler: handlePersonaChat, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/persona_chat', handler: handleClearPersonaChat, requiresAuth: true },
  { method: 'POST', pattern: '/api/persona_chat/cancel', handler: handleCancelPersonaChat, requiresAuth: true },

  // Chat (cloud provider management for mobile/offline mode)
  { method: 'GET', pattern: '/api/chat/usage', handler: handleGetUsage, requiresAuth: true },
  { method: 'GET', pattern: '/api/chat/providers', handler: handleListProviders, requiresAuth: true },
  { method: 'PUT', pattern: '/api/chat/provider', handler: handleSetProvider, requiresAuth: true },
  { method: 'POST', pattern: '/api/chat/credentials', handler: handleSaveCredentials, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/chat/credentials', handler: handleDeleteCredentials, requiresAuth: true },

  // System Coder
  { method: 'GET', pattern: '/api/system-coder/status', handler: handleGetSystemCoderStatus, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/capture-error', handler: handleCaptureError, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/errors', handler: handleListErrors, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/errors\/[^\/]+$/, handler: handleGetError, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/errors\/[^\/]+\/ignore$/, handler: handleIgnoreError, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/errors\/[^\/]+\/fix$/, handler: handleRequestFix, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/request', handler: handleSubmitRequest, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/requests', handler: handleListRequests, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/requests\/[^\/]+$/, handler: handleGetRequest, requiresAuth: true },
  { method: 'PUT', pattern: /^\/api\/system-coder\/requests\/[^\/]+$/, handler: handleUpdateRequest, requiresAuth: true },

  // System Coder - Fixes
  { method: 'GET', pattern: '/api/system-coder/fixes', handler: handleListFixes, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/fixes\/[^\/]+$/, handler: handleGetFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/approve$/, handler: handleApproveFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/reject$/, handler: handleRejectFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/apply$/, handler: handleApplyFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/revert$/, handler: handleRevertFix, requiresAuth: true },

  // System Coder - Maintenance
  { method: 'GET', pattern: '/api/system-coder/maintenance/status', handler: handleGetMaintenanceStatus, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/maintenance/run', handler: handleRunMaintenance, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/maintenance/report', handler: handleGetMaintenanceReport, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/maintenance/reports', handler: handleListMaintenanceReports, requiresAuth: true },

  // Agency - Desires
  { method: 'GET', pattern: '/api/agency/desires', handler: handleListDesires, requiresAuth: true },
  { method: 'POST', pattern: '/api/agency/desires', handler: handleCreateDesire, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/agency\/desires\/[^\/]+$/, handler: handleGetDesire, requiresAuth: true },
  { method: 'PUT', pattern: /^\/api\/agency\/desires\/[^\/]+$/, handler: handleUpdateDesire, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/agency\/desires\/[^\/]+$/, handler: handleDeleteDesire, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/agency\/desires\/[^\/]+\/approve$/, handler: handleApproveDesire, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/agency\/desires\/[^\/]+\/reject$/, handler: handleRejectDesire, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/agency\/desires\/[^\/]+\/reset$/, handler: handleResetDesire, requiresAuth: true },

  // Config
  { method: 'GET', pattern: '/api/boredom', handler: handleGetBoredom },
  { method: 'POST', pattern: '/api/boredom', handler: handleSetBoredom },
  { method: 'GET', pattern: '/api/curiosity-config', handler: handleGetCuriosityConfig, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/curiosity-config', handler: handleSetCuriosityConfig, requiresAuth: true, guard: 'owner' },

  // Addons
  { method: 'GET', pattern: '/api/addons', handler: handleGetAddons },
  { method: 'POST', pattern: '/api/addons/toggle', handler: handleToggleAddon },
  { method: 'POST', pattern: '/api/addons/mark-installed', handler: handleMarkAddonInstalled },
  { method: 'POST', pattern: '/api/addons/uninstall', handler: handleUninstallAddon },

  // Code Approvals
  { method: 'GET', pattern: '/api/code-approvals', handler: handleListCodeApprovals, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/code-approvals\/[^\/]+$/, handler: handleGetCodeApproval, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/code-approvals\/[^\/]+\/approve$/, handler: handleApproveCodeChange, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/code-approvals\/[^\/]+\/reject$/, handler: handleRejectCodeChange, requiresAuth: true },

  // Training
  { method: 'GET', pattern: '/api/training-config', handler: handleGetTrainingConfig },
  { method: 'POST', pattern: '/api/training-config', handler: handleUpdateTrainingConfig, requiresAuth: true },
  { method: 'GET', pattern: '/api/training-data', handler: handleGetTrainingData },
  { method: 'POST', pattern: '/api/training-data', handler: handleUpdateTrainingData, guard: 'owner' },

  // Profiles
  { method: 'GET', pattern: '/api/profiles/visibility', handler: handleGetProfileVisibility, requiresAuth: true },
  { method: 'POST', pattern: '/api/profiles/visibility', handler: handleSetProfileVisibility, requiresAuth: true },
  { method: 'GET', pattern: '/api/profiles/list', handler: handleListProfiles },

  // Onboarding
  { method: 'GET', pattern: '/api/onboarding/state', handler: handleGetOnboardingState, requiresAuth: true },
  { method: 'POST', pattern: '/api/onboarding/state', handler: handleUpdateOnboardingState, requiresAuth: true },
  { method: 'POST', pattern: '/api/onboarding/skip', handler: handleSkipOnboarding, requiresAuth: true },
  { method: 'POST', pattern: '/api/onboarding/complete', handler: handleCompleteOnboarding, requiresAuth: true },

  // Chat Settings
  { method: 'GET', pattern: '/api/chat-settings', handler: handleGetChatSettings },
  { method: 'PUT', pattern: '/api/chat-settings', handler: handleUpdateChatSettings },
  { method: 'POST', pattern: '/api/chat-settings', handler: handleApplyChatPreset },

  // Trust
  { method: 'GET', pattern: '/api/trust', handler: handleGetTrust },
  { method: 'POST', pattern: '/api/trust', handler: handleSetTrust, requiresAuth: true, guard: 'owner' },

  // Agent Config
  { method: 'GET', pattern: '/api/agent-config', handler: handleGetAgentConfig, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/agent-config', handler: handleSetAgentConfig, requiresAuth: true, guard: 'owner' },

  // Audit Control
  { method: 'GET', pattern: '/api/audit-control', handler: handleGetAuditControl, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/audit-control', handler: handleSetAuditControl, requiresAuth: true, guard: 'owner' },

  // Cognitive Layers Config
  { method: 'GET', pattern: '/api/cognitive-layers-config', handler: handleGetCognitiveLayersConfig },
  { method: 'POST', pattern: '/api/cognitive-layers-config', handler: handleSetCognitiveLayersConfig },

  // System Status
  { method: 'GET', pattern: '/api/system-status', handler: handleGetSystemStatus },

  // Trust Coupling
  { method: 'GET', pattern: '/api/trust-coupling', handler: handleGetTrustCoupling },
  { method: 'POST', pattern: '/api/trust-coupling', handler: handleSetTrustCoupling, requiresAuth: true, guard: 'owner' },

  // Logging Config
  { method: 'GET', pattern: '/api/logging-config', handler: handleGetLoggingConfig },
  { method: 'POST', pattern: '/api/logging-config', handler: handleSetLoggingConfig },

  // Audit
  { method: 'GET', pattern: '/api/audit', handler: handleGetAudit },

  // LoRA State
  { method: 'GET', pattern: '/api/lora-state', handler: handleGetLoraState },

  // Sleep Status
  { method: 'GET', pattern: '/api/sleep-status', handler: handleGetSleepStatus },

  // Memory Metrics
  { method: 'GET', pattern: '/api/memory-metrics', handler: handleGetMemoryMetrics, requiresAuth: true },

  // LoRA Toggle
  { method: 'GET', pattern: '/api/lora-toggle', handler: handleGetLoraToggle },
  { method: 'POST', pattern: '/api/lora-toggle', handler: handleSetLoraToggle, requiresAuth: true },

  // Embeddings Control
  { method: 'GET', pattern: '/api/embeddings-control', handler: handleGetEmbeddingsControl, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/embeddings-control', handler: handleSetEmbeddingsControl, requiresAuth: true, guard: 'owner' },

  // Model Info
  { method: 'GET', pattern: '/api/model-info', handler: handleGetModelInfo },

  // Functions
  { method: 'GET', pattern: '/api/functions', handler: handleListFunctions },

  // GPU Status
  { method: 'GET', pattern: '/api/gpu-status', handler: handleGetGpuStatus },

  // Monitor
  { method: 'GET', pattern: '/api/monitor', handler: handleGetMonitor },

  // Voice Status
  { method: 'GET', pattern: '/api/voice-status', handler: handleGetVoiceStatus },

  // Approvals
  { method: 'GET', pattern: '/api/approvals', handler: handleGetApprovals, requiresAuth: true },
  { method: 'POST', pattern: '/api/approvals', handler: handlePostApproval, requiresAuth: true, guard: 'owner' },

  // Security Policy
  { method: 'GET', pattern: '/api/security/policy', handler: handleGetSecurityPolicy },

  // Runtime Mode
  { method: 'GET', pattern: '/api/runtime/mode', handler: handleGetRuntimeMode },
  { method: 'POST', pattern: '/api/runtime/mode', handler: handleSetRuntimeMode, requiresAuth: true, guard: 'owner' },

  // Profile Management
  { method: 'POST', pattern: '/api/profiles/select', handler: handleSelectProfile },
  { method: 'POST', pattern: '/api/profiles/delete', handler: handleDeleteProfile, requiresAuth: true },
  { method: 'POST', pattern: '/api/profiles/create', handler: handleCreateProfile, requiresAuth: true, guard: 'owner' },

  // Recovery Codes
  { method: 'GET', pattern: '/api/recovery-codes', handler: handleGetRecoveryCodes, requiresAuth: true },
  { method: 'POST', pattern: '/api/recovery-codes', handler: handleRegenerateRecoveryCodes, requiresAuth: true },

  // Memory Delete
  { method: 'POST', pattern: '/api/memories/delete', handler: handleDeleteMemory, requiresAuth: true },

  // Memory Validate
  { method: 'POST', pattern: '/api/memories/validate', handler: handleValidateMemory, requiresAuth: true },

  // Audit Clear
  { method: 'DELETE', pattern: '/api/audit/clear', handler: handleClearAudit, requiresAuth: true },

  // Scheduler Config
  { method: 'GET', pattern: '/api/scheduler-config', handler: handleGetSchedulerConfig },
  { method: 'POST', pattern: '/api/scheduler-config', handler: handleSetSchedulerConfig, requiresAuth: true, guard: 'owner' },

  // Big Brother Config
  { method: 'GET', pattern: '/api/big-brother-config', handler: handleGetBigBrotherConfig },
  { method: 'POST', pattern: '/api/big-brother-config', handler: handleSetBigBrotherConfig, requiresAuth: true, guard: 'owner' },

  // Curiosity Questions (deprecated)
  { method: 'GET', pattern: '/api/curiosity/questions', handler: handleGetCuriosityQuestions, requiresAuth: true },

  // Persona Toggle
  { method: 'GET', pattern: '/api/persona-toggle', handler: handleGetPersonaToggle },
  { method: 'POST', pattern: '/api/persona-toggle', handler: handleSetPersonaToggle },

  // Storage Status
  { method: 'GET', pattern: '/api/storage-status', handler: handleGetStorageStatus },

  // Agency Config
  { method: 'GET', pattern: '/api/agency/config', handler: handleGetAgencyConfig, requiresAuth: true },
  { method: 'PUT', pattern: '/api/agency/config', handler: handleSetAgencyConfig, requiresAuth: true, guard: 'owner' },

  // Activity Ping
  { method: 'POST', pattern: '/api/activity-ping', handler: handleActivityPing },

  // RunPod
  { method: 'GET', pattern: '/api/runpod/config', handler: handleGetRunpodConfig, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/runpod/validate', handler: handleValidateRunpodKey },

  // Conversation Summary
  { method: 'GET', pattern: '/api/conversation/summary', handler: handleGetConversationSummary, requiresAuth: true },

  // Semantic Turn Detection
  { method: 'POST', pattern: '/api/semantic-turn', handler: handleSemanticTurn },

  // Training Models
  { method: 'GET', pattern: '/api/training-models', handler: handleGetTrainingModels },

  // Warmup Model
  { method: 'POST', pattern: '/api/warmup-model', handler: handleWarmupModel, requiresAuth: true },

  // Voice Models
  { method: 'GET', pattern: '/api/voice-models', handler: handleGetVoiceModels },

  // Training History
  { method: 'GET', pattern: '/api/training/history', handler: handleGetTrainingHistory },

  // Memory Content
  { method: 'GET', pattern: '/api/memory-content', handler: handleGetMemoryContent },
  { method: 'PUT', pattern: '/api/memory-content', handler: handlePutMemoryContent, requiresAuth: true },

  // Persona Archives
  { method: 'GET', pattern: '/api/persona-archives', handler: handleListPersonaArchives, requiresAuth: true },
  { method: 'POST', pattern: '/api/persona-archives', handler: handlePersonaArchiveAction, requiresAuth: true },

  // Kokoro Voices
  { method: 'GET', pattern: '/api/kokoro-voices', handler: handleGetKokoroVoices },

  // App Version
  { method: 'GET', pattern: '/api/app-version', handler: handleGetAppVersion },
  { method: 'OPTIONS', pattern: '/api/app-version', handler: handleAppVersionOptions },

  // Psychoanalyzer Config
  { method: 'GET', pattern: '/api/psychoanalyzer-config', handler: handleGetPsychoanalyzerConfig },
  { method: 'POST', pattern: '/api/psychoanalyzer-config', handler: handleSetPsychoanalyzerConfig, requiresAuth: true, guard: 'owner' },

  // Drift Config
  { method: 'GET', pattern: '/api/drift/config', handler: handleGetDriftConfig, requiresAuth: true },
  { method: 'PUT', pattern: '/api/drift/config', handler: handleSetDriftConfig, requiresAuth: true },

  // Drift History
  { method: 'GET', pattern: '/api/drift/history', handler: handleGetDriftHistory, requiresAuth: true },

  // Persona Facet
  { method: 'GET', pattern: '/api/persona-facet', handler: handleGetPersonaFacet },
  { method: 'POST', pattern: '/api/persona-facet', handler: handleSetPersonaFacet, requiresAuth: true },

  // Big Brother Escalate
  { method: 'POST', pattern: '/api/big-brother-escalate', handler: handleBigBrotherEscalate, requiresAuth: true },

  // Agency Metrics
  { method: 'GET', pattern: '/api/agency/metrics', handler: handleGetAgencyMetrics, requiresAuth: true },

  // Agency Plans
  { method: 'GET', pattern: '/api/agency/plans', handler: handleGetAgencyPlans, requiresAuth: true },
  { method: 'PUT', pattern: '/api/agency/plans', handler: handleUpdateAgencyPlan, requiresAuth: true },

  // Agency Scratchpad
  { method: 'GET', pattern: '/api/agency/scratchpad', handler: handleGetAgencyScratchpad, requiresAuth: true },

  // Cognitive Graphs
  { method: 'GET', pattern: '/api/cognitive-graphs', handler: handleListCognitiveGraphs },
  { method: 'GET', pattern: '/api/cognitive-graph', handler: handleGetCognitiveGraph },
  { method: 'POST', pattern: '/api/cognitive-graph', handler: handleCreateCognitiveGraph, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/cognitive-graph', handler: handleDeleteCognitiveGraph, requiresAuth: true },

  // Graph Execution
  { method: 'GET', pattern: '/api/graph-traces', handler: handleGetGraphTraces },
  { method: 'POST', pattern: '/api/execute-graph', handler: handleExecuteGraph },

  // Node Schemas
  { method: 'GET', pattern: '/api/node-schemas', handler: handleGetNodeSchemas },

  // Persona Core Manage
  { method: 'GET', pattern: '/api/persona-core-manage', handler: handleGetPersonaCoreManage },
  { method: 'POST', pattern: '/api/persona-core-manage', handler: handleUpdatePersonaCoreManage, requiresAuth: true },

  // Persona Facets Manage
  { method: 'GET', pattern: '/api/persona-facets-manage', handler: handleGetPersonaFacetsManage },
  { method: 'POST', pattern: '/api/persona-facets-manage', handler: handleUpdatePersonaFacetsManage, requiresAuth: true },

  // Drift Summary & Reports
  { method: 'GET', pattern: '/api/drift/summary', handler: handleGetDriftSummary, requiresAuth: true },
  { method: 'GET', pattern: '/api/drift/reports', handler: handleGetDriftReports, requiresAuth: true },

  // LLM Backend
  { method: 'GET', pattern: '/api/llm-backend/config', handler: handleGetLlmBackendConfig },
  { method: 'PUT', pattern: '/api/llm-backend/config', handler: handleSetLlmBackendConfig, requiresAuth: true, guard: 'owner' },
  { method: 'GET', pattern: '/api/llm-backend/status', handler: handleGetLlmBackendStatus },
  { method: 'POST', pattern: '/api/llm-backend/switch', handler: handleSwitchLlmBackend, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/llm-backend/ollama', handler: handleOllamaControl, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/llm-backend/vllm', handler: handleVllmControl, requiresAuth: true, guard: 'owner' },

  // Models
  { method: 'GET', pattern: '/api/models', handler: handleGetModels, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/models', handler: handleSetModels, requiresAuth: true, guard: 'owner' },

  // Model Registry - authenticated users can manage their own model preferences
  { method: 'GET', pattern: '/api/model-registry', handler: handleGetModelRegistry, requiresAuth: true },
  { method: 'POST', pattern: '/api/model-registry', handler: handleAssignModelRole, requiresAuth: true },
  { method: 'PUT', pattern: '/api/model-registry', handler: handleUpdateModelSettings, requiresAuth: true },

  // Fine-Tune Models
  { method: 'GET', pattern: '/api/fine-tune/models', handler: handleGetFineTuneModels, requiresAuth: true, guard: 'owner' },

  // Drift Report by ID
  { method: 'GET', pattern: /^\/api\/drift\/reports\/([^\/]+)$/, handler: handleGetDriftReport, requiresAuth: true },

  // Cloudflare Tunnel
  { method: 'GET', pattern: '/api/cloudflare/status', handler: handleGetCloudflareStatus },
  { method: 'POST', pattern: '/api/cloudflare/start', handler: handleCloudflareStart },
  { method: 'POST', pattern: '/api/cloudflare/stop', handler: handleCloudflareStop },
  { method: 'POST', pattern: '/api/cloudflare/toggle', handler: handleCloudflareToggle },

  // Training
  { method: 'GET', pattern: '/api/training/status', handler: handleGetTrainingStatus },
  { method: 'GET', pattern: '/api/training/console-logs', handler: handleGetTrainingConsoleLogs },
  { method: 'GET', pattern: '/api/training/running', handler: handleGetTrainingRunning },
  { method: 'GET', pattern: '/api/training/dataset-stats', handler: handleGetTrainingDatasetStats, requiresAuth: true },
  { method: 'GET', pattern: '/api/training/logs', handler: handleGetTrainingLogs },

  // Lifeline
  { method: 'POST', pattern: '/api/lifeline/trigger', handler: handleLifelineTrigger },

  // VeraCrypt
  { method: 'GET', pattern: '/api/veracrypt/status', handler: handleGetVeracryptStatus },

  // Training Log File
  { method: 'GET', pattern: '/api/training/log-file', handler: handleGetTrainingLogFile },

  // Export Conversations
  { method: 'POST', pattern: '/api/export/conversations', handler: handleExportConversations, requiresAuth: true },

  // System GPU Info
  { method: 'GET', pattern: '/api/system/gpu-info', handler: handleGetGpuInfo },

  // Mobile Version
  { method: 'GET', pattern: '/api/mobile/version', handler: handleGetMobileVersion },

  // Factory Reset
  { method: 'POST', pattern: '/api/reset-factory', handler: handleResetFactory, requiresAuth: true, guard: 'owner' },
  { method: 'GET', pattern: '/api/reset-factory', handler: handleResetFactoryGet },

  // Execute CLI Command
  { method: 'POST', pattern: '/api/execute', handler: handleExecuteCommand },

  // Persona Icon (binary image response)
  { method: 'GET', pattern: '/api/persona-icon', handler: handleGetPersonaIcon },

  // Mobile Download (binary APK response)
  { method: 'GET', pattern: '/api/mobile/download', handler: handleGetMobileDownload },

  // Memory Sync (mobile offline sync)
  { method: 'GET', pattern: '/api/memory/sync/pull', handler: handleMemorySyncPull, requiresAuth: true },
  { method: 'POST', pattern: '/api/memory/sync/push', handler: handleMemorySyncPushCreate, requiresAuth: true },
  { method: 'PUT', pattern: '/api/memory/sync/push', handler: handleMemorySyncPushUpdate, requiresAuth: true },

  // Credentials Sync (mobile fetches from desktop server)
  { method: 'GET', pattern: '/api/profile-sync/credentials', handler: handleGetCredentialsSync, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/profile-sync/credentials', handler: handleSaveCredentialsSync, requiresAuth: true, guard: 'owner' },

  // Routes below kept in Astro files (complex multi-module dependencies):
  // - /api/kokoro-training
  // - /api/profile-path/validate
  // - /api/conversation/summarize
  // - /api/persona/generator/*

  // STT (Speech-to-Text)
  { method: 'POST', pattern: '/api/stt', handler: handleStt },

  // Agent Control
  { method: 'POST', pattern: '/api/agent', handler: handleStartAgent, requiresAuth: true },

  // Chat History
  { method: 'GET', pattern: '/api/chat/history', handler: handleGetChatHistory },

  // Simple Buffer (for page load/tab switching)
  { method: 'GET', pattern: '/api/buffer', handler: handleGetSimpleBuffer },

  // TTS (Text-to-Speech)
  { method: 'POST', pattern: '/api/tts', handler: handleTtsGenerate },
  { method: 'GET', pattern: '/api/tts', handler: handleTtsStatus },

  // Memories All (memory browser)
  { method: 'GET', pattern: '/api/memories_all', handler: handleGetAllMemories, requiresAuth: true },

  // Vector Index
  { method: 'GET', pattern: '/api/index', handler: handleGetIndex, requiresAuth: true },
  { method: 'POST', pattern: '/api/index', handler: handleBuildIndex, requiresAuth: true },

  // File Operations
  { method: 'GET', pattern: '/api/file_operations', handler: handleFileOperationsStatus },
  { method: 'POST', pattern: '/api/file_operations', handler: handleFileOperation },

  // Voice Samples
  { method: 'GET', pattern: /^\/api\/voice-samples\/([^\/]+)$/, handler: handleGetVoiceSample },

  // Encryption
  { method: 'GET', pattern: '/api/encryption', handler: handleGetEncryption },

  // Profile Path
  { method: 'GET', pattern: '/api/profile-path', handler: handleGetProfilePath, requiresAuth: true },
  { method: 'PUT', pattern: '/api/profile-path', handler: handleSwitchProfilePath, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/profile-path', handler: handleResetProfilePath, requiresAuth: true },
  { method: 'POST', pattern: '/api/profile-path/validate', handler: handleValidateProfilePath, requiresAuth: true },
  { method: 'GET', pattern: '/api/profile-path/devices', handler: handleListStorageDevices, requiresAuth: true },

  // Encryption Profile
  { method: 'POST', pattern: '/api/encryption/lock', handler: handleLockProfile, requiresAuth: true },
  { method: 'POST', pattern: '/api/encryption/unlock', handler: handleUnlockProfile, requiresAuth: true },

  // Server Update (web/desktop only - git-based updates)
  { method: 'GET', pattern: '/api/server-update', handler: handleGetServerUpdate, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/server-update', handler: handlePostServerUpdate, requiresAuth: true, guard: 'owner' },
  { method: 'POST', pattern: '/api/server-update/restart', handler: handleRestartServer, requiresAuth: true, guard: 'owner' },
];

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Match a request to a route definition
 */
function matchRoute(method: string, path: string): RouteDefinition | null {
  // Normalize path (remove query string, trailing slash)
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/';

  for (const route of routes) {
    // Check method
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes(method)) continue;

    // Check pattern
    if (typeof route.pattern === 'string') {
      if (normalizedPath === route.pattern) {
        return route;
      }
    } else if (route.pattern instanceof RegExp) {
      if (route.pattern.test(normalizedPath)) {
        return route;
      }
    }
  }

  return null;
}

/**
 * Extract path parameters from a path (e.g., /api/tasks/task-123 -> { id: 'task-123' })
 */
function extractPathParams(path: string, pattern: string | RegExp): Record<string, string> {
  const params: Record<string, string> = {};

  // For regex patterns, extract the last path segment as 'id' by convention
  if (pattern instanceof RegExp) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 2) {
      params.id = segments[segments.length - 1];
    }
  }

  return params;
}

/**
 * Parse query string from path
 */
function parseQuery(path: string): Record<string, string> {
  const queryString = path.split('?')[1];
  if (!queryString) return {};

  const params: Record<string, string> = {};
  for (const param of queryString.split('&')) {
    const [key, value] = param.split('=');
    if (key) {
      params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    }
  }
  return params;
}

// ============================================================================
// Security Guards
// ============================================================================

/**
 * Check if user passes the security guard
 */
function checkGuard(guard: string | undefined, user: UnifiedRequest['user']): boolean {
  if (!guard) return true;

  switch (guard) {
    case 'owner':
      return user.role === 'owner';
    case 'writeMode':
      // TODO: Check cognitive mode from config
      return user.isAuthenticated;
    case 'operatorMode':
      return user.role === 'owner';
    default:
      return true;
  }
}

// ============================================================================
// Main Router
// ============================================================================

/**
 * Route a request to the appropriate handler
 *
 * This is the main entry point - adapters call this with a UnifiedRequest
 */
export async function routeRequest(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Find matching route
  const route = matchRoute(req.method, req.path);

  if (!route) {
    return notFoundResponse(`Route not found: ${req.method} ${req.path}`);
  }

  // Check authentication
  if (route.requiresAuth && !req.user.isAuthenticated) {
    return unauthorizedResponse();
  }

  // Check security guard
  if (!checkGuard(route.guard, req.user)) {
    return forbiddenResponse('Insufficient permissions');
  }

  // Extract path params and merge with existing
  const pathParams = extractPathParams(req.path, route.pattern);
  const query = { ...parseQuery(req.path), ...req.query };

  // Create enriched request
  const enrichedReq: UnifiedRequest = {
    ...req,
    params: { ...req.params, ...pathParams },
    query,
  };

  // Execute handler
  try {
    return await route.handler(enrichedReq);
  } catch (error) {
    console.error(`[router] Handler error for ${req.method} ${req.path}:`, error);
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }
}

/**
 * Register a new route dynamically
 */
export function registerRoute(route: RouteDefinition): void {
  routes.push(route);
}

/**
 * List all registered routes (for debugging)
 */
export function listRoutes(): Array<{ method: string | string[]; pattern: string }> {
  return routes.map(r => ({
    method: r.method,
    pattern: typeof r.pattern === 'string' ? r.pattern : r.pattern.source,
  }));
}
