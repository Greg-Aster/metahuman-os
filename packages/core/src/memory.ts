/**
 * Canonical episodic-memory persistence for MetaHuman OS.
 *
 * New producers use `captureEventWithDetails()` so persistence, validation,
 * encryption state, idempotency, and index admission stay on one path.
 * Existing-record readers use `scanEpisodicMemoryRecords()` for profile-scoped,
 * encryption-aware access. Semantic indexing and retrieval are owned by
 * `vector-index.ts`; graph nodes delegate to that owner rather than maintaining
 * a second memory worker or index implementation.
 *
 * `captureEvent()` remains a compatibility wrapper for maintained callers that
 * only require the resulting file path.
 *
 * @module memory
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateId, timestamp } from './paths.js';
import { systemPaths } from './path-builder.js';
import { storageClient } from './storage-client.js';
import { submitCoordinatorWork } from './queue/work-submission.js';
import { audit, auditDataChange } from './audit.js';
import { getUserContext } from './context.js';
import type { CognitiveModeId } from './cognitive-mode.js';
import { canWriteMemory, type EventType } from './memory-policy.js';
import { appendToolToCache } from './recent-tools-cache.js';
import { validateEvent } from './memory-validation.js';
import {
  decrypt,
  encrypt,
  getCachedKey,
  isProfileUnlocked,
  ENCRYPTED_EXTENSION,
  type EncryptedData,
} from './encryption.js';
import { getProfileStorageConfig } from './users.js';
import * as agencyStorage from './agency/storage.js';
import { safeWriteJSON } from './safe-file.js';

const LOG_PREFIX = '[memory]';

// ============================================================================
// Memory Deduplication
// ============================================================================

// Cache of recent content hashes to detect duplicates
// Key: normalized content hash, Value: timestamp when first seen
const recentContentHashes = new Map<string, number>();
const DEDUP_CACHE_MAX_SIZE = 500;
const DEDUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Normalize content for duplicate detection.
 * Strips formatting differences to catch semantic duplicates.
 */
function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/[^\w\s]/g, '')        // Remove punctuation
    .trim();
}

/**
 * Generate a hash of normalized content for fast duplicate lookup.
 */
function contentHash(content: string): string {
  const normalized = normalizeContent(content);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Check if content is a duplicate of a recent memory.
 * Returns true if duplicate detected.
 */
function isDuplicateContent(content: string): boolean {
  // Clean up old entries periodically
  if (recentContentHashes.size > DEDUP_CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [hash, ts] of recentContentHashes) {
      if (now - ts > DEDUP_CACHE_TTL_MS) {
        recentContentHashes.delete(hash);
      }
    }
  }

  const hash = contentHash(content);
  if (recentContentHashes.has(hash)) {
    console.log(`${LOG_PREFIX} Duplicate content detected, skipping save (hash: ${hash.slice(0, 8)}...)`);
    return true;
  }
  return false;
}

function rememberCapturedContent(content: string): void {
  recentContentHashes.set(contentHash(content), Date.now());
}

/**
 * Tool parameters and results - flexible structure for various tools
 */
export type ToolParameter = string | number | boolean | null | ToolParameter[] | { [key: string]: ToolParameter };
export type ToolParameters = Record<string, ToolParameter>;

function toToolParameter(value: unknown): ToolParameter | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(item => toToolParameter(item) ?? null);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nestedValue]) => {
        const serialized = toToolParameter(nestedValue);
        return serialized === undefined ? [] : [[key, serialized]];
      }),
    );
  }
  return undefined;
}

/** Convert a structured value into JSON-safe episodic metadata. */
export function toToolParameters(value: object): ToolParameters {
  return toToolParameter(value) as ToolParameters;
}

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
  toolInputs?: ToolParameters;   // Tool input parameters
  toolOutputs?: ToolParameters;  // Tool output results
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
  skillInputs?: ToolParameters;  // Skill parameters
  decision?: 'approved' | 'rejected';  // Approval decision

  // Cognitive context
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment';  // Active cognitive mode
  usedOperator?: boolean;        // Whether operator pipeline was used
  trustLevel?: string;           // Trust level at time of event
  facet?: string;                // Active persona facet

  // Display properties for Inner Dialogue UI
  displayColor?: string;         // Color for inner dialogue text (e.g., '#22c55e' for green)
  dialogueSource?: string;       // Source identifier (e.g., 'dreamer', 'reflector', 'curiosity')

  // Legacy fields (maintain backward compatibility)
  processed?: boolean;           // Organizer agent processed flag
  processedAt?: string;          // When organizer processed
  model?: string;                // Model used for generation

  // General timestamp
  timestamp?: string;            // ISO 8601 timestamp

  // Allow additional custom fields for flexibility
  // This is needed for future extensibility without breaking changes
  [key: string]: ToolParameter | undefined;
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
  dependencies?: string[]; // Task IDs that must complete before this task can start
  projectId?: string; // Project this task belongs to
  userId?: string; // Track which user owns this task
  created: string;
  updated: string;
  completed?: string;
  /** Source of task creation (e.g., 'reflection', 'desire', 'user', 'operator') */
  source?: string;
  /** ID of source entity (e.g., reflection event ID, desire ID) */
  sourceId?: string;
  /** Estimated effort in minutes */
  estimatedMinutes?: number;
  /** Actual time spent in minutes */
  actualMinutes?: number;
}

