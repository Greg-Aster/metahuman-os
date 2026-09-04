import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { ConversationHistoryNode } from '../context/conversation-history.node.js';
import { TextInputNode } from '../input/text-input.node.js';
import { ModelRouterNode } from '../llm/model-router.node.js';
import { robotOperatorContextBuilderNode } from './context-builder.node.js';
import { robotOperatorDecisionParserNode } from './decision-parser.node.js';
import { robotOperatorEnvironmentDispatchNode } from './environment-dispatch.node.js';

const ALL_AUTONOMY_ROUTES = {
  needsResponse: true,
  needsConversationHistory: true,
  needsMemory: true,
  needsRobotStatus: true,
  needsEnvironment: true,
  needsVision: true,
  needsAction: true,
};

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
        graph: 'boredom-observer',
        requestedBy: 'boredom-observer' as const,
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

test('a closed Observer planner gate does not call the model', async () => {
  const result = await ModelRouterNode.execute({ messages: null }, {}, {
    role: 'persona',
    format: 'json',
  });
  assert.equal(result.skipped, true);
  assert.equal(result.response, '');
});

test('planner context exposes a strict delegation contract and correlated-evidence gate', async () => {
  const current: any = robotObservation();
  current.capabilities.robotCommandDescriptions = {
    walk: 'walk forward using the requested step count',
  };
  const ready = await robotOperatorContextBuilderNode.execute({
    instruction: 'Author one high-level interest.',
    observation: current,
    robotObserver: current.metadata.robotObserver,
    images: [{ type: 'image_url', image_url: { url: current.visual.dataUrl } }],
    frames: [current.visual],
  }, {}, { outputContract: 'delegation' });
  assert.equal(ready.stimulusReady, true);
  assert.deepEqual(ready.jsonSchema.required, ['observed', 'instruction', 'reason']);
  assert.equal(ready.jsonSchema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(ready.messages), /requested step count/);

  const initial = await robotOperatorContextBuilderNode.execute({
    instruction: 'Author one high-level interest after a fresh image arrives.',
    observation: {
      ...current,
      visual: undefined,
      visuals: [],
      feedback: [],
    },
    robotObserver: current.metadata.robotObserver,
  }, {}, { outputContract: 'delegation' });
  assert.equal(initial.stimulusReady, false);
});

