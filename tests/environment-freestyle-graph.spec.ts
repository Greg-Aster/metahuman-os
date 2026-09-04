import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { responsePipelineCardTypeForReply } from '../apps/site/src/lib/client/conversation-transport.js';
import { ModelRouterNode } from '../packages/core/src/nodes/llm/model-router.node.js';
import { parseEnvironmentIntentRouting } from '../packages/core/src/nodes/llm/orchestrator-llm.node.js';

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
      activation?: { when?: Array<{ nodeId: string; output: string; truthy?: boolean }> };
    };
  }>;
  edges: Array<{ source: string; target: string; sourceHandle: string; targetHandle: string; data?: { kind?: string; when?: { output: string; truthy?: boolean; notEquals?: unknown } } }>;
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
  const statusOut = graph.nodes.find(node => node.data.nodeType === 'robot_status_out')!;

  assert.equal(hasEdge(parser.id, 'actions', bridge.id, 'actions'), true);
  assert.equal(hasEdge(parser.id, 'movementRequest', generator.id, 'movementRequest'), true);
  assert.deepEqual(generator.data.activation?.when, [
    { nodeId: parser.id, output: 'movementRequest', truthy: true },
  ]);
  assert.deepEqual(bridge.data.activation?.when, [
    { nodeId: parser.id, output: 'valid', truthy: true },
  ]);
  assert.equal(hasEdge(generator.id, 'actions', bridge.id, 'generatedActions'), true);
  assert.equal(hasEdge(generator.id, 'response', bridge.id, 'generatedResponse'), false);
  assert.equal(hasEdge(parser.id, 'taskDecision', statusOut.id, 'taskDecision'), true);
  assert.equal(hasEdge(bridge.id, 'bridgeRecord', statusOut.id, 'bridgeRecord'), true);
  assert.equal(
    (bridge.data.properties?.allowedActions as string[]).includes('robotMotionPlan'),
    true,
  );
});

