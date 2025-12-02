/**
 * Stream Writer Node
 *
 * Outputs response (terminal node)
 * Extracts response text from various input formats
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const StreamWriterNode: NodeDefinition = defineNode({
  id: 'stream_writer',
  name: 'Stream Writer',
  category: 'output',
  inputs: [
    { name: 'response', type: 'string', description: 'Response to output' },
  ],
  outputs: [
    { name: 'output', type: 'string', description: 'Output text (for chaining to chat view)' },
    { name: 'completed', type: 'boolean', description: 'Whether output completed' },
  ],
  description: 'Streams response to client (terminal node)',

  execute: async (inputs, context) => {
    // Extract response string from various input formats
    let response = '';
    if (typeof inputs[0] === 'string') {
      response = inputs[0];
    } else if (inputs[0]?.response) {
      // Handle nested response objects
      if (typeof inputs[0].response === 'string') {
        response = inputs[0].response;
      } else if (typeof inputs[0].response === 'object' && inputs[0].response?.response) {
        response = inputs[0].response.response;
      } else if (typeof inputs[0].response === 'object' && inputs[0].response?.content) {
        response = inputs[0].response.content;
      }
    } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
      response = inputs[0].content;
    } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
      response = inputs[0].cleaned;
    } else if (inputs[0]?.text && typeof inputs[0].text === 'string') {
      response = inputs[0].text;
    } else if (typeof inputs[0] === 'object' && inputs[0] !== null) {
      console.warn('[StreamWriter] Received unexpected object format:', Object.keys(inputs[0]));
      response = JSON.stringify(inputs[0]);
    }

    if (!response || response.trim().length === 0) {
      return {
        output: '',
        completed: false,
      };
    }

    console.log('[StreamWriter]', response.substring(0, 100) + (response.length > 100 ? '...' : ''));

    return {
      output: response,
      completed: true,
    };
  },
});
