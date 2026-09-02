import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ROOT, getNode, getNodeSchema } from '@metahuman/core';
import {
  curiosityQuestionIdForExecution,
  evaluateQuestionAdmission,
  requireCuriosityDelivery,
  run,
} from './core.js';

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

test('agent runtime refuses to fabricate a profile identity', async () => {
  const result = await run(
    { username: '__missing-curiosity-profile__' } as never,
    {} as never,
  );
  assert.equal(result.success, false);
  assert.match(result.error || '', /No authenticated user found/);
});

test('coordinator execution identity produces a stable path-safe question id', () => {
  const first = curiosityQuestionIdForExecution('task:curiosity:one');
  assert.equal(first, curiosityQuestionIdForExecution('task:curiosity:one'));
  assert.notEqual(first, curiosityQuestionIdForExecution('task:curiosity:two'));
  assert.match(first || '', /^cur-q-task-[a-f0-9]{32}$/);
  assert.equal(curiosityQuestionIdForExecution(''), undefined);
});

test('delivery completion requires the exact buffered question and Persona Memory save', () => {
  const entries = [{ role: 'assistant', content: 'Why?', meta: { questionId: 'cur-q-one' } }];
  assert.deepEqual(
    requireCuriosityDelivery(
      'cur-q-one',
      { persisted: true, entries },
      { saved: true, savedCount: 1 },
    ),
    entries,
  );
  assert.throws(
    () => requireCuriosityDelivery('cur-q-one', { persisted: false, entries: [] }, { saved: true, savedCount: 0 }),
    /Conversation Buffer/,
  );
  assert.throws(
    () => requireCuriosityDelivery('cur-q-one', { persisted: true, entries }, { saved: false, savedCount: 0 }),
    /Persona Memory/,
  );
});

test('graph routes the persisted question through conversation, memory, and TTS owners', () => {
  const graph = JSON.parse(fs.readFileSync(`${ROOT}/etc/cognitive-graphs/curiosity-mode.json`, 'utf8'));
  const ttsEdge = graph.edges.find((edge: { target: string }) => edge.target === '9');
  const bufferEdge = graph.edges.find((edge: { target: string }) => edge.target === '8');
  const memoryEdge = graph.edges.find((edge: { target: string }) => edge.target === '10');
  const personaEdge = graph.edges.find((edge: { target: string }) => edge.target === '7');
  assert.equal(ttsEdge.source, '8');
  assert.equal(ttsEdge.sourceHandle, 'response');
  assert.equal(ttsEdge.targetHandle, 'conversation');
  assert.equal(bufferEdge.source, '4');
  assert.equal(bufferEdge.sourceHandle, 'entry');
  assert.equal(memoryEdge.source, '8');
  assert.equal(memoryEdge.sourceHandle, 'entries');
  assert.equal(memoryEdge.targetHandle, 'entries');
  assert.equal(personaEdge.sourceHandle, 'persona');
  assert.equal(personaEdge.targetHandle, 'persona');
  assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'audit_logger'), false);

  const nodes = new Map(graph.nodes.map((node: any) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = getNode((nodes.get(edge.source) as any).data.nodeType);
    const target = getNode((nodes.get(edge.target) as any).data.nodeType);
    assert.ok(source?.outputs.some(output => output.name === edge.sourceHandle), `undeclared source handle: ${edge.id}`);
    assert.ok(target?.inputs.some(input => input.name === edge.targetHandle), `undeclared target handle: ${edge.id}`);
  }
});

test('Curiosity Question Saver browser schema matches its executable contract', () => {
  const node = getNode('curiosity_question_saver');
  const schema = getNodeSchema('curiosity_question_saver');
  assert.ok(node);
  assert.ok(schema);
  assert.deepEqual(schema.inputs.map(input => input.name), node.inputs.map(input => input.name));
  assert.deepEqual(schema.outputs.map(output => output.name), node.outputs.map(output => output.name));
  assert.equal(schema.category, node.category);
});
