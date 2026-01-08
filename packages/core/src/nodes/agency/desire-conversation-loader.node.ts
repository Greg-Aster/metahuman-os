/**
 * Desire Conversation Loader Node
 *
 * Loads conversation messages from the buffer that are tagged with a specific desire ID.
 * This gathers all user discussion from the questioning phase to inform planning.
 *
 * Inputs:
 *   - desire: Desire object (to get the ID)
 *
 * Outputs:
 *   - conversation: Formatted string of conversation
 *   - messages: Array of raw messages
 *   - messageCount: Number of messages found
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire } from '../../agency/types.js';
import fs from 'node:fs';
import path from 'node:path';

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  meta?: {
    replyToDesireId?: string;
    replyToDesireTitle?: string;
    replyToContent?: string;
    [key: string]: unknown;
  };
  timestamp?: number;
}

interface ConversationBuffer {
  messages: ConversationMessage[];
  summaryMarkers?: ConversationMessage[];
  lastSummarizedIndex?: number | null;
  lastUpdated?: string;
}

/**
 * Format conversation messages into a readable string for the LLM
 */
function formatConversation(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return 'No conversation recorded during questioning phase.';
  }

  const formatted = messages.map((msg, i) => {
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp).toLocaleString()
      : 'unknown time';
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    return `[${i + 1}] ${role} (${timestamp}):\n${msg.content}`;
  });

  return formatted.join('\n\n---\n\n');
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const username = context.username as string | undefined;

  // Get desire from inputs (slot_0 from desire_loader output)
  const loaderOutput = (inputs.slot_0 || inputs[0]) as { desire?: Desire; found?: boolean } | Desire | undefined;

  // Handle both direct desire and loader output format
  const desire = (loaderOutput as { desire?: Desire })?.desire || (loaderOutput as Desire);

  if (!desire?.id) {
    console.log('[desire-conversation-loader] No desire provided');
    return {
      conversation: '',
      messages: [],
      messageCount: 0,
      error: 'No desire provided',
    };
  }

  const desireId = desire.id;
  console.log(`[desire-conversation-loader] Loading conversation for desire: ${desireId}`);

  if (!username) {
    console.log('[desire-conversation-loader] No username in context');
    return {
      conversation: '',
      messages: [],
      messageCount: 0,
      error: 'No username in context',
    };
  }

  try {
    // Load the conversation buffer
    const { getProfilePaths } = await import('../../paths.js');
    const profilePaths = getProfilePaths(username);
    const bufferPath = path.join(profilePaths.state, 'conversation-buffer-conversation.json');

    if (!fs.existsSync(bufferPath)) {
      console.log('[desire-conversation-loader] Conversation buffer not found');
      return {
        conversation: 'No conversation buffer found.',
        messages: [],
        messageCount: 0,
      };
    }

    const raw = fs.readFileSync(bufferPath, 'utf-8');
    const buffer: ConversationBuffer = JSON.parse(raw);

    if (!buffer.messages || !Array.isArray(buffer.messages)) {
      console.log('[desire-conversation-loader] No messages in buffer');
      return {
        conversation: 'No messages in conversation buffer.',
        messages: [],
        messageCount: 0,
      };
    }

    // Filter messages that are tagged with this desire ID
    const desireMessages = buffer.messages.filter((msg) => {
      return msg.meta?.replyToDesireId === desireId;
    });

    // Also include assistant responses that immediately follow user messages about this desire
    const enrichedMessages: ConversationMessage[] = [];
    for (let i = 0; i < buffer.messages.length; i++) {
      const msg = buffer.messages[i];

      // Include messages directly tagged with the desire
      if (msg.meta?.replyToDesireId === desireId) {
        enrichedMessages.push(msg);

        // Also include the next message if it's an assistant response
        const nextMsg = buffer.messages[i + 1];
        if (nextMsg && nextMsg.role === 'assistant' && !nextMsg.meta?.replyToDesireId) {
          // Check if it's not already tagged (to avoid duplicates)
          enrichedMessages.push(nextMsg);
        }
      }
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const uniqueMessages = enrichedMessages.filter((msg) => {
      const key = `${msg.role}:${msg.content}:${msg.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by timestamp
    uniqueMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const formatted = formatConversation(uniqueMessages);

    console.log(`[desire-conversation-loader] Found ${uniqueMessages.length} messages for desire ${desireId}`);

    return {
      conversation: formatted,
      messages: uniqueMessages,
      messageCount: uniqueMessages.length,
    };
  } catch (error) {
    console.error('[desire-conversation-loader] Error loading conversation:', error);
    return {
      conversation: '',
      messages: [],
      messageCount: 0,
      error: (error as Error).message,
    };
  }
};

export const DesireConversationLoaderNode: NodeDefinition = defineNode({
  id: 'desire_conversation_loader',
  name: 'Load Desire Conversation',
  category: 'agency',
  description: 'Loads conversation messages from the questioning phase for a desire',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire object (or loader output with desire)' },
  ],
  outputs: [
    { name: 'conversation', type: 'string', description: 'Formatted conversation text' },
    { name: 'messages', type: 'array', description: 'Raw conversation messages' },
    { name: 'messageCount', type: 'number', description: 'Number of messages found' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {},
  propertySchemas: {},
  execute,
});

export default DesireConversationLoaderNode;
