import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, captureEvent, queueTTS, proposalEvents, appendAgencyMessageToConversation } from '@metahuman/core';
import { loadDesire, saveDesireManifest, addScratchpadEntryToFolder, type DesireStatus } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/feedback]';

/**
 * POST /api/agency/desires/:id/feedback
 * Submit user feedback/questions at ANY stage of the desire lifecycle.
 * This is the unified entry point for user interaction with desires.
 *
 * Request body:
 * {
 *   message: string,        // User's feedback, question, or comment
 *   action?: 'revise' | 'continue' | 'question'  // What to do with the feedback
 * }
 *
 * Behavior by status:
 * - planning/reviewing: Adds feedback as userCritique, stays in current stage
 * - executing/awaiting_review: Moves back to planning with feedback
 * - completed: Creates a new iteration with feedback
 * - questioning: Adds as additional context
 * - Any status: Records in scratchpad and triggers appropriate pipeline
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: { message: string; action?: 'revise' | 'continue' | 'question' };
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { message, action = 'revise' } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} Feedback for desire: ${id}`);
    console.log(`${LOG_PREFIX}    Action: ${action}`);
    console.log(`${LOG_PREFIX}    Message: ${message.substring(0, 100)}...`);

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} Desire "${desire.title}" is in status: ${desire.status}`);

    const now = new Date().toISOString();
    const trimmedMessage = message.trim();

    // Determine the appropriate response based on current status and action
    let nextStatus: DesireStatus = desire.status;
    let responseMessage = '';
    let shouldTriggerPipeline = false;

    // Accumulate feedback instead of replacing
    const existingCritique = desire.userCritique || '';
    const newCritique = existingCritique
      ? `${existingCritique}\n\n---\n[${now}] User feedback:\n${trimmedMessage}`
      : `[${now}] User feedback:\n${trimmedMessage}`;

    switch (desire.status) {
      case 'planning':
      case 'reviewing':
        // Already in planning/reviewing - add feedback and re-trigger
        nextStatus = 'planning';
        responseMessage = 'Feedback added. Regenerating plan with your input.';
        shouldTriggerPipeline = true;
        break;

      case 'awaiting_approval':
        // User has questions before approval - go back to planning
        nextStatus = 'planning';
        responseMessage = 'Got it. Going back to planning to address your concerns.';
        shouldTriggerPipeline = true;
        break;

      case 'approved':
      case 'executing':
      case 'awaiting_review':
        // After execution - reset to planning with feedback
        nextStatus = 'planning';
        responseMessage = 'Feedback received. Revising the plan based on your input.';
        shouldTriggerPipeline = true;
        break;

      case 'completed':
        // Completed desire - start a new cycle
        nextStatus = 'planning';
        responseMessage = 'Starting a new iteration based on your feedback.';
        shouldTriggerPipeline = true;
        break;

      case 'questioning':
        // In questioning phase - add as additional context
        nextStatus = 'questioning';
        responseMessage = 'Added your input to the context. You can continue answering questions or submit answers.';
        shouldTriggerPipeline = false;
        break;

      default:
        // For any other status, move to planning
        nextStatus = 'planning';
        responseMessage = 'Feedback received. Processing...';
        shouldTriggerPipeline = true;
    }

    // Update the desire
    const updatedDesire = {
      ...desire,
      status: nextStatus,
      currentStage: nextStatus,
      userCritique: newCritique,
      critiqueAt: now,
      updatedAt: now,
      // Update metrics (preserve existing if present)
      metrics: desire.metrics ? {
        ...desire.metrics,
        userInputCount: desire.metrics.userInputCount + 1,
        userCritiqueCount: desire.metrics.userCritiqueCount + (nextStatus === 'planning' ? 1 : 0),
      } : desire.metrics,
    };

    await saveDesireManifest(updatedDesire as any, user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_critique',
      description: `User feedback: ${trimmedMessage.substring(0, 100)}${trimmedMessage.length > 100 ? '...' : ''}`,
      actor: 'user',
      data: {
        username: user.username,
        message: trimmedMessage,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
        triggerPipeline: shouldTriggerPipeline,
      },
    }, user.username);

    // Audit
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_user_feedback',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
        messagePreview: trimmedMessage.substring(0, 100),
      },
    });

    // Log to inner dialogue
    captureEvent(`User provided feedback on "${desire.title}": "${trimmedMessage}"`, {
      type: 'inner_dialogue',
      tags: ['agency', 'feedback', 'user-input', 'inner'],
      metadata: {
        source: 'user-feedback',
        desireId: id,
        action,
      },
    });

    // Queue TTS acknowledgment
    queueTTS(
      user.username,
      `Got your feedback on "${desire.title}". ${responseMessage}`,
      'inner',
      'agency-feedback'
    );

    // Post to conversation buffer so user sees acknowledgment in chat
    await appendAgencyMessageToConversation(
      user.username,
      `📝 **Feedback Received:** "${desire.title}"\n\n` +
      `Your input: "${trimmedMessage.length > 200 ? trimmedMessage.substring(0, 200) + '...' : trimmedMessage}"\n\n` +
      `${responseMessage}`,
      {
        dialogueSource: 'agency-system',
        displayColor: '#8b5cf6',
        type: 'desire_feedback_received',
        desireId: id,
        desireTitle: desire.title,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
      }
    );

    // Trigger pipeline if needed
    if (shouldTriggerPipeline) {
      // Emit event to trigger re-planning
      proposalEvents.emit('proposal-resolved', {
        username: user.username,
        proposalId: id,
        response: 'feedback_provided',
        taskType: 'desire_plan',
      });
      console.log(`${LOG_PREFIX} Emitted proposal-resolved to trigger planning`);
    }

    console.log(`${LOG_PREFIX} Success: ${desire.status} → ${nextStatus}`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      message: responseMessage,
      previousStatus: desire.status,
      newStatus: nextStatus,
      pipelineTriggered: shouldTriggerPipeline,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
