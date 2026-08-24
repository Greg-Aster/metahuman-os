import assert from "node:assert/strict";
import test from 'node:test';
import { HuggingFaceProvider } from './huggingface.js';
import { RunPodServerlessProvider } from './runpod.js';

test('rejects incomplete provider configuration at construction', () => {
  assert.throws(
    () => new RunPodServerlessProvider({ apiKey: '', endpointId: 'endpoint' }),
    /API key is required/,
  );
  assert.throws(
    () => new HuggingFaceProvider({ apiKey: 'token', endpointUrl: '', timeout: 1000 }),
    /endpoint URL is required/,
  );
});

test('honors a zero-retry RunPod policy', async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('offline');
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new RunPodServerlessProvider({
    apiKey: 'token',
    endpointId: 'endpoint',
    maxRetries: 0,
  });
  await assert.rejects(
    provider.generate([{ role: 'user', content: 'hello' }]),
    /Network error: offline/,
  );
  assert.equal(calls, 1);
});

test('rejects unsupported HuggingFace image content before transport', async () => {
  const provider = new HuggingFaceProvider({
    apiKey: 'token',
    endpointUrl: 'https://example.test/generate',
  });
  await assert.rejects(
    provider.generate([{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    }]),
    /do not support image message content/,
  );
});
