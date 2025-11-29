/**
 * Memory System
 * =============
 *
 * Core module for episodic memory storage in MetaHuman OS.
 *
 * ## Architecture Evolution
 *
 * ### Legacy System (Pre-2025-11)
 * - `captureEvent(content, opts)` - Returns file path string only
 * - No encryption awareness - all files written as plain JSON
 * - Synchronous, blocking writes in the main thread
 * - Used by: CLI commands, older agent code, backward-compatible paths
 *
 * ### Current System (2025-11+)
 * - `captureEventWithDetails(content, opts)` - Returns full CaptureResult with metadata
 * - Runtime encryption support via `getEncryptionContext()`
 * - Encryption status included in pipeline responses
 * - Graceful fallback when encryption unavailable (with audit logging)
 *
 * ## Worker Services (Recommended for New Code)
 *
 * For performance-critical paths, use the worker-based services:
 *
 * - `brain/services/memory-service.ts` - Worker thread for memory I/O
 *   - Encryption-aware read/write/search/list operations
 *   - Runs on separate CPU core for non-blocking I/O
 *
 * - `brain/services/semantic-search-service.ts` - Worker thread for vector ops
 *   - Vector embedding generation via Ollama
 *   - Cosine similarity search
 *   - Index building and incremental updates
 *
 * - `packages/core/src/memory-service-client.ts` - IPC client
 *   - Request/response routing to memory service worker
 *   - 30-second timeout with proper cleanup
 *   - Convenience functions: writeMemoryAsync(), readMemoryAsync(), searchMemoryAsync()
 *
 * ## Encryption Behavior
 *
 * When a profile has encryption enabled (via ProfileLocation UI):
 * - AES-256-GCM: Files encrypted with cached key (requires profile unlock)
 * - VeraCrypt: Transparent filesystem-level encryption (no app-level encryption)
 *
 * If encryption is configured but unavailable (e.g., profile not unlocked):
 * - Files written as plain JSON (fallback behavior)
 * - Warning logged to console
 * - Security audit event logged: `memory_encryption_fallback`
 * - `encryptionFallback: true` in CaptureResult for pipeline awareness
 *
 * ## Future Agents: Important Notes
 *
 * 1. Always prefer `captureEventWithDetails()` over `captureEvent()` for new code
 * 2. Check `CaptureResult.encrypted` to know if file was encrypted
 * 3. Check `CaptureResult.encryptionFallback` to detect security concerns
 * 4. For high-throughput operations, use the worker services
 * 5. The legacy `captureEvent()` is a thin wrapper for backward compatibility
 *
 * @module memory
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, generateId, timestamp } from './paths.js';
import { appendEventToIndex, getIndexStatus } from './vector-index.js';
import { audit, auditDataChange } from './audit.js';
import { getUserContext } from './context.js';
import type { CognitiveModeId } from './cognitive-mode.js';
import { scheduleIndexUpdate } from './vector-index-queue.js';
import { appendToolToCache } from './recent-tools-cache.js';
import { validateEvent } from './memory-validation.js';
import {
  encrypt,
  getCachedKey,
  isProfileUnlocked,
  ENCRYPTED_EXTENSION,
  type EncryptedData,
} from './encryption.js';
import { getProfileStorageConfig } from './users.js';

/**
 * Enhanced metadata schema for episodic events
 * Supports memory continuity features and mode-aware capture
 */
export interface EpisodicEventMetadata {
  // Conversation tracking
  conversationId?: string;      // Session ID for linking related messages
  sessionId?: string;            // Alias for conversationId
  parentEventId?: string;        // Link to triggering event (e.g., user message that caused tool invocation)

  // Tool invocation fields
  toolName?: string;             // Name of skill/tool executed
  toolInputs?: Record<string, any>;    // Tool input parameters
  toolOutputs?: Record<string, any>;   // Tool output results
  success?: boolean;             // Tool execution success status
  error?: string;                // Error message if failed
  executionTimeMs?: number;      // Performance tracking

  // File operation fields
  filePath?: string;             // File path for read/write operations
  fileSize?: number;             // File size in bytes
  snippet?: string;              // Content preview (first 300 chars)
  overwrite?: boolean;           // Whether file was overwritten

