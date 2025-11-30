/**
 * Profile Migration Module
 *
 * Safely migrates user profiles between storage locations.
 * Provides progress streaming for real-time UI updates.
 * Supports optional encryption during migration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import { getProfilePaths, getDefaultProfilePath, ROOT } from './path-builder.js';
import { validateProfilePath } from './path-security.js';
import { updateProfileStorage, type ProfileStorageConfig } from './users.js';
import { audit } from './audit.js';
import { getStorageInfo } from './external-storage.js';
import {
  deriveKey,
  generateSalt,
  encrypt,
  initializeEncryption,
  createVerificationFile,
  saveEncryptionMeta,
  ENCRYPTED_EXTENSION,
  CHUNKED_EXTENSION,
  type EncryptionMeta,
} from './encryption.js';
import {
  checkVeraCrypt,
  createMetaHumanContainer,
  mountContainer,
  unmountContainer,
  CONTAINER_EXTENSION,
} from './veracrypt.js';

/**
 * Migration progress event
 */
export interface MigrationProgress {
  /** Current step name */
  step: string;
  /** Step status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** Progress percentage (0-100) */
  progress?: number;
  /** Human-readable message */
  message: string;
  /** Error details if failed */
  error?: string;
  /** Current file being processed */
  currentFile?: string;
  /** Total files to process */
  totalFiles?: number;
  /** Files processed so far */
  processedFiles?: number;
  /** Bytes processed */
  bytesProcessed?: number;
  /** Total bytes to process */
  totalBytes?: number;
}

/**
 * Encryption type for migration
 */
export type EncryptionType = 'none' | 'aes256' | 'veracrypt';

/**
 * Encryption options for migration
 */
export interface EncryptionOptions {
  /** Type of encryption to apply */
  type: EncryptionType;
  /** Master password for encryption (required if type !== 'none') */
  password?: string;
  /** VeraCrypt container size in bytes (required if type === 'veracrypt') */
  containerSize?: number;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /** Keep source files after migration (default: true for safety) */
  keepSource?: boolean;
  /** Verify file integrity with checksums (default: true) */
  validateIntegrity?: boolean;
  /** Overwrite existing files at destination (default: false) */
  overwrite?: boolean;
  /** Encryption options for the migrated profile */
  encryption?: EncryptionOptions;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  sourcePath: string;
  destinationPath: string;
  filesProcessed: number;
  bytesProcessed: number;
  duration: number;
  error?: string;
  /** Encryption applied during migration */
  encryption?: {
    type: EncryptionType;
    filesEncrypted?: number;
    containerPath?: string;
  };
}

/**
 * Get all files in a directory recursively
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  try {
    await walk(dir);
  } catch {
    // Directory doesn't exist or not accessible
  }

  return files;
}

/**
 * Calculate total size of files
 */
async function calculateTotalSize(files: string[]): Promise<number> {
  let total = 0;

  for (const file of files) {
    try {
      const stats = await fs.promises.stat(file);
      total += stats.size;
    } catch {
      // Skip inaccessible files
    }
  }

  return total;
}

/**
 * Copy a file with progress tracking
 */
async function copyFileWithProgress(
  source: string,
  destination: string,
  onProgress?: (bytes: number) => void
): Promise<void> {
  // Ensure destination directory exists
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  const readStream = createReadStream(source);
  const writeStream = createWriteStream(destination);

  let bytesCopied = 0;

  readStream.on('data', (chunk) => {
    bytesCopied += chunk.length;
    onProgress?.(bytesCopied);
  });

  await pipeline(readStream, writeStream);

  // Preserve timestamps
  const stats = await fs.promises.stat(source);
  await fs.promises.utimes(destination, stats.atime, stats.mtime);
}

// Threshold for switching to streaming encryption (500MB)
const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024;

// Chunk size for streaming encryption (64MB)
const ENCRYPTION_CHUNK_SIZE = 64 * 1024 * 1024;

