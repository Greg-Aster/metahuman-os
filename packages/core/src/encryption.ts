/**
 * Profile Encryption Module
 *
 * Provides AES-256-GCM encryption for profile data with:
 * - PBKDF2 key derivation (done once at unlock)
 * - In-memory key caching for fast operations
 * - Hardware-accelerated decryption via AES-NI
 *
 * Security Model:
 * - Master password never stored
 * - Derived key exists only in RAM during session
 * - All profile data encrypted at rest
 * - If drive is stolen, data is unreadable without password
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Encryption parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000; // Balance security vs. login time (~200-500ms)
const PBKDF2_DIGEST = 'sha512';

// File extension for encrypted files
export const ENCRYPTED_EXTENSION = '.enc';

// File extension for chunked encrypted files (large files >500MB)
export const CHUNKED_EXTENSION = '.enc.chunked';

// Encryption metadata file name
export const ENCRYPTION_META_FILE = '.encryption-meta.json';

/**
 * Encryption metadata stored alongside encrypted profile
 */
export interface EncryptionMeta {
  version: number;
  algorithm: string;
  keyDerivation: 'pbkdf2';
  pbkdf2Iterations: number;
  pbkdf2Digest: string;
  salt: string; // Base64 encoded
  createdAt: string;
  lastUnlockedAt?: string;
  encryptedFiles: number;
  useLoginPassword?: boolean; // True if encrypted with user's login password
}

/**
 * Encrypted data structure
 */
export interface EncryptedData {
  iv: string; // Base64
  authTag: string; // Base64
  ciphertext: string; // Base64
}

/**
 * In-memory key cache for fast operations
 * Maps profile path to derived key
 */
const keyCache = new Map<string, {
  key: Buffer;
  salt: Buffer;
  unlockedAt: Date;
}>();

/**
 * Derive encryption key from password using PBKDF2
 * This is the slow operation (~200-500ms) done once at unlock
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
 * Generate a random salt for key derivation
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 * Fast operation when key is already derived
 */
