import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { ConversationHistoryNode } from '../context/conversation-history.node.js';
import { TextInputNode } from '../input/text-input.node.js';
import { robotOperatorContextBuilderNode } from './context-builder.node.js';
import { robotOperatorDecisionParserNode } from './decision-parser.node.js';
import { robotOperatorEnvironmentDispatchNode } from './environment-dispatch.node.js';

function robotObservation() {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-03T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage', 'robotCommand', 'sendText'],
      robotCommands: ['walk', 'wave', 'stop'],
      visual: true,
      movement: true,
    },
    state: { body: { authenticated: true, cameraReady: true } },
    visual: {
      id: 'camera-1',
      timestamp: '2026-08-03T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      metadata: { correlationId: 'cycle-1' },
    },
    visuals: [],
    feedback: [{
      id: 'capture-completed',
      timestamp: '2026-08-03T12:00:00.000Z',
      type: 'completed' as const,
      message: 'image captured',
      actionId: 'capture-1',
    }],
    metadata: {
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        triggerSource: 'autonomy' as const,
        graph: 'robot-operator',
        requestedBy: 'robot-observer' as const,
      },
    },
  };
}

test('configured Conversation Buffer history reads the canonical conversation context', async () => {
  const conversationHistory = [
    { role: 'user', content: 'The blue ball belongs beside the charging station.' },
    { role: 'assistant', content: 'I will remember where it belongs.' },
  ];
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory,
  }, { mode: 'conversation', limit: 20 });

  assert.equal(result.mode, 'conversation');
  assert.deepEqual(result.history, conversationHistory);
  assert.equal(result.loadedFromBuffer, false);
});

test('configured Inner Buffer history does not fall back to conversation context', async () => {
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory: [
      { role: 'user', content: 'Continue the previous push-up task.' },
    ],
  }, { mode: 'inner', limit: 3 });

  assert.equal(result.mode, 'inner');
  assert.deepEqual(result.history, []);
  assert.equal(result.loadedFromBuffer, false);
});

test('Robot Operator policy input uses the editable graph message', async () => {
  const result = await TextInputNode.execute({}, {
    environmentTaskInstruction: 'hidden runtime fallback',
    userMessage: 'unrelated user fallback',
  }, {
    message: 'editable graph fallback',
    inputKey: '',
  });

  assert.equal(result.text, 'editable graph fallback');
  assert.equal(result.hasTextInput, true);
});

test('Buffer History limit zero defers retention to the canonical buffer owner', async () => {
  const retained = Array.from({ length: 80 }, (_, index) => ({
    role: 'reflection',
    content: `Retained inner entry ${index + 1}`,
  }));
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory: retained,
  }, { mode: 'conversation', limit: 0 });

  assert.equal(result.count, 80);
  assert.equal(result.pruned, false);
});

