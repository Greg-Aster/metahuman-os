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
  const reducer = graph.nodes.find(node => (
    node.data.nodeType === 'environment_task_state'
    && node.data.properties?.phase === 'reduce'
  ))!;
  const bridge = graph.nodes.find(node => node.data.nodeType === 'environment_send_action')!;

  assert.equal(hasEdge(parser.id, 'actions', reducer.id, 'actions'), true);
  assert.equal(hasEdge(parser.id, 'movementRequest', generator.id, 'movementRequest'), true);
  assert.equal(hasEdge(generator.id, 'actions', reducer.id, 'generatedActions'), true);
  assert.equal(hasEdge(generator.id, 'response', reducer.id, 'generatedResponse'), true);
  assert.equal(hasEdge(reducer.id, 'actions', bridge.id, 'actions'), true);
  assert.equal(
    (bridge.data.properties?.allowedActions as string[]).includes('robotMotionPlan'),
    true,
  );
});

test('Environment Mode sends one action selector directly to parser and one task-state owner', () => {
  const memoryRouter = graph.nodes.find(node => node.data.nodeType === 'memory_router')!;
  const contextBuilder = graph.nodes.find(node => node.data.nodeType === 'environment_context_builder')!;
  const actionParser = graph.nodes.find(node => node.data.nodeType === 'environment_action_parser')!;
  const instruction = graph.nodes.find(node => node.data.nodeType === 'environment_instruction_interpreter')!;
  const history = graph.nodes.find(node => node.data.nodeType === 'conversation_history')!;
  const taskNodes = graph.nodes.filter(node => node.data.nodeType === 'environment_task_state');
  const prepare = taskNodes.find(node => node.data.properties?.phase === 'prepare')!;
  const reducer = taskNodes.find(node => node.data.properties?.phase === 'reduce')!;
  const environmentLlm = graph.nodes.find(node => node.data.nodeType === 'model_router')!;
  const thinkingStripper = graph.nodes.find(node => node.data.nodeType === 'thinking_stripper')!;

  assert.ok(memoryRouter);
  assert.equal(taskNodes.length, 2);
  assert.equal(graph.nodes.filter(node => node.data.nodeType === 'model_router').length, 1);
  assert.equal(environmentLlm.data.properties?.role, 'environmentActionSelector');
  assert.equal(contextBuilder.data.properties?.recentHistoryLimit, 4);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /robot(?:-mounted)? camera sees the external scene/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Task State is the sole lifecycle owner/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /taskDecision is the semantic contract for the whole objective/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /captureImage is an action type, never a robotCommand command/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Never claim to be waiting, searching, or continuing without returning the action/i);

  assert.equal(hasEdge(instruction.id, 'observation', prepare.id, 'observation'), true);
  assert.equal(hasEdge(prepare.id, 'memoryHints', memoryRouter.id, 'orchestratorHints'), true);
  assert.equal(hasEdge(memoryRouter.id, 'memories', contextBuilder.id, 'memories'), true);
  assert.equal(hasEdge(history.id, 'history', contextBuilder.id, 'conversationHistory'), true);
  assert.equal(hasEdge(prepare.id, 'routingAnalysis', contextBuilder.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(prepare.id, 'routingAnalysis', actionParser.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(prepare.id, 'precomputedResponse', environmentLlm.id, 'precomputedResponse'), true);
  assert.equal(hasEdge(environmentLlm.id, 'response', thinkingStripper.id, 'response'), true);
  assert.equal(hasEdge(thinkingStripper.id, 'response', actionParser.id, 'response'), true);
  assert.equal(hasEdge(actionParser.id, 'actions', reducer.id, 'actions'), true);
  for (const retired of [
    'orchestrator_llm',
    'smart_router',
    'search_interpreter',
    'environment_task_refiner',
    'environment_selection_gate',
    'persona_loader',
    'persona_formatter',
  ]) {
    assert.equal(graph.nodes.some(node => node.data.nodeType === retired), false);
  }
});
