/**
 * TTS Node
 *
 * Triggers text-to-speech playback
 * Note: Actual audio playback happens in browser via visual node implementation
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { audit } from '../../audit.js';

export const TTSNode: NodeDefinition = defineNode({
  id: 'tts',
  name: 'Text to Speech',
  category: 'output',
  inputs: [
    { name: 'text', type: 'string', description: 'Text to speak' },
  ],
  outputs: [
    { name: 'played', type: 'boolean', description: 'Whether TTS was triggered' },
    { name: 'text', type: 'string', description: 'Text that was spoken' },
  ],
  properties: {
    provider: '',
    autoPlay: true,
  },
  propertySchemas: {
    provider: {
      type: 'string',
      default: '',
      label: 'Provider',
      description: 'TTS provider (empty = use default)',
      placeholder: 'Leave empty for default',
    },
    autoPlay: {
      type: 'boolean',
      default: true,
      label: 'Auto Play',
      description: 'Automatically play audio when text is received',
    },
  },
  description: 'Converts text to speech using the main interface TTS system',

  execute: async (inputs, context, properties) => {
    const text = inputs.text || inputs[0];

    if (!text || typeof text !== 'string') {
      return {
        played: false,
        error: 'No text provided',
      };
    }

    // Server-side execution just logs - browser handles actual playback
    audit({
      level: 'info',
      category: 'action',
      event: 'tts_triggered',
      details: {
        textLength: text.length,
        provider: properties?.provider || 'default',
        autoPlay: properties?.autoPlay !== false,
      },
      actor: 'system',
    });

    return {
      played: true,
      text,
      provider: properties?.provider || 'default',
    };
  },
});