/**
 * Project: A container for related tasks with shared goals
 * Projects can have their own status and track overall progress
 */
export interface Project {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority?: string;
  /** Target completion date */
  targetDate?: string;
  /** Tags for categorization */
  tags?: string[];
  /** User who owns this project */
  userId?: string;
  /** Calculated from task completion */
  progress?: number;
  /** Source of project creation */
  source?: string;
  sourceId?: string;
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
  /** True if this was detected as duplicate content and not saved */
  deduplicated?: boolean;
}

export type CaptureEventOptions = Partial<EpisodicEvent> & {
  /**
   * Stable producer-owned identity for retryable captures. Callers must also
   * provide a stable timestamp so retries resolve to the same dated memory
   * path. The key is hashed and is not used as a filename directly.
   */
  idempotencyKey?: string;
};

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
  // NOTE: 'ingested' and 'ai' tags no longer route to separate directory
  // They now go to the default episodic directory so training pipeline can find them
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

  // Resolve episodic path via storage router
  const episodicResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'episodic',
  });
  if (!episodicResult.success || !episodicResult.path) {
    throw new Error('Cannot resolve episodic memory path');
  }
  const episodicPath = episodicResult.path;

  const safeCategory = category.replace(/[^a-z0-9-_]/g, '-');
  if (!safeCategory || safeCategory === DEFAULT_EVENT_CATEGORY) {
    return path.join(episodicPath, year, month, day);
  }
  return path.join(episodicPath, safeCategory, year, month, day);
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
      console.warn(`${LOG_PREFIX} ${warning}`);
      return { enabled: false, key: null, type: 'aes256', warning, fallback: true };
    }
    const key = getCachedKey(profilePath);
    if (!key) {
      const warning = 'Encryption key not found in cache - writing plain file';
      console.warn(`${LOG_PREFIX} ${warning}`);
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
export function captureEventWithDetails(content: string, opts: CaptureEventOptions = {}): CaptureResult {
  // Get current user context (if any)
  const ctx = getUserContext();

  const idempotencyKey = opts.idempotencyKey?.trim();
  if (opts.idempotencyKey !== undefined && !idempotencyKey) {
    throw new Error('Memory capture idempotencyKey must be a non-empty string');
  }
  if (idempotencyKey && idempotencyKey.length > 512) {
    throw new Error('Memory capture idempotencyKey must not exceed 512 characters');
  }

  if (idempotencyKey && (!opts.timestamp || Number.isNaN(Date.parse(opts.timestamp)))) {
    throw new Error('Idempotent memory capture requires a valid stable timestamp');
  }
  const eventTimestamp = idempotencyKey ? opts.timestamp! : timestamp();

  const idempotencyDigest = idempotencyKey
    ? crypto.createHash('sha256').update(idempotencyKey).digest('hex')
    : undefined;
  const eventId = idempotencyDigest
    ? `evt-idempotent-${idempotencyDigest.slice(0, 24)}`
    : generateId('evt');

  const rawEvent: EpisodicEvent = {
    id: eventId,
    timestamp: eventTimestamp,
    content,
    type: opts.type || 'observation',
    response: opts.response,
    entities: opts.entities || [],
    tags: opts.tags || [],
    importance: opts.importance || 0.5,
    links: opts.links || [],
    userId: ctx?.userId,
    metadata: idempotencyKey
      ? { ...opts.metadata, idempotencyKeyHash: idempotencyDigest }
      : opts.metadata || {},
  };

  // Validate and sanitize the event data before deriving its durable path.
  const validation = validateEvent(rawEvent);

  if (validation.warnings.length > 0) {
    console.warn(`${LOG_PREFIX} Event validation warnings:`, validation.warnings);
  }

  if (!validation.valid) {
    console.error(`${LOG_PREFIX} Event validation failed:`, validation.errors);
    console.warn(`${LOG_PREFIX} Attempting to save sanitized version`);
  }

  const event = validation.sanitized!;
  const category = resolveEventCategory(event);
  const dir = buildEventDirectory(category, event.timestamp);
  const slug = idempotencyKey
    ? ''
    : `-${content.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'event'}`;
  const baseFilename = `${event.id}${slug}.json`;

  if (idempotencyKey) {
    const encryptedPath = path.join(dir, baseFilename + ENCRYPTED_EXTENSION);
    const plainPath = path.join(dir, baseFilename);
    const existingPath = [encryptedPath, plainPath].find(candidate => fs.existsSync(candidate));
    if (existingPath) {
      const encrypted = existingPath === encryptedPath;
      return {
        eventId: event.id,
        filePath: existingPath,
        encrypted,
        encryptionType: encrypted ? 'aes256' : undefined,
        timestamp: event.timestamp,
        eventType: event.type || 'observation',
        bytesWritten: 0,
        deduplicated: true,
      };
    }
  }

  // Check for duplicate content (skip if already saved recently)
  // This prevents the same question/message from being saved multiple times
  const skipDedup = opts.metadata?.skipDedup === true;
  if (!skipDedup && isDuplicateContent(content)) {
    return {
      eventId: 'duplicate',
      filePath: '',
      encrypted: false,
      timestamp: timestamp(),
      eventType: opts.type || 'observation',
      bytesWritten: 0,
      deduplicated: true,
    };
  }

  fs.mkdirSync(dir, { recursive: true });

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

  rememberCapturedContent(content);

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

  if (canWriteMemory(cognitiveMode, (event.type || 'observation') as EventType)) {
    try {
      void submitCoordinatorWork({
        type: 'index_update',
        handler: 'vector.append-event',
        resource: 'vector-index',
        source: 'system',
        username: ctx?.username || ctx?.userId || 'system',
        priority: 'normal',
        idempotencyKey: `memory-index:${event.id}`,
        maxAttempts: 3,
        input: {
          id: event.id,
          timestamp: event.timestamp,
          content: event.content,
          type: event.type,
          tags: event.tags,
          entities: event.entities,
          path: filepath,
        },
        metadata: { producer: 'memory-capture' },
      }).catch(error => {
        console.warn(`${LOG_PREFIX} Failed to hand index work to the server coordinator:`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to create index work submission:`, error);
    }
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
export function captureEvent(content: string, opts: CaptureEventOptions = {}): string {
  const result = captureEventWithDetails(content, opts);
  return result.filePath;
}

// ============================================================================
// Existing Episodic Memory Records
// ============================================================================

const DEFAULT_MAX_EPISODIC_RECORD_BYTES = 2 * 1024 * 1024;

export interface EpisodicMemoryRecord {
  relativePath: string;
  encrypted: boolean;
  sizeBytes: number;
  event: EpisodicEvent;
}

export type EpisodicMemoryScanOutcome =
  | { status: 'record'; record: EpisodicMemoryRecord }
  | { status: 'failed'; relativePath: string; error: string };

export interface EpisodicMemoryScanOptions {
  maxFileSizeBytes?: number;
  maxFiles?: number;
  newestFirst?: boolean;
}

export interface EpisodicMemoryMetadataUpdate {
  username: string;
  relativePath: string;
  expectedId: string;
  tags: string[];
  entities: string[];
  metadata: {
    processed: true;
    processedAt: string;
    model?: string;
    organizerStatus: 'updated' | 'skipped' | 'no-content';
  };
}

export interface EpisodicMemoryUpdateResult {
  relativePath: string;
  encrypted: boolean;
  event: EpisodicEvent;
}

function episodicRootFor(username: string): string {
  const resolved = storageClient.resolvePath({ username, category: 'memory', subcategory: 'episodic' });
  if (!resolved.success || !resolved.path) {
    throw new Error(resolved.error || `Cannot resolve episodic memory path for ${username}`);
  }
  return path.resolve(resolved.path);
}

function resolveEpisodicRecordPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Episodic memory path must be a non-empty relative path');
  }
  if (!relativePath.endsWith('.json') && !relativePath.endsWith(`.json${ENCRYPTED_EXTENSION}`)) {
    throw new Error(`Unsupported episodic memory file: ${relativePath}`);
  }

  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Episodic memory path escapes its profile root: ${relativePath}`);
  }
  return resolved;
}

function encryptionKeyForRecord(username: string, relativePath: string): Buffer {
  const resolved = storageClient.resolvePath({
    username,
    category: 'memory',
    subcategory: 'episodic',
  });
  if (!resolved.success || !resolved.profileRoot) {
    throw new Error(resolved.error || `Cannot resolve encrypted profile storage for ${relativePath}`);
  }
  if (!isProfileUnlocked(resolved.profileRoot)) {
    throw new Error(`Encrypted episodic memory is unavailable while the profile is locked: ${relativePath}`);
  }
  const key = getCachedKey(resolved.profileRoot);
  if (!key) {
    throw new Error(`Encrypted episodic memory key is unavailable: ${relativePath}`);
  }
  return key;
}

function parseEpisodicRecord(username: string, fullPath: string, relativePath: string): EpisodicEvent {
  const encrypted = relativePath.endsWith(ENCRYPTED_EXTENSION);
  const serialized = encrypted
    ? decrypt(
      JSON.parse(fs.readFileSync(fullPath, 'utf8')) as EncryptedData,
      encryptionKeyForRecord(username, relativePath),
    ).toString('utf8')
    : fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Episodic memory must contain a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'string'
      || typeof record.timestamp !== 'string'
      || Number.isNaN(Date.parse(record.timestamp))
      || typeof record.content !== 'string') {
    throw new Error('Episodic memory requires string id, timestamp, and content fields');
  }
  if (typeof record.tags !== 'undefined'
      && (!Array.isArray(record.tags) || !record.tags.every(value => typeof value === 'string'))) {
    throw new Error('Episodic memory tags must be an array of strings');
  }
  if (typeof record.entities !== 'undefined'
      && (!Array.isArray(record.entities) || !record.entities.every(value => typeof value === 'string'))) {
    throw new Error('Episodic memory entities must be an array of strings');
  }
  if (typeof record.metadata !== 'undefined'
      && (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata))) {
    throw new Error('Episodic memory metadata must be an object');
  }

  const validation = validateEvent(parsed as Partial<EpisodicEvent>);
  if (!validation.valid) {
    throw new Error(`Invalid episodic memory: ${validation.errors.join('; ')}`);
  }
  if (validation.warnings.length > 0) {
    throw new Error(`Episodic memory requires normalization: ${validation.warnings.join('; ')}`);
  }
  return parsed as EpisodicEvent;
}

/**
 * Re-read a capture result through the canonical profile and encryption owner.
 * Retryable producers use this to return the already-durable event rather than
 * a newly regenerated value when an idempotent capture is replayed.
 */
export function readCapturedEpisodicEvent(username: string, filePath: string): EpisodicEvent {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) throw new Error('Captured episodic memory read requires a username');
  if (!filePath.trim() || !path.isAbsolute(filePath)) {
    throw new Error('Captured episodic memory read requires an absolute capture path');
  }

  const root = episodicRootFor(normalizedUsername);
  const relativePath = path.relative(root, path.resolve(filePath));
  const fullPath = resolveEpisodicRecordPath(root, relativePath);
  const realRoot = fs.realpathSync(root);
  const realPath = fs.realpathSync(fullPath);
  if (!realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Captured episodic memory path escapes its profile root: ${relativePath}`);
  }
  const stats = fs.statSync(realPath);
  if (!stats.isFile()) throw new Error(`Captured episodic memory is not a file: ${relativePath}`);
  if (stats.size > DEFAULT_MAX_EPISODIC_RECORD_BYTES) {
    throw new Error(`Captured episodic memory exceeds ${DEFAULT_MAX_EPISODIC_RECORD_BYTES} bytes`);
  }
  return parseEpisodicRecord(normalizedUsername, realPath, relativePath);
}

/**
 * Enumerate existing episodic records through the canonical profile and
 * encryption owners. Per-file failures are explicit so finite maintenance work
 * cannot turn malformed, locked, or oversized records into an empty success.
 */
export function* scanEpisodicMemoryRecords(
  username: string,
  options: EpisodicMemoryScanOptions = {},
): Generator<EpisodicMemoryScanOutcome> {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_EPISODIC_RECORD_BYTES;
  if (!Number.isInteger(maxFileSizeBytes) || maxFileSizeBytes < 1) {
    throw new Error('Episodic memory maximum file size must be a positive integer');
  }
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
  if (maxFiles !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxFiles) || maxFiles < 1)) {
    throw new Error('Episodic memory maximum file count must be a positive integer');
  }

  const root = episodicRootFor(username);
  if (!fs.existsSync(root)) return;
  let filesConsidered = 0;

  function* walk(directory: string): Generator<EpisodicMemoryScanOutcome> {
    if (filesConsidered >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      if (options.newestFirst) entries.reverse();
    } catch (error) {
      yield {
        status: 'failed',
        relativePath: path.relative(root, directory) || '.',
        error: `Cannot read episodic memory directory: ${(error as Error).message}`,
      };
      return;
    }

    for (const entry of entries) {
      if (filesConsidered >= maxFiles) return;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* walk(fullPath);
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith('.json') && !entry.name.endsWith(`.json${ENCRYPTED_EXTENSION}`))) {
        continue;
      }

      filesConsidered += 1;
      const relativePath = path.relative(root, fullPath);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size > maxFileSizeBytes) {
          throw new Error(`Memory file exceeds ${maxFileSizeBytes} bytes`);
        }
        yield {
          status: 'record',
          record: {
            relativePath,
            encrypted: relativePath.endsWith(ENCRYPTED_EXTENSION),
            sizeBytes: stats.size,
            event: parseEpisodicRecord(username, fullPath, relativePath),
          },
        };
      } catch (error) {
        yield {
          status: 'failed',
          relativePath,
          error: (error as Error).message,
        };
      }
    }
  }

  yield* walk(root);
}

/**
 * Atomically update only enrichment-owned fields on an existing memory. The
 * record is re-read and identity-checked immediately before writing so a stale
 * graph result cannot replace another writer's memory content.
 */
export function updateEpisodicMemoryMetadata(
  input: EpisodicMemoryMetadataUpdate,
): EpisodicMemoryUpdateResult {
  if (!input.username.trim()) throw new Error('Episodic memory update requires a username');
  if (!input.expectedId.trim()) throw new Error('Episodic memory update requires an expected memory id');
  if (!Array.isArray(input.tags) || !input.tags.every(value => typeof value === 'string')) {
    throw new Error('Episodic memory tags must be an array of strings');
  }
  if (!Array.isArray(input.entities) || !input.entities.every(value => typeof value === 'string')) {
    throw new Error('Episodic memory entities must be an array of strings');
  }
  if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
    throw new Error('Episodic memory metadata update must be an object');
  }
  const metadataKeys = Object.keys(input.metadata);
  if (metadataKeys.some(key => !['processed', 'processedAt', 'model', 'organizerStatus'].includes(key))) {
    throw new Error('Episodic memory update contains metadata outside the Organizer contract');
  }
  if (input.metadata.processed !== true
      || !input.metadata.processedAt
      || Number.isNaN(Date.parse(input.metadata.processedAt))) {
    throw new Error('Episodic memory Organizer metadata requires a valid processed timestamp');
  }
  if (typeof input.metadata.model !== 'undefined' && typeof input.metadata.model !== 'string') {
    throw new Error('Episodic memory Organizer model must be a string');
  }
  if (!['updated', 'skipped', 'no-content'].includes(input.metadata.organizerStatus)) {
    throw new Error('Episodic memory Organizer status is invalid');
  }

  const root = episodicRootFor(input.username);
  const fullPath = resolveEpisodicRecordPath(root, input.relativePath);
  const realRoot = fs.realpathSync(root);
  const realPath = fs.realpathSync(fullPath);
  if (!realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Episodic memory path escapes its profile root: ${input.relativePath}`);
  }

  const current = parseEpisodicRecord(input.username, fullPath, input.relativePath);
  if (current.id !== input.expectedId) {
    throw new Error(`Episodic memory identity changed before update: ${input.relativePath}`);
  }

  const candidate: EpisodicEvent = {
    ...current,
    tags: input.tags,
    entities: input.entities,
    metadata: { ...current.metadata, ...input.metadata },
  };
  const validation = validateEvent(candidate);
  if (!validation.valid || !validation.sanitized) {
    throw new Error(`Invalid enriched memory: ${validation.errors.join('; ')}`);
  }
  if (validation.warnings.length > 0) {
    throw new Error(`Enriched memory requires normalization: ${validation.warnings.join('; ')}`);
  }
  const durable: EpisodicEvent = {
    ...current,
    tags: validation.sanitized.tags,
    entities: validation.sanitized.entities,
    metadata: { ...current.metadata, ...input.metadata },
  };

  const encrypted = input.relativePath.endsWith(ENCRYPTED_EXTENSION);
  if (encrypted) {
    const key = encryptionKeyForRecord(input.username, input.relativePath);
    safeWriteJSON(fullPath, encrypt(Buffer.from(JSON.stringify(durable, null, 2), 'utf8'), key));
  } else {
    const encryptionConfig = getProfileStorageConfig(input.username)?.encryption;
    if (encryptionConfig?.type === 'aes256') {
      encryptionKeyForRecord(input.username, input.relativePath);
    }
    safeWriteJSON(fullPath, durable);
  }

  auditDataChange({
    type: 'update',
    resource: 'episodic-memory-metadata',
    path: input.relativePath,
    actor: 'organizer',
    details: {
      eventId: durable.id,
      tagCount: durable.tags?.length ?? 0,
      entityCount: durable.entities?.length ?? 0,
      encrypted,
    },
  });

  return { relativePath: input.relativePath, encrypted, event: durable };
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
      console.warn(`${LOG_PREFIX} Failed to read task file:`, fullPath, error);
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

  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    throw new Error('Cannot resolve tasks path');
  }

  const filepath = path.join(tasksResult.path, 'active', `${task.id}.json`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(task, null, 2));

  return filepath;
}

