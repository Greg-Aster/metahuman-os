/**
 * Chain of Thought Stripper Node
 * Removes internal reasoning markers from LLM output
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response) {
    if (typeof inputs[0].response === 'string') {
      response = inputs[0].response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.response) {
      response = inputs[0].response.response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.content) {
      response = inputs[0].response.content;
    }
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  }

  // Remove common CoT markers
  let cleaned = response
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/^Thought:.*$/gm, '')
    .replace(/^Action:.*$/gm, '')
    .replace(/^Observation:.*$/gm, '')
    .replace(/^Final Answer:\s*/i, '')
    .replace(/<\|assistant\|>:?\s*/gi, '')
    .replace(/<\|user\|>:?\s*/gi, '')
    .replace(/<\|system\|>:?\s*/gi, '')
    .trim();

  return {
    cleaned,
    response: cleaned,
  };
};

export const ChainOfThoughtStripperNode: NodeDefinition = defineNode({
  id: 'chain_of_thought_stripper',
  name: 'Chain of Thought Stripper',
  category: 'safety',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response to clean' },
  ],
  outputs: [
    { name: 'cleaned', type: 'string', description: 'Cleaned response' },
    { name: 'response', type: 'string' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Removes internal reasoning markers from LLM output',
  execute,
});