test('Robot Operator context consolidates separate instructions, conversation, inner context, persona, trigger, and correlated image', async () => {
  const observation = robotObservation();
  const instruction = 'Decide one high-level intention and return configured JSON.';
  const result = await robotOperatorContextBuilderNode.execute({
    instruction,
    observation,
    conversationHistory: [
      {
        role: 'user',
        content: 'The blue ball belongs beside the charging station.',
        meta: {
          cognitiveMode: 'environment',
          taskLifecycle: {
            kind: 'environment_task_lifecycle',
            cycleId: 'ball-cycle',
            objective: 'Remember where the blue ball belongs.',
            outcome: 'complete',
          },
        },
      },
      {
        role: 'system',
        content: '[Inner thought - reflection]: I am curious about how the light in the room has changed.',
        meta: {
          isInnerDialogue: true,
          originalRole: 'reflection',
          dialogueSource: 'reflector',
          tags: ['idle-thought', 'self-reflection', 'inner'],
        },
      },
    ],
    personaText: '## Personality Traits\n- curious: high\n- pragmatic: medium',
    taskState: {
      version: 1,
      objective: 'Choose what to pursue from the current stimulus.',
      phase: 'new',
      step: 0,
      maxSteps: 8,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    memoryContext: [{ content: 'A past afternoon walk inspired a playful stretch.', timestamp: '2026-07-01T12:00:00.000Z' }],
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.recentContextCount, 2);
  assert.equal(result.context.innerContextCount, 1);
  assert.equal(result.context.personaIncluded, true);
  assert.equal(result.context.memoryContextCount, 1);
  assert.ok(result.jsonSchema.properties.taskDecision.required.includes('objective'));
  assert.equal(result.messages[0]?.content, instruction);
  assert.doesNotMatch(String(result.messages[0]?.content), /curious: high|blue ball/i);
  assert.equal(result.messages[1]?.role, 'assistant');
  assert.match(String(result.messages[1]?.content), /canonical_conversation_history/);
  assert.match(String(result.messages[1]?.content), /canonical_environment_task_state/);
  assert.match(String(result.messages[1]?.content), /Choose what to pursue from the current stimulus/);
  assert.match(String(result.messages[1]?.content), /curious: high/);
  assert.match(String(result.messages[1]?.content), /blue ball belongs/);
  assert.match(String(result.messages[1]?.content), /curious about how the light/);
  assert.match(String(result.messages[1]?.content), /historical_memory_inspiration/);
  assert.match(String(result.messages[1]?.content), /currentEvidence\":false/);
  assert.match(String(result.messages[1]?.content), /past afternoon walk/);
  const userContent = result.messages[2]?.content as Array<{ type: string; text?: string }>;
  assert.equal(Array.isArray(userContent), true);
  assert.equal(userContent.length, 2);
  assert.doesNotMatch(String(userContent[0]?.text), /curious about how the light/);
  assert.doesNotMatch(String(userContent[0]?.text), /blue ball belongs/i);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);
  assert.match(String(userContent[0]?.text), /"source":"autonomy"/);
  assert.match(String(userContent[0]?.text), /captureImage/);
  assert.match(String(userContent[0]?.text), /image captured/);

  const stale = await robotOperatorContextBuilderNode.execute({
    instruction,
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, {});
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');

  const missingInstruction = await robotOperatorContextBuilderNode.execute({ observation }, {}, {});
  assert.equal(missingInstruction.valid, false);
  assert.match(missingInstruction.error, /connected text input node/i);
});

test('Robot Operator context separates correlated task narrative from older conversation', async () => {
  const observation = robotObservation();
  const taskState = {
    version: 1,
    objective: 'Investigate the object near the charging station.',
    phase: 'evaluating_evidence',
    step: 1,
    maxSteps: 8,
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
  };
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Maintain one self-authored autonomy objective.',
    observation,
    taskState,
    conversationHistory: [
      {
        role: 'assistant',
        content: 'I moved closer because the object caught my attention.',
        meta: { correlationId: 'cycle-1', dialogueSource: 'boredom-observer' },
      },
      {
        role: 'assistant',
        content: 'An unrelated remark from an older boredom episode.',
        meta: { correlationId: 'older-cycle', dialogueSource: 'boredom-reflection' },
      },
    ],
  }, {}, {});
  assert.equal(result.context.taskNarrativeCount, 1);
  const serialized = String(result.messages[1]?.content);
  assert.match(serialized, /environmentTaskState/);
  assert.equal(serialized.match(/Investigate the object near the charging station/g)?.length, 1);
  assert.match(serialized, /I moved closer because the object caught my attention/);
  assert.match(serialized, /unrelated remark from an older boredom episode/);
  assert.equal(serialized.match(/I moved closer because the object caught my attention/g)?.length, 1);
});

test('Robot Operator context preserves canonical combined history without adding a second retention policy', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Return the configured observation decision JSON.',
    observation,
    conversationHistory: [
      {
        role: 'user',
        content: 'Please remember that I prefer quiet responses in the morning.',
      },
      {
        role: 'system',
        content: 'Oldest admitted observation.',
        meta: {
          isInnerDialogue: true,
          originalRole: 'reflection',
          tags: ['idle-thought', 'inner'],
        },
      },
      { role: 'assistant', content: 'I will keep morning responses quiet.' },
      { role: 'reflection', content: 'Legacy raw inner record must not enter.' },
      { role: 'reasoning', content: 'Private reasoning must not enter.', meta: { tags: ['idle-thought'] } },
    ],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.recentContextCount, 3);
  assert.equal(result.context.innerContextCount, 1);
  const stimulus = result.context.stimulus;
  assert.deepEqual(
    result.context.recentContext.map((entry: any) => entry.content),
    [
      'Please remember that I prefer quiet responses in the morning.',
      'Oldest admitted observation.',
      'I will keep morning responses quiet.',
    ],
  );
  assert.equal('recentIdleThoughts' in stimulus, false);
  assert.deepEqual(stimulus.capabilities, observation.capabilities);
  assert.equal(stimulus.feedback[0]?.message, 'image captured');
  assert.equal(stimulus.trigger.source, 'autonomy');
  assert.equal('source' in stimulus, false);
  assert.equal('currentObservationContract' in stimulus, false);
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /prefer quiet responses/);
  assert.match(serialized, /Oldest admitted observation/);
  assert.match(serialized, /isInnerDialogue/);
  assert.doesNotMatch(serialized, /Legacy raw inner record/);
  assert.doesNotMatch(serialized, /Private reasoning/);
  assert.match(serialized, /captureImage|robotCommand|image captured/);
});