  // Code approval fields
  approvalId?: string;           // Unique approval ID
  skillId?: string;              // Skill being approved/rejected
  skillInputs?: Record<string, any>;   // Skill parameters
  decision?: 'approved' | 'rejected';  // Approval decision

  // Cognitive context
  cognitiveMode?: 'dual' | 'agent' | 'emulation';  // Active cognitive mode
  usedOperator?: boolean;        // Whether operator pipeline was used
  trustLevel?: string;           // Trust level at time of event
  facet?: string;                // Active persona facet

  // Legacy fields (maintain backward compatibility)
  processed?: boolean;           // Organizer agent processed flag
  processedAt?: string;          // When organizer processed
  model?: string;                // Model used for generation

  // General timestamp
  timestamp?: string;            // ISO 8601 timestamp

  // Allow additional custom fields
  [key: string]: any;
}

export interface EpisodicEvent {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  response?: string;
  entities?: string[];
  tags?: string[];
  importance?: number;
  links?: Array<{ type: string; target: string }>;
  userId?: string; // NEW: Track which user owns this memory
  metadata?: EpisodicEventMetadata; // Enhanced typed metadata
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority?: string;
  due?: string;
  tags?: string[];
  dependencies?: string[];
  userId?: string; // NEW: Track which user owns this task
  created: string;
  updated: string;
  completed?: string;
}

/**
 * Result of memory capture operation
 * Includes file path and encryption status for pipeline transparency
 */
export interface CaptureResult {
  /** Event ID */
  eventId: string;
  /** Full file path where event was saved */
  filePath: string;
  /** Whether the file was encrypted */
  encrypted: boolean;
  /** Encryption type used (if encrypted) */
  encryptionType?: 'aes256' | 'veracrypt';
  /** Event timestamp */
  timestamp: string;
  /** Event type */
  eventType: string;
  /** Bytes written */
  bytesWritten: number;
  /** Warning if encryption was expected but couldn't be applied (fallback to plain) */
  encryptionWarning?: string;
  /** True if encryption was configured but file was written plain (security concern) */
  encryptionFallback?: boolean;
}

const DEFAULT_EVENT_CATEGORY = 'episodic';

function normalizeTag(value: string): string {
  return value.toLowerCase().trim();
}

function resolveEventCategory(event: EpisodicEvent): string {
  const type = normalizeTag(event.type || '');
  const tags = new Set((event.tags || []).map(normalizeTag));

  // Dedicated categories by explicit type
  if (type === 'reflection') return 'reflections';
  if (type === 'dream' && (tags.has('audio') || tags.has('transcript'))) return 'audio-dreams';
  if (type === 'dream') return 'dreams';
  if (type === 'audio') return 'audio';

  // Tag-driven categories
  if (tags.has('ingested') || tags.has('ai')) return 'ai-ingestor';
  if (tags.has('curated')) return 'curated';
  if (tags.has('audio') || tags.has('transcript')) return 'audio';

  // Tool/Action logging
  if (type === 'tool_invocation') return 'tool-invocations';
  if (type === 'action') return 'actions';

  return DEFAULT_EVENT_CATEGORY;
}

function buildEventDirectory(category: string, timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // 01-12
  const day = date.getDate().toString().padStart(2, '0'); // 01-31

  const safeCategory = category.replace(/[^a-z0-9-_]/g, '-');
  if (!safeCategory || safeCategory === DEFAULT_EVENT_CATEGORY) {
    return path.join(paths.episodic, year, month, day);
  }
  return path.join(paths.episodic, safeCategory, year, month, day);
}

/**
 * Encryption context result
 */
interface EncryptionContext {
  enabled: boolean;
  key: Buffer | null;
  type?: 'aes256' | 'veracrypt';
  /** Warning if encryption was expected but unavailable */
  warning?: string;
  /** Whether encryption was configured but couldn't be applied */
  fallback: boolean;
}

/**
 * Check if profile encryption is enabled and get encryption key
 * Returns fallback=true if encryption was expected but couldn't be applied
 */
