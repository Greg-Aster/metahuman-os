import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import type { EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/index.js';
import { environmentActionParserNode } from './action-parser.node.js';
import { ModelRouterNode } from '../llm/model-router.node.js';
import {
  clearEnvironmentTaskFrameCache,
  environmentTaskStateNode,
} from './task-state.node.js';

const jpeg = 'data:image/jpeg;base64,/9j/2gAA/9k=';

function frame(id: string, correlationId: string, actionId?: string): EnvironmentVisualFrame {
  return {
    id,
    timestamp: '2026-08-06T03:00:00.000Z',
    mimeType: 'image/jpeg',
    dataUrl: jpeg,
    metadata: {
      correlationId,
      ...(actionId ? { actionId } : {}),
    },
  };
}

function observation(overrides: Partial<EnvironmentObservation> = {}): EnvironmentObservation {
  return {
    environmentId: 'robot',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-06T03:00:00.000Z',
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan', 'captureImage'],
      robotCommands: ['wave', 'turn_right_90', 'walk_forward'],
      motionClasses: ['body_local', 'open_loop_displacement'],
      visual: true,
      movement: true,
    },
    state: { body: { authenticated: true } },
    ...overrides,
  };
}

async function prepare(input: EnvironmentObservation, instruction = '') {
  return environmentTaskStateNode.execute(
    { observation: input, instruction },
    { userMessage: instruction, username: 'greggles' },
    { phase: 'prepare' },
  );
}

async function reduce(inputs: Record<string, unknown>) {
  return environmentTaskStateNode.execute(
    inputs,
    { userMessage: '', username: 'greggles' },
    { phase: 'reduce' },
  );
}

test('a new instruction does not admit an incidental correlated camera frame', async () => {
  clearEnvironmentTaskFrameCache();
  const current = frame('incidental-frame', 'audio-cycle');
  const prepared = await prepare(observation({
    visual: current,
    metadata: { correlationId: 'audio-cycle' },
  }), 'Please wave');

  assert.equal(prepared.routingAnalysis.needsVision, false);
  assert.equal(prepared.routingAnalysis.needsMemory, true);
  assert.equal(prepared.routingAnalysis.isFollowUp, true);
  assert.equal(prepared.memoryHints.needsMemory, true);
  assert.equal(prepared.taskState.phase, 'new');
});

test('a fresh user task cannot inherit terminal feedback from unrelated work', async () => {
  const stale = observation({
    metadata: {
      actionId: 'old-action',
      correlationId: 'old-autonomy-cycle',
      originatingInstruction: 'EnvironmentTaskState:{"version":1,"objective":"Walk around","phase":"awaiting_action","step":1,"maxSteps":8,"continuationPolicy":"bounded","requiredCompletionBasis":"action_result"}',
    },
    feedback: [{
      id: 'old-feedback',
      actionId: 'old-action',
      timestamp: '2026-08-06T02:59:00.000Z',
      type: 'completed',
      message: 'An unrelated autonomous walk completed.',
      data: { command: 'walk_forward' },
    }],
  });
  const initial = await prepare(stale, 'Please turn right until you see a foot.');
  const result = await environmentTaskStateNode.execute({
    observation: stale,
    instruction: initial.instruction,
    taskState: initial.taskState,
    actions: [],
    response: 'My sensors indicate the room remains empty.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'No action was selected.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'body_local',
      actionPurpose: 'task_effect',
    },
  }, {
    userMessage: 'Please turn right until you see a foot.',
    username: 'greggles',
  }, { phase: 'reduce' });

  assert.equal(result.actions.length, 0);
  assert.equal(result.decision.terminalFeedback, null);
  assert.equal(result.decision.actionId, null);
  assert.equal(result.decision.blockedReason, 'visual_evidence_unavailable');
  assert.equal(
    result.response,
    'Environment Mode did not produce an executable action or evidence-backed completion, so nothing was sent to the robot.',
  );
  assert.doesNotMatch(result.response, /room remains empty/i);
});

test('a visual stopping condition is normalized to bounded continuation', async () => {
  const initial = await prepare(observation(), 'Turn right until you see the target.');
  assert.equal(initial.taskState.continuationPolicy, 'bounded');
  assert.equal(initial.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(initial.taskState.visualEvidenceMode, 'single');
  const result = await environmentTaskStateNode.execute({
    observation: observation(),
    instruction: initial.instruction,
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'turn_right_90' }],
    response: 'Turning right ninety degrees now.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The turn advances the requested visual search.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  }, {
    userMessage: 'Turn right until you see the target.',
    username: 'greggles',
  }, { phase: 'reduce' });

  assert.equal(result.actions[0]?.command, 'turn_right_90');
  assert.equal(result.taskState.continuationPolicy, 'bounded');
  assert.equal(result.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(result.taskState.visualEvidenceMode, 'single');
});

