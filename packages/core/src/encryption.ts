/**
 * Profile Encryption Module
 *
 * Provides AES-256-GCM encryption for profile data with PBKDF2 key derivation.
 * Supports in-place encryption/decryption of profile directories.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_LENGTH = 32; // 256 bits

const ENCRYPTION_META_FILE = '.encryption-meta.json';
const VERIFICATION_FILE = '.encryption-verify';
const VERIFICATION_PLAINTEXT = 'metahuman-encryption-verification-v1';
const ENCRYPTED_EXTENSION = '.enc';

/**
 * Password mode for encryption
 * - 'user': Uses the user's login password (convenient, single password)
 * - 'separate': Uses a separate encryption-specific password (more secure)
 */
export type PasswordMode = 'user' | 'separate';

/**
 * Encryption metadata stored at profile root
 */
export interface EncryptionMeta {
  version: number;
  algorithm: string;
  keyDerivation: string;
  pbkdf2Iterations: number;
  pbkdf2Digest: string;
  salt: string; // base64
  createdAt: string;
  encryptedFiles: number;
  passwordMode: PasswordMode; // Which password type is used
}

/**
 * Progress callback for directory operations
 */
export type ProgressCallback = (file: string, current: number, total: number) => void;

/**
 * Generate a cryptographically secure random salt
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Derive encryption key from password using PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (16) + AuthTag (16) + Ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encryptedData: Buffer, key: Buffer): Buffer {
  const iv = encryptedData.subarray(0, IV_LENGTH);
  const authTag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Check if a profile directory is encrypted
 */
export function isProfileEncrypted(profileRoot: string): boolean {
  const metaPath = path.join(profileRoot, ENCRYPTION_META_FILE);
  return fs.existsSync(metaPath);
}

/**
 * Load encryption metadata from profile
 */
export function loadEncryptionMeta(profileRoot: string): EncryptionMeta | null {
  const metaPath = path.join(profileRoot, ENCRYPTION_META_FILE);
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  const content = fs.readFileSync(metaPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Save encryption metadata to profile
 */
export function saveEncryptionMeta(profileRoot: string, meta: EncryptionMeta): void {
  const metaPath = path.join(profileRoot, ENCRYPTION_META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/**
 * Remove encryption metadata from profile
 */
export function removeEncryptionMeta(profileRoot: string): void {
  const metaPath = path.join(profileRoot, ENCRYPTION_META_FILE);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
}

/**
 * Create verification file for password validation
 */
export function createVerificationFile(profileRoot: string, key: Buffer): void {
  const verifyPath = path.join(profileRoot, VERIFICATION_FILE);
  const encrypted = encrypt(Buffer.from(VERIFICATION_PLAINTEXT), key);
  fs.writeFileSync(verifyPath, encrypted);
}

/**
 * Verify password against verification file
 */
export function verifyPassword(profileRoot: string, key: Buffer): boolean {
  const verifyPath = path.join(profileRoot, VERIFICATION_FILE);
  if (!fs.existsSync(verifyPath)) {
    return false;
  }

  try {
    const encrypted = fs.readFileSync(verifyPath);
    const decrypted = decrypt(encrypted, key);
    return decrypted.toString() === VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Remove verification file
 */
export function removeVerificationFile(profileRoot: string): void {
  const verifyPath = path.join(profileRoot, VERIFICATION_FILE);
  if (fs.existsSync(verifyPath)) {
    fs.unlinkSync(verifyPath);
  }
}

/**
 * Get all encryptable files in a directory (recursive)
 */
function getFilesToProcess(dirPath: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      files.push(...getFilesToProcess(fullPath));
    } else if (entry.isFile()) {
      // Skip metadata files
      if (entry.name === ENCRYPTION_META_FILE || entry.name === VERIFICATION_FILE) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Encrypt a single file in-place
 */
function encryptFile(filePath: string, key: Buffer): void {
  // Skip already encrypted files
  if (filePath.endsWith(ENCRYPTED_EXTENSION)) {
    return;
  }

  const data = fs.readFileSync(filePath);
  const encrypted = encrypt(data, key);

  // Write encrypted data to .enc file
  const encryptedPath = filePath + ENCRYPTED_EXTENSION;
  fs.writeFileSync(encryptedPath, encrypted);

  // Remove original file
  fs.unlinkSync(filePath);
}

/**
 * Decrypt a single file in-place
 */
function decryptFile(filePath: string, key: Buffer): void {
  // Only process .enc files
  if (!filePath.endsWith(ENCRYPTED_EXTENSION)) {
    return;
  }

  const encrypted = fs.readFileSync(filePath);
  const decrypted = decrypt(encrypted, key);

  // Write decrypted data to original filename
  const originalPath = filePath.slice(0, -ENCRYPTED_EXTENSION.length);
  fs.writeFileSync(originalPath, decrypted);

  // Remove encrypted file
  fs.unlinkSync(filePath);
}

/**
 * Encrypt all files in a directory
 */
export async function encryptDirectory(
  dirPath: string,
  key: Buffer,
  options?: { onProgress?: ProgressCallback }
): Promise<number> {
  const files = getFilesToProcess(dirPath).filter(f => !f.endsWith(ENCRYPTED_EXTENSION));
  const total = files.length;
  let processed = 0;

  for (const file of files) {
    encryptFile(file, key);
    processed++;
    options?.onProgress?.(file, processed, total);
  }

  return processed;
}

/**
 * Decrypt all files in a directory
 */
export async function decryptDirectory(
  dirPath: string,
  key: Buffer,
  options?: { onProgress?: ProgressCallback }
): Promise<number> {
  const files = getFilesToProcess(dirPath).filter(f => f.endsWith(ENCRYPTED_EXTENSION));
  const total = files.length;
  let processed = 0;

  for (const file of files) {
    decryptFile(file, key);
    processed++;
    options?.onProgress?.(file, processed, total);
  }

  return processed;
}

/**
 * Derive key from password and stored metadata
 */
export function deriveKeyFromMeta(password: string, meta: EncryptionMeta): Buffer {
  const salt = Buffer.from(meta.salt, 'base64');
  return deriveKey(password, salt);
}
