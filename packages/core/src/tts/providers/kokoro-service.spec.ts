import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CacheConfig, KokoroConfig } from '../interface.js';
import { KokoroService } from './kokoro-service.js';

const config: KokoroConfig = {
  langCode: 'a',
  voice: 'af_heart',
  speed: 1,
  useCustomVoicepack: false,
  customVoicepackPath: '/unused/custom.pt',
  autoFallbackToPiper: false,
  outputFormat: 'wav',
};

test('Kokoro streaming yields the first phrase before synthesizing later phrases and reuses cache', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-kokoro-cache-'));
  const cache: CacheConfig = { enabled: true, directory: cacheDir, maxSizeMB: 10 };
  const synthesisTexts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'ok' });
    if (url.endsWith('/synthesize')) {
      const request = JSON.parse(String(init?.body)) as { text: string };
      synthesisTexts.push(request.text);
      return new Response(Buffer.from(`wav:${request.text}`), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const text = [
    'The first sentence should become playable quickly for the waiting person.',
    'The second sentence must not delay the first synthesis result unnecessarily.',
    'The third sentence continues with enough detail to require another audio phrase.',
    'The final sentence completes the response after earlier audio is available.',
  ].join(' ');

  try {
    const service = new KokoroService(config, cache);
    const iterator = service.synthesizeStream(text, { requestId: 'stream-test' });
    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(synthesisTexts.length, 1);
    assert.equal(first.value?.index, 0);
    assert.equal(first.value?.cacheHit, false);

    const remaining = [];
    for await (const chunk of iterator) remaining.push(chunk);
    assert.ok(remaining.length >= 1);
    const requestCount = synthesisTexts.length;

    const cached = [];
    for await (const chunk of service.synthesizeStream(text, { requestId: 'cache-test' })) {
      cached.push(chunk);
    }
    assert.equal(synthesisTexts.length, requestCount);
    assert.ok(cached.every(chunk => chunk.cacheHit));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
