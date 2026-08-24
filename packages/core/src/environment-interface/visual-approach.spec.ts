import assert from 'node:assert/strict';
import test from 'node:test';

import { environmentActionParserNode } from '../nodes/environment/action-parser.node.js';
import { getQueueManager } from '../queue/index.js';
import { enqueueEnvironmentAction } from './store.js';
import {
  ENVIRONMENT_ACTIVE_VIEW_ACTIVE_STATUSES,
  ENVIRONMENT_ACTIVE_VIEW_TERMINAL_STATUSES,
  isEnvironmentActiveViewTerminalStatus,
  normalizeEnvironmentActiveViewProgress,
  normalizeEnvironmentVisualInspectionTarget,
  normalizeEnvironmentVisualTarget,
} from './visual-approach.js';

const target = {
  version: 1 as const,
  targetId: 'target-1',
  frameId: 'frame-1',
  frameTimestamp: '2026-08-04T12:00:00.000Z',
  box: { x: 0.3, y: 0.2, width: 0.2, height: 0.25 },
  confidence: 0.86,
  description: 'The selected scene target.',
  stopBoxHeight: 0.5,
};
const inspectionTarget = {
  version: 1 as const,
  targetId: 'inspection-1',
  frameId: 'frame-1',
  frameTimestamp: '2026-08-04T12:00:00.000Z',
  query: 'the small blue object visible near the shelving unit',
};
const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

function selectorJson(output: {
  response: string;
  actions: Array<Record<string, unknown>>;
  movementRequest: null;
}): string {
  const actionType = String(output.actions[0]?.type ?? '');
  const informationGain = actionType === 'inspect' || actionType === 'visualApproach';
  return JSON.stringify({
    ...output,
    taskDecision: {
      objective: 'Exercise the current frame-bound Environment action contract.',
      outcome: 'act',
      reason: 'The selected action advances the current visual objective.',
      objectiveComplete: false,
      continuationPolicy: informationGain ? 'bounded' : 'none',
      requiredCompletionBasis: informationGain ? 'visual_observation' : 'action_result',
      motionClass: informationGain ? 'target_relative' : 'open_loop_displacement',
      actionPurpose: informationGain ? 'information_gain' : 'expression',
    },
  });
}

test('normalizes one generic frame-bound target and typed progress result', () => {
  assert.deepEqual(normalizeEnvironmentVisualTarget(target), target);
  assert.deepEqual(
    normalizeEnvironmentVisualInspectionTarget(inspectionTarget),
    inspectionTarget,
  );
  assert.throws(
    () => normalizeEnvironmentVisualInspectionTarget({
      ...inspectionTarget,
      seedBox: target.box,
    }),
    /provided together/i,
  );
  assert.deepEqual(normalizeEnvironmentActiveViewProgress({
    version: 1,
    skill: 'visualApproach',
    targetId: 'target-1',
    frameId: 'frame-2',
    timestamp: '2026-08-04T12:00:01.000Z',
    status: 'progress',
    step: 1,
    confidence: 0.8,
    progress: 0.25,
    box: { x: 0.35, y: 0.2, width: 0.23, height: 0.3 },
    pathConfidence: 0.75,
    obstruction: 0.05,
    reason: 'fresh target evidence improved',
  }), {
    version: 1,
    skill: 'visualApproach',
    targetId: 'target-1',
    frameId: 'frame-2',
    timestamp: '2026-08-04T12:00:01.000Z',
    status: 'progress',
    step: 1,
    confidence: 0.8,
    progress: 0.25,
    box: { x: 0.35, y: 0.2, width: 0.23, height: 0.3 },
    pathConfidence: 0.75,
    obstruction: 0.05,
    reason: 'fresh target evidence improved',
  });
  assert.throws(
    () => normalizeEnvironmentVisualTarget({
      ...target,
      box: { x: 0.9, y: 0.2, width: 0.2, height: 0.25 },
    }),
    /within the frame/i,
  );
});

