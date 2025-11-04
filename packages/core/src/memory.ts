import fs from 'node:fs';
import path from 'node:path';
import { paths, generateId, timestamp } from './paths.js';
import { appendEventToIndex, getIndexStatus } from './vector-index.js';
import { auditDataChange } from './audit.js';

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
  created: string;
  updated: string;
  completed?: string;
}

export function captureEvent(content: string, opts: Partial<EpisodicEvent> = {}): string {
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
  };

  const year = new Date().getFullYear().toString();
  const dir = path.join(paths.episodic, year);
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

  // Try to append to embeddings index if it exists
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
  const task: Task = {
    id: generateId('task'),
    title,
    description: opts.description || '',
    status: opts.status || 'todo',
    priority: opts.priority || 'P2',
    due: opts.due,
    tags: opts.tags || [],
    dependencies: opts.dependencies || [],
    created: timestamp(),
    updated: timestamp(),
  };

  const filepath = path.join(paths.tasks, 'active', `${task.id}.json`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(task, null, 2));

  return filepath;
}

export function updateTaskStatus(taskId: string, status: Task['status']): void {
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

export function deleteTask(taskId: string): string {
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
