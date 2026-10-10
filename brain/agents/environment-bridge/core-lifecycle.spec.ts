import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import test, { mock } from 'node:test';
import type { BridgeConfig } from './core.js';

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-bridge-lifecycle-'));
assert.equal(fs.realpathSync(isolatedRoot), isolatedRoot);
process.env.METAHUMAN_ROOT = isolatedRoot;
fs.mkdirSync(path.join(isolatedRoot, 'etc'), { recursive: true });
fs.writeFileSync(path.join(isolatedRoot, 'etc/services.json'), JSON.stringify({ services: {
  'environment-bridge-local': { adapterUrl: 'ws://fixture.invalid/environment' },
} }));
globalThis.fetch = async () => { throw new Error('Bridge lifecycle tests prohibit network'); };
mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Test transport disabled'), { code: 'ECONNREFUSED' })));
  return this;
});
const publicCore = await import('@metahuman/core');
assert.equal(publicCore.ROOT, isolatedRoot);
publicCore.setAuditEnabled(false);
let scenario = '';
let sent = 0;
let speechSettingsResults: Record<string, any>[] = [];
let wireUpdates: Record<string, any>[] = [];
let acknowledgements: Record<string, unknown>[] = [];
let finishFixture = () => {};
let audioFinished = () => {};
let observationAcknowledged = () => {};
let fixtureSocket: FakeWebSocket;
class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  constructor() { super(); fixtureSocket = this; queueMicrotask(() => this.emit('open')); }
  send(payload: string | Buffer, callback?: (error?: Error) => void) {
    if (Buffer.isBuffer(payload)) {
      sent++;
      callback?.(new Error('Fixture speech socket send failed'));
      return;
    }
    const message = JSON.parse(payload);
    if (message.type === 'bridge.connect') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'bridge.ready', sessionId: 'robot-session',
        ...((scenario === 'perception' || scenario === 'audio' || scenario.startsWith('update')) ? { observation: { environmentId: 'ainekio', adapter: 'ainekio-gateway',
          sessionId: 'robot-session', timestamp: new Date().toISOString(), capabilities: { actions: ['captureImage'], visual: true },
          state: { activeMovementUpdates: { version: 1, available: true, gatewayInstance: 'gateway-fixture', robotId: 'body-fixture', epoch: 7, maxValidityMs: 1000 } } } } : {}) }), false));
    } else if (message.type === 'audio.utterance.result') {
      assert.equal(message.status, 'completed');
      audioFinished();
    } else if (message.type === 'environment.observation.ack') {
      observationAcknowledged();
    } else if (message.type === 'speech.settings.result' || message.type === 'behavior.settings.result') {
      speechSettingsResults.push(message);
      if (speechSettingsResults.length === 4) queueMicrotask(finishFixture);
    } else if (message.type === 'environment.action.update') {
      wireUpdates.push(message);
      if (scenario === 'update-send') throw new Error('Fixture settings send failed');
      if (scenario === 'update-disconnect') { queueMicrotask(() => this.close()); return; }
      if (scenario === 'update-timeout') return;
      const receipt = {
        type: 'environment.action.update.result', version: 1, sessionId: message.sessionId, actionId: message.actionId, revision: message.revision,
        status: scenario === 'update-unknown' || scenario === 'update-late' ? 'outcome_unknown'
          : scenario === 'update-rejected' ? 'rejected' : 'acknowledged',
        timestamp: new Date().toISOString(), message: 'Fixture update result', sequence: 12,
      };
      if (scenario === 'update-wrong-session') receipt.sessionId = 'another-body-session';
      queueMicrotask(() => {
        this.emit('message', JSON.stringify(receipt), false);
        if (scenario === 'update-late') this.emit('message', JSON.stringify({ ...receipt, status: 'acknowledged' }), false);
        if (scenario === 'update-duplicate') this.emit('message', JSON.stringify(receipt), false);
      });
    } else if (message.type === 'environment.action') {
      sent++;
      if (scenario === 'send') throw new Error('Fixture action socket send failed');
      if (scenario.startsWith('receipt')) {
        queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'environment.feedback', feedback: {
          id: `accepted-${message.action.id}`, actionId: message.action.id, type: 'accepted',
          timestamp: '2026-09-07T20:20:00.000Z', message: 'Adapter saved acceptance',
        } }), false));
      } else queueMicrotask(() => this.close());
    } else if (message.type === 'environment.feedback.ack') {
      acknowledgements.push(message);
      if (scenario !== 'perception') queueMicrotask(finishFixture);
    }
  }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close'); } }
}
const socketMock = mock.module('ws', { defaultExport: FakeWebSocket });
const coreMock = mock.module('@metahuman/core', { namedExports: {
  ...publicCore,
  transcribeAudio: async () => 'Please wave for me.',
  claimRobotSpeech: () => scenario === 'prepare-missing' ? null
    : { id: 'fixture-speech', pcm: Buffer.alloc(640), durationMs: 20 },
} });
const { consumeActionStream, runEnvironmentBridgeAgent } = await import('./core.js');

