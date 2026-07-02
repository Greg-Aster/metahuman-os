import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { streamResponse } from '../types.js';
import { audit } from '../../audit.js';
import { getProfilePaths } from '../../path-builder.js';
import {
  createVerificationFile,
  decryptDirectory,
  deriveKey,
  ENCRYPTION_META_FILE,
  encryptDirectory,
  generateSalt,
  getEncryptionMeta,
  isProfileEncrypted,
  saveEncryptionMeta,
  verifyPassword,
  type EncryptionMeta,
} from '../../encryption.js';
import {
  getProfileStorageConfig,
  updateProfileStorage,
  verifyUserPassword,
} from '../../users.js';

type Progress = {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  progress?: number;
  error?: string;
};

function event(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createQueuedStream(run: (push: (payload: Record<string, unknown>) => void) => Promise<void>): AsyncIterable<string> {
  return (async function* queuedStream() {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let done = false;

    const push = (payload: Record<string, unknown>): void => {
      queue.push(event(payload));
      if (wake) {
        wake();
        wake = null;
      }
    };

    run(push).finally(() => {
      done = true;
      if (wake) {
        wake();
        wake = null;
      }
    });

    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (done) break;

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
}

export const handleEncryptProfilePath: UnifiedHandler = async (req) => {
  const profilePaths = getProfilePaths(req.user.username);
  const { password, type = 'aes256', useLoginPassword = false } = req.body ?? {};

  if (!password || password.length < 8) {
    return { status: 400, data: { error: 'Password must be at least 8 characters' } };
  }

  if (type !== 'aes256') {
    return { status: 400, data: { error: 'Only AES-256 encryption is supported for in-place encryption' } };
  }

  if (useLoginPassword && !verifyUserPassword(req.user.username, password)) {
    return { status: 401, data: { error: 'Incorrect login password' } };
  }

  if (isProfileEncrypted(profilePaths.root)) {
    return { status: 400, data: { error: 'Profile is already encrypted' } };
  }

  return streamResponse(createQueuedStream(async (push) => {
    const sendProgress = (progress: Progress) => push({ progress });
    const sendResult = (result: Record<string, unknown>) => push({ result });

    try {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_encryption_started',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
          encryptionType: type,
        },
        actor: req.user.userId,
      });

      sendProgress({ step: 'init', status: 'running', message: 'Initializing encryption...' });
      const salt = generateSalt();
      const key = deriveKey(password, salt);
      sendProgress({ step: 'init', status: 'completed', message: 'Encryption key derived' });
      sendProgress({ step: 'encrypt', status: 'running', message: 'Encrypting profile data...', progress: 0 });

      let totalEncrypted = 0;
      const dirsToEncrypt = ['memory', 'persona', 'etc'];

      for (const dir of dirsToEncrypt) {
        const dirPath = path.join(profilePaths.root, dir);
        try {
          const encrypted = await encryptDirectory(dirPath, key, {
            onProgress: (_file, current, total) => {
              const dirProgress = total > 0 ? (current / total) * 100 : 100;
              sendProgress({
                step: 'encrypt',
                status: 'running',
                message: `Encrypting ${dir}... (${current}/${total})`,
                progress: Math.round(dirProgress),
              });
            },
          });
          totalEncrypted += encrypted;
        } catch (error) {
          console.warn(`[encrypt] Skipping ${dir}:`, (error as Error).message);
        }
      }

      sendProgress({ step: 'encrypt', status: 'completed', message: `Encrypted ${totalEncrypted} files`, progress: 100 });
      sendProgress({ step: 'finalize', status: 'running', message: 'Saving encryption metadata...' });

      const meta: EncryptionMeta = {
        version: 1,
        algorithm: 'aes-256-gcm',
        keyDerivation: 'pbkdf2',
        pbkdf2Iterations: 100_000,
        pbkdf2Digest: 'sha512',
        salt: salt.toString('base64'),
        createdAt: new Date().toISOString(),
        encryptedFiles: totalEncrypted,
        useLoginPassword,
      };

      saveEncryptionMeta(profilePaths.root, meta);
      createVerificationFile(profilePaths.root, key);

      const currentConfig = getProfileStorageConfig(req.user.username);
      updateProfileStorage(req.user.userId, {
        encryption: {
          type: 'aes256',
          encryptedAt: new Date().toISOString(),
        },
        path: currentConfig?.path || profilePaths.root,
      } as any);

      sendProgress({ step: 'finalize', status: 'completed', message: 'Encryption metadata saved' });
      sendProgress({ step: 'complete', status: 'completed', message: 'Profile encryption complete!' });

      audit({
        level: 'info',
        category: 'security',
        event: 'profile_encryption_completed',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
          filesEncrypted: totalEncrypted,
        },
        actor: req.user.userId,
      });

      sendResult({ success: true, filesProcessed: totalEncrypted });
    } catch (error) {
      const errorMessage = (error as Error).message || 'Encryption failed';
      audit({
        level: 'error',
        category: 'security',
        event: 'profile_encryption_failed',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
          error: errorMessage,
        },
        actor: req.user.userId,
      });
      sendProgress({ step: 'error', status: 'failed', message: 'Encryption failed', error: errorMessage });
      sendResult({ success: false, error: errorMessage });
    }
  }));
};

