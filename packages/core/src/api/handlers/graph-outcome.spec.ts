import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock } from 'node:test';
import type { GraphExecutionState } from '../../graph-executor.js';
import type { UnifiedRequest } from '../types.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-graph-outcome-'));
assert.equal(fs.realpathSync(root), root);
process.env.METAHUMAN_ROOT = root;
globalThis.fetch = async () => { throw new Error('Graph outcome tests prohibit network access'); };
const { ROOT, registerProfileStorageConfigGetter, systemPaths } = await import('../../path-builder.js');
assert.equal(ROOT, root);
assert.ok(systemPaths.logs.startsWith(root + path.sep));
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const runtime = await import('../../graph-runtime.js');
const { withUserContext } = await import('../../context.js');
const { writeBufferEntry } = await import('../../conversation-buffer.js');
const { createRobotBufferMessage } = await import('../../nodes/output/robot-buffer.node.js');
const username = 'outcome-fixture';
fs.mkdirSync(path.join(root, 'profiles', username), { recursive: true });
registerProfileStorageConfigGetter(candidate => candidate === username
  ? { path: path.join(root, 'profiles', username), type: 'internal' }
  : undefined);
fs.mkdirSync(path.join(root, 'etc', 'cognitive-graphs'), { recursive: true });
for (const file of ['chat-settings.json', 'agents.json']) {
  fs.copyFileSync(path.join(repo, 'etc', file), path.join(root, 'etc', file));
}
fs.copyFileSync(path.join(repo, 'etc', 'cognitive-graphs', 'response-pipeline.json'),
  path.join(root, 'etc', 'cognitive-graphs', 'response-pipeline.json'));

// Exercise the actual canonical output owner first: generation and staging
// succeed, then relay rejects conflicting content for an existing receipt.
const graph = {
  version: '1.0', format: 'svelte-flow' as const, name: 'Output delivery failure fixture',
  scheduler: { version: 1 as const, activation: 'demand' as const, skippedState: 'explicit' as const,
    sideEffectOrder: 'serial-topological' as const, maxLoopIterations: 5 },
  nodes: [
    { id: 'input', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'user_input', label: 'Input', properties: {} } },
    { id: 'response', type: 'outputNode', position: { x: 1, y: 0 }, data: { nodeType: 'stream_writer', label: 'Response', properties: {} } },
    { id: 'buffer', type: 'outputNode', position: { x: 2, y: 0 }, data: { nodeType: 'robot_buffer', label: 'Buffer', properties: {} } },
  ],
  edges: [
    { id: 'response-data', source: 'input', target: 'response', sourceHandle: 'message', targetHandle: 'response' },
    { id: 'persist-after-response', source: 'response', target: 'buffer', sourceHandle: 'completed',
      targetHandle: 'bridgeRecord', data: { kind: 'control' as const } },
  ],
};
const record = { direction: 'inbound' as const, status: 'completed', message: 'Original result',
  targetSessionId: 'fixture-body', actionId: 'fixture-action',
  feedback: { id: 'fixture-result', timestamp: '2026-09-07T00:00:00Z', type: 'completed',
    message: 'Original result', actionId: 'fixture-action' } };
await writeBufferEntry(username, 'robot', createRobotBufferMessage(record));
const failed = await withUserContext({ userId: username, username, role: 'owner' }, () => runtime.runGraph({
  graph, context: { username, userId: username, userMessage: 'A generated response before persistence failed.',
    bridgeRecord: { ...record, message: 'Conflicting result' } },
}));
assert.equal(failed.status, 'failed');
assert.ok(failed.error);
assert.deepEqual(runtime.listFailedNodes(failed), []);
assert.equal(failed.nodes.get('buffer')?.outputs?.persisted, true);
assert.equal(runtime.extractGraphOutput(failed)?.response, 'A generated response before persistence failed.');
fs.writeFileSync(path.join(root, 'failed-state.json'), JSON.stringify({ ...failed,
  error: failed.error.message, nodes: [...failed.nodes] }, null, 2));

