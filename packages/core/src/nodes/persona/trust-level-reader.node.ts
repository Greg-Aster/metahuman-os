/**
 * Trust Level Reader Node
 * Gets current trust level from decision rules
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();

    return {
      success: true,
      trustLevel: rules.trustLevel,
      availableModes: rules.availableModes,
      description: rules.modeDescription?.[rules.trustLevel] || '',
    };
  } catch (error) {
    console.error('[TrustLevelReader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TrustLevelReaderNode: NodeDefinition = defineNode({
  id: 'trust_level_reader',
  name: 'Trust Level Reader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
    { name: 'availableModes', type: 'array', description: 'Available modes' },
    { name: 'description', type: 'string', description: 'Mode description' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Gets current trust level from decision rules',
  execute,
});