export function updateTaskStatus(taskId: string, status: Task['status']): void {
  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    throw new Error('Cannot resolve tasks path');
  }
  const tasksPath = tasksResult.path;

  const activeDir = path.join(tasksPath, 'active');
  const completedDir = path.join(tasksPath, 'completed');

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

    // Goal-Task-Desire Integration: Reinforce linked desires on task completion
    // Check if this task has a desire:xxx tag and reinforce the corresponding desire
    if (status === 'done' && task.tags) {
      const desireTag = task.tags.find(t => t.startsWith('desire:'));
      if (desireTag) {
        const desireId = desireTag.replace('desire:', '');
        // Fire-and-forget async reinforcement (don't block task completion)
        reinforceLinkedDesire(desireId, task.title).catch(err => {
          console.warn(`${LOG_PREFIX} Failed to reinforce linked desire:`, err);
        });
      }
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
 * Reinforce a desire when its linked task completes successfully.
 * Part of Goal-Task-Desire integration.
 * @internal
 */
async function reinforceLinkedDesire(desireId: string, taskTitle: string): Promise<void> {
  try {
    const agency = agencyStorage;
    const ctx = getUserContext();
    const username = ctx?.username;

    // Load the desire
    const desire = await agency.loadDesire(desireId, username);
    if (!desire) {
      console.log(`${LOG_PREFIX} Desire ${desireId} not found for reinforcement`);
      return;
    }

    // Only reinforce nascent/pending desires (not already executing/completed)
    if (desire.status !== 'nascent' && desire.status !== 'pending') {
      console.log(`${LOG_PREFIX} Desire ${desireId} is ${desire.status}, skipping reinforcement`);
      return;
    }

    // Apply reinforcement boost (+0.08 by default)
    const REINFORCEMENT_BOOST = 0.08;
    const newStrength = Math.min(1.0, desire.strength + REINFORCEMENT_BOOST);

    const updatedDesire = {
      ...desire,
      strength: newStrength,
      reinforcements: (desire.reinforcements || 0) + 1,
      updatedAt: timestamp(),
      lastReviewedAt: timestamp(),
    };

    await agency.saveDesire(updatedDesire, username);

    audit({
      category: 'data',
      level: 'info',
      event: 'desire_reinforced_by_task',
      actor: 'memory',
      details: {
        desireId,
        taskTitle,
        oldStrength: desire.strength,
        newStrength,
        reinforcements: updatedDesire.reinforcements,
        username,
      },
    });

    console.log(`${LOG_PREFIX} ✓ Reinforced desire "${desire.title}" from task completion (${desire.strength.toFixed(2)} → ${newStrength.toFixed(2)})`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error reinforcing desire:`, error);
    throw error;
  }
}

/**
 * Update task fields (title, description, priority, tags, due, etc.)
 * For status changes, use updateTaskStatus instead.
 */
export function updateTask(taskId: string, updates: Partial<Omit<Task, 'id' | 'created'>>): void {
  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    throw new Error('Cannot resolve tasks path');
  }
  const tasksPath = tasksResult.path;

  const activeDir = path.join(tasksPath, 'active');
  const completedDir = path.join(tasksPath, 'completed');

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
  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    throw new Error('Cannot resolve tasks path');
  }
  const tasksPath = tasksResult.path;

  const activeDir = path.join(tasksPath, 'active');
  const completedDir = path.join(tasksPath, 'completed');
  const deletedDir = path.join(tasksPath, 'deleted');

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
  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    return []; // Return empty if path unavailable
  }

  const activeDir = path.join(tasksResult.path, 'active');

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
  // Resolve tasks path via storage router
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    return []; // Return empty if path unavailable
  }

  const completedDir = path.join(tasksResult.path, 'completed');
  const tasks = readTasksFromDirectory(completedDir);
  tasks.sort((a, b) => {
    const aUpdated = new Date(a.updated || a.completed || 0).getTime();
    const bUpdated = new Date(b.updated || b.completed || 0).getTime();
    return bUpdated - aUpdated;
  });
  return tasks;
}

// ============================================================================
// Project Management (Phase 4: Task Graph)
// ============================================================================

function readProjectsFromDirectory(dir: string): Project[] {
  if (!fs.existsSync(dir)) return [];

  const projects: Project[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      projects.push(JSON.parse(content));
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to read project file:`, fullPath, error);
    }
  }
  return projects;
}

