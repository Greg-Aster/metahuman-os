import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('card response buffer appends a complete exchange in one owner operation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'metahuman-response-buffer-'));
  process.env.METAHUMAN_ROOT = root;

  try {
    const {
      appendExchangeToResponseBuffer,
      createResponseBuffer,
      loadResponseBuffer,
    } = await import('./response-buffer.js');

    const created = createResponseBuffer(
      'profile-a',
      'curiosity_response',
      'question-one',
      'What did you learn?',
    );
    const updated = appendExchangeToResponseBuffer(
      'profile-a',
      created.id,
      'I learned this.',
      'Thank you for answering.',
      'Curiosity question marked answered',
    );

    assert.deepEqual(updated?.exchanges.map(exchange => exchange.role), ['user', 'assistant']);
    assert.equal(updated?.exchanges[1]?.action, 'Curiosity question marked answered');

    assert.throws(
      () => appendExchangeToResponseBuffer('profile-a', created.id, '', 'Assistant', 'Recorded'),
      /requires user text/,
    );
    assert.equal(loadResponseBuffer('profile-a', created.id)?.exchanges.length, 2);
  } finally {
    delete process.env.METAHUMAN_ROOT;
    await rm(root, { recursive: true, force: true });
  }
});