// Replay that real GraphExecutionState at each public consumer boundary. No
// provider, body, Coordinator, or second output relay runs in these probes.
let returnedState: GraphExecutionState = failed;
let streamChunk = '';
let emitGraphError = false;
const runtimeMock = mock.module('../../graph-runtime.js', { namedExports: {
  ...runtime,
  runGraph: async (params: { eventHandler?: (event: unknown) => void }) => {
    if (streamChunk) params.eventHandler?.({ type: 'big_brother_output', data: { chunk: streamChunk } });
    if (emitGraphError) params.eventHandler?.({ type: 'graph_error', data: { error: returnedState.error?.message } });
    return returnedState;
  },
} });
const core = await import('../../index.js');
const coreMock = mock.module('../../index.js', { namedExports: {
  ...core,
  loadGraphForMode: async () => ({ graph, source: 'isolated-fixture' }),
  loadPersonaWithFacet: () => ({ identity: { name: 'Fixture', role: 'test', purpose: 'test' }, personality: {}, values: {} }),
  getActiveFacet: () => 'default',
} });
const users = await import('../../users.js');
const usersMock = mock.module('../../users.js', { namedExports: {
  ...users,
  getUserByUsername: (name: string) => name === username ? { id: username, username, role: 'owner' } : users.getUserByUsername(name),
} });
const streaming = await import('../../graph-streaming.js');
const streamingMock = mock.module('../../graph-streaming.js', { namedExports: {
  ...streaming,
  loadGraphForMode: async () => ({ graph, source: 'isolated-fixture' }),
} });
const { handleExecuteGraph } = await import('./execute-graph.js');
const { handleExecuteGraphStream } = await import('./execute-graph-stream.js');
const { handlePersonaChat } = await import('./persona-chat.js');
const { extractResponsePipelineResult, handleResponsePipeline } = await import('./response-pipeline.js');
const { executeRobotAutonomyTriggerWork } = await import('../../queue/robot-autonomy-trigger-handler.js');
const request = (): UnifiedRequest => ({
  method: 'POST', path: '/api/persona_chat',
  user: { isAuthenticated: false, userId: 'anonymous', username: 'anonymous', role: 'guest' },
  body: { graph, message: 'Hello', mode: 'conversation', stream: false, sessionId: `fixture-${Math.random()}` },
});

test('direct graph API reports the global delivery failure, not successful staging', async () => {
  returnedState = failed;
  const result = await handleExecuteGraph(request());
  assert.equal(result.status, 500);
  assert.equal(result.error, failed.error!.message);
});

test('editor stream reports failure without a subsequent graph-complete event', async () => {
  returnedState = failed;
  const events: string[] = [];
  emitGraphError = true;
  try {
    await handleExecuteGraphStream(graph, 'fixture-stream', undefined, '', chunk => events.push(chunk));
  } finally { emitGraphError = false; }
  assert.ok(events.some(event => event.includes('event: graph_error') && event.includes(failed.error!.message)));
  assert.equal(events.filter(event => event.includes('event: graph_error')).length, 1);
  assert.ok(events.every(event => !event.includes('event: graph_complete')));
});

test('persona chat does not turn earlier generated text into successful completion after global failure', async () => {
  returnedState = failed;
  const result = await handlePersonaChat(request());
  assert.equal(result.status, 500);
  assert.equal(result.error, failed.error!.message);
});

test('response pipeline preserves the global error when no node failed', () => {
  assert.throws(() => extractResponsePipelineResult(failed), error => error instanceof Error
    && error.message === failed.error!.message);
});

test('Response Pipeline handler reports the original global failure', async () => {
  returnedState = failed;
  const result = await handleResponsePipeline({ message: 'An answer', cardType: 'curiosity_response',
    cardData: { questionId: 'fixture-question' }, sessionId: 'fixture-response' }, username);
  assert.equal(result.success, false);
  assert.equal(result.error, failed.error!.message);
  assert.equal(result.errorDetails, failed.error!.message);
});