function getEncryptionContext(username?: string): EncryptionContext {
  if (!username) {
    return { enabled: false, key: null, fallback: false };
  }

  const config = getProfileStorageConfig(username);
  if (!config?.encryption || config.encryption.type === 'none') {
    return { enabled: false, key: null, fallback: false };
  }

  // For VeraCrypt, the container handles encryption at the filesystem level
  // No application-level encryption needed - the mounted volume is encrypted
  if (config.encryption.type === 'veracrypt') {
    return { enabled: false, key: null, type: 'veracrypt', fallback: false };
  }

  // For AES-256, we need the cached key
  if (config.encryption.type === 'aes256') {
    const profilePath = config.path;
    if (!isProfileUnlocked(profilePath)) {
      const warning = 'Profile is encrypted but not unlocked - writing plain file. Unlock profile with password to enable encryption.';
      console.warn(`[memory] ${warning}`);
      return { enabled: false, key: null, type: 'aes256', warning, fallback: true };
    }
    const key = getCachedKey(profilePath);
    if (!key) {
      const warning = 'Encryption key not found in cache - writing plain file';
      console.warn(`[memory] ${warning}`);
      return { enabled: false, key: null, type: 'aes256', warning, fallback: true };
    }
    return { enabled: true, key, type: 'aes256', fallback: false };
  }

  return { enabled: false, key: null, fallback: false };
}

/**
 * Capture event with full metadata (encryption-aware)
 * Returns detailed result including file path and encryption status
 */
export function captureEventWithDetails(content: string, opts: Partial<EpisodicEvent> = {}): CaptureResult {
  // Get current user context (if any)
  const ctx = getUserContext();

  const rawEvent: EpisodicEvent = {
    id: generateId('evt'),
    timestamp: timestamp(),
    content,
    type: opts.type || 'observation',
    response: opts.response,
    entities: opts.entities || [],
    tags: opts.tags || [],
    importance: opts.importance || 0.5,
    links: opts.links || [],
    userId: ctx?.userId,
    metadata: opts.metadata || {},
  };

  // Validate and sanitize the event data
  const validation = validateEvent(rawEvent);

  if (validation.warnings.length > 0) {
    console.warn('[memory] Event validation warnings:', validation.warnings);
  }

  if (!validation.valid) {
    console.error('[memory] Event validation failed:', validation.errors);
    console.warn('[memory] Attempting to save sanitized version');
  }

  const event = validation.sanitized!;
  const category = resolveEventCategory(event);
  const dir = buildEventDirectory(category, event.timestamp);
  fs.mkdirSync(dir, { recursive: true });

  const slug = content.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'event';

  const baseFilename = `${event.id}-${slug}.json`;

  // Check encryption status
  const encryptionCtx = getEncryptionContext(ctx?.username);
  let filepath: string;
  let bytesWritten: number;
  let encrypted = false;

  // Log security warning if encryption was expected but unavailable
  if (encryptionCtx.fallback && encryptionCtx.warning) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'memory_encryption_fallback',
      details: {
        eventId: event.id,
        eventType: event.type,
        warning: encryptionCtx.warning,
        expectedEncryption: encryptionCtx.type,
        writtenPlain: true,
      },
      actor: ctx?.userId || 'system',
    });
  }

  if (encryptionCtx.enabled && encryptionCtx.key && encryptionCtx.type === 'aes256') {
    // Encrypt the event before writing
    const plaintext = JSON.stringify(event, null, 2);
    const encryptedData = encrypt(Buffer.from(plaintext, 'utf8'), encryptionCtx.key);
    const encryptedJson = JSON.stringify(encryptedData);

    filepath = path.join(dir, baseFilename + ENCRYPTED_EXTENSION);
    fs.writeFileSync(filepath, encryptedJson, 'utf8');
    bytesWritten = Buffer.byteLength(encryptedJson);
    encrypted = true;

    // Mark in metadata that this event is encrypted
    event.metadata = { ...event.metadata, encrypted: true };
  } else {
    // Write plain JSON
    const plaintext = JSON.stringify(event, null, 2);
    filepath = path.join(dir, baseFilename);
    fs.writeFileSync(filepath, plaintext, 'utf8');
    bytesWritten = Buffer.byteLength(plaintext);
  }

  // Log to sync
  logSync('capture', { event, encrypted });

  const cognitiveMode = (event.metadata?.cognitiveMode as CognitiveModeId) || 'dual';

  // A1: Write to recent tool cache for tool_invocation events (async, non-blocking)
  if (event.type === 'tool_invocation' && ctx?.profilePaths && event.metadata?.conversationId) {
    const toolName = event.metadata.toolName || 'unknown';
    const success = event.metadata.success !== false;
    const output = JSON.stringify(event.metadata.toolOutputs || {});

    void appendToolToCache(
      ctx.profilePaths,
      event.metadata.conversationId,
      event.id,
      toolName,
      success,
      output
    ).catch(() => {});
  }

  if (ctx?.userId && ctx.profilePaths?.state) {
    scheduleIndexUpdate(
      ctx.userId,
      cognitiveMode,
      {
        id: event.id,
        timestamp: event.timestamp,
        content: event.content,
        tags: event.tags,
        entities: event.entities,
        path: filepath,
        type: event.type || 'observation'
      },
      { statePath: ctx.profilePaths.state }
    );
  } else {
    try {
      const status = getIndexStatus();
      if ((status as any).exists) {
        void appendEventToIndex({
          id: event.id,
          timestamp: event.timestamp,
          content: event.content,
          tags: event.tags,
          entities: event.entities,
          path: filepath,
        }).catch(() => {});
      }
    } catch {}
  }

  return {
    eventId: event.id,
    filePath: filepath,
    encrypted,
    encryptionType: encrypted ? encryptionCtx.type : undefined,
    timestamp: event.timestamp,
    eventType: event.type || 'observation',
    bytesWritten,
    encryptionWarning: encryptionCtx.warning,
    encryptionFallback: encryptionCtx.fallback,
  };
}

