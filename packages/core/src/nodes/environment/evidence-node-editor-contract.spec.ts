import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentActionContextInputNode } from './action-context-input.node.js';
import { environmentFeedbackNode } from './feedback.node.js';
import { environmentImageInputNode } from './image-input.node.js';

test('Environment evidence nodes explain their jobs while keeping stable graph handles', () => {
  assert.deepEqual(
    [
      environmentActionContextInputNode.id,
      environmentActionContextInputNode.name,
      environmentActionContextInputNode.inputs.map(input => input.name),
      environmentActionContextInputNode.outputs.map(output => output.name),
    ],
    [
      'environment_action_context_input',
      'Verify Matched Sent Action',
      ['actionId'],
      ['actionContext', 'actionId', 'correlationId', 'robotObserver', 'available'],
    ],
  );
  assert.deepEqual(
    [
      environmentFeedbackNode.id,
      environmentFeedbackNode.name,
      environmentFeedbackNode.inputs.map(input => input.name),
      environmentFeedbackNode.outputs.map(output => output.name),
    ],
    [
      'environment_feedback',
      'Find Finished Robot Report for Sent Action',
      ['feedback', 'actionId'],
      ['terminalFeedback', 'matched'],
    ],
  );
  assert.deepEqual(
    [
      environmentImageInputNode.id,
      environmentImageInputNode.name,
      environmentImageInputNode.inputs.map(input => input.name),
      environmentImageInputNode.outputs.map(output => output.name),
    ],
    [
      'environment_image_input',
      'Select Camera Frames for Current Action',
      ['visual', 'visuals', 'robotStatus', 'terminalFeedback', 'actionId', 'correlationId'],
      ['images', 'frames', 'rejectedCount'],
    ],
  );

  for (const node of [
    environmentActionContextInputNode,
    environmentFeedbackNode,
    environmentImageInputNode,
  ]) {
    assert.ok(node.description);
    assert.equal(node.inputs.every(input => Boolean(input.label && input.description)), true);
    assert.equal(node.outputs.every(output => Boolean(output.label && output.description)), true);
  }
});

test('Matched Sent Action verifies Core-provided context without owning lookup or settings', async () => {
  const environmentActionContext = {
    actionId: 'sent-action-1',
    status: 'completed',
    requested: { type: 'robotCommand', command: 'wave' },
    correlationId: 'cycle-1',
    queuedAt: '2026-09-03T12:00:00.000Z',
    completedAt: '2026-09-03T12:00:01.000Z',
    result: { type: 'completed', message: 'wave completed' },
    robotObserver: {
      cycleId: 'cycle-1',
      step: 2,
      triggerSource: 'autonomy',
      graph: 'robot-action-result',
      requestedBy: 'boredom-movement',
    },
  };

  const matched = await environmentActionContextInputNode.execute(
    { actionId: 'sent-action-1' },
    { environmentActionContext },
  );
  assert.equal(matched.available, true);
  assert.equal(matched.actionContext, environmentActionContext);
  assert.equal(matched.actionId, 'sent-action-1');
  assert.equal(matched.correlationId, 'cycle-1');

  const mismatched = await environmentActionContextInputNode.execute(
    { actionId: 'different-action' },
    { environmentActionContext },
  );
  assert.equal(mismatched.available, false);
  assert.equal(mismatched.actionContext, null);
  assert.equal(mismatched.actionId, '');

  const missingContext = await environmentActionContextInputNode.execute(
    { actionId: 'sent-action-1' },
    {},
  );
  assert.equal(missingContext.available, false);
  assert.equal(environmentActionContextInputNode.propertySchemas, undefined);
});