test('Robot Autonomy Controller handler reports global delivery failure rather than losing the cause', async () => {
  returnedState = failed;
  await assert.rejects(() => executeRobotAutonomyTriggerWork({
    id: 'fixture-controller', username, handler: 'workflow.robot-autonomy-controller', source: 'user',
    input: { agentId: 'robot-autonomy-controller' },
  } as never, { signal: new AbortController().signal } as never),
  error => error instanceof Error && error.message.includes(failed.error!.message));
});

test('Controller reports conditional dispatch outcome without choosing or requiring another action', async () => {
  const { robotAutonomyControllerParserNode } = await import('../../nodes/robot-operator/autonomy-controller-parser.node.js');
  const availableTasks = [
    { id: 'robot-autonomy-executor', name: 'Robot Autonomy Executor', description: 'Execute an embodied intention.',
      kind: 'environment-executor', handler: 'environment.observation', taskType: 'environment_observation', priority: 'low', tags: ['robot'] },
    { id: 'reflector', name: 'Reflector', description: 'Reflect on available context.',
      kind: 'agent', handler: 'agent.reflector', taskType: 'generic', priority: 'low', tags: ['reflection'] },
  ];
  const invoke = () => executeRobotAutonomyTriggerWork({
    id: 'fixture-controller-result', username, handler: 'workflow.robot-autonomy-controller', source: 'user',
    input: { agentId: 'robot-autonomy-controller' },
  } as never, { signal: new AbortController().signal } as never);
  for (const scenario of [
    { taskId: 'robot-autonomy-executor', selectedStatus: 'skipped', response: '', reason: 'Required input(s) inactive: observation' },
    { taskId: 'none', selectedStatus: 'skipped', response: '', reason: undefined },
    { taskId: 'none', selectedStatus: 'skipped', response: 'A conversational thought.', reason: undefined },
    { taskId: 'reflector', selectedStatus: 'completed', response: '', reason: undefined },
    { taskId: 'robot-autonomy-executor', selectedStatus: 'completed', response: 'I want to explore.', reason: undefined },
    { taskId: 'reflector', selectedStatus: 'skipped', response: '', reason: 'Required input(s) inactive: robotObserver' },
  ] as const) {
    const parsed = await robotAutonomyControllerParserNode.execute({ availableTasks, response: JSON.stringify({
      taskId: scenario.taskId, response: scenario.response, reason: 'Selected from the supplied context.',
      observationSummary: 'Current context is available.', instruction: scenario.taskId === 'none' ? '' : 'Investigate the available context.',
    }) }, {}, {});
    const selectedType = scenario.taskId === 'robot-autonomy-executor'
      ? 'robot_operator_environment_dispatch' : 'robot_autonomy_task_dispatch';
    returnedState = { ...failed, status: 'completed', error: undefined, nodes: new Map([
      ['editable-parser-id', { nodeId: 'editable-parser-id', status: 'completed', definition: { type: 'robot_autonomy_controller_parser' }, outputs: parsed }],
      ...['robot_operator_environment_dispatch', 'robot_autonomy_task_dispatch'].map(type => {
        const selected = scenario.taskId !== 'none' && selectedType === type;
        return [type, { nodeId: type, definition: { type }, status: selected ? scenario.selectedStatus : 'skipped',
          ...(selected && scenario.selectedStatus === 'completed'
            ? { outputs: { queued: false, taskId: '', status: 'prepared' } }
            : { skipReason: scenario.reason ?? 'Required input(s) inactive: decision' }),
        }] as [string, import('../../graph-executor.js').NodeExecutionState];
      }),
    ]) };
    const result = await invoke();
    assert.equal(result.executionStatus, 'completed');
    assert.deepEqual(result.decision, parsed.decisionReceipt, 'The handler must preserve the validated LLM choice');
    assert.equal((result.dispatch as any).queued, false);
    assert.equal((result.dispatch as any).status, scenario.taskId === 'none' ? 'none_selected'
      : scenario.selectedStatus === 'skipped' ? 'skipped' : 'prepared');
    if (scenario.reason) assert.equal((result.dispatch as any).reason, scenario.reason);
  }
  returnedState.nodes.delete('robot_autonomy_task_dispatch');
  await assert.rejects(invoke, /requires exactly one robot_autonomy_task_dispatch/);
});