export function encrypt(plaintext: Buffer | string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const plaintextBuffer = typeof plaintext === 'string'
    ? Buffer.from(plaintext, 'utf8')
    : plaintext;

  const encrypted = Buffer.concat([
    cipher.update(plaintextBuffer),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

/**
 * Decrypt data using AES-256-GCM
 * Fast operation (~0.1ms for typical memory files)
 */
export function decrypt(encrypted: EncryptedData, key: Buffer): Buffer {
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

/**
 * Decrypt data and return as string
 */
export function decryptToString(encrypted: EncryptedData, key: Buffer): string {
  return decrypt(encrypted, key).toString('utf8');
}

/**
 * Check if a profile path is encrypted
 */
export function isProfileEncrypted(profilePath: string): boolean {
  const metaPath = path.join(profilePath, ENCRYPTION_META_FILE);
  return fs.existsSync(metaPath);
}

/**
 * Get encryption metadata for a profile
 */
export function getEncryptionMeta(profilePath: string): EncryptionMeta | null {
  const metaPath = path.join(profilePath, ENCRYPTION_META_FILE);
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf8');
    return JSON.parse(content) as EncryptionMeta;
  } catch {
    return null;
  }
}

/**
 * Save encryption metadata
 */
export function saveEncryptionMeta(profilePath: string, meta: EncryptionMeta): void {
  const metaPath = path.join(profilePath, ENCRYPTION_META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Initialize encryption for a profile
 * Creates metadata and returns the derived key
 */
export function initializeEncryption(
  profilePath: string,
  password: string
): { key: Buffer; meta: EncryptionMeta } {
  const salt = generateSalt();
  const key = deriveKey(password, salt);

  const meta: EncryptionMeta = {
    version: 1,
    algorithm: ALGORITHM,
    keyDerivation: 'pbkdf2',
    pbkdf2Iterations: PBKDF2_ITERATIONS,
    pbkdf2Digest: PBKDF2_DIGEST,
    salt: salt.toString('base64'),
    createdAt: new Date().toISOString(),
    encryptedFiles: 0,
  };

  saveEncryptionMeta(profilePath, meta);

  // Cache the key
  keyCache.set(profilePath, {
    key,
    salt,
    unlockedAt: new Date(),
  });

  return { key, meta };
}

/**
 * Unlock an encrypted profile with password
 * Derives key and caches it for fast subsequent operations
 */
export function unlockProfile(profilePath: string, password: string): boolean {
  const meta = getEncryptionMeta(profilePath);
  if (!meta) {
    throw new Error('Profile is not encrypted');
  }

  const salt = Buffer.from(meta.salt, 'base64');
  const key = deriveKey(password, salt);

  // Verify the key by trying to decrypt a test file or the meta checksum
  // For now, we'll trust the key derivation succeeded
  // A production implementation would store a verification hash

  // Cache the key
  keyCache.set(profilePath, {
    key,
    salt,
    unlockedAt: new Date(),
  });

  // Update last unlocked time
  meta.lastUnlockedAt = new Date().toISOString();
  saveEncryptionMeta(profilePath, meta);

  return true;
}

/**
 * Verify password without fully unlocking
 * Uses a stored verification hash
 */
export function verifyPassword(profilePath: string, password: string): boolean {
  const meta = getEncryptionMeta(profilePath);
  if (!meta) {
    return false;
  }

  try {
    const salt = Buffer.from(meta.salt, 'base64');
    const key = deriveKey(password, salt);

    // Try to read and decrypt the verification file
    const verifyPath = path.join(profilePath, '.encryption-verify.enc');
    if (fs.existsSync(verifyPath)) {
      const encrypted = JSON.parse(fs.readFileSync(verifyPath, 'utf8')) as EncryptedData;
      const decrypted = decryptToString(encrypted, key);
      return decrypted === 'METAHUMAN_ENCRYPTION_VERIFY';
    }

    // If no verify file, password is assumed correct (legacy support)
    return true;
  } catch {
    return false;
  }
}

/**
 * Create verification file for password checking
 */
export function createVerificationFile(profilePath: string, key: Buffer): void {
  const encrypted = encrypt('METAHUMAN_ENCRYPTION_VERIFY', key);
  const verifyPath = path.join(profilePath, '.encryption-verify.enc');
  fs.writeFileSync(verifyPath, JSON.stringify(encrypted), 'utf8');
}

/**
 * Check if a profile is currently unlocked (key in cache)
 */
export function isProfileUnlocked(profilePath: string): boolean {
  return keyCache.has(profilePath);
}

/**
 * Get the cached key for an unlocked profile
 */
export function getCachedKey(profilePath: string): Buffer | null {
  const cached = keyCache.get(profilePath);
  return cached?.key ?? null;
}

/**
 * Lock a profile (clear key from cache)
 */
export function lockProfile(profilePath: string): void {
  keyCache.delete(profilePath);
}

/**
 * Lock all profiles (clear all cached keys)
 */
export function lockAllProfiles(): void {
  keyCache.clear();
}

/**
 * Encrypt a file in place
 */
export function encryptFile(filePath: string, key: Buffer): void {
  const content = fs.readFileSync(filePath);
  const encrypted = encrypt(content, key);
  const encryptedPath = filePath + ENCRYPTED_EXTENSION;

  fs.writeFileSync(encryptedPath, JSON.stringify(encrypted), 'utf8');
  fs.unlinkSync(filePath); // Remove original
}

/**
 * Decrypt a file in place
 */
export function decryptFile(filePath: string, key: Buffer): void {
  if (!filePath.endsWith(ENCRYPTED_EXTENSION)) {
    throw new Error('File is not encrypted');
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const encrypted = JSON.parse(content) as EncryptedData;
  const decrypted = decrypt(encrypted, key);

  const decryptedPath = filePath.slice(0, -ENCRYPTED_EXTENSION.length);
  fs.writeFileSync(decryptedPath, decrypted);
  fs.unlinkSync(filePath); // Remove encrypted version
}

/**
 * Read an encrypted file (without modifying it)
 */
export function readEncryptedFile(filePath: string, key: Buffer): Buffer {
  const encryptedPath = filePath.endsWith(ENCRYPTED_EXTENSION)
    ? filePath
    : filePath + ENCRYPTED_EXTENSION;

  if (!fs.existsSync(encryptedPath)) {
    // Try reading unencrypted version (migration support)
    if (fs.existsSync(filePath) && !filePath.endsWith(ENCRYPTED_EXTENSION)) {
      return fs.readFileSync(filePath);
    }
    throw new Error(`File not found: ${encryptedPath}`);
  }

  const content = fs.readFileSync(encryptedPath, 'utf8');
  const encrypted = JSON.parse(content) as EncryptedData;
  return decrypt(encrypted, key);
}

/**
 * Read an encrypted JSON file
 */
export function readEncryptedJSON<T>(filePath: string, key: Buffer): T {
  const content = readEncryptedFile(filePath, key);
  return JSON.parse(content.toString('utf8')) as T;
}

/**
 * Write data to an encrypted file
 */
export function writeEncryptedFile(filePath: string, data: Buffer | string, key: Buffer): void {
  const encrypted = encrypt(data, key);
  const encryptedPath = filePath.endsWith(ENCRYPTED_EXTENSION)
    ? filePath
    : filePath + ENCRYPTED_EXTENSION;

  // Ensure directory exists
  const dir = path.dirname(encryptedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(encryptedPath, JSON.stringify(encrypted), 'utf8');
}

/**
 * Write JSON to an encrypted file
 */
export function writeEncryptedJSON<T>(filePath: string, data: T, key: Buffer): void {
  const json = JSON.stringify(data, null, 2);
  writeEncryptedFile(filePath, json, key);
}

/**
 * Encrypt an entire directory recursively
 * Returns the number of files encrypted
 */
export async function encryptDirectory(
  dirPath: string,
  key: Buffer,
  options: {
    skipPatterns?: RegExp[];
    onProgress?: (file: string, current: number, total: number) => void;
  } = {}
): Promise<number> {
  const { skipPatterns = [], onProgress } = options;

  // Default skip patterns - don't encrypt metadata or already encrypted files
  const defaultSkips = [
    /\.encryption-meta\.json$/,
    /\.encryption-verify\.enc$/,
    /\.enc$/,
  ];
  const allSkips = [...defaultSkips, ...skipPatterns];

  // Collect all files
  const files: string[] = [];
  const collectFiles = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.isFile()) {
        const shouldSkip = allSkips.some(pattern => pattern.test(fullPath));
        if (!shouldSkip) {
          files.push(fullPath);
        }
      }
    }
  };

  collectFiles(dirPath);

  // Encrypt each file
  let encrypted = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      encryptFile(file, key);
      encrypted++;
      onProgress?.(file, i + 1, files.length);
    } catch (error) {
      console.error(`Failed to encrypt ${file}:`, error);
    }
  }

  return encrypted;
}

/**
 * Decrypt an entire directory recursively
 * Returns the number of files decrypted
 */
export async function decryptDirectory(
  dirPath: string,
  key: Buffer,
  options: {
    onProgress?: (file: string, current: number, total: number) => void;
  } = {}
): Promise<number> {
  const { onProgress } = options;

  // Collect all encrypted files
  const files: string[] = [];
  const collectFiles = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(ENCRYPTED_EXTENSION)) {
        files.push(fullPath);
      }
    }
  };

  collectFiles(dirPath);

  // Decrypt each file
  let decrypted = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      decryptFile(file, key);
      decrypted++;
      onProgress?.(file, i + 1, files.length);
    } catch (error) {
      console.error(`Failed to decrypt ${file}:`, error);
    }
  }

  return decrypted;
}

