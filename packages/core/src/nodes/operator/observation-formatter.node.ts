/**
 * Observation Formatter Node
 *
 * Formats skill execution results for the scratchpad
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { formatObservation } from '../../operator/observation-formatter.js';

const execute: NodeExecutor = async (inputs) => {
  if (!inputs || Object.keys(inputs).length === 0) {
    return {};
  }

  const skillResult = inputs[0] || {};

  // Use shared formatter for consistent observation formatting
  const observation = `Observation: ${formatObservation(skillResult)}`;

  return {
    observation,
    scratchpad: [...(inputs[1] || []), { observation }],
  };
};

export const ObservationFormatterNode: NodeDefinition = defineNode({
  id: 'observation_formatter',
  name: 'Observation Formatter',
  category: 'operator',
  inputs: [
    { name: 'result', type: 'skill_result' },
    { name: 'mode', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'observation', type: 'string', description: 'Formatted observation text' },
  ],
  properties: {
    mode: 'narrative',
  },
  propertySchemas: {
    mode: {
      type: 'select',
      default: 'narrative',
      label: 'Format Mode',
      description: 'How to format observation',
      options: ['narrative', 'structured', 'verbatim'],
    },
  },
  description: 'Formats skill results for LLM',
  execute,
});
