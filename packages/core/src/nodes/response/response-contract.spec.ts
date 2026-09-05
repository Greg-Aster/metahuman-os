import assert from 'node:assert/strict';
import test from 'node:test';
import { ResponseActionRouterNode, validateResponseAction } from './response-action-router.node.js';
import { parseBigBrotherResponse, parseLocalResponse } from './response-llm.node.js';

test('Big Brother response parsing requires an explicit action contract', () => {
  assert.deepEqual(
    parseBigBrotherResponse('Thanks for explaining.\n```json\n{"suggestedAction":"resolve_answer","actionData":{"topicExplored":"music"}}\n```'),
    {
      response: 'Thanks for explaining.',
      suggestedAction: 'resolve_answer',
      actionData: { topicExplored: 'music' },
    },
  );

  assert.throws(
    () => parseBigBrotherResponse('Thanks for explaining.'),
    /missing its required JSON action block/,
  );
});

test('local response parsing rejects malformed and incomplete output', () => {
  assert.deepEqual(
    parseLocalResponse(JSON.stringify({
      response: 'I saved your answer.',
      suggestedAction: 'save_answer',
      actionData: { answerComplete: true },
    })),
    {
      response: 'I saved your answer.',
      suggestedAction: 'save_answer',
      actionData: { answerComplete: true },
    },
  );

  assert.throws(() => parseLocalResponse('not json'), /invalid JSON/);
  assert.throws(
    () => parseLocalResponse(JSON.stringify({ response: 'Missing action', actionData: {} })),
    /no suggestedAction/,
  );
});

test('response actions reject unsupported card and action combinations', () => {
  assert.doesNotThrow(() => validateResponseAction('desire_plan', 'revise_plan'));
  assert.doesNotThrow(() => validateResponseAction('curiosity_response', 'resolve_answer'));
  assert.throws(
    () => validateResponseAction('desire_plan', 'create_task'),
    /Unsupported desire_plan action/,
  );
  assert.throws(
    () => validateResponseAction('agency_notification', 'acknowledge'),
    /Unsupported response card type/,
  );
});

test('desire plan approval requires the owner role before mutation', async () => {
  await assert.rejects(
    () => ResponseActionRouterNode.execute({
      cardType: 'desire_plan',
      suggestedAction: 'approve_plan',
      actionData: { userApproves: true },
      desire: { id: 'desire-one', status: 'reviewing' },
      userId: 'profile-a',
      responseBuffer: { id: 'buffer-one' },
      response: 'I will proceed.',
      cardData: { desireId: 'desire-one' },
      message: 'I approve this plan.',
    }, { userRole: 'standard' }),
    /Owner role required/,
  );
});

test('clarification actions do not mutate Desire state', async () => {
  const clarifyingDesire = {
    id: 'desire-one',
    status: 'questioning',
    clarifyingQuestions: {
      questions: [{ id: 'question-one', text: 'Which option?', required: true }],
      answers: [],
    },
  };
  const detail = await ResponseActionRouterNode.execute({
    cardType: 'clarifying_questions',
    suggestedAction: 'request_more_detail',
    actionData: { answerComplete: false },
    desire: clarifyingDesire,
    userId: 'profile-a',
    responseBuffer: { id: 'buffer-one' },
    response: 'Could you say more?',
    cardData: { desireId: 'desire-one' },
    message: 'Maybe the first one.',
  }, { userRole: 'standard' });
  assert.equal(detail.updatedDesire, clarifyingDesire);
  assert.equal(detail.pipelineTriggered, false);
  assert.equal(clarifyingDesire.clarifyingQuestions.answers.length, 0);

  const rejectedDesire = { id: 'desire-two', status: 'rejected' };
  const rejection = await ResponseActionRouterNode.execute({
    cardType: 'desire_rejection',
    suggestedAction: 'request_clarification',
    actionData: {},
    desire: rejectedDesire,
    userId: 'profile-a',
    responseBuffer: { id: 'buffer-two' },
    response: 'What would you like changed?',
    cardData: { desireId: 'desire-two' },
    message: 'I disagree.',
  }, { userRole: 'standard' });
  assert.equal(rejection.updatedDesire, rejectedDesire);
  assert.equal(rejection.pipelineTriggered, false);
});
