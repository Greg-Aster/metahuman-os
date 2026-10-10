import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real owner functions with isolated IO; no coordinator, models or robot starts.
function load(file: string, names: string[], globals: Record<string, unknown>) {
  const ast = ts.createSourceFile(file, fs.readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const statements = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name!.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))));
  const code = statements.map(node => node.getText(ast).replace(/^export /, '')).join('\n');
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, ...globals });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    + `\nglobalThis.exports = { ${names.join(',')} };`, context);
  return context.exports;
}
const user = { isAuthenticated: true, role: 'owner', username: 'stream-fixture' };
const streamResponse = (stream: AsyncIterable<string>) => ({ status: 200, stream, headers: {} });
const parse = (value: string) => JSON.parse(value.slice(value.indexOf('data: ') + 6).trim());

for (const taskStream of [false, true]) {
  test(`${taskStream ? 'task' : 'Queue'} stream releases wait listeners on updates, heartbeat and disconnect`, async () => {
    const system = new EventEmitter();
    const timers = new Map<number, () => void>();
    let id = 0;
    const task = { id: 'fixture-task', state: 'leased', username: user.username };
    const manager = { getTask: () => task, getAllTasks: () => [task], getOutput: () => [],
      addEventListener: (fn: (...args: any[]) => void) => system.on('queue', fn),
      removeEventListener: (fn: (...args: any[]) => void) => system.off('queue', fn) };
    const owner = load('./unified-queue.ts', ['handleQueueStream', 'handleQueueTaskStream', 'terminalStreamEvent', 'sse', 'taskStatus', 'canReadTask'], {
      getQueueSystem: () => system, getQueueManager: () => manager, queueSnapshot: () => ({ tasks: [task] }),
      setTimeout: (fn: () => void) => { timers.set(++id, fn); return id; },
      clearTimeout: (timer: number) => timers.delete(timer),
    });
    const abort = new AbortController();
    const response = await owner[taskStream ? 'handleQueueTaskStream' : 'handleQueueStream']({ user, signal: abort.signal, params: { id: task.id } });
    const iterator = response.stream[Symbol.asyncIterator]();
    await iterator.next();
    for (let i = 0; i < 40; i++) {
      const waiting = iterator.next();
      assert.equal(getEventListeners(abort.signal, 'abort').length, 1);
      system.emit('queue', { type: 'task_output', taskId: task.id, details: { chunk: `data: ${i}\n\n` } });
      assert.equal((await waiting).done, false);
      assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
      assert.equal(timers.size, 0);
    }
    const heartbeat = iterator.next();
    [...timers.values()][0]();
    assert.equal((await heartbeat).value, ': heartbeat\n\n');
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
    const waiting = iterator.next();
    abort.abort();
    assert.equal((await waiting).done, true);
    assert.equal(system.listenerCount('queue'), 0);
    assert.equal(timers.size, 0);
    assert.equal(task.state, 'leased', 'closing observation cannot cancel admitted work');
  });
}