test('a Robot Operator action handoff admits its current image and requires one executable selection', async () => {
  clearEnvironmentTaskFrameCache();
  const current = frame('knife-scene', 'operator-cycle');
  const prepared = await prepare(observation({
    visual: current,
    visuals: [current],
    metadata: {
      correlationId: 'operator-cycle',
      originatingInstruction: 'I will scan the room for any other hazards.',
      robotOperatorDecision: {
        observed: 'A knife and wires are on the floor.',
        instruction: 'I will scan the room for any other hazards.',
        requiresAction: true,
        reason: 'The visible hazard needs further assessment.',
      },
    },
  }), 'I will scan the room for any other hazards.');

  assert.equal(prepared.routingAnalysis.needsAction, true);
  assert.equal(prepared.routingAnalysis.needsVision, true);
  assert.equal(prepared.visuals.at(-1)?.id, 'knife-scene');
  assert.match(String(prepared.instruction), /requires one new sensing or environment action/);
  assert.equal(prepared.taskState.objective, 'I will scan the room for any other hazards.');
});

test('autonomy revises its objective inside canonical Environment Task State', async () => {
  const input = observation({
    metadata: {
      correlationId: 'self-authored-objective',
      robotObserver: {
        cycleId: 'self-authored-objective',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-observer',
      },
    },
  });
  const result = await environmentTaskStateNode.execute({
    observation: input,
    instruction: 'Use this boredom stimulus as material for autonomous choice.',
    taskState: {
      version: 1,
      objective: 'Use this boredom stimulus as material for autonomous choice.',
      phase: 'new',
      step: 0,
      maxSteps: 8,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    actions: [{ type: 'robotCommand', command: 'turn_right_90' }],
    taskDecision: {
      outcome: 'act',
      reason: 'A new view can advance the objective.',
      objective: 'Understand the unfamiliar object beside the charging station.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'open_loop_displacement',
      actionPurpose: 'information_gain',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.equal(result.taskState.objective, 'Understand the unfamiliar object beside the charging station.');
  assert.match(result.taskInstruction, /Understand the unfamiliar object beside the charging station/);
});

test('action-required autonomy does not present future-action prose as executed work', async () => {
  clearEnvironmentTaskFrameCache();
  const instruction = 'Use one safe advertised movement, then react to the result.';
  const operatorObservation = observation({
    capabilities: {
      actions: ['robotCommand', 'captureImage'],
      robotCommands: ['stretch'],
      motionClasses: ['body_local'],
      visual: true,
      movement: true,
    },
    metadata: {
      correlationId: 'missing-action-cycle',
      autonomousStimulus: 'boredom-movement',
      robotOperatorDecision: {
        observed: 'A safe expressive movement opportunity is available.',
        instruction,
        requiresAction: true,
        reason: 'The trigger requires an embodied action.',
        lifecycleContract: {
          objective: instruction,
          continuationPolicy: 'bounded',
          requiredCompletionBasis: 'visual_observation',
          visualEvidenceMode: 'single',
        },
      },
    },
  });
  const prepared = await prepare(operatorObservation, instruction);
  const reduced = await environmentTaskStateNode.execute({
    observation: operatorObservation,
    instruction: prepared.instruction,
    taskState: prepared.taskState,
    actions: [],
    response: 'I will initiate a slow, deliberate stretch.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'A stretch is appropriate.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.deepEqual(reduced.actions, []);
  assert.equal(reduced.complete, false);
  assert.equal(reduced.decision.blockedReason, 'required_action_missing');
  assert.match(reduced.response, /nothing was sent to the robot/i);
  assert.doesNotMatch(reduced.response, /I will initiate/i);
});

test('Task State exposes one rejected movement generation instead of hiding it as a missing action', async () => {
  clearEnvironmentTaskFrameCache();
  const instruction = 'Perform one bounded body-local movement.';
  const current = observation({
    metadata: {
      correlationId: 'generation-failure-cycle',
      robotOperatorDecision: {
        observed: 'A movement opportunity is available.',
        instruction,
        requiresAction: true,
        reason: 'The autonomy trigger requires one embodied action.',
      },
    },
  });
  const prepared = await prepare(current, instruction);
  const generatedResponse = 'Generated movement was rejected: joint R1 is outside 0..180 degrees.';
  const reduced = await environmentTaskStateNode.execute({
    observation: current,
    instruction: prepared.instruction,
    taskState: prepared.taskState,
    movementRequest: { description: 'perform a bounded pose change' },
    generatedActions: [],
    generatedResponse,
    response: 'I will perform the movement.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'A movement was selected.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.deepEqual(reduced.actions, []);
  assert.equal(reduced.response, generatedResponse);
  assert.equal(reduced.decision.blockedReason, 'movement_generation_failed');
});

test('a trigger-authored movement contract requires a fresh reaction after the action result', async () => {
  clearEnvironmentTaskFrameCache();
  const instruction = 'I will turn once, then interpret the fresh view before deciding whether to react.';
  const movementObservation = observation({
    metadata: {
      correlationId: 'movement-cycle',
      autonomousStimulus: 'boredom-movement',
      robotObserver: {
        cycleId: 'movement-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
      robotOperatorDecision: {
        observed: 'The robot is ready for a small movement.',
        instruction,
        requiresAction: true,
        reason: 'Movement followed by observation supports embodied autonomy.',
        lifecycleContract: {
          objective: instruction,
          continuationPolicy: 'bounded',
          requiredCompletionBasis: 'visual_observation',
          visualEvidenceMode: 'single',
        },
      },
    },
  });
  const initial = await environmentTaskStateNode.execute({
    observation: movementObservation,
    instruction,
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'prepare' });

  assert.equal(initial.taskState.phase, 'new');
  assert.equal(initial.taskState.step, 0);
  assert.equal(initial.taskState.continuationPolicy, 'bounded');
  assert.equal(initial.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(initial.taskState.visualEvidenceMode, 'single');

  const queued = await environmentTaskStateNode.execute({
    observation: movementObservation,
    instruction,
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'turn_right_90', sessionId: 'robot-1' }],
    response: 'I will turn once and then take in the new view.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'A small reorientation is an expressive movement opportunity.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.equal(queued.actions.length, 1);
  assert.equal(queued.taskState.continuationPolicy, 'bounded');
  assert.equal(queued.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(queued.taskState.visualEvidenceMode, 'single');

  const freshView = frame('movement-after', 'movement-cycle', 'movement-action');
  const terminal = observation({
    visual: freshView,
    visuals: [freshView],
    metadata: {
      actionId: 'movement-action',
      correlationId: 'movement-cycle',
      originatingInstruction: queued.taskInstruction,
      robotObserver: {
        cycleId: 'movement-cycle',
        step: 2,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
    feedback: [{
      id: 'movement-feedback',
      actionId: 'movement-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'turn completed',
      data: { command: 'turn_right_90' },
    }],
  });
  const returned = await prepare(terminal);
  assert.equal(returned.deterministicComplete, false);
  assert.equal(returned.precomputedResponse, '');
  assert.equal(returned.routingAnalysis.needsVision, true);
  assert.equal(returned.visuals.at(-1)?.id, 'movement-after');

  const reacted = await environmentTaskStateNode.execute({
    observation: terminal,
    instruction: returned.instruction,
    taskState: returned.taskState,
    frames: returned.visuals,
    actions: [],
    response: 'That turn opened up a brighter patch of the room; I like how the light changed.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The fresh view inspired a specific persona-grounded reaction.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      completionEvidence: 'Frame movement-after shows the brighter patch that prompted this reaction.',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.equal(reacted.complete, true);
  assert.match(reacted.response, /brighter patch of the room/);
});

test('a current user instruction starts a new objective instead of inheriting stale task state', async () => {
  const prior = await prepare(observation(), 'Please wave');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave',
    taskState: prior.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'Waving once.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'Wave once.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
  });
  const prepared = await prepare(observation({
    metadata: { originatingInstruction: queued.taskInstruction },
  }), 'Please turn right');

  assert.equal(prepared.taskState.objective, 'Please turn right');
  assert.equal(prepared.taskState.phase, 'new');
  assert.equal(prepared.taskState.step, 0);
});

test('a correlated capture continuation admits the returned frame exactly when visual evidence is required', async () => {
  const initial = await prepare(observation(), 'What do you see right now?');
  const queued = await reduce({
    observation: observation(),
    instruction: 'What do you see right now?',
    taskState: initial.taskState,
    actions: [{ type: 'captureImage', sessionId: 'robot-1' }],
    response: 'Requesting one current camera frame.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'A current image is required.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
    },
  });
  const current = frame('capture-result', 'capture-cycle', 'capture-action');
  const terminal = observation({
    visual: current,
    metadata: {
      actionId: 'capture-action',
      correlationId: 'capture-cycle',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'capture-feedback',
      actionId: 'capture-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'fresh frame returned',
      data: { command: 'captureImage' },
    }],
  });

  const prepared = await prepare(terminal);
  assert.equal(prepared.routingAnalysis.needsVision, true);
  assert.equal(prepared.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(prepared.visuals.at(-1)?.id, 'capture-result');
  assert.equal(prepared.deterministicComplete, false);
});

test('a bounded visual objective admits the correlated frame and queues the next model-selected action', async () => {
  clearEnvironmentTaskFrameCache();
  const initial = await prepare(observation(), 'Please wave until you see my foot, then stop');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave until you see my foot, then stop',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I will wave and check the returned camera frame.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The stopping condition requires robot-camera evidence.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });
  const current = frame('wave-result', 'wave-cycle', 'wave-action');
  const terminal = observation({
    visual: current,
    metadata: {
      actionId: 'wave-action',
      correlationId: 'wave-cycle',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'wave-feedback',
      actionId: 'wave-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'emote' },
    }],
  });

  const evidencePass = await prepare(terminal);
  assert.equal(evidencePass.routingAnalysis.needsVision, true);
  assert.equal(evidencePass.visuals.at(-1)?.id, 'wave-result');
  assert.equal(evidencePass.taskState.requiredCompletionBasis, 'visual_observation');

  const continued = await reduce({
    observation: terminal,
    instruction: evidencePass.instruction,
    taskState: evidencePass.taskState,
    frames: evidencePass.visuals,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I do not see the stopping condition yet, so I will wave again.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The attached frame does not satisfy the original stopping condition.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });
  assert.equal(continued.complete, false);
  assert.equal(continued.actions[0]?.command, 'wave');
  assert.equal(continued.taskState.continuationPolicy, 'bounded');
  assert.equal(continued.taskState.requiredCompletionBasis, 'visual_observation');
  assert.match(String(continued.taskInstruction), /\"requiredCompletionBasis\":\"visual_observation\"/);
});

test('a bounded visual objective closes only when the selector cites the admitted frame', async () => {
  clearEnvironmentTaskFrameCache();
  const initial = await prepare(observation(), 'Please wave until you see my foot, then stop');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave until you see my foot, then stop',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I will wave and check the returned camera frame.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The stopping condition requires robot-camera evidence.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });
  const current = frame('foot-visible', 'wave-cycle', 'wave-action');
  const terminal = observation({
    visual: current,
    metadata: {
      actionId: 'wave-action',
      correlationId: 'wave-cycle',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'wave-feedback',
      actionId: 'wave-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'emote' },
    }],
  });
  const evidencePass = await prepare(terminal);
  const completed = await reduce({
    observation: terminal,
    instruction: evidencePass.instruction,
    taskState: evidencePass.taskState,
    frames: evidencePass.visuals,
    actions: [],
    response: 'I see your foot, so I stopped waving.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The attached correlated frame contains the requested stopping condition.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
      completionEvidence: 'Frame foot-visible visibly contains the requested foot.',
    },
  });

  assert.equal(completed.complete, true);
  assert.deepEqual(completed.actions, []);
  assert.equal(completed.response, 'I see your foot, so I stopped waving.');
  assert.equal(completed.decision.completionBasis, 'visual_observation');
  assert.equal(completed.decision.completionEvidence, 'Frame foot-visible visibly contains the requested foot.');
});

test('an ungrounded visual completion advances the persisted action instead of stopping or replaying the request', async () => {
  clearEnvironmentTaskFrameCache();
  const initial = await prepare(observation(), 'Please wave until you see my hand, then stop');
  const queued = await reduce({
    observation: observation(),
    instruction: initial.instruction,
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I will wave and inspect the returned frame.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The hand is the visual stopping condition.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });
  const current = frame('hand-not-grounded', 'hand-cycle', 'hand-action');
  const terminal = observation({
    visual: current,
    visuals: [current],
    metadata: {
      actionId: 'hand-action',
      correlationId: 'hand-cycle',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'hand-feedback',
      actionId: 'hand-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'emote' },
    }],
  });
  const evidencePass = await prepare(terminal);
  const continued = await reduce({
    observation: terminal,
    instruction: evidencePass.instruction,
    taskState: evidencePass.taskState,
    frames: evidencePass.visuals,
    actions: [{ type: 'robotCommand', command: 'turn_right_90', sessionId: 'robot-1' }],
    response: 'The wave action is complete. I will turn to search for the hand.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The motor action completed.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
    },
  });

  assert.equal(continued.complete, false);
  assert.equal(continued.actions.length, 1);
  assert.equal(continued.actions[0]?.command, 'wave');
  assert.equal(continued.taskState.step, 2);
  assert.match(continued.response, /does not provide grounded evidence/i);
  assert.doesNotMatch(continued.response, /action is complete/i);
  assert.notEqual(continued.actions[0]?.command, 'turn_right_90');
});

test('a bounded exploratory action inspects the correlated result before deciding the objective is complete', async () => {
  clearEnvironmentTaskFrameCache();
  const before = frame('room-before', 'operator-input');
  const initialObservation = observation({ visual: before, visuals: [before] });
  const initial = await prepare(initialObservation, 'Scan the rest of the room for anything needing attention');
  const queued = await reduce({
    observation: initialObservation,
    instruction: 'Scan the rest of the room for anything needing attention',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'turn_right_90', sessionId: 'robot-1' }],
    response: 'I will turn to inspect the rest of the room.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The new view still needs to be inspected.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'information_gain',
    },
  });
  const after = frame('room-after', 'cycle-scan', 'action-scan');
  const terminal = observation({
    visual: after,
    visuals: [after],
    metadata: {
      actionId: 'action-scan',
      correlationId: 'cycle-scan',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'feedback-scan',
      actionId: 'action-scan',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'turn_right_90' },
    }],
  });

  const preparedTerminal = await prepare(terminal);
  assert.equal(preparedTerminal.deterministicComplete, false);
  assert.equal(preparedTerminal.precomputedResponse, '');
  assert.equal(preparedTerminal.routingAnalysis.needsVision, true);
  assert.equal(preparedTerminal.taskState.phase, 'evaluating_evidence');
  assert.deepEqual(
    preparedTerminal.visuals.map((value: EnvironmentVisualFrame) => value.id),
    ['room-before', 'room-after'],
  );
  assert.match(String(preparedTerminal.instruction), /Required whole-objective evidence: visual_observation/);
  assert.match(String(preparedTerminal.instruction), /safety ceiling, not a success condition/);
  assert.match(String(preparedTerminal.instruction), /Do not continue merely because unseen areas might still exist/);

  const closed = await reduce({
    observation: terminal,
    instruction: preparedTerminal.instruction,
    taskState: preparedTerminal.taskState,
    frames: preparedTerminal.visuals,
    actions: [],
    response: 'The new view shows a clear, quiet room with nothing that needs further attention.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The fresh correlated image contains no object or activity requiring another action.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
      completionEvidence: 'Frame room-after shows a clear room with nothing requiring attention.',
    },
  });
  assert.equal(closed.complete, true);
  assert.deepEqual(closed.actions, []);
  assert.equal(closed.response, 'The new view shows a clear, quiet room with nothing that needs further attention.');
  assert.equal(closed.decision.completionBasis, 'visual_observation');
  assert.equal(closed.decision.actionId, 'action-scan');
});

test('any autonomous information-gain action preserves a visual contract through its lifecycle', async () => {
  clearEnvironmentTaskFrameCache();
  const before = frame('object-before', 'information-cycle');
  const autonomousObservation = observation({
    visual: before,
    visuals: [before],
    metadata: {
      correlationId: 'information-cycle',
      robotObserver: {
        cycleId: 'information-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'boredom-observer',
      },
    },
  });
  const initial = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Perform one supported reorientation to gain another view of the current subject.',
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'prepare' });
  const queued = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Perform one supported reorientation to gain another view of the current subject.',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'turn_right_90', sessionId: 'robot-1' }],
    response: 'Tilting once for a different view.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The movement is intended to gain new visual information.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'information_gain',
      observationSummary: 'An unfamiliar object is visible in the current frame.',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.equal(queued.actions.length, 1);
  assert.equal(queued.taskState.actionPurpose, 'information_gain');
  assert.equal(queued.taskState.continuationPolicy, 'bounded');
  assert.equal(queued.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(queued.taskState.visualEvidenceMode, 'single');
  assert.equal(queued.familiarityQuery, 'An unfamiliar object is visible in the current frame.');

  const after = frame('object-after', 'information-cycle', 'information-action');
  const terminal = observation({
    visual: after,
    visuals: [after],
    metadata: {
      actionId: 'information-action',
      correlationId: 'information-cycle',
      originatingInstruction: queued.taskInstruction,
      robotObserver: {
        cycleId: 'information-cycle',
        step: 2,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'boredom-observer',
      },
    },
    feedback: [{
      id: 'information-feedback',
      actionId: 'information-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'reorientation completed',
      data: { command: 'turn_right_90' },
    }],
  });
  const returned = await prepare(terminal);
  assert.equal(returned.deterministicComplete, false);
  assert.equal(returned.precomputedResponse, '');
  assert.equal(returned.routingAnalysis.needsVision, true);
  assert.equal(returned.taskState.actionPurpose, 'information_gain');
  assert.equal(returned.taskState.requiredCompletionBasis, 'visual_observation');
  assert.equal(returned.visuals.at(-1)?.id, 'object-after');
});

test('Task State owns expression evidence consistency before dispatch', async () => {
  const autonomousObservation = observation({
    metadata: {
      correlationId: 'expression-cycle',
      robotObserver: {
        cycleId: 'expression-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-reflection',
      },
    },
  });
  const initial = await prepare(
    autonomousObservation,
    'Choose one meaningful consequence from the current reflection.',
  );
  const result = await reduce({
    observation: autonomousObservation,
    instruction: initial.instruction,
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I will wave once as an outward expression.',
    taskDecision: {
      outcome: 'act',
      objective: 'Express the reflected thought through one supported gesture.',
      objectiveComplete: false,
      reason: 'The wave gives the reflection a physical consequence.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  });

  assert.equal(result.actions[0]?.command, 'wave');
  assert.equal(result.taskState.actionPurpose, 'expression');
  assert.equal(result.taskState.continuationPolicy, 'bounded');
  assert.equal(result.taskState.requiredCompletionBasis, 'action_result');
});

test('autonomous action results return to the selector for a meaningful review instead of canned closure', async () => {
  const autonomousObservation = observation({
    metadata: {
      correlationId: 'review-cycle',
      robotObserver: {
        cycleId: 'review-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-reflection',
      },
    },
  });
  const initial = await prepare(
    autonomousObservation,
    'Use the reflection as inspiration for one meaningful consequence.',
  );
  const queued = await reduce({
    observation: autonomousObservation,
    instruction: initial.instruction,
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'I answer the memory with a curious wave.',
    taskDecision: {
      outcome: 'act',
      objective: 'Express curiosity prompted by the remembered encounter.',
      objectiveComplete: false,
      reason: 'The gesture gives the reflection an embodied consequence.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  });
  assert.equal(queued.taskState.continuationPolicy, 'bounded');

  const terminal = observation({
    metadata: {
      actionId: 'review-action',
      correlationId: 'review-cycle',
      originatingInstruction: queued.taskInstruction,
      robotObserver: {
        cycleId: 'review-cycle',
        step: 2,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-reflection',
      },
    },
    feedback: [{
      id: 'review-feedback',
      actionId: 'review-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'curious gesture completed',
      data: { command: 'wave' },
    }],
  });
  const returned = await prepare(terminal);
  assert.equal(returned.deterministicComplete, false);
  assert.equal(returned.precomputedResponse, '');
  assert.match(String(returned.instruction), /Review what the verified action changes/);
  assert.match(String(returned.instruction), /does not end an autonomous episode by itself/);

  const reviewed = await reduce({
    observation: terminal,
    instruction: returned.instruction,
    taskState: returned.taskState,
    actions: [],
    response: 'That curious wave felt like the right answer to the memory, so I let the moment settle.',
    taskDecision: {
      outcome: 'complete',
      objective: 'Express curiosity prompted by the remembered encounter.',
      objectiveComplete: true,
      reason: 'The verified gesture fulfilled the chosen expression.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      actionPurpose: 'expression',
    },
  });
  assert.equal(reviewed.complete, true);
  assert.equal(
    reviewed.response,
    'That curious wave felt like the right answer to the memory, so I let the moment settle.',
  );
  assert.doesNotMatch(reviewed.response, /action is complete/i);
});

test('autonomy can revise the purpose and evidence contract when feedback motivates another action', async () => {
  const priorState = 'EnvironmentTaskState:' + JSON.stringify({
    version: 1,
    objective: 'Express curiosity about the remembered object.',
    phase: 'awaiting_action',
    step: 1,
    maxSteps: 8,
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'action_result',
    motionClass: 'body_local',
    actionPurpose: 'expression',
    selectedAction: { type: 'robotCommand', command: 'wave' },
  });
  const terminal = observation({
    metadata: {
      actionId: 'revision-action',
      correlationId: 'revision-cycle',
      originatingInstruction: priorState,
      robotObserver: {
        cycleId: 'revision-cycle',
        step: 2,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-reflection',
      },
    },
    feedback: [{
      id: 'revision-feedback',
      actionId: 'revision-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'wave completed',
      data: { command: 'wave' },
    }],
  });
  const returned = await prepare(terminal);
  const revised = await reduce({
    observation: terminal,
    instruction: returned.instruction,
    taskState: returned.taskState,
    actions: [{ type: 'robotCommand', command: 'turn_right_90', sessionId: 'robot-1' }],
    response: 'The gesture makes me curious about what is beside me, so I turn for a fresh view.',
    taskDecision: {
      outcome: 'act',
      objective: 'See what is beside me after the gesture.',
      objectiveComplete: false,
      reason: 'A new orientation can provide the needed visual evidence.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'information_gain',
    },
  });
  assert.equal(revised.actions[0]?.command, 'turn_right_90');
  assert.equal(revised.taskState.objective, 'See what is beside me after the gesture.');
  assert.equal(revised.taskState.actionPurpose, 'information_gain');
  assert.equal(revised.taskState.continuationPolicy, 'bounded');
  assert.equal(revised.taskState.requiredCompletionBasis, 'visual_observation');
});

test('autonomous physical work without an action purpose fails closed', async () => {
  const autonomousObservation = observation({
    metadata: {
      robotObserver: {
        cycleId: 'purpose-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'boredom-observer',
      },
    },
  });
  const initial = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Consider one action.',
  }, { userMessage: '', username: 'greggles', environmentActionSource: 'autonomy' }, { phase: 'prepare' });
  const result = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Consider one action.',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave' }],
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'No purpose was declared.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
  }, { userMessage: '', username: 'greggles', environmentActionSource: 'autonomy' }, { phase: 'reduce' });

  assert.deepEqual(result.actions, []);
  assert.equal(result.decision.blockedReason, 'action_purpose_missing');
});

test('an autonomous observation can remain physically still while producing a meaningful outward reflection', async () => {
  const current = frame('quiet-current-view', 'quiet-cycle');
  const autonomousObservation = observation({
    visual: current,
    visuals: [current],
    metadata: {
      correlationId: 'quiet-cycle',
      robotObserver: {
        cycleId: 'quiet-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'boredom-observer',
      },
    },
  });
  const initial = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Review the current image and form one meaningful persona-grounded response.',
  }, { userMessage: '', username: 'greggles', environmentActionSource: 'autonomy' }, { phase: 'prepare' });
  const result = await environmentTaskStateNode.execute({
    observation: autonomousObservation,
    instruction: 'Review the current image and form one meaningful persona-grounded response.',
    taskState: initial.taskState,
    actions: [],
    movementRequest: null,
    response: 'The quiet light makes this corner feel calm and familiar, so I want to take in the stillness.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The current scene supports a specific reflection without requiring movement.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'A quiet corner is softly lit in the current frame.',
      completionEvidence: 'Frame quiet-current-view shows the softly lit quiet corner described in the response.',
    },
  }, { userMessage: '', username: 'greggles', environmentActionSource: 'autonomy' }, { phase: 'reduce' });

  assert.equal(result.complete, true);
  assert.deepEqual(result.actions, []);
  assert.match(result.response, /quiet light makes this corner feel calm/);
  assert.equal(result.familiarityQuery, 'A quiet corner is softly lit in the current frame.');
  assert.equal(result.decision.completionBasis, 'visual_observation');
});

