/**
 * Memory Service
 *
 * Handles all memory read/write operations with encryption awareness.
 * Runs as a separate process to offload I/O from the main thread.
 *
 * Features:
 * - Automatic encryption/decryption based on profile config
 * - Async I/O operations for non-blocking performance
 * - Message-based IPC for communication with main process
 * - Streaming support for large files
 */

import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  encrypt,
  decrypt,
  getCachedKey,
  isProfileUnlocked,
  ENCRYPTED_EXTENSION,
  CHUNKED_EXTENSION,
  type EncryptedData,
} from '../../packages/core/src/encryption.js';
import { getProfileStorageConfig, type ProfileStorageConfig } from '../../packages/core/src/users.js';
import { generateId, timestamp } from '../../packages/core/src/paths.js';

/**
 * Memory operation request
 */
export interface MemoryRequest {
  id: string;
  type: 'write' | 'read' | 'search' | 'list';
  profilePath: string;
  username: string;
  payload: WritePayload | ReadPayload | SearchPayload | ListPayload;
}

export interface WritePayload {
  content: string;
  eventType: string;
  metadata?: Record<string, any>;
  tags?: string[];
  entities?: string[];
}

export interface ReadPayload {
  filePath: string;
}

export interface SearchPayload {
  query: string;
  limit?: number;
}

export interface ListPayload {
  category?: string;
  dateRange?: { start: string; end: string };
}

/**
 * Memory operation response
 */
export interface MemoryResponse {
  id: string;
  success: boolean;
  type: 'write' | 'read' | 'search' | 'list';
  result?: WriteResult | ReadResult | SearchResult | ListResult;
  error?: string;
}

export interface WriteResult {
  filePath: string;
  eventId: string;
  encrypted: boolean;
  bytesWritten: number;
  timestamp: string;
}

export interface ReadResult {
  content: string;
  encrypted: boolean;
  filePath: string;
}

export interface SearchResult {
  matches: Array<{
    filePath: string;
    content: string;
    score?: number;
  }>;
  totalResults: number;
  encrypted: boolean;
}

export interface ListResult {
  files: Array<{
    filePath: string;
    timestamp: string;
    type: string;
  }>;
  totalCount: number;
}

/**
 * Check if profile uses encryption
 */
function getEncryptionConfig(username: string): ProfileStorageConfig['encryption'] | null {
  const config = getProfileStorageConfig(username);
  return config?.encryption || null;
}

/**
 * Get encryption key for profile (must be unlocked)
 */
function getProfileKey(profilePath: string): Buffer | null {
  if (!isProfileUnlocked(profilePath)) {
    return null;
  }
  return getCachedKey(profilePath);
}

/**
 * Build event directory path based on category and timestamp
 */
function buildEventDirectory(profilePath: string, category: string, eventTimestamp: string): string {
  const date = new Date(eventTimestamp);
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  const safeCategory = category.replace(/[^a-z0-9-_]/g, '-');
  if (!safeCategory || safeCategory === 'episodic') {
    return path.join(profilePath, 'memory', 'episodic', year, month, day);
  }
  return path.join(profilePath, 'memory', 'episodic', safeCategory, year, month, day);
}

/**
 * Resolve event category from type and tags
 */
function resolveEventCategory(type: string, tags: string[]): string {
  const normalizedType = type.toLowerCase().trim();
  const normalizedTags = new Set(tags.map(t => t.toLowerCase().trim()));

  if (normalizedType === 'reflection') return 'reflections';
  if (normalizedType === 'dream' && (normalizedTags.has('audio') || normalizedTags.has('transcript'))) return 'audio-dreams';
  if (normalizedType === 'dream') return 'dreams';
  if (normalizedType === 'audio') return 'audio';
  if (normalizedTags.has('ingested') || normalizedTags.has('ai')) return 'ai-ingestor';
  if (normalizedTags.has('curated')) return 'curated';
  if (normalizedTags.has('audio') || normalizedTags.has('transcript')) return 'audio';
  if (normalizedType === 'tool_invocation') return 'tool-invocations';
  if (normalizedType === 'action') return 'actions';

  return 'episodic';
}

/**
 * Write a memory event with optional encryption
 */
async function writeMemory(
  profilePath: string,
  username: string,
  payload: WritePayload
): Promise<WriteResult> {
  const encryptionConfig = getEncryptionConfig(username);
  const useEncryption = encryptionConfig?.type === 'aes256';
  const encryptionKey = useEncryption ? getProfileKey(profilePath) : null;

  if (useEncryption && !encryptionKey) {
    throw new Error('Profile is encrypted but not unlocked. Please unlock with password.');
  }

  const eventId = generateId('evt');
  const eventTimestamp = timestamp();

  const event = {
    id: eventId,
    timestamp: eventTimestamp,
    content: payload.content,
    type: payload.eventType || 'observation',
    tags: payload.tags || [],
    entities: payload.entities || [],
    metadata: {
      ...payload.metadata,
      encrypted: useEncryption,
    },
  };

  const category = resolveEventCategory(event.type, event.tags);
  const dir = buildEventDirectory(profilePath, category, eventTimestamp);
  await fs.promises.mkdir(dir, { recursive: true });

  const slug = payload.content.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'event';

  const baseFilename = `${eventId}-${slug}.json`;
  let filePath: string;
  let bytesWritten: number;

  if (useEncryption && encryptionKey) {
    // Encrypt the event data
    const plaintext = JSON.stringify(event, null, 2);
    const encrypted = encrypt(Buffer.from(plaintext, 'utf8'), encryptionKey);
    const encryptedJson = JSON.stringify(encrypted);

    filePath = path.join(dir, baseFilename + ENCRYPTED_EXTENSION);
    await fs.promises.writeFile(filePath, encryptedJson, 'utf8');
    bytesWritten = Buffer.byteLength(encryptedJson);
  } else {
    // Write plain JSON
    const plaintext = JSON.stringify(event, null, 2);
    filePath = path.join(dir, baseFilename);
    await fs.promises.writeFile(filePath, plaintext, 'utf8');
    bytesWritten = Buffer.byteLength(plaintext);
  }

  return {
    filePath,
    eventId,
    encrypted: useEncryption,
    bytesWritten,
    timestamp: eventTimestamp,
  };
}

