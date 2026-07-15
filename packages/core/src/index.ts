/**
 * @metahuman/core
 *
 * Shared core library for MetaHuman OS
 * Used by CLI, web UI, agents, and skills
 */

// IMPORTANT: users.ts must be imported BEFORE path-builder to ensure
// profile storage config registration via dependency injection
export * from './users';
export * from './uuid';  // UUID generation (Node.js 12 compatible polyfill)

export * from './path-builder';  // Core path functions (no dependencies)
export * from './paths';  // Path utilities (systemPaths, getProfilePaths, ROOT)
export * from './deployment';  // Deployment mode configuration (local vs server)
export * from './identity';
export * from './memory';
export * from './memory-content-filter';  // Content mode filtering for agent reflections
// Phase 4: Extract tasks from reflections
export {
  type TaskSuggestion,
  type ExtractionResult as TaskExtractionResult,
  type ExtractionOptions as TaskExtractionOptions,
  extractTaskSuggestions,
  listTaskSuggestions,
  getTaskSuggestion,
  approveTaskSuggestion,
  rejectTaskSuggestion,
  bulkApprove,
  cleanupSuggestions,
  reflectionToTask,
} from './reflection-to-task';
// Phase 4: Continual learning from preferences
export {
  type PreferenceCategory,
  type LearnedPreference,
  type PreferenceSnapshot,
  type ExtractionResult as PreferenceExtractionResult,
  type LearningOptions,
  learnPreferences,
  getPreferences,
  getPreference,
  confirmPreference,
  rejectPreference,
  modifyPreference,
  getPreferenceStats,
  getPreferencesByCategory,
  getActivePreferences,
  findContradictions,
  cleanupPreferences,
  preferenceLearner,
} from './preference-learner';
export * from './goal-review';  // Phase 4: Weekly goal reviews
export * from './system-operator';  // Phase 5: System operator maintenance skills
export * from './voice';  // Phase 5: Live voice loop foundation
// Note: memory-validation and memory-cleanup are internal utilities, not exported
export * from './memory-metrics-cache';
export * from './recent-tools-cache';
export * from './summary-state';
export * from './function-memory';
export * from './audit';
export * from './llm';
export * from './ollama';
export * from './vllm';
export * from './vllm-lora';
export * from './llm-backend';
export * from './local-model-service-manager';
export * from './model-resolver';
export * from './model-artifacts';
export * from './model-router';
export * from './specialist-broker';
export * from './agent-monitor';
export * from './agent-executable-resolver';
export * from './agent-process-runner';
export * from './vector-index';
// Embeddings - exclude isEmbeddingServiceAvailable (conflicts with model-router)
export {
  type EmbeddingProvider,
  type EmbeddingConfig,
  loadEmbeddingConfig,
  saveEmbeddingConfig,
  EmbeddingServiceError,
  preloadEmbeddingModel,
  embedText,
  cosineSimilarity,
  getEmbeddingDimensions,
} from './embeddings';
export * from './intelligent-memory-retrieval';
export * from './locks';
export * from './logging';
export * from './runtime-mode';
export * from './transcription';
export * from './adapters';
// Skills - exclude queueForApproval and getPendingApprovals (conflicts with policy)
export type {
  SkillCategory,
  SkillRisk,
  SkillCost,
  TrustLevel,
  InputType,
  SkillInput,
  SkillOutput,
  SkillManifest,
  SkillResult,
  SkillExecution,
  ApprovalQueueItem,
} from './skills.js';
export {
  registerSkill,
  getSkill,
  listSkills,
  getAvailableSkills,
  getApprovalItem,
  approveSkillExecution,
  rejectSkillExecution,
  isPathAllowed,
  isCoderWriteAllowed,
  isWriteAllowed,
  isCommandWhitelisted,
  validateInputs,
  executeSkill,
  loadTrustLevel,
  // Rename conflicting exports
  queueForApproval as skillQueueForApproval,
  getPendingApprovals as skillGetPendingApprovals,
} from './skills.js';
export * from './tool-catalog';
export * from './reasoning';

