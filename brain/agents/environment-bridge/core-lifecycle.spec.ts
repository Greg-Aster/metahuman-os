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
let acknowledgements: Record<string, unknown>[] = [];
let finishFixture = () => {};
class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  constructor() { super(); queueMicrotask(() => this.emit('open')); }
  send(payload: string | Buffer, callback?: (error?: Error) => void) {
    if (Buffer.isBuffer(payload)) {
      sent++;
      callback?.(new Error('Fixture speech socket send failed'));
      return;
    }
    const message = JSON.parse(payload);
    if (message.type === 'bridge.connect') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'bridge.ready', sessionId: 'robot-session' }), false));
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
      queueMicrotask(finishFixture);
    }
  }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close'); } }
}
const socketMock = mock.module('ws', { defaultExport: FakeWebSocket });
const coreMock = mock.module('@metahuman/core', { namedExports: {
  ...publicCore,
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

test.after(() => { socketMock.restore(); coreMock.restore(); });
