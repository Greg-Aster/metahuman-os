/**
 * Scratchpad Context Node
 *
 * Context node that loads recent activity from the Active Operator scratchpad
 * to prevent repetition and inform decisions.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getScratchpadContext, loadScratchpad } from '../../active-operator/state-persister.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const maxEntries = properties?.maxEntries || 10;

  // Get formatted context string (last N entries)
  const recentActivity = getScratchpadContext(maxEntries);

  // Also load the full scratchpad for more detailed access
  const scratchpad = loadScratchpad();
  const lastDecision = scratchpad.lastDecision || null;

  console.log(`[ScratchpadContext] Loaded ${maxEntries} recent entries, lastDecision: ${lastDecision?.task || 'none'}`);

  return {
    recentActivity,
    lastDecision,
    entries: scratchpad.entries?.slice(-maxEntries) || [],
  };
};

export const ScratchpadContextNode: NodeDefinition = defineNode({
  id: 'scratchpad_context',
  name: 'Recent Activity',
  category: 'active-operator',
  inputs: [],
  outputs: [
    { name: 'recentActivity', type: 'string', description: 'Recent activity from scratchpad (last N entries)' },
    { name: 'lastDecision', type: 'object', description: 'Most recent decision made' },
    { name: 'entries', type: 'array', description: 'Raw scratchpad entries' },
  ],
  properties: {
    maxEntries: 10,
  },
  propertySchemas: {
    maxEntries: {
      type: 'slider',
      default: 10,
      label: 'Max Entries',
      min: 5,
      max: 20,
      step: 1,
    },
  },
  description: 'Loads recent activity context to prevent repetition',
  execute,
});
