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

  assert(edge);
  assert.match(String(router?.data?.properties?.systemPrompt), /JSON routing envelope/i);
  assert.match(String(router?.data?.properties?.userPromptTemplate), /action_result.*separate stopping condition/is);
});
