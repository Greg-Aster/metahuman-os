/**
 * File List Node
 *
 * Lists directory contents using the fs_list skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('fs_list', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:fs_list] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const FsListNode: NodeDefinition = defineNode({
  id: 'skill_fs_list',
  name: 'List Files',
  category: 'skill',
  inputs: [
    { name: 'directory', type: 'string' },
  ],
  outputs: [
    { name: 'files', type: 'array' },
  ],
  description: 'Lists directory contents',
  execute,
});