/**
 * Capture event (backward compatible - returns file path string)
 */
export function captureEvent(content: string, opts: Partial<EpisodicEvent> = {}): string {
  const result = captureEventWithDetails(content, opts);
  return result.filePath;
}

function readTasksFromDirectory(dir: string): Task[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const tasks: Task[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      tasks.push(JSON.parse(content));
    } catch (error) {
      console.warn('[memory] Failed to read task file:', fullPath, error);
    }
  }
  return tasks;
}

export function createTask(title: string, opts: Partial<Task> = {}): string {
  // Get current user context (if any)
  const ctx = getUserContext();

  const task: Task = {
    id: generateId('task'),
    title,
    description: opts.description || '',
    status: opts.status || 'todo',
    priority: opts.priority || 'P2',
    due: opts.due,
    tags: opts.tags || [],
    dependencies: opts.dependencies || [],
    userId: ctx?.userId, // NEW: Track owner (undefined for legacy/anonymous)
    created: timestamp(),
    updated: timestamp(),
  };

  // paths.tasks automatically resolves to user profile if context is set
  const filepath = path.join(paths.tasks, 'active', `${task.id}.json`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(task, null, 2));

  return filepath;
}

export function updateTaskStatus(taskId: string, status: Task['status']): void {
  // paths.tasks automatically resolves to user profile if context is set
  const activeDir = path.join(paths.tasks, 'active');
  const completedDir = path.join(paths.tasks, 'completed');

  const activePath = path.join(activeDir, `${taskId}.json`);
  const completedPath = path.join(completedDir, `${taskId}.json`);

  let sourcePath = activePath;
  let inCompleted = false;

  if (!fs.existsSync(sourcePath)) {
    sourcePath = completedPath;
    inCompleted = true;
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task: Task = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  task.status = status;
  task.updated = timestamp();

  if (status === 'done' || status === 'cancelled') {
    task.completed = timestamp();
    // Move to completed
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(
      path.join(completedDir, `${taskId}.json`),
      JSON.stringify(task, null, 2)
    );
    if (fs.existsSync(activePath)) {
      fs.unlinkSync(activePath);
    }
  } else {
    delete task.completed;
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(activePath, JSON.stringify(task, null, 2));
    if (inCompleted && fs.existsSync(completedPath)) {
      fs.unlinkSync(completedPath);
    }
  }
}

/**
 * Update task fields (title, description, priority, tags, due, etc.)
 * For status changes, use updateTaskStatus instead.
 */
export function updateTask(taskId: string, updates: Partial<Omit<Task, 'id' | 'created'>>): void {
  const activeDir = path.join(paths.tasks, 'active');
  const completedDir = path.join(paths.tasks, 'completed');

  const activePath = path.join(activeDir, `${taskId}.json`);
  const completedPath = path.join(completedDir, `${taskId}.json`);

  let sourcePath = activePath;
  if (!fs.existsSync(sourcePath)) {
    sourcePath = completedPath;
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task: Task = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

  // Apply updates (excluding protected fields)
  const { status, ...safeUpdates } = updates;
  Object.assign(task, safeUpdates);
  task.updated = timestamp();

  // If status is being changed, delegate to updateTaskStatus
  if (status && status !== task.status) {
    fs.writeFileSync(sourcePath, JSON.stringify(task, null, 2));
    updateTaskStatus(taskId, status);
  } else {
    fs.writeFileSync(sourcePath, JSON.stringify(task, null, 2));
  }
}

export function deleteTask(taskId: string): string {
  // paths.tasks automatically resolves to user profile if context is set
  const activeDir = path.join(paths.tasks, 'active');
  const completedDir = path.join(paths.tasks, 'completed');
  const deletedDir = path.join(paths.tasks, 'deleted');

  const activePath = path.join(activeDir, `${taskId}.json`);
  const completedPath = path.join(completedDir, `${taskId}.json`);

  let sourcePath: string | null = null;
  if (fs.existsSync(activePath)) {
    sourcePath = activePath;
  } else if (fs.existsSync(completedPath)) {
    sourcePath = completedPath;
  }

  if (!sourcePath) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task: Task = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const deletedAt = timestamp();
  const safeStamp = deletedAt.replace(/[:.]/g, '-');

  fs.mkdirSync(deletedDir, { recursive: true });
  const archivePath = path.join(deletedDir, `${taskId}-${safeStamp}.json`);
  const archivedPayload = {
    ...task,
    deleted: true,
    deletedAt,
  };

  fs.writeFileSync(archivePath, JSON.stringify(archivedPayload, null, 2));
  fs.unlinkSync(sourcePath);

  auditDataChange({
    type: 'delete',
    resource: 'task',
    path: archivePath,
    actor: 'operator',
    details: { id: taskId, deletedAt },
  });

  return archivePath;
}

export function listActiveTasks(): Task[] {
  const activeDir = path.join(paths.tasks, 'active');

  const tasks = readTasksFromDirectory(activeDir);
  tasks.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const aPri = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 999;
    const bPri = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 999;
    return aPri - bPri;
  });
  return tasks;
}