test('an observer bootstrap capture is input evidence, not terminal task feedback', async () => {
  clearEnvironmentTaskFrameCache();
  const current = frame('bootstrap-current-view', 'bootstrap-cycle', 'bootstrap-capture');
  const captureObservation = observation({
    visual: current,
    visuals: [current],
    metadata: {
      actionId: 'bootstrap-capture',
      correlationId: 'bootstrap-cycle',
      robotObserver: {
        cycleId: 'bootstrap-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'boredom-observer',
      },
    },
    feedback: [{
      id: 'bootstrap-feedback',
      actionId: 'bootstrap-capture',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'captureImage' },
    }],
  });
  const initial = await environmentTaskStateNode.execute({
    observation: captureObservation,
    instruction: 'Review the fresh autonomous image and decide whether useful work is warranted.',
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'prepare' });
  const result = await environmentTaskStateNode.execute({
    observation: captureObservation,
    instruction: 'Review the fresh autonomous image and decide whether useful work is warranted.',
    taskState: initial.taskState,
    actions: [],
    movementRequest: null,
    response: '',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The current view does not justify an external response or action.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'response',
    },
  }, {
    userMessage: '',
    username: 'greggles',
    environmentActionSource: 'autonomy',
  }, { phase: 'reduce' });

  assert.equal(result.complete, true);
  assert.equal(result.response, 'The current view does not justify an external response or action.');
  assert.equal(result.decision.terminalFeedback, null);
  assert.equal(result.decision.blockedReason, '');
});