test('keeps active visual-control phases distinct from terminal results', () => {
  for (const status of ENVIRONMENT_ACTIVE_VIEW_ACTIVE_STATUSES) {
    const progress = normalizeEnvironmentActiveViewProgress({
      version: 1,
      skill: 'inspect',
      targetId: 'target-1',
      frameId: `frame-${status}`,
      timestamp: '2026-08-04T12:00:01.000Z',
      status,
      step: 1,
      confidence: status === 'reacquiring' ? 0.4 : 0.8,
      progress: 0.25,
      reason: `controller_${status}`,
    });
    assert.equal(progress?.status, status);
    assert.equal(isEnvironmentActiveViewTerminalStatus(status), false);
  }

  for (const status of ENVIRONMENT_ACTIVE_VIEW_TERMINAL_STATUSES) {
    assert.equal(isEnvironmentActiveViewTerminalStatus(status), true);
  }
});

test('the existing Environment command queue preserves the bounded visual target contract', () => {
  const manager = getQueueManager();
  const originalState = manager.exportState();
  try {
    manager.clear();
    const queued = enqueueEnvironmentAction({
      type: 'visualApproach',
      sessionId: 'robot-1',
      visualTarget: target,
    }, {
      username: 'owner',
      source: 'autonomy',
      allowedActions: ['visualApproach'],
    });
    assert.equal(queued.type, 'visualApproach');
    assert.deepEqual(queued.visualTarget, target);
    const inspection = enqueueEnvironmentAction({
      type: 'inspect',
      sessionId: 'robot-1',
      inspectionTarget,
    }, {
      username: 'owner',
      source: 'autonomy',
      allowedActions: ['inspect'],
    });
    assert.equal(inspection.type, 'inspect');
    assert.deepEqual(inspection.inspectionTarget, inspectionTarget);
    assert.throws(() => enqueueEnvironmentAction({
      type: 'visualApproach',
      sessionId: 'robot-1',
      visualTarget: { ...target, confidence: 2 },
    }, {
      username: 'owner',
      source: 'autonomy',
      allowedActions: ['visualApproach'],
    }), /confidence/i);
  } finally {
    manager.importState(originalState);
  }
});