test('Boredom Autonomy context carries trigger, separate inner history, delegated memory, and capability schema once', async () => {
  const observation: any = robotObservation();
  observation.metadata.autonomousStimulus = 'boredom-reflection';
  observation.metadata.robotObserver.requestedBy = 'boredom-reflection';
  observation.metadata.robotOperatorMemories = ['The striped ball once led to a playful bow.'];
  observation.metadata.robotOperatorDecision = { requiresAction: true };
  observation.metadata.actionContext = {
    actionId: 'action-1',
    status: 'completed',
    requested: { type: 'robotCommand', command: 'wave' },
  };
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Choose one grounded consequence and return the configured action JSON.',
    stimulusInstruction: 'Let one concrete remembered detail inspire what happens next.',
    observation,
    conversationHistory: [{ role: 'user', content: 'I enjoy quiet mornings.' }],
    innerHistory: [{
      role: 'reflection',
      content: 'The soft light makes slow movements feel right.',
      meta: { dialogueSource: 'boredom-observer', tags: ['inner'] },
    }],
    actionHistory: [
      {
        role: 'robot',
        timestamp: 1,
        meta: {
          bridgeRecord: {
            direction: 'outbound',
            status: 'coordinated_for_adapter',
            commands: [{ id: 'action-1', type: 'robotCommand', command: 'wave', status: 'queued' }],
            correlationId: 'cycle-1',
          },
        },
      },
      {
        role: 'robot',
        timestamp: 2,
        meta: {
          bridgeRecord: {
            direction: 'inbound',
            status: 'completed',
            actionId: 'action-1',
            action: { id: 'action-1', type: 'robotCommand', command: 'wave' },
            message: 'done',
          },
        },
      },
    ],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.recentContextCount, 2);
  assert.equal(result.context.innerContextCount, 1);
  assert.equal(result.context.actionHistoryCount, 1);
  assert.equal(result.context.historicalLatestActionIncluded, false);
  assert.equal(result.context.stimulus.verifiedCurrentAction, null);
  assert.equal(result.context.memoryContextCount, 1);
  assert.equal(result.context.stimulusInstruction, 'Let one concrete remembered detail inspire what happens next.');
  const serialized = JSON.stringify(result.messages);
  assert.equal(serialized.match(/striped ball once led to a playful bow/g)?.length, 1);
  assert.equal(serialized.match(/soft light makes slow movements feel right/g)?.length, 1);
  assert.equal(serialized.match(/concrete remembered detail inspire/g)?.length, 1);
  const supporting = JSON.parse(String(result.messages[1]?.content));
  assert.deepEqual(
    supporting.robotOperatorContext.verifiedActionHistory.entries[0],
    {
      actionId: 'action-1',
      requested: { type: 'robotCommand', command: 'wave' },
      status: 'completed',
      correlationId: 'cycle-1',
      requestedAt: 1,
      verified: true,
      result: 'done',
      completedAt: 2,
    },
  );
  const taskDecision = (result.jsonSchema as any).properties.taskDecision;
  assert.equal('presentation' in taskDecision.properties, false);
  assert.equal(taskDecision.required.includes('actionPurpose'), false);
  assert.equal(taskDecision.required.includes('motionClass'), false);
  assert.ok('actionPurpose' in taskDecision.properties);
  assert.ok('motionClass' in taskDecision.properties);
  assert.equal('escalation' in taskDecision.properties, false);
  assert.equal(taskDecision.properties.outcome.enum.includes('escalate'), false);
  const actionBranches = (result.jsonSchema as any).properties.actions.items.anyOf;
  const commandBranch = actionBranches.find((branch: any) => (
    branch.properties.type.enum.includes('robotCommand')
  ));
  assert.deepEqual(commandBranch.properties.command.enum, ['walk', 'wave', 'stop']);
  assert.equal((result.jsonSchema as any).properties.actions.minItems, 1);
});

