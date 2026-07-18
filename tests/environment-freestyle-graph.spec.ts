import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const graph = JSON.parse(fs.readFileSync(
  new URL('../etc/cognitive-graphs/environment-mode.json', import.meta.url),
  'utf8',
)) as {
  nodes: Array<{ id: string; data: { nodeType: string; properties?: Record<string, unknown> } }>;
  edges: Array<{ source: string; target: string; sourceHandle: string; targetHandle: string }>;
};

function hasEdge(source: string, sourceHandle: string, target: string, targetHandle: string): boolean {
  return graph.edges.some(edge => (
    edge.source === source
    && edge.sourceHandle === sourceHandle
    && edge.target === target
    && edge.targetHandle === targetHandle
  ));
}

test('Environment Mode has one explicit off-script generation branch that rejoins Bridge Out', () => {
  const generators = graph.nodes.filter(node => node.data.nodeType === 'movement_generator');
  assert.equal(generators.length, 1);
  const generator = generators[0]!;
  const parser = graph.nodes.find(node => node.data.nodeType === 'environment_action_parser')!;
  const bridge = graph.nodes.find(node => node.data.nodeType === 'environment_send_action')!;

  assert.equal(hasEdge(parser.id, 'actions', bridge.id, 'actions'), true, 'semantic actions keep their direct path');
  assert.equal(hasEdge(parser.id, 'movementRequest', generator.id, 'movementRequest'), true);
  assert.equal(hasEdge(generator.id, 'actions', bridge.id, 'generatedActions'), true);
  assert.equal(hasEdge(generator.id, 'response', bridge.id, 'generatedResponse'), true);
  assert.equal(
    (bridge.data.properties?.allowedActions as string[]).includes('robotMotionPlan'),
    true,
  );
});

test('Environment Mode reuses the existing LLM and semantic context-routing nodes', () => {
  const contextRouter = graph.nodes.find(node => node.data.nodeType === 'orchestrator_llm')!;
  const memoryDecision = graph.nodes.find(node => node.data.nodeType === 'smart_router')!;
  const memoryRouter = graph.nodes.find(node => node.data.nodeType === 'memory_router')!;
  const memoryInterpreter = graph.nodes.find(node => node.data.nodeType === 'search_interpreter')!;
  const contextBuilder = graph.nodes.find(node => node.data.nodeType === 'environment_context_builder')!;
  const actionParser = graph.nodes.find(node => node.data.nodeType === 'environment_action_parser')!;
  const instruction = graph.nodes.find(node => node.data.nodeType === 'environment_instruction_interpreter')!;
  const history = graph.nodes.find(node => node.data.nodeType === 'conversation_history')!;

  assert.ok(contextRouter);
  assert.ok(memoryDecision);
  assert.ok(memoryRouter);
  assert.ok(memoryInterpreter);
  assert.match(String(contextRouter.data.properties?.systemPrompt), /current message requires/i);
  assert.match(String(contextRouter.data.properties?.systemPrompt), /history is reference material only/i);
  assert.equal(contextBuilder.data.properties?.recentHistoryLimit, 4);

  assert.equal(hasEdge(instruction.id, 'instruction', contextRouter.id, 'message'), true);
  assert.equal(hasEdge(history.id, 'history', contextRouter.id, 'conversationHistory'), true);
  assert.equal(hasEdge(contextRouter.id, 'analysis', memoryDecision.id, 'orchestratorAnalysis'), true);
  assert.equal(hasEdge(memoryDecision.id, 'memoryHints', memoryRouter.id, 'orchestratorHints'), true);
  assert.equal(hasEdge(memoryRouter.id, 'memories', memoryInterpreter.id, 'searchResults'), true);
  assert.equal(hasEdge(memoryInterpreter.id, 'relevantMemories', contextBuilder.id, 'memories'), true);
  assert.equal(hasEdge(contextRouter.id, 'analysis', contextBuilder.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(contextRouter.id, 'analysis', actionParser.id, 'routingAnalysis'), true);
});
