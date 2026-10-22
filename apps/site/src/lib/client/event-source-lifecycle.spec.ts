import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { get } from 'svelte/store';
import { coordinatorSnapshot, coordinatorConnection, coordinatorError, useWorkCoordinator } from '../stores/work-coordinator.js';
import { triggerManagerSnapshot, triggerManagerConnection, triggerManagerError, useTriggerManager } from '../stores/trigger-manager.js';
import { policyStore, type SecurityPolicy } from '../../stores/security-policy.js';
import { useThinkingTrace } from './composables/useThinkingTrace.js';

test('thinking display uses task-supplied progress and reasoning without opening another stream', () => {
  const original = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor() { throw new Error('Thinking display must not open a subscription'); }
  } as unknown as typeof EventSource;
  try {
    const thinking = useThinkingTrace({ getCurrentMode: () => 'environment',
      getReasoningDepth: () => 1, getReasoningStagesCount: () => 0 });
    thinking.start();
    thinking.setTrace(['Task progress']);
    thinking.appendTrace('Task reasoning');
    assert.deepEqual(get(thinking.trace), ['Task progress', 'Task reasoning']);
    assert.equal(get(thinking.showIndicator), true);
    thinking.stop();
    assert.equal(get(thinking.active), false);
    assert.deepEqual(get(thinking.trace), []);
  } finally { globalThis.EventSource = original; }
});

function component(name: string) {
  const text = readFileSync(new URL(`../../components/${name}.svelte`, import.meta.url), 'utf8');
  const script = text.slice(text.indexOf('>', text.indexOf('<script')) + 1, text.indexOf('</script>'));
  return ts.createSourceFile(`${name}.ts`, script, ts.ScriptTarget.Latest, true);
}

function functions(name: string, names: string[]) {
  const ast = component(name);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name!.text))
    .map(node => node.getText(ast)).join('\n');
}

function run(code: string, context: vm.Context) {
  vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}