test('Robot Operator context consolidates separate instructions, conversation, inner context, persona, trigger, and correlated image', async () => {
  const observation: any = robotObservation();
  const instruction = 'Decide one high-level intention and return configured JSON.';
  const result = await robotOperatorContextBuilderNode.execute({
    instruction,
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
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
    robotStatus: {
      task: {
        objective: 'Choose what to pursue from the current stimulus.',
        instruction: 'Choose one contextual consequence.',
        source: 'autonomy',
        decision: {
          outcome: 'observe',
          reason: 'Current evidence is still being evaluated.',
          objectiveComplete: false,
          continuationPolicy: 'bounded',
          requiredCompletionBasis: 'visual_observation',
        },
      },
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
  assert.match(String(result.messages[1]?.content), /profile_robot_status_snapshot/);
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
  assert.match(String(userContent[0]?.text), /^The attached image is what you currently see\./);
  assert.doesNotMatch(String(userContent[0]?.text), /curious about how the light/);
  assert.doesNotMatch(String(userContent[0]?.text), /blue ball belongs/i);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);
  assert.match(String(userContent[0]?.text), /"source":"autonomy"/);
  assert.match(String(userContent[0]?.text), /captureImage/);
  assert.doesNotMatch(String(userContent[0]?.text), /image captured/);

  const stale = await robotOperatorContextBuilderNode.execute({
    instruction,
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, {});
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');

  const missingInstruction = await robotOperatorContextBuilderNode.execute({
    observation,
    routingAnalysis: ALL_AUTONOMY_ROUTES,
  }, {}, {});
  assert.equal(missingInstruction.valid, false);
  assert.match(missingInstruction.error, /connected text input node/i);
});

test('Robot Operator context separates correlated task narrative from older conversation', async () => {
  const observation: any = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Maintain one self-authored autonomy objective.',
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    robotStatus: {
      task: {
        objective: 'Investigate the object near the charging station.',
        instruction: 'Inspect the current evidence.',
        source: 'autonomy',
        decision: {
          outcome: 'observe',
          reason: 'Current visual evidence is needed.',
          objectiveComplete: false,
          continuationPolicy: 'bounded',
          requiredCompletionBasis: 'visual_observation',
        },
      },
    },
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
  assert.match(serialized, /profile_robot_status_snapshot/);
  assert.equal(serialized.match(/Investigate the object near the charging station/g)?.length, 1);
  assert.match(serialized, /I moved closer because the object caught my attention/);
  assert.match(serialized, /unrelated remark from an older boredom episode/);
  assert.equal(serialized.match(/I moved closer because the object caught my attention/g)?.length, 1);
});

test('Robot Operator context preserves canonical combined history without adding a second retention policy', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Return the configured observation decision JSON.',
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
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
    innerHistory: [{
      role: 'reflection',
      content: 'Oldest admitted observation.',
      meta: { tags: ['idle-thought', 'inner'] },
    }],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.recentContextCount, 3);
  assert.equal(result.context.innerContextCount, 1);
  const stimulus = result.context.stimulus;
  assert.deepEqual(
    result.context.recentContext.map((entry: any) => entry.content),
    [
      'Please remember that I prefer quiet responses in the morning.',
      'I will keep morning responses quiet.',
      'Oldest admitted observation.',
    ],
  );
  assert.equal('recentIdleThoughts' in stimulus, false);
  assert.deepEqual(stimulus.capabilities, observation.capabilities);
  assert.deepEqual(stimulus.feedback, []);
  assert.equal(stimulus.trigger.source, 'autonomy');
  assert.equal('source' in stimulus, false);
  assert.equal('currentObservationContract' in stimulus, false);
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /prefer quiet responses/);
  assert.match(serialized, /Oldest admitted observation/);
  assert.equal(serialized.match(/Oldest admitted observation/g)?.length, 1);
  assert.match(serialized, /isInnerDialogue/);
  assert.doesNotMatch(serialized, /Legacy raw inner record/);
  assert.doesNotMatch(serialized, /Private reasoning/);
  assert.match(serialized, /captureImage|robotCommand/);
  assert.doesNotMatch(serialized, /image captured/);
});

