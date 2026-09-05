import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResponsePipelineRequestBody,
  responsePipelineCardTypeForReply,
} from './conversation-transport.js';

test('response pipeline routing is limited to stateful card interactions', () => {
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    questionId: 'curiosity-one',
  }), 'curiosity_response');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'plan_rejected',
  }), 'desire_rejection');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'clarifying_questions',
  }), 'clarifying_questions');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'approval_requested',
  }), 'desire_plan');
});

test('ordinary selected replies and passive Agency notices use the active conversation graph', () => {
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    cardType: 'assistant_message',
  }), null);

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'agent',
    dialogueSource: 'agency-system',
    cardType: 'desire_checkin_status',
  }), null);
});

test('response pipeline requests carry the conversation session id', () => {
  assert.deepEqual(
    buildResponsePipelineRequestBody(
      '  answer  ',
      'curiosity_response',
      { questionId: 'curiosity-one' },
      'conversation-one',
      'buffer-one',
    ),
    {
      message: 'answer',
      cardType: 'curiosity_response',
      cardData: { questionId: 'curiosity-one' },
      sessionId: 'conversation-one',
      responseBufferId: 'buffer-one',
    },
  );
});
