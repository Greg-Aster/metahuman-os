/**
 * @metahuman/core
 *
 * Shared core library for MetaHuman OS
 * Used by CLI, web UI, agents, and skills
 */

// IMPORTANT: users.ts must be imported BEFORE path-builder to ensure
// profile storage config registration via dependency injection
export * from './users';

export * from './path-builder';  // Core path functions (no dependencies)
export * from './paths';  // Context-aware paths proxy
export * from './identity';
export * from './memory';
// Note: memory-validation and memory-cleanup are internal utilities, not exported
export * from './memory-metrics-cache';
export * from './recent-tools-cache';
export * from './summary-state';
export * from './function-memory';
export * from './audit';
export * from './llm';
export * from './ollama';
export * from './model-resolver';
export * from './model-router';
export * from './specialist-broker';
export * from './agent-monitor';
export * from './vector-index';
export * from './embeddings';
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
export * from './stt';
export * from './voice-training';
export * from './audio-manager';
export * from './autonomy';
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
export * from './fs-glob';
export * from './progress-tracker';
export * from './state';
export * from './context-builder';
// Cognitive layers - primary source for ValidationResult
export * from './cognitive-layers';

// Agent scheduler - rename AgentStatus to avoid conflict with agent-monitor
export type {
  TriggerType,
  AgentPriority,
  AgentStatus as SchedulerAgentStatus,
  AgentConfig,
  GlobalSchedulerSettings,
  SchedulerConfig,
} from './agent-scheduler.js';
export {
  AgentScheduler,
  scheduler,
} from './agent-scheduler.js';

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
  AnonymousUser,
  User as AuthUser,
} from './auth.js';
export {
  getAuthenticatedUser,
  getUserOrAnonymous,
  getUserPaths,
  hasPermission,
  requirePermission,
} from './auth.js';

export * from './context';  // DEPRECATED - will be removed
export * from './config';
// users.ts exported at top of file (must load before path-builder)
export * from './sessions';
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

// Big Brother Mode - CLI LLM Escalation
export * from './big-brother';
export * from './claude-session';

// Node Editor - Graph Execution
export * from './cognitive-graph-schema';
export * from './graph-executor';
export * from './graph-streaming';

// Unified Node System (schemas + executors colocated)
export * from './nodes/index.js';

export * from './agent-graph-executor';
export * from './graph-error-handler';
export * from './plugin-system';

// Version
export const VERSION = '0.1.0';
export const PHASE = 'Phase 1-2: Intelligence & Autonomy (Multi-User)';
