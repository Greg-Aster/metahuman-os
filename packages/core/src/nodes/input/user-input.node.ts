/**
 * User Input Node
 *
 * Unified input node - prioritizes chat interface by default,
 * can accept text/speech from connected nodes
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const UserInputNode: NodeDefinition = defineNode({
  id: 'user_input',
  name: 'User Input',
  category: 'input',
  inputs: [
    { name: 'speech', type: 'object', optional: true, description: 'Speech input from speech_to_text node' },
    { name: 'text', type: 'string', optional: true, description: 'Text input from text_input node' },
  ],
  outputs: [
    { name: 'message', type: 'string', description: 'Final user message' },
    { name: 'inputSource', type: 'string', description: 'Source of input: text, speech, or chat' },
    { name: 'sessionId', type: 'string', description: 'Current session ID' },
    { name: 'userId', type: 'string', description: 'Current user ID' },
    { name: 'timestamp', type: 'string', description: 'Input timestamp' },
  ],
  properties: {
    message: '',
    prioritizeChatInterface: true,
  },
  propertySchemas: {
    message: {
      type: 'string',
      default: '',
      label: 'Default Message',
      description: 'Default message if no input received',
      placeholder: 'Enter default message...',
    },
    prioritizeChatInterface: {
      type: 'boolean',
      default: true,
      label: 'Prioritize Chat Interface',
      description: 'When enabled, always uses chat interface input over connected nodes',
    },
  },
  description: 'Unified input node - prioritizes chat interface by default, can accept text/speech from connected nodes',

  execute: async (inputs, context, properties) => {
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
      inputSource,
      sessionId: context.sessionId || `session-${Date.now()}`,
      userId: context.userId || 'anonymous',
      timestamp: new Date().toISOString(),
    };
  },
});
