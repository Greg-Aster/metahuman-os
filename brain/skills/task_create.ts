/**
 * task_create Skill
 * Create a new task in the MetaHuman task system
 */

import fs from 'node:fs';
import path from 'node:path';
import { createTask } from '../../packages/core/src/memory';
import { paths } from '../../packages/core/src/paths';
import { auditDataChange } from '../../packages/core/src/audit';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills';

interface TaskInputs {
  title: string;
  description?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  due?: string;
  tags?: string[];
  status?: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
}

export const manifest: SkillManifest = {
  id: 'task_create',
  name: 'Create Task',
  description: 'Create a new task with optional description, priority, tags, or due date',
  category: 'memory',

  inputs: {
    title: {
      type: 'string',
      required: true,
      description: 'Short title or summary of the task',
      validation: value => typeof value === 'string' && value.trim().length > 0,
    },
    description: {
      type: 'string',
      required: false,
      description: 'Additional context or details for the task',
    },
    priority: {
      type: 'string',
      required: false,
      description: 'Priority level (P0, P1, P2, P3)',
      validation: value => ['P0', 'P1', 'P2', 'P3'].includes(String(value)),
    },
    due: {
      type: 'string',
      required: false,
      description: 'ISO date or human-readable due date',
    },
    tags: {
      type: 'array',
      required: false,
      description: 'List of tags to associate with the task',
    },
    status: {
      type: 'string',
      required: false,
      description: 'Initial task status (defaults to todo)',
      validation: value => ['todo', 'in_progress', 'blocked', 'done', 'cancelled'].includes(String(value)),
    },
  },

  outputs: {
    task: { type: 'object', description: 'Created task payload' },
    path: { type: 'string', description: 'Filesystem path to the task JSON file' },
  },

  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
};

export async function execute(inputs: TaskInputs): Promise<SkillResult> {
  try {
    const title = inputs.title?.trim();
    if (!title) {
      return { success: false, error: 'Task title is required' };
    }

    const filepath = createTask(title, {
      description: inputs.description,
      priority: inputs.priority,
      tags: inputs.tags,
      due: inputs.due,
      status: inputs.status,
    });

    const absPath = path.isAbsolute(filepath) ? filepath : path.resolve(paths.root, filepath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const task = JSON.parse(content);

    auditDataChange({
      type: 'create',
      resource: 'task',
      path: absPath,
      actor: 'operator',
      details: { id: task.id, title: task.title, priority: task.priority },
    });

    return {
      success: true,
      outputs: {
        task,
        path: absPath,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create task: ${(error as Error).message}`,
    };
  }
}