test('active inspection is admitted only from an exact frame and truthful activeView capability', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage', 'inspect'],
      motionClasses: ['target_relative'],
      visual: true,
      activeView: {
        maxSteps: 8,
        maxFrameAgeMs: 2_000,
        minimumConfidence: 0.5,
        reacquisitionLimit: 3,
      },
    },
    visual: {
      id: 'frame-1',
      timestamp: '2026-08-04T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: TEST_JPEG,
      metadata: { correlationId: 'cycle-inspect' },
    },
    metadata: {
      correlationId: 'cycle-inspect',
      robotObserver: {
        cycleId: 'cycle-inspect',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      motionClass: 'target_relative',
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
  };
  const inspect = await environmentActionParserNode.execute({
    response: selectorJson({
      response: '',
      actions: [{ type: 'inspect', inspectionTarget }],
      movementRequest: null,
    }),
    instruction: 'Inspect the selected current target.',
    routingAnalysis,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(inspect.actions.length, 1);
  assert.equal(inspect.actions[0]?.type, 'inspect');
  assert.equal(inspect.actionAdmission.admitted, true);

  const missingController = await environmentActionParserNode.execute({
    response: selectorJson({
      response: '',
      actions: [{ type: 'inspect', inspectionTarget }],
      movementRequest: null,
    }),
    instruction: 'Inspect the selected current target.',
    routingAnalysis,
    observation: {
      ...observation,
      capabilities: { ...observation.capabilities, activeView: undefined },
    },
    sessionId: observation.sessionId,
  }, {});
  assert.equal(missingController.actions.length, 0);
  assert.equal(missingController.actionAdmission.admitted, false);
  assert.equal(
    missingController.actionAdmission.reason,
    'target_relative_feedback_action_unavailable',
  );

  const staleFrame = await environmentActionParserNode.execute({
    response: selectorJson({
      response: '',
      actions: [{
        type: 'inspect',
        inspectionTarget: { ...inspectionTarget, frameId: 'unavailable-frame' },
      }],
      movementRequest: null,
    }),
    instruction: 'Inspect the selected current target.',
    routingAnalysis,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(staleFrame.actions.length, 0);
  assert.equal(staleFrame.actionAdmission.reason, 'target_relative_frame_unavailable');
});

test('target-relative camera feedback is admitted only as an advertised visualApproach action', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage', 'visualApproach'],
      motionClasses: ['target_relative'],
      visual: true,
      visualApproach: {
        maxSteps: 6,
        maxFrameAgeMs: 2_000,
        minimumConfidence: 0.55,
        minimumPathConfidence: 0.65,
        noProgressLimit: 2,
      },
    },
    visual: {
      id: 'frame-1',
      timestamp: '2026-08-04T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: TEST_JPEG,
      metadata: { correlationId: 'cycle-1' },
    },
    metadata: {
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      motionClass: 'target_relative',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  };
  const admitted = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Beginning a bounded camera-feedback approach.',
      actions: [{ type: 'visualApproach', visualTarget: target }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(admitted.actions.length, 1);
  assert.equal(admitted.actions[0]?.type, 'visualApproach');
  assert.deepEqual(admitted.actions[0]?.visualTarget, target);
  assert.equal(admitted.actionAdmission.admitted, true);

  const equivalentTimestamp = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Beginning from the exact current frame.',
      actions: [{
        type: 'visualApproach',
        visualTarget: {
          ...target,
          frameTimestamp: '2026-08-04T05:00:00.000-07:00',
        },
      }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(equivalentTimestamp.actionAdmission.admitted, true);

  const openLoop = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Walking open loop.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation: {
      ...observation,
      capabilities: {
        ...observation.capabilities,
        actions: ['robotCommand', 'visualApproach'],
        robotCommands: ['walk'],
      },
    },
    sessionId: observation.sessionId,
  }, {});
  assert.equal(openLoop.actions.length, 1);
  assert.equal(openLoop.actions[0]?.type, 'robotCommand');
  assert.equal(openLoop.actions[0]?.command, 'walk');
  assert.equal(openLoop.actionAdmission.admitted, true);
  assert.equal(openLoop.actionAdmission.reason, '');

  const staleTarget = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Using an old target frame.',
      actions: [{
        type: 'visualApproach',
        visualTarget: { ...target, frameId: 'old-frame' },
      }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(staleTarget.actions.length, 0);
  assert.equal(staleTarget.actionAdmission.admitted, false);
  assert.equal(staleTarget.actionAdmission.reason, 'target_relative_frame_unavailable');

  const uncorrelatedTarget = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Using an unrelated current-looking frame.',
      actions: [{ type: 'visualApproach', visualTarget: target }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation: {
      ...observation,
      visual: {
        ...observation.visual,
        metadata: { correlationId: 'older-cycle' },
      },
    },
    sessionId: observation.sessionId,
  }, {});
  assert.equal(uncorrelatedTarget.actions.length, 0);
  assert.equal(uncorrelatedTarget.actionAdmission.admitted, false);
  assert.equal(uncorrelatedTarget.actionAdmission.reason, 'target_relative_frame_unavailable');

  const unconfiguredCapability = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Trying an unconfigured controller.',
      actions: [{ type: 'visualApproach', visualTarget: target }],
      movementRequest: null,
    }),
    instruction: 'Approach the selected scene target for a better view.',
    routingAnalysis,
    observation: {
      ...observation,
      capabilities: {
        ...observation.capabilities,
        motionClasses: [],
        visualApproach: undefined,
        navigation: true,
      },
    },
    sessionId: observation.sessionId,
  }, {});
  assert.equal(unconfiguredCapability.actions.length, 0);
  assert.equal(unconfiguredCapability.actionAdmission.admitted, false);
  assert.equal(
    unconfiguredCapability.actionAdmission.reason,
    'target_relative_feedback_action_unavailable',
  );
});
