import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONParserNode } from './json-parser.node.js';

test('JSON Parser reads the named text input used by graph edges', async () => {
  const result = await JSONParserNode.execute({
    text: '{"type":"captureImage"}',
  }, {}, {});

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { type: 'captureImage' });
  assert.equal(result.raw, '{"type":"captureImage"}');
});

test('JSON Parser retains legacy indexed input compatibility', async () => {
  const result = await JSONParserNode.execute({
    0: '{"type":"robotCommand","command":"wave"}',
  }, {}, {});

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { type: 'robotCommand', command: 'wave' });
});
