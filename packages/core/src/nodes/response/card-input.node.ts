/**
 * Card Input Node
 *
 * Entry point for the response pipeline.
 * Receives card data and user message, sets up the context for the response graph.
 *
 * Inputs:
 *   - From context: cardType, cardData, message, responseBufferId
 *
 * Outputs:
 *   - cardType: Type of card being responded to
 *   - cardData: Full card metadata
 *   - message: User's response message
 *   - responseBufferId: ID of existing buffer (if multi-turn)
 *   - isMultiTurn: Whether this is a follow-up message
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const CardInputNode: NodeDefinition = defineNode({
  id: 'card_input',
  name: 'Card Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'cardType', type: 'string', description: 'Type of card (desire_rejection, clarifying_questions, etc.)' },
    { name: 'cardData', type: 'object', description: 'Full card metadata' },
    { name: 'message', type: 'string', description: 'User response message' },
    { name: 'responseBufferId', type: 'string', optional: true, description: 'Existing buffer ID for multi-turn' },
    { name: 'isMultiTurn', type: 'boolean', description: 'Whether this is a follow-up message' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'sessionId', type: 'string', description: 'Session ID' },
    { name: 'timestamp', type: 'string', description: 'Input timestamp' },
  ],
  properties: {},
  description: 'Entry point for response pipeline. Receives card data and user message.',

  execute: async (_inputs, context) => {
    // Extract card data from context
    const cardType = typeof context.cardType === 'string' ? context.cardType.trim() : '';
    const cardData = context.cardData;
    const message = typeof context.userMessage === 'string' ? context.userMessage.trim() : '';
    const responseBufferId = context.responseBufferId || null;
    const isMultiTurn = !!responseBufferId;
    const userId = typeof context.userId === 'string' ? context.userId.trim() : '';
    const sessionId = typeof context.sessionId === 'string' ? context.sessionId.trim() : '';

    if (!cardType) throw new Error('Card Input requires a card type');
    if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) {
      throw new Error('Card Input requires card metadata');
    }
    if (!message) throw new Error('Card Input requires a user message');
    if (!userId || userId === 'anonymous') throw new Error('Card Input requires an authenticated user');
    if (!sessionId) throw new Error('Card Input requires a session ID');

    console.log(`[card-input] Processing ${cardType} card response`);
    console.log(`[card-input] Multi-turn: ${isMultiTurn}, buffer: ${responseBufferId || 'new'}`);

    return {
      cardType,
      cardData,
      message,
      responseBufferId,
      isMultiTurn,
      userId,
      sessionId,
      timestamp: new Date().toISOString(),
    };
  },
});

export default CardInputNode;