// File extensions to skip encryption for (not human-readable, expensive to decrypt)
const SKIP_ENCRYPTION_EXTENSIONS = [
  // Model files
  /\.gguf$/i,           // GGUF models (llama.cpp)
  /\.safetensors$/i,    // SafeTensors model weights
  /\.pt$/i,             // PyTorch models
  /\.pth$/i,            // PyTorch checkpoints
  /\.onnx$/i,           // ONNX models
  /\.tflite$/i,         // TensorFlow Lite models
  /\.h5$/i,             // Keras/HDF5 models
  /\.pb$/i,             // TensorFlow protobuf models
  /\.ckpt$/i,           // Checkpoint files

  // Vector embeddings (numerical, not readable)
  /\.faiss$/i,          // FAISS index files
  /\.annoy$/i,          // Annoy index files
  /\.hnsw$/i,           // HNSW index files
  /\.usearch$/i,        // USearch index files

  // NOTE: Audio files ARE encrypted (contain voice = biometric data)
  // NOTE: Video files ARE encrypted (contain face/voice = biometric data)

  // Images (could encrypt if privacy is paramount - face recognition risk)
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.webp$/i,
  /\.gif$/i,
];

// Path patterns to skip encryption for
const SKIP_ENCRYPTION_PATHS = [
  /[/\\]memory[/\\]index[/\\]/i,     // Vector embedding index directory
  /[/\\]logs[/\\]run[/\\]/i,          // Runtime logs (PIDs, locks)
  /[/\\]node_modules[/\\]/i,          // Dependencies (shouldn't be in profile, but just in case)
  /[/\\]\.git[/\\]/i,                 // Git directory
];

/**
 * Check if a file should skip encryption
 * Skips: model files, embeddings, images, and certain directories
 * Encrypts: audio/video (biometric data), JSON configs, memories, etc.
 */
function shouldSkipEncryption(filePath: string): boolean {
  // Check path patterns first
  if (SKIP_ENCRYPTION_PATHS.some(pattern => pattern.test(filePath))) {
    return true;
  }
  // Check extension patterns
  return SKIP_ENCRYPTION_EXTENSIONS.some(pattern => pattern.test(filePath));
}

/**
 * Chunked encrypted file header
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
 * Copy a file with encryption (handles large files via streaming)
 */
async function copyFileWithEncryption(
  source: string,
  destination: string,
  encryptionKey: Buffer,
  onProgress?: (bytes: number) => void
): Promise<void> {
  // Ensure destination directory exists
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  // Check file size
  const stats = await fs.promises.stat(source);
  const fileSize = stats.size;

  if (fileSize > LARGE_FILE_THRESHOLD) {
    // Use streaming chunk-based encryption for large files
    await copyLargeFileWithEncryption(source, destination, encryptionKey, fileSize, onProgress);
  } else {
    // Use in-memory encryption for smaller files
    const content = await fs.promises.readFile(source);
    onProgress?.(content.length);

    // Encrypt content
    const encrypted = encrypt(content, encryptionKey);

    // Write encrypted file (add .enc extension)
    const encryptedDest = destination + ENCRYPTED_EXTENSION;
    await fs.promises.writeFile(encryptedDest, JSON.stringify(encrypted), 'utf8');
  }
}

/**
 * Copy a large file with streaming chunk-based encryption
 */
