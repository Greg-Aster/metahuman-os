import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from '../../paths.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import {
  ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS,
  environmentBridgeInputNode,
} from './bridge-input.node.js';

test('Environment Bridge Input exposes and persists its configurable observation contract', async () => {
  const timestamp = new Date().toISOString();
  const observation: EnvironmentObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp,
    capabilities: {
      actions: ['robotCommand'],
      robotCommands: ['wave'],
      robotCommandDescriptions: { wave: 'Raise and lower one front leg.' },
      visual: true,
    },
    text: [{ id: 'text-1', source: 'player', text: 'Hello', timestamp }],
    state: { pose: 'stand' },
    location: { roomId: 'office' },
    map: { label: 'Office' },
    visual: { id: 'frame-1', timestamp, mimeType: 'image/jpeg' },
    visuals: [{ id: 'frame-0', timestamp, mimeType: 'image/jpeg' }],
    feedback: [{ id: 'result-1', timestamp, type: 'completed', message: 'done' }],
    metadata: { correlationId: 'turn-1' },
  };

  assert.deepEqual(
    environmentBridgeInputNode.outputs.map(output => output.name),
    [
      'observation',
      'environmentId',
      'adapter',
      'timestamp',
      'capabilities',
      'text',
      'state',
      'location',
      'map',
      'visual',
      'visuals',
      'feedback',
      'metadata',
      'plannerInstruction',
      'inputSource',
      'sessionId',
      'connected',
    ],
  );
  assert.deepEqual(
    environmentBridgeInputNode.propertySchemas?.observationFields?.default,
    [...ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS],
  );
  assert.equal(environmentBridgeInputNode.presentation?.defaultExpanded, true);
  assert.deepEqual(
    environmentBridgeInputNode.outputs
      .filter(output => output.primary)
      .map(output => output.name),
    ['observation', 'sessionId', 'connected'],
  );
  assert.equal(environmentBridgeInputNode.propertySchemas?.sessionId?.suggestions, 'environment-sessions');

  const selected = await environmentBridgeInputNode.execute({}, {
    environmentObservation: observation,
  }, {
    sessionId: '',
    observationFields: ['state', 'visual'],
  });
  assert.equal(selected.connected, true);
  assert.equal(selected.environmentId, 'ainekio');
  assert.equal(selected.sessionId, 'robot-1');
  assert.deepEqual(selected.state, { pose: 'stand' });
  assert.equal(selected.visual.id, 'frame-1');
  assert.equal(selected.capabilities, null);
  assert.deepEqual(selected.text, []);
  assert.equal(selected.metadata, null);
  assert.deepEqual(selected.observation.capabilities, { actions: [] });
  assert.equal(selected.observation.text, undefined);
  assert.equal(selected.observation.metadata, undefined);

  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/environment-mode.json'),
    'utf8',
  ));
  const graphNode = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_bridge_input');
  assert.deepEqual(graphNode?.data?.properties?.observationFields, [
    ...ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS,
  ]);
});
