import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import { createHelpTicket } from '../../help-tickets/index.js';

const validTargetTypes = ['conversation', 'task', 'memory'];

/**
 * POST /api/feedback
 */
export async function handleSubmitFeedback(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { rating, comment, targetType, targetId } = req.body || {};

    if (typeof rating !== 'number' || ![-1, 0, 1].includes(rating)) {
      return {
        status: 400,
        data: { error: 'rating must be -1, 0, or 1' },
      };
    }

    if (rating === 0) {
      return {
        status: 200,
        data: {
          success: true,
          message: 'No feedback recorded (neutral)',
        },
      };
    }

    if (!validTargetTypes.includes(targetType)) {
      return {
        status: 400,
        data: { error: 'targetType must be conversation, task, or memory' },
      };
    }

    const feedbackContent = [
      `[Feedback: ${rating === 1 ? 'Positive' : 'Negative'}]`,
      `Type: ${targetType}`,
      targetId ? `Target: ${targetId}` : null,
      comment ? `Comment: ${comment}` : null,
    ].filter(Boolean).join('\n');

    const memoryPath = captureEvent(feedbackContent, {
      type: 'observation',
      tags: ['feedback', 'training-data', `feedback-${targetType}`],
      metadata: {
        isTrainingData: true,
        feedbackType: 'user_feedback',
        reinforcementSignal: rating,
        source: 'web_feedback',
        targetType,
        targetId,
        hasComment: !!comment,
      },
    });

    let ticketId: string | undefined;
    if (rating === -1) {
      const ticket = createHelpTicket(
        req.user.username,
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
      actor: req.user.username,
      details: {
        rating,
        targetType,
        targetId,
        hasComment: !!comment,
        memoryPath,
        ticketId,
      },
    });

    let message = `Feedback recorded: ${rating === 1 ? '+1' : '-1'}`;
    if (ticketId) {
      message += ' - help ticket created for review';
    }

    return {
      status: 200,
      data: {
        success: true,
        message,
        ticketId,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}