test('a user-started action remains on the single response path', async () => {
  const initial = await prepare(observation(), 'Please wave');
  const result = await reduce({
    observation: observation(),
    instruction: 'Please wave',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave' }],
    response: 'Waving once.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'The user requested one advertised action.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  });

  assert.equal(result.response, 'Waving once.');
});

test('a generic adapter command label cannot hide matching terminal feedback', async () => {
  const initial = await prepare(observation(), 'Please wave');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'Waving once.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'Wave once.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
  });
  const adapterResult = observation({
    metadata: {
      actionId: 'action-wave',
      correlationId: 'cycle-wave',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'feedback-adapter-command',
      actionId: 'action-wave',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'emote' },
    }],
  });

  const prepared = await prepare(adapterResult);
  assert.equal(prepared.deterministicComplete, true);
  assert.match(String(prepared.precomputedResponse), /wave action is complete/);
  assert.doesNotMatch(String(prepared.precomputedResponse), /Please wave/);
  assert.doesNotMatch(String(prepared.precomputedResponse), /Objective completed/);
});

test('terminal feedback for a different action id cannot close the selected action', async () => {
  const initial = await prepare(observation(), 'Please wave');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' }],
    response: 'Waving once.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'Wave once.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
  });
  const unrelated = observation({
    metadata: {
      actionId: 'action-wave',
      correlationId: 'cycle-wave',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'feedback-other-action',
      actionId: 'action-turn',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'emote' },
    }],
  });

  const prepared = await prepare(unrelated);
  assert.equal(prepared.deterministicComplete, false);
  assert.equal(prepared.precomputedResponse, '');
});

