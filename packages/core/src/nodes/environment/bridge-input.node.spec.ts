import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { ROOT } from '../../paths.js';
import {
  recordEnvironmentBridgeTelemetry,
  resetEnvironmentBridgeDiagnosticsForTests,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';
import { environmentBridgeInputNode } from './bridge-input.node.js';

afterEach(() => resetEnvironmentBridgeDiagnosticsForTests());

test('Environment Bridge Input always exposes complete Ainekio observation and bridge data', async () => {
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
    state: {
      transport: 'protocol-v1',
      safety: 'body-owned',
      adapterConnected: true,
      body: {
        authenticated: true,
        robotId: 'robot-1',
        heartbeatAgeMs: 42,
        motionAvailable: true,
        cameraReady: true,
        microphoneReady: null,
        speakerReady: true,
      },
      gateway: {
        robots: {
          'robot-1': {
            connection_state: 'online',
            epoch: 6,
            heartbeat_age_ms: 43,
            status: {
              vbat: 7.1,
              rssi: -52,
              state: 'active',
            },
          },
        },
      },
      freestyleMovement: { supported: true, enabled: true, available: true },
      bodyEvent: { t: 'event', name: 'battery_warn', robot_id: 'robot-1', epoch: 6 },
      lastAudioResult: { status: 'completed', message: 'Utterance transcribed' },
    },
    location: { roomId: 'office' },
    map: { label: 'Office' },
    visual: { id: 'frame-1', timestamp, mimeType: 'image/jpeg' },
    visuals: [{ id: 'frame-0', timestamp, mimeType: 'image/jpeg' }],
    feedback: [{ id: 'result-1', timestamp, type: 'completed', message: 'done', actionId: 'action-1' }],
    metadata: {
      correlationId: 'turn-1',
      sensorReading: 'adapter-owned',
      robotOperatorDecision: { instruction: 'must not cross this boundary' },
    },
  };

  recordEnvironmentBridgeTelemetry({
    sessionId: 'robot-1',
    robotId: 'robot-1',
    intervalMs: 1_000,
    inboundBytes: 640,
    imageFrames: 1,
    audioUtterances: 1,
    microphoneLevel: 0.25,
    pendingAudioUtterances: 1,
    transcriptionStatus: 'completed',
    transcript: 'Hello',
    robotStatus: {
      kind: 'robot.status',
      robot_id: 'robot-1',
      epoch: 7,
      vbat: 7.4,
      rssi: -48,
      state: 'active',
      uptime: 120,
      heap: 123_456,
      sd: true,
      camera_ready: true,
      cam_drops: 2,
      mic_drops: 3,
      spk_underruns: 4,
      wake_enabled: true,
      wake_model: 'ainekio',
      wake_ready: true,
    },
    freestyleMovement: { supported: true, enabled: true, available: true },
    movementPlan: {
      actionId: 'action-1',
      status: 'active',
      frameCount: 3,
      activeFrame: 2,
      updatedAt: timestamp,
    },
    events: [{ timestamp, kind: 'image.frame', bytes: 100 }],
  });

  assert.deepEqual(
    environmentBridgeInputNode.outputs.map(output => output.name),
    [
      'observation',
      'observationSource',
      'isTriggeringObservation',
      'environmentId',
      'adapter',
      'timestamp',
      'robotId',
      'robotEpoch',
      'capabilities',
      'text',
      'state',
      'perception',
      'visual',
      'visuals',
      'feedback',
      'metadata',
      'actionId',
      'correlationId',
      'body',
      'bodyStatus',
      'bodyEvent',
      'bodyAuthenticated',
      'bodyState',
      'bodyStatusTimestamp',
      'batteryVoltage',
      'wifiRssi',
      'uptimeSeconds',
      'freeHeapBytes',
      'sdAvailable',
      'motionAvailable',
      'cameraReady',
      'microphoneReady',
      'speakerReady',
      'cameraDrops',
      'microphoneDrops',
      'speakerUnderruns',
      'wakeEnabled',
      'wakeModel',
      'wakeReady',
      'gateway',
      'adapterConnected',
      'sessionStatus',
      'connectionState',
      'heartbeatAgeMs',
      'transport',
      'safety',
      'freestyleMovement',
      'lastAudioResult',
      'bridgeSummary',
      'bridgeEnabled',
      'bridgeUpdatedAt',
      'sessions',
      'pendingCommandCount',
      'diagnosticsSnapshot',
      'diagnostics',
      'diagnosticsUpdatedAt',
      'transportDiagnostics',
      'mediaDiagnostics',
      'microphoneLevel',
      'pendingAudioUtterances',
      'transcriptionStatus',
      'transcript',
      'movementPlan',
      'latestImage',
      'latestAudio',
      'recentEvents',
      'sessionId',
      'connected',
    ],
  );
  assert.equal(environmentBridgeInputNode.propertySchemas?.observationFields, undefined);
  assert.equal(environmentBridgeInputNode.propertySchemas?.dataOutputs, undefined);
  assert.equal(environmentBridgeInputNode.outputs.some(output => output.enabledBy), false);
  assert.equal(environmentBridgeInputNode.presentation?.defaultExpanded, true);
  assert.deepEqual(
    environmentBridgeInputNode.outputs
      .filter(output => output.primary)
      .map(output => output.name),
    ['observation', 'observationSource', 'isTriggeringObservation', 'sessionId', 'connected'],
  );
  assert.equal(environmentBridgeInputNode.propertySchemas?.sessionId?.suggestions, 'environment-sessions');

  const selected = await environmentBridgeInputNode.execute({}, {
    environmentObservation: observation,
  }, {
    sessionId: '',
    dataOutputs: [],
  });
  assert.equal(selected.connected, true);
  assert.equal(selected.observationSource, 'triggering');
  assert.equal(selected.isTriggeringObservation, true);
  assert.equal(selected.environmentId, 'ainekio');
  assert.equal(selected.sessionId, 'robot-1');
  assert.equal(selected.state.body.robotId, 'robot-1');
  assert.equal(selected.visual.id, 'frame-1');
  assert.deepEqual(selected.capabilities.actions, ['robotCommand']);
  assert.equal(selected.text[0].text, 'Hello');
  assert.equal(selected.feedback[0].type, 'completed');
  assert.equal(selected.metadata.sensorReading, 'adapter-owned');
  assert.equal(selected.actionId, 'action-1');
  assert.equal(selected.correlationId, 'turn-1');
  assert.equal(selected.robotId, 'robot-1');
  assert.equal(selected.robotEpoch, 7);
  assert.equal(selected.bodyAuthenticated, true);
  assert.equal(selected.bodyState, 'active');
  assert.equal(selected.batteryVoltage, 7.4);
  assert.equal(selected.wifiRssi, -48);
  assert.equal(selected.uptimeSeconds, 120);
  assert.equal(selected.freeHeapBytes, 123_456);
  assert.equal(selected.sdAvailable, true);
  assert.equal(selected.cameraDrops, 2);
  assert.equal(selected.microphoneDrops, 3);
  assert.equal(selected.speakerUnderruns, 4);
  assert.equal(selected.wakeEnabled, true);
  assert.equal(selected.wakeModel, 'ainekio');
  assert.equal(selected.wakeReady, true);
  assert.equal(selected.connectionState, 'online');
  assert.equal(selected.heartbeatAgeMs, 42);
  assert.equal(selected.transport, 'protocol-v1');
  assert.equal(selected.safety, 'body-owned');
  assert.equal(selected.bodyEvent.name, 'battery_warn');
  assert.equal(selected.microphoneLevel, 0.25);
  assert.equal(selected.pendingAudioUtterances, 1);
  assert.equal(selected.transcriptionStatus, 'completed');
  assert.equal(selected.transcript, 'Hello');
  assert.equal(selected.movementPlan.actionId, 'action-1');
  assert.equal(selected.transportDiagnostics.inboundBytes, 640);
  assert.equal(selected.mediaDiagnostics.imageFrames, 1);
  assert.equal(selected.diagnostics.sessionId, 'robot-1');
  assert.equal(selected.diagnosticsSnapshot.sessions[0].sessionId, 'robot-1');
  assert.deepEqual(selected.observation.capabilities.actions, ['robotCommand']);
  assert.equal(selected.observation.text[0].text, 'Hello');
  assert.equal(selected.observation.metadata.sensorReading, 'adapter-owned');
  assert.equal(selected.observation.metadata.robotOperatorDecision, undefined);
  assert.equal(selected.observation.location, undefined);
  assert.equal(selected.observation.map, undefined);
  assert.equal('location' in selected, false);
  assert.equal('map' in selected, false);

  const saved = await environmentBridgeInputNode.execute({}, {
    environmentObservation: observation,
    environmentObservationCurrent: false,
  }, { sessionId: '' });
  assert.equal(saved.observationSource, 'saved');
  assert.equal(saved.isTriggeringObservation, false);
  assert.equal(saved.observation.timestamp, observation.timestamp);
  assert.equal(saved.visual.id, 'frame-1');

  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/environment-mode.json'),
    'utf8',
  ));
  const graphNode = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_bridge_input');
  assert.equal(graphNode?.data?.properties?.observationFields, undefined);
  assert.equal(graphNode?.data?.properties?.dataOutputs, undefined);
});

