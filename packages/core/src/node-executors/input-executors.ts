/**
 * Input Node Executors
 * Handles user input from various sources (text, mic, speech-to-text)
 */

import { transcribeAudio } from '../stt.js';
import { audit } from '../audit.js';
import type { NodeExecutor } from './types.js';

/**
 * Text Input Node
 * Gateway to chat interface text input - reads from context.userMessage
 */
export const textInputExecutor: NodeExecutor = async (inputs, context, properties) => {
  const text = context.userMessage || '';
  const hasTextInput = !!text;

  return {
    text,
    hasTextInput,
  };
};

/**
 * Mic Input Node
 * Captures audio input from microphone (client-side, provides audio buffer)
 */
export const micInputExecutor: NodeExecutor = async (inputs, context, properties) => {
  const audioBuffer = context.audioBuffer || properties?.audioBuffer;
  const audioFormat = context.audioFormat || properties?.audioFormat || 'wav';

  return {
    audioBuffer,
    audioFormat,
    hasMicInput: !!audioBuffer,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Speech to Text Node
 * Transcribes audio buffer to text using Whisper
 */
export const speechToTextExecutor: NodeExecutor = async (inputs, context, properties) => {
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
};

/**
 * User Input Node
 * Unified input node - prioritizes chat interface by default, can accept text/speech from nodes
 * Has a "prioritizeChatInterface" property to control behavior
 */
export const userInputExecutor: NodeExecutor = async (inputs, context, properties) => {
  let message = '';
  let inputSource = 'chat';

  // Check the prioritizeChatInterface property (default: true)
  const prioritizeChatInterface = properties?.prioritizeChatInterface !== false;

  if (prioritizeChatInterface) {
    // Priority: chat interface (context.userMessage)
    message = context.userMessage || properties?.message || '';
    inputSource = 'chat';
  } else {
    // Priority order when NOT prioritizing chat interface:
    // 1. Speech input from speech_to_text node (inputs.speech)
    // 2. Text input from text_input node (inputs.text)
    // 3. Fallback to context.userMessage
    // 4. Final fallback to properties.message

    if (inputs.speech?.text && inputs.speech?.transcribed) {
      // From speech_to_text node
      message = inputs.speech.text;
      inputSource = 'speech';
    } else if (inputs.text) {
      // From text_input node
      message = inputs.text;
      inputSource = 'text';
    } else if (context.userMessage) {
      // Fallback to chat interface
      message = context.userMessage;
      inputSource = 'chat';
    } else {
      // Final fallback to properties
      message = properties?.message || '';
      inputSource = 'chat';
    }
  }

  return {
    message,
    inputSource, // 'text', 'speech', or 'chat'
    sessionId: context.sessionId || `session-${Date.now()}`,
    userId: context.userId || 'anonymous',
    timestamp: new Date().toISOString(),
  };
};