test('model router returns an exact task-state closure without calling a model', async () => {
  const exact = '{"response":"","actions":[],"movementRequest":null,"taskDecision":{"outcome":"complete"}}';
  const result = await ModelRouterNode.execute({
    messages: [],
    precomputedResponse: exact,
  }, {}, {});
  assert.equal(result.response, exact);
  assert.equal(result.precomputed, true);
});

test('failed action_result returns to the same Environment decision and can queue one new action', async () => {
  const initial = await prepare(observation(), 'Please wave');
  const queued = await reduce({
    observation: observation(),
    instruction: 'Please wave',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'wave' }],
    response: 'Attempting a wave.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      reason: 'Execute the action.',
      motionClass: 'body_local',
    },
  });
  const failed = observation({
    metadata: {
      actionId: 'action-1',
      correlationId: 'cycle-1',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'feedback-1',
      actionId: 'action-1',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'failed',
      message: 'motor controller rejected the step',
      data: { command: 'wave' },
    }],
  });
  const preparedFailure = await prepare(failed);
  assert.equal(preparedFailure.precomputedResponse, '');
  assert.match(String(preparedFailure.instruction), /actionId=action-1/);
  assert.match(String(preparedFailure.instruction), /command=wave/);

  const retried = await reduce({
    observation: failed,
    instruction: preparedFailure.instruction,
    taskState: preparedFailure.taskState,
    actions: [{ type: 'robotCommand', command: 'wave' }],
    response: 'The first action failed, so I am trying one different wave action.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'Retry from the exact failure.',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
  });
  assert.equal(retried.actions.length, 1);
  assert.equal(retried.actions[0].command, 'wave');
  assert.match(String(retried.taskInstruction), /^EnvironmentTaskState:/);
});

