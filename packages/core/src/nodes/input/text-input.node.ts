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
    inputKey: '',
  },
  propertySchemas: {
    message: {
      type: 'text_multiline',
      default: '',
      label: 'Message',
      description: 'Text to output (editable in flow editor)',
      placeholder: 'Enter text...',
      rows: 18,
    },
    inputKey: {
      type: 'text',
      default: '',
      label: 'Runtime Input Key',
      description: 'Optional execution-context field to read before the editable fallback message.',
      placeholder: 'For example: environmentTaskInstruction',
    },
  },
  description: 'Outputs a named runtime text value, an editable fallback message, or the current user message.',

  execute: async (inputs, context, properties) => {
    const inputKey = typeof properties?.inputKey === 'string'
      ? properties.inputKey.trim()
      : '';
    const runtimeText = inputKey && typeof context[inputKey] === 'string'
      ? context[inputKey].trim()
      : '';
    const text = runtimeText || properties?.message || context.userMessage || '';
    const hasTextInput = !!text;

    return {
      text,
      hasTextInput,
    };
  },
});