test('Boredom Autonomy keeps prior action context without treating it as current episode evidence', async () => {
  const observation: any = robotObservation();
  observation.metadata.actionContext = {
    actionId: 'prior-action',
    correlationId: 'prior-cycle',
    status: 'completed',
    requested: { type: 'robotCommand', command: 'bow' },
    result: { type: 'completed', message: 'bow completed' },
  };

  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Continue the evolving boredom episode from all supplied context.',
    observation,
  }, {}, {});

  assert.equal(result.context.stimulus.verifiedCurrentAction, null);
  assert.equal(result.context.historicalLatestActionIncluded, true);
  const supporting = JSON.parse(String(result.messages[1]?.content));
  assert.equal(
    supporting.robotOperatorContext.recentActionContext.entry.requested.command,
    'bow',
  );
  assert.equal(supporting.robotOperatorContext.recentActionContext.currentEvidence, false);
});

test('Boredom Autonomy exposes the correlated result as current evidence exactly once', async () => {
  const observation: any = robotObservation();
  observation.metadata.actionContext = {
    actionId: 'current-action',
    correlationId: 'cycle-1',
    status: 'completed',
    requested: { type: 'robotCommand', command: 'nod' },
    result: { type: 'completed', message: 'nod completed' },
  };

  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Review the verified result and choose the next episode consequence.',
    observation,
  }, {}, {});

  assert.equal(result.context.stimulus.verifiedCurrentAction.requested.command, 'nod');
  assert.equal(result.context.historicalLatestActionIncluded, false);
  assert.equal(JSON.stringify(result.messages).match(/nod completed/g)?.length, 1);
});

test('Boredom Reflection places sampled memories in the final deliberation input exactly once', async () => {
  const observation: any = robotObservation();
  observation.visual = undefined;
  observation.visuals = [];
  observation.feedback = [];
  observation.metadata.robotObserver.requestedBy = 'boredom-reflection';
  observation.metadata.autonomousStimulus = 'boredom-reflection';
  const memory = { content: 'I once watched afternoon light move across the carpet and felt peaceful.' };
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Use sampled memory as inspiration for one meaningful consequence.',
    observation,
    personaText: '## Identity\n- Name: Ainekio\n\n## Personality Traits\n- curious: high',
    memoryContext: [memory],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.reflectionMaterialIncluded, true);
  assert.equal(result.context.memoryContextCount, 1);
  const serialized = JSON.stringify(result.messages);
  assert.equal(
    serialized.match(/afternoon light move across the carpet/g)?.length,
    1,
    'sampled reflection material must be supplied exactly once',
  );
  assert.doesNotMatch(String(result.messages[1]?.content), /afternoon light move across the carpet/);
  assert.match(String(result.messages.at(-1)?.content), /reflectionMaterial/);
  assert.match(String(result.messages.at(-1)?.content), /afternoon light move across the carpet/);
});

