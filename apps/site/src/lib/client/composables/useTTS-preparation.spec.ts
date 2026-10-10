import assert from 'node:assert/strict';
import { useTTS } from './useTTS.js';

// Exercise the actual preparation and playback owners with controlled transport
// and an inaudible AudioContext. No model, service, profile or robot is invoked.
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const tts = useTTS();
const encoder = new TextEncoder();
const requests = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
const sources: Source[] = [];
let syntheses = 0;
class Source {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect() {}
  start() { sources.push(this); }
  stop() { this.onended?.(); }
}
class Context {
  state = 'running';
  currentTime = 0;
  destination = {};
  async resume() {}
  async close() {}
  async decodeAudioData() { return { duration: 10 }; }
  createBufferSource() { return new Source(); }
}
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 100; turn++) {
    if (condition()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.fail('Expected asynchronous handoff did not arrive');
}
function emit(id: string, event: Record<string, unknown>) {
  requests.get(id)!.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}
function audio(id: string) {
  emit(id, { chunk_index: 0, total_sentences: 1, audio_base64: 'AQ==', is_final: true });
}
function finish(id: string) {
  emit(id, { event: 'complete', total_chunks: 1 });
  requests.get(id)!.close();
}
globalThis.window = { AudioContext: Context, dispatchEvent: () => true } as unknown as Window & typeof globalThis;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/api/pause-state')) return Response.json({});
  if (String(url) === '/api/voice-settings') return Response.json({ provider: 'piper' });
  if (String(url) === '/api/voice-models') return Response.json({ multiVoice: false });
  if (String(url) === '/api/tts') {
    syntheses++;
    return new Response(new Uint8Array([1]));
  }
  assert.equal(String(url), '/api/tts-stream');
  const body = JSON.parse(String(init?.body));
  syntheses++;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    requests.set(body.requestId, controller);
    init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } }));
};

try {
  const first = tts.prepareSpeech('First queued utterance.', { provider: 'kokoro', requestId: 'first' });
  const second = tts.prepareSpeech('Second queued utterance.', { provider: 'kokoro', requestId: 'second' });
  const playingFirst = tts.speak(first.text, { requestId: 'first', prepared: first });
  await until(() => requests.has('first'));
  audio('first');
  await until(() => sources.length === 1);
  assert.equal(requests.has('second'), false, 'synthesis retains admission order');
  finish('first');
  await until(() => requests.has('second'));
  audio('second');
  finish('second');
  await second.finished;
  assert.equal(sources.length, 1, 'the second utterance is prepared while the first still owns playback');
  sources[0]!.onended?.();
  assert.equal(await playingFirst, 'completed');
  const playingSecond = tts.speak(second.text, { requestId: 'second', prepared: second });
  await until(() => sources.length === 2);
  assert.equal(syntheses, 2, 'playback consumes prepared audio without another synthesis');
  sources[1]!.onended?.();
  assert.equal(await playingSecond, 'completed');

  const cancelled = tts.prepareSpeech('Cancelled preparation.', { provider: 'kokoro', requestId: 'cancelled' });
  const following = tts.prepareSpeech('Preparation after cancellation.', { provider: 'kokoro', requestId: 'following' });
  await until(() => requests.has('cancelled'));
  cancelled.cancel();
  await assert.rejects(tts.speak(cancelled.text, { prepared: cancelled }), /abort/i);
  await until(() => requests.has('following'));
  audio('following');
  finish('following');
  await following.finished;
  following.cancel();
  await assert.rejects(tts.speak(following.text, { prepared: following }), /abort/i);
  assert.equal(sources.length, 2, 'interrupted preparation cannot later play, even after all audio was buffered');

  const broken = tts.prepareSpeech('Transport failure.', { provider: 'kokoro', requestId: 'broken' });
  await until(() => requests.has('broken'));
  requests.get('broken')!.error(new Error('Synthetic connection failure'));
  await broken.finished;
  assert.equal(await tts.speak(broken.text, { prepared: broken }), 'failed');
  assert.equal(sources.length, 2, 'failed transport cannot report successful playback');

  const batch = tts.prepareSpeech('Batch provider preparation.', { provider: 'piper', requestId: 'batch' });
  await batch.finished;
  const requestsBeforePlayback = syntheses;
  const batchPlayback = tts.speak(batch.text, { requestId: 'batch', prepared: batch });
  await until(() => sources.length === 3);
  sources[2]!.onended?.();
  assert.equal(await batchPlayback, 'completed');
  assert.equal(syntheses, requestsBeforePlayback, 'batch playback also consumes its preparation without another synthesis');
  console.log('useTTS-preparation.spec.ts: overlapping preparation, ordered playback, cancellation, failure and batch audio passed');
} finally {
  tts.cleanup();
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
  else globalThis.window = originalWindow;
}
