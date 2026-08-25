import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ROOT } from '@metahuman/core';
import { evaluateQuestionAdmission, run } from './core.js';

test('admission enforces disable, trust, and exact open-question limits', () => {
  assert.equal(evaluateQuestionAdmission({
    maxOpenQuestions: 0,
    openQuestions: 50,
    currentTrust: 'observe',
    requiredTrust: 'observe',
  }), 'disabled');
  assert.equal(evaluateQuestionAdmission({
    maxOpenQuestions: 5,
    openQuestions: 0,
    currentTrust: 'observe',
    requiredTrust: 'suggest',
  }), 'trust');
  assert.equal(evaluateQuestionAdmission({
    maxOpenQuestions: 5,
    openQuestions: 5,
    currentTrust: 'suggest',
    requiredTrust: 'observe',
  }), 'max-open');
  assert.equal(evaluateQuestionAdmission({
    maxOpenQuestions: 5,
    openQuestions: 4,
    currentTrust: 'suggest',
    requiredTrust: 'observe',
  }), null);
  assert.throws(() => evaluateQuestionAdmission({
    maxOpenQuestions: 5,
    openQuestions: 0,
    currentTrust: 'invalid',
    requiredTrust: 'observe',
  }), /Unknown current trust level/);
});

test('agent runtime reports unsupported input as a real failure', async () => {
  const result = await run({ username: 'alice' } as never, { args: ['--legacy'] } as never);
  assert.equal(result.success, false);
  assert.match(result.error || '', /does not accept/);
});

test('graph publishes conversation and TTS only from the persisted saver output', () => {
  const graph = JSON.parse(fs.readFileSync(`${ROOT}/etc/cognitive-graphs/curiosity-mode.json`, 'utf8'));
  const ttsEdge = graph.edges.find((edge: { target: string }) => edge.target === '9');
  const bufferEdge = graph.edges.find((edge: { target: string }) => edge.target === '8');
  assert.equal(ttsEdge.source, '4');
  assert.equal(ttsEdge.sourceHandle, 'question');
  assert.equal(bufferEdge.source, '4');
  assert.equal(bufferEdge.sourceHandle, 'entry');

  const saverSource = fs.readFileSync(`${ROOT}/packages/core/src/nodes/curiosity/curiosity-question-saver.node.ts`, 'utf8');
  assert.ok(saverSource.indexOf('curiosityQuestionStore.create') < saverSource.indexOf("event: 'chat_assistant'"));
});
