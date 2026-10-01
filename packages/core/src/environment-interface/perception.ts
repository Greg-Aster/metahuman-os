import type { EnvironmentObservation, EnvironmentNormalizedBox } from './types.js';

/** Recognition estimates tied to one host-received frame, not physical proof. */
export interface EnvironmentPerception {
  version: 1;
  robotId: string;
  epoch: number;
  gatewayInstance: string;
  frameCounter: number;
  timeBasis: 'gateway_receipt';
  observedAt: string;
  expiresAt: string;
  backend: string;
  model: string;
  summary: string;
  objects: Array<{ label: string; score?: number; box?: EnvironmentNormalizedBox }>;
  uncertainties: string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number, empty = false): string {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) {
    throw new Error(`${label} requires bounded text`);
  }
  return value.trim();
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its integer range`);
  }
  return value;
}

function unit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('recognition score and coordinates must be finite numbers from 0 to 1');
  }
  return value;
}

export function normalizeEnvironmentPerception(value: unknown): EnvironmentPerception {
  const item = record(value, 'perception');
  const fields = ['version', 'robotId', 'epoch', 'gatewayInstance', 'frameCounter', 'timeBasis',
    'observedAt', 'expiresAt', 'backend', 'model', 'summary', 'objects', 'uncertainties'];
  if (Object.keys(item).length !== fields.length || Object.keys(item).some(key => !fields.includes(key))
    || item.version !== 1 || item.timeBasis !== 'gateway_receipt') {
    throw new Error('unsupported perception contract');
  }
  const observedAt = Date.parse(text(item.observedAt, 'observedAt', 64));
  const expiresAt = Date.parse(text(item.expiresAt, 'expiresAt', 64));
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt)
    || expiresAt <= observedAt || expiresAt - observedAt > 30_000) {
    throw new Error('perception requires a receipt-based validity window of at most 30 seconds');
  }
  if (!Array.isArray(item.objects) || item.objects.length > 32
    || !Array.isArray(item.uncertainties) || item.uncertainties.length > 8) {
    throw new Error('perception lists exceed their limits');
  }
  const objects = item.objects.map(value => {
    const object = record(value, 'recognized object');
    if (Object.keys(object).some(key => !['label', 'score', 'box'].includes(key))) {
      throw new Error('recognized object contains unsupported fields');
    }
    const label = text(object.label, 'object label', 80);
    let box: EnvironmentNormalizedBox | undefined;
    if (object.box !== undefined) {
      const bounds = record(object.box, 'object box');
      if (Object.keys(bounds).length !== 4 || Object.keys(bounds).some(key => !['x', 'y', 'width', 'height'].includes(key))) {
        throw new Error('object box requires normalized x, y, width and height');
      }
      box = { x: unit(bounds.x), y: unit(bounds.y), width: unit(bounds.width), height: unit(bounds.height) };
      if (box.width <= 0 || box.height <= 0 || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) {
        throw new Error('object box must have visible area within the frame');
      }
    }
    return { label, ...(object.score !== undefined ? { score: unit(object.score) } : {}), ...(box ? { box } : {}) };
  });
  return {
    version: 1, timeBasis: 'gateway_receipt', robotId: text(item.robotId, 'robotId', 160),
    epoch: integer(item.epoch, 'epoch', 1, Number.MAX_SAFE_INTEGER),
    gatewayInstance: text(item.gatewayInstance, 'gatewayInstance', 160),
    frameCounter: integer(item.frameCounter, 'frameCounter', 0, 0xffffffff),
    observedAt: new Date(observedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    backend: text(item.backend, 'backend', 80), model: text(item.model, 'model', 160),
    summary: text(item.summary, 'summary', 1000, true), objects,
    uncertainties: item.uncertainties.map(value => text(value, 'uncertainty', 240)),
  };
}

/** Camera readiness and control identity come from the adapter, never the model. */
export function currentEnvironmentPerception(
  observation: EnvironmentObservation | undefined,
  value: unknown = observation?.state?.perception,
  now = Date.now(),
): EnvironmentPerception | null {
  if (value === undefined || value === null) return null;
  const perception = normalizeEnvironmentPerception(value);
  const body = observation?.state?.body as Record<string, unknown> | undefined;
  const gateway = observation?.state?.gateway as { robots?: Record<string, Record<string, unknown>> } | undefined;
  const updates = observation?.state?.activeMovementUpdates as Record<string, unknown> | undefined;
  const robot = gateway?.robots?.[perception.robotId];
  return body?.authenticated === true && body.cameraReady === true && body.robotId === perception.robotId
    && updates?.gatewayInstance === perception.gatewayInstance && robot?.epoch === perception.epoch
    && robot.connection_state === 'online' && Date.parse(perception.observedAt) <= now
    && now < Date.parse(perception.expiresAt) ? perception : null;
}

/** Filter the live read view without changing saved observations or their images. */
export function projectCurrentEnvironmentPerception(
  observation: EnvironmentObservation,
  value: unknown = observation.state?.perception,
): EnvironmentObservation {
  if (observation.state?.perception === undefined && (value === undefined || value === null)) return observation;
  const perception = currentEnvironmentPerception(observation, value);
  const state = { ...observation.state };
  delete state.perception;
  if (perception) state.perception = perception;
  return { ...observation, state };
}
