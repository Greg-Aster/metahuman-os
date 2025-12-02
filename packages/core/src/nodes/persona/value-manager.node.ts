/**
 * Value Manager Node
 * Manages core values (read, add, remove, update)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const operation = properties?.operation || 'get';
  const valueData = inputs[0];

  try {
    const { loadPersonaCore, savePersonaCore } = await import('../../identity.js');
    const persona = loadPersonaCore();

    switch (operation) {
      case 'get':
        return {
          success: true,
          values: persona.values.core,
          count: persona.values.core.length,
        };

      case 'add':
        if (!valueData?.value) {
          return {
            success: false,
            error: 'Value data required for add operation',
          };
        }
        persona.values.core.push(valueData);
        savePersonaCore(persona);
        return {
          success: true,
          added: true,
          values: persona.values.core,
        };

      case 'remove':
        if (valueData?.value) {
          persona.values.core = persona.values.core.filter(
            (v: any) => v.value !== valueData.value
          );
          savePersonaCore(persona);
          return {
            success: true,
            removed: true,
            values: persona.values.core,
          };
        }
        return {
          success: false,
          error: 'Value identifier required for remove operation',
        };

      case 'update':
        if (!valueData?.value) {
          return {
            success: false,
            error: 'Value data required for update operation',
          };
        }
        const index = persona.values.core.findIndex(
          (v: any) => v.value === valueData.value
        );
        if (index !== -1) {
          persona.values.core[index] = { ...persona.values.core[index], ...valueData };
          savePersonaCore(persona);
          return {
            success: true,
            updated: true,
            values: persona.values.core,
          };
        }
        return {
          success: false,
          error: 'Value not found',
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[ValueManager] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const ValueManagerNode: NodeDefinition = defineNode({
  id: 'value_manager',
  name: 'Value Manager',
  category: 'persona',
  inputs: [
    { name: 'valueData', type: 'object', optional: true, description: 'Value data for add/update/remove' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'values', type: 'array', description: 'Current values' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    operation: 'get',
  },
  propertySchemas: {
    operation: {
      type: 'select',
      default: 'get',
      label: 'Operation',
      options: ['get', 'add', 'remove', 'update'],
    },
  },
  description: 'Manages core values (read, add, remove, update)',
  execute,
});
