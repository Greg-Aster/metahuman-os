import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeActionStream,
  type BridgeConfig,
} from './core.js';

const config: BridgeConfig = {
  adapterUrl: 'ws://127.0.0.1:8790/environment',
  adapterToken: 'adapter-token',
  coreUrl: 'http://127.0.0.1:4321',
  serviceToken: 'service-token',
  graph: 'environment',
};

test('unexpected action stream completion fails the bridge connection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  )) as typeof fetch;

  try {
    await assert.rejects(
      consumeActionStream(
        config,
        'robot-session',
        async () => {},
        new AbortController().signal,
      ),
      /action stream ended unexpectedly/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
