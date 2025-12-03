/**
 * Storage Router Service
 *
 * Centralized service for all file I/O operations.
 * Routes reads/writes to the correct profile location based on:
 * - User authentication (who is logged in)
 * - Storage configuration (from Storage tab)
 * - File type (memory, voice, config, output)
 *
 * Benefits:
 * - Single source of truth for file locations
 * - Storage tab changes instantly affect all I/O
 * - Clean API - callers don't need to know paths
 * - Future: encryption/decryption at volume level
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProfileStorageConfig, type ProfileStorageConfig } from '../../packages/core/src/users.js';
import { audit } from '../../packages/core/src/audit.js';
import { getUserContext } from '../../packages/core/src/context.js';
import {
  isProfileUnlocked,
  getCachedKey,
  encrypt,
  decrypt,
  ENCRYPTED_EXTENSION,
} from '../../packages/core/src/encryption.js';

/**
 * Resolve username from request or context
 * Allows backwards-compatible migration where callers can omit username
 */
function resolveUsername(username?: string): string | null {
  if (username) return username;
  const context = getUserContext();
  if (context && context.username && context.username !== 'anonymous') {
    return context.username;
  }
  return null;
}

/**
 * Check if a user has AES-256 file encryption enabled
 */
function isAesEncryptionEnabled(username: string): boolean {
  const storageConfig = getProfileStorageConfig(username);
  return storageConfig?.encryption?.type === 'aes256';
}

/**
 * Check if the profile is unlocked (for AES encryption)
 */
function isProfileReady(username: string): { ready: boolean; error?: string } {
  const storageConfig = getProfileStorageConfig(username);
  const encType = storageConfig?.encryption?.type;

  // No encryption or volume encryption (transparent)
  if (!encType || encType === 'none' || encType === 'luks' || encType === 'veracrypt') {
    return { ready: true };
  }

  // AES encryption - check if unlocked
  if (encType === 'aes256') {
    if (isProfileUnlocked(username)) {
      return { ready: true };
    }
    return { ready: false, error: 'Profile is locked. Please unlock with your encryption password.' };
  }

  return { ready: true };
}

/**
 * File categories supported by the storage router
 */
export type FileCategory =
  | 'memory'      // Episodic, semantic, procedural memory
  | 'voice'       // Voice training samples
  | 'config'      // User configuration files (persona, settings)
  | 'output'      // Generated outputs (drafts, artifacts)
  | 'training'    // Training data (datasets, adapters)
  | 'cache'       // Temporary cache files
  | 'state';      // Stateful data (agency, curiosity, sessions)

/**
 * Subcategories for more specific routing
 */
export type MemorySubcategory = 'episodic' | 'semantic' | 'procedural' | 'tasks' | 'inbox';
export type ConfigSubcategory = 'persona' | 'etc' | 'sessions';
export type VoiceSubcategory = 'training-data' | 'models' | 'cache';
export type TrainingSubcategory = 'datasets' | 'adapters' | 'runs' | 'models';
export type OutputSubcategory = 'fine-tuned-models' | 'drafts' | 'artifacts' | 'cache';
export type StateSubcategory = 'agency' | 'curiosity' | 'sessions';

/**
 * Storage request for routing
 */
export interface StorageRequest {
  username?: string;  // Optional - resolved from context if not provided
  category: FileCategory;
  subcategory?: string;
  relativePath?: string;  // Path relative to category root
}

/**
 * Storage response with resolved path
 */
export interface StorageResponse {
  success: boolean;
  path?: string;
  profileRoot?: string;
  storageType?: ProfileStorageConfig['type'];
  error?: string;
}

/**
 * Write request
 */
export interface WriteRequest extends StorageRequest {
  data: Buffer | string;
  encoding?: BufferEncoding;
}

/**
 * Read request
 */
export interface ReadRequest extends StorageRequest {
  encoding?: BufferEncoding;
}

/**
 * Write result
 */
export interface WriteResult {
  success: boolean;
  path?: string;
  bytesWritten?: number;
  error?: string;
}

/**
 * Read result
 */
export interface ReadResult {
  success: boolean;
  data?: Buffer | string;
  path?: string;
  error?: string;
}

/**
 * Find the repository root by walking up the directory tree
 */
function findRepoRoot(): string {
  // Start from current file and walk up
  let dir = path.dirname(new URL(import.meta.url).pathname);
  const fsRoot = path.parse(dir).root;
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) break;
    dir = parent;
  }
  // Fallback to env or home
  return process.env.METAHUMAN_ROOT || path.join(process.env.HOME || '/home', 'metahuman');
}

const REPO_ROOT = findRepoRoot();

/**
 * Get the default profile root for a user (fallback when no storage config)
 */
function getDefaultProfileRoot(username: string): string {
  // Default to profiles/{username}/ within the repo
  return path.join(REPO_ROOT, 'profiles', username);
}

/**
 * Resolve the profile root for a user based on their storage configuration
 */