test('Robot Autonomy Executor context carries trigger, semantic memory, delegated memory, and capability schema once', async () => {
  const observation: any = robotObservation();
  observation.metadata.autonomousStimulus = 'boredom-reflection';
  observation.metadata.robotObserver.requestedBy = 'boredom-reflection';
  observation.metadata.robotOperatorMemories = ['The striped ball once led to a playful bow.'];
  observation.capabilities.robotCommandDescriptions = {
    walk: 'walk forward using the requested step count',
    wave: 'perform a waving gesture',
    stop: 'stop the current body motion',
  };
  observation.metadata.robotOperatorDecision = {
    observed: 'The recent context connects the striped ball with playful movement.',
    instruction: 'Let one concrete remembered detail inspire what happens next.',
    reason: 'The active desire and remembered ball make a playful consequence meaningful now.',
    decidedAt: '2026-08-03T12:00:00.000Z',
  };
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Choose one grounded consequence and return the configured action JSON.',
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    stimulusInstruction: 'Let one concrete remembered detail inspire what happens next.',
    observation,
    robotObserver: observation.metadata.robotObserver,
    plannerDecision: observation.metadata.robotOperatorDecision,
    memoryContext: [{ content: 'A prior search found the striped ball beside the charging station.' }],
    delegatedMemories: observation.metadata.robotOperatorMemories,
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
    robotStatus: {
      updatedAt: '2026-08-03T11:59:00.000Z',
      body: {
        battery: { voltage: 7.4 },
        motion: { available: true, activity: 'idle' },
      },
      lastAction: { command: 'wave', status: 'completed' },
      situation: {
        currentGoal: 'Find the striped ball.',
        currentIntent: 'Continue the search from the last verified action.',
      },
      agency: {
        activeDesires: [{
          id: 'desire-1',
          title: 'Play with the striped ball',
          reason: 'A current active desire makes the remembered ball relevant.',
          strength: 0.8,
        }],
      },
    },
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.recentContextCount, 2);
  assert.equal(result.context.innerContextCount, 1);
  assert.equal(result.context.actionHistoryCount, 1);
  assert.equal(result.context.historicalLatestActionIncluded, false);
  assert.equal(result.context.stimulus.verifiedCurrentAction, null);
  assert.equal(result.context.memoryContextCount, 2);
  assert.equal(result.context.robotStatusIncluded, true);
  assert.equal(result.context.plannerDecisionIncluded, true);
  assert.equal(result.context.stimulusInstruction, 'Let one concrete remembered detail inspire what happens next.');
  const serialized = JSON.stringify(result.messages);
  assert.equal(serialized.match(/prior search found the striped ball/g)?.length, 1);
  assert.equal(serialized.match(/striped ball once led to a playful bow/g)?.length, 1);
  assert.equal(serialized.match(/soft light makes slow movements feel right/g)?.length, 1);
  assert.equal(serialized.match(/concrete remembered detail inspire/g)?.length, 1);
  assert.match(serialized, /boredom_planner_decision/);
  assert.match(serialized, /active desire and remembered ball/);
  assert.match(serialized, /walk forward using the requested step count/);
  assert.doesNotMatch(serialized, /autonomyTriggerInstruction/);
  const supporting = JSON.parse(String(result.messages[1]?.content));
  assert.equal(
    supporting.robotOperatorContext.robotStatus.state.agency.activeDesires[0].title,
    'Play with the striped ball',
  );
  assert.equal(
    supporting.robotOperatorContext.robotStatus.state.situation.currentGoal,
    'Find the striped ball.',
  );
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
  assert.equal(taskDecision.properties.objective.minLength, 1);
  const actionBranches = (result.jsonSchema as any).properties.actions.items.anyOf;
  const commandBranch = actionBranches.find((branch: any) => (
    branch.properties.type.enum.includes('robotCommand')
  ));
  assert.deepEqual(commandBranch.properties.command.enum, ['walk', 'wave', 'stop']);
  const consequenceBranches = (result.jsonSchema as any).allOf.find((constraint: any) => (
    constraint.anyOf?.some((branch: any) => (
      branch.properties?.taskDecision?.properties?.requiredCompletionBasis?.enum?.[0] === 'response'
    ))
  )).anyOf;
  const physicalBranch = consequenceBranches.find((branch: any) => (
    branch.properties?.actions?.minItems === 1
  ));
  const responseBranch = consequenceBranches.find((branch: any) => (
    branch.properties?.taskDecision?.properties?.requiredCompletionBasis?.enum?.[0] === 'response'
  ));
  assert.equal(physicalBranch.properties.taskDecision.required.includes('actionPurpose'), false);
  assert.equal('minLength' in responseBranch.properties.response, false);
});

test('Robot Autonomy context admits only the routes selected for an internal intention', async () => {
  const observation: any = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Choose one self-directed consequence from the selected routes.',
    stimulusInstruction: 'I want to share one quiet thought.',
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: false,
      needsVision: false,
      needsAction: false,
    },
    observation,
    robotObserver: observation.metadata.robotObserver,
    plannerDecision: {
      observed: 'I have a quiet thought worth expressing.',
      instruction: 'I want to share one quiet thought.',
      reason: 'A brief expression fits my current disposition.',
    },
    conversationHistory: [{ role: 'user', content: 'UNSELECTED_CONVERSATION' }],
    innerHistory: [{ role: 'reflection', content: 'UNSELECTED_REFLECTION' }],
    actionHistory: [{ role: 'robot', content: 'UNSELECTED_ACTION_HISTORY' }],
    memoryContext: [{ content: 'UNSELECTED_MEMORY' }],
    robotStatus: { situation: { currentGoal: 'UNSELECTED_STATUS' } },
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
    personaText: '## Identity\n- Name: Ainekio',
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.environmentIncluded, false);
  assert.equal(result.context.imageCount, 0);
  assert.equal(result.context.recentContextCount, 0);
  assert.equal(result.context.actionHistoryCount, 0);
  assert.equal(result.context.memoryContextCount, 0);
  assert.equal(result.context.robotStatusIncluded, false);
  assert.equal(result.context.personaIncluded, true);
  assert.equal(result.context.plannerDecisionIncluded, true);
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /I want to share one quiet thought/);
  assert.match(serialized, /selectedRoutes/);
  assert.doesNotMatch(
    serialized,
    /UNSELECTED_CONVERSATION|UNSELECTED_REFLECTION|UNSELECTED_ACTION_HISTORY|UNSELECTED_MEMORY|UNSELECTED_STATUS|data:image/,
  );
  assert.equal((result.jsonSchema as any).properties.actions.maxItems, 1);
  assert.equal(
    (result.jsonSchema as any).allOf.some((constraint: any) => (
      constraint.anyOf?.some((branch: any) => branch.properties?.actions?.minItems === 1)
    )),
    false,
  );
});

