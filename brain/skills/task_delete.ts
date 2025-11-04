/**
 * tasks.delete Skill
 * Remove a task from the task list (archives it under deleted/)
 */

import type { SkillManifest, SkillResult } from '../../packages/core/src/skills';
import { deleteTask } from '../../packages/core/src/memory';

interface TaskDeleteInputs {
  taskId: string;
}

export const manifest: SkillManifest = {
  id: 'tasks.delete',
  name: 'Delete Task',
  description: 'Delete a task by ID after archiving its contents.',
  category: 'memory',
  inputs: {
    taskId: {
      type: 'string',
      required: true,
      description: 'Identifier of the task to delete (e.g., task_xxx)',
    },
  },
  outputs: {
    path: { type: 'string', description: 'Filesystem path to the archived deleted task JSON file' },
  },
  risk: 'medium',
  cost: 'moderate',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
};

export async function execute(inputs: TaskDeleteInputs): Promise<SkillResult> {
  const taskId = inputs.taskId?.trim();
  if (!taskId) {
    return { success: false, error: 'taskId is required' };
  }

  try {
    const archivePath = deleteTask(taskId);
    return {
      success: true,
      outputs: { path: archivePath },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete task: ${(error as Error).message}`,
    };
  }
}
