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
    { name: 'cardType', type: 'string', description: 'Type of card (desire_rejection, clarifying_question, etc.)' },
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
    const cardType = context.cardType || 'unknown';
    const cardData = context.cardData || {};
    const message = context.userMessage || '';
    const responseBufferId = context.responseBufferId || null;
    const isMultiTurn = !!responseBufferId;

    console.log(`[card-input] Processing ${cardType} card response`);
    console.log(`[card-input] Multi-turn: ${isMultiTurn}, buffer: ${responseBufferId || 'new'}`);

    return {
      cardType,
      cardData,
      message,
      responseBufferId,
      isMultiTurn,
      userId: context.userId || 'anonymous',
      sessionId: context.sessionId || `session-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  },
});

export default CardInputNode;
