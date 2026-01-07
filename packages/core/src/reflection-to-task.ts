/**
 * Reflection-to-Task Converter
 *
 * Analyzes reflections and extracts actionable tasks.
 * Part of Phase 4: Task Graph + Projects
 *
 * Workflow:
 * 1. Scan recent reflections for actionable content
 * 2. Use LLM to extract potential tasks
 * 3. Create task suggestions (not tasks directly)
 * 4. User reviews and approves suggestions
 */

import * as fs from 'fs';
import * as path from 'path';
import { listEpisodicFiles, createTask, createProject, type Task, type Project } from './memory.js';
import { callLLM } from './model-router.js';
import { audit } from './audit.js';
import { storageClient } from './storage-client.js';

// ============================================================================
// Types
// ============================================================================

export interface TaskSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  tags: string[];
  sourceReflectionId: string;
  sourceContent: string;
  confidence: number; // 0-1, how confident the extraction is
  projectSuggestion?: string; // Suggested project name if part of larger goal
  dependencies?: string[]; // Suggested dependencies (other task titles)
  status: 'pending' | 'approved' | 'rejected' | 'created';
  createdAt: string;
  reviewedAt?: string;
  taskId?: string; // Set after task is created
}

export interface ExtractionResult {
  suggestions: TaskSuggestion[];
  reflectionsProcessed: number;
  reflectionIds: string[];
}

export interface ExtractionOptions {
  /** Maximum number of reflections to process */
  maxReflections?: number;
  /** Minimum confidence threshold for suggestions */
  minConfidence?: number;
  /** Only process reflections from the last N days */
  daysBack?: number;
  /** Skip already processed reflections */
  skipProcessed?: boolean;
}

// ============================================================================
// Storage
// ============================================================================

function getSuggestionsPath(): string {
  const stateResult = storageClient.resolvePath({
    category: 'state',
  });
  if (!stateResult.success || !stateResult.path) {
    throw new Error('Cannot resolve state path');
  }
  return path.join(stateResult.path, 'task-suggestions');
}

function ensureSuggestionsDir(): string {
  const dir = getSuggestionsPath();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateSuggestionId(): string {
  return `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Reflection Loading
// ============================================================================

interface ReflectionEvent {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  tags?: string[];
  metadata?: {
    processed?: boolean;
    taskSuggestionsExtracted?: boolean;
  };
}

/**
 * Load recent reflections for task extraction.
 */
function loadRecentReflections(options: ExtractionOptions = {}): ReflectionEvent[] {
  const { maxReflections = 50, daysBack = 7, skipProcessed = true } = options;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const allFiles = listEpisodicFiles();
  const reflections: ReflectionEvent[] = [];

  for (const filepath of allFiles) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const event = JSON.parse(content) as ReflectionEvent;

      // Only process reflections and inner dialogues
      if (event.type !== 'reflection' && event.type !== 'inner_dialogue') {
        continue;
      }

      // Check date
      const eventDate = new Date(event.timestamp);
      if (eventDate < cutoffDate) {
        continue;
      }

      // Skip already processed if requested
      if (skipProcessed && event.metadata?.taskSuggestionsExtracted) {
        continue;
      }

      reflections.push({
        ...event,
        id: path.basename(filepath, '.json'),
      });

      if (reflections.length >= maxReflections) {
        break;
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp (newest first)
  reflections.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return reflections;
}

// ============================================================================
// LLM Extraction
// ============================================================================

const EXTRACTION_PROMPT = `You are analyzing a reflection or inner dialogue to extract actionable tasks.

The reflection may contain:
- Things the person wants to do
- Problems they want to solve
- Goals they're working toward
- Ideas they want to explore
- Skills they want to learn

For each actionable item, extract:
1. A clear, concise task title (imperative form, e.g., "Research X", "Set up Y")
2. A brief description of what needs to be done
3. Priority: P0 (urgent), P1 (high), P2 (normal), P3 (low/someday)
4. Relevant tags
5. Confidence score (0.0-1.0) - how clearly this is an actionable task
6. Optional: Project name if this is part of a larger goal
7. Optional: Dependencies (other tasks that should be done first)

ONLY extract items that are clearly actionable. Skip:
- Vague musings without clear action
- Already completed items
- Pure observations without intent to act

Respond in JSON format:
{
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to be done",
      "priority": "P2",
      "tags": ["tag1", "tag2"],
      "confidence": 0.8,
      "project": "Project Name" | null,
      "dependencies": ["Other task title"] | null
    }
  ]
}

