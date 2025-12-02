/**
 * Speech to Text Node
 *
 * Transcribes audio buffer to text using Whisper STT
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { transcribeAudio } from '../../stt.js';
import { audit } from '../../audit.js';

export const SpeechToTextNode: NodeDefinition = defineNode({
  id: 'speech_to_text',
  name: 'Speech to Text',
  category: 'input',
  inputs: [
    { name: 'audioBuffer', type: 'object', description: 'Audio buffer to transcribe' },
  ],
  outputs: [
    { name: 'text', type: 'string', description: 'Transcribed text from speech' },
    { name: 'transcribed', type: 'boolean', description: 'Whether transcription succeeded' },
    { name: 'audioFormat', type: 'string', description: 'Audio format used' },
  ],
  properties: {
    audioFormat: 'wav',
  },
  propertySchemas: {
    audioFormat: {
      type: 'select',
      default: 'wav',
      label: 'Audio Format',
      description: 'Input audio format',
      options: ['wav', 'webm', 'mp3'],
    },
  },
  description: 'Converts speech audio to text using Whisper STT',

  execute: async (inputs, context, properties) => {
    const audioBuffer = inputs[0]?.audioBuffer || context.audioBuffer;
    const audioFormat = inputs[0]?.audioFormat || context.audioFormat || properties?.audioFormat || 'wav';

    if (!audioBuffer) {
      return {
        text: '',
        transcribed: false,
        error: 'No audio buffer provided',
      };
    }

    try {
      const text = await transcribeAudio(audioBuffer, audioFormat as 'wav' | 'webm' | 'mp3');

      audit({
        level: 'info',
        category: 'system',
        event: 'speech_transcribed',
        details: {
          textLength: text.length,
          audioFormat,
        },
      });

      return {
        text,
        transcribed: true,
        audioFormat,
      };
    } catch (error) {
      console.error('[SpeechToText] Error:', error);
      return {
        text: '',
        transcribed: false,
        error: (error as Error).message,
      };
    }
  },
});
