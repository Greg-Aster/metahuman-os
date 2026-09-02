import assert from 'node:assert/strict';
import { createTTSPlaybackRequestTracker, useTTS } from './useTTS.js';

const playbackRequests = createTTSPlaybackRequestTracker();
const queuedPlayback = playbackRequests.begin('tts-queued-delivery');

assert.equal(
  playbackRequests.owns('tts-queued-delivery'),
  true,
  'the active queue delivery must own its correlated shared playback request',
);

const manualPlayback = playbackRequests.begin();
assert.equal(
  playbackRequests.interrupt('tts-queued-delivery'),
  false,
  'a stale queue interruption must not target newer explicit manual playback',
);
assert.equal(
  playbackRequests.isActive(manualPlayback),
  true,
  'rejecting a stale queue interruption must preserve manual playback ownership',
);

playbackRequests.finish(queuedPlayback);
assert.equal(
  playbackRequests.isActive(manualPlayback),
  true,
  'completion from superseded queue playback must not clear newer manual ownership',
);

const nextQueuedPlayback = playbackRequests.begin('tts-next-delivery');
assert.equal(
  playbackRequests.interrupt('tts-next-delivery'),
  true,
  'a correlated queue interruption must retain authority over its own playback',
);
assert.equal(
  playbackRequests.isActive(nextQueuedPlayback),
  false,
  'correlated interruption must release queue playback ownership',
);

const originalFetch = globalThis.fetch;
let streamRequestCount = 0;
let queuedStreamStartedResolve: (() => void) | undefined;
let manualStreamStartedResolve: (() => void) | undefined;
let manualStreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
const queuedStreamStarted = new Promise<void>((resolve) => {
  queuedStreamStartedResolve = resolve;
});
const manualStreamStarted = new Promise<void>((resolve) => {
  manualStreamStartedResolve = resolve;
});

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/api/voice-settings')) {
    return Response.json({ provider: 'kokoro' });
  }
  if (url.endsWith('/api/tts-stream')) {
    streamRequestCount += 1;
    if (streamRequestCount === 1) {
      queuedStreamStartedResolve?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        }, { once: true });
      });
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        manualStreamController = controller;
        manualStreamStartedResolve?.();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  return Response.json({});
};

try {
  const ttsApi = useTTS();
  const queuedResult = ttsApi.speak('Queued automatic speech.', {
    streaming: true,
    requestId: 'tts-runtime-delivery',
  });
  await queuedStreamStarted;
  ttsApi.interruptPlayback('interrupted');
  assert.equal(await queuedResult, 'interrupted');

  const manualResult = ttsApi.speak('Explicit message replay.', { streaming: true });
  await manualStreamStarted;
  assert.equal(
    ttsApi.interruptPlaybackRequest('tts-runtime-delivery', 'interrupted'),
    false,
    'the late queue interruption must be rejected after manual replay owns the channel',
  );
  manualStreamController?.enqueue(new TextEncoder().encode(
    'data: {"event":"complete","total_chunks":0}\n\n',
  ));
  manualStreamController?.close();
  assert.equal(
    await manualResult,
    'completed',
    'manual replay must survive the stale queue interruption and complete',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('useTTS.spec.ts passed');