If no actionable tasks are found, respond with: {"tasks": []}`;

interface ExtractedTask {
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  tags: string[];
  confidence: number;
  project?: string | null;
  dependencies?: string[] | null;
}

/**
 * Extract tasks from a single reflection using LLM.
 */
async function extractTasksFromReflection(
  reflection: ReflectionEvent
): Promise<ExtractedTask[]> {
  try {
    const response = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `Analyze this reflection:\n\n${reflection.content}` },
      ],
      options: {
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
      },
    });

    if (!response.content) {
      return [];
    }

    const parsed = JSON.parse(response.content);
    return parsed.tasks || [];
  } catch (error) {
    console.warn('[reflection-to-task] Extraction failed:', (error as Error).message);
    return [];
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Extract task suggestions from recent reflections.
 */
export async function extractTaskSuggestions(
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const { minConfidence = 0.5 } = options;

  const reflections = loadRecentReflections(options);
  const suggestions: TaskSuggestion[] = [];
  const reflectionIds: string[] = [];

  for (const reflection of reflections) {
    const extracted = await extractTasksFromReflection(reflection);

    for (const task of extracted) {
      if (task.confidence < minConfidence) {
        continue;
      }

      const suggestion: TaskSuggestion = {
        id: generateSuggestionId(),
        title: task.title,
        description: task.description,
        priority: task.priority,
        tags: task.tags || [],
        sourceReflectionId: reflection.id,
        sourceContent: reflection.content.substring(0, 500),
        confidence: task.confidence,
        projectSuggestion: task.project || undefined,
        dependencies: task.dependencies || undefined,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      suggestions.push(suggestion);
    }

    reflectionIds.push(reflection.id);
  }

  // Save suggestions
  const dir = ensureSuggestionsDir();
  for (const suggestion of suggestions) {
    const filepath = path.join(dir, `${suggestion.id}.json`);
    fs.writeFileSync(filepath, JSON.stringify(suggestion, null, 2));
  }

  audit({
    category: 'action',
    level: 'info',
    event: 'task_suggestions_extracted',
    actor: 'reflection-to-task',
    details: {
      reflectionsProcessed: reflections.length,
      suggestionsCreated: suggestions.length,
    },
  });

  return {
    suggestions,
    reflectionsProcessed: reflections.length,
    reflectionIds,
  };
}

/**
 * List pending task suggestions.
 */
export function listTaskSuggestions(status?: TaskSuggestion['status']): TaskSuggestion[] {
  const dir = getSuggestionsPath();
  if (!fs.existsSync(dir)) return [];

  const suggestions: TaskSuggestion[] = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const suggestion = JSON.parse(content) as TaskSuggestion;

      if (!status || suggestion.status === status) {
        suggestions.push(suggestion);
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort by confidence (highest first)
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

/**
 * Get a specific task suggestion.
 */
export function getTaskSuggestion(id: string): TaskSuggestion | null {
  const dir = getSuggestionsPath();
  const filepath = path.join(dir, `${id}.json`);

  if (!fs.existsSync(filepath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Approve a task suggestion and create the task.
 */
export function approveTaskSuggestion(
  id: string,
  overrides?: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'tags' | 'projectId'>>
): { success: boolean; taskId?: string; error?: string } {
  const suggestion = getTaskSuggestion(id);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }

  if (suggestion.status !== 'pending') {
    return { success: false, error: `Suggestion already ${suggestion.status}` };
  }

  try {
    // Create the task
    const taskPath = createTask(overrides?.title || suggestion.title, {
      description: overrides?.description || suggestion.description,
      priority: overrides?.priority || suggestion.priority,
      tags: [
        ...(overrides?.tags || suggestion.tags),
        'from-reflection',
      ],
      projectId: overrides?.projectId,
      source: 'reflection',
      sourceId: suggestion.sourceReflectionId,
    });

    // Extract task ID from path
    const taskId = path.basename(taskPath, '.json');

    // Update suggestion status
    suggestion.status = 'created';
    suggestion.reviewedAt = new Date().toISOString();
    suggestion.taskId = taskId;

    const dir = getSuggestionsPath();
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify(suggestion, null, 2)
    );

    audit({
      category: 'data_change',
      level: 'info',
      event: 'task_suggestion_approved',
      actor: 'reflection-to-task',
      details: {
        suggestionId: id,
        taskId,
        title: suggestion.title,
      },
    });

    return { success: true, taskId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Reject a task suggestion.
 */
export function rejectTaskSuggestion(id: string): boolean {
  const suggestion = getTaskSuggestion(id);
  if (!suggestion || suggestion.status !== 'pending') {
    return false;
  }

  suggestion.status = 'rejected';
  suggestion.reviewedAt = new Date().toISOString();

  const dir = getSuggestionsPath();
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify(suggestion, null, 2)
  );

  audit({
    category: 'data_change',
    level: 'info',
    event: 'task_suggestion_rejected',
    actor: 'reflection-to-task',
    details: { suggestionId: id, title: suggestion.title },
  });

  return true;
}

/**
 * Approve all pending suggestions above a confidence threshold.
 */
export function bulkApprove(
  minConfidence = 0.8
): { approved: number; skipped: number; errors: string[] } {
  const pending = listTaskSuggestions('pending');
  let approved = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const suggestion of pending) {
    if (suggestion.confidence < minConfidence) {
      skipped++;
      continue;
    }

    const result = approveTaskSuggestion(suggestion.id);
    if (result.success) {
      approved++;
    } else {
      errors.push(`${suggestion.id}: ${result.error}`);
    }
  }

  return { approved, skipped, errors };
}

/**
 * Clean up old suggestions.
 */
export function cleanupSuggestions(daysOld = 30): number {
  const dir = getSuggestionsPath();
  if (!fs.existsSync(dir)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  let removed = 0;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;

    try {
      const filepath = path.join(dir, file);
      const content = fs.readFileSync(filepath, 'utf8');
      const suggestion = JSON.parse(content) as TaskSuggestion;

      // Remove old reviewed suggestions
      if (
        suggestion.status !== 'pending' &&
        new Date(suggestion.createdAt) < cutoff
      ) {
        fs.unlinkSync(filepath);
        removed++;
      }
    } catch {
      // Skip malformed files
    }
  }

  return removed;
}

// ============================================================================
// Export
// ============================================================================

export const reflectionToTask = {
  extractTaskSuggestions,
  listTaskSuggestions,
  getTaskSuggestion,
  approveTaskSuggestion,
  rejectTaskSuggestion,
  bulkApprove,
  cleanupSuggestions,
};
