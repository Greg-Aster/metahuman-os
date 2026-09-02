import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { responsePipelineCardTypeForReply } from '../apps/site/src/lib/client/conversation-transport.js';
import { ModelRouterNode } from '../packages/core/src/nodes/llm/model-router.node.js';

const graph = JSON.parse(fs.readFileSync(
  new URL('../etc/cognitive-graphs/environment-mode.json', import.meta.url),
  'utf8',
)) as {
  nodes: Array<{
    id: string;
    data: {
      label?: string;
      nodeType: string;
      comment?: string;
      properties?: Record<string, unknown>;
    };
  }>;
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
  const prepare = graph.nodes.find(node => (
    node.data.nodeType === 'environment_task_state'
    && node.data.properties?.phase === 'prepare'
  ))!;
  const reducer = graph.nodes.find(node => (
    node.data.nodeType === 'environment_task_state'
    && node.data.properties?.phase === 'reduce'
  ))!;
  const bridge = graph.nodes.find(node => node.data.nodeType === 'environment_send_action')!;

  assert.equal(hasEdge(parser.id, 'actions', reducer.id, 'actions'), true);
  assert.equal(hasEdge(parser.id, 'movementRequest', generator.id, 'movementRequest'), true);
  assert.equal(hasEdge(prepare.id, 'movementRequest', generator.id, 'preparedMovementRequest'), true);
  assert.equal(hasEdge(prepare.id, 'movementRequest', '3', 'preparedMovementRequest'), true);
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
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /terminal action result proves execution/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /visual observation proves only visible facts/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /neither invent extra steps nor impose a fixed action count/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /response is optional and is never execution/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /one or two concise sentences/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Preserve taskState/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Make one semantic routing decision/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Capabilities are options/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /choose an advertised action when its description performs the current step/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Use movementRequest only when the current movement itself is uncovered/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /actions and movementRequest are mutually exclusive/i);

  assert.equal(hasEdge(instruction.id, 'observation', prepare.id, 'observation'), true);
  assert.equal(hasEdge(prepare.id, 'memoryHints', memoryRouter.id, 'orchestratorHints'), true);
  assert.equal(hasEdge(memoryRouter.id, 'memories', contextBuilder.id, 'memories'), true);
  assert.equal(hasEdge(history.id, 'history', contextBuilder.id, 'conversationHistory'), true);
  assert.equal(hasEdge(prepare.id, 'routingAnalysis', contextBuilder.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(prepare.id, 'routingAnalysis', actionParser.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(prepare.id, 'precomputedResponse', environmentLlm.id, 'precomputedResponse'), false);
  assert.equal(hasEdge(environmentLlm.id, 'response', thinkingStripper.id, 'response'), true);
  assert.equal(hasEdge(thinkingStripper.id, 'response', actionParser.id, 'response'), true);
  assert.equal(hasEdge(actionParser.id, 'actions', reducer.id, 'actions'), true);
  for (const retired of [
    'orchestrator_llm',
    'smart_router',
    'search_interpreter',
    'environment_task_refiner',
    'environment_selection_gate',
  ]) {
    assert.equal(graph.nodes.some(node => node.data.nodeType === retired), false);
  }
});

test('Environment Action Selector documents its role and exposes every consumed setting', () => {
  const environmentLlm = graph.nodes.find(node => node.data.nodeType === 'model_router')!;
  assert.match(String(environmentLlm.data.comment), /Semantic Environment decision point/i);
  assert.match(String(environmentLlm.data.comment), /does not execute or authorize physical work/i);

  const defaults = Object.keys(ModelRouterNode.properties ?? {}).sort();
  const editable = Object.keys(ModelRouterNode.propertySchemas ?? {}).sort();
  assert.deepEqual(editable, defaults);
  assert.equal(ModelRouterNode.properties?.repeatPenalty, 1.15);
  assert.equal(ModelRouterNode.propertySchemas?.repeatPenalty?.advanced, true);
  for (const key of editable) {
    assert.ok(
      ModelRouterNode.propertySchemas?.[key]?.description,
      `${key} has right-panel help text`,
    );
  }
});

test('ordinary selected-message replies remain on Environment Mode while dedicated cards retain their pipeline', () => {
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    cardType: 'selected_card',
  }), null);
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    cardType: 'assistant_message',
  }), null);
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    cardType: 'curiosity',
    questionId: 'question-one',
  }), 'curiosity_response');
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    cardType: 'clarifying_questions',
    desireId: 'desire-one',
    dialogueSource: 'agency-system',
  }), 'clarifying_questions');
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    cardType: 'selected_card',
  }), 'selected_card');
});