/**
 * Create a new project.
 */
export function createProject(title: string, opts: Partial<Project> = {}): string {
  const ctx = getUserContext();

  const project: Project = {
    id: generateId('proj'),
    title,
    description: opts.description || '',
    status: opts.status || 'active',
    priority: opts.priority || 'P2',
    targetDate: opts.targetDate,
    tags: opts.tags || [],
    userId: ctx?.userId,
    progress: 0,
    source: opts.source,
    sourceId: opts.sourceId,
    created: timestamp(),
    updated: timestamp(),
  };

  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) {
    throw new Error('Cannot resolve tasks path');
  }

  const filepath = path.join(tasksResult.path, 'projects', `${project.id}.json`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(project, null, 2));

  return project.id;
}

/**
 * Get a project by ID.
 */
export function getProject(projectId: string): Project | null {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return null;

  const filepath = path.join(tasksResult.path, 'projects', `${projectId}.json`);
  if (!fs.existsSync(filepath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Update a project.
 */
export function updateProject(projectId: string, updates: Partial<Project>): Project | null {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return null;

  const filepath = path.join(tasksResult.path, 'projects', `${projectId}.json`);
  if (!fs.existsSync(filepath)) return null;

  try {
    const project: Project = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    // Update allowed fields
    if (updates.title !== undefined) project.title = updates.title;
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.status !== undefined) project.status = updates.status;
    if (updates.priority !== undefined) project.priority = updates.priority;
    if (updates.targetDate !== undefined) project.targetDate = updates.targetDate;
    if (updates.tags !== undefined) project.tags = updates.tags;

    project.updated = timestamp();

    if (updates.status === 'completed' || updates.status === 'archived') {
      project.completed = timestamp();
    }

    fs.writeFileSync(filepath, JSON.stringify(project, null, 2));
    return project;
  } catch {
    return null;
  }
}

/**
 * List all active projects.
 */
export function listProjects(includeArchived = false): Project[] {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return [];

  const projectsDir = path.join(tasksResult.path, 'projects');
  const projects = readProjectsFromDirectory(projectsDir);

  // Calculate progress for each project
  const allTasks = [...listActiveTasks(), ...listCompletedTasks()];
  for (const project of projects) {
    const projectTasks = allTasks.filter(t => t.projectId === project.id);
    if (projectTasks.length > 0) {
      const completed = projectTasks.filter(t => t.status === 'done').length;
      project.progress = Math.round((completed / projectTasks.length) * 100);
    }
  }

  if (!includeArchived) {
    return projects.filter(p => p.status !== 'archived');
  }

  return projects.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const aPri = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 999;
    const bPri = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 999;
    return aPri - bPri;
  });
}