test('Robot Operator parser accepts only complete grounded observation decisions', async () => {
  const delegated = await robotOperatorDecisionParserNode.execute({
    response: '<think>private reasoning</think>{"observed":"A red ball is visible on the floor.","instruction":"I want to get a clearer view of the red ball.","requiresAction":true,"reason":"The current image contains an unfamiliar object worth inspecting."}',
  }, {});
  assert.equal(delegated.valid, true);
  assert.equal(delegated.observed, 'A red ball is visible on the floor.');
  assert.equal(delegated.instruction, 'I want to get a clearer view of the red ball.');
  assert.equal(delegated.requiresAction, true);
  assert.doesNotMatch(JSON.stringify(delegated.decision), /private reasoning/);

  const freeForm = await robotOperatorDecisionParserNode.execute({
    response: '{"category":"model-authored","observed":"The room is dark and still.","instruction":"I want to respond in the way that best fits this moment.","requiresAction":false,"reason":"The present view and my persona shape this intention."}',
  }, {});
  assert.equal(freeForm.valid, true);
  assert.deepEqual(Object.keys(freeForm.decision), ['observed', 'instruction', 'requiresAction', 'reason']);

  const legacyWait = await robotOperatorDecisionParserNode.execute({
    response: '{"route":"wait","instruction":"","reason":"Nothing warrants a response."}',
  }, {});
  assert.equal(legacyWait.valid, false);
  assert.equal(legacyWait.decision, null);

  const incomplete = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A doorway is visible.","instruction":"I have chosen a next intention."}',
  }, {});
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.decision, null);

  const movementWithoutAction = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A movement opportunity is available.","instruction":"I will remain still.","requiresAction":false,"reason":"Stillness feels appropriate."}',
  }, {}, { requireAction: true });
  assert.equal(movementWithoutAction.valid, false);
  assert.match(movementWithoutAction.error, /requires an Environment Mode action intention/i);
});

test('Robot Operator dispatches required work and stops observation-only decisions locally', async () => {
  const queued: any[] = [];
  const observation = robotObservation();
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'A red ball is visible on the floor.',
      instruction: 'I want to get a clearer view of the red ball.',
      requiresAction: true,
      reason: 'The object is interesting and relevant to my current persona.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    robotOperatorEnvironmentGraph: 'environment',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'environment-task-1' };
    },
  }, { graph: 'environment' });

  assert.equal(result.queued, true);
  assert.equal(result.taskId, 'environment-task-1');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].input.graph, 'environment');
  assert.equal(
    queued[0].input.observation.metadata.originatingInstruction,
    'I want to get a clearer view of the red ball.',
  );
  assert.equal(queued[0].input.observation.visual.id, observation.visual.id);
  assert.equal(queued[0].input.observation.metadata.robotObserver.graph, 'environment');
  assert.equal(queued[0].input.observation.metadata.robotObserver.requestedBy, 'robot-observer');
  assert.equal(queued[0].input.observation.metadata.robotOperatorDecision.requiresAction, true);
  assert.deepEqual(queued[0].input.observation.text, []);
  assert.deepEqual(queued[0].input.observation.feedback, []);

  const second = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'The room is dark and still.',
      instruction: 'I want to respond in the way that best fits this moment.',
      requiresAction: false,
      reason: 'The present view and my persona shape this intention.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'environment-task-2' };
    },
  }, { graph: 'environment' });
  assert.equal(second.queued, false);
  assert.equal(second.status, 'observation_only');
  assert.equal(second.taskId, '');
  assert.equal(queued.length, 1);

  const malformed = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: '',
      instruction: 'I have chosen a next intention.',
      requiresAction: false,
      reason: 'The current observation informed it.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'unexpected' };
    },
  }, { graph: 'environment' });
  assert.equal(malformed.queued, false);
  assert.equal(malformed.status, 'invalid_decision');
  assert.equal(queued.length, 1);
});

test('Robot Operator dispatch can declare a generic post-action evidence contract', async () => {
  const queued: any[] = [];
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'The robot is ready for a small movement opportunity.',
      instruction: 'I will turn once, then interpret the fresh view before deciding whether to react.',
      requiresAction: true,
      reason: 'A bounded movement followed by observation supports embodied autonomy.',
    },
    observation: robotObservation(),
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'movement-environment-task' };
    },
  }, {
    graph: 'environment',
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
    visualEvidenceMode: 'single',
  });

  assert.equal(result.queued, true);
  assert.deepEqual(
    queued[0].input.observation.metadata.robotOperatorDecision.lifecycleContract,
    {
      objective: 'I will turn once, then interpret the fresh view before deciding whether to react.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
    },
  );
});

