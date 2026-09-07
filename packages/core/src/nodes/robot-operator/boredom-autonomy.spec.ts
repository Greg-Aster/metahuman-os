import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const originalRoot = process.env.METAHUMAN_ROOT;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-boredom-contracts-'));
process.env.METAHUMAN_ROOT = testRoot;
fs.mkdirSync(path.join(testRoot, 'etc'), { recursive: true });
for (const name of ['agents.json', 'services.json']) {
  fs.copyFileSync(path.join(ROOT, 'etc', name), path.join(testRoot, 'etc', name));
}
fs.mkdirSync(path.join(testRoot, 'brain'), { recursive: true });
// The catalog checks maintained source availability; it never executes these agents.
fs.symlinkSync(path.join(ROOT, 'brain/agents'), path.join(testRoot, 'brain/agents'), 'dir');
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the autonomy contract fixture'); };
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.METAHUMAN_ROOT;
  else process.env.METAHUMAN_ROOT = originalRoot;
});

const { ConversationHistoryNode } = await import('../context/conversation-history.node.js');
const { TextInputNode } = await import('../input/text-input.node.js');
const { ModelRouterNode } = await import('../llm/model-router.node.js');
const {
  robotActionResultContextNode,
  robotAutonomyControllerContextNode,
  robotAutonomyExecutorContextNode,
  robotAutonomyPlannerContextNode,
  robotGoalReviewContextNode,
} = await import('./context-builder.node.js');
const { robotOperatorDecisionParserNode } = await import('./decision-parser.node.js');
const { robotOperatorEnvironmentDispatchNode } = await import('./environment-dispatch.node.js');
const { robotAutonomyTaskDispatchNode } = await import('./task-dispatch.node.js');
const { robotAutonomyControllerParserNode } = await import('./autonomy-controller-parser.node.js');
const { robotAutonomyTaskCatalogNode } = await import('./task-catalog.node.js');

