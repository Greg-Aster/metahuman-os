/**
 * Path Builder - Core Path Construction
 *
 * Pure path building functions with NO dependencies on context system.
 * This file breaks the circular dependency between paths.ts and context.ts.
 *
 * Import hierarchy:
 * - path-builder.ts (this file) → no internal dependencies (except lazy imports)
 * - context.ts → imports from path-builder.ts
 * - paths.ts → imports from path-builder.ts AND context.ts (for Proxy)
 *
 * Custom Profile Paths:
 * - Users can configure custom profile locations via metadata.profileStorage
 * - This file lazily imports users.ts to check for custom paths
 * - Falls back to default profiles/{username}/ if custom path is invalid
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Profile path resolution result
 */
export interface ProfilePathResolution {
  /** Resolved profile root path */
  root: string;
  /** Whether using fallback (custom path unavailable) */
  usingFallback: boolean;
  /** Error message if fallback is being used */
  fallbackReason?: string;
  /** Storage type (internal, external, encrypted) */
  storageType: 'internal' | 'external' | 'encrypted' | 'unknown';
}

// Profile storage config type (mirrors users.ts ProfileStorageConfig)
interface ProfileStorageConfigFull {
  path: string;
  type?: 'internal' | 'external' | 'encrypted';
  deviceId?: string;
  fallbackBehavior?: 'error' | 'readonly';
  encryption?: {
    type: 'none' | 'aes256' | 'luks' | 'veracrypt';
    unlocked?: boolean;
    [key: string]: unknown;  // Allow additional fields from ProfileEncryptionConfig
  };
}

// Profile storage config getter - registered by users.ts via dependency injection
// This avoids circular dependency (users.ts imports systemPaths from path-builder.ts)
let _getProfileStorageConfig: ((username: string) => ProfileStorageConfigFull | undefined) | null = null;

/**
 * Register the profile storage config getter (called by users.ts at module init)
 * This is dependency injection to avoid circular imports
 */
export function registerProfileStorageConfigGetter(
  getter: (username: string) => ProfileStorageConfigFull | undefined
): void {
  _getProfileStorageConfig = getter;
}

/**
 * Get profile storage config for a user
 * If the getter hasn't been registered yet, we dynamically import users.ts
 * to ensure the registration happens (this handles tree-shaking issues)
 */
function getProfileStorageConfigLazy(username: string): ProfileStorageConfigFull | undefined {
  // If getter isn't registered, force-load users.ts (handles tree-shaking)
  if (!_getProfileStorageConfig) {
    try {
      // Dynamic require to force users.ts to load and register the getter
      require('./users.js');
    } catch {
      // During bootstrap or if users.ts fails to load, fall back gracefully
      return undefined;
    }
  }
  return _getProfileStorageConfig?.(username);
}

/**
 * Find metahuman root by looking for pnpm-workspace.yaml
 */
export function findRepoRoot(): string {
  // Start from the current file's directory and walk up to filesystem root (cross-platform)
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const fsRoot = path.parse(dir).root;
  // Walk up until reaching the filesystem root
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) break;
    dir = parent;
  }
  throw new Error('Could not find repository root. Make sure "pnpm-workspace.yaml" is present.');
}

export const ROOT = findRepoRoot();

/**
 * Handle fallback behavior when custom path is unavailable
 *
 * SECURITY: When fallbackBehavior is 'error', throws instead of silently
 * falling back to potentially unencrypted default storage.
 */