test('Environment Bridge Input never mixes diagnostics from another bridge session', async () => {
  const timestamp = new Date().toISOString();
  recordEnvironmentBridgeTelemetry({
    sessionId: 'other-robot',
    robotId: 'other-robot',
    robotStatus: { vbat: 8.8 },
  });

  const result = await environmentBridgeInputNode.execute({}, {
    environmentObservation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'selected-robot',
      timestamp,
      capabilities: { actions: [] },
      state: {
        body: { robotId: 'selected-robot' },
        gateway: {
          robots: {
            'selected-robot': { status: { vbat: 7.2 } },
          },
        },
      },
    } satisfies EnvironmentObservation,
  }, {});

  assert.equal(result.sessionId, 'selected-robot');
  assert.equal(result.batteryVoltage, 7.2);
  assert.equal(result.diagnostics, null);
});


test('a boot observation uses later same-body telemetry for its camera interface without replacing the event', async () => {
  const timestamp = '2026-10-13T23:33:23.551Z';
  const observation: EnvironmentObservation = {
    environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'boot-session', timestamp,
    capabilities: { actions: ['robotCommand'], robotCommands: ['stretch', 'stand'], visual: false },
    state: { body: { robotId: 'p4', cameraReady: false },
      bodyEvent: { name: 'body_event', kind: 'wake', reason: 'boot', event_id: 'boot-1' },
      gateway: { robots: { p4: { epoch: 7, status: { camera_ready: false } } } } },
    text: [],
  };
  const original = structuredClone(observation);
  recordEnvironmentBridgeTelemetry({ sessionId: 'boot-session', robotId: 'p4',
    robotStatus: { kind: 'robot.status', robot_id: 'p4', epoch: 7, camera_ready: true, output_armed: false } });
  const result = await environmentBridgeInputNode.execute({}, { environmentObservation: observation }, {});
  assert.equal(result.isTriggeringObservation, true);
  assert.equal(result.observation.timestamp, timestamp);
  assert.deepEqual(result.observation.state.bodyEvent, original.state!.bodyEvent);
  assert.deepEqual(result.observation.capabilities.actions, ['robotCommand', 'captureImage']);
  assert.equal(result.observation.capabilities.visual, true);
  assert.equal(result.observation.state.body.cameraReady, true);
  assert.equal(result.observation.state.gateway.robots.p4.status.output_armed, false);
  assert.deepEqual(observation, original, 'the durable boot evidence is immutable');
});

