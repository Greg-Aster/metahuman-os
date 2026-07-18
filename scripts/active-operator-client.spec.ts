import assert from 'node:assert/strict';
import {
  ActiveOperatorClientError,
  parseActiveOperatorCliOptions,
  requestActiveOperator,
} from './active-operator-client.js';

const originalFetch = globalThis.fetch;

async function main(): Promise<void> {
  try {
    const options = parseActiveOperatorCliOptions([
      '--url=http://127.0.0.1:9999/',
      '--session=test-session',
      '--username=owner',
    ]);
    assert.equal(options.serverUrl, 'http://127.0.0.1:9999');
    assert.equal(options.sessionId, 'test-session');

    let requestUrl = '';
    let requestHeaders = new Headers();
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ success: true, mode: 'full' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await requestActiveOperator<{ success: boolean; mode: string }>(
      '/api/active-operator/control',
      options,
      { method: 'POST', body: JSON.stringify({ action: 'set-mode', mode: 'full' }) },
    );
    assert.deepEqual(response, { success: true, mode: 'full' });
    assert.equal(requestUrl, 'http://127.0.0.1:9999/api/active-operator/control');
    assert.equal(requestHeaders.get('cookie'), 'mh_session=test-session');
    assert.equal(requestHeaders.get('content-type'), 'application/json');

    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Only owner can control active operator' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(
      () => requestActiveOperator('/api/active-operator/control', options, { method: 'POST' }),
      (error: unknown) => error instanceof ActiveOperatorClientError
        && error.status === 403
        && error.message === 'Only owner can control active operator',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('active operator CLI client contract passed');
}

void main();