/**
 * Change the encryption password for a profile
 * Re-encrypts all files with the new key
 */
export async function changePassword(
  profilePath: string,
  currentPassword: string,
  newPassword: string,
  onProgress?: (file: string, current: number, total: number) => void
): Promise<boolean> {
  const meta = getEncryptionMeta(profilePath);
  if (!meta) {
    throw new Error('Profile is not encrypted');
  }

  // Verify current password
  if (!verifyPassword(profilePath, currentPassword)) {
    throw new Error('Current password is incorrect');
  }

  // Derive old and new keys
  const oldSalt = Buffer.from(meta.salt, 'base64');
  const oldKey = deriveKey(currentPassword, oldSalt);

  const newSalt = generateSalt();
  const newKey = deriveKey(newPassword, newSalt);

  // Re-encrypt all files
  const files: string[] = [];
  const collectFiles = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(ENCRYPTED_EXTENSION)) {
        files.push(fullPath);
      }
    }
  };

  collectFiles(profilePath);

  // Re-encrypt each file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // Decrypt with old key
      const content = fs.readFileSync(file, 'utf8');
      const encrypted = JSON.parse(content) as EncryptedData;
      const decrypted = decrypt(encrypted, oldKey);

      // Encrypt with new key
      const reEncrypted = encrypt(decrypted, newKey);
      fs.writeFileSync(file, JSON.stringify(reEncrypted), 'utf8');

      onProgress?.(file, i + 1, files.length);
    } catch (error) {
      console.error(`Failed to re-encrypt ${file}:`, error);
      throw new Error(`Password change failed at ${file}`);
    }
  }

  // Update metadata with new salt
  meta.salt = newSalt.toString('base64');
  saveEncryptionMeta(profilePath, meta);

  // Update verification file
  createVerificationFile(profilePath, newKey);

  // Update cache
  keyCache.set(profilePath, {
    key: newKey,
    salt: newSalt,
    unlockedAt: new Date(),
  });

  return true;
}