test('Robot Operator context keeps prior action context without treating it as current evidence', async () => {
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
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    actionContext: observation.metadata.actionContext,
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

test('Robot Action Result context exposes the correlated result as current evidence exactly once', async () => {
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
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    actionContext: observation.metadata.actionContext,
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
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
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
    response: '{"observed":"A red ball is visible on the floor.","instruction":"I want to understand why the red ball is here.","reason":"The current image contains an unfamiliar object worth pursuing."}',
  }, {});
  assert.equal(delegated.valid, true);
  assert.equal(delegated.observed, 'A red ball is visible on the floor.');
  assert.equal(delegated.instruction, 'I want to understand why the red ball is here.');
  assert.deepEqual(Object.keys(delegated.decision), ['observed', 'instruction', 'reason']);

  const wrapped = await robotOperatorDecisionParserNode.execute({
    response: '<think>private reasoning</think>{"observed":"The room is dark.","instruction":"I want to understand the room.","reason":"The image prompted this interest."}',
  }, {});
  assert.equal(wrapped.valid, false);
  assert.equal(wrapped.decision, null);

  const extraField = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"The room is dark.","instruction":"I want to understand the room.","reason":"The image prompted this interest.","category":"model-authored"}',
  }, {});
  assert.equal(extraField.valid, false);
  assert.match(extraField.error, /exactly observed, instruction, and reason/i);

  const incomplete = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A doorway is visible.","instruction":"I have chosen a next intention."}',
  }, {});
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.decision, null);
});

test('Robot Operator dispatch accepts only a planner decision and preserves correlated context', async () => {
  const queued: any[] = [];
  const observation: any = robotObservation();
  observation.metadata.robotObserver.graph = 'boredom-observer';
  observation.metadata.robotObserver.requestedBy = 'boredom-observer';
  observation.metadata.autonomousStimulus = 'boredom-observer';
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'A red ball is visible on the floor.',
      instruction: 'I want to understand why the red ball is here.',
      reason: 'The object is interesting and relevant to my current persona.',
    },
    observation,
    robotObserver: observation.metadata.robotObserver,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    robotOperatorEnvironmentGraph: 'boredom-autonomy',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'environment-task-1' };
    },
  }, { graph: 'boredom-autonomy' });

  assert.equal(result.queued, true);
  assert.equal(result.taskId, 'environment-task-1');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].input.graph, 'boredom-autonomy');
  assert.equal(queued[0].input.observation.visual.id, observation.visual.id);
  assert.equal(queued[0].input.observation.metadata.robotObserver, undefined);
  assert.equal(queued[0].input.robotOperatorContext.robotObserver.graph, 'boredom-autonomy');
  assert.equal(queued[0].input.robotOperatorContext.robotObserver.requestedBy, 'boredom-observer');
  assert.equal(queued[0].input.robotOperatorContext.plannerDecision.instruction, 'I want to understand why the red ball is here.');
  assert.equal('requiresAction' in queued[0].input.robotOperatorContext.plannerDecision, false);
  assert.equal('lifecycleContract' in queued[0].input.robotOperatorContext.plannerDecision, false);
  assert.deepEqual(queued[0].input.observation.text, []);
  assert.deepEqual(queued[0].input.observation.feedback, observation.feedback);

  const directInstruction = await robotOperatorEnvironmentDispatchNode.execute({
    instruction: 'This bypass must not create a second planning path.',
    observation,
  }, {
    username: 'owner',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'unexpected' };
    },
  }, { graph: 'boredom-autonomy' });
  assert.equal(directInstruction.queued, false);
  assert.equal(directInstruction.status, 'no_decision');
  assert.equal(queued.length, 1);

  const malformed = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: '',
      instruction: 'I have chosen a next intention.',
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
  }, { graph: 'boredom-autonomy' });
  assert.equal(malformed.queued, false);
  assert.equal(malformed.status, 'invalid_decision');
  assert.equal(queued.length, 1);
});