test('a graph-authored action trigger delegates directly without preliminary semantic inference', async () => {
  const queued: any[] = [];
  const instruction = 'Choose and execute one safe advertised robotCommand, then evaluate one fresh camera frame.';
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    instruction,
    observation: robotObservation(),
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'direct-movement-task' };
    },
  }, {
    graph: 'environment',
    requireAction: true,
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
    visualEvidenceMode: 'single',
  });

  assert.equal(result.queued, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].input.observation.metadata.robotOperatorDecision.instruction, instruction);
  assert.equal(queued[0].input.observation.metadata.robotOperatorDecision.requiresAction, true);
  assert.equal(
    queued[0].input.observation.metadata.robotOperatorDecision.lifecycleContract.requiredCompletionBasis,
    'visual_observation',
  );
});

test('a reflection trigger delegates sampled inspiration without forcing physical action', async () => {
  const queued: any[] = [];
  const instruction = 'Use sampled memories as historical inspiration for one meaningful consequence now.';
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    instruction,
    memories: [
      { content: 'A bright leaf once prompted a playful bow.' },
      { content: 'A bright leaf once prompted a playful bow.' },
      { content: 'A familiar melody made the room feel calm.' },
    ],
    observation: robotObservation(),
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'direct-reflection-task' };
    },
  }, { graph: 'environment', requireAction: false });

  assert.equal(result.queued, true);
  assert.equal(queued[0].input.observation.metadata.robotOperatorDecision.requiresAction, false);
  assert.deepEqual(queued[0].input.observation.metadata.robotOperatorMemories, [
    'A bright leaf once prompted a playful bow.',
    'A familiar melody made the room feel calm.',
  ]);
});

test('Robot Operator dispatch does not reapply trigger mode after the graph decides to delegate', async () => {
  let queued = false;
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'The room contains an object that may need attention.',
      instruction: 'I want to investigate the room.',
      requiresAction: true,
      reason: 'A current observation looks interesting.',
    },
    observation: robotObservation(),
  }, {
    username: 'owner',
    operatorMode: 'reactive',
    enqueueRobotOperatorEnvironment: async () => {
      queued = true;
      return { id: 'environment-task' };
    },
  }, { graph: 'environment' });
  assert.equal(result.queued, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.taskId, 'environment-task');
  assert.equal(queued, true);
});

