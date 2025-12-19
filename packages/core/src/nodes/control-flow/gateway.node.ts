/**
 * Gateway Node
 *
 * A conditional pass-through node that acts like a transistor.
 * Data only flows through when the gate is "open" (condition is true).
 * When the gate is "closed" (condition is false), output is null.
 *
 * Use cases:
 * - Prevent output nodes from running during loop iterations
 * - Conditional data flow based on router decisions
 * - Guard clauses in graph workflows
 *
 * Example wiring:
 *   feedback_router.response → gateway.data
 *   feedback_router.shouldExitLoop → gateway.open (inverted from shouldContinueLoop)
 *   gateway.output → stream_writer.response
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  // Named inputs with array fallbacks
  const data = inputs.data ?? inputs[0];
  const openCondition = inputs.open ?? inputs[1];

  // Property-based inversion (for convenience when wiring)
  const invertCondition = properties?.invertCondition ?? false;

  // Determine if gate is open
  let isOpen = Boolean(openCondition);
  if (invertCondition) {
    isOpen = !isOpen;
  }

  if (isOpen) {
    // Gate open - pass data through
    return {
      output: data,
      passed: true,
      gateState: 'open',
    };
  } else {
    // Gate closed - block data
    return {
      output: null,
      passed: false,
      gateState: 'closed',
    };
  }
};

export const GatewayNode: NodeDefinition = defineNode({
  id: 'gateway',
  name: 'Gateway',
  category: 'control_flow',
  inputs: [
    { name: 'data', type: 'any', description: 'Data to pass through when gate is open' },
    { name: 'open', type: 'boolean', description: 'Gate condition - true opens gate, false closes it' },
  ],
  outputs: [
    { name: 'output', type: 'any', description: 'Data passed through (null if gate closed)' },
    { name: 'passed', type: 'boolean', description: 'Whether data passed through the gate' },
    { name: 'gateState', type: 'string', description: '"open" or "closed"' },
  ],
  properties: {
    invertCondition: false,
  },
  propertySchemas: {
    invertCondition: {
      type: 'toggle',
      default: false,
      label: 'Invert Condition',
      description: 'When true, gate opens when condition is false (useful for shouldContinueLoop → shouldExitLoop)',
    },
  },
  description: 'Conditional pass-through gate - data only flows when condition is true (like a transistor)',
  execute,
});
