/**
 * Plan Parser Node
 *
 * Parses ReAct-style planning output into structured components
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const format = properties?.format || 'react';
  const planText = inputs[0]?.plan || inputs[0] || '';

  try {
    if (format === 'react') {
      // Parse ReAct format: "Thought: ... Action: ... Action Input: ..."
      const thoughtMatch = planText.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action|Final Answer):|$)/i);
      const actionMatch = planText.match(/Action:\s*(\w+)/i);
      const actionInputMatch = planText.match(/Action Input:\s*({[\s\S]*?}|\S+)/i);
      const finalAnswerMatch = planText.match(/Final Answer:\s*([\s\S]*)/i);

      return {
        thought: thoughtMatch?.[1]?.trim() || '',
        action: actionMatch?.[1]?.trim() || null,
        actionInput: actionInputMatch?.[1]?.trim() || '{}',
        respond: finalAnswerMatch?.[1]?.trim() || null,
        parsed: true,
        format: 'react',
      };
    } else if (format === 'json') {
      // Parse JSON format
      const parsed = JSON.parse(planText);
      return {
        ...parsed,
        parsed: true,
        format: 'json',
      };
    } else {
      // Freeform - just return as-is
      return {
        text: planText,
        parsed: true,
        format: 'freeform',
      };
    }
  } catch (error) {
    console.error('[PlanParser] Error:', error);
    return {
      thought: '',
      action: null,
      respond: null,
      parsed: false,
      error: (error as Error).message,
    };
  }
};

export const PlanParserNode: NodeDefinition = defineNode({
  id: 'plan_parser',
  name: 'Plan Parser',
  category: 'operator',
  inputs: [
    { name: 'plan', type: 'string', description: 'ReAct-style planning text' },
  ],
  outputs: [
    { name: 'thought', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'actionInput', type: 'string' },
    { name: 'respond', type: 'string', description: 'Final answer if present' },
    { name: 'parsed', type: 'boolean' },
  ],
  properties: {
    format: 'react',
  },
  propertySchemas: {
    format: {
      type: 'select',
      default: 'react',
      label: 'Format',
      description: 'Plan format to parse',
      options: ['react', 'json', 'freeform'],
    },
  },
  description: 'Parses ReAct-style planning output into structured components',
  execute,
});