/**
 * Get tasks for a specific project.
 */
export function getProjectTasks(projectId: string): Task[] {
  const allTasks = [...listActiveTasks(), ...listCompletedTasks()];
  return allTasks.filter(t => t.projectId === projectId);
}

/**
 * Delete a project (archive it).
 */
export function deleteProject(projectId: string): boolean {
  return updateProject(projectId, { status: 'archived' }) !== null;
}

// ============================================================================
// Task Dependencies (Phase 4: Task Graph)
// ============================================================================

/**
 * Check if a task's dependencies are all completed.
 */
export function areDependenciesMet(task: Task): boolean {
  if (!task.dependencies || task.dependencies.length === 0) return true;

  const completedTasks = listCompletedTasks();
  const completedIds = new Set(completedTasks.filter(t => t.status === 'done').map(t => t.id));

  return task.dependencies.every(depId => completedIds.has(depId));
}

/**
 * Get blocking dependencies for a task (dependencies not yet completed).
 */
export function getBlockingDependencies(task: Task): Task[] {
  if (!task.dependencies || task.dependencies.length === 0) return [];

  const allTasks = [...listActiveTasks(), ...listCompletedTasks()];
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  return task.dependencies
    .map(depId => taskMap.get(depId))
    .filter((t): t is Task => t !== undefined && t.status !== 'done');
}

