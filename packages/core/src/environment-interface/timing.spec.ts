import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachEnvironmentObservationTiming,
  environmentActionStageDurations,
  mergeEnvironmentActionTiming,
} from './timing.js';

test('merges owner timestamps and reports only measurable stage durations', () => {
  const timing = mergeEnvironmentActionTiming(
    {
      queueEnteredAt: '2026-08-04T12:00:00.000Z',
      leaseGrantedAt: '2026-08-04T12:00:00.025Z',
      bridgeActionSentAt: '2026-08-04T12:00:00.040Z',
    },
    {
      adapterActionReceivedAt: '2026-08-04T12:00:00.050Z',
      captureStartedAt: '2026-08-04T12:00:00.060Z',
      frameReadyAt: '2026-08-04T12:00:00.160Z',
      bridgeFrameReceivedAt: '2026-08-04T12:00:00.175Z',
    },
  );
  assert.deepEqual(environmentActionStageDurations(timing), {
    queueToLeaseMs: 25,
    leaseToBridgeMs: 15,
    bridgeToAdapterMs: 10,
    adapterToCaptureMs: 10,
    captureToFrameMs: 100,
    frameToBridgeMs: 15,
  });
});

test('attaches frame and Core receipt timing without inventing adapter-owned stages', () => {
  const observation = attachEnvironmentObservationTiming({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T12:00:00.200Z',
    capabilities: { actions: ['captureImage'], visual: true },
    visual: {
      id: 'frame-1',
      timestamp: '2026-08-04T12:00:00.160Z',
      metadata: {
        actionTiming: {
          captureStartedAt: '2026-08-04T12:00:00.060Z',
        },
      },
    },
  }, {
    bridgeFrameReceivedAt: '2026-08-04T12:00:00.175Z',
    coreObservationReceivedAt: '2026-08-04T12:00:00.200Z',
  });

  assert.equal(
    (observation.metadata?.actionTiming as Record<string, unknown>).frameReadyAt,
    '2026-08-04T12:00:00.160Z',
  );
  assert.deepEqual(observation.metadata?.actionStageDurations, {
    captureToFrameMs: 100,
    frameToBridgeMs: 15,
    bridgeFrameToCoreObservationMs: 25,
  });
  assert.equal(
    (observation.visual?.metadata?.actionTiming as Record<string, unknown>).coreObservationReceivedAt,
    '2026-08-04T12:00:00.200Z',
  );
});

test('owner-recorded frame readiness takes precedence over the visual timestamp fallback', () => {
  const observation = attachEnvironmentObservationTiming({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T12:00:00.200Z',
    capabilities: { actions: ['captureImage'], visual: true },
    visual: {
      id: 'frame-1',
      timestamp: '2026-08-04T12:00:00.160Z',
      metadata: {
        actionTiming: {
          captureStartedAt: '2026-08-04T12:00:00.060Z',
          frameReadyAt: '2026-08-04T12:00:00.150Z',
        },
      },
    },
  }, {
    frameReadyAt: '2026-08-04T12:00:00.155Z',
  });

  assert.equal(
    (observation.metadata?.actionTiming as Record<string, unknown>).frameReadyAt,
    '2026-08-04T12:00:00.155Z',
  );
  assert.equal(
    (observation.visual?.metadata?.actionTiming as Record<string, unknown>).frameReadyAt,
    '2026-08-04T12:00:00.155Z',
  );
});