const config: BridgeConfig = {
  adapterUrl: 'ws://127.0.0.1:8790/environment',
  adapterToken: 'adapter-token',
  coreUrl: 'http://127.0.0.1:4321',
  serviceToken: 'service-token',
  graph: 'environment',
};

test('speech reaches Core before its camera frame, and late frames remain separate observations', async () => {
  scenario = 'audio';
  const controller = new AbortController();
  const observations: Record<string, any>[] = [];
  const originalFetch = globalThis.fetch;
  let run: Promise<void> | undefined;
  const completed = new Promise<void>(resolve => { audioFinished = resolve; });
  const acknowledged = new Promise<void>(resolve => { observationAcknowledged = resolve; });
  const metadata = Buffer.from(JSON.stringify({ type: 'audio.utterance', version: 1,
    sessionId: 'robot-session', utteranceId: 'audio-fixture', robotId: 'body-fixture', epoch: 7,
    startedAt: '2026-10-08T12:00:00.000Z', endedAt: '2026-10-08T12:00:00.020Z',
    firstCounter: 1, lastCounter: 1, frameCount: 1, missingFrames: 0, durationMs: 20,
    wakeTriggered: true, truncated: false, format: 'wav', sampleRateHz: 16000, channels: 1, bitsPerSample: 16 }));
  const header = Buffer.alloc(12);
  header.write('AIKAUD01'); header.writeUInt32LE(metadata.length, 8);
  const wav = Buffer.alloc(684);
  wav.write('RIFF'); wav.writeUInt32LE(676, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(640, 40);
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/environment-bridge/stream') return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
      setImmediate(() => fixtureSocket.emit('message', Buffer.concat([header, metadata, wav]), true));
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    if (pathname === '/api/environment-bridge/observation') observations.push(JSON.parse(String(options?.body)));
    return Response.json({ success: true });
  };
  const timeout = setTimeout(() => { controller.abort(); audioFinished(); observationAcknowledged(); }, 2000);
  try {
    run = runEnvironmentBridgeAgent(controller.signal, config);
    await completed;
    assert.equal(controller.signal.aborted, false, 'Speech must not wait for the legacy five-second image deadline');
    const transcripts = observations.filter(observation => observation.text?.length);
    assert.equal(transcripts.length, 1, 'Completion acknowledges a transcript already delivered to Core');
    assert.equal(transcripts[0].text[0].text, 'Please wave for me.');
    assert.equal(transcripts[0].visual, undefined);
    assert.equal(transcripts[0].metadata.visualStatus, undefined, 'No image timeout should be fabricated');
    const frame = { ...transcripts[0], id: 'late-frame-observation', text: undefined,
      visual: { id: 'late-frame', timestamp: '2026-10-08T12:00:00.010Z',
        mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=' } };
    fixtureSocket.emit('message', JSON.stringify({ type: 'environment.observation', observation: frame }), false);
    await acknowledged;
    assert.equal(observations.filter(observation => observation.text?.length).length, 1);
    assert.deepEqual(observations.at(-1)?.visual, frame.visual, 'The late frame is delivered independently before its ACK');
  } finally {
    controller.abort(); clearTimeout(timeout); await run;
    globalThis.fetch = originalFetch;
  }
});

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

test('action admission crosses a held observation and unrelated face result without reordering its receipts', async () => {
  scenario = 'perception';
  acknowledgements = [];
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const posted: string[] = [];
  const observations: Record<string, any>[] = [];
  let releaseObservation!: () => void;
  let releaseFace!: () => void;
  let releaseAcceptance!: () => void;
  const observationHeld = new Promise<void>(resolve => { releaseObservation = resolve; });
  const faceHeld = new Promise<void>(resolve => { releaseFace = resolve; });
  const acceptanceHeld = new Promise<void>(resolve => { releaseAcceptance = resolve; });
  const emit = (message: Record<string, unknown>) => fixtureSocket.emit('message', JSON.stringify(message), false);
  const feedback = (id: string, actionId: string, type: string) => ({ type: 'environment.feedback', feedback: {
    id, actionId, type, timestamp: new Date().toISOString(), message: 'Simulated receipt',
  } });
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, 'Control receipt waited behind unrelated bridge processing');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/environment-bridge/stream') return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
      posted.push('ready');
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const body = JSON.parse(String(options?.body));
    if (pathname === '/api/environment-bridge/observation') {
      observations.push(body);
      if (body.id === 'held-camera') { posted.push(body.id); await observationHeld; }
      if (body.id?.startsWith('wave-observation')) posted.push(body.id);
    } else if (pathname === '/api/environment-bridge/action-result') {
      posted.push(body.id);
      if (body.id === 'face-completed') await faceHeld;
      if (body.id === 'wave-accepted') await acceptanceHeld;
      return Response.json({ success: true, action: { id: body.actionId }, admitted: body.actionId !== 'denied' });
    }
    return Response.json({ success: true });
  };
  const running = runEnvironmentBridgeAgent(controller.signal, config);
  try {
    await until(() => posted.includes('ready'));
    const observation = { environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'robot-session',
      timestamp: new Date().toISOString(), capabilities: { actions: [] }, id: 'held-camera' };
    emit({ type: 'environment.observation', observation });
    await until(() => posted.includes('held-camera'));
    emit(feedback('face-completed', 'face', 'completed'));
    emit(feedback('wave-accepted', 'wave', 'accepted'));
    emit(feedback('wave-completed', 'wave', 'completed'));
    emit({ type: 'environment.observation', observation: { ...observation,
      id: 'wave-observation', metadata: { actionId: 'wave' } } });
    emit({ type: 'environment.observation', observation: { ...observation,
      id: 'wave-observation-second', metadata: { actionId: 'wave' } } });
    emit(feedback('denied-accepted', 'denied', 'accepted'));
    await until(() => posted.includes('wave-accepted') && posted.includes('face-completed'));
    assert.equal(posted.includes('wave-completed'), false, 'A terminal receipt cannot overtake its own acceptance');
    assert.equal(acknowledgements.some(value => value.feedbackId === 'wave-accepted'), false,
      'Admission cannot be acknowledged before Core commits it');
    await until(() => acknowledgements.some(value => value.feedbackId === 'denied-accepted'));
    assert.equal(acknowledgements.find(value => value.feedbackId === 'denied-accepted')!.admitted, false);
    releaseObservation();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posted.includes('wave-observation'), false, 'An action observation waits for its own receipts');
    releaseAcceptance();
    await until(() => acknowledgements.some(value => value.feedbackId === 'wave-completed'));
    assert.deepEqual(acknowledgements.filter(value => value.actionId === 'wave').map(value => value.feedbackId),
      ['wave-accepted', 'wave-completed']);
    assert.equal(acknowledgements.find(value => value.feedbackId === 'wave-accepted')!.admitted, true);
    assert.equal(acknowledgements.some(value => value.feedbackId === 'face-completed'), false);
    await until(() => posted.includes('wave-observation-second'));
    assert.deepEqual(observations.filter(value => value.id).map(value => value.id),
      ['held-camera', 'wave-observation', 'wave-observation-second'], 'Observations retain their receive order');
    assert.deepEqual(observations.find(value => value.id === 'wave-observation')!.feedback.map((item: any) => item.id),
      ['wave-completed'], 'Delayed observation retains the feedback associated when it arrived');
    assert.equal(observations.find(value => value.id === 'wave-observation-second')!.feedback, undefined,
      'A receipt is attached once, even when several observations arrive before it finishes');
  } finally {
    releaseObservation(); releaseFace(); releaseAcceptance(); controller.abort(); await running;
    globalThis.fetch = originalFetch;
  }
});