// Policy - primary source for queueForApproval and getPendingApprovals
export type {
  PolicyDecision,
  ActionContext,
  PendingAction,
} from './policy.js';
export {
  meetsMinimumTrust,
  evaluatePolicy,
  isReadAllowed,
  isWriteAllowedPolicy,
  isCommandAllowed,
  queueForApproval,
  getPendingApprovals,
  approveAction,
  rejectAction,
  getAction,
  canAutoExecute,
  getAllowedSkills,
} from './policy.js';
export * from './tts';
export {
  queueTTS,
  popTTSQueue,
  peekTTSQueue,
  getTTSQueuePath,
  getTTSNotificationPath,
  type TTSQueueItem,
  type TTSQueue,
} from './nodes/output/tts.node.js';
export { parseThinkingBlocks } from './nodes/output/thinking-stripper.node.js';
export * from './stt';
export * from './voice-training';
export * from './audio-manager';
export * from './autonomy';
export * from './environment-interface';
// Cognitive mode - primary source for canWriteMemory
export type {
  CognitiveModeId,
  CognitiveModeDefinition,
  CognitiveModeConfig,
} from './cognitive-mode.js';
export {
  listCognitiveModes,
  getModeDefinition,
  loadCognitiveMode,
  saveCognitiveMode,
  applyModeDefaults,
  canWriteMemory,
  canUseOperator,
} from './cognitive-mode.js';

// Memory policy - exclude canWriteMemory (use cognitive-mode version)
export type {
  UserRole,
  EventType,
  MemoryPolicy,
} from './memory-policy.js';
export {
  canWriteMemory as memoryPolicyCanWriteMemory,
  shouldCaptureTool,
  contextDepth,
  getSearchDepth,
  getContextCharLimit,
  conversationVisibility,
  hasCapability,
  getToolHistoryLimit,
  redactSensitiveData,
  filterToolOutputs,
  canViewMemoryType,
  getMaxMemoriesForRole,
} from './memory-policy.js';
export * from './trust-coupling';
export * from './path-resolver';
export * from './context-window';
export * from './conversation-buffer';
export * from './response-buffer';

// Response pipeline handlers
export {
  handleResponsePipeline,
  streamResponsePipeline,
  type ResponsePipelineRequest,
  type ResponsePipelineResult,
} from './api/handlers/response-pipeline.js';

export * from './fs-glob';
export * from './progress-tracker';
export * from './state';
export * from './context-builder';
// Cognitive layers - primary source for ValidationResult
export * from './cognitive-layers';

// Schema manager - rename FormattedSample to avoid conflict with mode-validator
export type {
  ModelSchema,
  FormattedSample as SchemaFormattedSample,
  SchemaAppliedSample,
} from './schema-manager.js';
export {
  detectModelFamily,
  loadSchema,
  applySchema,
  applySchemaBatch,
  listAvailableSchemas,
  validateSchema,
} from './schema-manager.js';

// Mode validator - rename conflicting exports
export type {
  CognitiveMode,
  ValidationError,
  ValidationResult as ModeValidationResult,
  QualityMetrics,
  FormattedSample as ValidatorFormattedSample,
  CuratedSample,
} from './mode-validator.js';
export {
  validateModeContamination,
  calculateQualityMetrics,
  validateJSONLine,
  validateJSONLDataset,
} from './mode-validator.js';

// Model registry - rename ModelRegistry to avoid conflict with model-resolver
export type {
  ModelRegistryEntry,
  ModelRegistry as TrainingModelRegistry,
} from './model-registry.js';
export {
  loadTrainingRegistry,
  saveModelRegistry,
  getCurrentBaseModel,
  getNextVersion,
  registerTrainingRun,
  resetToOriginalBase,
  getTrainingHistory,
  getLatestModel,
  isUsingLocalModel,
} from './model-registry.js';

export * from './system-activity';
export * from './training-cleanup';

// Persona session manager - rename Session and getSessionStats to avoid conflicts
export type {
  Question,
  Answer,
  SessionStatus,
  CategoryCoverage,
  Session as PersonaSession,
  SessionMetadata as PersonaSessionMetadata,
  SessionIndex,
} from './persona/session-manager.js';
export {
  startSession as startPersonaSession,
  loadSession as loadPersonaSession,
  saveSession as savePersonaSession,
  listSessions as listPersonaSessions,
  discardSession as discardPersonaSession,
  addQuestion,
  recordAnswer,
  getSessionStats as getPersonaSessionStats,
} from './persona/session-manager.js';
export * from './persona/question-generator';
export * from './persona/extractor';
export * from './persona/merger';
export * from './persona/cleanup';

// Multi-user system (Phase 2)
// Auth - rename User to AuthUser to avoid conflict with users.ts
export type {
  Cookies,
  AuthenticatedUser,
  User as AuthUser,
} from './auth.js';
export {
  getAuthenticatedUser,
  getUserPaths,
  hasPermission,
  requirePermission,
  AuthRequiredError,
} from './auth.js';

export * from './context';  // DEPRECATED - will be removed
export * from './config';
export * from './safe-file';  // Atomic file writes with backup for data safety
// users.ts exported at top of file (must load before path-builder)
export * from './sessions';
export * from './window-session';  // Multi-window support
export * from './buffer-locks';     // Conversation buffer locking
export * from './profile';