test('boredom triggers stay lean while Boredom Autonomy owns the editable executive loop', () => {
  const graphs = Object.fromEntries([
    'boredom-observer',
    'boredom-movement',
    'boredom-reflection',
  ].map(id => [id, JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs', `${id}-mode.json`),
    'utf8',
  ))]));

  for (const [id, graph] of Object.entries(graphs) as Array<[string, any]>) {
    const nodeTypes = graph.nodes.map((node: any) => node.data?.nodeType);
    assert.equal(nodeTypes.includes('conversation_history'), false, `${id} trigger must not build executive context`);
    assert.equal(nodeTypes.includes('tts'), false, `${id} trigger must not speak directly`);
    assert.equal(nodeTypes.includes('model_router'), false, `${id} must not add a redundant LLM before Boredom Autonomy`);
  }

  const observerTypes = graphs['boredom-observer'].nodes.map((node: any) => node.data?.nodeType);
  assert.deepEqual(observerTypes, [
    'environment_observation',
    'text_input',
    'text_input',
    'json_parser',
    'environment_send_action',
  ]);
  const observerBridge = graphs['boredom-observer'].nodes.find(
    (node: any) => node.data?.nodeType === 'environment_send_action',
  );
  assert.deepEqual(observerBridge?.data?.properties?.allowedActions, ['captureImage']);
  assert.equal(observerBridge?.data?.properties?.feedbackGraph, 'boredom-autonomy');
  assert.ok(graphs['boredom-observer'].edges.some((edge: any) => (
    edge.source === 'observer-policy'
    && edge.sourceHandle === 'text'
    && edge.target === 'capture-image'
    && edge.targetHandle === 'taskInstruction'
  )));
  assert.equal(
    graphs['boredom-movement'].nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'),
    false,
  );
  const executiveOnlyTypes = [
    'persona_loader',
    'persona_formatter',
    'robot_operator_context_builder',
    'model_router',
    'thinking_stripper',
    'robot_operator_decision_parser',
    'inner_dialogue_buffer',
  ];
  const movementTypes = graphs['boredom-movement'].nodes.map((node: any) => node.data?.nodeType);
  assert.equal(graphs['boredom-movement'].nodes.length, 3);
  assert.equal(movementTypes.includes('environment_send_action'), false);
  assert.equal(movementTypes.includes('robot_operator_environment_dispatch'), true);
  for (const redundant of executiveOnlyTypes) {
    assert.equal(movementTypes.includes(redundant), false, `${redundant} must not remain in movement trigger`);
  }
  assert.ok(graphs['boredom-movement'].edges.some((edge: any) => (
    edge.source === 'instructions'
    && edge.sourceHandle === 'text'
    && edge.target === 'environment-dispatch'
    && edge.targetHandle === 'instruction'
  )));
  const movementDispatch = graphs['boredom-movement'].nodes.find(
    (node: any) => node.data?.nodeType === 'robot_operator_environment_dispatch',
  );
  assert.equal(movementDispatch?.data?.properties?.requireAction, true);
  assert.equal(movementDispatch?.data?.properties?.graph, 'boredom-autonomy');
  assert.equal(movementDispatch?.data?.properties?.continuationPolicy, undefined);
  assert.equal(movementDispatch?.data?.properties?.requiredCompletionBasis, undefined);
  assert.equal(movementDispatch?.data?.properties?.visualEvidenceMode, undefined);
  assert.equal(
    graphs['boredom-reflection'].nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'),
    false,
  );
  assert.equal(
    graphs['boredom-reflection'].nodes.some((node: any) => node.data?.nodeType === 'curiosity_weighted_sampler'),
    true,
  );
  const reflectionTypes = graphs['boredom-reflection'].nodes.map((node: any) => node.data?.nodeType);
  assert.equal(graphs['boredom-reflection'].nodes.length, 4);
  assert.equal(reflectionTypes.includes('environment_send_action'), false);
  assert.equal(reflectionTypes.includes('robot_operator_environment_dispatch'), true);
  for (const redundant of executiveOnlyTypes) {
    assert.equal(reflectionTypes.includes(redundant), false, `${redundant} must not remain in reflection trigger`);
  }
  assert.ok(graphs['boredom-reflection'].edges.some((edge: any) => (
    edge.sourceHandle === 'memories' && edge.targetHandle === 'memories'
  )));
  const reflectionDispatch = graphs['boredom-reflection'].nodes.find(
    (node: any) => node.data?.nodeType === 'robot_operator_environment_dispatch',
  );
  assert.equal(reflectionDispatch?.data?.properties?.graph, 'boredom-autonomy');
  const observerPrompt = graphs['boredom-observer'].nodes.find((node: any) => node.id === 'observer-policy')?.data?.properties?.message;
  const movementPrompt = graphs['boredom-movement'].nodes.find((node: any) => node.id === 'instructions')?.data?.properties?.message;
  const reflectionPrompt = graphs['boredom-reflection'].nodes.find((node: any) => node.id === 'instructions')?.data?.properties?.message;
  assert.match(observerPrompt, /returned fresh robot-camera image/i);
  assert.match(observerPrompt, /author or revise its own episode intent/i);
  assert.match(observerPrompt, /Do not stop at captioning/i);
  assert.match(movementPrompt, /complete advertised command catalog/i);
  assert.match(movementPrompt, /no preferred command or movement category/i);
  assert.doesNotMatch(movementPrompt, /stationary posture|stretch|small reorientation/i);
  assert.match(reflectionPrompt, /sampled memory as historical inspiration/i);
  assert.match(reflectionPrompt, /author or revise its own intent/i);

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const service = services.services['robot-operator'];
  assert.equal(service.boredomObserverGraph, 'boredom-observer');
  assert.equal(service.boredomMovementGraph, 'boredom-movement');
  assert.equal(service.boredomReflectionGraph, 'boredom-reflection');
  assert.equal(service.autonomyGraph, 'boredom-autonomy');

  const autonomy = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/boredom-autonomy-mode.json'),
    'utf8',
  ));
  const autonomyTypes = autonomy.nodes.map((node: any) => node.data?.nodeType);
  for (const required of [
    'environment_observation',
    'environment_image_input',
    'conversation_history',
    'persona_loader',
    'persona_formatter',
    'environment_task_state',
    'robot_operator_context_builder',
    'model_router',
    'environment_action_parser',
    'movement_generator',
    'environment_send_action',
    'robot_buffer',
    'conversation_buffer',
    'tts',
  ]) {
    assert.ok(autonomyTypes.includes(required), `Boredom Autonomy requires ${required}`);
  }
  assert.equal(autonomyTypes.filter((type: string) => type === 'environment_task_state').length, 2);
  assert.equal(autonomyTypes.includes('environment_instruction_interpreter'), false);
  assert.equal(autonomyTypes.includes('robot_operator_environment_dispatch'), false);
  const historyModes = autonomy.nodes
    .filter((node: any) => node.data?.nodeType === 'conversation_history')
    .map((node: any) => node.data?.properties?.mode)
    .sort();
  assert.deepEqual(historyModes, ['conversation', 'inner', 'robot']);
  const selector = autonomy.nodes.find((node: any) => node.id === 'autonomy-selector');
  assert.equal(selector?.data?.properties?.maxTokens, 384);
  const executivePrompt = autonomy.nodes.find((node: any) => node.id === 'executive-policy')?.data?.properties?.message ?? '';
  const promptWords = executivePrompt.trim().split(/\s+/).length;
  assert.ok(promptWords >= 150 && promptWords <= 250, `executive prompt must stay compact; got ${promptWords} words`);
  assert.match(executivePrompt, /not a one-off user task/i);
  assert.match(executivePrompt, /starts or resumes a self-directed episode/i);
  assert.match(executivePrompt, /materially shape what Ainekio becomes interested in and does next/i);
  assert.match(executivePrompt, /verified result re-enters this workflow/i);
  assert.match(executivePrompt, /Always provide a non-empty outward response/i);
  assert.match(executivePrompt, /Physical work.+motionClass/i);
  assert.match(executivePrompt, /Physical work.+continuationPolicy=bounded/i);
  assert.match(executivePrompt, /expression uses action_result/i);
  assert.match(executivePrompt, /Historical context must influence interest and continuity/i);
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'task-state-prepare'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'taskState'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'task-state-reduce'
    && edge.target === 'bridge-out'
    && edge.targetHandle === 'taskInstruction'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'inner-history'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'innerHistory'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-history'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'actionHistory'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'movement-generator'
    && edge.target === 'task-state-reduce'
    && edge.targetHandle === 'generatedActions'
  )));
  const autonomyBridge = autonomy.nodes.find((node: any) => node.id === 'bridge-out');
  assert.equal(autonomyBridge?.data?.properties?.feedbackGraph, 'boredom-autonomy');
  const tts = autonomy.nodes.find((node: any) => node.id === 'tts-out');
  assert.equal(tts?.data?.properties?.source, 'boredom-autonomy');
  assert.equal(autonomy.nodes.some((node: any) => node.id === 'inner-buffer'), false);
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'bridge-out'
    && edge.sourceHandle === 'responseMetadata'
    && edge.target === 'conversation-buffer'
    && edge.targetHandle === 'metadata'
  )), 'Boredom Autonomy response metadata must reach the conversation buffer');

  const handler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8');
  assert.doesNotMatch(handler, /enqueueEnvironmentAction|type: 'captureImage'|buildBoredom/);
  assert.match(handler, /buildRobotAutonomyStimulus\(session\.latestObservation, cycle, agentId\)/);
  assert.doesNotMatch(handler, /type: 'robotCommand'|chooseBoredomMovementCommand/);
});