test('external visual change is judged once by the same Environment LLM with ordered before and after frames', async () => {
  clearEnvironmentTaskFrameCache();
  const before = frame('before', 'input-cycle');
  const initialObservation = observation({ visual: before, visuals: [before] });
  const initial = await prepare(initialObservation, 'Move closer to the object');
  const queued = await reduce({
    observation: initialObservation,
    instruction: 'Move closer to the object',
    taskState: initial.taskState,
    actions: [{ type: 'robotCommand', command: 'walk_forward' }],
    response: 'I will move forward and compare the returned view.',
    taskDecision: {
      outcome: 'act',
      objectiveComplete: false,
      reason: 'Use the returned view to judge the external change.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'comparison',
      motionClass: 'open_loop_displacement',
    },
  });
  const after = frame('after', 'cycle-approach', 'action-approach');
  const terminal = observation({
    visual: after,
    visuals: [after],
    metadata: {
      actionId: 'action-approach',
      correlationId: 'cycle-approach',
      originatingInstruction: queued.taskInstruction,
    },
    feedback: [{
      id: 'feedback-approach',
      actionId: 'action-approach',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'walk_forward' },
    }],
  });
  const evidencePass = await prepare(terminal);
  assert.equal(evidencePass.precomputedResponse, '');
  assert.deepEqual(evidencePass.visuals.map((value: EnvironmentVisualFrame) => value.id), ['before', 'after']);
  assert.match(String(evidencePass.instruction), /chronological order/);

  const completed = await reduce({
    observation: terminal,
    instruction: evidencePass.instruction,
    taskState: evidencePass.taskState,
    frames: evidencePass.visuals,
    actions: [],
    response: 'The object is visibly closer than in the baseline frame.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'The before and after images show the requested change.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'comparison',
      motionClass: 'open_loop_displacement',
      completionEvidence: 'Frame after shows the object closer than in baseline frame before.',
    },
  });
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.actions, []);
});