// Profile storage management
export { validateProfilePath, isValidProfilePath, isExternalStoragePath } from './path-security.js';
export type { PathValidationResult, PathValidationOptions } from './path-security.js';
export { detectStorageDevices, isExternalStorage, getStorageInfo, formatBytes } from './external-storage.js';
export type { StorageDevice, StorageEvent } from './external-storage.js';
export { migrateProfile, resetProfileToDefault, estimateMigrationDuration } from './profile-migration.js';
export type { MigrationProgress, MigrationOptions, MigrationResult, EncryptionType, EncryptionOptions } from './profile-migration.js';

// Unified storage router
export { storageClient } from './storage-client.js';
export type { StorageRequest, WriteRequest, ReadRequest, WriteResult, ReadResult, StorageResponse, FileCategory } from './storage-client.js';

// Profile encryption (low-level)
// Note: unlockProfile/lockProfile are exported from encryption-manager.js (unified API)
export {
  encrypt,
  decrypt,
  decryptToString,
  deriveKey,
  generateSalt,
  isProfileEncrypted,
  getEncryptionMeta,
  initializeEncryption,
  verifyPassword,
  lockAllProfiles,
  isProfileUnlocked,
  getCachedKey,
  encryptFile,
  decryptFile,
  readEncryptedFile,
  readEncryptedJSON,
  writeEncryptedFile,
  writeEncryptedJSON,
  encryptDirectory,
  decryptDirectory,
  changePassword,
  getEncryptionStats,
  isChunkedEncryptedFile,
  decryptChunkedFile,
  decryptChunkedFileToFile,
  decryptChunkedFileInPlace,
  ENCRYPTED_EXTENSION,
  CHUNKED_EXTENSION,
  ENCRYPTION_META_FILE,
} from './encryption.js';
export type { EncryptionMeta, EncryptedData } from './encryption.js';

// VeraCrypt integration
export {
  checkVeraCrypt,
  getInstallInstructions,
  createContainer,
  mountContainer,
  unmountContainer,
  listMountedVolumes,
  isContainerMounted,
  getContainerInfo,
  createMetaHumanContainer,
  isMetaHumanContainer,
  getContainerProfileInfo,
  RECOMMENDED_SIZES,
  CONTAINER_EXTENSION,
} from './veracrypt.js';
export type { VeraCryptStatus, VeraCryptContainer, CreateContainerOptions, MountOptions } from './veracrypt.js';

// LUKS integration (Linux native encryption)
export {
  checkLuks,
  isPolkitConfigured,
  isLuksOpen,
  isLuksMounted,
  getLuksMountPoint,
  getLuksUUID,
  getLuksInfo,
  openLuks,
  closeLuks,
  mountLuks,
  unmountLuks,
  openAndMountLuks,
  unmountAndCloseLuks,
  createLuksContainer,
  createMetaHumanLuksContainer,
  isMetaHumanLuksContainer,
  LUKS_EXTENSION,
} from './luks.js';
export type { LuksResult, LuksStatus, LuksVolumeInfo } from './luks.js';

// Unified encryption manager
export {
  getEncryptionCapabilities,
  getEncryptionStatus,
  unlockProfile,
  lockProfile,
  setupEncryption,
  requiresUnlock,
  getEffectiveProfilePath,
  shouldEncryptFiles,
} from './encryption-manager.js';
export type { EncryptionStatus, UnlockResult, EncryptionCapabilities } from './encryption-manager.js';

// Big Brother Mode - Escalation Backend Abstraction
export * from './big-brother';
export * from './big-brother-terminal';
// Escalation backend - exclude isEscalationAvailable (conflicts with big-brother), rename getActiveBackend
export {
  type EscalationOptions,
  type EscalationResult,
  type ReasoningStep,
  type EscalationBackend,
  registerBackend,
  getBackend,
  getActiveBackend as getActiveEscalationBackend,
  listBackends,
  getBackendStatuses,
  escalate,
  isEscalationReady,
  BACKEND_IDS,
  type BackendId,
  ensureBackendsInitialized,
} from './escalation-backend';
// Export backends (auto-register on import)
export * from './backends/claude-code-backend';
export * from './backends/open-interpreter-backend';
export * from './backends/aider-backend';
export * from './backends/gemini-cli-backend';
export * from './backends/qwen-code-backend';
export * from './backends/codex-backend';

// Node Editor - Graph Execution
export * from './cognitive-graph-schema';
export * from './graph-executor';
export * from './graph-runtime';
export * from './graph-streaming';

// Unified Node System (schemas + executors colocated)
export * from './nodes/index.js';

export * from './agent-graph-executor';
export * from './graph-error-handler';
export * from './plugin-system';

// Agency System
export * from './agency/index.js';

