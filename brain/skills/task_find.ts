/**
 * task_find Skill
 * Locate a task by title or ID within the MetaHuman task system
 */

import { listActiveTasks } from '../../packages/core/src/memory';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills';

interface TaskFindInputs {
  query: string;
  status?: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
}

interface MatchResult {
  id: string;
  title: string;
  status: string;
  priority?: string;
  score: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTask(query: string, title: string, id: string): number {
  const normQuery = normalize(query);
  const normTitle = normalize(title);
  const normId = normalize(id);

  if (!normQuery) return 0;
  if (normQuery === normId) return 120;
  if (normQuery === normTitle) return 110;

  let score = 0;
  if (normTitle.includes(normQuery)) score += 80;
  if (normQuery.includes(normTitle)) score += 60;
  if (normId.includes(normQuery) || normQuery.includes(normId)) score += 70;

  const queryParts = normQuery.split(' ');
  const titleParts = new Set(normTitle.split(' '));
  for (const part of queryParts) {
    if (titleParts.has(part)) score += 10;
  }

  return score;
}

export const manifest: SkillManifest = {
  id: 'task_find',
  name: 'Find Task',
  description: 'Find the best-matching active task by title or ID',
  category: 'memory',

  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'Phrase to match against task titles or IDs',
    },
    status: {
      type: 'string',
      required: false,
      description: 'Filter by task status (todo, in_progress, blocked, done, cancelled)',
      validation: value => ['todo', 'in_progress', 'blocked', 'done', 'cancelled'].includes(String(value)),
    },
  },

  outputs: {
    match: { type: 'object', description: 'Best matching task (id, title, status, score)' },
    matches: { type: 'array', description: 'All matches sorted by score (top 5)' },
  },

  risk: 'low',
  cost: 'free',
  minTrustLevel: 'observe',
  requiresApproval: false,
};

export async function execute(inputs: TaskFindInputs): Promise<SkillResult> {
  try {
    const query = inputs.query?.trim();
    if (!query) {
      return { success: false, error: 'query is required' };
    }

    const tasks = listActiveTasks();
    if (tasks.length === 0) {
      return {
        success: true,
        outputs: { match: null, matches: [] },
      };
    }

    const candidates: MatchResult[] = [];
    for (const task of tasks) {
      if (inputs.status && task.status !== inputs.status) continue;
      const score = scoreTask(query, task.title, task.id);
      if (score <= 0) continue;
      candidates.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        score,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 5);

    return {
      success: true,
      outputs: {
        match: top[0] ?? null,
        matches: top,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to find task: ${(error as Error).message}`,
    };
  }
}
