import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { get } from 'svelte/store';
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

test('Queue mounts immediately alongside twelve streams, receives snapshots, and owns its cleanup', () => {
  const { sources, Source } = fixture();
  const background = Array.from({ length: 12 }, (_, i) => new Source(`/existing-${i}`));
  const mounts: (() => void)[] = [];
  const destroys: (() => void)[] = [];
  const context = vm.createContext({ EventSource: Source, connected: false, error: '', snapshot: null,
    sourceHandle: null, onMount: (fn: () => void) => mounts.push(fn), onDestroy: (fn: () => void) => destroys.push(fn) });
  const ast = component('QueuePanel');
  const lifecycle = ast.statements.filter(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && ['onMount', 'onDestroy'].includes(node.expression.expression.getText(ast)));
  run(lifecycle.map(node => node.getText(ast)).join('\n'), context);
  for (let i = 0; i < 2; i++) {
    mounts[0]();
    const queue = sources.at(-1)!;
    assert.equal(queue.url, '/api/queue-stream');
    assert.equal(sources.filter(source => source.readyState !== 2).length, 13);
    queue.open();
    queue.send({ type: 'snapshot', snapshot: { lifecycle: 'running', tasks: [{ id: `task-${i}` }] } });
    assert.equal(context.connected, true);
    assert.equal(context.snapshot.tasks[0].id, `task-${i}`);
    queue.onerror?.({});
    assert.equal(context.connected, false);
    queue.open();
    queue.send({ type: 'snapshot', snapshot: { lifecycle: 'running', tasks: [] } });
    assert.equal(context.snapshot.tasks.length, 0);
    destroys[0]();
    assert.equal(queue.readyState, 2);
    assert.ok(background.every(source => source.readyState !== 2));
  }
});

test('buffer reconnect and teardown preserve speech and Queue; network errors do not allocate duplicates', () => {
  const { sources, Source } = fixture();
  const queue = new Source('/api/queue-stream');
  const context = vm.createContext({ EventSource: Source, console: { log() {}, error() {} },
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
