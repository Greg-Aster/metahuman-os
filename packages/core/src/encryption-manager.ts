/**
 * Unified Encryption Manager
 *
 * Provides a single interface for managing profile encryption across
 * all supported encryption types:
 *
 * - **aes256**: Per-file AES-256-GCM encryption (application-level)
 *   - Each file encrypted individually with .enc extension
 *   - Works on any filesystem
 *   - Slower due to per-file overhead
 *
 * - **luks**: Linux Unified Key Setup (filesystem-level)
 *   - Native Linux disk encryption
 *   - Fast block-level encryption
 *   - Requires sudo for mount/unmount
 *
 * - **veracrypt**: Cross-platform volume encryption
 *   - Works on Windows, macOS, Linux
 *   - Container-based encryption
 *   - Good for portable drives
 *
 * For volume encryption (luks/veracrypt), files are stored plaintext
 * on the mounted volume. The storage router doesn't need to handle
 * encryption - it just reads/writes to the mount point.
 *
 * For file encryption (aes256), the storage router must encrypt/decrypt
 * files on read/write operations.
 */

import fs from 'fs';
import path from 'path';
import { audit } from './audit.js';
import { getUser, updateUserMetadata, type ProfileEncryptionConfig, type ProfileStorageConfig } from './users.js';
import { getProfilePaths } from './paths.js';

// Import encryption modules
import {
  initializeEncryption,
  unlockProfile as unlockAesProfile,
  lockProfile as lockAesProfile,
  isProfileUnlocked as isAesUnlocked,
  encryptFile,
  decryptFile,
  isProfileEncrypted as checkAesEncrypted,
} from './encryption.js';

import {
  checkLuks,
  isLuksMounted,
  getLuksMountPoint,
  openAndMountLuks,
  unmountAndCloseLuks,
  createMetaHumanLuksContainer,
  LUKS_EXTENSION,
} from './luks.js';

import {
  checkVeraCrypt,
  isContainerMounted,
  mountContainer as mountVeraCrypt,
  unmountContainer as unmountVeraCrypt,
  createMetaHumanContainer as createVeraCryptContainer,
  CONTAINER_EXTENSION,
} from './veracrypt.js';

export interface EncryptionStatus {
  type: 'none' | 'aes256' | 'luks' | 'veracrypt';
  unlocked: boolean;
  available: boolean;
  mountPoint?: string;
  error?: string;
}

export interface UnlockResult {
  success: boolean;
  error?: string;
  mountPoint?: string;
}

export interface EncryptionCapabilities {
  aes256: { available: true };  // Always available (pure software)
  luks: { available: boolean; version?: string };
  veracrypt: { available: boolean; version?: string };
}

/**
 * Get available encryption capabilities on this system
 */
export function getEncryptionCapabilities(): EncryptionCapabilities {
  const luksStatus = checkLuks();
  const veracryptStatus = checkVeraCrypt();

  return {
    aes256: { available: true },
    luks: { available: luksStatus.installed, version: luksStatus.version },
    veracrypt: { available: veracryptStatus.installed, version: veracryptStatus.version },
  };
}

/**
 * Get encryption status for a user's profile
 */
export async function getEncryptionStatus(userId: string): Promise<EncryptionStatus> {
  const user = getUser(userId);
  if (!user) {
    return { type: 'none', unlocked: true, available: false, error: 'User not found' };
  }

  const encConfig = user.metadata?.profileStorage?.encryption;

  if (!encConfig || encConfig.type === 'none') {
    return { type: 'none', unlocked: true, available: true };
  }

  const capabilities = getEncryptionCapabilities();

  switch (encConfig.type) {
    case 'aes256': {
      const profilePaths = getProfilePaths(user.username);
      const isEncrypted = checkAesEncrypted(profilePaths.root);
      const unlocked = isAesUnlocked(user.username);

      return {
        type: 'aes256',
        unlocked,
        available: true,
        mountPoint: profilePaths.root,
      };
    }

    case 'luks': {
      if (!capabilities.luks.available) {
        return {
          type: 'luks',
          unlocked: false,
          available: false,
          error: 'LUKS (cryptsetup) not installed',
        };
      }

      const mapperName = encConfig.mapperName || `metahuman-${user.username}`;
      const mounted = isLuksMounted(mapperName);
      const mountPoint = mounted ? getLuksMountPoint(mapperName) || undefined : undefined;

      return {
        type: 'luks',
        unlocked: mounted,
        available: true,
        mountPoint,
      };
    }

    case 'veracrypt': {
      if (!capabilities.veracrypt.available) {
        return {
          type: 'veracrypt',
          unlocked: false,
          available: false,
          error: 'VeraCrypt not installed',
        };
      }

      const volumePath = encConfig.volumePath;
      if (!volumePath) {
        return {
          type: 'veracrypt',
          unlocked: false,
          available: false,
          error: 'Volume path not configured',
        };
      }

      const containerStatus = await isContainerMounted(volumePath);
      return {
        type: 'veracrypt',
        unlocked: containerStatus.mounted,
        available: true,
        mountPoint: containerStatus.mountPoint,
      };
    }

    default:
      return { type: 'none', unlocked: true, available: false, error: 'Unknown encryption type' };
  }
}

