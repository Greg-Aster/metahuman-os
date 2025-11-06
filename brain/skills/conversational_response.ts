/**
 * Conversational Response Skill
 *
 * Allows the operator to respond conversationally without taking any actions.
 * This is the "chat mode" skill that lets the ReAct operator handle both
 * action-oriented requests and pure conversation in a unified way.
 */

import type { SkillManifest } from '../../packages/core/src/skills';
import { callLLM } from '@metahuman/core/model-router';
import { audit } from '@metahuman/core';

export const manifest: SkillManifest = {
  id: 'conversational_response',
  name: 'Conversational Response',
  description: 'Respond to the user conversationally without taking any actions. Use this when the user is asking questions, having a conversation, or requesting information that does not require file access, task management, or other skills.',
  category: 'memory',

  inputs: {
    message: {
      type: 'string',
      required: true,
      description: 'The user\'s message to respond to',
    },
    context: {
      type: 'string',
      required: false,
      description: 'Additional context from previous steps or observations',
    },
  },

  outputs: {
    response: {
      type: 'string',
      description: 'The conversational response to the user',
    },
  },

  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'observe',
  requiresApproval: false,
};

export async function execute(inputs: any): Promise<any> {
  const { message, context } = inputs;

  audit({
    level: 'info',
    category: 'action',
    event: 'conversational_response_start',
    details: {
      message: message?.substring(0, 100),
      hasContext: !!context,
    },
    actor: 'conversational_response',
  });

  try {
    // Build the conversation prompt
    const systemPrompt = context
      ? `You are MetaHuman Greg, having a conversation with the user.

Context from previous actions:
${context}

Respond naturally and conversationally to the user's message.`
      : `You are MetaHuman Greg, having a conversation with the user. Respond naturally and conversationally.`;

    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      options: {
        temperature: 0.7,
        maxTokens: 500,
      },
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'conversational_response_success',
      details: {
        responseLength: response.content.length,
      },
      actor: 'conversational_response',
    });

    return {
      success: true,
      outputs: {
        response: response.content,
      },
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'conversational_response_error',
      details: {
        error: (error as Error).message,
      },
      actor: 'conversational_response',
    });

    return {
      success: false,
      error: `Failed to generate conversational response: ${(error as Error).message}`,
    };
  }
}