const ALL_AUTONOMY_ROUTES = {
  needsResponse: true,
  needsConversationHistory: true,
  needsMemory: true,
  needsRobotStatus: true,
  needsEnvironment: true,
  needsVision: true,
  needsAction: true,
  needsTaskLifecycle: true,
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

function modelInputText(message: any): string {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  const textPart = message.content.find((part: any) => part?.type === 'text')
  return typeof textPart?.text === 'string' ? textPart.text : ''
}

function modelInputEnvelope(result: any): any {
  const text = modelInputText(result.messages[1])
  const objectStart = text.indexOf('{')
  assert.ok(objectStart >= 0, 'model input must contain one structured context envelope')
  return JSON.parse(text.slice(objectStart))
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

test('the configured History-to-Controller path keeps the latest user turn after autonomous replies', async () => {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/cognitive-graphs/robot-autonomy-controller-mode.json'), 'utf8'));
  const historyProperties = graph.nodes.find((node: any) => node.id === 'conversation-history').data.properties;
  const user = { role: 'user', content: 'Keep track of this request while considering the results.' };
  const history = await ConversationHistoryNode.execute({}, {
    conversationHistory: [user, ...Array.from({ length: 8 }, (_, index) => ({ role: 'assistant', content: `Autonomous reply ${index}.` }))],
  }, historyProperties);
  assert.equal(history.history.length, historyProperties.limit);
  assert.equal(history.history[0].content, user.content);
  assert.equal(history.history.at(-1).content, 'Autonomous reply 7.');
  const result = await robotAutonomyControllerContextNode.execute({
    instruction: 'Choose an activity from current context.',
    conversationHistory: history.history,
    availableTasks: [],
  }, {}, {});
  assert.equal(result.valid, true);
  assert.ok(JSON.stringify(result.messages).includes(user.content));
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
  const ready = await robotAutonomyPlannerContextNode.execute({
    instruction: 'Author one high-level interest.',
    observation: current,
    robotObserver: current.metadata.robotObserver,
    images: [{ type: 'image_url', image_url: { url: current.visual.dataUrl } }],
    frames: [current.visual],
    currentVisualEvidence: true,
  }, {}, {});
  assert.equal(ready.stimulusReady, true);
  assert.deepEqual(ready.jsonSchema.required, ['observed', 'instruction', 'reason']);
  assert.equal(ready.jsonSchema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(ready.messages), /requested step count/);

  const initial = await robotAutonomyPlannerContextNode.execute({
    instruction: 'Author one high-level interest after a fresh image arrives.',
    observation: {
      ...current,
      visual: undefined,
      visuals: [],
      feedback: [],
    },
    robotObserver: current.metadata.robotObserver,
  }, {}, {});
  assert.equal(initial.stimulusReady, false);
});

test('Robot Operator context consolidates separate instructions, conversation, inner context, persona, trigger, and correlated image', async () => {
  const observation: any = robotObservation();
  const instruction = 'Decide one high-level intention and return configured JSON.';
  const result = await robotAutonomyExecutorContextNode.execute({
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
    currentVisualEvidence: true,
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.recentContextCount, 2);
  assert.equal(result.context.innerContextCount, 1);
  assert.equal(result.context.personaIncluded, true);
  assert.equal(result.context.memoryContextCount, 1);
  assert.ok(result.jsonSchema.properties.taskDecision.anyOf[1].required.includes('objective'));
  assert.equal(result.messages[0]?.content, instruction);
  assert.doesNotMatch(String(result.messages[0]?.content), /curious: high|blue ball/i);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1]?.role, 'user');
  const modelInput = modelInputText(result.messages[1]);
  assert.match(modelInput, /canonical_conversation_history/);
  assert.match(modelInput, /profile_robot_status_snapshot/);
  assert.match(modelInput, /Choose what to pursue from the current stimulus/);
  assert.match(modelInput, /curious: high/);
  assert.match(modelInput, /blue ball belongs/);
  assert.match(modelInput, /curious about how the light/);
  assert.match(modelInput, /historical_memory_inspiration/);
  assert.match(modelInput, /currentEvidence\":false/);
  assert.match(modelInput, /past afternoon walk/);
  const userContent = result.messages[1]?.content as Array<{ type: string; text?: string }>;
  assert.equal(Array.isArray(userContent), true);
  assert.equal(userContent.length, 2);
  assert.match(String(userContent[0]?.text), /^Attached robot-camera evidence/);
  assert.match(String(userContent[0]?.text), /curious about how the light/);
  assert.match(String(userContent[0]?.text), /blue ball belongs/i);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);
  assert.match(String(userContent[0]?.text), /"source":"autonomy"/);
  assert.match(String(userContent[0]?.text), /captureImage/);
  assert.doesNotMatch(String(userContent[0]?.text), /image captured/);

  const stale = await robotAutonomyExecutorContextNode.execute({
    instruction,
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, {});
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');

  const missingInstruction = await robotAutonomyExecutorContextNode.execute({
    observation,
    routingAnalysis: ALL_AUTONOMY_ROUTES,
  }, {}, {});
  assert.equal(missingInstruction.valid, false);
  assert.match(missingInstruction.error, /connected text input node/i);
});

test('Robot Operator context separates correlated task narrative from older conversation', async () => {
  const observation: any = robotObservation();
  const result = await robotAutonomyExecutorContextNode.execute({
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
  const serialized = modelInputText(result.messages[1]);
  assert.match(serialized, /profile_robot_status_snapshot/);
  assert.equal(serialized.match(/Investigate the object near the charging station/g)?.length, 1);
  assert.match(serialized, /I moved closer because the object caught my attention/);
  assert.match(serialized, /unrelated remark from an older boredom episode/);
  assert.equal(serialized.match(/I moved closer because the object caught my attention/g)?.length, 1);
});

test('Robot Operator context preserves canonical combined history without adding a second retention policy', async () => {
  const observation = robotObservation();
  const result = await robotAutonomyExecutorContextNode.execute({
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
  observation.capabilities.actions.push('robotMotionPlan');
  observation.capabilities.motionClasses = ['body_local'];
  observation.metadata.robotOperatorDecision = {
    observed: 'The recent context connects the striped ball with playful movement.',
    instruction: 'Let one concrete remembered detail inspire what happens next.',
    reason: 'The active desire and remembered ball make a playful consequence meaningful now.',
    decidedAt: '2026-08-03T12:00:00.000Z',
  };
  const result = await robotAutonomyExecutorContextNode.execute({
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
        state: { gateway: { raw: 'x'.repeat(20_000) } },
      },
      lastAction: { command: 'wave', status: 'completed' },
      task: {
        objective: 'Find the striped ball.',
        instruction: 'Continue looking for the striped ball.',
        source: 'user',
        decision: {
          outcome: 'incomplete',
          objectiveComplete: false,
          reason: 'The ball has not been found yet.',
        },
      },
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
  const supporting = modelInputEnvelope(result);
  assert.equal(
    supporting.robotOperatorContext.robotStatus.state.agency.activeDesires[0].title,
    'Play with the striped ball',
  );
  assert.equal(
    supporting.robotOperatorContext.robotStatus.state.situation.currentGoal,
    'Find the striped ball.',
  );
  assert.equal(
    supporting.robotOperatorContext.robotStatus.state.task.objective,
    'Find the striped ball.',
  );
  assert.equal(
    'truncatedJson' in supporting.robotOperatorContext.robotStatus.state,
    false,
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
  const taskDecision = (result.jsonSchema as any).properties.taskDecision.anyOf[1];
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
    constraint.anyOf?.length === 2
    && constraint.anyOf.every((branch: any) => (
      branch.properties?.taskDecision?.properties?.outcome?.enum?.[0] === 'act'
    ))
  )).anyOf;
  const physicalBranch = consequenceBranches.find((branch: any) => (
    branch.properties?.actions?.minItems === 1
  ));
  const generatedMovementBranch = consequenceBranches.find((branch: any) => (
    branch.properties?.movementRequest?.type === 'object'
  ));
  assert.equal(physicalBranch.properties.taskDecision.required.includes('actionPurpose'), false);
  assert.ok(generatedMovementBranch);
  assert.equal(consequenceBranches.length, 2);
  assert.deepEqual(taskDecision.properties.outcome.enum, ['act']);
  assert.deepEqual(taskDecision.properties.objectiveComplete.enum, [false]);
  assert.equal((result.jsonSchema as any).properties.response.type, 'string');
  assert.match((result.jsonSchema as any).properties.actions.description, /implements the intended effect/i);
  assert.match((result.jsonSchema as any).properties.movementRequest.description, /not implemented by an advertised action/i);
});

test('Robot Autonomy context admits only the routes selected for an internal intention', async () => {
  const observation: any = robotObservation();
  const result = await robotAutonomyExecutorContextNode.execute({
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
      needsTaskLifecycle: false,
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

  const result = await robotAutonomyExecutorContextNode.execute({
    instruction: 'Continue the evolving boredom episode from all supplied context.',
    routingAnalysis: ALL_AUTONOMY_ROUTES,
    observation,
    robotObserver: observation.metadata.robotObserver,
    actionContext: observation.metadata.actionContext,
  }, {}, {});

  assert.equal(result.context.stimulus.verifiedCurrentAction, null);
  assert.equal(result.context.historicalLatestActionIncluded, true);
  const supporting = modelInputEnvelope(result);
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

  const result = await robotActionResultContextNode.execute({
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
  const result = await robotAutonomyExecutorContextNode.execute({
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
  assert.match(modelInputText(result.messages[1]), /reflectionMaterial/);
  assert.match(modelInputText(result.messages[1]), /afternoon light move across the carpet/);
});

test('Robot Operator parser accepts only complete grounded observation decisions', async () => {
  const delegated = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A red ball is visible on the floor.","instruction":"I want to understand why the red ball is here.","reason":"The current image contains an unfamiliar object worth pursuing."}',
  }, {});
  assert.equal(delegated.valid, true);
  assert.equal(delegated.observed, 'A red ball is visible on the floor.');
  assert.equal(delegated.instruction, 'I want to understand why the red ball is here.');
  assert.deepEqual(Object.keys(delegated.decision), ['observed', 'instruction', 'reason']);

  await assert.rejects(robotOperatorDecisionParserNode.execute({
    response: '<think>private reasoning</think>{"observed":"The room is dark.","instruction":"I want to understand the room.","reason":"The image prompted this interest."}',
  }, {}), /not a JSON object/i);

  await assert.rejects(robotOperatorDecisionParserNode.execute({
    response: '{"observed":"The room is dark.","instruction":"I want to understand the room.","reason":"The image prompted this interest.","category":"model-authored"}',
  }, {}), /exactly observed, instruction, and reason/i);

  await assert.rejects(robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A doorway is visible.","instruction":"I have chosen a next intention."}',
  }, {}), /exactly observed, instruction, and reason/i);
});

test('Robot Operator prepares only a planner-selected child invocation and preserves correlated context', async () => {
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
  }, { graph: 'boredom-autonomy' });

  assert.equal(result.queued, false);
  assert.equal(result.status, 'prepared');
  assert.equal(result.taskId, '');
  assert.equal(result.invocation.graph, 'boredom-autonomy');
  const delegated = result.invocation.context;
  assert.equal(delegated.environmentObservationCurrent, false);
  assert.equal(delegated.environmentObservation.visual.id, observation.visual.id);
  assert.equal(delegated.environmentObservation.timestamp, observation.timestamp);
  assert.equal(delegated.environmentObservation.metadata.robotObserver, undefined);
  assert.equal(delegated.robotOperatorContext.robotObserver.graph, 'boredom-autonomy');
  assert.equal(delegated.robotOperatorContext.robotObserver.requestedBy, 'boredom-observer');
  assert.equal(delegated.robotOperatorContext.sourceObservationAt, observation.timestamp);
  assert.equal(delegated.robotOperatorContext.currentVisualEvidence, false);
  assert.equal(delegated.robotOperatorContext.plannerDecision.instruction, 'I want to understand why the red ball is here.');
  assert.equal('requiresAction' in delegated.robotOperatorContext.plannerDecision, false);
  assert.equal('lifecycleContract' in delegated.robotOperatorContext.plannerDecision, false);
  assert.deepEqual(delegated.environmentObservation.text, observation.text);
  assert.deepEqual(delegated.environmentObservation.feedback, observation.feedback);

  const directInstruction = await robotOperatorEnvironmentDispatchNode.execute({
    instruction: 'This bypass must not create a second planning path.',
    observation,
  }, {
    username: 'owner',
  }, { graph: 'boredom-autonomy' });
  assert.equal(directInstruction.queued, false);
  assert.equal(directInstruction.status, 'no_decision');
  assert.equal(directInstruction.invocation, null);

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
  }, { graph: 'boredom-autonomy' });
  assert.equal(malformed.queued, false);
  assert.equal(malformed.status, 'invalid_decision');
  assert.equal(malformed.invocation, null);
});

test('Robot Autonomy Controller prepares the selected catalog-backed robot child without a separate job', async () => {
  const availableTasks = [{
    id: 'boredom-observer',
    name: 'Boredom Observer',
    description: 'Acquires and considers current visual evidence.',
    kind: 'agent',
    handler: 'workflow.boredom-observer',
    taskType: 'generic',
    priority: 'low',
    tags: ['robot', 'vision'],
  }];
  const parsed = await robotAutonomyControllerParserNode.execute({
    response: JSON.stringify({
      response: '',
      taskId: 'boredom-observer',
      reason: 'The current objective needs new visual evidence.',
      observationSummary: 'Robot Status records an unresolved visual objective.',
      instruction: 'Capture and consider a current view for the unresolved objective.',
    }),
    availableTasks,
  }, {}, {});
  assert.deepEqual(parsed.taskDecision, {
    task: availableTasks[0],
    reason: 'The current objective needs new visual evidence.',
    observationSummary: 'Robot Status records an unresolved visual objective.',
    instruction: 'Capture and consider a current view for the unresolved objective.',
  });
  assert.equal(parsed.executorDecision, null);

  const dispatched = await robotAutonomyTaskDispatchNode.execute({
    decision: parsed.taskDecision,
    robotObserver: {
      cycleId: 'controller-cycle',
      step: 1,
      triggerSource: 'autonomy',
      graph: 'robot-autonomy-controller',
      requestedBy: 'robot-autonomy-controller',
    },
    sessionId: 'robot-1',
  }, {
    username: 'owner',
  }, {});
  assert.equal(dispatched.queued, false);
  assert.equal(dispatched.status, 'prepared');
  assert.equal(dispatched.work, null);
  assert.equal(dispatched.selectedTaskId, 'boredom-observer');
  assert.equal(dispatched.invocation.graph, 'boredom-observer');
  assert.equal(dispatched.invocation.context.robotOperatorContext.robotObserver.cycleId, 'controller-cycle');
  assert.equal(
    dispatched.invocation.context.robotOperatorContext.controllerDecision.instruction,
    'Capture and consider a current view for the unresolved objective.',
  );
});

test('Robot Autonomy Controller receives contextual daytime tasks from the canonical Agent Catalog', async () => {
  const catalog = await robotAutonomyTaskCatalogNode.execute({}, {}, {
    taskIds: [
      'robot-autonomy-executor',
      'robot-goal-review',
      'reflector',
      'daydreamer',
      'curiosity',
      'inner-curiosity',
      'desire-agent',
    ],
  });
  assert.deepEqual(catalog.unavailableTaskIds, ['robot-goal-review']);
  assert.deepEqual(catalog.taskIds, [
    'robot-autonomy-executor',
    'reflector',
    'daydreamer',
    'curiosity',
    'inner-curiosity',
    'desire-agent',
  ]);
  const internalWorkers = await robotAutonomyTaskCatalogNode.execute({}, {}, {
    taskIds: ['desire-planner', 'desire-executor'],
  });
  assert.deepEqual(internalWorkers.taskIds, []);
  assert.deepEqual(internalWorkers.unavailableTaskIds, ['desire-planner', 'desire-executor']);
  const reflector = catalog.tasks.find((task: any) => task.id === 'reflector');
  assert.match(reflector?.description ?? '', /reflection/i);
  assert.equal(reflector?.handler, 'agent.reflector');
});

test('Robot Autonomy Controller context combines unfinished work, buffers, bridge state, persona, desires, and task meanings', async () => {
  const tasks = [{
    id: 'boredom-observer',
    name: 'Boredom Observer',
    description: 'Acquires and evaluates one current robot-camera observation.',
    kind: 'agent',
    handler: 'workflow.boredom-observer',
    taskType: 'generic',
    priority: 'low',
    tags: ['robot', 'vision'],
  }];
  const result = await robotAutonomyControllerContextNode.execute({
    instruction: 'Choose what I should do next from current context.',
    bridgeSummary: {
      enabled: true,
      sessionCount: 1,
      pendingCommandCount: 0,
      sessions: [{
        sessionId: 'robot-1',
        environmentId: 'ainekio',
        adapter: 'ainekio-gateway',
        status: 'connected',
        latestObservation: { state: { UNRELATED_DUPLICATE_GATEWAY_STATE: true } },
      }],
    },
    robotStatus: {
      task: {
        objective: 'Find the missing keys.',
        decision: { objectiveComplete: false, outcome: 'incomplete' },
      },
    },
    conversationHistory: [
      { role: 'user', content: 'Please keep looking for my keys.' },
      ...Array.from({ length: 8 }, (_, index) => ({
        role: 'assistant',
        content: `Later autonomous narrative ${index + 1}.`,
      })),
    ],
    innerHistory: [{ role: 'reflection', content: 'The last view was too dark.' }],
    actionHistory: [{ actionId: 'turn-1', status: 'completed', verified: true, requested: { type: 'robotCommand', command: 'turn-right' } }],
    personaText: 'Curious, attentive, and persistent.',
    activeDesires: [{ id: 'desire-1', title: 'Explore carefully', status: 'active' }],
    availableTasks: tasks,
    autonomyActivityHistory: [{
      taskId: 'prior-observer',
      capabilityId: 'boredom-observer',
      state: 'completed',
      instruction: 'Acquire a current image.',
    }],
    robotObserver: {
      cycleId: 'controller-cycle',
      step: 1,
      triggerSource: 'autonomy',
      graph: 'robot-autonomy-controller',
      requestedBy: 'robot-autonomy-controller',
    },
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.availableTaskCount, 1);
  assert.equal(result.context.activeDesireCount, 1);
  assert.equal(result.context.bridgeSummaryIncluded, true);
  assert.equal(result.context.autonomyActivityCount, 1);
  assert.deepEqual(result.jsonSchema.properties.taskId.enum, ['boredom-observer', 'none']);
  const encoded = JSON.stringify(result.messages);
  assert.match(encoded, /Find the missing keys/);
  assert.match(encoded, /Please keep looking for my keys/);
  assert.match(encoded, /The last view was too dark/);
  assert.doesNotMatch(encoded, /Acquires and evaluates one current robot-camera observation/);
  assert.match(encoded, /Curious, attentive, and persistent/);
  assert.match(encoded, /Explore carefully/);
  assert.match(encoded, /prior-observer/);
  assert.doesNotMatch(encoded, /UNRELATED_DUPLICATE_GATEWAY_STATE/);
  assert.match(
    result.jsonSchema.properties.taskId.description,
    /boredom-observer: Acquires and evaluates one current robot-camera observation/i,
  );
});

test('Robot Goal Review context includes current active desires with its other decision inputs', async () => {
  const result = await robotGoalReviewContextNode.execute({
    instruction: 'Review the current objective from supplied context.',
    observation: robotObservation(),
    robotStatus: {
      task: {
        objective: 'Find the missing keys.',
        decision: { objectiveComplete: false, outcome: 'incomplete' },
      },
    },
    conversationHistory: [
      { role: 'user', content: 'Please help me find the missing keys.' },
      ...Array.from({ length: 8 }, (_, index) => ({
        role: 'assistant',
        content: `Later goal narrative ${index + 1}.`,
      })),
    ],
    activeDesires: [{ id: 'desire-1', title: 'Help find important objects', status: 'active' }],
    robotObserver: {
      cycleId: 'goal-review-cycle',
      step: 1,
      triggerSource: 'autonomy',
      graph: 'robot-goal-review',
      requestedBy: 'robot-goal-review',
    },
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.activeDesireCount, 1);
  assert.match(JSON.stringify(result.messages), /Help find important objects/);
  assert.match(JSON.stringify(result.messages), /Please help me find the missing keys/);
});

test('Full autonomy graph visibly loads the decision context and routes one catalog-backed choice', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/robot-autonomy-controller-mode.json'),
    'utf8',
  ));
  const nodeTypes = graph.nodes.map((node: any) => node.data?.nodeType);
  assert.equal(nodeTypes.filter((type: string) => type === 'model_router').length, 1);
  for (const required of [
    'environment_bridge_input',
    'robot_status',
    'conversation_history',
    'persona_loader',
    'active_desires',
    'robot_autonomy_activity_history',
    'robot_autonomy_task_catalog',
    'robot_autonomy_controller_context',
    'robot_autonomy_controller_parser',
    'robot_autonomy_task_dispatch',
  ]) {
    assert.equal(nodeTypes.includes(required), true, `${required} must be visible in the controller graph`);
  }
  assert.equal(nodeTypes.filter((type: string) => type === 'conversation_history').length, 3);
  assert.equal(
    graph.nodes.find((node: any) => node.id === 'conversation-history')?.data?.properties?.limit,
    8,
  );
  assert.match(
    graph.nodes.find((node: any) => node.id === 'policy')?.data?.properties?.message ?? '',
    /not the first identifier and not a random or rotating choice/,
  );
  const configuredTasks = graph.nodes.find((node: any) => node.id === 'task-catalog')
    ?.data?.properties?.taskIds ?? [];
  assert.equal(configuredTasks.includes('robot-status'), false);
  assert.equal(configuredTasks.includes('robot-goal-review'), false);
  assert.ok(configuredTasks.includes('boredom-observer'));
  assert.ok(graph.edges.some((edge: any) => (
    edge.source === 'task-catalog'
    && edge.sourceHandle === 'tasks'
    && edge.target === 'parser'
    && edge.targetHandle === 'availableTasks'
  )));
  assert.ok(graph.edges.some((edge: any) => (
    edge.source === 'autonomy-activity'
    && edge.sourceHandle === 'history'
    && edge.target === 'context'
    && edge.targetHandle === 'autonomyActivityHistory'
  )));
});

test('Boredom Reflection delegates sampled memory once through the same planner contract', async () => {
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
  }, { graph: 'boredom-autonomy' });

  assert.equal(result.status, 'prepared');
  assert.equal(result.queued, false);
  assert.deepEqual(result.invocation.context.robotOperatorContext.memories, [
    'A bright leaf once prompted a playful bow.',
    'A familiar melody made the room feel calm.',
  ]);
});

test('Robot Operator dispatch does not reapply trigger mode after the graph decides to delegate', async () => {
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
  }, { graph: 'boredom-autonomy' });
  assert.equal(result.queued, false);
  assert.equal(result.status, 'prepared');
  assert.equal(result.taskId, '');
  assert.equal(result.invocation.graph, 'boredom-autonomy');
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
    assert.equal(nodeTypes.filter((type: string) => type === 'robot_autonomy_planner_context').length, 1);
    assert.equal(nodeTypes.includes('robot_operator_context_builder'), false);
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
    const context = graph.nodes.find((node: any) => node.data?.nodeType === 'robot_autonomy_planner_context');
    assert.deepEqual(context?.data?.properties, {});
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
  assert.equal('feedbackGraph' in observerBridge.data.properties, false);
  assert.equal(observer.nodes.filter((node: any) => node.data?.nodeType === 'gateway').length, 0);
  assert.equal(observer.nodes.filter((node: any) => node.data?.nodeType === 'environment_result_wait').length, 1);
  assert.ok(observer.edges.some((edge: any) => (
    edge.source === 'image-input'
    && edge.sourceHandle === 'current'
    && edge.target === 'planner-context'
    && edge.targetHandle === 'currentVisualEvidence'
  )));
  assert.equal(observer.edges.some((edge: any) => (
    edge.source === 'robot-operator-input'
    && edge.sourceHandle === 'currentVisualEvidence'
    && edge.target === 'planner-context'
  )), false);
  assert.ok(observer.edges.some((edge: any) => (
    edge.source === 'capture-image'
    && edge.sourceHandle === 'commands'
    && edge.target === 'capture-result'
    && edge.targetHandle === 'commands'
  )));
  assert.ok(observer.edges.some((edge: any) => (
    edge.source === 'capture-result'
    && edge.sourceHandle === 'observation'
    && edge.target === 'captured-observation'
    && edge.targetHandle === 'observation'
  )));
  assert.ok(observer.edges.some((edge: any) => edge.source === 'captured-observation'
    && edge.target === 'planner-context' && edge.targetHandle === 'observation'));
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
    'robot_autonomy_executor_context',
    'model_router',
    'environment_action_parser',
    'movement_generator',
    'environment_send_action',
    'robot_buffer',
    'conversation_buffer',
    'tts',
    'robot_status_out',
    'execution_context',
    'environment_result_wait',
    'workflow_call',
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
    edge.source === 'execution'
    && edge.sourceHandle === 'context'
    && edge.target === 'image-input'
    && edge.targetHandle === 'execution'
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
  assert.equal('feedbackGraph' in autonomyBridge.data.properties, false);
  assert.ok(autonomy.edges.some((edge: any) => edge.source === 'bridge-out' && edge.sourceHandle === 'commands'
    && edge.target === 'action-results' && edge.targetHandle === 'commands'));
  assert.equal(autonomy.nodes.find((node: any) => node.id === 'review-action')?.data?.properties?.graph, 'robot-action-result');
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
  assert.match(handler, /runGraph\(/);

  const engine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8');
  assert.doesNotMatch(engine, /automatic_step_limit|recentSessionRuns/);
  assert.doesNotMatch(engine, /remain still when no response is warranted|Inspect the returned robot camera image/);
  assert.doesNotMatch(engine, /robotOperatorConfig\.graph/);
});
