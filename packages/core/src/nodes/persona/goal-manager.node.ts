/**
 * Goal Manager Node
 * Manages goals (short-term, long-term)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const operation = properties?.operation || 'get';
  const scope = properties?.scope || 'shortTerm';
  const goalData = inputs[0];

  try {
    const { loadPersonaCore, savePersonaCore } = await import('../../identity.js');
    const persona = loadPersonaCore();
    const goals = persona.goals[scope] || [];

    switch (operation) {
      case 'get':
        return {
          success: true,
          goals,
          scope,
          count: goals.length,
        };

      case 'add':
        if (!goalData?.goal) {
          return {
            success: false,
            error: 'Goal data required for add operation',
          };
        }
        goals.push(goalData);
        persona.goals[scope] = goals;
        savePersonaCore(persona);
        return {
          success: true,
          added: true,
          goals,
        };

      case 'remove':
        if (goalData?.goal) {
          const filtered = goals.filter((g: any) => g.goal !== goalData.goal);
          persona.goals[scope] = filtered;
          savePersonaCore(persona);
          return {
            success: true,
            removed: true,
            goals: filtered,
          };
        }
        return {
          success: false,
          error: 'Goal identifier required for remove operation',
        };

      case 'update':
        if (!goalData?.goal) {
          return {
            success: false,
            error: 'Goal data required for update operation',
          };
        }
        const index = goals.findIndex((g: any) => g.goal === goalData.goal);
        if (index !== -1) {
          goals[index] = { ...goals[index], ...goalData };
          persona.goals[scope] = goals;
          savePersonaCore(persona);
          return {
            success: true,
            updated: true,
            goals,
          };
        }
        return {
          success: false,
          error: 'Goal not found',
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[GoalManager] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const GoalManagerNode: NodeDefinition = defineNode({
  id: 'goal_manager',
  name: 'Goal Manager',
  category: 'persona',
  inputs: [
    { name: 'goalData', type: 'object', optional: true, description: 'Goal data for add/update/remove' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'goals', type: 'array', description: 'Current goals' },
    { name: 'scope', type: 'string' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    operation: 'get',
    scope: 'shortTerm',
  },
  propertySchemas: {
    operation: {
      type: 'select',
      default: 'get',
      label: 'Operation',
      options: ['get', 'add', 'remove', 'update'],
    },
    scope: {
      type: 'select',
      default: 'shortTerm',
      label: 'Scope',
      options: ['shortTerm', 'longTerm'],
    },
  },
  description: 'Manages goals (short-term, long-term)',
  execute,
});
