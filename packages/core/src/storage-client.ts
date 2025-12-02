/**
 * Storage Router Client
 *
 * Client wrapper for the centralized storage router service.
 * Use this in code that needs to read/write files to user profiles.
 *
 * Username is optional - if not provided, it will be resolved from
 * the current user context (via AsyncLocalStorage).
 *
 * @example
 * ```typescript
 * import { storageClient } from '@metahuman/core';
 *
 * // Write a voice sample (username from context)
 * await storageClient.write({
 *   category: 'voice',
 *   subcategory: 'training-data',
 *   relativePath: 'sample-001.wav',
 *   data: audioBuffer,
 * });
 *
 * // Read with explicit username
 * const result = await storageClient.read({
 *   username: 'greggles',
 *   category: 'config',
 *   subcategory: 'persona',
 *   relativePath: 'core.json',
 *   encoding: 'utf8',
 * });
 * ```
 */
import { storage, type StorageRequest, type WriteRequest, type ReadRequest, type WriteResult, type ReadResult, type StorageResponse, type FileCategory } from '../../../brain/services/storage-router.js';

export type { StorageRequest, WriteRequest, ReadRequest, WriteResult, ReadResult, StorageResponse, FileCategory };

export const storageClient = {
  /** Resolve full path for a storage request */
  resolvePath: (request: StorageRequest) => storage.resolvePath(request),

  /** Get profile root directory (optional username - uses context if not provided) */
  getProfileRoot: (username?: string) => storage.resolveProfileRoot(username),

  /** Write data to storage */
  write: (request: WriteRequest) => storage.write(request),

  /** Read data from storage */
  read: (request: ReadRequest) => storage.read(request),

  /** Delete file from storage */
  delete: (request: StorageRequest) => storage.delete(request),

  /** Check if path exists */
  exists: (request: StorageRequest) => storage.exists(request),

  /** List files in directory */
  list: (request: StorageRequest) => storage.list(request),

  /** Get storage status (optional username - uses context if not provided) */
  getStatus: (username?: string) => storage.status(username),
};

export default storageClient;