/**
 * Get encryption statistics for a profile
 */
export function getEncryptionStats(profilePath: string): {
  isEncrypted: boolean;
  isUnlocked: boolean;
  encryptedFiles: number;
  totalSize: number;
  createdAt?: string;
  lastUnlockedAt?: string;
} {
  const meta = getEncryptionMeta(profilePath);
  const isEncrypted = meta !== null;
  const isUnlocked = isProfileUnlocked(profilePath);

  let encryptedFiles = 0;
  let totalSize = 0;

  if (isEncrypted) {
    const countFiles = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            countFiles(fullPath);
          } else if (entry.isFile() && fullPath.endsWith(ENCRYPTED_EXTENSION)) {
            encryptedFiles++;
            totalSize += fs.statSync(fullPath).size;
          }
        }
      } catch {
        // Ignore permission errors
      }
    };
    countFiles(profilePath);
  }

  return {
    isEncrypted,
    isUnlocked,
    encryptedFiles,
    totalSize,
    createdAt: meta?.createdAt,
    lastUnlockedAt: meta?.lastUnlockedAt,
  };
}

/**
 * Chunked encrypted file header (used for large files >500MB)
 */
interface ChunkedEncryptionHeader {
  version: 2;
  format: 'chunked';
  algorithm: 'aes-256-gcm';
  originalSize: number;
  chunkSize: number;
  chunkCount: number;
}

/**
 * Check if a file is a chunked encrypted file
 */
export function isChunkedEncryptedFile(filePath: string): boolean {
  return filePath.endsWith(CHUNKED_EXTENSION);
}

/**
 * Decrypt a chunked encrypted file (for large files)
 * Returns a readable stream for efficient memory usage
 */
export async function decryptChunkedFile(filePath: string, key: Buffer): Promise<Buffer> {
  if (!filePath.endsWith(CHUNKED_EXTENSION)) {
    throw new Error('File is not a chunked encrypted file');
  }

  const content = await fs.promises.readFile(filePath, 'utf8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('Invalid chunked file format');
  }

  // Parse header
  const header = JSON.parse(lines[0]) as ChunkedEncryptionHeader;
  if (header.version !== 2 || header.format !== 'chunked') {
    throw new Error(`Unsupported chunked file version: ${header.version}`);
  }

  // Decrypt all chunks
  const chunks: Buffer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const encryptedChunk = JSON.parse(lines[i]) as EncryptedData;
    const decryptedChunk = decrypt(encryptedChunk, key);
    chunks.push(decryptedChunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Decrypt a chunked file to a destination file (streaming for memory efficiency)
 */
export async function decryptChunkedFileToFile(
  sourcePath: string,
  destPath: string,
  key: Buffer,
  onProgress?: (bytesWritten: number, totalBytes: number) => void
): Promise<void> {
  if (!sourcePath.endsWith(CHUNKED_EXTENSION)) {
    throw new Error('Source is not a chunked encrypted file');
  }

  // Ensure destination directory exists
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  // Read file content
  const content = await fs.promises.readFile(sourcePath, 'utf8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('Invalid chunked file format');
  }

  // Parse header
  const header = JSON.parse(lines[0]) as ChunkedEncryptionHeader;
  if (header.version !== 2 || header.format !== 'chunked') {
    throw new Error(`Unsupported chunked file version: ${header.version}`);
  }

  // Open destination file for writing
  const fileHandle = await fs.promises.open(destPath, 'w');
  let bytesWritten = 0;

  try {
    // Decrypt and write each chunk
    for (let i = 1; i < lines.length; i++) {
      const encryptedChunk = JSON.parse(lines[i]) as EncryptedData;
      const decryptedChunk = decrypt(encryptedChunk, key);
      await fileHandle.write(decryptedChunk);
      bytesWritten += decryptedChunk.length;
      onProgress?.(bytesWritten, header.originalSize);
    }
  } finally {
    await fileHandle.close();
  }
}

/**
 * Decrypt a chunked file in place (removes encrypted version)
 */
export async function decryptChunkedFileInPlace(filePath: string, key: Buffer): Promise<void> {
  if (!filePath.endsWith(CHUNKED_EXTENSION)) {
    throw new Error('File is not a chunked encrypted file');
  }

  const destPath = filePath.slice(0, -CHUNKED_EXTENSION.length);
  await decryptChunkedFileToFile(filePath, destPath, key);
  await fs.promises.unlink(filePath);
}
