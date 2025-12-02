/**
 * Agent Timer Node
 *
 * Provides timing information for scheduled agents
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, _context, properties) => {
  const intervalMs = properties?.intervalMs || 60000;

  return {
    currentTime: Date.now(),
    interval: intervalMs,
    nextRun: Date.now() + intervalMs,
  };
};

export const AgentTimerNode: NodeDefinition = defineNode({
  id: 'agent_timer',
  name: 'Agent Timer',
  category: 'agent',
  inputs: [],
  outputs: [
    { name: 'currentTime', type: 'number', description: 'Current timestamp' },
    { name: 'interval', type: 'number', description: 'Interval in milliseconds' },
    { name: 'nextRun', type: 'number', description: 'Next scheduled run timestamp' },
  ],
  properties: {
    intervalMs: 60000,
  },
  propertySchemas: {
    intervalMs: {
      type: 'number',
      default: 60000,
      label: 'Interval (ms)',
      description: 'Time between runs in milliseconds',
    },
  },
  description: 'Provides timing information for scheduled agents',
  execute,
});