test('Environment Mode uses one route-only orchestrator before selected context and one action selector', () => {
  const orchestrator = graph.nodes.find(node => node.data.nodeType === 'orchestrator_llm')!;
  const memoryRouter = graph.nodes.find(node => node.data.nodeType === 'memory_router')!;
  const contextBuilder = graph.nodes.find(node => node.data.nodeType === 'environment_context_builder')!;
  const actionParser = graph.nodes.find(node => node.data.nodeType === 'environment_action_parser')!;
  const userInput = graph.nodes.find(node => node.data.nodeType === 'user_input')!;
  const bridgeInput = graph.nodes.find(node => node.data.nodeType === 'environment_bridge_input')!;
  const history = graph.nodes.find(node => node.data.nodeType === 'conversation_history')!;
  const imageInput = graph.nodes.find(node => node.data.nodeType === 'environment_image_input')!;
  const statusInput = graph.nodes.find(node => node.data.nodeType === 'robot_status')!;
  const statusOut = graph.nodes.find(node => node.data.nodeType === 'robot_status_out')!;
  const bridge = graph.nodes.find(node => node.data.nodeType === 'environment_send_action')!;
  const environmentLlm = graph.nodes.find(node => node.data.nodeType === 'model_router')!;

  assert.ok(memoryRouter);
  assert.ok(imageInput);
  assert.ok(orchestrator);
  assert.ok(statusInput);
  assert.ok(statusOut);
  assert.equal(graph.nodes.filter(node => node.data.nodeType === 'model_router').length, 1);
  assert.equal(environmentLlm.data.properties?.role, 'environmentActionSelector');
  assert.equal(orchestrator.data.properties?.outputContract, 'environment');
  assert.equal(orchestrator.data.properties?.maxTokens, 768);
  const intentPrompt = String(orchestrator.data.properties?.systemPrompt);
  assert.match(intentPrompt, /needsResponse exposes user-visible natural-language expression/i);
  assert.match(intentPrompt, /needsRobotStatus exposes the canonical current snapshot/i);
  assert.match(intentPrompt, /Routes are independent/i);
  assert.match(intentPrompt, /Infer which information and capabilities are relevant/i);
  assert.deepEqual(parseEnvironmentIntentRouting(JSON.stringify({
    needsResponse: true,
    needsConversationHistory: false,
    needsMemory: false,
    needsRobotStatus: true,
    needsEnvironment: true,
    needsVision: false,
    needsAction: true,
  })), {
    needsResponse: true,
    needsConversationHistory: false,
    needsMemory: false,
    needsRobotStatus: true,
    needsEnvironment: true,
    needsVision: false,
    needsAction: true,
  });
  assert.throws(
    () => parseEnvironmentIntentRouting('{"needsResponse":true}'),
    /requires boolean needsConversationHistory/,
  );
  assert.equal(contextBuilder.data.properties?.recentHistoryLimit, 4);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /action result proves execution/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /visual observation proves only visible facts/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /selectedRoutes is the Intent Orchestrator's decision/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /response field carries the user-visible natural-language expression/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Use those selected capabilities without deciding the routes again/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /current visual evidence is useful but absent/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /saved environment observation supplies last-known state and capabilities/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /Advertised actions are proven capabilities/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /movementRequest is available for a novel movement/i);
  assert.match(String(contextBuilder.data.properties?.systemPrompt), /actions and movementRequest are exclusive/i);
  assert.match(
    String(contextBuilder.data.properties?.systemPrompt),
    /outcome act means that actions or movementRequest is non-empty and objectiveComplete is false/i,
  );

  assert.equal(graph.nodes.some(node => node.data.nodeType === 'instruction_resolver'), false);
  assert.equal(hasEdge(userInput.id, 'message', orchestrator.id, 'message'), true);
  assert.equal(hasEdge(history.id, 'history', orchestrator.id, 'conversationHistory'), true);
  assert.equal(hasEdge(orchestrator.id, 'analysis', contextBuilder.id, 'routingAnalysis'), true);
  assert.equal(hasEdge(orchestrator.id, 'analysis', memoryRouter.id, 'orchestratorHints'), true);
  assert.equal(hasEdge(bridgeInput.id, 'isTriggeringObservation', imageInput.id, 'observationCurrent'), true);
  assert.deepEqual(memoryRouter.data.activation?.when, [
    { nodeId: orchestrator.id, output: 'needsMemory', truthy: true },
  ]);
  assert.deepEqual(statusInput.data.activation?.when, [
    { nodeId: orchestrator.id, output: 'needsRobotStatus', truthy: true },
  ]);
  assert.deepEqual(imageInput.data.activation?.when, [
    { nodeId: orchestrator.id, output: 'needsVision', truthy: true },
  ]);
  assert.equal(hasEdge(userInput.id, 'message', contextBuilder.id, 'instruction'), true);
  assert.equal(hasEdge(userInput.id, 'message', contextBuilder.id, 'userInstruction'), true);
  assert.equal(hasEdge(userInput.id, 'message', memoryRouter.id, 'userMessage'), true);
  assert.equal(hasEdge(memoryRouter.id, 'memories', contextBuilder.id, 'memories'), true);
  assert.equal(hasEdge(history.id, 'history', contextBuilder.id, 'conversationHistory'), true);
  assert.equal(hasEdge(statusInput.id, 'context', contextBuilder.id, 'robotStatus'), true);
  assert.equal(graph.nodes.some(node => node.data.nodeType === 'thinking_stripper'), false);
  assert.equal(hasEdge(environmentLlm.id, 'response', actionParser.id, 'response'), true);
  assert.equal(hasEdge(actionParser.id, 'actions', bridge.id, 'actions'), true);
  assert.equal(hasEdge(actionParser.id, 'taskDecision', statusOut.id, 'taskDecision'), true);
  assert.equal(hasEdge(bridge.id, 'bridgeRecord', statusOut.id, 'bridgeRecord'), true);
  for (const retired of [
    'smart_router',
    'search_interpreter',
    'environment_task_refiner',
    'environment_selection_gate',
    'environment_observation',
    'environment_instruction_interpreter',
    'environment_prompt',
    'environment_task_input',
    'environment_task_preparation',
    'environment_task_reducer',
    'robot_operator_input',
    'environment_action_context_input',
    'environment_feedback',
    'environment_map_input',
    'debug_output_viewer',
    'environment_chat',
  ]) {
    assert.equal(graph.nodes.some(node => node.data.nodeType === retired), false);
  }
});

test('Environment Action Selector documents its role and exposes every consumed setting', () => {
  const environmentLlm = graph.nodes.find(node => node.data.nodeType === 'model_router')!;
  assert.match(String(environmentLlm.data.comment), /executes the chosen routes/i);
  assert.match(String(environmentLlm.data.comment), /does not decide which context branches run/i);

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