export const handleDecryptProfilePath: UnifiedHandler = async (req) => {
  const profilePaths = getProfilePaths(req.user.username);
  const { password } = req.body ?? {};

  if (!password) {
    return { status: 400, data: { error: 'Password is required' } };
  }

  if (!isProfileEncrypted(profilePaths.root)) {
    return { status: 400, data: { error: 'Profile is not encrypted' } };
  }

  if (!verifyPassword(profilePaths.root, password)) {
    return { status: 401, data: { error: 'Incorrect password' } };
  }

  return streamResponse(createQueuedStream(async (push) => {
    const sendProgress = (progress: Progress) => push({ progress });
    const sendResult = (result: Record<string, unknown>) => push({ result });

    try {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_decryption_started',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
        },
        actor: req.user.userId,
      });

      sendProgress({ step: 'init', status: 'running', message: 'Verifying encryption metadata...' });
      const meta = getEncryptionMeta(profilePaths.root);
      if (!meta) {
        throw new Error('Encryption metadata not found');
      }

      const salt = Buffer.from(meta.salt, 'base64');
      const key = deriveKey(password, salt);
      sendProgress({ step: 'init', status: 'completed', message: 'Decryption key derived' });
      sendProgress({ step: 'decrypt', status: 'running', message: 'Decrypting profile data...', progress: 0 });

      let totalDecrypted = 0;
      const dirsToDecrypt = ['memory', 'persona', 'etc'];
      for (const dir of dirsToDecrypt) {
        const dirPath = path.join(profilePaths.root, dir);
        try {
          const decrypted = await decryptDirectory(dirPath, key, {
            onProgress: (_file, current, total) => {
              const dirProgress = total > 0 ? (current / total) * 100 : 100;
              sendProgress({
                step: 'decrypt',
                status: 'running',
                message: `Decrypting ${dir}... (${current}/${total})`,
                progress: Math.round(dirProgress),
              });
            },
          });
          totalDecrypted += decrypted;
        } catch (error) {
          console.warn(`[decrypt] Skipping ${dir}:`, (error as Error).message);
        }
      }

      sendProgress({ step: 'decrypt', status: 'completed', message: `Decrypted ${totalDecrypted} files`, progress: 100 });
      sendProgress({ step: 'cleanup', status: 'running', message: 'Removing encryption metadata...' });

      const metaPath = path.join(profilePaths.root, ENCRYPTION_META_FILE);
      const verifyPath = path.join(profilePaths.root, '.encryption-verify.enc');

      try {
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        if (fs.existsSync(verifyPath)) fs.unlinkSync(verifyPath);
      } catch (error) {
        console.warn('[decrypt] Failed to remove metadata files:', error);
      }

      const currentConfig = getProfileStorageConfig(req.user.username);
      updateProfileStorage(req.user.userId, {
        ...currentConfig,
        encryption: {
          type: 'none',
        },
        path: profilePaths.root,
      } as any);

      sendProgress({ step: 'cleanup', status: 'completed', message: 'Encryption metadata removed' });
      sendProgress({ step: 'complete', status: 'completed', message: 'Profile decryption complete!' });

      audit({
        level: 'info',
        category: 'security',
        event: 'profile_decryption_completed',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
          filesDecrypted: totalDecrypted,
        },
        actor: req.user.userId,
      });

      sendResult({ success: true, filesProcessed: totalDecrypted });
    } catch (error) {
      const errorMessage = (error as Error).message || 'Decryption failed';
      audit({
        level: 'error',
        category: 'security',
        event: 'profile_decryption_failed',
        details: {
          userId: req.user.userId,
          profilePath: profilePaths.root,
          error: errorMessage,
        },
        actor: req.user.userId,
      });
      sendProgress({ step: 'error', status: 'failed', message: 'Decryption failed', error: errorMessage });
      sendResult({ success: false, error: errorMessage });
    }
  }));
};