/**
 * Get tasks that depend on a given task.
 */
export function getDependentTasks(taskId: string): Task[] {
  const allTasks = listActiveTasks();
  return allTasks.filter(t => t.dependencies?.includes(taskId));
}

/**
 * Add a dependency to a task.
 */
export function addTaskDependency(taskId: string, dependsOnId: string): boolean {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return false;

  // Find the task
  const activeDir = path.join(tasksResult.path, 'active');
  const filepath = path.join(activeDir, `${taskId}.json`);

  if (!fs.existsSync(filepath)) return false;

  try {
    const task: Task = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    // Prevent circular dependencies
    if (wouldCreateCycle(taskId, dependsOnId)) {
      console.warn(`${LOG_PREFIX} Cannot add dependency: would create circular reference`);
      return false;
    }

    task.dependencies = task.dependencies || [];
    if (!task.dependencies.includes(dependsOnId)) {
      task.dependencies.push(dependsOnId);
      task.updated = timestamp();
      fs.writeFileSync(filepath, JSON.stringify(task, null, 2));
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a dependency from a task.
 */
export function removeTaskDependency(taskId: string, dependsOnId: string): boolean {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return false;

  const activeDir = path.join(tasksResult.path, 'active');
  const filepath = path.join(activeDir, `${taskId}.json`);

  if (!fs.existsSync(filepath)) return false;

  try {
    const task: Task = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    if (task.dependencies) {
      task.dependencies = task.dependencies.filter(id => id !== dependsOnId);
      task.updated = timestamp();
      fs.writeFileSync(filepath, JSON.stringify(task, null, 2));
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if adding a dependency would create a cycle.
 */
function wouldCreateCycle(taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true;

  const allTasks = listActiveTasks();
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  const visited = new Set<string>();
  const stack = [dependsOnId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === taskId) return true;
    if (visited.has(currentId)) continue;

    visited.add(currentId);
    const current = taskMap.get(currentId);
    if (current?.dependencies) {
      stack.push(...current.dependencies);
    }
  }

  return false;
}

/**
 * Assign a task to a project.
 */
export function assignTaskToProject(taskId: string, projectId: string | null): boolean {
  const tasksResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'tasks',
  });
  if (!tasksResult.success || !tasksResult.path) return false;

  // Find task in active or completed
  const activeDir = path.join(tasksResult.path, 'active');
  const completedDir = path.join(tasksResult.path, 'completed');

  let filepath = path.join(activeDir, `${taskId}.json`);
  if (!fs.existsSync(filepath)) {
    filepath = path.join(completedDir, `${taskId}.json`);
  }

  if (!fs.existsSync(filepath)) return false;

  try {
    const task: Task = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    task.projectId = projectId || undefined;
    task.updated = timestamp();
    fs.writeFileSync(filepath, JSON.stringify(task, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get next actionable tasks (no blocking dependencies).
 */
export function getActionableTasks(): Task[] {
  const activeTasks = listActiveTasks();
  return activeTasks.filter(t =>
    t.status === 'todo' && areDependenciesMet(t)
  );
}

/**
 * Get blocked tasks (have incomplete dependencies).
 */
export function getBlockedTasks(): Task[] {
  const activeTasks = listActiveTasks();
  return activeTasks.filter(t =>
    t.dependencies &&
    t.dependencies.length > 0 &&
    !areDependenciesMet(t)
  );
}

export function searchMemory(query: string): string[] {
  const results: string[] = [];

  // Resolve memory paths via storage router
  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const semanticResult = storageClient.resolvePath({ category: 'memory', subcategory: 'semantic' });
  const tasksResult = storageClient.resolvePath({ category: 'memory', subcategory: 'tasks' });
  const profileRootResult = storageClient.getProfileRoot();

  const searchIn: string[] = [];
  if (episodicResult.success && episodicResult.path) searchIn.push(episodicResult.path);
  if (semanticResult.success && semanticResult.path) searchIn.push(semanticResult.path);
  if (tasksResult.success && tasksResult.path) searchIn.push(tasksResult.path);

  const profileRoot = profileRootResult.success && profileRootResult.path ? profileRootResult.path : '';

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
            results.push(profileRoot ? path.relative(profileRoot, fullPath) : fullPath);
          }
        } catch (error) {
          console.warn(`${LOG_PREFIX} Failed to read file for search: ${fullPath}:`, error);
        }
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

  // Resolve episodic path via storage router
  const episodicResult = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'episodic',
  });
  if (!episodicResult.success || !episodicResult.path) {
    return files; // Return empty if path unavailable
  }
  const root = episodicResult.path;

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

  // Use system paths for logs (not user-specific)
  const syncDir = path.join(systemPaths.logs, 'sync');
  const logFile = path.join(syncDir, `${new Date().toISOString().slice(0, 10)}.ndjson`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

export function logDecision(decision: any): void {
  // Use system paths for logs (not user-specific)
  const decisionsDir = path.join(systemPaths.logs, 'decisions');
  const logFile = path.join(decisionsDir, `${new Date().toISOString().slice(0, 10)}.ndjson`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify({
    timestamp: timestamp(),
    ...decision,
  }) + '\n');
}
