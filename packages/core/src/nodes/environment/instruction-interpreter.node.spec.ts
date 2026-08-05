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

test('instruction interpreter gives the context router current state without image payloads', async () => {
  const result = await environmentInstructionInterpreterNode.execute({
    observation: observation(),
  }, {
    userMessage: 'Report the current device value.',
  });

  const routingRequest = JSON.parse(result.routingRequest);
  assert.equal(routingRequest.currentInstruction, 'Report the current device value.');
  assert.equal(routingRequest.currentEnvironment.state.device.status.currentValue, 12.4);
  assert.equal(routingRequest.currentEnvironment.capabilities.visual, true);
  assert.equal(routingRequest.currentEnvironment.capabilities.navigation, false);
  assert.deepEqual(routingRequest.currentEnvironment.visualFrames, []);
  assert.equal(routingRequest.currentEnvironment.hasFreshCorrelatedVisual, false);
  assert.equal(routingRequest.currentEnvironment.persistedTaskContract, null);
  assert.doesNotMatch(result.routingRequest, /data:image/i);
});

test('instruction interpreter exposes a persisted whole-objective contract to routing', async () => {
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
      maxSteps: 4,
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
  const routingRequest = JSON.parse(result.routingRequest);

  assert.deepEqual(routingRequest.currentEnvironment.persistedTaskContract, contract);
  assert.equal(routingRequest.currentEnvironment.hasFreshCorrelatedVisual, true);
  assert.equal(routingRequest.currentEnvironment.visualFrames[0].id, 'visual-1');
  assert.equal(routingRequest.currentEnvironment.visualFrames[0].dataUrl, undefined);
  assert.equal(result.persistedRoutingAnalysis, null);
});

test('a persisted continuation receives a deterministic contract-owned route', async () => {
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
      maxSteps: 4,
      triggerSource: 'autonomy',
      graph: 'environment',
      requestedBy: 'environment-perception',
    },
  };

  const result = await environmentInstructionInterpreterNode.execute({ observation: input }, {});
  assert.deepEqual(result.persistedRoutingAnalysis, {
    needsMemory: false,
    memoryTier: 'hot',
    memoryQuery: '',
    memoryTypes: [],
    needsEnvironment: true,
    needsVision: false,
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
    complexity: 0.2,
    responseStyle: 'conversational',
    responseLength: 'brief',
    isFollowUp: true,
    emotionalTone: 'neutral',
  });
});

test('an existing correlated image is not mislabeled as a completed camera request', async () => {
  const input = observation();
  input.metadata = {
    originatingInstruction: 'Inspect the current scene and choose one useful outcome.',
    correlationId: 'cycle-1',
    robotObserver: {
      cycleId: 'cycle-1',
      step: 1,
      maxSteps: 4,
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

test('Environment graph routes the state-aware envelope into the existing context router', () => {
  const graph = JSON.parse(fs.readFileSync(
    new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
    'utf8',
  ));
  const edge = graph.edges.find((candidate: Record<string, unknown>) => (
    candidate.source === '10'
    && candidate.sourceHandle === 'routingRequest'
    && candidate.target === 'context-router'
    && candidate.targetHandle === 'message'
  ));
  const router = graph.nodes.find((candidate: Record<string, any>) => candidate.id === 'context-router');
  const routerPrompt = [
    router?.data?.properties?.systemPrompt,
    router?.data?.properties?.userPromptTemplate,
  ].join('\n');

  assert(edge);
  assert(graph.edges.some((candidate: Record<string, unknown>) => (
    candidate.source === '10'
    && candidate.sourceHandle === 'persistedRoutingAnalysis'
    && candidate.target === 'context-router'
    && candidate.targetHandle === 'precomputedAnalysis'
  )));
  assert.match(routerPrompt, /JSON envelope/i);
  assert.match(routerPrompt, /needsEnvironment/);
  assert.match(routerPrompt, /needsVision/);
  assert.match(routerPrompt, /action_result proves only.*command ran/is);
  assert.match(routerPrompt, /changed scene, spatial relationship, visibility/is);
});