test('Boredom Reflection delegates sampled memory once through the same planner contract', async () => {
  const queued: any[] = [];
  const observation: any = robotObservation();
  observation.metadata.robotObserver.graph = 'boredom-reflection';
  observation.metadata.robotObserver.requestedBy = 'boredom-reflection';
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'A sampled memory connects to the current quiet moment.',
      instruction: 'I want to follow the unfinished interest recalled by this memory.',
      reason: 'The concrete memory and current persona make it meaningful now.',
    },
    memories: [
      { content: 'A bright leaf once prompted a playful bow.' },
      { content: 'A bright leaf once prompted a playful bow.' },
      { content: 'A familiar melody made the room feel calm.' },
    ],
    observation,
    robotObserver: observation.metadata.robotObserver,
  }, {
    username: 'owner',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'reflection-task' };
    },
  }, { graph: 'boredom-autonomy' });

  assert.equal(result.queued, true);
  assert.deepEqual(queued[0].input.robotOperatorContext.memories, [
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
  }, { graph: 'boredom-autonomy' });
  assert.equal(result.queued, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.taskId, 'environment-task');
  assert.equal(queued, true);
});

test('three boredom planners feed one editable one-pass executor with reusable Robot Status', () => {
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
    assert.equal(nodeTypes.filter((type: string) => type === 'model_router').length, 1, `${id} has one planner LLM`);
    assert.equal(nodeTypes.filter((type: string) => type === 'robot_operator_context_builder').length, 1);
    assert.equal(nodeTypes.filter((type: string) => type === 'robot_operator_decision_parser').length, 1);
    assert.equal(nodeTypes.filter((type: string) => type === 'robot_operator_environment_dispatch').length, 1);
    assert.equal(nodeTypes.includes('persona_loader'), true);
    assert.equal(nodeTypes.includes('persona_formatter'), true);
    assert.equal(nodeTypes.includes('tts'), false, `${id} planner must not execute speech`);
    assert.equal(nodeTypes.includes('environment_action_parser'), false, `${id} planner must not execute actions`);
    assert.equal(nodeTypes.includes('movement_generator'), false, `${id} planner must not generate servo plans`);

    const historyModes = graph.nodes
      .filter((node: any) => node.data?.nodeType === 'conversation_history')
      .map((node: any) => node.data?.properties?.mode)
      .sort();
    assert.deepEqual(historyModes, ['conversation', 'inner', 'robot']);
    const context = graph.nodes.find((node: any) => node.data?.nodeType === 'robot_operator_context_builder');
    assert.equal(context?.data?.properties?.outputContract, 'delegation');
    const planner = graph.nodes.find((node: any) => node.data?.nodeType === 'model_router');
    assert.equal(planner?.data?.properties?.format, 'json');
    assert.equal(planner?.data?.properties?.maxTokens, 384);
    const dispatch = graph.nodes.find((node: any) => node.data?.nodeType === 'robot_operator_environment_dispatch');
    assert.deepEqual(dispatch?.data?.properties, { graph: 'boredom-autonomy' });
    assert.ok(graph.edges.some((edge: any) => (
      edge.source === 'planner-context'
      && edge.sourceHandle === 'jsonSchema'
      && edge.target === 'planner'
      && edge.targetHandle === 'jsonSchema'
    )));
    assert.ok(graph.edges.some((edge: any) => (
      edge.source === 'decision-parser'
      && edge.sourceHandle === 'decision'
      && edge.target === 'environment-dispatch'
      && edge.targetHandle === 'decision'
    )));
  }

  const observer = graphs['boredom-observer'];
  const observerBridge = observer.nodes.find((node: any) => node.id === 'capture-image');
  const observerPrompt = observer.nodes.find((node: any) => node.id === 'planner-policy')?.data?.properties?.message ?? '';
  assert.equal(
    observer.nodes.some((node: any) => node.data?.nodeType === 'environment_action_context_input'),
    true,
    'Observer needs sent-action correlation for its one camera-result pass',
  );
  assert.deepEqual(observerBridge?.data?.properties?.allowedActions, ['captureImage']);
  assert.equal(observerBridge?.data?.properties?.feedbackGraph, 'boredom-observer');
  assert.equal(observer.nodes.filter((node: any) => node.data?.nodeType === 'gateway').length, 2);
  assert.ok(observer.edges.some((edge: any) => (
    edge.source === 'planner-context'
    && edge.sourceHandle === 'stimulusReady'
    && edge.target === 'planner-gate'
    && edge.targetHandle === 'open'
  )));
  assert.ok(observer.edges.some((edge: any) => (
    edge.source === 'planner-context'
    && edge.sourceHandle === 'stimulusReady'
    && edge.target === 'capture-gate'
    && edge.targetHandle === 'open'
  )));
  assert.equal(
    observer.nodes.find((node: any) => node.id === 'capture-gate')?.data?.properties?.invertCondition,
    true,
  );
  assert.match(observerPrompt, /missing evidence, not evidence of hidden activity/i);
  assert.match(observerPrompt, /claim only sensing modalities explicitly present/i);
  assert.doesNotMatch(observerPrompt, /do not reopen the same physical search/i);

  const movement = graphs['boredom-movement'];
  assert.equal(movement.nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'), false);
  assert.equal(
    movement.nodes.some((node: any) => node.data?.nodeType === 'environment_action_context_input'),
    false,
    'Movement receives its Robot Operator handoff directly and must not carry result-correlation nodes',
  );
  const movementPrompt = movement.nodes.find((node: any) => node.id === 'planner-policy')?.data?.properties?.message ?? '';
  assert.match(movementPrompt, /decide one contextually meaningful embodied intention/i);
  assert.match(movementPrompt, /recent verified actions/i);
  assert.match(movementPrompt, /contextually meaningful embodied intention/i);
  assert.match(movementPrompt, /only to break a genuine tie/i);
  assert.match(movementPrompt, /never choose novelty or difference for its own sake/i);
  assert.doesNotMatch(movementPrompt, /one physical consequence/i);
  assert.doesNotMatch(movementPrompt, /posture-confirmation move/i);
  assert.match(movementPrompt, /do not select a technical command/i);
  assert.doesNotMatch(movementPrompt, /stretch|dance|turn_left|turn_right|remain still/i);

  const reflection = graphs['boredom-reflection'];
  assert.equal(reflection.nodes.some((node: any) => node.data?.nodeType === 'curiosity_weighted_sampler'), true);
  assert.equal(
    reflection.nodes.some((node: any) => node.data?.nodeType === 'environment_action_context_input'),
    false,
    'Reflection receives its Robot Operator handoff directly and must not carry result-correlation nodes',
  );
  assert.ok(reflection.edges.some((edge: any) => (
    edge.source === 'memory-sampler'
    && edge.sourceHandle === 'memories'
    && edge.target === 'planner-context'
    && edge.targetHandle === 'memoryContext'
  )));
  assert.ok(reflection.edges.some((edge: any) => (
    edge.source === 'memory-sampler'
    && edge.sourceHandle === 'memories'
    && edge.target === 'environment-dispatch'
    && edge.targetHandle === 'memories'
  )));

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const service = services.services['robot-operator'];
  assert.equal('graph' in service, false);
  assert.equal(service.robotStatusGraph, 'robot-status');
  assert.equal(service.boredomObserverGraph, 'boredom-observer');
  assert.equal(service.boredomMovementGraph, 'boredom-movement');
  assert.equal(service.boredomReflectionGraph, 'boredom-reflection');
  assert.equal(service.autonomyGraph, 'boredom-autonomy');
  assert.equal(fs.existsSync(path.join(ROOT, 'etc/cognitive-graphs/robot-operator-mode.json')), false);

  const autonomy = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/boredom-autonomy-mode.json'),
    'utf8',
  ));
  assert.equal(autonomy.name, 'Robot Autonomy Executor');
  const autonomyTypes = autonomy.nodes.map((node: any) => node.data?.nodeType);
  for (const required of [
    'environment_bridge_input',
    'environment_image_input',
    'robot_status',
    'conversation_history',
    'memory_router',
    'persona_loader',
    'persona_formatter',
    'robot_operator_input',
    'orchestrator_llm',
    'robot_operator_context_builder',
    'model_router',
    'environment_action_parser',
    'movement_generator',
    'environment_send_action',
    'robot_buffer',
    'conversation_buffer',
    'tts',
    'robot_status_out',
  ]) {
    assert.ok(autonomyTypes.includes(required), `Robot Autonomy Executor requires ${required}`);
  }
  for (const retired of [
    'environment_task_state',
    'environment_task_input',
    'environment_task_preparation',
    'environment_task_reducer',
  ]) assert.equal(autonomyTypes.includes(retired), false);
  for (const resultOnly of [
    'environment_action_context_input',
    'environment_feedback',
  ]) assert.equal(
    autonomyTypes.includes(resultOnly),
    false,
    `Robot Autonomy Executor must not contain result-only node ${resultOnly}`,
  );
  assert.equal(autonomyTypes.filter((type: string) => type === 'model_router').length, 1);
  assert.equal(autonomyTypes.filter((type: string) => type === 'orchestrator_llm').length, 1);
  assert.equal(autonomyTypes.includes('robot_operator_decision_parser'), false);
  assert.equal(autonomyTypes.includes('robot_operator_environment_dispatch'), false);
  assert.equal(autonomyTypes.includes('thinking_stripper'), false);
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-operator-input'
    && edge.sourceHandle === 'plannerInstruction'
    && edge.target === 'intent-orchestrator'
    && edge.targetHandle === 'message'
  )), 'Robot Autonomy Intent Orchestrator must receive the unchanged planner instruction');
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'intent-orchestrator'
    && edge.sourceHandle === 'analysis'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'routingAnalysis'
  )), 'Robot Autonomy context must receive the LLM-selected routes');
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-operator-input'
    && edge.sourceHandle === 'plannerInstruction'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'stimulusInstruction'
  )), 'Robot Autonomy Executor must receive the planner-authored instruction');
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-operator-input'
    && edge.sourceHandle === 'plannerInstruction'
    && edge.target === 'memory-router'
    && edge.targetHandle === 'userMessage'
  )), 'Robot Autonomy Executor must search semantic memory using the planner instruction');
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'memory-router'
    && edge.sourceHandle === 'memories'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'memoryContext'
  )), 'Robot Autonomy Executor must include relevant semantic memory as supporting context');
  const memoryRouter = autonomy.nodes.find((node: any) => node.id === 'memory-router');
  assert.deepEqual(memoryRouter?.data?.properties, { topK: 3, threshold: 0.65 });
  const intentOrchestrator = autonomy.nodes.find((node: any) => node.id === 'intent-orchestrator');
  assert.equal(intentOrchestrator?.data?.properties?.outputContract, 'environment');
  assert.equal(intentOrchestrator?.data?.properties?.maxTokens, 768);
  assert.match(String(intentOrchestrator?.data?.properties?.systemPrompt), /internal agent for the robot, not a human instruction/i);
  assert.match(String(intentOrchestrator?.data?.properties?.systemPrompt), /first-person outward expression/i);
  assert.match(String(intentOrchestrator?.data?.properties?.systemPrompt), /routes are independent/i);
  for (const [route, target] of [
    ['needsMemory', 'memory-router'],
    ['needsRobotStatus', 'robot-status'],
    ['needsConversationHistory', 'inner-history'],
    ['needsAction', 'robot-history'],
  ]) {
    assert.ok(autonomy.edges.some((edge: any) => (
      edge.source === 'intent-orchestrator'
      && edge.sourceHandle === route
      && edge.target === target
      && edge.data?.kind === 'control'
    )), `Robot Autonomy route ${route} must control ${target}`);
  }
  for (const route of ['needsEnvironment', 'needsVision', 'needsAction']) {
    assert.ok(autonomy.edges.some((edge: any) => (
      edge.source === 'intent-orchestrator'
      && edge.sourceHandle === route
      && edge.target === 'observation'
      && edge.data?.kind === 'control'
    )), `Robot Autonomy route ${route} must control Environment Bridge input`);
  }
  assert.equal(autonomyTypes.includes('instruction_resolver'), false);
  const historyModes = autonomy.nodes
    .filter((node: any) => node.data?.nodeType === 'conversation_history')
    .map((node: any) => node.data?.properties?.mode)
    .sort();
  assert.deepEqual(historyModes, ['conversation', 'inner', 'robot']);
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-status'
    && edge.target === 'autonomy-context'
    && edge.targetHandle === 'robotStatus'
  )));
  const selector = autonomy.nodes.find((node: any) => node.id === 'autonomy-selector');
  assert.equal(selector?.data?.properties?.maxTokens, 2048);
  assert.equal(selector?.data?.properties?.temperature, 0.1);
  assert.equal(selector?.data?.properties?.repeatPenalty, 1.15);
  const executivePrompt = autonomy.nodes.find((node: any) => node.id === 'executive-policy')?.data?.properties?.message ?? '';
  const promptWords = executivePrompt.trim().split(/\s+/).length;
  assert.ok(promptWords >= 100 && promptWords <= 180, `executive prompt must stay compact; got ${promptWords} words`);
  assert.match(executivePrompt, /internally authored plannerDecision/i);
  assert.match(executivePrompt, /my own prospective intent, not a user request/i);
  assert.match(executivePrompt, /optional and first-person/i);
  assert.match(executivePrompt, /rather than compliance with an instruction/i);
  assert.match(executivePrompt, /advertised capabilities/i);
  assert.match(executivePrompt, /Robot Action Result interprets the result after this workflow ends/i);
  assert.match(executivePrompt, /leave response empty when speaking adds nothing/i);
  assert.match(executivePrompt, /one or two concise sentences/i);
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'autonomy-selector'
    && edge.target === 'action-parser'
    && edge.targetHandle === 'response'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-status'
    && edge.sourceHandle === 'status'
    && edge.target === 'image-input'
    && edge.targetHandle === 'robotStatus'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'action-parser'
    && edge.sourceHandle === 'actions'
    && edge.target === 'bridge-out'
    && edge.targetHandle === 'actions'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'bridge-out'
    && edge.sourceHandle === 'bridgeRecord'
    && edge.target === 'robot-status-out'
    && edge.targetHandle === 'bridgeRecord'
  )));
  const autonomyBridge = autonomy.nodes.find((node: any) => node.id === 'bridge-out');
  assert.equal(autonomyBridge?.data?.properties?.feedbackGraph, 'robot-action-result');
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'robot-operator-input'
    && edge.sourceHandle === 'responseMetadata'
    && edge.target === 'conversation-buffer'
    && edge.targetHandle === 'metadata'
  )));
  assert.ok(autonomy.edges.some((edge: any) => (
    edge.source === 'action-parser'
    && edge.sourceHandle === 'response'
    && edge.target === 'conversation-buffer'
    && edge.targetHandle === 'response'
  )));

  const handler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8');
  assert.doesNotMatch(handler, /actions\.filter\(action => action === 'robotCommand'\)/);
  assert.doesNotMatch(handler, /latest\.feedback|actionContext/);
  assert.doesNotMatch(handler, /enqueueEnvironmentAction|type: 'captureImage'|chooseBoredomMovementCommand/);
  assert.match(handler, /observation,\s+graph: cycle\.graph,\s+robotOperatorContext:/);

  const engine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8');
  assert.doesNotMatch(engine, /automatic_step_limit|recentSessionRuns/);
  assert.doesNotMatch(engine, /remain still when no response is warranted|Inspect the returned robot camera image/);
  assert.doesNotMatch(engine, /robotOperatorConfig\.graph/);
});