/**
 * Read a memory file with automatic decryption
 */
async function readMemory(
  profilePath: string,
  username: string,
  payload: ReadPayload
): Promise<ReadResult> {
  const { filePath } = payload;
  const encryptionConfig = getEncryptionConfig(username);
  const encryptionKey = encryptionConfig?.type === 'aes256' ? getProfileKey(profilePath) : null;

  // Check if file is encrypted
  const isEncrypted = filePath.endsWith(ENCRYPTED_EXTENSION) || filePath.endsWith(CHUNKED_EXTENSION);

  if (isEncrypted && !encryptionKey) {
    throw new Error('File is encrypted but profile is not unlocked');
  }

  let content: string;

  if (isEncrypted && encryptionKey) {
    if (filePath.endsWith(CHUNKED_EXTENSION)) {
      // Handle chunked encrypted files (large files)
      const { decryptChunkedFile } = await import('../../packages/core/src/encryption.js');
      const decryptedBuffer = await decryptChunkedFile(filePath, encryptionKey);
      content = decryptedBuffer.toString('utf8');
    } else {
      // Handle standard encrypted files
      const encryptedJson = await fs.promises.readFile(filePath, 'utf8');
      const encrypted = JSON.parse(encryptedJson) as EncryptedData;
      const decryptedBuffer = decrypt(encrypted, encryptionKey);
      content = decryptedBuffer.toString('utf8');
    }
  } else {
    // Plain file
    content = await fs.promises.readFile(filePath, 'utf8');
  }

  return {
    content,
    encrypted: isEncrypted,
    filePath,
  };
}

/**
 * Search memory files
 */
async function searchMemory(
  profilePath: string,
  username: string,
  payload: SearchPayload
): Promise<SearchResult> {
  const encryptionConfig = getEncryptionConfig(username);
  const useEncryption = encryptionConfig?.type === 'aes256';
  const encryptionKey = useEncryption ? getProfileKey(profilePath) : null;

  const memoryDir = path.join(profilePath, 'memory', 'episodic');
  const matches: SearchResult['matches'] = [];
  const query = payload.query.toLowerCase();
  const limit = payload.limit || 50;

  if (!fs.existsSync(memoryDir)) {
    return { matches: [], totalResults: 0, encrypted: useEncryption };
  }

  // Walk directory tree
  async function walk(dir: string): Promise<void> {
    if (matches.length >= limit) return;

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (matches.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith(ENCRYPTED_EXTENSION))) {
        try {
          const result = await readMemory(profilePath, username, { filePath: fullPath });
          if (result.content.toLowerCase().includes(query)) {
            matches.push({
              filePath: fullPath,
              content: result.content.slice(0, 500), // Preview
              score: 1.0, // Basic keyword match
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(memoryDir);

  return {
    matches,
    totalResults: matches.length,
    encrypted: useEncryption,
  };
}

/**
 * List memory files
 */
async function listMemory(
  profilePath: string,
  _username: string,
  payload: ListPayload
): Promise<ListResult> {
  const memoryDir = path.join(profilePath, 'memory', 'episodic');
  const files: ListResult['files'] = [];

  if (!fs.existsSync(memoryDir)) {
    return { files: [], totalCount: 0 };
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith(ENCRYPTED_EXTENSION))) {
        // Extract timestamp from filename if possible
        const stats = await fs.promises.stat(fullPath);
        files.push({
          filePath: fullPath,
          timestamp: stats.mtime.toISOString(),
          type: payload.category || 'episodic',
        });
      }
    }
  }

  await walk(memoryDir);

  // Sort by timestamp (newest first)
  files.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    files,
    totalCount: files.length,
  };
}

/**
 * Handle incoming requests
 */
async function handleRequest(request: MemoryRequest): Promise<MemoryResponse> {
  try {
    let result: WriteResult | ReadResult | SearchResult | ListResult;

    switch (request.type) {
      case 'write':
        result = await writeMemory(
          request.profilePath,
          request.username,
          request.payload as WritePayload
        );
        break;

      case 'read':
        result = await readMemory(
          request.profilePath,
          request.username,
          request.payload as ReadPayload
        );
        break;

      case 'search':
        result = await searchMemory(
          request.profilePath,
          request.username,
          request.payload as SearchPayload
        );
        break;

      case 'list':
        result = await listMemory(
          request.profilePath,
          request.username,
          request.payload as ListPayload
        );
        break;

      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }

    return {
      id: request.id,
      success: true,
      type: request.type,
      result,
    };
  } catch (error) {
    return {
      id: request.id,
      success: false,
      type: request.type,
      error: (error as Error).message,
    };
  }
}

// Worker thread message handler
if (parentPort) {
  parentPort.on('message', async (request: MemoryRequest) => {
    const response = await handleRequest(request);
    parentPort!.postMessage(response);
  });

  console.log('[memory-service] Worker started');
}

// Export for direct use (non-worker mode)
export { writeMemory, readMemory, searchMemory, listMemory, handleRequest };
