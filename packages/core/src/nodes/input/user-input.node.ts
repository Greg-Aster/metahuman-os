/**
 * User Input Node
 *
 * Unified input node - prioritizes chat interface by default,
 * can accept text/speech from connected nodes
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { ConversationBufferNode, prepareConversationEntries } from '../output/conversation-buffer.node.js';
import { MemoryCaptureNode } from '../output/memory-capture.node.js';

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
    { name: 'entry', type: 'message', optional: true, description: 'Preserved or recorded conversation entry' },
    { name: 'entries', type: 'array', description: 'Conversation entries prepared for selected storage destinations' },
    { name: 'bufferSaved', type: 'boolean', description: 'Whether conversation buffer admission completed' },
    { name: 'memorySaved', type: 'boolean', description: 'Whether long-term memory saving completed' },
    { name: 'inputSource', type: 'string', description: 'Source of input: text, speech, or chat' },
    { name: 'instructionSource', type: 'string', description: 'Instruction provenance: user' },
    { name: 'sessionId', type: 'string', description: 'Current session ID' },
    { name: 'userId', type: 'string', description: 'Current user ID' },
    { name: 'timestamp', type: 'string', description: 'Input timestamp' },
  ],
  properties: {
    message: '',
    prioritizeChatInterface: true,
    saveToBuffer: false,
    saveToLongTermMemory: false,
  },
  propertySchemas: {
    saveToBuffer: {
      type: 'boolean', default: false, label: 'Save to Conversation Buffer',
      description: 'Record the current input in the rolling conversation buffer before forwarding it',
    },
    saveToLongTermMemory: {
      type: 'boolean', default: false, label: 'Save to Long-Term Memory',
      description: 'Save the current input as a conversation memory when profile memory writes are enabled',
    },
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
      // Priority when prioritizing chat interface:
      // 1. Chat interface (context.userMessage) - main chat sends messages here
      // 2. Connected text input (inputs.text) - flow editor text_input node
      // 3. Speech input (inputs.speech) - from speech_to_text node
      // 4. Node property fallback (properties.message)

      if (context.userMessage) {
        message = context.userMessage;
        inputSource = 'chat';
      } else if (inputs.text) {
        // From connected text_input node in flow editor
        message = inputs.text;
        inputSource = 'text';
      } else if (inputs.speech?.text && inputs.speech?.transcribed) {
        message = inputs.speech.text;
        inputSource = 'speech';
      } else {
        message = properties?.message || '';
        inputSource = 'chat';
      }
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
        // Final fallback to node property
        message = properties?.message || '';
        inputSource = 'chat';
      }
    }

    // An internal handoff retains the original admission. Connected text/speech
    // or a newly supplied message must not inherit a previous message's identity.
    const entry = inputSource === 'chat' && message === context.userMessage
      && context.userMessageEntry?.content === message ? context.userMessageEntry : undefined;

    const storageInputs = { userMessage: message, entry };
    const admission = properties?.saveToBuffer === true
      ? await ConversationBufferNode.execute(storageInputs, context, {})
      : null;
    const entries = admission?.entries ?? (properties?.saveToLongTermMemory === true
      ? prepareConversationEntries(storageInputs, context) : []);
    const memory = properties?.saveToLongTermMemory === true
      ? await MemoryCaptureNode.execute({ entries }, context, {})
      : null;

    return {
      message,
      entry: admission?.entry ?? entries.at(-1) ?? entry,
      entries,
      bufferSaved: admission?.persisted === true,
      memorySaved: memory?.saved === true,
      inputSource,
      instructionSource: 'user',
      sessionId: context.sessionId || `session-${Date.now()}`,
      userId: context.userId || 'anonymous',
      timestamp: new Date().toISOString(),
    };
  },
});