export function listCompletedTasks(): Task[] {
  const completedDir = path.join(paths.tasks, 'completed');
  const tasks = readTasksFromDirectory(completedDir);
  tasks.sort((a, b) => {
    const aUpdated = new Date(a.updated || a.completed || 0).getTime();
    const bUpdated = new Date(b.updated || b.completed || 0).getTime();
    return bUpdated - aUpdated;
  });
  return tasks;
}

export function searchMemory(query: string): string[] {
  const results: string[] = [];
  const searchIn = [paths.episodic, paths.semantic, paths.tasks];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(query.toLowerCase())) {
            results.push(path.relative(paths.root, fullPath));
          }
        } catch {}
      }
    }
  };

  searchIn.forEach(walk);
  return results;
}

/**
 * Recursively collect all episodic memory files (JSON) under the current user's profile.
 * Returns absolute paths sorted lexicographically for deterministic processing.
 */
export function listEpisodicFiles(): string[] {
  const files: string[] = [];
  const root = paths.episodic;

  if (!fs.existsSync(root)) {
    return files;
  }

  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  files.sort();
  return files;
}

export function logSync(action: string, data: any): void {
  const logEntry = {
    timestamp: timestamp(),
    action,
    data,
  };

  const logFile = path.join(paths.sync, `${new Date().toISOString().slice(0, 10)}.ndjson`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

export function logDecision(decision: any): void {
  const logFile = path.join(paths.decisions, `${new Date().toISOString().slice(0, 10)}.ndjson`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify({
    timestamp: timestamp(),
    ...decision,
  }) + '\n');
}
