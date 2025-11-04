/**
 * task_update_status Skill
 * Update the status of an existing task
 */

import fs from 'node:fs';
import path from 'node:path';
import { updateTaskStatus } from '../../packages/core/src/memory';
import { paths } from '../../packages/core/src/paths';
import { auditDataChange } from '../../packages/core/src/audit';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills';

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

interface TaskStatusInputs {
  taskId: string;
  status: TaskStatus;
}

export const manifest: SkillManifest = {
  id: 'task_update_status',
  name: 'Update Task Status',
  description: 'Change the status of an existing task (e.g., todo → done)',
  category: 'memory',

  inputs: {
    taskId: {
      type: 'string',
      required: true,
      description: 'Identifier of the task to update (e.g., task_xxx)',
    },
    status: {
      type: 'string',
      required: true,
      description: 'New status: todo, in_progress, blocked, done, or cancelled',
      validation: value => ['todo', 'in_progress', 'blocked', 'done', 'cancelled'].includes(String(value)),
    },
  },

  outputs: {
    task: { type: 'object', description: 'Updated task payload' },
    path: { type: 'string', description: 'Filesystem path to the task JSON file' },
  },

  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
};

function resolveTaskPath(taskId: string, status: TaskStatus): string {
  const activePath = path.join(paths.tasks, 'active', `${taskId}.json`);
  if (fs.existsSync(activePath)) return activePath;

  const completedPath = path.join(paths.tasks, 'completed', `${taskId}.json`);
  if (fs.existsSync(completedPath)) return completedPath;

  // If status is done/cancelled, the task may have just been moved to completed.
  if (status === 'done' || status === 'cancelled') {
    return completedPath;
  }

  return activePath;
}

export async function execute(inputs: TaskStatusInputs): Promise<SkillResult> {
  try {
    const taskId = inputs.taskId?.trim();
    if (!taskId) {
      return { success: false, error: 'taskId is required' };
    }

    updateTaskStatus(taskId, inputs.status);

    const taskPath = resolveTaskPath(taskId, inputs.status);
    if (!fs.existsSync(taskPath)) {
      return {
        success: true,
        outputs: {
          task: { id: taskId, status: inputs.status },
          path: taskPath,
        },
      };
    }

    const content = fs.readFileSync(taskPath, 'utf-8');
    const task = JSON.parse(content);

    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskPath,
      actor: 'operator',
      details: { id: task.id, status: task.status },
    });

    return {
      success: true,
      outputs: {
        task,
        path: taskPath,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update task status: ${(error as Error).message}`,
    };
  }
}
