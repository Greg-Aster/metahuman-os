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
  assert.equal(prepared.taskState.phase, 'new');
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
      completionBasis: 'visual_observation',
      completionEvidence: 'The requested foot is visible in frame foot-visible.',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });

  assert.equal(completed.complete, true);
  assert.deepEqual(completed.actions, []);
  assert.equal(completed.response, 'I see your foot, so I stopped waving.');
  assert.equal(completed.decision.completionBasis, 'visual_observation');
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
  assert.match(String(preparedTerminal.instruction), /proves only that step/);
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
      completionBasis: 'visual_observation',
      completionEvidence: 'Frame room-after shows no situation requiring attention.',
      visualEvidenceMode: 'single',
      motionClass: 'body_local',
    },
  });
  assert.equal(closed.complete, true);
  assert.deepEqual(closed.actions, []);
  assert.equal(closed.response, 'The new view shows a clear, quiet room with nothing that needs further attention.');
  assert.equal(closed.decision.completionBasis, 'visual_observation');
  assert.equal(closed.decision.actionId, 'action-scan');
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
  assert.match(String(prepared.precomputedResponse), /wave action finished successfully/);
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
      completionBasis: 'visual_observation',
      completionEvidence: 'The object occupies more of the current frame.',
      visualEvidenceMode: 'comparison',
      motionClass: 'open_loop_displacement',
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
      completionBasis: 'visual_observation',
      completionEvidence: 'Current image.',
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
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
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
  assert.equal(nodeTypes.filter((type: string) => type === 'model_router').length, 1);
  assert.equal(nodeTypes.filter((type: string) => type === 'environment_task_state').length, 2);
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
