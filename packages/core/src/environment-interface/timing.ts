import type {
  EnvironmentActionStageDurations,
  EnvironmentActionTiming,
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from './types.js';

const TIMING_KEYS = [
  'queueEnteredAt',
  'leaseGrantedAt',
  'bridgeActionSentAt',
  'adapterActionReceivedAt',
  'captureStartedAt',
  'frameReadyAt',
  'adapterFeedbackSentAt',
  'bridgeFeedbackReceivedAt',
  'coreFeedbackReceivedAt',
  'bridgeFrameReceivedAt',
  'coreObservationReceivedAt',
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function normalizeEnvironmentActionTiming(value: unknown): EnvironmentActionTiming {
  const source = record(value);
  const timing: EnvironmentActionTiming = { version: 1 };
  if (!source) return timing;
  for (const key of TIMING_KEYS) {
    const timestamp = iso(source[key]);
    if (timestamp) timing[key] = timestamp;
  }
  return timing;
}

export function mergeEnvironmentActionTiming(
  ...values: unknown[]
): EnvironmentActionTiming {
  return values.reduce<EnvironmentActionTiming>((merged, value) => ({
    ...merged,
    ...normalizeEnvironmentActionTiming(value),
    version: 1,
  }), { version: 1 });
}

function elapsed(
  timing: EnvironmentActionTiming,
  start: keyof EnvironmentActionTiming,
  end: keyof EnvironmentActionTiming,
): number | undefined {
  const startValue = timing[start];
  const endValue = timing[end];
  if (typeof startValue !== 'string' || typeof endValue !== 'string') return undefined;
  const duration = Date.parse(endValue) - Date.parse(startValue);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function environmentActionStageDurations(
  value: unknown,
): EnvironmentActionStageDurations {
  const timing = normalizeEnvironmentActionTiming(value);
  return Object.fromEntries(Object.entries({
    queueToLeaseMs: elapsed(timing, 'queueEnteredAt', 'leaseGrantedAt'),
    leaseToBridgeMs: elapsed(timing, 'leaseGrantedAt', 'bridgeActionSentAt'),
    bridgeToAdapterMs: elapsed(timing, 'bridgeActionSentAt', 'adapterActionReceivedAt'),
    adapterToCaptureMs: elapsed(timing, 'adapterActionReceivedAt', 'captureStartedAt'),
    captureToFrameMs: elapsed(timing, 'captureStartedAt', 'frameReadyAt'),
    frameToBridgeMs: elapsed(timing, 'frameReadyAt', 'bridgeFrameReceivedAt'),
    adapterFeedbackToBridgeMs: elapsed(timing, 'adapterFeedbackSentAt', 'bridgeFeedbackReceivedAt'),
    bridgeToCoreFeedbackMs: elapsed(timing, 'bridgeFeedbackReceivedAt', 'coreFeedbackReceivedAt'),
    bridgeFrameToCoreObservationMs: elapsed(timing, 'bridgeFrameReceivedAt', 'coreObservationReceivedAt'),
  }).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) as EnvironmentActionStageDurations;
}

function visualWithTiming(
  visual: EnvironmentVisualFrame | undefined,
  timing: EnvironmentActionTiming,
): EnvironmentVisualFrame | undefined {
  if (!visual) return undefined;
  const metadata = record(visual.metadata) ?? {};
  // A visual timestamp is the portable fallback. Adapter/Bridge timing is
  // owner-recorded and must win when it is present.
  const merged = mergeEnvironmentActionTiming(
    { frameReadyAt: visual.timestamp },
    metadata.actionTiming,
    timing,
  );
  return {
    ...visual,
    metadata: {
      ...metadata,
      actionTiming: merged,
      actionStageDurations: environmentActionStageDurations(merged),
    },
  };
}

export function attachEnvironmentObservationTiming(
  observation: EnvironmentObservation,
  value: unknown,
): EnvironmentObservation {
  const metadata = record(observation.metadata) ?? {};
  const visualTiming = record(observation.visual?.metadata)?.actionTiming
    ?? observation.visuals?.map(frame => record(frame.metadata)?.actionTiming).find(Boolean);
  const firstVisualTimestamp = observation.visual?.timestamp
    ?? observation.visuals?.[0]?.timestamp;
  const timing = mergeEnvironmentActionTiming(
    firstVisualTimestamp ? { frameReadyAt: firstVisualTimestamp } : null,
    metadata.actionTiming,
    visualTiming,
    value,
  );
  return {
    ...observation,
    ...(observation.visual ? { visual: visualWithTiming(observation.visual, timing) } : {}),
    ...(observation.visuals
      ? { visuals: observation.visuals.map(frame => visualWithTiming(frame, timing)!) }
      : {}),
    metadata: {
      ...metadata,
      actionTiming: timing,
      actionStageDurations: environmentActionStageDurations(timing),
    },
  };
}
