import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { useTTS } from './useTTS.js';

const tts = useTTS();
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalSetTimeout = globalThis.setTimeout;
const encoder = new TextEncoder();
const sources: FakeSource[] = [];
const requests: Record<string, unknown>[] = [];
let controller!: ReadableStreamDefaultController<Uint8Array>;
let requested: (() => void) | undefined;
let started: (() => void) | undefined;
let pollTimers = 0;
let contextTime = 0;

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startAt = -1;
  stopped = false;
  connect() {}
  start(at: number) { this.startAt = at; sources.push(this); started?.(); }
  stop() { this.stopped = true; this.onended?.(); }
}
class FakeContext {
  state = 'running';
  get currentTime() { return contextTime; }
  destination = {};
  async resume() {}
  async close() {}
  async decodeAudioData() { return { duration: 1 }; }
  createBufferSource() { return new FakeSource(); }
}
function emit(data: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}
function audio(index: number, total = 2) {
  emit({ chunk_index: index, total_sentences: total, audio_base64: 'AQ==', is_final: index === total - 1 });
}
async function begin(id: string, provider = 'kokoro') {
  const requestReady = new Promise<void>(resolve => { requested = resolve; });
  const outcome = tts.speak('Hello! The second phrase is still being synthesized.', {
    provider, voice: provider === 'kitten' ? 'Jasper' : 'af_heart', langCode: 'a', speed: 0.9,
    streaming: provider === 'kitten' ? undefined : true, requestId: id,
  });
  await requestReady;
  return { outcome };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

globalThis.window = { AudioContext: FakeContext, dispatchEvent: () => true } as unknown as Window & typeof globalThis;
globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
  if (delay === 50) pollTimers += 1;
  return originalSetTimeout(callback, delay, ...args);
}) as typeof setTimeout;
globalThis.fetch = async (input, init) => {
  if (String(input).endsWith('/api/tts-stream')) {
    requests.push(JSON.parse(String(init?.body)));
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        init?.signal?.addEventListener('abort', () => {
          try { value.error(new DOMException('Aborted', 'AbortError')); } catch {}
        }, { once: true });
      },
    });
    requested?.();
    return new Response(body);
  }
  if (String(input).endsWith('/api/pause-state')) return Response.json({});
  throw new Error(`Unexpected preview request: ${input}`);
};

try {
  const first = await begin('preview-first');
  const firstScheduled = new Promise<void>(resolve => { started = resolve; });
  audio(0);
  await firstScheduled;
  assert.equal(sources.length, 1, 'first phrase plays before the server produces the second');
  assert.equal(get(tts.isLoading), false);
  assert.equal(requests[0]?.text, 'Hello! The second phrase is still being synthesized.');
  assert.equal(requests[0]?.voice, 'af_heart');
  assert.equal(requests[0]?.langCode, 'a');
  assert.equal(requests[0]?.speed, 0.9);

  contextTime = 0.25;
  const secondScheduled = new Promise<void>(resolve => { started = resolve; });
  audio(1);
  await secondScheduled;
  assert.equal(sources[1]!.startAt, sources[0]!.startAt + 1, 'buffered audio is scheduled contiguously');
  emit({ event: 'complete', total_chunks: 2 });
  controller.close();
  let settled = false;
  void first.outcome.then(() => { settled = true; });
  await turn();
  assert.equal(settled, false, 'HTTP completion must not acknowledge unfinished playback');
  assert.equal(pollTimers, 0, 'waiting for audio completion must use events, not a polling timer');
  sources[0]!.onended?.();
  await turn();
  assert.equal(settled, false, 'the second buffered phrase still owns playback');
  sources[1]!.onended?.();
  assert.equal(await first.outcome, 'completed');

  const interrupted = await begin('preview-interrupted');
  const scheduled = new Promise<void>(resolve => { started = resolve; });
  audio(0, 1);
  await scheduled;
  emit({ event: 'complete', total_chunks: 1 });
  controller.close();
  await turn();
  assert.equal(tts.interruptPlaybackRequest('preview-interrupted'), true);
  assert.equal(await interrupted.outcome, 'interrupted', 'interrupt settles even after the HTTP stream closes');

  const superseded = await begin('preview-superseded');
  const supersededController = controller;
  const newer = await begin('preview-newer');
  assert.equal(await superseded.outcome, 'interrupted');
  assert.equal(get(tts.isStreaming), true, 'old request cleanup must not clear the newer stream state');
  assert.notEqual(controller, supersededController);
  emit({ event: 'complete', total_chunks: 0 });
  controller.close();
  assert.equal(await newer.outcome, 'completed');

  for (const failure of ['missing', 'out-of-order', 'provider-error', 'truncated']) {
    const failed = await begin(`preview-${failure}`);
    if (failure === 'missing') emit({ event: 'complete', total_chunks: 1 });
    else if (failure === 'out-of-order') audio(1);
    else if (failure === 'provider-error') emit({ event: 'error', error: 'Synthetic inference failure' });
    controller.close();
    assert.equal(await failed.outcome, 'failed', `${failure} must fail visibly without hanging or acknowledging success`);
  }
  const kitten = await begin('kitten-auto-stream', 'kitten');
  const kittenScheduled = new Promise<void>(resolve => { started = resolve; });
  audio(0, 1);
  await kittenScheduled;
  assert.equal(requests.at(-1)?.provider, 'kitten', 'Kitten automatically uses the existing streaming endpoint');
  assert.equal(requests.at(-1)?.voice, 'Jasper');
  emit({ event: 'complete', total_chunks: 1 });
  controller.close();
  await turn();
  sources.at(-1)!.onended?.();
  assert.equal(await kitten.outcome, 'completed');
  console.log('useTTS-streaming.spec.ts: first audio, buffering, event completion, cancellation, isolation, failures and Kitten passed');
} finally {
  tts.cleanup();
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
  else globalThis.window = originalWindow;
}
