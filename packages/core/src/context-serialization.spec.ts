import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeContext } from './context-serialization.js';

function expandReferences(root: any): any {
  function expand(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
      const target = value.$ref.slice(2).split('/').reduce((object: any, key: string) =>
        object[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
      return expand(target);
    }
    return Array.isArray(value) ? value.map(expand)
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
  }
  return expand(root);
}

test('repeated observations and action receipts remain losslessly accessible with their provenance', () => {
  const observation = { summary: 'A book beside a lamp on the table.', observedAt: '2026-10-08T12:00:00Z', frameId: 'frame-1', source: 'camera' };
  const action = { id: 'action-1', type: 'robotCommand', command: 'bow', result: 'completed', at: '2026-10-09T12:00:00Z' };
  const input = { observationHistory: [observation], robotStatus: {
    latestVisualObservation: observation, lastAction: action, lastBodyAction: action,
  }, history: [{ role: 'user', content: 'What did you dream last night?', timestamp: '2026-10-09T12:00:01Z' },
    { role: 'inner', content: 'A dated dream.', timestamp: '2026-10-08T02:00:00Z' }],
    objective: 'Look at the table', capabilities: { actions: ['takePicture', 'robotCommand'] } };
  const result = serializeContext(input);
  assert(result.length < JSON.stringify(input).length);
  assert.deepEqual(JSON.parse(result).robotStatus.latestVisualObservation, { $ref: '#/observationHistory/0' });
  assert.deepEqual(expandReferences(JSON.parse(result)), input);
  assert.deepEqual(input.robotStatus.lastBodyAction, action);
});

test('distinct dates, speakers and receipts are not conflated; pointer keys are escaped', () => {
  const fact = { content: 'The same words with different source and time.', role: 'user', at: '2026-10-08' };
  const input = { 'a/b~c': fact, same: fact, otherSpeaker: { ...fact, role: 'assistant' }, otherDate: { ...fact, at: '2026-10-09' }, empty: [{}, {}] };
  const result = JSON.parse(serializeContext(input));
  assert.deepEqual(result.same, { $ref: '#/a~1b~0c' });
  assert.deepEqual(result.otherSpeaker, input.otherSpeaker);
  assert.deepEqual(result.otherDate, input.otherDate);
  assert.deepEqual(result.empty, [{}, {}]);
  assert.deepEqual(expandReferences(result), input);
});
