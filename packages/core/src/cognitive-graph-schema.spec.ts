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
