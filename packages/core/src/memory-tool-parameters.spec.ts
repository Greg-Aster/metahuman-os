import assert from 'node:assert/strict';
import test from 'node:test';
import { toToolParameters } from './memory.js';

test('normalizes connector metadata at the episodic-memory boundary', () => {
  assert.deepEqual(toToolParameters({
    title: 'Example',
    optional: undefined,
    capturedAt: new Date('2026-08-24T12:00:00.000Z'),
    invalidNumber: Number.NaN,
    nested: {
      keep: true,
      omit: undefined,
    },
    list: [1, undefined, 'three'],
  }), {
    title: 'Example',
    capturedAt: '2026-08-24T12:00:00.000Z',
    invalidNumber: null,
    nested: { keep: true },
    list: [1, null, 'three'],
  });
});
