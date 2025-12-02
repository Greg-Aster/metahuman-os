/**
 * Decision Rules Loader Node
 * Loads decision rules configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();

    return {
      success: true,
      rules,
      trustLevel: rules.trustLevel,
      hardRules: rules.hardRules,
      softPreferences: rules.softPreferences,
    };
  } catch (error) {
    console.error('[DecisionRulesLoader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const DecisionRulesLoaderNode: NodeDefinition = defineNode({
  id: 'decision_rules_loader',
  name: 'Decision Rules Loader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'rules', type: 'object', description: 'Full decision rules' },
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
    { name: 'hardRules', type: 'array', description: 'Hard rules' },
    { name: 'softPreferences', type: 'array', description: 'Soft preferences' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads decision rules configuration',
  execute,
});
