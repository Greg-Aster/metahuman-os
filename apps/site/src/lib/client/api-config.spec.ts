import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEventSource, apiFetch, apiUrl, getApiBaseUrl, getApiBaseUrlAsync, getSyncServerUrl, isHostedUi, isSessionAuthenticationFailure, setBackendUrl, setServerUrl } from './api-config.js';

assert.equal(
  isSessionAuthenticationFailure(401),
  true,
  '401 must send the user back through the authentication gate',
);
assert.equal(
  isSessionAuthenticationFailure(403),
  false,
  '403 is an authorization denial and must not destroy a valid session',
);

console.log('API auth/session boundary contract passed');

test('hosted transport selects a machine for requests, streams and media without changing profile sync', async () => {
  const keys = ['window', 'localStorage', '__METAHUMAN_STATIC_UI__', 'fetch', 'EventSource'] as const;
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map<string, string>();
  const requests: { url: string; options?: RequestInit }[] = [];
  class Source {
    constructor(readonly url: string, readonly options?: EventSourceInit) {}
  }
  try {
    Object.assign(globalThis, {
      window: new EventTarget(),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      __METAHUMAN_STATIC_UI__: true,
      fetch: async (url: string, options?: RequestInit) => {
        requests.push({ url, options });
        return new Response('{}', { status: 200 });
      },
      EventSource: Source,
    });

    assert.equal(isHostedUi(), true);
    assert.equal(getApiBaseUrl(), '');
    setBackendUrl('https://desktop.ainek.io/');
    assert.equal(await getApiBaseUrlAsync(), 'https://desktop.ainek.io');
    await setServerUrl('https://sync.example.test');
    assert.equal(getApiBaseUrl(), 'https://desktop.ainek.io');
    assert.equal(getSyncServerUrl(), 'https://sync.example.test');

    await apiFetch('/api/auth/login', { method: 'POST', body: '{"username":"fixture"}' });
    assert.equal(requests[0].url, 'https://desktop.ainek.io/api/auth/login');
    assert.equal(requests[0].options?.credentials, 'include');
    assert.equal(requests[0].options?.method, 'POST');
    assert.equal(requests[0].options?.body, '{"username":"fixture"}');
    await apiFetch('/api/status', { credentials: 'omit' });
    assert.equal(requests[1].options?.credentials, 'omit');
    const stream = apiEventSource('/api/buffer-stream?mode=conversation') as unknown as Source;
    assert.equal(stream.url, 'https://desktop.ainek.io/api/buffer-stream?mode=conversation');
    assert.equal(stream.options?.withCredentials, true);
    assert.equal(apiUrl('/api/persona-icon'), 'https://desktop.ainek.io/api/persona-icon');
    assert.equal(apiUrl('blob:fixture-audio'), 'blob:fixture-audio');
    assert.equal(apiUrl('https://other.example.test/asset'), 'https://other.example.test/asset');

    setBackendUrl('https://q6a.ainek.io');
    assert.equal(apiUrl('/api/status'), 'https://q6a.ainek.io/api/status');
    assert.equal(getSyncServerUrl(), 'https://sync.example.test');

    Object.assign(globalThis, { __METAHUMAN_STATIC_UI__: false });
    assert.equal(getApiBaseUrl(), '', 'a saved hosted backend must not redirect the local app');
    await apiFetch('/api/auth/me');
    assert.equal(requests.at(-1)?.url, '/api/auth/me');
    assert.equal(requests.at(-1)?.options?.credentials, 'same-origin');
    const localStream = apiEventSource('/api/queue-stream') as unknown as Source;
    assert.equal(localStream.url, '/api/queue-stream');
    assert.equal(localStream.options?.withCredentials, false);

    Object.assign(globalThis, { __METAHUMAN_STATIC_UI__: true });
    setBackendUrl('');
    assert.equal(getApiBaseUrl(), '');
  } finally {
    await setServerUrl('');
    for (const key of keys) {
      const descriptor = original.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
