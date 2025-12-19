/**
 * Text Input Node
 *
 * Provides text input for flow graphs.
 * In flow editor: uses the node's message property (editable textarea)
 * In chat: falls back to context.userMessage
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const TextInputNode: NodeDefinition = defineNode({
  id: 'text_input',
  name: 'Text Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'text', type: 'string', description: 'Text input from user' },
    { name: 'hasTextInput', type: 'boolean', description: 'Whether text input is available' },
  ],
  properties: {
    message: '',
  },
  propertySchemas: {
    message: {
      type: 'string',
      default: '',
      label: 'Message',
      description: 'Text to output (editable in flow editor)',
      placeholder: 'Enter text...',
      multiline: true,
    },
  },
  description: 'Text input node - editable in flow editor, outputs to connected nodes',

  execute: async (inputs, context, properties) => {
    // Priority: node property > context.userMessage (allows flow editor override)
    const text = properties?.message || context.userMessage || '';
    const hasTextInput = !!text;

    return {
      text,
      hasTextInput,
    };
  },
});
