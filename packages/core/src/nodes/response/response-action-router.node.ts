/**
 * Response Action Router Node
 *
 * Takes action based on the LLM's suggested action and card type.
 * Handles updating desires, saving answers, triggering pipelines, etc.
 *
 * Actions by card type:
 * - desire_rejection: Update desire.userCritique, transition status
 * - clarifying_question: Save answer, advance if all answered
 * - desire_plan: Update plan, trigger re-planning or approval
 * - agency_notification: Acknowledge, create tasks if needed
 *
 * Inputs:
 *   - cardType: Type of card
 *   - suggestedAction: Action suggested by LLM
 *   - actionData: Data for the action
 *   - desire: Desire object (if applicable)
 *   - userId: User ID
 *   - responseBuffer: Response buffer for this conversation
 *
 * Outputs:
 *   - actionTaken: Description of action taken
 *   - updatedDesire: Updated desire object (if modified)
 *   - pipelineTriggered: Whether a pipeline was triggered
 *   - nextStatus: Next status for the desire (if applicable)
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { saveDesireManifest, addScratchpadEntryToFolder } from '../../agency/storage.js';
import { proposalEvents } from '../../active-operator/index.js';
import type { Desire, DesireStatus, ClarifyingAnswer } from '../../agency/types.js';
import type { ResponseBuffer } from '../../response-buffer.js';

interface ActionRouterInput {
  cardType?: string;
  suggestedAction?: string;
  actionData?: Record<string, unknown>;
  desire?: Desire;
  userId?: string;
  responseBuffer?: ResponseBuffer;
  response?: string;
}

export const ResponseActionRouterNode: NodeDefinition = defineNode({
  id: 'response_action_router',
  name: 'Response Action Router',
  category: 'agency',
  inputs: [
    { name: 'cardType', type: 'string', description: 'Type of card' },
    { name: 'suggestedAction', type: 'string', description: 'LLM suggested action' },
    { name: 'actionData', type: 'object', description: 'Data for the action' },
    { name: 'desire', type: 'object', optional: true, description: 'Desire object' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'responseBuffer', type: 'object', description: 'Response buffer' },
    { name: 'response', type: 'string', description: 'LLM response text' },
  ],
  outputs: [
    { name: 'actionTaken', type: 'string', description: 'Description of action taken' },
    { name: 'updatedDesire', type: 'object', optional: true, description: 'Updated desire' },
    { name: 'pipelineTriggered', type: 'boolean', description: 'Whether pipeline was triggered' },
    { name: 'nextStatus', type: 'string', optional: true, description: 'Next desire status' },
    { name: 'response', type: 'string', description: 'Pass-through LLM response text' },
    { name: 'responseBuffer', type: 'object', description: 'Pass-through response buffer' },
  ],
  properties: {},
  description: 'Takes action based on LLM suggestion. Updates desires, saves answers, triggers pipelines.',

  execute: async (inputs, context) => {
    const slot0 = inputs[0] as ActionRouterInput | undefined;

    const cardType = slot0?.cardType || context.cardType || 'unknown';
    const suggestedAction = slot0?.suggestedAction || 'acknowledge';
    const actionData = slot0?.actionData || {};
    let desire = slot0?.desire;
    const userId = slot0?.userId || context.userId || 'anonymous';
    const responseBuffer = slot0?.responseBuffer;
    const response = slot0?.response || '';

    console.log(`[response-action-router] Processing action: ${suggestedAction} for ${cardType}`);

    let actionTaken = 'No action required';
    let pipelineTriggered = false;
    let nextStatus: DesireStatus | null = null;

    try {
      switch (cardType) {
        case 'desire_rejection':
          ({ actionTaken, pipelineTriggered, nextStatus, desire } = await handleDesireRejection(
            suggestedAction,
            actionData,
            desire,
            userId,
            response,
            responseBuffer
          ));
          break;

        case 'clarifying_question':
        case 'clarifying_questions':  // Handle both singular and plural
          ({ actionTaken, pipelineTriggered, nextStatus, desire } = await handleClarifyingQuestion(
            suggestedAction,
            actionData,
            desire,
            userId,
            response,
            responseBuffer
          ));
          break;

        case 'desire_plan':
          ({ actionTaken, pipelineTriggered, nextStatus, desire } = await handleDesirePlan(
            suggestedAction,
            actionData,
            desire,
            userId,
            response,
            responseBuffer
          ));
          break;

        case 'agency_notification':
          ({ actionTaken, pipelineTriggered } = await handleAgencyNotification(
            suggestedAction,
            actionData,
            userId,
            response,
            responseBuffer
          ));
          break;

        default:
          actionTaken = `Acknowledged ${cardType} response`;
      }

      console.log(`[response-action-router] Action completed: ${actionTaken}`);
    } catch (err) {
      console.error('[response-action-router] Action failed:', err);
      actionTaken = `Action failed: ${err}`;
    }

    return {
      actionTaken,
      updatedDesire: desire,
      pipelineTriggered,
      nextStatus,
      response,  // Pass through the response text
      responseBuffer,  // Pass through the buffer
    };
  },
});

// ============================================================================
// Action Handlers
// ============================================================================

async function handleDesireRejection(
  action: string,
  data: Record<string, unknown>,
  desire: Desire | undefined,
  userId: string,
  response: string,
  responseBuffer?: ResponseBuffer
): Promise<{
  actionTaken: string;
  pipelineTriggered: boolean;
  nextStatus: DesireStatus | null;
  desire: Desire | undefined;
  response: string;
  responseBuffer?: ResponseBuffer;
}> {
  if (!desire) {
    return { actionTaken: 'No desire to update', pipelineTriggered: false, nextStatus: null, desire, response, responseBuffer };
  }

  const now = new Date().toISOString();
  const feedbackSummary = (data.feedbackSummary as string) || response;
  const shouldRetry = data.shouldRetry as boolean;

  // Accumulate feedback in userCritique
  const existingCritique = desire.userCritique || '';
  const newCritique = existingCritique
    ? `${existingCritique}\n\n---\n[${now}] User feedback on rejection:\n${feedbackSummary}`
    : `[${now}] User feedback on rejection:\n${feedbackSummary}`;

  let nextStatus: DesireStatus = desire.status;
  let pipelineTriggered = false;

  if (action === 'update_critique' && shouldRetry) {
    // Move back to planning with the new feedback
    nextStatus = 'planning';
    pipelineTriggered = true;

    // Update desire
    desire = {
      ...desire,
      status: nextStatus,
      currentStage: 'planning',
      userCritique: newCritique,
      critiqueAt: now,
      updatedAt: now,
    };

    await saveDesireManifest(desire, userId);
    await addScratchpadEntryToFolder(desire.id, {
      timestamp: now,
      type: 'user_critique',
      description: `User feedback on rejection: ${feedbackSummary.substring(0, 100)}...`,
      actor: 'user',
      data: { action, feedbackSummary, shouldRetry },
    }, userId);

    // Trigger re-planning
    proposalEvents.emit('proposal-resolved', {
      username: userId,
      proposalId: desire.id,
      response: 'feedback_provided',
      taskType: 'desire_plan',
    });

    return {
      actionTaken: 'Saved feedback and triggered re-planning',
      pipelineTriggered,
      nextStatus,
      desire,
      response,
      responseBuffer,
    };
  }

  // Just save the feedback without changing status
  desire = {
    ...desire,
    userCritique: newCritique,
    critiqueAt: now,
    updatedAt: now,
  };

  await saveDesireManifest(desire, userId);

  return {
    actionTaken: 'Saved feedback (rejection maintained)',
    pipelineTriggered: false,
    nextStatus: null,
    desire,
    response,
    responseBuffer,
  };
}

async function handleClarifyingQuestion(
  action: string,
  data: Record<string, unknown>,
  desire: Desire | undefined,
  userId: string,
  response: string,
  responseBuffer?: ResponseBuffer
): Promise<{
  actionTaken: string;
  pipelineTriggered: boolean;
  nextStatus: DesireStatus | null;
  desire: Desire | undefined;
  response: string;
  responseBuffer?: ResponseBuffer;
}> {
  if (!desire || !desire.clarifyingQuestions) {
    return { actionTaken: 'No clarifying questions to answer', pipelineTriggered: false, nextStatus: null, desire, response, responseBuffer };
  }

  const now = new Date().toISOString();
  const extractedAnswer = (data.extractedAnswer as string) || response;
  const answerComplete = data.answerComplete as boolean;

  // Find the first unanswered question
  const answeredIds = new Set(desire.clarifyingQuestions.answers.map(a => a.questionId));
  const unansweredQuestion = desire.clarifyingQuestions.questions.find(q => !answeredIds.has(q.id));

  if (!unansweredQuestion) {
    return { actionTaken: 'All questions already answered', pipelineTriggered: false, nextStatus: null, desire, response, responseBuffer };
  }

  // Save the answer
  const newAnswer: ClarifyingAnswer = {
    questionId: unansweredQuestion.id,
    answer: extractedAnswer,
    answeredAt: now,
  };

  const updatedAnswers = [...desire.clarifyingQuestions.answers, newAnswer];
  const allAnswered = updatedAnswers.length >= desire.clarifyingQuestions.questions.length;

  let nextStatus: DesireStatus = desire.status;
  let pipelineTriggered = false;

  if (action === 'move_to_planning' || (action === 'save_answer' && allAnswered)) {
    nextStatus = 'planning';
    pipelineTriggered = true;
  }

  desire = {
    ...desire,
    status: nextStatus,
    currentStage: nextStatus === 'planning' ? 'planning' : 'questioning',
    clarifyingQuestions: {
      ...desire.clarifyingQuestions,
      answers: updatedAnswers,
      completedAt: allAnswered ? now : undefined,
    },
    updatedAt: now,
  };

  await saveDesireManifest(desire, userId);
  await addScratchpadEntryToFolder(desire.id, {
    timestamp: now,
    type: 'questions_answered',
    description: `Answered question: "${unansweredQuestion.text.substring(0, 50)}..."`,
    actor: 'user',
    data: { questionId: unansweredQuestion.id, answer: extractedAnswer, allAnswered },
  }, userId);

  if (pipelineTriggered) {
    proposalEvents.emit('proposal-resolved', {
      username: userId,
      proposalId: desire.id,
      response: 'questions_answered',
      taskType: 'desire_plan',
    });
  }

  return {
    actionTaken: allAnswered ? 'All questions answered, moving to planning' : 'Answer saved',
    pipelineTriggered,
    nextStatus: pipelineTriggered ? nextStatus : null,
    desire,
    response,
    responseBuffer,
  };
}

async function handleDesirePlan(
  action: string,
  data: Record<string, unknown>,
  desire: Desire | undefined,
  userId: string,
  response: string,
  responseBuffer?: ResponseBuffer
): Promise<{
  actionTaken: string;
  pipelineTriggered: boolean;
  nextStatus: DesireStatus | null;
  desire: Desire | undefined;
  response: string;
  responseBuffer?: ResponseBuffer;
}> {
  if (!desire) {
    return { actionTaken: 'No desire to update', pipelineTriggered: false, nextStatus: null, desire, response, responseBuffer };
  }

  const now = new Date().toISOString();
  const feedbackSummary = (data.feedbackSummary as string) || response;
  const userApproves = data.userApproves as boolean;

  let nextStatus: DesireStatus = desire.status;
  let pipelineTriggered = false;
  let actionTaken = 'Feedback noted';

  switch (action) {
    case 'approve_plan':
      if (userApproves) {
        nextStatus = 'approved';
        pipelineTriggered = true;
        actionTaken = 'Plan approved, ready for execution';

        desire = {
          ...desire,
          status: nextStatus,
          currentStage: 'executing',
          updatedAt: now,
        };

        await saveDesireManifest(desire, userId);
        await addScratchpadEntryToFolder(desire.id, {
          timestamp: now,
          type: 'approved',
          description: 'User approved the plan',
          actor: 'user',
        }, userId);

        proposalEvents.emit('proposal-resolved', {
          username: userId,
          proposalId: desire.id,
          response: 'approved',
          taskType: 'desire_execute',
        });
      }
      break;

    case 'revise_plan':
      nextStatus = 'planning';
      pipelineTriggered = true;
      actionTaken = 'Triggering plan revision';

      const existingCritique = desire.userCritique || '';
      const newCritique = existingCritique
        ? `${existingCritique}\n\n---\n[${now}] Plan feedback:\n${feedbackSummary}`
        : `[${now}] Plan feedback:\n${feedbackSummary}`;

      desire = {
        ...desire,
        status: nextStatus,
        currentStage: 'planning',
        userCritique: newCritique,
        critiqueAt: now,
        updatedAt: now,
      };

      await saveDesireManifest(desire, userId);
      await addScratchpadEntryToFolder(desire.id, {
        timestamp: now,
        type: 'user_critique',
        description: `Plan revision requested: ${feedbackSummary.substring(0, 100)}...`,
        actor: 'user',
        data: { action, feedbackSummary },
      }, userId);

      proposalEvents.emit('proposal-resolved', {
        username: userId,
        proposalId: desire.id,
        response: 'revise_requested',
        taskType: 'desire_plan',
      });
      break;

    case 'abandon_plan':
      nextStatus = 'abandoned';
      actionTaken = 'Desire abandoned per user request';

      desire = {
        ...desire,
        status: nextStatus,
        currentStage: 'abandoned',
        completedAt: now,
        updatedAt: now,
      };

      await saveDesireManifest(desire, userId);
      await addScratchpadEntryToFolder(desire.id, {
        timestamp: now,
        type: 'status_change',
        description: 'User abandoned the desire',
        actor: 'user',
        data: { fromStatus: desire.status, toStatus: nextStatus },
      }, userId);
      break;
  }

  return {
    actionTaken,
    pipelineTriggered,
    nextStatus: pipelineTriggered || nextStatus !== desire.status ? nextStatus : null,
    desire,
    response,
    responseBuffer,
  };
}

async function handleAgencyNotification(
  action: string,
  data: Record<string, unknown>,
  userId: string,
  response: string,
  responseBuffer?: ResponseBuffer
): Promise<{
  actionTaken: string;
  pipelineTriggered: boolean;
  response: string;
  responseBuffer?: ResponseBuffer;
}> {
  let actionTaken = 'Notification acknowledged';

  if (action === 'create_task' && data.taskToCreate) {
    // TODO: Integrate with task creation system
    actionTaken = `Task creation requested: ${data.taskToCreate}`;
  }

  return {
    actionTaken,
    pipelineTriggered: false,
    response,
    responseBuffer,
  };
}

export default ResponseActionRouterNode;
