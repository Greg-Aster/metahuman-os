/**
 * Mic Input Node
 *
 * Captures audio input from microphone (client-side, provides audio buffer)
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const MicInputNode: NodeDefinition = defineNode({
  id: 'mic_input',
  name: 'Mic Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'audioBuffer', type: 'object', description: 'Raw audio buffer from microphone' },
    { name: 'audioFormat', type: 'string', description: 'Audio format (wav/webm/mp3)' },
    { name: 'hasMicInput', type: 'boolean', description: 'Whether mic input is available' },
  ],
  properties: {
    audioFormat: 'wav',
  },
  propertySchemas: {
    audioFormat: {
      type: 'select',
      default: 'wav',
      label: 'Audio Format',
      description: 'Output audio format',
      options: ['wav', 'webm', 'mp3'],
    },
  },
  description: 'Captures audio input from microphone for speech recognition',

  execute: async (inputs, context, properties) => {
    const audioBuffer = context.audioBuffer || properties?.audioBuffer;
    const audioFormat = context.audioFormat || properties?.audioFormat || 'wav';

    return {
      audioBuffer,
      audioFormat,
      hasMicInput: !!audioBuffer,
      timestamp: new Date().toISOString(),
    };
  },
});
