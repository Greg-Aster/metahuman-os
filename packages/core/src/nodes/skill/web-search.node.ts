/**
 * Web Search Node
 *
 * Searches the web using the web_search skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('web_search', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:web_search] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const WebSearchNode: NodeDefinition = defineNode({
  id: 'skill_web_search',
  name: 'Web Search',
  category: 'skill',
  inputs: [
    { name: 'query', type: 'string' },
  ],
  outputs: [
    { name: 'results', type: 'array' },
  ],
  description: 'Searches the web',
  execute,
});
