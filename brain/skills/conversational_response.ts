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
      required: false,
      description: 'The user\'s message to respond to (used for direct conversation)',
    },
    context: {
      type: 'string',
      required: false,
      description: 'Additional context from previous steps or observations',
    },
    goal: {
      type: 'string',
      required: false,
      description: 'The original user goal/question (for operator synthesis)',
    },
    style: {
      type: 'string',
      required: false,
      description: 'Response style: "default" (conversational), "strict" (data only, no embellishment), "summary" (brief overview)',
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
  const { message, context, goal, style = 'default' } = inputs;

  audit({
    level: 'info',
    category: 'action',
    event: 'conversational_response_start',
    details: {
      message: message?.substring(0, 100),
      hasContext: !!context,
      style,
    },
    actor: 'conversational_response',
  });

  try {
    // Build system prompt based on style
    let systemPrompt: string;
    let temperature: number;

    switch (style) {
      case 'strict':
        systemPrompt = `You are responding to a user query. You must:

1. ONLY use information from the provided context
2. DO NOT add commentary, interpretation, or embellishment
3. DO NOT invent or assume any information
4. Repeat the data EXACTLY as provided
5. Use clear formatting (bullet lists, tables) but no extra text

If the context doesn't contain enough information, say exactly: "The available information shows: [data]"

Context:
${context || 'No context provided'}`;
        temperature = 0.0;
        break;

      case 'summary':
        systemPrompt = `Provide a brief, high-level summary of the information. Be concise (2-3 sentences max).

Context:
${context || 'No context provided'}`;
        temperature = 0.3;
        break;

      case 'default':
      default:
        // Simple grounding prompt - don't over-constrain the AI
        // Let memories provide context, let persona provide identity, let AI adapt naturally
        systemPrompt = context
          ? `${context}

Respond naturally using the memories and context above. Speak as yourself in first person.`
          : `Respond naturally as yourself.`;
        temperature = 0.7;
        break;
    }

    // Determine user message
    const userMessage = message || goal || 'Please respond based on the context.';

    // Add style-specific instructions to user message for strict mode
    const finalUserMessage = style === 'strict'
      ? `${userMessage}\n\nRespond with data only (no embellishment).`
      : userMessage;

    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalUserMessage },
      ],
      options: {
        temperature,
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
