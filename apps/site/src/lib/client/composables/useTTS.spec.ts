import assert from 'node:assert/strict';
import {
  createTTSPlaybackRequestTracker,
  normalizeTextForSpeech,
  useTTS,
} from './useTTS.js';

assert.equal(
  normalizeTextForSpeech('First paragraph.\n\nSecond   paragraph.'),
  'First paragraph.\n\nSecond paragraph.',
  'speech normalization must preserve paragraph boundaries for chunking',
);

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
const originalWindow = globalThis.window;
let streamRequestCount = 0;
let scheduledStreamSources = 0;
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

    const body = streamRequestCount === 2
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            manualStreamController = controller;
            manualStreamStartedResolve?.();
          },
        })
      : new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              'data: {"chunk_index":0,"total_sentences":2,"audio_base64":"AQ==","is_final":false}\n\n',
            ));
            controller.enqueue(new TextEncoder().encode(
              'data: {"event":"complete","total_chunks":1}\n\n',
            ));
            controller.close();
          },
        });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  return Response.json({});
};

class FakeAudioBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect() {}
  start() {
    scheduledStreamSources += 1;
    queueMicrotask(() => this.onended?.());
  }
  stop() {}
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  async resume() {}
  async close() {}
  async decodeAudioData() {
    return { duration: 0.1 };
  }
  createBufferSource() {
    return new FakeAudioBufferSource();
  }
  createBuffer() {
    return {};
  }
}

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

  globalThis.window = {
    AudioContext: FakeAudioContext,
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis;
  assert.equal(
    await ttsApi.speak('First phrase should start immediately.', { streaming: true }),
    'completed',
  );
  assert.equal(
    scheduledStreamSources,
    1,
    'the first decoded phrase must be scheduled without waiting for a second chunk',
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
  else globalThis.window = originalWindow;
}

console.log('useTTS.spec.ts passed');