function fixture() {
  const sources: Source[] = [];
  class Source {
    static CLOSED = 2;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: (event: unknown) => void;
    constructor(readonly url: string) { sources.push(this); }
    close() { this.readyState = 2; }
    open() { this.readyState = 1; this.onopen?.(); }
    send(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  return { sources, Source };
}

test('Queue and Trigger Manager share one stream, reconnect in place and release only their own consumers', () => {
  const { sources, Source } = fixture();
  const background = Array.from({ length: 12 }, (_, i) => new Source(`/existing-${i}`));
  const oldSource = globalThis.EventSource;
  const oldWindow = globalThis.window;
  const oldPolicy = get(policyStore);
  globalThis.EventSource = Source as unknown as typeof EventSource;
  globalThis.window = {} as Window & typeof globalThis;
  policyStore.set({ role: 'owner' } as SecurityPolicy);
  const releases: (() => void)[] = [];
  try {
    // Start in either order, as Queue and the persistent autonomy controls do.
    for (const triggerFirst of [false, true]) {
      const first = triggerFirst ? useTriggerManager() : useWorkCoordinator();
      const second = triggerFirst ? useWorkCoordinator() : useTriggerManager();
      const anotherTrigger = useTriggerManager();
      releases.push(first, second, anotherTrigger);
      const queue = sources.at(-1)!;
      assert.equal(queue.url, '/api/queue-stream');
      assert.equal(sources.filter(source => source.readyState !== 2).length, 13);
      queue.open();
      queue.send({ type: 'snapshot', snapshot: { tasks: [{ id: 'work' }], triggerManager: { lifecycle: 'running' } } });
      assert.equal(get(coordinatorSnapshot)?.tasks[0].id, 'work');
      assert.equal(get(triggerManagerSnapshot)?.lifecycle, 'running');
      assert.equal(get(triggerManagerConnection), 'live');
      const count = sources.length;
      queue.onerror?.({});
      assert.equal(get(coordinatorConnection), 'reconnecting');
      assert.equal(get(triggerManagerConnection), 'reconnecting');
      queue.open();
      assert.equal(sources.length, count, 'native reconnect must not allocate another source');
      queue.send({ type: 'trigger-state', snapshot: { tasks: [], triggerManager: { lifecycle: 'paused' } } });
      assert.equal(get(triggerManagerSnapshot)?.lifecycle, 'paused');
      queue.send({ type: 'error', error: 'Coordinator unavailable' });
      assert.equal(get(coordinatorError), 'Coordinator unavailable');
      assert.equal(get(triggerManagerError), 'Coordinator unavailable');
      queue.send({ type: 'reconcile', snapshot: { tasks: [], triggerManager: { lifecycle: 'running' } } });
      assert.equal(get(coordinatorError), '');
      assert.equal(get(triggerManagerError), '');
      first(); first(); second();
      assert.notEqual(queue.readyState, 2, 'the other Trigger Manager consumer still needs this stream');
      anotherTrigger();
      assert.equal(queue.readyState, 2);
      assert.equal(get(coordinatorConnection), 'idle');
      assert.equal(get(coordinatorSnapshot), null);
      assert.equal(get(triggerManagerSnapshot), null);
      assert.ok(background.every(source => source.readyState !== 2));
    }
    policyStore.set({ role: 'guest' } as SecurityPolicy);
    const count = sources.length;
    useTriggerManager()();
    assert.equal(sources.length, count, 'non-owner trigger controls do not subscribe');
  } finally {
    releases.forEach(release => release());
    policyStore.set(oldPolicy);
    globalThis.EventSource = oldSource;
    globalThis.window = oldWindow;
  }
});

test('buffer reconnect and teardown preserve speech and Queue; network errors do not allocate duplicates', () => {
  const { sources, Source } = fixture();
  const queue = new Source('/api/queue-stream');
  const context = vm.createContext({ EventSource: Source, console: { log() {}, error() {} },
    apiEventSource: (path: string) => new Source(path),
    document: { hidden: false }, selectedViews: new Set(['conversation', 'inner', 'system']),
    bufferStream: null,
    messages: { update(fn: (value: unknown[]) => unknown[]) { fn([]); } },
    messagesApi: { pushMessage() {} },
    replaceBufferSlice: (_msgs: unknown[], _mode: string, messages: unknown[]) => messages,
    queueStream: null, consumerId: 'fixture',
  });
  run(functions('TTSQueueConsumer', ['connectQueueStream']), context);
  context.connectQueueStream();
  const speech = sources.at(-1)!;
  context.connectQueueStream();
  assert.equal(sources.length, 2, 'speech connects once');
  run(functions('ChatInterface', ['connectMultipleBufferStreams', 'disconnectAllBufferStreams']), context);
  context.connectMultipleBufferStreams();
  assert.equal(sources.filter(source => source.readyState !== 2).length, 3);
  const firstBuffers = sources.slice(2);
  assert.equal(firstBuffers[0].url, '/api/buffer-stream?mode=conversation,inner,system,robot');
  for (const source of firstBuffers) source.onerror?.({});
  assert.equal(sources.length, 3, 'native EventSource reconnection keeps the same objects');
  context.connectMultipleBufferStreams();
  assert.ok(firstBuffers.every(source => source.readyState === 2));
  assert.equal(sources.filter(source => source.readyState !== 2).length, 3);
  context.disconnectAllBufferStreams();
  assert.deepEqual(sources.filter(source => source.readyState !== 2), [queue, speech]);
});

test('proposal listeners are installed once per stream, including across native reconnection', () => {
  const sources: Source[] = [];
  class Source extends EventTarget {
    static CLOSED = 2;
    readyState = 0;
    onopen?: () => void;
    onerror?: () => void;
    constructor(readonly url: string) { super(); sources.push(this); }
    close() { this.readyState = 2; }
  }
  let state: any = { connected: false, proposals: [] };
  const context = vm.createContext({ EventSource: Source, connectionHandle: null, console,
    apiEventSource: (path: string) => new Source(path),
    proposalsStore: { update: (fn: (value: any) => any) => { state = fn(state); } },
  });
  const text = readFileSync(new URL('../../stores/proposals.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('proposals.ts', text, ts.ScriptTarget.Latest, true);
  run(ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['connectProposalsStream', 'disconnectProposalsStream'].includes(node.name!.text))
    .map(node => node.getText(ast).replace(/^export /, '')).join('\n'), context);
  context.connectProposalsStream();
  const source = sources[0];
  source.onopen?.();
  source.onerror?.();
  assert.equal(state.connected, false);
  context.connectProposalsStream();
  source.onopen?.();
  assert.equal(sources.length, 1);
  source.dispatchEvent(new MessageEvent('proposal-created', { data: JSON.stringify({ proposal: { id: 'one' } }) }));
  assert.equal(state.proposals.length, 1, 'reopening must not register duplicate event listeners');
  context.disconnectProposalsStream();
  assert.equal(source.readyState, 2);
  assert.equal(state.connected, false);
});