/**
 * Unlock an encrypted profile
 */
export async function unlockProfile(
  userId: string,
  password: string
): Promise<UnlockResult> {
  const user = getUser(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const encConfig = user.metadata?.profileStorage?.encryption;

  if (!encConfig || encConfig.type === 'none') {
    return { success: true }; // Nothing to unlock
  }

  switch (encConfig.type) {
    case 'aes256': {
      const result = await unlockAesProfile(user.username, password);
      if (result) {
        audit({
          level: 'info',
          category: 'security',
          event: 'profile_unlocked',
          details: { userId, username: user.username, type: 'aes256' },
          actor: userId,
        });
        return { success: true, mountPoint: getProfilePaths(user.username).root };
      }
      return { success: false, error: 'Incorrect password' };
    }

    case 'luks': {
      const volumePath = encConfig.volumePath;
      const mapperName = encConfig.mapperName || `metahuman-${user.username}`;
      const mountPoint = encConfig.mountPoint || `/media/metahuman/${user.username}`;

      if (!volumePath) {
        return { success: false, error: 'LUKS volume path not configured' };
      }

      const result = await openAndMountLuks(volumePath, mapperName, mountPoint, password);

      if (result.success) {
        // Update user config with mount point
        updateUserMetadata(userId, {
          profileStorage: {
            ...user.metadata?.profileStorage,
            path: mountPoint,
            encryption: {
              ...encConfig,
              unlocked: true,
              mountPoint,
            },
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_unlocked',
          details: { userId, username: user.username, type: 'luks', mountPoint },
          actor: userId,
        });

        return { success: true, mountPoint };
      }

      return { success: false, error: result.error };
    }

    case 'veracrypt': {
      const volumePath = encConfig.volumePath;
      const preferredMountPoint = encConfig.mountPoint;

      if (!volumePath) {
        return { success: false, error: 'VeraCrypt volume path not configured' };
      }

      try {
        const mountPoint = await mountVeraCrypt({
          containerPath: volumePath,
          password,
          mountPoint: preferredMountPoint,
        });

        // Update user config with mount point
        updateUserMetadata(userId, {
          profileStorage: {
            ...user.metadata?.profileStorage,
            path: mountPoint,
            encryption: {
              ...encConfig,
              unlocked: true,
              mountPoint,
            },
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_unlocked',
          details: { userId, username: user.username, type: 'veracrypt', mountPoint },
          actor: userId,
        });

        return { success: true, mountPoint };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    default:
      return { success: false, error: 'Unknown encryption type' };
  }
}

/**
 * Lock an encrypted profile
 */
export async function lockProfile(userId: string): Promise<UnlockResult> {
  const user = getUser(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const encConfig = user.metadata?.profileStorage?.encryption;

  if (!encConfig || encConfig.type === 'none') {
    return { success: true }; // Nothing to lock
  }

  switch (encConfig.type) {
    case 'aes256': {
      lockAesProfile(user.username);

      audit({
        level: 'info',
        category: 'security',
        event: 'profile_locked',
        details: { userId, username: user.username, type: 'aes256' },
        actor: userId,
      });

      return { success: true };
    }

    case 'luks': {
      const mapperName = encConfig.mapperName || `metahuman-${user.username}`;
      const result = await unmountAndCloseLuks(mapperName);

      if (result.success) {
        // Update user config
        updateUserMetadata(userId, {
          profileStorage: {
            ...user.metadata?.profileStorage,
            encryption: {
              ...encConfig,
              unlocked: false,
            },
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_locked',
          details: { userId, username: user.username, type: 'luks' },
          actor: userId,
        });

        return { success: true };
      }

      return { success: false, error: result.error };
    }

    case 'veracrypt': {
      const volumePath = encConfig.volumePath;

      if (!volumePath) {
        return { success: false, error: 'VeraCrypt volume path not configured' };
      }

      try {
        await unmountVeraCrypt(volumePath);

        // Update user config
        updateUserMetadata(userId, {
          profileStorage: {
            ...user.metadata?.profileStorage,
            encryption: {
              ...encConfig,
              unlocked: false,
            },
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_locked',
          details: { userId, username: user.username, type: 'veracrypt' },
          actor: userId,
        });

        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    default:
      return { success: false, error: 'Unknown encryption type' };
  }
}

/**
 * Setup encryption for a user profile
 */
export async function setupEncryption(
  userId: string,
  type: 'aes256' | 'luks' | 'veracrypt',
  password: string,
  options?: {
    volumePath?: string;    // For luks/veracrypt: where to create the container
    volumeSizeMB?: number;  // For luks/veracrypt: size of container
    useLoginPassword?: boolean; // For aes256: use same password as login
    onProgress?: (message: string) => void;
  }
): Promise<UnlockResult> {
  const user = getUser(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const capabilities = getEncryptionCapabilities();

  switch (type) {
    case 'aes256': {
      const profilePaths = getProfilePaths(user.username);

      try {
        options?.onProgress?.('Initializing AES-256 encryption...');

        // Initialize encryption with profile path and password
        initializeEncryption(profilePaths.root, password);

        // Unlock the profile with the new key
        await unlockAesProfile(user.username, password);

        // Update user config
        const encConfig: ProfileEncryptionConfig = {
          type: 'aes256',
          unlocked: true,
          encryptedAt: new Date().toISOString(),
          useLoginPassword: options?.useLoginPassword,
        };

        updateUserMetadata(userId, {
          profileStorage: {
            ...user.metadata?.profileStorage,
            path: profilePaths.root,
            type: 'encrypted',
            encryption: encConfig,
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'encryption_enabled',
          details: { userId, username: user.username, type: 'aes256' },
          actor: userId,
        });

        options?.onProgress?.('Encryption enabled!');
        return { success: true, mountPoint: profilePaths.root };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    case 'luks': {
      if (!capabilities.luks.available) {
        return { success: false, error: 'LUKS (cryptsetup) not installed. Run: sudo apt install cryptsetup' };
      }

      const volumePath = options?.volumePath;
      const sizeMB = options?.volumeSizeMB || 2048; // Default 2GB

      if (!volumePath) {
        return { success: false, error: 'Volume path required for LUKS encryption' };
      }

      try {
        const result = await createMetaHumanLuksContainer(
          path.dirname(volumePath),
          user.username,
          password,
          sizeMB,
          options?.onProgress
        );

        // Update user config
        const encConfig: ProfileEncryptionConfig = {
          type: 'luks',
          unlocked: true,
          encryptedAt: new Date().toISOString(),
          volumePath: result.containerPath,
          mountPoint: result.mountPoint,
          mapperName: `metahuman-${user.username}`,
        };

        updateUserMetadata(userId, {
          profileStorage: {
            path: result.mountPoint,
            type: 'encrypted',
            encryption: encConfig,
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'encryption_enabled',
          details: { userId, username: user.username, type: 'luks', volumePath: result.containerPath },
          actor: userId,
        });

        return { success: true, mountPoint: result.mountPoint };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    case 'veracrypt': {
      if (!capabilities.veracrypt.available) {
        return { success: false, error: 'VeraCrypt not installed' };
      }

      const volumePath = options?.volumePath;
      const sizeMB = options?.volumeSizeMB || 2048;

      if (!volumePath) {
        return { success: false, error: 'Volume path required for VeraCrypt encryption' };
      }

      try {
        const sizeBytes = sizeMB * 1024 * 1024;
        const result = await createVeraCryptContainer(
          path.dirname(volumePath),
          user.username,
          password,
          sizeBytes,
          options?.onProgress
        );

        // Update user config
        const encConfig: ProfileEncryptionConfig = {
          type: 'veracrypt',
          unlocked: true,
          encryptedAt: new Date().toISOString(),
          volumePath: result.containerPath,
          mountPoint: result.mountPoint,
        };

        updateUserMetadata(userId, {
          profileStorage: {
            path: result.mountPoint,
            type: 'encrypted',
            encryption: encConfig,
          },
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'encryption_enabled',
          details: { userId, username: user.username, type: 'veracrypt', volumePath: result.containerPath },
          actor: userId,
        });

        return { success: true, mountPoint: result.mountPoint };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    default:
      return { success: false, error: 'Unknown encryption type' };
  }
}

/**
 * Check if a profile requires unlocking before access
 */
export async function requiresUnlock(userId: string): Promise<boolean> {
  const status = await getEncryptionStatus(userId);
  return status.type !== 'none' && !status.unlocked;
}

/**
 * Get the effective profile path (accounting for encryption mount points)
 */
export async function getEffectiveProfilePath(userId: string): Promise<string | null> {
  const user = getUser(userId);
  if (!user) {
    return null;
  }

  const status = await getEncryptionStatus(userId);

  if (status.type === 'none') {
    return getProfilePaths(user.username).root;
  }

  if (!status.unlocked) {
    return null; // Profile is locked
  }

  if (status.mountPoint) {
    return status.mountPoint;
  }

  // Fallback to standard profile path
  return getProfilePaths(user.username).root;
}

/**
 * Determine if file operations should use AES encryption
 *
 * Returns true only for aes256 encryption type. Volume encryption
 * (luks/veracrypt) handles encryption transparently at mount time.
 */
export async function shouldEncryptFiles(userId: string): Promise<boolean> {
  const user = getUser(userId);
  if (!user) {
    return false;
  }

  const encConfig = user.metadata?.profileStorage?.encryption;
  return encConfig?.type === 'aes256';
}
