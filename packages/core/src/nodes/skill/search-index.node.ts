/**
 * Search Index Node
 *
 * Semantic memory search using the search_index skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('search_index', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:search_index] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const SearchIndexNode: NodeDefinition = defineNode({
  id: 'skill_search_index',
  name: 'Search Index',
  category: 'skill',
  inputs: [
    { name: 'query', type: 'string' },
    { name: 'maxResults', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'results', type: 'array' },
  ],
  description: 'Semantic memory search',
  execute,
});