test('editor waiting response preserves saved execution identity and is not completion', async () => {
  returnedState = { ...failed, status: 'waiting', error: undefined, executionId: 'waiting-fixture' };
  const response = await handleExecuteGraph(request());
  assert.equal(response.status, 200);
  assert.equal((response.data as any)?.result?.status, 'waiting');
  assert.equal((response.data as any)?.result?.executionId, 'waiting-fixture');
  const events: string[] = [];
  await handleExecuteGraphStream(graph, 'fixture-stream', undefined, '', chunk => events.push(chunk));
  assert.ok(events.some(event => event.includes('event: graph_waiting') && event.includes('waiting-fixture')));
  assert.ok(events.every(event => !event.includes('event: graph_complete') && !event.includes('event: graph_error')));
  const editor = fs.readFileSync(path.join(repo, 'apps/site/src/components/flow-editor/FlowEditorLayout.svelte'), 'utf8');
  assert.match(editor, /eventType === 'graph_complete' \|\| eventType === 'graph_waiting'/);
  assert.match(editor, /Execution saved and waiting/);
});

test('completed and waiting conversational text remains deliverable', async () => {
  for (const status of ['completed', 'waiting'] as const) {
    returnedState = { ...failed, status, error: undefined };
    const result = await handlePersonaChat(request());
    assert.equal(result.status, 200);
    assert.equal((result.data as any)?.response, 'A generated response before persistence failed.');
  }
});

test('waiting without a response is a saved execution, not a missing-output failure', async () => {
  returnedState = { ...failed, status: 'waiting', error: undefined, nodes: new Map(), executionId: 'waiting-silent' };
  const result = await handlePersonaChat(request());
  assert.equal(result.status, 200);
  assert.equal(result.data.response, '');
  assert.ok(result.data.events.some((event: any) => event.data?.step === 'graph_waiting'
    && event.data.executionId === 'waiting-silent'));
  assert.ok(result.data.events.every((event: any) => event.type !== 'error' && event.type !== 'answer'));
});

test('existing conversational chunks remain streamed but a later failure is not a successful answer', async () => {
  streamChunk = 'An earlier generated chunk.';
  try {
    for (const status of ['completed', 'failed'] as const) {
      returnedState = { ...failed, status, error: status === 'failed' ? failed.error : undefined };
      const req = request();
      req.body.stream = true;
      const result = await handlePersonaChat(req);
      const events: any[] = [];
      for await (const chunk of result.stream!) events.push(JSON.parse(chunk.slice(6).trim()));
      assert.ok(events.some(event => event.type === 'big_brother_output' && event.data.chunk === streamChunk));
      assert.equal(events.some(event => event.type === 'answer'), status === 'completed');
      assert.equal(events.some(event => event.type === 'error' && event.data.message === failed.error!.message), status === 'failed');
    }
  } finally { streamChunk = ''; }
});

test('existing conversational cancellation remains a cancellation event', async () => {
  returnedState = { ...failed, error: new Error('CANCELLATION_REQUESTED') };
  const result = await handlePersonaChat(request());
  assert.equal(result.status, 200);
  assert.ok(result.data.events.some((event: any) => event.type === 'cancelled'));
  assert.ok(result.data.events.every((event: any) => event.type !== 'answer' && event.type !== 'error'));
});

test.after(() => {
  streamingMock.restore(); usersMock.restore(); coreMock.restore(); runtimeMock.restore(); eventBus.disconnect();
});
