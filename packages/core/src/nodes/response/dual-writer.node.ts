/**
 * Dual Writer Node
 *
 * Writes output to TWO places:
 * 1. Conversation Buffer - for display in chat interface
 * 2. Response Buffer - for multi-turn context tracking
 * 3. Memory Capture - as 'card_response' type for training
 *
 * This separation allows:
 * - Chat display (conversation buffer)
 * - Rolling context for follow-up messages (response buffer)
 * - Separate training data bucket (card_response memory type)
 *
 * Inputs:
 *   - response: LLM response text
 *   - responseBuffer: Response buffer to update
 *   - userId: User ID
 *   - cardType: Card type for memory metadata
 *   - actionTaken: Description of action taken
 *   - message: Original user message
 *   - desire: Desire object (for metadata)
 *
 * Outputs:
 *   - responseBufferId: ID of the response buffer
 *   - conversationBufferUpdated: Whether conversation buffer was updated
 *   - memorySaved: Whether memory was saved
 */

import { defineNode, type NodeDefinition } from '../types.js';
import {
  appendToResponseBuffer,
  touchResponseBufferNotification,
  type ResponseBuffer,
} from '../../response-buffer.js';
import { appendToUserBuffer } from '../../conversation-buffer.js';
import { captureEvent } from '../../memory.js';
import type { Desire } from '../../agency/types.js';

interface DualWriterInput {
  response?: string;
  responseBuffer?: ResponseBuffer;
  userId?: string;
  cardType?: string;
  actionTaken?: string;
  message?: string;
  desire?: Desire;
}

export const DualWriterNode: NodeDefinition = defineNode({
  id: 'dual_writer',
  name: 'Dual Writer',
  category: 'output',
  inputs: [
    { name: 'response', type: 'string', description: 'LLM response text' },
    { name: 'responseBuffer', type: 'object', description: 'Response buffer' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'cardType', type: 'string', description: 'Card type' },
    { name: 'actionTaken', type: 'string', description: 'Action taken' },
    { name: 'message', type: 'string', description: 'Original user message' },
    { name: 'desire', type: 'object', optional: true, description: 'Desire object' },
  ],
  outputs: [
    { name: 'responseBufferId', type: 'string', description: 'Response buffer ID' },
    { name: 'conversationBufferUpdated', type: 'boolean', description: 'Conv buffer updated' },
    { name: 'memorySaved', type: 'boolean', description: 'Memory was saved' },
    { name: 'response', type: 'string', description: 'Pass-through response' },
  ],
  properties: {
    saveMemory: true,
    memoryMode: 'conversation',
  },
  propertySchemas: {
    saveMemory: {
      type: 'boolean',
      default: true,
      label: 'Save Memory',
      description: 'Whether to save the response as a card_response memory',
    },
    memoryMode: {
      type: 'select',
      default: 'conversation',
      options: ['conversation', 'inner'],
      label: 'Memory Mode',
      description: 'Which conversation buffer mode to use',
    },
  },
  description: 'Writes to conversation buffer, response buffer, and memory capture.',

  execute: async (inputs, context, properties) => {
    const slot0 = inputs[0] as DualWriterInput | undefined;

    const response = slot0?.response || '';
    const responseBuffer = slot0?.responseBuffer;
    const userId = slot0?.userId || context.userId || 'anonymous';
    const cardType = slot0?.cardType || context.cardType || 'unknown';
    const actionTaken = slot0?.actionTaken || '';
    const message = slot0?.message || context.userMessage || '';
    const desire = slot0?.desire;

    const saveMemory = properties?.saveMemory !== false;
    const memoryMode = (properties?.memoryMode as 'conversation' | 'inner') || 'conversation';

    let conversationBufferUpdated = false;
    let memorySaved = false;
    let responseBufferId = responseBuffer?.id || '';

    console.log(`[dual-writer] Writing response to buffers for ${cardType}`);

    // 1. Update Response Buffer (for multi-turn tracking)
    if (responseBuffer) {
      // First save the user message
      appendToResponseBuffer(userId, responseBuffer.id, 'user', message);

      // Then save the assistant response with action
      appendToResponseBuffer(userId, responseBuffer.id, 'assistant', response, actionTaken);

      responseBufferId = responseBuffer.id;
      console.log(`[dual-writer] Updated response buffer: ${responseBufferId}`);
    }

    // 2. Update Conversation Buffer (for chat display)
    try {
      // Append user message
      await appendToUserBuffer(
        userId,
        memoryMode,
        {
          role: 'user',
          content: message,
          meta: {
            source: 'response_pipeline',
            cardType,
            responseBufferId,
            desireId: desire?.id,
          },
        }
      );

      // Append assistant response
      await appendToUserBuffer(
        userId,
        memoryMode,
        {
          role: 'assistant',
          content: response,
          meta: {
            source: 'response_pipeline',
            cardType,
            responseBufferId,
            desireId: desire?.id,
            actionTaken,
            dialogueSource: 'response-pipeline',
            displayColor: '#8b5cf6', // Purple for response pipeline
          },
        }
      );

      conversationBufferUpdated = true;
      console.log(`[dual-writer] Updated conversation buffer (${memoryMode} mode)`);
    } catch (err) {
      console.error('[dual-writer] Failed to update conversation buffer:', err);
    }

    // 3. Save to Memory (as card_response type for training)
    // Note: captureEvent uses the current user context, so ensure context is set
    if (saveMemory && userId !== 'anonymous') {
      try {
        // Save the exchange as a card_response memory
        captureEvent(
          `Card Response (${cardType}): ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`,
          {
            type: 'card_response', // NEW: Distinct type for LoRA training
            tags: ['response-pipeline', cardType, 'card-interaction'],
            metadata: {
              // Note: cognitiveMode is restricted to 'dual'|'agent'|'emulation'
              // Use responseSource to identify response pipeline for training separation
              responseSource: 'response_pipeline',
              cardType,
              responseBufferId,
              desireId: desire?.id,
              desireTitle: desire?.title,
              userMessage: message,
              assistantResponse: response,
              actionTaken,
              source: 'response_pipeline',
              userId, // Include userId in metadata for context
            },
          }
        );

        memorySaved = true;
        console.log(`[dual-writer] Saved card_response memory`);
      } catch (err) {
        console.error('[dual-writer] Failed to save memory:', err);
      }
    }

    // Touch notification for SSE updates
    if (responseBufferId) {
      touchResponseBufferNotification(userId, responseBufferId);
    }

    return {
      responseBufferId,
      conversationBufferUpdated,
      memorySaved,
      response,
    };
  },
});

export default DualWriterNode;
