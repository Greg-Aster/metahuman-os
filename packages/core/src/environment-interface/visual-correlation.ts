import { Buffer } from 'node:buffer';
import type { EnvironmentObservation, EnvironmentVisualFrame } from './types.js';

const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_JPEG_BYTES = 256 * 1024;

export function validEnvironmentJpegDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(JPEG_PREFIX)) return false;
  const encoded = value.slice(JPEG_PREFIX.length);
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) return false;
  const payload = Buffer.from(encoded, 'base64');
  if (payload.length < 6 || payload.length > MAX_JPEG_BYTES) return false;
  if (payload[0] !== 0xff || payload[1] !== 0xd8) return false;
  if (payload.at(-2) !== 0xff || payload.at(-1) !== 0xd9) return false;
  return payload.indexOf(Buffer.from([0xff, 0xda]), 2) > 1;
}

function observationVisuals(observation: EnvironmentObservation): EnvironmentVisualFrame[] {
  const visuals = [
    observation.visual,
    ...(observation.visuals ?? []),
  ].filter((frame): frame is EnvironmentVisualFrame => Boolean(frame));
  const seen = new Set<string>();
  return visuals.filter(frame => {
    const key = frame.id || frame.dataUrl || frame.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasFreshCorrelatedVisual(
  observation: EnvironmentObservation | null | undefined,
  cycleId: string,
): boolean {
  const normalizedCycleId = cycleId.trim();
  if (!observation || !normalizedCycleId) return false;
  if (observation.metadata?.correlationId !== normalizedCycleId) return false;
  return observationVisuals(observation).some(frame => (
    frame.metadata?.correlationId === normalizedCycleId
    && validEnvironmentJpegDataUrl(frame.dataUrl)
  ));
}
