/**
 * File Read Node
 *
 * Reads file contents using the fs_read skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';
import { loadDecisionRules } from '../../identity.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('fs_read', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:fs_read] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const FsReadNode: NodeDefinition = defineNode({
  id: 'skill_fs_read',
  name: 'Read File',
  category: 'skill',
  inputs: [
    { name: 'filePath', type: 'string' },
  ],
  outputs: [
    { name: 'content', type: 'string' },
    { name: 'success', type: 'boolean' },
  ],
  description: 'Reads file contents',
  execute,
});
