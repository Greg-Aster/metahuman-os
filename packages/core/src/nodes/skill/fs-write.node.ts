/**
 * File Write Node
 *
 * Writes file contents using the fs_write skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('fs_write', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:fs_write] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const FsWriteNode: NodeDefinition = defineNode({
  id: 'skill_fs_write',
  name: 'Write File',
  category: 'skill',
  inputs: [
    { name: 'filePath', type: 'string' },
    { name: 'content', type: 'string' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
  ],
  description: 'Writes file contents',
  execute,
});
