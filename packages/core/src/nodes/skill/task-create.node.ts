/**
 * Task Create Node
 *
 * Creates a new task using the task_create skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('task_create', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:task_create] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TaskCreateNode: NodeDefinition = defineNode({
  id: 'skill_task_create',
  name: 'Create Task',
  category: 'skill',
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'taskId', type: 'string' },
  ],
  description: 'Creates a new task',
  execute,
});
