/**
 * Desire Loader Node
 *
 * Loads a desire by ID from agency storage.
 *
 * Inputs:
 *   - desireId: string - The ID of the desire to load
 *
 * Outputs:
 *   - desire: Desire object or null if not found
 *   - found: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { loadDesire } from '../../agency/storage.js';

const execute: NodeExecutor = async (inputs, context, _properties) => {
  const desireId = inputs.desireId || context.desireId;

  if (!desireId) {
    return {
      desire: null,
      found: false,
    };
  }

  const username = context.userId;
  const desire = await loadDesire(desireId, username);

  return {
    desire,
    found: desire !== null,
  };
};

export const DesireLoaderNode: NodeDefinition = defineNode({
  id: 'desire_loader',
  name: 'Load Desire',
  category: 'agency',
  description: 'Loads a desire by ID from agency storage',
  inputs: [
    { name: 'desireId', type: 'string', description: 'ID of the desire to load' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'The loaded Desire object' },
    { name: 'found', type: 'boolean', description: 'Whether the desire was found' },
  ],
  properties: {},
  execute,
});

export default DesireLoaderNode;
