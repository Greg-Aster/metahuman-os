/**
 * Task List Node
 *
 * Lists active tasks using the task_list skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('task_list', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:task_list] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TaskListNode: NodeDefinition = defineNode({
  id: 'skill_task_list',
  name: 'List Tasks',
  category: 'skill',
  inputs: [],
  outputs: [
    { name: 'tasks', type: 'array' },
  ],
  description: 'Lists active tasks',
  execute,
});
