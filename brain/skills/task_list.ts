/**
 * task_list Skill
 * Read all active tasks from the MetaHuman task system
 */

import { listActiveTasks } from '../../packages/core/src/memory';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills';

export const manifest: SkillManifest = {
  id: 'task_list',
  name: 'List Tasks',
  description: 'Retrieve the current active tasks with status, priority, and metadata',
  category: 'memory',

  inputs: {
    includeCompleted: {
      type: 'boolean',
      required: false,
      description: 'Include completed/cancelled tasks (default: false)',
    },
  },

  outputs: {
    tasks: { type: 'array', description: 'Array of task objects' },
    count: { type: 'number', description: 'Number of tasks returned' },
  },

  risk: 'low',
  cost: 'free',
  minTrustLevel: 'observe',
  requiresApproval: false,
};

export async function execute(inputs: { includeCompleted?: boolean }): Promise<SkillResult> {
  try {
    const active = listActiveTasks();
    // For now we only support active tasks; includeCompleted placeholder for future expansion
    const tasks = active;

    return {
      success: true,
      outputs: {
        tasks,
        count: tasks.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list tasks: ${(error as Error).message}`,
    };
  }
}