test('boot interface refresh does not import status from a different robot or connection epoch', async () => {
  const observation: EnvironmentObservation = {
    environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'boot-session', timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], visual: false },
    state: { body: { robotId: 'p4', cameraReady: false }, gateway: { robots: { p4: { epoch: 7 } } } },
  };
  for (const [robot_id, epoch] of [['p4', 8], ['other', 7]] as const) {
    recordEnvironmentBridgeTelemetry({ sessionId: 'boot-session', robotId: robot_id,
      robotStatus: { kind: 'robot.status', robot_id, epoch, camera_ready: true } });
    const result = await environmentBridgeInputNode.execute({}, { environmentObservation: observation }, {});
    assert.deepEqual(result.observation.capabilities.actions, ['robotCommand']);
    assert.equal(result.observation.state.body.cameraReady, false);
  }
});

test('disconnected camera availability stays separate from retained diagnostics and independent images', async () => {
  const observation: EnvironmentObservation = {
    environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'disconnected-camera',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['sendText'], visual: false },
    state: { body: { authenticated: false, robotId: null, cameraReady: false }, gateway: { robots: {} } },
  };
  const historicalStatus = { kind: 'robot.status', robot_id: 'p4', epoch: 7, camera_ready: true };
  for (let flush = 0; flush < 2; flush++) {
    recordEnvironmentBridgeTelemetry({ sessionId: observation.sessionId, robotId: 'p4', robotStatus: historicalStatus });
    const result = await environmentBridgeInputNode.execute({}, { environmentObservation: observation }, {});
    assert.equal(result.bodyAuthenticated, false);
    assert.equal(result.cameraReady, false);
    assert.equal(result.observation.state.body.cameraReady, false);
    assert.equal(result.capabilities.visual, false);
    assert.deepEqual(result.capabilities.actions, ['sendText']);
    assert.deepEqual(result.diagnostics.robotStatus, historicalStatus, 'Historical diagnostics stay available');
    assert.deepEqual(result.bodyStatus, historicalStatus);
  }

  const independentCamera: EnvironmentObservation = { ...observation,
    capabilities: { actions: ['sendText', 'captureImage'], visual: true },
    visual: { id: 'independent-frame', timestamp: observation.timestamp, mimeType: 'image/jpeg', source: 'independent-camera' },
  };
  const independent = await environmentBridgeInputNode.execute({}, { environmentObservation: independentCamera }, {});
  assert.equal(independent.cameraReady, false, 'The disconnected body camera remains unavailable');
  assert.equal(independent.capabilities.visual, true, 'The independent camera remains available');
  assert.deepEqual(independent.capabilities.actions, ['sendText', 'captureImage']);
  assert.deepEqual(independent.visual, independentCamera.visual);

  const reconnected: EnvironmentObservation = { ...observation,
    state: { body: { authenticated: true, robotId: 'p4', cameraReady: false },
      gateway: { robots: { p4: { epoch: 8, status: { camera_ready: false } } } } },
  };
  const oldEpoch = await environmentBridgeInputNode.execute({}, { environmentObservation: reconnected }, {});
  assert.equal(oldEpoch.cameraReady, false, 'Prior-epoch diagnostics cannot override projected camera status');
  recordEnvironmentBridgeTelemetry({ sessionId: observation.sessionId, robotId: 'p4',
    robotStatus: { ...historicalStatus, epoch: 8 } });
  const currentEpoch = await environmentBridgeInputNode.execute({}, { environmentObservation: reconnected }, {});
  assert.equal(currentEpoch.cameraReady, true);
  assert.equal(currentEpoch.capabilities.visual, true);
  assert.deepEqual(currentEpoch.capabilities.actions, ['sendText', 'captureImage']);
});
