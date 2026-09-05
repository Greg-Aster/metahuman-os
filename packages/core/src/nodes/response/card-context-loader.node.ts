/**
 * Card Context Loader Node
 *
 * Loads ONLY the context needed for the card response.
 * NO memory search. NO conversation buffer. Just the card + desire + response buffer.
 *
 * This is the key difference from dual-consciousness:
 * - Dual-consciousness: Memory search + conversation buffer + persona + quality scoring
 * - Response pipeline: Card content + desire object + previous exchanges only
 *
 * Inputs:
 *   - cardType: Type of card being responded to
 *   - cardData: Full card metadata (includes desireId, questionId, content, etc.)
 *   - responseBufferId: ID of existing response buffer (if multi-turn)
 *   - userId: User ID for loading data
 *
 * Outputs:
 *   - cardContext: Formatted context for the LLM
 *   - desire: Loaded desire object (if applicable)
 *   - responseBuffer: Loaded or new response buffer
 *   - previousExchanges: Previous exchanges from buffer (if multi-turn)
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { loadDesire } from '../../agency/storage.js';
import { curiosityQuestionStore } from '../../curiosity-questions.js';
import {
  loadResponseBuffer,
  createResponseBuffer,
  buildContextFromBuffer,
  type ResponseBuffer,
} from '../../response-buffer.js';
import type { Desire } from '../../agency/types.js';

interface CardData {
  desireId?: string;
  questionId?: string;
  content?: string;
  desireTitle?: string;
  [key: string]: unknown;
}

export const CardContextLoaderNode: NodeDefinition = defineNode({
  id: 'card_context_loader',
  name: 'Card Context Loader',
  category: 'context',
  inputs: [
    { name: 'cardType', type: 'string', description: 'Type of card' },
    { name: 'cardData', type: 'object', description: 'Card metadata' },
    { name: 'responseBufferId', type: 'string', optional: true, description: 'Existing buffer ID' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'message', type: 'string', description: 'User message' },
  ],
  outputs: [
    { name: 'cardContext', type: 'string', description: 'Formatted context for LLM' },
    { name: 'desire', type: 'object', optional: true, description: 'Loaded desire object' },
    { name: 'responseBuffer', type: 'object', description: 'Response buffer (loaded or new)' },
    { name: 'previousExchanges', type: 'string', description: 'Previous exchanges from buffer' },
  ],
  properties: {},
  description: 'Loads ONLY card-specific context. No memory search, no conversation buffer.',

  execute: async (inputs) => {
    const cardType = typeof inputs.cardType === 'string' ? inputs.cardType : '';
    const cardData = (inputs.cardData || {}) as CardData;
    const responseBufferId = typeof inputs.responseBufferId === 'string' ? inputs.responseBufferId : undefined;
    const userId = typeof inputs.userId === 'string' ? inputs.userId : '';
    const message = typeof inputs.message === 'string' ? inputs.message : '';

    console.log(`[card-context-loader] Loading context for ${cardType}`);
    if (!userId || userId === 'anonymous') throw new Error('Card context requires an authenticated user');
    if (!message.trim()) throw new Error('Card context requires the original user message');

    // Load desire if applicable
    let desire: Desire | null = null;
    if (cardData.desireId) {
      desire = await loadDesire(cardData.desireId, userId);
      if (!desire) throw new Error(`Desire not found: ${cardData.desireId}`);
      console.log(`[card-context-loader] Loaded desire: ${desire.title}`);
    }

    let cardContent = typeof cardData.content === 'string' ? cardData.content.trim() : '';
    if (cardType === 'curiosity_response') {
      const questionId = typeof cardData.questionId === 'string' ? cardData.questionId.trim() : '';
      if (!questionId) throw new Error('Curiosity context requires a questionId');
      const question = await curiosityQuestionStore.get(userId, questionId);
      if (!question) throw new Error(`Curiosity question not found: ${questionId}`);
      if (question.status !== 'pending') throw new Error(`Curiosity question is already resolved: ${questionId}`);
      cardContent = question.question;
    } else if (!cardContent && desire) {
      cardContent = desire.title;
    }
    if (!cardContent) throw new Error(`Card content is unavailable for ${cardType}`);

    // Load or create response buffer
    let responseBuffer: ResponseBuffer | null = null;
    const cardId = cardData.desireId || cardData.questionId;
    if (!cardId) throw new Error(`Card identity is required for ${cardType}`);
    if (responseBufferId) {
      responseBuffer = loadResponseBuffer(userId, responseBufferId);
      if (!responseBuffer) throw new Error(`Response buffer not found or unreadable: ${responseBufferId}`);
      if (responseBuffer.cardType !== cardType || responseBuffer.cardId !== cardId) {
        throw new Error(`Response buffer ${responseBufferId} does not belong to ${cardType}:${cardId}`);
      }
      console.log(`[card-context-loader] Loaded existing buffer with ${responseBuffer.exchanges.length} exchanges`);
    }

    if (!responseBuffer) {
      // Create new buffer
      responseBuffer = createResponseBuffer(
        userId,
        cardType,
        cardId,
        cardContent,
        desire || undefined
      );
      console.log(`[card-context-loader] Created new buffer: ${responseBuffer.id}`);
    }

    // Build previous exchanges context
    const previousExchanges = buildContextFromBuffer(responseBuffer);

    // Build card context string for the LLM
    const contextParts: string[] = [];

    // Card information
    contextParts.push(`## Card Information`);
    contextParts.push(`Type: ${cardType}`);
    contextParts.push(`Card Content: ${cardContent}`);

    // Desire information (if applicable)
    if (desire) {
      contextParts.push('');
      contextParts.push(`## Desire Details`);
      contextParts.push(`Title: ${desire.title}`);
      contextParts.push(`Description: ${desire.description}`);
      contextParts.push(`Status: ${desire.status}`);
      contextParts.push(`Reason: ${desire.reason}`);

      // Include plan if exists
      if (desire.plan) {
        contextParts.push('');
        contextParts.push(`### Current Plan (v${desire.plan.version})`);
        for (const step of desire.plan.steps) {
          contextParts.push(`${step.order}. ${step.action} (${step.risk} risk)`);
          contextParts.push(`   Expected: ${step.expectedOutcome}`);
        }
      }

      // Include user critique if exists
      if (desire.userCritique) {
        contextParts.push('');
        contextParts.push(`### Previous User Feedback`);
        contextParts.push(desire.userCritique);
      }

      // Include clarifying questions if in questioning status
      if (desire.clarifyingQuestions && desire.status === 'questioning') {
        contextParts.push('');
        contextParts.push(`### Clarifying Questions`);
        for (const q of desire.clarifyingQuestions.questions) {
          const answer = desire.clarifyingQuestions.answers.find(a => a.questionId === q.id);
          contextParts.push(`Q: ${q.text}`);
          if (answer) {
            contextParts.push(`A: ${answer.answer}`);
          }
        }
      }
    }

    // Previous exchanges (if multi-turn)
    if (previousExchanges) {
      contextParts.push('');
      contextParts.push(previousExchanges);
    }

    // Current message
    contextParts.push('');
    contextParts.push(`## Current User Message`);
    contextParts.push(message);

    const cardContext = contextParts.join('\n');

    return {
      cardContext,
      desire,
      responseBuffer,
      previousExchanges,
    };
  },
});

export default CardContextLoaderNode;