test('disconnects and Core failures abort independent receipt delivery without ACK, and reconnect can replay it', async () => {
  scenario = 'perception';
  const originalFetch = globalThis.fetch;
  const receipt = { id: 'replayed-acceptance', actionId: 'wave', type: 'accepted',
    timestamp: '2026-10-08T12:00:00.000Z', message: 'Simulated saved receipt' };
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, 'Bridge fixture did not settle');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  try {
    for (const outcome of ['disconnect', 'failure', 'replay']) {
      acknowledgements = [];
      const controller = new AbortController();
      const signals: AbortSignal[] = [];
      const received: unknown[] = [];
      let streamReady = false;
      let failReceipt!: () => void;
      globalThis.fetch = async (url, options) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/environment-bridge/stream') return new Response(new ReadableStream<Uint8Array>({ start(stream) {
          options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
          streamReady = true;
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
        const body = JSON.parse(String(options?.body));
        if (pathname === '/api/environment-bridge/action-result') received.push(body);
        if (outcome !== 'replay' && (body.id === 'held-camera' || pathname === '/api/environment-bridge/action-result')) {
          const signal = options?.signal;
          assert.ok(signal, 'Concurrent deliveries must follow the connection lifetime');
          signals.push(signal);
          return new Promise<Response>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            if (pathname === '/api/environment-bridge/action-result') {
              failReceipt = () => resolve(new Response('Fixture Core failure', { status: 503 }));
            }
          });
        }
        return Response.json({ success: true, action: { id: receipt.actionId }, admitted: true });
      };
      const running = runEnvironmentBridgeAgent(controller.signal, config);
      try {
        await until(() => streamReady);
        if (outcome !== 'replay') {
          fixtureSocket.emit('message', JSON.stringify({ type: 'environment.observation', observation: {
            environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'robot-session',
            timestamp: receipt.timestamp, capabilities: { actions: [] }, id: 'held-camera',
          } }), false);
        }
        fixtureSocket.emit('message', JSON.stringify({ type: 'environment.feedback', feedback: receipt }), false);
        await until(() => received.length === 1);
        assert.deepEqual(received, [receipt], 'Replay preserves the original immutable receipt');
        if (outcome === 'replay') {
          await until(() => acknowledgements.length === 1);
          assert.equal(acknowledgements[0].admitted, true);
          assert.equal(acknowledgements[0].feedbackId, receipt.id);
        } else {
          assert.equal(signals.length, 2, 'The observation and control receipt are both in flight');
          if (outcome === 'disconnect') fixtureSocket.close();
          else failReceipt();
          await until(() => signals.every(signal => signal.aborted) && fixtureSocket.readyState === 3);
          assert.deepEqual(acknowledgements, [], 'Failed or interrupted admission cannot authorize movement');
        }
      } finally {
        controller.abort(); await running;
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the Bridge distinguishes ambiguous delivery from preparation that never sent an action', async () => {
  const envKeys = ['MH_ENVIRONMENT_ADAPTER_URL', 'MH_ENVIRONMENT_ADAPTER_TOKEN', 'MH_ENVIRONMENT_BRIDGE_TOKEN', 'MH_ENVIRONMENT_CORE_URL'];
  const previous = envKeys.map(key => process.env[key]);
  process.env.MH_ENVIRONMENT_ADAPTER_URL = 'ws://fixture.invalid/environment';
  process.env.MH_ENVIRONMENT_ADAPTER_TOKEN = 'fixture-adapter';
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-core';
  process.env.MH_ENVIRONMENT_CORE_URL = 'http://fixture.invalid';
  const originalFetch = globalThis.fetch;
  try {
    for (scenario of ['acceptance', 'send', 'speech-send', 'prepare-missing', 'prepare-encode',
      'receipt-allowed', 'receipt-denied', 'receipt-no-authority']) {
      const controller = new AbortController();
      finishFixture = () => controller.abort();
      const feedback: any[] = [];
      acknowledgements = [];
      sent = 0;
      const action = { id: `fixture-${scenario}`, sessionId: 'robot-session',
        type: scenario.startsWith('prepare') || scenario === 'speech-send' ? 'speak' : 'captureImage',
        speechArtifactId: 'fixture-speech', speechDurationMs: scenario === 'prepare-encode' ? -1 : 20 };
      globalThis.fetch = async (url, options) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/environment-bridge/stream') {
          return new Response(new ReadableStream<Uint8Array>({ start(stream) {
            stream.enqueue(new TextEncoder().encode(`event: actions\ndata: ${JSON.stringify({ actions: [action] })}\n\n`));
            options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
          } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        if (pathname === '/api/environment-bridge/action-result') {
          feedback.push(JSON.parse(String(options?.body)));
          if (scenario.startsWith('receipt')) return new Response(JSON.stringify({
            success: true, action: { id: action.id },
            ...(scenario === 'receipt-no-authority' ? {} : { admitted: scenario === 'receipt-allowed' }),
          }), { status: 200 });
          queueMicrotask(() => controller.abort());
        } else assert.equal(pathname, '/api/environment-bridge/telemetry');
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      };
      const timeout = setTimeout(() => controller.abort(new Error('Fixture did not finish')), 5_000);
      try { await runEnvironmentBridgeAgent(controller.signal); } finally { clearTimeout(timeout); }
      assert.equal(feedback.length, 1, scenario);
      if (scenario.startsWith('receipt')) {
        assert.equal(feedback[0].type, 'accepted');
        assert.equal(acknowledgements.length, 1);
        assert.equal(acknowledgements[0].admitted, scenario === 'receipt-allowed',
          'Historical receipt presence is not permission to start physical work');
        assert.equal(sent, 1);
        continue;
      }
      const preparing = scenario.startsWith('prepare');
      assert.equal(feedback[0].type, preparing ? 'failed' : 'outcome_unknown', scenario);
      assert.equal(feedback[0].actionId, action.id);
      assert.deepEqual(feedback[0].data, { producer: 'environment-bridge', delivery: {
        stage: preparing ? 'prepare' : scenario === 'acceptance' ? 'acceptance' : 'send',
        outcome: preparing ? 'not_sent' : 'unknown',
      } });
      assert.equal(sent, preparing ? 0 : 1, 'Preparation failure must precede transport send');
    }
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('recognition delivery keeps only the newest waiting result and does not block control receipts', async () => {
  const envKeys = ['MH_ENVIRONMENT_ADAPTER_URL', 'MH_ENVIRONMENT_ADAPTER_TOKEN', 'MH_ENVIRONMENT_BRIDGE_TOKEN', 'MH_ENVIRONMENT_CORE_URL'];
  const previous = envKeys.map(key => process.env[key]);
  process.env.MH_ENVIRONMENT_ADAPTER_URL = 'ws://fixture.invalid/environment';
  process.env.MH_ENVIRONMENT_ADAPTER_TOKEN = 'fixture-adapter';
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-core';
  process.env.MH_ENVIRONMENT_CORE_URL = 'http://fixture.invalid';
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const delivered: number[] = [];
  let releaseFirst: () => void = () => {};
  let firstStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  let controlReceived: () => void = () => {};
  const receipt = new Promise<void>(resolve => { controlReceived = resolve; });
  const recognition = (frameCounter: number) => {
    const now = Date.now();
    fixtureSocket.emit('message', JSON.stringify({ type: 'environment.telemetry', sessionId: 'robot-session',
      telemetry: { kind: 'vision.recognition', processing: { freshFps: 3, receivedFrames: 20 }, perception: { version: 1, timeBasis: 'gateway_receipt',
        robotId: 'robot', epoch: 1, gatewayInstance: 'fixture', frameCounter,
        observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString(),
        backend: 'fixture', model: 'fixture', summary: 'table', objects: [], uncertainties: [] } } }), false);
  };
  scenario = 'perception';
  acknowledgements = [];
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/environment-bridge/stream') {
      return new Response(new ReadableStream<Uint8Array>({ start(stream) {
        options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
        setImmediate(() => recognition(1));
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    const body = JSON.parse(String(options?.body));
    if (pathname === '/api/environment-bridge/telemetry' && body.perception) {
      assert.deepEqual(body.recognitionProcessing, { freshFps: 3, receivedFrames: 20 });
      delivered.push(body.perception.frameCounter);
      if (delivered.length === 1) {
        firstStarted();
        await new Promise<void>((resolve, reject) => {
          releaseFirst = resolve;
          options?.signal?.addEventListener('abort', () => reject(new Error('Aborted fixture perception')), { once: true });
        });
      } else queueMicrotask(() => controller.abort());
    } else if (pathname === '/api/environment-bridge/action-result') {
      controlReceived();
      return new Response(JSON.stringify({ success: true, admitted: true }), { status: 200 });
    } else assert.ok(['/api/environment-bridge/telemetry', '/api/environment-bridge/observation'].includes(pathname));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  const timeout = setTimeout(() => controller.abort(new Error('Recognition fixture timed out')), 5000);
  try {
    const run = runEnvironmentBridgeAgent(controller.signal);
    await started;
    recognition(2); recognition(3);
    fixtureSocket.emit('message', JSON.stringify({ type: 'environment.feedback', feedback: {
      id: 'fixture-status', actionId: 'fixture-action', type: 'status',
      timestamp: new Date().toISOString(), message: 'Still active' } }), false);
    await receipt;
    assert.deepEqual(delivered, [1], 'control receipt must arrive while recognition delivery is blocked');
    releaseFirst();
    await run;
    assert.deepEqual(delivered, [1, 3], 'intermediate recognition must not accumulate');
  } finally {
    controller.abort(); releaseFirst(); clearTimeout(timeout);
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('ongoing updates preserve movement identity and lease while receipts finish only the settings job', async () => {
  const keys = ['MH_ENVIRONMENT_ADAPTER_URL', 'MH_ENVIRONMENT_ADAPTER_TOKEN', 'MH_ENVIRONMENT_BRIDGE_TOKEN', 'MH_ENVIRONMENT_CORE_URL'];
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  process.env.MH_ENVIRONMENT_ADAPTER_URL = 'ws://fixture.invalid/environment';
  process.env.MH_ENVIRONMENT_ADAPTER_TOKEN = 'fixture-adapter';
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-core';
  process.env.MH_ENVIRONMENT_CORE_URL = 'http://fixture.invalid';
  try {
    for (scenario of ['update-acknowledged', 'update-unknown', 'update-send', 'update-rejected', 'update-disconnect',
      'update-timeout', 'update-wrong-session', 'update-late', 'update-duplicate']) {
      const controller = new AbortController();
      const results: any[] = [];
      wireUpdates = [];
      const action = { id: 'settings-job', type: 'move', sessionId: 'robot-session',
        bodyLease: { owner: 'execution-fixture', generation: 4 },
        movementUpdate: { actionId: 'running-walk', revision: 3, controls: { speed: 60, forward: 80, turn: -25 } } };
      globalThis.fetch = async (url, options) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/environment-bridge/stream') return new Response(new ReadableStream<Uint8Array>({ start(stream) {
          stream.enqueue(new TextEncoder().encode(`event: actions\ndata: ${JSON.stringify({ actions: [action] })}\n\n`));
          options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
        if (pathname === '/api/environment-bridge/action-result') {
          results.push(JSON.parse(String(options?.body)));
          if (scenario !== 'update-late' || results.length === 2) queueMicrotask(() => controller.abort());
        }
        return Response.json({ success: true });
      };
      const timeout = setTimeout(() => controller.abort(new Error('Update fixture timed out')), 10000);
      try { await runEnvironmentBridgeAgent(controller.signal); } finally { clearTimeout(timeout); }
      assert.equal(wireUpdates.length, 1);
      assert.deepEqual(wireUpdates[0], { type: 'environment.action.update', version: 1, sessionId: 'robot-session',
        gatewayInstance: 'gateway-fixture', robotId: 'body-fixture', epoch: 7, actionId: 'running-walk',
        bodyLease: action.bodyLease, revision: 3, validForMs: 1000, controls: action.movementUpdate.controls });
      assert.equal(results.length, scenario === 'update-late' ? 2 : 1);
      assert.equal(results[0].actionId, 'settings-job', 'The original gait cannot complete from a settings receipt');
      assert.equal(results[0].type, ['update-acknowledged', 'update-duplicate'].includes(scenario) ? 'completed'
        : scenario === 'update-rejected' ? 'rejected' : 'outcome_unknown');
      if (scenario === 'update-late') assert.equal(results[1].type, 'completed', 'Late correlated acknowledgement must reconcile the uncertain update');
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

for (const behavior of [false, true]) test(`${behavior ? 'Robot control' : 'Speech destination'} requests use the authenticated Core API and preserve correlation`, async () => {
  const kind = behavior ? 'behavior.settings' : 'speech.settings';
  const field = behavior ? 'enabled' : 'outputTarget';
  const values = behavior ? [undefined, false, true, 'invalid'] : [undefined, 'robot', 'local', 'invalid'];
  scenario = 'speech-settings';
  speechSettingsResults = [];
  const keys = ['MH_ENVIRONMENT_ADAPTER_URL', 'MH_ENVIRONMENT_ADAPTER_TOKEN', 'MH_ENVIRONMENT_BRIDGE_TOKEN', 'MH_ENVIRONMENT_CORE_URL'];
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  process.env.MH_ENVIRONMENT_ADAPTER_URL = 'ws://fixture.invalid/environment';
  process.env.MH_ENVIRONMENT_ADAPTER_TOKEN = 'fixture-adapter';
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-core';
  process.env.MH_ENVIRONMENT_CORE_URL = 'http://fixture.invalid';
  const controller = new AbortController();
  finishFixture = () => controller.abort();
  const forwarded: any[] = [];
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/environment-bridge/stream') return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      options?.signal?.addEventListener('abort', () => stream.close(), { once: true });
      queueMicrotask(() => {
        for (const [index, target] of values.entries()) {
          fixtureSocket.emit('message', JSON.stringify({ type: kind, requestId: `settings-${index}`, [field]: target }), false);
        }
      });
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    if (pathname === (behavior ? '/api/environment-bridge/behavior-settings' : '/api/environment-bridge/speech-settings')) {
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer fixture-core');
      const body = JSON.parse(String(options?.body));
      forwarded.push(body);
      if (body[field] === 'invalid') return Response.json({ error: 'Invalid destination' }, { status: 400 });
      return Response.json({ [field]: body[field] ?? (behavior ? false : 'local'), username: 'fixture-owner', provider: 'kokoro' });
    }
    return Response.json({ success: true });
  };
  const timeout = setTimeout(() => controller.abort(new Error('Speech settings test timed out')), 5000);
  try {
    await runEnvironmentBridgeAgent(controller.signal);
    assert.deepEqual(forwarded, values.map(value => value === undefined ? {} : { [field]: value }));
    assert.deepEqual(speechSettingsResults.map(result => result.requestId), ['settings-0', 'settings-1', 'settings-2', 'settings-3']);
    assert.deepEqual(speechSettingsResults.slice(0, 3).map(result => result[field]), behavior ? [false, false, true] : ['local', 'robot', 'local']);
    assert.match(speechSettingsResults[3].error, /Invalid destination/);
  } finally {
    controller.abort(); clearTimeout(timeout); globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test.after(() => { socketMock.restore(); coreMock.restore(); });
