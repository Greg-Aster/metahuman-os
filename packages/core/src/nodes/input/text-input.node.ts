/**
 * Text Input Node
 *
 * Gateway to chat interface text input - reads from context.userMessage
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
    defaultText: '',
  },
  propertySchemas: {
    defaultText: {
      type: 'string',
      default: '',
      label: 'Default Text',
      description: 'Default text to use if no input provided',
      placeholder: 'Enter default text...',
    },
  },
  description: 'Gateway to chat interface text input - reads from context.userMessage',

  execute: async (inputs, context, properties) => {
    const text = context.userMessage || properties?.defaultText || '';
    const hasTextInput = !!text;

    return {
      text,
      hasTextInput,
    };
  },
});