// Work Coordinator (single durable task lifecycle)
// Note: Types renamed to avoid conflict with active-operator
export {
  // Facade
  QueueSystem,
  ensureQueueSystemStarted,
  getQueueSystem,
  resetQueueSystem,
  // Components
  UnifiedQueueManager,
  getQueueManager,
  resetQueueManager,
  ExecutionEngine,
  TriggerManager,
  RemoteDispatcher,
  // Types (renamed to avoid conflicts)
  type ResourceLaneId,
  type WorkState,
  type WorkSource,
  type WorkResource,
  type WorkError,
  type WorkCognitiveMode,
  type QueueLifecycleState,
  type AutonomyMode,
  type TaskInput,
  type LaneConfig,
  type ResourceLane,
  type RemoteTaskHandle,
  type RemoteResult,
  type QueueConfig,
  type QueueState,
  type QueueEvent,
  type QueueEventType,
  type QueueEventListener,
  type AgentTriggerConfig,
  type TriggerManagerConfig,
  TASK_LANE_MAP,
  DEFAULT_HANDLERS,
  DEFAULT_PRIORITIES,
  PRIORITY_VALUES,
  // Persistence
  loadQueueState,
  persistQueueState,
  shouldRestoreState,
  getQueueStateDir,
} from './queue/index.js';

// Active Operator bounded autonomy policy (owns no work queue or executor)
export {
  // Types
  type OperatorMode,
  type ActiveOperatorConfig,
  loadActiveOperatorConfig,
  saveActiveOperatorConfig,
  updateActiveOperatorConfig,
  // Mode controller
  ModeController,
  getModeController,
  getOperatorMode,
  // Self-healing
  type TSError,
  type FixProposal,
  type BigBrotherHealingContext,
  type BigBrotherHealingResult,
  parseTscOutput,
  runTypeCheck,
  analyzeError,
  saveProposal,
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getErrorCount,
  triggerBigBrotherHealing,
  // Critic (Superego - review and approval)
  type ProposedChange,
  type CriticReview,
  type ApprovalRequest as CriticApprovalRequest,
  generateDiff,
  formatDiffSummary,
  assessRisk,
  checkPolicies,
  reviewProposal,
  queueForApproval as criticQueueForApproval,
  getPendingApprovals as criticGetPendingApprovals,
  resolveApproval,
  submitForReview,
  proposeFileWrite,
  proposeFileDelete,
  // Operator Proposals (Human-in-the-Loop)
  type TaskRisk,
  type ProposalTaskType,
  type ProposalResponse,
  type OperatorProposal,
  type ProposalFeedback,
  type ProposalStats,
  type PostExecutionFeedback,
  type PostFeedbackRequest,
  type ProposalTrustLevel,
  TASK_RISK_LEVELS,
  proposalEvents, // Event emitter for waking Active Operator
  createProposal,
  getOperatorPendingProposals,
  getPendingProposalTaskTypes,
  hasPendingProposalForTask,
  getProposal,
  respondToProposal,
  getApprovalRequirement,
  getUserTrustLevel,
  getProposalFeedback,
  getProposalStats,
  getTaskApprovalRate,
  exportProposalTrainingData,
  getPendingPostFeedback,
  submitPostFeedback,
  getPostFeedbackStats,
  exportAllTrainingData,
  cleanupOldProposals,
  // Big Brother execution review
  type ExecutionReviewResult,
  triggerBigBrotherExecutionReview,
  submitImprovementRequest,
} from './active-operator/index.js';

// Drift System (voice/style consistency monitoring)
export * from './drift/index.js';

// System Coder (error capture, fix management, maintenance)
export * from './system-coder/index.js';

// Escalation backends (Big Brother mode - external LLM tool executors)
export * from './tool-executor-config.js';
export * from './open-interpreter.js';
export * from './legacy-cli-adapters.js';

// Phase 3 Connectors (data ingestion)
export * from './connectors/photo-ingestor.js';
export * from './connectors/document-ingestor.js';
export * from './connectors/calendar-connector.js';
// Chat ingestor - rename ChatMessage to avoid conflict with persona/extractor
export {
  type ChatPlatform,
  type ChatMessage as ChatImportMessage,
  type ChatAttachment,
  type ChatConversation,
  type ChatIngestionResult,
  type ChatIngestionOptions,
  detectPlatform,
  parseChatExport,
  ingestChatExport,
  ingestChatsFromDirectory,
  chatIngestor,
} from './connectors/chat-ingestor.js';
export * from './connectors/voice-memo-ingestor.js';
export * from './connectors/clip-tagger.js';

// Version
export const VERSION = '0.1.0';
export const PHASE = 'Phase 1-2: Intelligence & Autonomy (Multi-User)';
