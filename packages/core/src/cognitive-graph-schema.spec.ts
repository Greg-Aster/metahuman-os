import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GRAPH_SCHEDULER,
  GraphValidationError,
  validateSvelteFlowGraph,
} from './cognitive-graph-schema.js';

function noteNode(id: string, parentId?: string) {
  return {
    id,
    type: 'noteNode',
    position: { x: 0, y: 0 },
    parentId,
    extent: parentId ? 'parent' : undefined,
    data: {
      label: id,
      nodeType: 'cognitive/graph_note',
      properties: { title: id, content: '', style: 'info', frame: true },
    },
  };
}

function graph(nodes: ReturnType<typeof noteNode>[]) {
  return {
    version: '1.0',
    format: 'svelte-flow',
    name: 'Visual groups',
    scheduler: { ...DEFAULT_GRAPH_SCHEDULER },
    nodes,
    edges: [],
  };
}

test('accepts an acyclic visual group hierarchy', () => {
  assert.doesNotThrow(() => validateSvelteFlowGraph(graph([
    noteNode('frame'),
    noteNode('child', 'frame'),
  ])));
});

test('rejects cycles in persisted visual group hierarchy', () => {
  assert.throws(
    () => validateSvelteFlowGraph(graph([
      noteNode('frame-a', 'frame-b'),
      noteNode('frame-b', 'frame-a'),
    ])),
    (error: unknown) => error instanceof GraphValidationError
      && error.errors.some(message => message.includes('parent hierarchy contains a cycle')),
  );
});

test('a saved input entry must identify an enabled, always-active input receiver', () => {
  const receiver = {
    id: 'input', type: 'utilityNode', position: { x: 0, y: 0 },
    data: { label: 'Receive Input', nodeType: 'execution_event_wait', properties: { drain: true },
      activation: { mode: 'always' } },
  };
  const configured = { ...graph([]), nodes: [receiver],
    scheduler: { ...DEFAULT_GRAPH_SCHEDULER, eventInputNodeId: receiver.id } };
  assert.doesNotThrow(() => validateSvelteFlowGraph(configured));
  for (const patch of [{ muted: true }, { activation: { mode: 'any-input' } }, { nodeType: 'text_input' }]) {
    assert.throws(() => validateSvelteFlowGraph({ ...configured,
      nodes: [{ ...receiver, data: { ...receiver.data, ...patch } }] }),
    (error: unknown) => error instanceof GraphValidationError && error.errors.some(message => message.includes('eventInputNodeId')));
  }
  assert.throws(() => validateSvelteFlowGraph({ ...configured, nodes: [] }), GraphValidationError);
});
