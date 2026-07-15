import { defineNode } from '../types.js';
import type { EnvironmentVisualFrame } from '../../environment-interface/index.js';

const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_JPEG_BYTES = 120 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function framesFromInputs(visual: unknown, visuals: unknown): EnvironmentVisualFrame[] {
  const frames: EnvironmentVisualFrame[] = [];
  if (isRecord(visual)) frames.push(visual as unknown as EnvironmentVisualFrame);
  if (Array.isArray(visuals)) {
    frames.push(...visuals.filter(isRecord).map(frame => frame as unknown as EnvironmentVisualFrame));
  }
  const seen = new Set<string>();
  return frames.filter(frame => {
    const key = frame.id || frame.dataUrl || frame.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validJpegDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(JPEG_PREFIX)) return false;
  const encoded = value.slice(JPEG_PREFIX.length);
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((encoded.length * 3) / 4) - padding;
  return bytes > 0 && bytes <= MAX_JPEG_BYTES;
}

export const environmentImageInputNode = defineNode({
  id: 'environment_image_input',
  name: 'Environment Image Input',
  category: 'environment',
  inputs: [
    { name: 'visual', type: 'object', optional: true, description: 'Latest visual frame' },
    { name: 'visuals', type: 'array', optional: true, description: 'Visual frame list' },
  ],
  outputs: [
    { name: 'images', type: 'array', description: 'Validated image content parts for an image-capable model' },
    { name: 'frames', type: 'array', description: 'Accepted visual frame metadata' },
    { name: 'rejectedCount', type: 'number', description: 'Frames rejected by format or size validation' },
  ],
  description: 'Validates a bounded JPEG still and converts it to OpenAI-compatible image content.',
  async execute(inputs) {
    const candidates = framesFromInputs(inputs.visual, inputs.visuals);
    const accepted = candidates.filter(frame => validJpegDataUrl(frame.dataUrl)).slice(0, 1);
    return {
      images: accepted.map(frame => ({
        type: 'image_url',
        image_url: { url: frame.dataUrl! },
      })),
      frames: accepted,
      rejectedCount: candidates.length - accepted.length,
    };
  },
});
