/**
 * Trust Level Writer Node
 * Sets trust level in decision rules
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  const trustLevel = inputs[0]?.trustLevel || inputs[0];

  if (!trustLevel) {
    return {
      success: false,
      error: 'Trust level required',
    };
  }

  try {
    const { setTrustLevel } = await import('../../identity.js');
    setTrustLevel(trustLevel);

    return {
      success: true,
      trustLevel,
      updated: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[TrustLevelWriter] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TrustLevelWriterNode: NodeDefinition = defineNode({
  id: 'trust_level_writer',
  name: 'Trust Level Writer',
  category: 'persona',
  inputs: [
    { name: 'trustLevel', type: 'string', description: 'Trust level to set' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'trustLevel', type: 'string' },
    { name: 'updated', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Sets trust level in decision rules',
  execute,
});
