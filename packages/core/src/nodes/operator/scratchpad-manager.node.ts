/**
 * Scratchpad Manager Node
 *
 * Manages ReAct scratchpad state (thought, action, observation history)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const operation = properties?.operation || 'append';
  const maxSteps = properties?.maxSteps || 10;
  const sessionId = context.sessionId || 'default';

  // Store scratchpad in context (persists across node executions within same graph run)
  const scratchpadKey = `scratchpad_${sessionId}`;

  try {
    switch (operation) {
      case 'append':
        const scratchpad = (context[scratchpadKey] || []) as any[];
        const newStep = inputs[0] || {};
        scratchpad.push(newStep);
        context[scratchpadKey] = scratchpad;

        return {
          scratchpad,
          stepCount: scratchpad.length,
          appended: true,
        };

      case 'get':
        const current = (context[scratchpadKey] || []) as any[];
        return {
          scratchpad: current,
          stepCount: current.length,
        };

      case 'clear':
        context[scratchpadKey] = [];
        return {
          scratchpad: [],
          stepCount: 0,
          cleared: true,
        };

      case 'trim':
        const full = (context[scratchpadKey] || []) as any[];
        const trimmed = full.slice(-maxSteps);
        context[scratchpadKey] = trimmed;
        return {
          scratchpad: trimmed,
          stepCount: trimmed.length,
          trimmed: true,
        };

      default:
        return {
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[ScratchpadManager] Error:', error);
    return {
      error: (error as Error).message,
    };
  }
};

export const ScratchpadManagerNode: NodeDefinition = defineNode({
  id: 'scratchpad_manager',
  name: 'Scratchpad Manager',
  category: 'operator',
  inputs: [
    { name: 'step', type: 'object', optional: true, description: 'Step to append' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'array', description: 'Current scratchpad state' },
    { name: 'stepCount', type: 'number' },
  ],
  properties: {
    operation: 'append',
    maxSteps: 10,
  },
  propertySchemas: {
    operation: {
      type: 'select',
      default: 'append',
      label: 'Operation',
      description: 'What operation to perform',
      options: ['append', 'get', 'clear', 'trim'],
    },
    maxSteps: {
      type: 'number',
      default: 10,
      label: 'Max Steps',
      description: 'Maximum steps to keep (for trim)',
    },
  },
  description: 'Manages ReAct scratchpad state',
  execute,
});