export function resolveProfileRoot(username?: string): StorageResponse {
  const resolvedUsername = resolveUsername(username);

  if (!resolvedUsername) {
    return {
      success: false,
      error: 'No username provided and no user context available',
    };
  }

  try {
    const storageConfig = getProfileStorageConfig(resolvedUsername);

    if (!storageConfig || !storageConfig.path) {
      // No storage config - use default location
      const defaultRoot = getDefaultProfileRoot(resolvedUsername);
      return {
        success: true,
        path: defaultRoot,
        profileRoot: defaultRoot,
        storageType: 'internal',
      };
    }

    // Check if the configured path exists
    if (!fs.existsSync(storageConfig.path)) {
      // Path doesn't exist - could be unmounted drive
      if (storageConfig.fallbackBehavior === 'error') {
        return {
          success: false,
          error: `Profile storage path not available: ${storageConfig.path}`,
        };
      }
      // Readonly fallback - return path but mark as unavailable
      return {
        success: true,
        path: storageConfig.path,
        profileRoot: storageConfig.path,
        storageType: storageConfig.type,
        error: 'Storage path unavailable - readonly mode',
      };
    }

    return {
      success: true,
      path: storageConfig.path,
      profileRoot: storageConfig.path,
      storageType: storageConfig.type,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to resolve profile root: ${(error as Error).message}`,
    };
  }
}

/**
 * Build the full path for a storage request
 */
export function resolvePath(request: StorageRequest): StorageResponse {
  const { username, category, subcategory, relativePath } = request;

  // First resolve the profile root
  const profileResponse = resolveProfileRoot(username);
  if (!profileResponse.success) {
    return profileResponse;
  }

  const profileRoot = profileResponse.profileRoot!;
  let categoryPath: string;

  // Map category to directory structure
  switch (category) {
    case 'memory':
      categoryPath = path.join(profileRoot, 'memory', subcategory || 'episodic');
      break;
    case 'voice':
      categoryPath = path.join(profileRoot, subcategory || 'training-data');
      break;
    case 'config':
      if (subcategory === 'persona') {
        categoryPath = path.join(profileRoot, 'persona');
      } else if (subcategory === 'etc') {
        categoryPath = path.join(profileRoot, 'etc');
      } else if (subcategory === 'sessions') {
        categoryPath = path.join(profileRoot, 'sessions');
      } else {
        categoryPath = path.join(profileRoot, 'etc');
      }
      break;
    case 'output':
      categoryPath = path.join(profileRoot, 'out', subcategory || '');
      break;
    case 'training':
      categoryPath = path.join(profileRoot, 'training-data', subcategory || '');
      break;
    case 'cache':
      categoryPath = path.join(profileRoot, 'out', 'cache', subcategory || '');
      break;
    case 'state':
      categoryPath = path.join(profileRoot, 'state', subcategory || '');
      break;
    default:
      return {
        success: false,
        error: `Unknown file category: ${category}`,
      };
  }

  // Append relative path if provided
  const fullPath = relativePath ? path.join(categoryPath, relativePath) : categoryPath;

  return {
    success: true,
    path: fullPath,
    profileRoot,
    storageType: profileResponse.storageType,
  };
}

/**
 * Write data to storage
 */
export async function writeFile(request: WriteRequest): Promise<WriteResult> {
  const { username, data, encoding = 'utf8' } = request;
  const resolvedUsername = resolveUsername(username);

  // Resolve the path
  const pathResponse = resolvePath(request);
  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    };
  }

  // Check if profile is ready (unlocked for AES encryption)
  if (resolvedUsername) {
    const readyStatus = isProfileReady(resolvedUsername);
    if (!readyStatus.ready) {
      return {
        success: false,
        error: readyStatus.error,
      };
    }
  }

  let filePath = pathResponse.path!;
  const useAesEncryption = resolvedUsername && isAesEncryptionEnabled(resolvedUsername);

  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let bytesWritten: number;

    if (useAesEncryption) {
      // AES-256 file encryption enabled
      const key = getCachedKey(resolvedUsername!);
      if (!key) {
        return {
          success: false,
          error: 'Profile is locked. Please unlock first.',
        };
      }

      // Convert to buffer if needed
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);

      // Encrypt the data
      const encrypted = encrypt(dataBuffer, key);

      // Write encrypted file with .enc extension
      const encryptedPath = filePath + ENCRYPTED_EXTENSION;
      fs.writeFileSync(encryptedPath, JSON.stringify(encrypted), 'utf8');
      filePath = encryptedPath;
      bytesWritten = dataBuffer.length;
    } else {
      // No encryption - write directly
      if (Buffer.isBuffer(data)) {
        fs.writeFileSync(filePath, data);
      } else {
        fs.writeFileSync(filePath, data, encoding);
      }
      bytesWritten = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, encoding);
    }

    audit({
      level: 'info',
      category: 'data',
      event: 'storage_write',
      details: {
        username: resolvedUsername,
        category: request.category,
        subcategory: request.subcategory,
        path: filePath,
        bytesWritten,
        storageType: pathResponse.storageType,
        encrypted: useAesEncryption,
      },
      actor: resolvedUsername || 'system',
    });

    return {
      success: true,
      path: filePath,
      bytesWritten,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'data',
      event: 'storage_write_failed',
      details: {
        username: resolvedUsername,
        category: request.category,
        path: filePath,
        error: (error as Error).message,
      },
      actor: resolvedUsername || 'system',
    });

    return {
      success: false,
      error: `Failed to write file: ${(error as Error).message}`,
    };
  }
}

/**
 * Read data from storage
 */
export async function readFile(request: ReadRequest): Promise<ReadResult> {
  const { username, encoding } = request;
  const resolvedUsername = resolveUsername(username);

  // Resolve the path
  const pathResponse = resolvePath(request);
  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    };
  }

  // Check if profile is ready (unlocked for AES encryption)
  if (resolvedUsername) {
    const readyStatus = isProfileReady(resolvedUsername);
    if (!readyStatus.ready) {
      return {
        success: false,
        error: readyStatus.error,
      };
    }
  }

  let filePath = pathResponse.path!;
  const useAesEncryption = resolvedUsername && isAesEncryptionEnabled(resolvedUsername);

  try {
    // For AES encryption, check for encrypted file first
    if (useAesEncryption) {
      const encryptedPath = filePath + ENCRYPTED_EXTENSION;

      if (fs.existsSync(encryptedPath)) {
        // Read and decrypt
        const key = getCachedKey(resolvedUsername!);
        if (!key) {
          return {
            success: false,
            error: 'Profile is locked. Please unlock first.',
          };
        }

        const encryptedContent = fs.readFileSync(encryptedPath, 'utf8');
        const encryptedData = JSON.parse(encryptedContent);
        const decrypted = decrypt(encryptedData, key);

        // Return as string if encoding requested, otherwise buffer
        const data = encoding ? decrypted.toString(encoding) : decrypted;

        return {
          success: true,
          data,
          path: encryptedPath,
        };
      }
      // Fall through to check unencrypted file (for backwards compatibility)
    }

    // Standard unencrypted read
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
      };
    }

    const data = encoding
      ? fs.readFileSync(filePath, encoding)
      : fs.readFileSync(filePath);

    return {
      success: true,
      data,
      path: filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${(error as Error).message}`,
    };
  }
}