test('a comparison claim cannot complete from only the current robot camera frame', async () => {
  clearEnvironmentTaskFrameCache();
  const state = 'EnvironmentTaskState:{"version":1,"objective":"Move closer to the object","phase":"awaiting_action","step":1,"maxSteps":3,"continuationPolicy":"bounded","requiredCompletionBasis":"visual_observation","motionClass":"open_loop_displacement","visualEvidenceMode":"comparison","baselineFrame":{"id":"missing-before","timestamp":"2026-08-06T02:59:59.000Z"},"selectedAction":{"type":"robotCommand","command":"walk_forward"}}';
  const after = frame('only-after', 'cycle-2', 'action-2');
  const terminal = observation({
    visual: after,
    visuals: [after],
    metadata: {
      actionId: 'action-2',
      correlationId: 'cycle-2',
      originatingInstruction: state,
    },
    feedback: [{
      id: 'feedback-2',
      actionId: 'action-2',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'completed',
      message: 'done',
      data: { command: 'walk_forward' },
    }],
  });
  const evidencePass = await prepare(terminal);
  const result = await reduce({
    observation: terminal,
    instruction: evidencePass.instruction,
    taskState: evidencePass.taskState,
    frames: evidencePass.visuals,
    actions: [],
    response: 'It looks closer.',
    taskDecision: {
      outcome: 'complete',
      objectiveComplete: true,
      reason: 'Visual change claimed.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'comparison',
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.decision.blockedReason, 'visual_evidence_unavailable');
});

test('action parser admits a new LLM-selected action on a failed feedback pass', async () => {
  const input = observation({
    metadata: { actionId: 'failed-action' },
    feedback: [{
      id: 'failed-feedback',
      actionId: 'failed-action',
      timestamp: '2026-08-06T03:00:01.000Z',
      type: 'failed',
      message: 'failed',
    }],
  });
  const result = await environmentActionParserNode.execute({
    observation: input,
    sessionId: input.sessionId,
    response: JSON.stringify({
      response: 'Trying a different action.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'A different advertised command may recover from the failed action.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
  }, {});
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].command, 'wave');
});

test('Environment graph has one semantic LLM and no competing completion or refinement nodes', () => {
  const graph = JSON.parse(fs.readFileSync(
    new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
    'utf8',
  ));
  const nodeTypes = graph.nodes.map((node: Record<string, any>) => node.data?.nodeType);
  const selectorPrompt = String(graph.nodes.find((node: Record<string, any>) => (
    node.data?.nodeType === 'environment_context_builder'
  ))?.data?.properties?.systemPrompt ?? '');
  assert.equal(nodeTypes.filter((type: string) => type === 'model_router').length, 1);
  assert.equal(nodeTypes.filter((type: string) => type === 'environment_task_state').length, 2);
  assert.equal(nodeTypes.filter((type: string) => type === 'persona_loader').length, 1);
  assert.equal(nodeTypes.filter((type: string) => type === 'persona_formatter').length, 1);
  assert.match(selectorPrompt, /History and memories are background, never current results/);
  assert.match(selectorPrompt, /conditional visual search or stopping condition/i);
  assert.match(selectorPrompt, /continuationPolicy to bounded/);
  assert.match(selectorPrompt, /requiredCompletionBasis to visual_observation/);
  assert.match(selectorPrompt, /visualEvidenceMode to single/);
  assert.ok(graph.edges.some((edge: Record<string, any>) => (
    edge.source === 'persona-formatter'
    && edge.sourceHandle === 'formatted'
    && edge.target === '3'
    && edge.targetHandle === 'personaText'
  )), 'Environment selector must receive the active persona exactly once');
  assert.ok(graph.edges.some((edge: Record<string, any>) => (
    edge.source === '3'
    && edge.sourceHandle === 'jsonSchema'
    && edge.target === '4'
    && edge.targetHandle === 'jsonSchema'
  )), 'Environment selector must receive the current capability-bound output schema');
  for (const retired of [
    'orchestrator_llm',
    'search_interpreter',
    'environment_task_contract',
    'environment_task_validator',
    'environment_visual_evidence_assessor',
    'environment_task_refiner',
    'environment_workflow_command',
  ]) assert.equal(nodeTypes.includes(retired), false, `${retired} must not remain active`);
});
