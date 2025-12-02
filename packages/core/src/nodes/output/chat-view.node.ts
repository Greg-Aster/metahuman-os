/**
 * Chat View Node
 *
 * Displays chat messages visually in the node editor
 * Supports direct message input or triggered refresh from conversation history
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ChatViewNode: NodeDefinition = defineNode({
  id: 'chat_view',
  name: 'Chat View',
  category: 'output',
  inputs: [
    { name: 'message', type: 'string', optional: true, description: 'Direct message to display' },
    { name: 'trigger', type: 'any', optional: true, description: 'Trigger to refresh from conversation' },
  ],
  outputs: [
    { name: 'displayed', type: 'boolean', description: 'Whether message was displayed' },
    { name: 'message', type: 'string', description: 'Displayed message content' },
  ],
  properties: {
    mode: 'direct',
    maxMessages: 5,
  },
  propertySchemas: {
    mode: {
      type: 'select',
      default: 'direct',
      label: 'Mode',
      description: 'Display mode - direct input or triggered refresh',
      options: ['direct', 'trigger'],
    },
    maxMessages: {
      type: 'slider',
      default: 5,
      label: 'Max Messages',
      description: 'Maximum messages to display in trigger mode',
      min: 1,
      max: 20,
      step: 1,
    },
  },
  description: 'Displays chat messages visually - direct input or triggered refresh from conversation history',

  execute: async (inputs, context, properties) => {
    const mode = properties?.mode || 'direct';
    const directMessage = inputs.message || inputs[0];
    const trigger = inputs.trigger || inputs[1];

    if (mode === 'direct' && directMessage) {
      return {
        displayed: true,
        message: directMessage,
        mode: 'direct',
      };
    } else if (mode === 'trigger' && trigger) {
      const conversationHistory = context.conversationHistory || [];
      const maxMessages = properties?.maxMessages || 5;
      const recentMessages = conversationHistory.slice(-maxMessages);

      const formattedMessages = recentMessages
        .map((msg: any) => `${msg.role}: ${msg.content}`)
        .join('\n\n');

      return {
        displayed: true,
        message: formattedMessages,
        messageCount: recentMessages.length,
        mode: 'trigger',
      };
    }

    return {
      displayed: false,
      message: '',
      mode,
    };
  },
});
