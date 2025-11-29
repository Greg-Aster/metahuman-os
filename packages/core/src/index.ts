/**
 * @metahuman/core
 *
 * Shared core library for MetaHuman OS
 * Used by CLI, web UI, agents, and skills
 */

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
export * from './locks';
export * from './logging';
export * from './runtime-mode';
export * from './transcription';
export * from './adapters';
export * from './skills';
export * from './tool-catalog';
export * from './reasoning';
export * from './policy';
export * from './tts';
export * from './stt';
export * from './voice-training';
export * from './audio-manager';
export * from './autonomy';
export * from './cognitive-mode';
export * from './memory-policy';
export * from './trust-coupling';
export * from './path-resolver';
export * from './context-window';
export * from './conversation-buffer';
export * from './fs-glob';
export * from './progress-tracker';
export * from './state';
export * from './context-builder';
export * from './cognitive-layers';
export * from './agent-scheduler';
export * from './schema-manager';
export * from './mode-validator';
export * from './model-registry';
export * from './system-activity';
export * from './training-cleanup';
export * from './persona/session-manager';
export * from './persona/question-generator';
export * from './persona/extractor';
export * from './persona/merger';
export * from './persona/cleanup';

// Multi-user system (Phase 2)
export * from './auth';  // Simple auth helpers (replaces middleware)
export * from './context';  // DEPRECATED - will be removed
export * from './config';
export * from './users';
export * from './sessions';
export * from './profile';

// Profile storage management
export { validateProfilePath, isValidProfilePath, isExternalStoragePath } from './path-security.js';
export type { PathValidationResult, PathValidationOptions } from './path-security.js';
export { detectStorageDevices, isExternalStorage, getStorageInfo, formatBytes } from './external-storage.js';
export type { StorageDevice, StorageEvent } from './external-storage.js';
export { migrateProfile, resetProfileToDefault, estimateMigrationDuration } from './profile-migration.js';
export type { MigrationProgress, MigrationOptions, MigrationResult, EncryptionType, EncryptionOptions } from './profile-migration.js';

// Profile encryption
export {
  encrypt,
  decrypt,
  decryptToString,
  deriveKey,
  generateSalt,
  isProfileEncrypted,
  getEncryptionMeta,
  initializeEncryption,
  unlockProfile,
  verifyPassword,
  lockProfile,
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
  ENCRYPTED_EXTENSION,
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

// Big Brother Mode - CLI LLM Escalation
export * from './big-brother';
export * from './claude-session';

// Node Editor - Graph Execution
export * from './cognitive-graph-schema';
export * from './graph-executor';
export * from './graph-streaming';
export * from './node-executors/index.js';
export * from './agent-graph-executor';
export * from './graph-error-handler';
export * from './plugin-system';

// Version
export const VERSION = '0.1.0';
export const PHASE = 'Phase 1-2: Intelligence & Autonomy (Multi-User)';