async function copyLargeFileWithEncryption(
  source: string,
  destination: string,
  encryptionKey: Buffer,
  fileSize: number,
  onProgress?: (bytes: number) => void
): Promise<void> {
  const chunkCount = Math.ceil(fileSize / ENCRYPTION_CHUNK_SIZE);

  // Create header
  const header: ChunkedEncryptionHeader = {
    version: 2,
    format: 'chunked',
    algorithm: 'aes-256-gcm',
    originalSize: fileSize,
    chunkSize: ENCRYPTION_CHUNK_SIZE,
    chunkCount,
  };

  const encryptedDest = destination + CHUNKED_EXTENSION;
  const writeStream = createWriteStream(encryptedDest);

  // Write header as first line
  writeStream.write(JSON.stringify(header) + '\n');

  // Open file for reading
  const fileHandle = await fs.promises.open(source, 'r');
  let bytesRead = 0;

  try {
    for (let i = 0; i < chunkCount; i++) {
      const chunkSize = Math.min(ENCRYPTION_CHUNK_SIZE, fileSize - bytesRead);
      const buffer = Buffer.alloc(chunkSize);

      // Read chunk
      const result = await fileHandle.read(buffer, 0, chunkSize, bytesRead);
      const chunk = buffer.subarray(0, result.bytesRead);
      bytesRead += result.bytesRead;

      // Encrypt chunk
      const encrypted = encrypt(chunk, encryptionKey);

      // Write encrypted chunk as JSON line
      writeStream.write(JSON.stringify(encrypted) + '\n');

      onProgress?.(bytesRead);
    }
  } finally {
    await fileHandle.close();
  }

  // Close write stream
  await new Promise<void>((resolve, reject) => {
    writeStream.end((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Calculate SHA-256 hash of a file
 */
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verify file integrity by comparing hashes
 */
async function verifyFile(source: string, destination: string): Promise<boolean> {
  try {
    const [sourceHash, destHash] = await Promise.all([
      hashFile(source),
      hashFile(destination),
    ]);
    return sourceHash === destHash;
  } catch {
    return false;
  }
}

/**
 * Migrate a user's profile to a new location
 *
 * This is an async generator that yields progress events.
 * Use in a for-await-of loop or with streaming.
 *
 * @param userId - User ID (for updating config)
 * @param username - Username
 * @param destination - New profile location (absolute path)
 * @param options - Migration options
 * @yields Progress events
 */
export async function* migrateProfile(
  userId: string,
  username: string,
  destination: string,
  options: MigrationOptions = {}
): AsyncGenerator<MigrationProgress, MigrationResult, unknown> {
  const {
    keepSource = true,
    validateIntegrity = true,
    overwrite = false,
    encryption,
  } = options;

  const startTime = Date.now();
  let filesProcessed = 0;
  let bytesProcessed = 0;
  let filesEncrypted = 0;
  let encryptionKey: Buffer | null = null;
  let actualDestination = destination;
  let veracryptContainerPath: string | undefined;

  // Get current profile paths
  const currentPaths = getProfilePaths(username);
  const sourcePath = currentPaths.root;

  // Step 0: Handle VeraCrypt container setup (if selected)
  if (encryption?.type === 'veracrypt') {
    if (!encryption.password) {
      yield {
        step: 'encryption_setup',
        status: 'failed',
        message: 'Encryption password required',
        error: 'Password is required for VeraCrypt encryption',
      };
      return {
        success: false,
        sourcePath,
        destinationPath: destination,
        filesProcessed: 0,
        bytesProcessed: 0,
        duration: Date.now() - startTime,
        error: 'Password required for encryption',
      };
    }

    yield {
      step: 'encryption_setup',
      status: 'running',
      message: 'Checking VeraCrypt installation...',
    };

    const veracryptStatus = checkVeraCrypt();
    if (!veracryptStatus.installed) {
      yield {
        step: 'encryption_setup',
        status: 'failed',
        message: 'VeraCrypt not installed',
        error: 'VeraCrypt must be installed for container encryption',
      };
      return {
        success: false,
        sourcePath,
        destinationPath: destination,
        filesProcessed: 0,
        bytesProcessed: 0,
        duration: Date.now() - startTime,
        error: 'VeraCrypt not installed',
      };
    }

    yield {
      step: 'encryption_setup',
      status: 'running',
      message: 'Creating VeraCrypt container...',
    };

    try {
      const containerSize = encryption.containerSize || 2 * 1024 * 1024 * 1024; // 2GB default
      const result = await createMetaHumanContainer(
        destination,
        username,
        encryption.password,
        containerSize,
        (msg) => {
          // Progress callback - we could yield here but it's inside async
        }
      );

      veracryptContainerPath = result.containerPath;
      actualDestination = result.mountPoint;

      yield {
        step: 'encryption_setup',
        status: 'completed',
        message: `VeraCrypt container created at ${result.containerPath}`,
      };
    } catch (error) {
      yield {
        step: 'encryption_setup',
        status: 'failed',
        message: 'Failed to create VeraCrypt container',
        error: (error as Error).message,
      };
      return {
        success: false,
        sourcePath,
        destinationPath: destination,
        filesProcessed: 0,
        bytesProcessed: 0,
        duration: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  // Step 0b: Setup AES-256 encryption key (if selected)
  if (encryption?.type === 'aes256') {
    if (!encryption.password) {
      yield {
        step: 'encryption_setup',
        status: 'failed',
        message: 'Encryption password required',
        error: 'Password is required for AES-256 encryption',
      };
      return {
        success: false,
        sourcePath,
        destinationPath: destination,
        filesProcessed: 0,
        bytesProcessed: 0,
        duration: Date.now() - startTime,
        error: 'Password required for encryption',
      };
    }

    yield {
      step: 'encryption_setup',
      status: 'running',
      message: 'Deriving encryption key...',
    };

    try {
      const salt = generateSalt();
      encryptionKey = deriveKey(encryption.password, salt);

      // We'll save the encryption metadata after creating the destination directory
      yield {
        step: 'encryption_setup',
        status: 'completed',
        message: 'Encryption key derived (AES-256-GCM)',
      };
    } catch (error) {
      yield {
        step: 'encryption_setup',
        status: 'failed',
        message: 'Failed to derive encryption key',
        error: (error as Error).message,
      };
      return {
        success: false,
        sourcePath,
        destinationPath: destination,
        filesProcessed: 0,
        bytesProcessed: 0,
        duration: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  // Step 1: Validate destination
  yield {
    step: 'validate',
    status: 'running',
    message: 'Validating destination path...',
  };

  // For VeraCrypt, the actual destination is the mount point which is already set up
  // For AES-256 or no encryption, validate the destination path
  // Use checkExists: false since we'll create the directory structure ourselves
  const pathToValidate = encryption?.type === 'veracrypt' ? destination : actualDestination;
  const validation = validateProfilePath(pathToValidate, { checkExists: false });
  if (!validation.valid && encryption?.type !== 'veracrypt') {
    yield {
      step: 'validate',
      status: 'failed',
      message: 'Destination validation failed',
      error: validation.errors.join(', '),
    };

    audit({
      level: 'error',
      category: 'security',
      event: 'profile_migration_failed',
      details: {
        userId,
        username,
        source: sourcePath,
        destination,
        reason: 'validation_failed',
        errors: validation.errors,
      },
      actor: userId,
    });

    return {
      success: false,
      sourcePath,
      destinationPath: destination,
      filesProcessed: 0,
      bytesProcessed: 0,
      duration: Date.now() - startTime,
      error: validation.errors.join(', '),
    };
  }

  // Check if destination already has files
  if (!overwrite) {
    try {
      const destFiles = await fs.promises.readdir(destination);
      if (destFiles.length > 0) {
        yield {
          step: 'validate',
          status: 'failed',
          message: 'Destination is not empty',
          error: 'Destination directory is not empty. Use overwrite option to proceed.',
        };
        return {
          success: false,
          sourcePath,
          destinationPath: destination,
          filesProcessed: 0,
          bytesProcessed: 0,
          duration: Date.now() - startTime,
          error: 'Destination not empty',
        };
      }
    } catch {
      // Directory doesn't exist, that's fine
    }
  }

  yield {
    step: 'validate',
    status: 'completed',
    message: 'Destination validated',
  };

  // Log migration start
  audit({
    level: 'info',
    category: 'data',
    event: 'profile_migration_started',
    details: {
      userId,
      username,
      source: sourcePath,
      destination: actualDestination,
      keepSource,
      encryption: encryption?.type || 'none',
    },
    actor: userId,
  });

  // Step 2: Scan source files
  yield {
    step: 'scan',
    status: 'running',
    message: 'Scanning source files...',
  };

  const sourceFiles = await getAllFiles(sourcePath);
  const totalBytes = await calculateTotalSize(sourceFiles);

  yield {
    step: 'scan',
    status: 'completed',
    message: `Found ${sourceFiles.length} files (${formatBytes(totalBytes)})`,
    totalFiles: sourceFiles.length,
    totalBytes,
  };

  // Step 3: Create directory structure
  yield {
    step: 'create_structure',
    status: 'running',
    message: 'Creating directory structure...',
  };

  const directories = new Set<string>();
  for (const file of sourceFiles) {
    const relativePath = path.relative(sourcePath, file);
    const destDir = path.dirname(path.join(actualDestination, relativePath));
    directories.add(destDir);
  }

  for (const dir of directories) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Initialize AES-256 encryption metadata if enabled
  if (encryption?.type === 'aes256' && encryptionKey) {
    const salt = generateSalt();
    const meta: EncryptionMeta = {
      version: 1,
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      pbkdf2Iterations: 100_000,
      pbkdf2Digest: 'sha512',
      salt: salt.toString('base64'),
      createdAt: new Date().toISOString(),
      encryptedFiles: 0,
    };

    // Re-derive key with the salt we're storing
    encryptionKey = deriveKey(encryption.password!, salt);

    saveEncryptionMeta(actualDestination, meta);
    createVerificationFile(actualDestination, encryptionKey);
  }

  yield {
    step: 'create_structure',
    status: 'completed',
    message: `Created ${directories.size} directories`,
  };

  // Step 4: Copy files (with optional encryption)
  const copyMessage = encryption?.type === 'aes256'
    ? 'Encrypting and copying files...'
    : 'Copying files...';

  yield {
    step: 'copy',
    status: 'running',
    message: copyMessage,
    progress: 0,
    totalFiles: sourceFiles.length,
    processedFiles: 0,
    totalBytes,
    bytesProcessed: 0,
  };

  const failedFiles: string[] = [];

  for (let i = 0; i < sourceFiles.length; i++) {
    const sourceFile = sourceFiles[i];
    const relativePath = path.relative(sourcePath, sourceFile);
    const destFile = path.join(actualDestination, relativePath);

    try {
      // Check if this file should skip encryption (model files - not human-readable)
      const skipEncryption = shouldSkipEncryption(sourceFile);

      if (encryption?.type === 'aes256' && encryptionKey && !skipEncryption) {
        // Encrypt file during copy
        await copyFileWithEncryption(sourceFile, destFile, encryptionKey, (bytes) => {
          // Progress callback
        });
        filesEncrypted++;
      } else {
        // Regular copy (for VeraCrypt, no encryption, or skipped model files)
        await copyFileWithProgress(sourceFile, destFile, (bytes) => {
          // Progress callback
        });
      }

      // For encrypted files, the actual file has .enc or .enc.chunked extension
      let actualDestFile = destFile;
      if (encryption?.type === 'aes256' && !skipEncryption) {
        // Check which extension was used (depends on file size)
        if (fs.existsSync(destFile + CHUNKED_EXTENSION)) {
          actualDestFile = destFile + CHUNKED_EXTENSION;
        } else {
          actualDestFile = destFile + ENCRYPTED_EXTENSION;
        }
      }
      const stats = await fs.promises.stat(actualDestFile);
      bytesProcessed += stats.size;
      filesProcessed++;

      // Show appropriate action verb
      let actionVerb = 'Copying';
      if (encryption?.type === 'aes256') {
        actionVerb = skipEncryption ? 'Copying (model)' : 'Encrypting';
      }
      yield {
        step: 'copy',
        status: 'running',
        message: `${actionVerb}: ${relativePath}`,
        progress: Math.round((filesProcessed / sourceFiles.length) * 100),
        currentFile: relativePath,
        totalFiles: sourceFiles.length,
        processedFiles: filesProcessed,
        totalBytes,
        bytesProcessed,
      };
    } catch (error) {
      failedFiles.push(relativePath);
      console.error(`[migration] Failed to copy ${relativePath}:`, error);
    }
  }

  if (failedFiles.length > 0) {
    yield {
      step: 'copy',
      status: 'completed',
      message: `Copied ${filesProcessed} files (${failedFiles.length} failed)`,
      progress: 100,
      totalFiles: sourceFiles.length,
      processedFiles: filesProcessed,
    };
  } else {
    yield {
      step: 'copy',
      status: 'completed',
      message: `Copied ${filesProcessed} files (${formatBytes(bytesProcessed)})`,
      progress: 100,
      totalFiles: sourceFiles.length,
      processedFiles: filesProcessed,
    };
  }

  // Step 5: Verify integrity (optional, skip for AES-256 encrypted files)
  if (validateIntegrity && encryption?.type !== 'aes256') {
    yield {
      step: 'verify',
      status: 'running',
      message: 'Verifying file integrity...',
      progress: 0,
    };

    let verifiedCount = 0;
    let failedVerify: string[] = [];

    for (let i = 0; i < sourceFiles.length; i++) {
      const sourceFile = sourceFiles[i];
      const relativePath = path.relative(sourcePath, sourceFile);
      const destFile = path.join(actualDestination, relativePath);

      const isValid = await verifyFile(sourceFile, destFile);
      if (isValid) {
        verifiedCount++;
      } else {
        failedVerify.push(relativePath);
      }

      if ((i + 1) % 10 === 0 || i === sourceFiles.length - 1) {
        yield {
          step: 'verify',
          status: 'running',
          message: `Verifying: ${verifiedCount}/${sourceFiles.length}`,
          progress: Math.round(((i + 1) / sourceFiles.length) * 100),
        };
      }
    }

    if (failedVerify.length > 0) {
      yield {
        step: 'verify',
        status: 'failed',
        message: `${failedVerify.length} files failed integrity check`,
        error: `Failed files: ${failedVerify.slice(0, 5).join(', ')}${failedVerify.length > 5 ? '...' : ''}`,
      };

      // Don't proceed if integrity check fails
      return {
        success: false,
        sourcePath,
        destinationPath: actualDestination,
        filesProcessed,
        bytesProcessed,
        duration: Date.now() - startTime,
        error: 'Integrity verification failed',
      };
    }

    yield {
      step: 'verify',
      status: 'completed',
      message: `Verified ${verifiedCount} files`,
      progress: 100,
    };
  }

  // Step 6: Update configuration
  yield {
    step: 'config',
    status: 'running',
    message: 'Updating profile configuration...',
  };

  // Determine storage type - mark as 'encrypted' if using encryption
  const storageInfo = getStorageInfo(actualDestination);
  // Map device storage types to profile storage types
  const deviceType = storageInfo?.type;
  let storageType: 'internal' | 'external' | 'encrypted' =
    deviceType === 'usb' || deviceType === 'network' ? 'external' :
    deviceType === 'internal' ? 'internal' : 'internal';

  // Override to 'encrypted' if using application-level encryption
  if (encryption?.type === 'aes256' || encryption?.type === 'veracrypt') {
    storageType = 'encrypted';
  }

  const newConfig: ProfileStorageConfig = {
    path: actualDestination,
    type: storageType,
    deviceId: storageInfo?.id,
    fallbackBehavior: 'error',
    // Store encryption metadata for profile loading
    encryption: encryption?.type !== 'none' ? {
      type: encryption?.type || 'none',
      containerPath: veracryptContainerPath,
    } : undefined,
  };

  try {
    updateProfileStorage(userId, newConfig);
    yield {
      step: 'config',
      status: 'completed',
      message: 'Configuration updated',
    };
  } catch (error) {
    yield {
      step: 'config',
      status: 'failed',
      message: 'Failed to update configuration',
      error: (error as Error).message,
    };

    return {
      success: false,
      sourcePath,
      destinationPath: actualDestination,
      filesProcessed,
      bytesProcessed,
      duration: Date.now() - startTime,
      error: 'Failed to update configuration',
    };
  }

  // Step 7: Cleanup source (optional)
  if (!keepSource) {
    yield {
      step: 'cleanup',
      status: 'running',
      message: 'Removing source files...',
    };

    try {
      await fs.promises.rm(sourcePath, { recursive: true });
      yield {
        step: 'cleanup',
        status: 'completed',
        message: 'Source files removed',
      };
    } catch (error) {
      yield {
        step: 'cleanup',
        status: 'failed',
        message: 'Failed to remove source files',
        error: (error as Error).message,
      };
      // Non-fatal, continue
    }
  } else {
    yield {
      step: 'cleanup',
      status: 'skipped',
      message: 'Source files kept (can be removed manually)',
    };
  }

  // Update encryption metadata with final file count
  if (encryption?.type === 'aes256' && filesEncrypted > 0) {
    try {
      const metaPath = path.join(actualDestination, '.encryption-meta.json');
      const metaContent = await fs.promises.readFile(metaPath, 'utf8');
      const meta = JSON.parse(metaContent) as EncryptionMeta;
      meta.encryptedFiles = filesEncrypted;
      await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
      // Non-fatal if metadata update fails
    }
  }

  // Log completion
  audit({
    level: 'info',
    category: 'data',
    event: 'profile_migration_completed',
    details: {
      userId,
      username,
      source: sourcePath,
      destination: actualDestination,
      filesProcessed,
      bytesProcessed,
      filesEncrypted,
      encryption: encryption?.type || 'none',
      veracryptContainer: veracryptContainerPath,
      duration: Date.now() - startTime,
    },
    actor: userId,
  });

  // Final step - include encryption info in message
  const encryptionInfo = encryption?.type === 'aes256'
    ? ` (${filesEncrypted} files encrypted with AES-256)`
    : encryption?.type === 'veracrypt'
      ? ' (VeraCrypt container created)'
      : '';

  yield {
    step: 'complete',
    status: 'completed',
    message: `Migration complete!${encryptionInfo}`,
    progress: 100,
  };

  return {
    success: true,
    sourcePath,
    destinationPath: actualDestination,
    filesProcessed,
    bytesProcessed,
    duration: Date.now() - startTime,
    encryption: encryption?.type && encryption.type !== 'none' ? {
      type: encryption.type,
      filesEncrypted: encryption.type === 'aes256' ? filesEncrypted : undefined,
      containerPath: veracryptContainerPath,
    } : undefined,
  };
}

/**
 * Reset profile to default location
 *
 * @param userId - User ID
 * @param username - Username
 */
export async function resetProfileToDefault(
  userId: string,
  username: string
): Promise<void> {
  const defaultPath = getDefaultProfilePath(username);

  // Clear the custom storage config
  updateProfileStorage(userId, null);

  audit({
    level: 'info',
    category: 'data',
    event: 'profile_path_reset',
    details: {
      userId,
      username,
      defaultPath,
    },
    actor: userId,
  });
}

/**
 * Estimate migration duration based on file count and size
 *
 * @param sourcePath - Source profile path
 * @returns Estimated duration in seconds
 */
export async function estimateMigrationDuration(
  sourcePath: string
): Promise<{ files: number; bytes: number; estimatedSeconds: number }> {
  const files = await getAllFiles(sourcePath);
  const bytes = await calculateTotalSize(files);

  // Rough estimate: 50MB/s for local, less for external
  const bytesPerSecond = 50 * 1024 * 1024;
  const estimatedSeconds = Math.max(1, Math.ceil(bytes / bytesPerSecond) + files.length * 0.01);

  return {
    files: files.length,
    bytes,
    estimatedSeconds,
  };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
