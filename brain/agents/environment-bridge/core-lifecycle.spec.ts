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
let wireUpdates: Record<string, any>[] = [];
let acknowledgements: Record<string, unknown>[] = [];
let finishFixture = () => {};
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
        ...((scenario === 'perception' || scenario.startsWith('update')) ? { observation: { environmentId: 'ainekio', adapter: 'ainekio-gateway',
          sessionId: 'robot-session', timestamp: new Date().toISOString(), capabilities: { actions: [] },
          state: { activeMovementUpdates: { version: 1, available: true, gatewayInstance: 'gateway-fixture', robotId: 'body-fixture', epoch: 7, maxValidityMs: 1000 } } } } : {}) }), false));
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
      telemetry: { kind: 'vision.recognition', perception: { version: 1, timeBasis: 'gateway_receipt',
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

test.after(() => { socketMock.restore(); coreMock.restore(); });
