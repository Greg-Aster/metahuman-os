/**
 * Scratchpad Formatter Node
 *
 * Formats scratchpad for display or LLM consumption
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context) => {
  // Unwrap routedData if present (from conditional_router)
  let inputData = inputs[0];
  if (inputData?.routedData) {
    console.log(`[ScratchpadFormatter] Unwrapping routedData from conditional_router`);
    inputData = inputData.routedData;
  }

  const scratchpad = inputData?.scratchpad || [];
  const format = context.format || 'text';

  console.log(`[ScratchpadFormatter] Formatting ${scratchpad.length} scratchpad entries`);
  if (scratchpad.length === 0) {
    console.warn(`[ScratchpadFormatter] ⚠️  Empty scratchpad received!`);
  }

  if (format === 'json') {
    return {
      formatted: JSON.stringify(scratchpad, null, 2),
      entries: scratchpad.length,
      scratchpad,
    };
  }

  if (format === 'markdown') {
    const formatted = scratchpad
      .map((entry: any, idx: number) => {
        return `### Iteration ${idx + 1}\n\n**Thought:** ${entry.thought}\n\n**Action:** ${entry.action}\n\n**Observation:** ${entry.observation}\n`;
      })
      .join('\n---\n\n');
    return {
      formatted,
      entries: scratchpad.length,
      scratchpad,
    };
  }

  // Default: text format
  const formatted = scratchpad
    .map((entry: any) => `Thought: ${entry.thought}\nAction: ${entry.action}\nObservation: ${entry.observation}`)
    .join('\n\n');

  return {
    formatted,
    entries: scratchpad.length,
    scratchpad,
  };
};

export const ScratchpadFormatterNode: NodeDefinition = defineNode({
  id: 'scratchpad_formatter',
  name: 'Scratchpad Formatter',
  category: 'operator',
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Scratchpad to format' },
  ],
  outputs: [
    { name: 'formatted', type: 'string', description: 'Formatted scratchpad text' },
  ],
  properties: {
    format: 'text',
  },
  propertySchemas: {
    format: {
      type: 'select',
      default: 'text',
      label: 'Format',
      description: 'Output format',
      options: ['text', 'json', 'markdown'],
    },
  },
  description: 'Formats scratchpad for display or LLM consumption',
  execute,
});
