import fs from 'node:fs';
import path from 'node:path';
import { paths, generateId, timestamp } from './paths.js';
import { appendEventToIndex, getIndexStatus } from './vector-index.js';
import { auditDataChange } from './audit.js';
import { getUserContext } from './context.js';
import type { CognitiveModeId } from './cognitive-mode.js';
import { scheduleIndexUpdate } from './vector-index-queue.js';
import { appendToolToCache } from './recent-tools-cache.js';

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

function buildEventDirectory(category: string, year: string): string {
  const safeCategory = category.replace(/[^a-z0-9-_]/g, '-');
  if (!safeCategory || safeCategory === DEFAULT_EVENT_CATEGORY) {
    return path.join(paths.episodic, year);
  }
  return path.join(paths.episodic, safeCategory, year);
}

export function captureEvent(content: string, opts: Partial<EpisodicEvent> = {}): string {
  // Get current user context (if any)
  const ctx = getUserContext();

  const event: EpisodicEvent = {
    id: generateId('evt'),
    timestamp: timestamp(),
    content,
    type: opts.type || 'observation',
    response: opts.response,
    entities: opts.entities || [],
    tags: opts.tags || [],
    importance: opts.importance || 0.5,
    links: opts.links || [],
    userId: ctx?.userId, // NEW: Track owner (undefined for legacy/anonymous)
    metadata: opts.metadata || {},
  };

  const year = new Date().getFullYear().toString();
  const category = resolveEventCategory(event);
  const dir = buildEventDirectory(category, year);
  fs.mkdirSync(dir, { recursive: true });

  const slug = content.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'event';

  const filename = `${event.id}-${slug}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(event, null, 2));

  // Also log to sync
  logSync('capture', { event });

  const cognitiveMode = (event.metadata?.cognitiveMode as CognitiveModeId) || 'dual';

  // A1: Write to recent tool cache for tool_invocation events (async, non-blocking)
  if (event.type === 'tool_invocation' && ctx?.profilePaths && event.metadata?.conversationId) {
    const toolName = event.metadata.toolName || 'unknown';
    const success = event.metadata.success !== false;
    const output = JSON.stringify(event.metadata.toolOutputs || {});

    // Fire-and-forget cache write (errors logged internally)
    void appendToolToCache(
      ctx.profilePaths,
      event.metadata.conversationId,
      event.id,
      toolName,
      success,
      output
    ).catch(() => {}); // Silently fail - cache is optional optimization
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
    // Fallback to immediate append when no user context is available
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

  return filepath;
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