function handleFallback(
  username: string,
  defaultRoot: string,
  reason: string,
  config: ProfileStorageConfigFull
): ProfilePathResolution {
  const isEncrypted = config.type === 'encrypted' || config.encryption;
  const fallbackBehavior = config.fallbackBehavior || 'error'; // Default to 'error' for safety

  // SECURITY: If user configured encrypted/external storage and it's unavailable,
  // we should NOT silently write to unencrypted default location
  if (fallbackBehavior === 'error') {
    const errorMsg = `[path-builder] SECURITY: ${reason} for user ${username}. ` +
      `Custom path: ${config.path}. ` +
      `Fallback to unencrypted default location is BLOCKED (fallbackBehavior: 'error'). ` +
      `Please ensure external storage is mounted or change fallbackBehavior setting.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Fallback allowed (readonly mode) - log prominent warning
  const warnMsg = isEncrypted
    ? `[path-builder] ⚠️  SECURITY WARNING: Encrypted storage unavailable for ${username}. ` +
      `Falling back to UNENCRYPTED default location: ${defaultRoot}. ` +
      `Reason: ${reason}. ` +
      `Data written here will NOT be encrypted!`
    : `[path-builder] ⚠️  WARNING: External storage unavailable for ${username}. ` +
      `Falling back to default location: ${defaultRoot}. ` +
      `Reason: ${reason}`;

  console.warn(warnMsg);

  return {
    root: defaultRoot,
    usingFallback: true,
    fallbackReason: reason,
    storageType: 'internal',
  };
}

/**
 * Resolve the profile root directory for a user
 *
 * Checks for custom profile path in user metadata.
 * Falls back to default location if custom path is invalid AND fallbackBehavior allows it.
 *
 * SECURITY: When external/encrypted storage is configured with fallbackBehavior: 'error',
 * this function throws instead of silently falling back to unencrypted storage.
 *
 * @param username - Username
 * @returns Profile path resolution result
 * @throws Error if custom path is unavailable and fallbackBehavior is 'error'
 */
export function resolveProfileRoot(username: string): ProfilePathResolution {
  const defaultRoot = path.join(ROOT, 'profiles', username);

  // Try to get custom storage config
  const storageConfig = getProfileStorageConfigLazy(username);

  if (!storageConfig?.path) {
    // No custom path configured, use default
    return {
      root: defaultRoot,
      usingFallback: false,
      storageType: 'internal',
    };
  }

  const customPath = storageConfig.path;

  // Validate the custom path
  // 1. Must be absolute
  if (!path.isAbsolute(customPath)) {
    return handleFallback(
      username,
      defaultRoot,
      'Custom path is not absolute',
      storageConfig
    );
  }

  // 2. Must exist and be accessible
  try {
    fs.accessSync(customPath, fs.constants.R_OK);
  } catch {
    return handleFallback(
      username,
      defaultRoot,
      'Custom path is not accessible (external storage may be disconnected)',
      storageConfig
    );
  }

  // 3. Must be a directory
  try {
    const stats = fs.statSync(customPath);
    if (!stats.isDirectory()) {
      return handleFallback(
        username,
        defaultRoot,
        'Custom path is not a directory',
        storageConfig
      );
    }
  } catch {
    return handleFallback(
      username,
      defaultRoot,
      'Cannot stat custom path',
      storageConfig
    );
  }

  // Custom path is valid
  const storageType = (storageConfig.type as ProfilePathResolution['storageType']) || 'unknown';
  return {
    root: customPath,
    usingFallback: false,
    storageType,
  };
}

/**
 * Get user-specific profile paths
 *
 * Returns paths for a specific user's profile directory.
 * Checks for custom profile location in user metadata.
 * Falls back to profiles/{username}/ if custom path is unavailable.
 *
 * @param username - Username for profile directory (NOT userId!)
 * @returns Object with all user-specific paths
 */
export function getProfilePaths(username: string) {
  const resolution = resolveProfileRoot(username);
  const profileRoot = resolution.root;

  return {
    root: profileRoot,
    persona: path.join(profileRoot, 'persona'),
    memory: path.join(profileRoot, 'memory'),
    etc: path.join(profileRoot, 'etc'),
    inbox: path.join(profileRoot, 'memory', 'inbox'),
    inboxArchive: path.join(profileRoot, 'memory', 'inbox', '_archive'),
    logs: path.join(profileRoot, 'logs'),
    out: path.join(profileRoot, 'out'),
    state: path.join(profileRoot, 'state'),

    // Persona files
    personaCore: path.join(profileRoot, 'persona', 'core.json'),
    personaRelationships: path.join(profileRoot, 'persona', 'relationships.json'),
    personaRoutines: path.join(profileRoot, 'persona', 'routines.json'),
    personaDecisionRules: path.join(profileRoot, 'persona', 'decision-rules.json'),
    personaFacets: path.join(profileRoot, 'persona', 'facets.json'),
    personaFacetsDir: path.join(profileRoot, 'persona', 'facets'),
    personaInterviews: path.join(profileRoot, 'persona', 'therapy'),
    personaInterviewsIndex: path.join(profileRoot, 'persona', 'therapy', 'index.json'),

    // Memory directories
    episodic: path.join(profileRoot, 'memory', 'episodic'),
    semantic: path.join(profileRoot, 'memory', 'semantic'),
    procedural: path.join(profileRoot, 'memory', 'procedural'),
    proceduralOvernight: path.join(profileRoot, 'memory', 'procedural', 'overnight'),
    preferences: path.join(profileRoot, 'memory', 'preferences'),
    tasks: path.join(profileRoot, 'memory', 'tasks'),
    indexDir: path.join(profileRoot, 'memory', 'index'),
    vectorIndex: path.join(profileRoot, 'memory', 'index'), // Alias for indexDir
    audioInbox: path.join(profileRoot, 'memory', 'audio', 'inbox'),
    audioTranscripts: path.join(profileRoot, 'memory', 'audio', 'transcripts'),
    audioArchive: path.join(profileRoot, 'memory', 'audio', 'archive'),

    // Curiosity system
    curiosity: path.join(profileRoot, 'memory', 'curiosity'),
    curiosityFacts: path.join(profileRoot, 'memory', 'curiosity', 'facts'),
    curiosityResearch: path.join(profileRoot, 'memory', 'curiosity', 'research'),
    curiosityConfig: path.join(profileRoot, 'etc', 'curiosity.json'),

    // Function memory (Phase 1)
    functions: path.join(profileRoot, 'memory', 'functions'),
    functionsVerified: path.join(profileRoot, 'memory', 'functions', 'verified'),
    functionsDrafts: path.join(profileRoot, 'memory', 'functions', 'drafts'),

    // Logs (user-specific)
    decisions: path.join(profileRoot, 'logs', 'decisions'),
    actions: path.join(profileRoot, 'logs', 'actions'),
    sync: path.join(profileRoot, 'logs', 'sync'),

    // Voice training (profile-specific)
    voiceTraining: path.join(profileRoot, 'out', 'voice-training', 'recordings'),
    voiceDataset: path.join(profileRoot, 'out', 'voice-training', 'dataset'),
    voiceConfig: path.join(profileRoot, 'etc', 'voice.json'),

    // GPT-SoVITS reference audio (profile-specific)
    sovitsReference: path.join(profileRoot, 'out', 'voices', 'sovits'),
    sovitsModels: path.join(profileRoot, 'out', 'voices', 'sovits-models'),

    // RVC voice models (profile-specific)
    rvcReference: path.join(profileRoot, 'out', 'voices', 'rvc'),
    rvcModels: path.join(profileRoot, 'out', 'voices', 'rvc-models'),

    // Kokoro TTS (profile-specific)
    kokoroReference: path.join(profileRoot, 'out', 'voices', 'kokoro'),
    kokoroVoicepacks: path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks'),
    kokoroDatasets: path.join(profileRoot, 'out', 'voices', 'kokoro-datasets'),
  };
}

/**
 * System-level paths (not user-specific)
 *
 * These paths are always at root and never affected by user context.
 */
export const systemPaths = {
  root: ROOT,
  brain: path.join(ROOT, 'brain'),
  agents: path.join(ROOT, 'brain', 'agents'),
  skills: path.join(ROOT, 'brain', 'skills'),
  policies: path.join(ROOT, 'brain', 'policies'),
  logs: path.join(ROOT, 'logs'),
  run: path.join(ROOT, 'logs', 'run'),
  runAgents: path.join(ROOT, 'logs', 'run', 'agents'),
  profiles: path.join(ROOT, 'profiles'),

  // Auth and session databases (stay at root)
  usersDb: path.join(ROOT, 'persona', 'users.json'),
  sessionsFile: path.join(ROOT, 'logs', 'run', 'sessions.json'),

  // System configuration (accessible to all users)
  etc: path.join(ROOT, 'etc'),

  // System-wide output directory
  out: path.join(ROOT, 'out'),

  // Voice models (shared system-wide - these are large 60-120MB files)
  voiceModels: path.join(ROOT, 'out', 'voices'),
};

/**
 * Get the default profile path for a username
 *
 * Returns the standard location without checking for custom paths.
 * Useful for migration and initialization.
 *
 * @param username - Username
 * @returns Default profile path
 */
export function getDefaultProfilePath(username: string): string {
  return path.join(ROOT, 'profiles', username);
}

/**
 * Check if a user has a custom profile path configured
 *
 * @param username - Username
 * @returns true if custom path is configured
 */
export function hasCustomProfilePath(username: string): boolean {
  const config = getProfileStorageConfigLazy(username);
  return !!config?.path;
}

/**
 * Get profile paths with resolution metadata
 *
 * Returns both the paths and information about how they were resolved.
 * Useful for UI to show storage status.
 *
 * @param username - Username
 * @returns Profile paths and resolution info
 */
export function getProfilePathsWithStatus(username: string) {
  const resolution = resolveProfileRoot(username);
  const paths = getProfilePaths(username);

  return {
    paths,
    resolution,
  };
}
