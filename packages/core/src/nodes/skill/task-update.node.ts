/**
 * Task Update Node
 *
 * Updates task status using the task_update skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('task_update', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:task_update] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TaskUpdateNode: NodeDefinition = defineNode({
  id: 'skill_task_update',
  name: 'Update Task',
  category: 'skill',
  inputs: [
    { name: 'taskId', type: 'string' },
    { name: 'status', type: 'string' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
  ],
  description: 'Updates task status',
  execute,
});
