import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHealth, forceHealthCheck } from './server-health.js';

test('chat reachability uses the session endpoint without waiting for the full status report', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url !== '/api/auth/me') throw new Error('Full system status is too slow for a reachability check');
    assert.equal(init?.method, 'GET');
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ success: true, user: { username: 'fixture' } });
  };
  try {
    assert.equal((await forceHealthCheck()).connected, true);
    assert.deepEqual(requests, ['/api/auth/me']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expired authentication remains reachable while genuine server and transport errors are reported', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const code of [401, 403]) {
      globalThis.fetch = async () => new Response(null, { status: code });
      assert.equal((await checkHealth()).connected, true);
    }
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const unavailable = await checkHealth();
    assert.equal(unavailable.connected, false);
    assert.equal(unavailable.error, 'Server returned 503');
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    const disconnected = await checkHealth();
    assert.equal(disconnected.connected, false);
    assert.equal(disconnected.error, 'Network unavailable');
    assert.equal(disconnected.consecutiveFailures, unavailable.consecutiveFailures + 1);
    globalThis.fetch = async () => Response.json({ success: true });
    const restored = await checkHealth();
    assert.equal(restored.connected, true);
    assert.equal(restored.consecutiveFailures, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the local mobile runtime uses the same lightweight session handler', async () => {
  const originalFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { ReactNativeWebView: {} } as unknown as Window & typeof globalThis;
  globalThis.fetch = async input => {
    assert.equal(String(input), 'http://127.0.0.1:4322/api/auth/me');
    return Response.json({ success: true });
  };
  try {
    assert.equal((await checkHealth()).connected, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else globalThis.window = previousWindow;
  }
});

test('a slow successful response remains connected rather than displaying offline', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let clock = 0;
  Date.now = () => clock;
  globalThis.fetch = async () => {
    clock = 1500;
    return Response.json({ success: true });
  };
  try {
    const status = await checkHealth();
    assert.equal(status.connected, true);
    assert.equal(status.latencyMs, 1500);
    assert.equal(status.quality, 'poor');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
