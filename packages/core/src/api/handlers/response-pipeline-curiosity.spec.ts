import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResponsePipelineExecutionContext,
  resolveCuriosityAnswer,
  type ResponsePipelineRequest,
} from './response-pipeline.js';

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

test('response pipeline execution uses a real cognitive mode for memory policy', () => {
  const environment = buildResponsePipelineExecutionContext(
    request('curiosity_response', 'cur-q-one'),
    'alice',
    'environment',
  );
  assert.equal(environment.cognitiveMode, 'environment');
  assert.equal(environment.allowMemoryWrites, true);
  assert.equal(environment.recordPersonaMemory, true);

  const emulation = buildResponsePipelineExecutionContext(
    request('curiosity_response', 'cur-q-one'),
    'alice',
    'emulation',
  );
  assert.equal(emulation.cognitiveMode, 'emulation');
  assert.equal(emulation.allowMemoryWrites, false);
  assert.equal(emulation.recordPersonaMemory, true);
});
