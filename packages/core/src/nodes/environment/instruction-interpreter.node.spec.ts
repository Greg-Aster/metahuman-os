import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { encodeEnvironmentTaskInstruction } from './helpers.js';
import { environmentInstructionInterpreterNode } from './instruction-interpreter.node.js';

function observation(): EnvironmentObservation {
  return {
    environmentId: 'robot-environment',
    adapter: 'robot-adapter',
    sessionId: 'robot-1',
    timestamp: '2026-08-03T18:00:00.000Z',
    capabilities: {
      actions: ['robotCommand', 'captureImage'],
      robotCommands: ['stand'],
      text: true,
      movement: true,
      visual: true,
      map: false,
    },
    state: {
      device: {
        status: {
          currentValue: 12.4,
        },
      },
    },
    feedback: [],
  };
}

test('instruction interpreter preserves current state and advertised capabilities', async () => {
  const result = await environmentInstructionInterpreterNode.execute({
    observation: observation(),
  }, {
    userMessage: 'Report the current device value.',
  });

  assert.equal(result.instruction, 'Report the current device value.');
  assert.equal(result.observation.state.device.status.currentValue, 12.4);
  assert.equal(result.observation.capabilities.visual, true);
  assert.equal(result.observation.capabilities.navigation, false);
  assert.equal(result.routingRequest, undefined);
});

test('instruction interpreter restores the original objective from a persisted contract', async () => {
  const contract = {
    objective: 'Maintain the requested activity subject to its completion condition.',
    currentInstruction: 'Perform the next admitted step.',
    continuationPolicy: 'bounded' as const,
    requiredCompletionBasis: 'visual_observation' as const,
  };
  const input = observation();
  input.metadata = {
    originatingInstruction: encodeEnvironmentTaskInstruction(contract),
    correlationId: 'cycle-1',
    robotObserver: {
      cycleId: 'cycle-1',
      step: 2,
      triggerSource: 'user',
      graph: 'environment',
      requestedBy: 'environment-perception',
    },
  };
  input.visual = {
    id: 'visual-1',
    timestamp: input.timestamp,
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    metadata: { correlationId: 'cycle-1' },
  };

  const result = await environmentInstructionInterpreterNode.execute({ observation: input }, {});
  assert.equal(result.instruction, contract.objective);
  assert.equal(result.observation.visual.id, 'visual-1');
  assert.equal(result.observation.visual.dataUrl, 'data:image/jpeg;base64,/9j/2gAA/9k=');
});

test('a legacy queued continuation is normalized without creating routing authority', async () => {
  const input = observation();
  input.metadata = {
    originatingInstruction: encodeEnvironmentTaskInstruction({
      objective: 'Change pose, then verify the result.',
      currentInstruction: 'Perform the next admitted pose change.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    }),
    taskValidatorCommand: {
      objective: 'Change pose, then verify the result.',
      instruction: 'Perform the next admitted pose change.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
    robotObserver: {
      cycleId: 'cycle-1',
      step: 2,
      triggerSource: 'autonomy',
      graph: 'environment',
      requestedBy: 'environment-perception',
    },
  };

  const result = await environmentInstructionInterpreterNode.execute({ observation: input }, {});
  assert.equal(result.instruction, 'Perform the next admitted pose change.');
  assert.equal(result.persistedRoutingAnalysis, undefined);
});

test('an existing correlated image is not mislabeled as a completed camera request', async () => {
  const input = observation();
  input.metadata = {
    originatingInstruction: 'Inspect the current scene and choose one useful outcome.',
    correlationId: 'cycle-1',
    robotObserver: {
      cycleId: 'cycle-1',
      step: 1,
      triggerSource: 'user',
      graph: 'environment',
      requestedBy: 'environment-perception',
    },
  };
  input.visual = {
    id: 'visual-1',
    timestamp: input.timestamp,
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    metadata: { correlationId: 'cycle-1' },
  };

  const result = await environmentInstructionInterpreterNode.execute({ observation: input }, {});

  assert.equal(result.instruction, input.metadata.originatingInstruction);
  assert.doesNotMatch(String(result.instruction), /visual acquisition.*complete/i);
});

test('Environment graph routes normalized input into the sole task-state owner', () => {
  const graph = JSON.parse(fs.readFileSync(
    new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
    'utf8',
  ));
  const observationEdge = graph.edges.find((candidate: Record<string, unknown>) => (
    candidate.source === '10'
    && candidate.sourceHandle === 'observation'
    && candidate.target === 'task-state-prepare'
    && candidate.targetHandle === 'observation'
  ));
  const instructionEdge = graph.edges.find((candidate: Record<string, unknown>) => (
    candidate.source === '10'
    && candidate.sourceHandle === 'instruction'
    && candidate.target === 'task-state-prepare'
    && candidate.targetHandle === 'instruction'
  ));
  const prepare = graph.nodes.find((candidate: Record<string, any>) => candidate.id === 'task-state-prepare');
  const environmentDecision = graph.nodes.find((candidate: Record<string, any>) => candidate.id === '4');

  assert(observationEdge);
  assert(instructionEdge);
  assert(graph.edges.some((candidate: Record<string, unknown>) => (
    candidate.source === 'task-state-prepare'
    && candidate.sourceHandle === 'precomputedResponse'
    && candidate.target === '4'
    && candidate.targetHandle === 'precomputedResponse'
  )));
  assert.equal(prepare?.data?.nodeType, 'environment_task_state');
  assert.equal(prepare?.data?.properties?.phase, 'prepare');
  assert.equal(graph.nodes.some((candidate: Record<string, any>) => candidate.data?.nodeType === 'orchestrator_llm'), false);
  assert.equal(environmentDecision?.data?.properties?.format, 'json');
});
