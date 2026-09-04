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
