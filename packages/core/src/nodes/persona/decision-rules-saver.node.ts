/**
 * Decision Rules Saver Node
 * Saves decision rules configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  const rules = inputs[0];

  if (!rules) {
    return {
      success: false,
      error: 'Decision rules required',
    };
  }

  try {
    const { saveDecisionRules } = await import('../../identity.js');
    saveDecisionRules(rules);

    return {
      success: true,
      saved: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[DecisionRulesSaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const DecisionRulesSaverNode: NodeDefinition = defineNode({
  id: 'decision_rules_saver',
  name: 'Decision Rules Saver',
  category: 'persona',
  inputs: [
    { name: 'rules', type: 'object', description: 'Decision rules to save' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'saved', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves decision rules configuration',
  execute,
});
