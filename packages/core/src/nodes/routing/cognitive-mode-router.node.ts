/**
 * Cognitive Mode Router Node
 *
 * Routes execution based on cognitive mode (dual, agent, emulation)
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const CognitiveModeRouterNode: NodeDefinition = defineNode({
  id: 'cognitive_mode_router',
  name: 'Cognitive Mode Router',
  category: 'router',
  inputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode', description: 'Current cognitive mode' },
    { name: 'message', type: 'string', description: 'User message' },
  ],
  outputs: [
    { name: 'useDual', type: 'decision', description: 'Route to operator (dual mode)' },
    { name: 'useAgent', type: 'decision', description: 'Conditional routing (agent mode)' },
    { name: 'useEmulation', type: 'decision', description: 'Chat only (emulation mode)' },
    { name: 'mode', type: 'string', description: 'Current mode string' },
    { name: 'message', type: 'string', description: 'Passthrough message' },
  ],
  description: 'Routes based on cognitive mode',

  execute: async (inputs, context) => {
    const cognitiveMode = inputs[0] || context.cognitiveMode || 'dual';
    const message = inputs[1] || context.userMessage || '';

    return {
      mode: cognitiveMode,
      message,
      useDual: cognitiveMode === 'dual',
      useAgent: cognitiveMode === 'agent',
      useEmulation: cognitiveMode === 'emulation',
      routeToOperator: cognitiveMode === 'dual',
      routeToChat: cognitiveMode === 'emulation',
    };
  },
});