test('proposal events wake delivery directly, stay profile-scoped and detach on abort', async () => {
  const events = new EventEmitter();
  const owner = load('./operator-proposals.ts', ['handleOperatorProposalsStream', 'sseEvent'], {
    proposalEvents: events, getOperatorPendingProposals: () => [], getPendingPostFeedback: () => [],
    setTimeout() { throw new Error('Proposal delivery must not poll'); },
  });
  const abort = new AbortController();
  const response = await owner.handleOperatorProposalsStream({ user, signal: abort.signal });
  const iterator = response.stream[Symbol.asyncIterator]();
  await iterator.next(); await iterator.next();
  const next = iterator.next();
  events.emit('proposal-created', { username: 'different-user', proposalId: 'hidden' });
  events.emit('proposal-created', { username: user.username, proposalId: 'visible' });
  assert.equal(parse((await next).value).proposalId, 'visible');
  const waiting = iterator.next();
  abort.abort();
  assert.equal((await waiting).done, true);
  assert.equal(events.listenerCount('proposal-created'), 0);
  assert.equal(events.listenerCount('proposal-resolved'), 0);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

function fileIO() {
  const watchers: (EventEmitter & { close(): void; closed: boolean; notify(): void })[] = [];
  return { watchers, fs: {
    existsSync: () => true, mkdirSync() {}, writeFileSync() {},
    watch(_target: string, callback: () => void) {
      const watcher = Object.assign(new EventEmitter(), { closed: false,
        close() { this.closed = true; }, notify: callback });
      watchers.push(watcher); return watcher;
    },
  } };
}

test('one buffer stream preserves mode, timestamp and speaker, exposes read errors, and closes every watcher', async () => {
  const io = fileIO();
  let failInner = true;
  const owner = load('./buffer-stream.ts', ['handleBufferStream', 'streamBufferUpdates', 'isBufferMode', 'sse'], {
    fs: io.fs, path, streamResponse,
    getBufferNotificationPath: (_user: string, mode: string) => `/fixture/${mode}`,
    loadBufferForUser: (_user: string, mode: string) => {
      if (mode === 'inner' && failInner) throw new Error('Fixture read failure');
      return { messages: [{ role: 'assistant', content: mode, timestamp: 123, meta: { source: mode } }], lastUpdated: 456 };
    },
  });
  const abort = new AbortController();
  const response = await owner.handleBufferStream({ user, signal: abort.signal, query: { mode: 'conversation,inner,system,robot' } });
  const iterator = response.stream[Symbol.asyncIterator]();
  const initial = [];
  for (let i = 0; i < 8; i++) initial.push(parse((await iterator.next()).value));
  assert.deepEqual(initial.filter(item => item.type === 'update').map(item => item.mode), ['conversation', 'system', 'robot']);
  assert.equal(initial.find(item => item.type === 'error').mode, 'inner');
  assert.equal(initial.find(item => item.type === 'update').messages[0].timestamp, 123);
  assert.equal(initial.find(item => item.type === 'update').messages[0].role, 'assistant');
  failInner = false;
  const recovered = iterator.next();
  io.watchers[1].notify();
  assert.equal(parse((await recovered).value).messages[0].content, 'inner');
  const waiting = iterator.next();
  abort.abort();
  assert.equal((await waiting).done, true);
  assert.ok(io.watchers.every(watcher => watcher.closed));
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('monitor read and watcher failures are delivered, and disconnect releases subscriptions', async () => {
  const io = fileIO();
  let released = 0;
  const owner = load('./monitor-stream.ts', ['handleMonitorStream', 'streamMonitorUpdates', 'sse'], {
    fs: io.fs, path, streamResponse, systemPaths: { logs: '/fixture/logs', run: '/fixture/run', root: '/fixture' },
    getAgentMonitorSnapshot: () => { throw new Error('Fixture snapshot failed'); },
    subscribeEnvironmentBridgeState: () => () => { released++; },
    subscribeEnvironmentBridgeDiagnostics: () => () => { released++; },
  });
  const abort = new AbortController();
  const response = await owner.handleMonitorStream({ signal: abort.signal });
  const iterator = response.stream[Symbol.asyncIterator]();
  await iterator.next();
  assert.equal(parse((await iterator.next()).value).error, 'Fixture snapshot failed');
  const failedWatch = iterator.next();
  io.watchers[0].emit('error', new Error('Fixture watch failed'));
  assert.equal(parse((await failedWatch).value).error, 'Fixture watch failed');
  const waiting = iterator.next(); abort.abort(); await waiting;
  assert.equal(released, 2);
  assert.ok(io.watchers.every(watcher => watcher.closed));
});

test('editor disconnect ends observation while the admitted graph continues without writing to the closed response', async () => {
  let complete!: (value: unknown) => void;
  let completed = false;
  const owner = load('./execute-graph-stream.ts', ['handleExecuteGraphStream', 'executeGraphWithEvents', 'formatSSE'], {
    streamResponse, namedSse: (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    runGraph: async ({ eventHandler }: any) => {
      eventHandler({ type: 'node_start', nodeId: 'fixture', timestamp: 'fixture' });
      const value = await new Promise(resolve => { complete = resolve; });
      completed = true; return value;
    }, extractGraphOutput: () => ({ response: 'done' }), collectNodeOutputs: () => ({}), listSkippedNodes: () => [],
  });
  const abort = new AbortController();
  const response = await owner.handleExecuteGraphStream({ user, signal: abort.signal,
    body: { graph: { nodes: [], edges: [] }, sessionId: 'fixture' } });
  const iterator = response.stream[Symbol.asyncIterator]();
  assert.match((await iterator.next()).value, /node_start/);
  const waiting = iterator.next(); abort.abort();
  assert.equal((await waiting).done, true);
  assert.equal(completed, false);
  complete({ status: 'completed', nodes: new Map() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

for (const [name, initialFrames] of [['generatePlanStream', 5], ['runDesireStream', 4], ['outcomeReviewStream', 4]] as const) {
  test(`${name}: disconnect releases observation without cancelling its Coordinator task`, async () => {
    const events = new EventEmitter();
    let cancels = 0;
    const task = { id: 'fixture-task', state: 'leased' };
    const desire = { id: 'fixture-desire', title: 'Fixture', status: 'approved', plan: { steps: [], operatorGoal: 'Fixture' } };
    const manager = { getTask: () => task, getOutput: () => [], cancel() { cancels++; },
      addEventListener: (fn: (...args: any[]) => void) => events.on('queue', fn),
      removeEventListener: (fn: (...args: any[]) => void) => events.off('queue', fn) };
    const owner = load('./agency-workflows.ts', [name, 'namedSse', 'dataSse', 'requireOwner'], {
      getQueueManager: () => manager, submitDesireAgent: async () => task, rejectInlineCritique() {},
      loadPlannableDesire: async () => desire, loadExecutableDesire: async () => desire, loadReviewableDesire: async () => desire,
      RUN_STREAM_LOG_PREFIX: 'fixture', PLAN_STREAM_LOG_PREFIX: 'fixture', OUTCOME_STREAM_LOG_PREFIX: 'fixture',
      setTimeout() { throw new Error('Task observation must wake on Coordinator events'); },
    });
    const abort = new AbortController();
    const iterator = owner[name]({ user, signal: abort.signal, params: { id: desire.id } });
    for (let i = 0; i < initialFrames; i++) assert.equal((await iterator.next()).done, false);
    const waiting = iterator.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.listenerCount('queue'), 1);
    abort.abort();
    assert.equal((await waiting).done, true);
    assert.equal(cancels, 0);
    assert.equal(events.listenerCount('queue'), 0);
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  });
}