/**
 * Check if a path exists in storage
 */
export function exists(request: StorageRequest): boolean {
  const pathResponse = resolvePath(request);
  if (!pathResponse.success || !pathResponse.path) {
    return false;
  }
  return fs.existsSync(pathResponse.path);
}

/**
 * Delete a file from storage
 */
export async function deleteFile(request: StorageRequest): Promise<WriteResult> {
  const { username } = request;

  const pathResponse = resolvePath(request);
  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    };
  }

  const filePath = pathResponse.path!;

  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: true, // Already doesn't exist
        path: filePath,
      };
    }

    fs.unlinkSync(filePath);

    audit({
      level: 'info',
      category: 'data',
      event: 'storage_delete',
      details: {
        username,
        category: request.category,
        path: filePath,
      },
      actor: username,
    });

    return {
      success: true,
      path: filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete file: ${(error as Error).message}`,
    };
  }
}

/**
 * List files in a storage directory
 */
export async function listFiles(request: StorageRequest): Promise<{
  success: boolean;
  files?: string[];
  error?: string;
}> {
  const pathResponse = resolvePath(request);
  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    };
  }

  const dirPath = pathResponse.path!;

  try {
    if (!fs.existsSync(dirPath)) {
      return {
        success: true,
        files: [],
      };
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => e.name);

    return {
      success: true,
      files,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list files: ${(error as Error).message}`,
    };
  }
}

/**
 * Get storage status for a user
 */
export function getStorageStatus(username?: string): {
  configured: boolean;
  available: boolean;
  path?: string;
  type?: ProfileStorageConfig['type'];
  error?: string;
} {
  const resolvedUsername = resolveUsername(username);
  if (!resolvedUsername) {
    // No username context - return repo root as fallback
    return {
      configured: false,
      available: true,
      path: REPO_ROOT,
      type: 'internal',
    };
  }
  const storageConfig = getProfileStorageConfig(resolvedUsername);

  if (!storageConfig || !storageConfig.path) {
    return {
      configured: false,
      available: true,
      path: getDefaultProfileRoot(resolvedUsername),
      type: 'internal',
    };
  }

  const available = fs.existsSync(storageConfig.path);

  return {
    configured: true,
    available,
    path: storageConfig.path,
    type: storageConfig.type,
    error: available ? undefined : 'Storage path not available (drive may be unmounted)',
  };
}

// Export convenience functions for common operations
export const storage = {
  resolvePath,
  resolveProfileRoot,
  write: writeFile,
  read: readFile,
  delete: deleteFile,
  exists,
  list: listFiles,
  status: getStorageStatus,
};

export default storage;
