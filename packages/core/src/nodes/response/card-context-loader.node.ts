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
import { loadDesire } from '../../agency/index.js';
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

  execute: async (inputs, context) => {
    const slot0 = inputs[0] as {
      cardType?: string;
      cardData?: CardData;
      responseBufferId?: string;
      userId?: string;
      message?: string;
    } | undefined;

    const cardType = slot0?.cardType || context.cardType || 'unknown';
    const cardData = (slot0?.cardData || context.cardData || {}) as CardData;
    const responseBufferId = slot0?.responseBufferId || context.responseBufferId;
    const userId = slot0?.userId || context.userId || 'anonymous';
    const message = slot0?.message || context.userMessage || '';

    console.log(`[card-context-loader] Loading context for ${cardType}`);

    // Load desire if applicable
    let desire: Desire | null = null;
    if (cardData.desireId) {
      try {
        desire = await loadDesire(cardData.desireId, userId);
        console.log(`[card-context-loader] Loaded desire: ${desire?.title || 'not found'}`);
      } catch (err) {
        console.error(`[card-context-loader] Failed to load desire:`, err);
      }
    }

    // Load or create response buffer
    let responseBuffer: ResponseBuffer | null = null;
    if (responseBufferId) {
      responseBuffer = loadResponseBuffer(userId, responseBufferId);
      if (responseBuffer) {
        console.log(`[card-context-loader] Loaded existing buffer with ${responseBuffer.exchanges.length} exchanges`);
      }
    }

    if (!responseBuffer) {
      // Create new buffer
      const cardContent = cardData.content || desire?.title || 'Unknown card';
      const cardId = cardData.desireId || cardData.questionId || `card-${Date.now()}`;
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
    if (cardData.content) {
      contextParts.push(`Card Content: ${cardData.content}`);
    }

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
