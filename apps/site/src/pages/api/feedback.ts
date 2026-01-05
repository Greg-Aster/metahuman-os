/**
 * Unified Feedback API
 *
 * POST: Submit feedback for conversation, task, or memory
 * Body: {
 *   rating: number (-1, 0, or 1),
 *   comment?: string,
 *   targetType: 'conversation' | 'task' | 'memory',
 *   targetId?: string
 * }
 *
 * This unifies the feedback collection for LoRA training:
 * - Conversation feedback (general chat quality)
 * - Task execution feedback (operator proposals)
 * - Memory feedback (specific memory quality)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { captureEvent } from '@metahuman/core/memory';
import { createHelpTicket } from '@metahuman/core/help-tickets';
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { rating, comment, targetType, targetId } = body;

    // Validate rating
    if (typeof rating !== 'number' || ![-1, 0, 1].includes(rating)) {
      return new Response(
        JSON.stringify({ error: 'rating must be -1, 0, or 1' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Skip if neutral (no feedback)
    if (rating === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No feedback recorded (neutral)' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate target type
    const validTypes = ['conversation', 'task', 'memory'];
    if (!validTypes.includes(targetType)) {
      return new Response(
        JSON.stringify({ error: 'targetType must be conversation, task, or memory' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Store feedback as an episodic memory with training metadata
    // This allows the LoRA training pipeline to use it for preference learning
    const feedbackContent = [
      `[Feedback: ${rating === 1 ? 'Positive' : 'Negative'}]`,
      `Type: ${targetType}`,
      targetId ? `Target: ${targetId}` : null,
      comment ? `Comment: ${comment}` : null,
    ].filter(Boolean).join('\n');

    // captureEvent(content, opts) - content is string, opts has metadata
    const memoryPath = captureEvent(feedbackContent, {
      type: 'observation',
      tags: ['feedback', 'training-data', `feedback-${targetType}`],
      metadata: {
        // Training-specific metadata
        isTrainingData: true,
        feedbackType: 'user_feedback',
        reinforcementSignal: rating, // -1 or 1
        source: 'web_feedback',

        // Context
        targetType,
        targetId,
        hasComment: !!comment,
      },
    });

    // Create help ticket for negative feedback to drive system improvement
    let ticketId: string | undefined;
    if (rating === -1) {
      const ticket = createHelpTicket(
        user.username,
        comment,
        targetType,
        targetId,
      );
      ticketId = ticket.id;
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'user_feedback_submitted',
      actor: user.username,
      details: {
        rating,
        targetType,
        targetId,
        hasComment: !!comment,
        memoryPath,
        ticketId,
      },
    });

    // Build response message
    let message = `Feedback recorded: ${rating === 1 ? '+1' : '-1'}`;
    if (ticketId) {
      message += ' - help ticket created for review';
    }

    return new Response(
      JSON.stringify({
        success: true,
        message,
        ticketId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API] feedback error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireWriteMode(handler);
