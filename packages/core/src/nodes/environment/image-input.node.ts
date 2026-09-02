import { defineNode } from '../types.js';
import {
  validEnvironmentJpegDataUrl,
  type EnvironmentFeedback,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import type { EnvironmentTaskState } from './helpers.js';

const MAX_CACHED_FRAMES = 24;
const frameCache = new Map<string, EnvironmentVisualFrame>();

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

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function rememberFrames(frames: EnvironmentVisualFrame[]): void {
  for (const frame of frames) {
    if (!frame.id || !validEnvironmentJpegDataUrl(frame.dataUrl)) continue;
    frameCache.delete(frame.id);
    frameCache.set(frame.id, frame);
  }
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const oldest = frameCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    frameCache.delete(oldest);
  }
}

export function clearEnvironmentImageFrameCache(): void {
  frameCache.clear();
}

export const environmentImageInputNode = defineNode({
  id: 'environment_image_input',
  name: 'Environment Image Input',
  category: 'environment',
  inputs: [
    { name: 'visual', type: 'object', optional: true, description: 'Latest visual frame' },
    { name: 'visuals', type: 'array', optional: true, description: 'Visual frame list' },
    { name: 'taskState', type: 'object', optional: true, description: 'Environment task containing an optional baseline-frame reference' },
    { name: 'terminalFeedback', type: 'object', optional: true, description: 'Exact terminal feedback from Environment Feedback Correlator' },
    { name: 'actionId', type: 'string', optional: true, description: 'Verified Work Coordinator action identifier' },
    { name: 'correlationId', type: 'string', optional: true, description: 'Verified Work Coordinator correlation identifier' },
  ],
  outputs: [
    { name: 'images', type: 'array', description: 'Validated image content parts for an image-capable model' },
    { name: 'frames', type: 'array', description: 'Accepted visual frame metadata' },
    { name: 'rejectedCount', type: 'number', description: 'Frames rejected by format or size validation' },
  ],
  description: 'Validates bridge camera frames and returns one current frame or an ordered baseline/current pair for the reported action.',
  async execute(inputs) {
    const candidates = framesFromInputs(inputs.visual, inputs.visuals);
    const valid = candidates.filter(frame => validEnvironmentJpegDataUrl(frame.dataUrl));
    rememberFrames(valid);
    const taskState = isRecord(inputs.taskState)
      ? inputs.taskState as unknown as EnvironmentTaskState
      : null;
    const terminalFeedback = isRecord(inputs.terminalFeedback)
      ? inputs.terminalFeedback as unknown as EnvironmentFeedback
      : null;
    const actionId = cleanText(inputs.actionId);
    const correlationId = cleanText(inputs.correlationId);
    const baseline = terminalFeedback && taskState?.baselineFrame
      ? frameCache.get(taskState.baselineFrame.id)
      : undefined;
    const current = terminalFeedback
      ? [...valid].reverse().find(frame => {
          const frameActionId = cleanText(frame.metadata?.actionId);
          const frameCorrelationId = cleanText(frame.metadata?.correlationId);
          return Boolean(
            (actionId && frameActionId === actionId)
            || (correlationId && frameCorrelationId === correlationId)
          );
        })
      : valid[0];
    const accepted = [baseline, current]
      .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
      .filter((frame, index, frames) => frames.findIndex(candidate => candidate.id === frame.id) === index);
    return {
      images: accepted.map(frame => ({
        type: 'image_url',
        image_url: { url: frame.dataUrl! },
      })),
      frames: accepted,
      rejectedCount: candidates.length - valid.length,
    };
  },
});
