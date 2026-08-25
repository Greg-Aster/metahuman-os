import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCuriosityAnswer, type ResponsePipelineRequest } from './response-pipeline.js';

function request(cardType: string, questionId?: string): ResponsePipelineRequest {
  return {
    message: 'Here is my answer.',
    cardType,
    cardData: { questionId },
  };
}

test('response pipeline resolves only curiosity cards through the canonical store', async () => {
  const calls: unknown[][] = [];
  const resolver = {
    resolve: async (...args: unknown[]) => {
      calls.push(args);
      return { changed: true, record: {} as never };
    },
  };
  await resolveCuriosityAnswer(request('agency_notification', 'cur-q-one'), 'alice', resolver as never);
  assert.equal(calls.length, 0);

  await resolveCuriosityAnswer(request('curiosity_response', 'cur-q-one'), 'alice', resolver as never);
  assert.deepEqual(calls, [['alice', 'cur-q-one', 'answered']]);
});

test('curiosity response without a question id fails instead of reporting success', async () => {
  await assert.rejects(
    () => resolveCuriosityAnswer(request('curiosity_response'), 'alice'),
    /requires a questionId/,
  );
});
