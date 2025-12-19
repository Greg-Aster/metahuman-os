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
    { name: 'displayTrigger', type: 'any', description: 'Trigger for display_buffer node' },
  ],
  description: 'Streams response to client (terminal node)',

  execute: async (inputs, _context) => {
    // Named inputs with array fallback
    const inputData = inputs.response ?? inputs[0];

    console.log(`[StreamWriter] Input keys: ${Object.keys(inputs).join(',')}`);
    console.log(`[StreamWriter] inputData type: ${typeof inputData}`);
    console.log(`[StreamWriter] inputData keys: ${typeof inputData === 'object' && inputData ? Object.keys(inputData).join(',') : 'N/A'}`);
    if (typeof inputData === 'string') {
      console.log(`[StreamWriter] inputData (first 100): "${inputData.substring(0, 100)}..."`);
    }

    // Early exit if input is null (e.g., from closed gateway)
    if (inputData === null || inputData === undefined) {
      console.log('[StreamWriter] Received null input - gate may be closed, skipping');
      return {
        output: '',
        completed: false,
        skipped: true,
      };
    }

    // Extract response string from various input formats
    let response = '';
    if (typeof inputData === 'string') {
      response = inputData;
    } else if (inputData?.response) {
      // Handle nested response objects
      if (typeof inputData.response === 'string') {
        response = inputData.response;
      } else if (typeof inputData.response === 'object' && inputData.response?.response) {
        response = inputData.response.response;
      } else if (typeof inputData.response === 'object' && inputData.response?.content) {
        response = inputData.response.content;
      }
    } else if (inputData?.content && typeof inputData.content === 'string') {
      response = inputData.content;
    } else if (inputData?.cleaned && typeof inputData.cleaned === 'string') {
      response = inputData.cleaned;
    } else if (inputData?.text && typeof inputData.text === 'string') {
      response = inputData.text;
    } else if (typeof inputData === 'object' && inputData !== null) {
      console.warn('[StreamWriter] Received unexpected object format:', Object.keys(inputData));
      response = JSON.stringify(inputData);
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
      response: response, // Alias for handler compatibility
      completed: true,
      displayTrigger: { output: response, completed: true }, // Trigger for display_buffer node
    };
  },
});
