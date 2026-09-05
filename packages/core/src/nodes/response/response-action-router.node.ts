/**
 * Response Action Router Node
 *
 * Takes action based on the LLM's suggested action and card type.
 * Handles updating desires, saving answers, triggering pipelines, etc.
 *
 * Actions by card type:
 * - desire_rejection: Update desire.userCritique, transition status
 * - clarifying_questions: Save answer, advance if all answered
 * - desire_plan: Update plan, trigger re-planning or approval
 * - curiosity_response: Resolve the answered curiosity question
 *
 * Inputs:
 *   - cardType: Type of card
 *   - suggestedAction: Action suggested by LLM
 *   - actionData: Data for the action
 *   - desire: Desire object (if applicable)
 *   - userId: User ID
 *   - responseBuffer: Response buffer for this conversation
 *   - cardData: Stable card identity used by the owning domain store
 *   - message: Exact user-authored text
 *
 * Outputs:
 *   - actionTaken: Description of action taken
 *   - updatedDesire: Updated desire object (if modified)
 *   - pipelineTriggered: Whether a pipeline was triggered
 *   - nextStatus: Next status for the desire (if applicable)
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { saveDesireManifest, addScratchpadEntryToFolder } from '../../agency/storage.js';
import { curiosityQuestionStore } from '../../curiosity-questions.js';
import { approveDesireForExecution } from '../../agency/user-approval-transition.js';
import type { Desire, DesireStatus, ClarifyingAnswer } from '../../agency/types.js';
import type { ResponseBuffer } from '../../response-buffer.js';

const ACTIONS_BY_CARD_TYPE: Readonly<Record<string, ReadonlySet<string>>> = {
  desire_rejection: new Set(['update_critique', 'maintain_rejection', 'request_clarification']),
  clarifying_questions: new Set(['save_answer', 'request_more_detail', 'move_to_planning']),
  desire_plan: new Set(['revise_plan', 'approve_plan', 'request_clarification', 'abandon_plan']),
  curiosity_response: new Set(['resolve_answer']),
};

export function validateResponseAction(cardType: string, suggestedAction: string): void {
  const supportedActions = ACTIONS_BY_CARD_TYPE[cardType];
  if (!supportedActions) throw new Error(`Unsupported response card type: ${cardType}`);
  if (!supportedActions.has(suggestedAction)) {
    throw new Error(`Unsupported ${cardType} action: ${suggestedAction}`);
  }
}

export async function resolveCuriosityResponse(
  cardData: Record<string, unknown>,
  userId: string,
  resolver: Pick<typeof curiosityQuestionStore, 'resolve'> = curiosityQuestionStore,
): Promise<void> {
  const questionId = typeof cardData.questionId === 'string' ? cardData.questionId.trim() : '';
  if (!questionId) throw new Error('Curiosity response requires a questionId');
  const resolution = await resolver.resolve(userId, questionId, 'answered');
  if (!resolution.changed) throw new Error(`Curiosity question is already resolved: ${questionId}`);
}

async function emitProposalResolved(event: {
  username: string;
  proposalId: string;
  response: string;
  taskType: string;
}): Promise<void> {
  const { proposalEvents } = await import('../../active-operator/operator-proposals.js');
  proposalEvents.emit('proposal-resolved', event);
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
    { name: 'cardData', type: 'object', description: 'Stable card identity and metadata' },
    { name: 'message', type: 'string', description: 'Exact user-authored response' },
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
    const cardType = typeof inputs.cardType === 'string' ? inputs.cardType : '';
    const suggestedAction = typeof inputs.suggestedAction === 'string' ? inputs.suggestedAction : '';
    const actionData = inputs.actionData && typeof inputs.actionData === 'object'
      ? inputs.actionData as Record<string, unknown>
      : {};
    let desire = inputs.desire as Desire | undefined;
    const userId = typeof inputs.userId === 'string' ? inputs.userId : '';
    const responseBuffer = inputs.responseBuffer as ResponseBuffer | undefined;
    const response = typeof inputs.response === 'string' ? inputs.response : '';
    const cardData = inputs.cardData && typeof inputs.cardData === 'object'
      ? inputs.cardData as Record<string, unknown>
      : {};
    const message = typeof inputs.message === 'string' ? inputs.message : '';
    const userRole = typeof context.userRole === 'string' ? context.userRole : '';

    console.log(`[response-action-router] Processing action: ${suggestedAction} for ${cardType}`);
    validateResponseAction(cardType, suggestedAction);

    if (!userId || userId === 'anonymous') throw new Error('Response action requires an authenticated user');
    if (!response.trim()) throw new Error('Response action requires generated response text');
    if (!message.trim()) throw new Error('Response action requires the original user message');

    let actionTaken = 'No action required';
    let pipelineTriggered = false;
    let nextStatus: DesireStatus | null = null;

    switch (cardType) {
      case 'desire_rejection':
        ({ actionTaken, pipelineTriggered, nextStatus, desire } = await handleDesireRejection(
          suggestedAction,
          actionData,
          desire,
          userId,
          userRole,
          message,
          response,
          responseBuffer
        ));
        break;

      case 'clarifying_questions':
        ({ actionTaken, pipelineTriggered, nextStatus, desire } = await handleClarifyingQuestion(
          suggestedAction,
          actionData,
          desire,
          userId,
          message,
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
          userRole,
          message,
          response,
          responseBuffer
        ));
        break;

      case 'curiosity_response': {
        await resolveCuriosityResponse(cardData, userId);
        actionTaken = 'Curiosity question marked answered';
        break;
      }
    }

    console.log(`[response-action-router] Action completed: ${actionTaken}`);

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
  userRole: string,
  message: string,
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
  if (!desire) throw new Error('Desire rejection response requires a loaded desire');

  const now = new Date().toISOString();
  const feedbackSummary = typeof data.feedbackSummary === 'string' && data.feedbackSummary.trim()
    ? data.feedbackSummary.trim()
    : message;
  const shouldRetry = data.shouldRetry === true;

  if (action === 'request_clarification') {
    return {
      actionTaken: 'Requested clarification before changing the rejected desire',
      pipelineTriggered: false,
      nextStatus: null,
      desire,
      response,
      responseBuffer,
    };
  }
  if (userRole !== 'owner') throw new Error('Owner role required to revise rejected desires');

  // Accumulate feedback in userCritique
  const existingCritique = desire.userCritique || '';
  const newCritique = existingCritique
    ? `${existingCritique}\n\n---\n[${now}] User feedback on rejection:\n${feedbackSummary}`
    : `[${now}] User feedback on rejection:\n${feedbackSummary}`;

  let nextStatus: DesireStatus | null = null;
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

    const { submitDesirePlanning } = await import('../../queue/work-submission.js');
    await submitDesirePlanning({
      username: userId,
      desireId: desire.id,
      source: 'user',
      idempotencyKey: `desire-plan:${desire.id}:${desire.updatedAt}`,
      metadata: { producer: 'response-pipeline' },
    });

    // Notify observers after the coordinator accepts re-planning.
    await emitProposalResolved({
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
  message: string,
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
  if (!desire?.clarifyingQuestions) throw new Error('Clarifying response requires a desire with pending questions');

  const now = new Date().toISOString();
  const extractedAnswer = message.trim();
  const answerComplete = data.answerComplete === true;

  // Find the first unanswered question
  const answeredIds = new Set(desire.clarifyingQuestions.answers.map(a => a.questionId));
  const unansweredQuestion = desire.clarifyingQuestions.questions.find(q => !answeredIds.has(q.id));

  if (!unansweredQuestion) throw new Error('Desire has no unanswered clarifying questions');

  if (action === 'request_more_detail') {
    return {
      actionTaken: 'Requested more detail for the current clarifying question',
      pipelineTriggered: false,
      nextStatus: null,
      desire,
      response,
      responseBuffer,
    };
  }

  // Save the answer
  const newAnswer: ClarifyingAnswer = {
    questionId: unansweredQuestion.id,
    answer: extractedAnswer,
    answeredAt: now,
  };

  const updatedAnswers = [...desire.clarifyingQuestions.answers, newAnswer];
  const allAnswered = updatedAnswers.length >= desire.clarifyingQuestions.questions.length;

  if (action === 'move_to_planning' && (!answerComplete || !allAnswered)) {
    throw new Error('Cannot move desire to planning before all clarifying questions are answered');
  }
  if (action === 'save_answer' && !answerComplete) {
    throw new Error('Cannot save a completed clarifying answer when answerComplete is false');
  }

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
    const { submitDesirePlanning } = await import('../../queue/work-submission.js');
    await submitDesirePlanning({
      username: userId,
      desireId: desire.id,
      source: 'user',
      idempotencyKey: `desire-plan:${desire.id}:${desire.updatedAt}`,
      metadata: { producer: 'response-pipeline' },
    });
    await emitProposalResolved({
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
  userRole: string,
  message: string,
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
  if (!desire) throw new Error('Plan response requires a loaded desire');

  const now = new Date().toISOString();
  const feedbackSummary = typeof data.feedbackSummary === 'string' && data.feedbackSummary.trim()
    ? data.feedbackSummary.trim()
    : message;
  const userApproves = data.userApproves as boolean;
  const originalStatus = desire.status;

  let nextStatus: DesireStatus | null = null;
  let pipelineTriggered = false;
  let actionTaken = 'Feedback noted';

  switch (action) {
    case 'approve_plan':
      if (userApproves !== true) throw new Error('Plan approval action requires explicit user approval');
      if (userRole !== 'owner') throw new Error('Owner role required to approve desire plans');
      desire = await approveDesireForExecution(desire, userId);
      const { submitDesireExecution } = await import('../../queue/work-submission.js');
      await submitDesireExecution({
        username: userId,
        desireId: desire.id,
        source: 'user',
        idempotencyKey: `desire-execute:${desire.id}:v${desire.plan!.version}`,
        metadata: { producer: 'response-pipeline' },
      });
      nextStatus = 'approved';
      pipelineTriggered = true;
      actionTaken = 'Plan approved and execution queued';
      await emitProposalResolved({
        username: userId,
        proposalId: desire.id,
        response: 'approved',
        taskType: 'desire_execute',
      });
      break;

    case 'revise_plan':
      if (userRole !== 'owner') throw new Error('Owner role required to revise desire plans');
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

      const { submitDesirePlanning } = await import('../../queue/work-submission.js');
      await submitDesirePlanning({
        username: userId,
        desireId: desire.id,
        source: 'user',
        idempotencyKey: `desire-plan:${desire.id}:${desire.updatedAt}`,
        metadata: { producer: 'response-pipeline' },
      });

      await emitProposalResolved({
        username: userId,
        proposalId: desire.id,
        response: 'revise_requested',
        taskType: 'desire_plan',
      });
      break;

    case 'abandon_plan':
      if (userRole !== 'owner') throw new Error('Owner role required to abandon desire plans');
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
        data: { fromStatus: originalStatus, toStatus: nextStatus },
      }, userId);
      break;

    case 'request_clarification':
      actionTaken = 'Requested clarification before changing the plan';
      break;
  }

  return {
    actionTaken,
    pipelineTriggered,
    nextStatus,
    desire,
    response,
    responseBuffer,
  };
}

export default ResponseActionRouterNode;
