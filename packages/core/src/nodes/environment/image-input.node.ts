import { defineNode } from '../types.js';
import {
  validEnvironmentJpegDataUrl,
  type EnvironmentFeedback,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import type { RobotStatusTask } from '../../robot-status.js';

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
  name: 'Select Camera Frames for Current Action',
  category: 'environment',
  inputs: [
    { name: 'visual', label: 'Current camera frame', type: 'object', optional: true, description: 'The latest camera frame received from the robot bridge.' },
    { name: 'visuals', label: 'Camera frame list', type: 'array', optional: true, description: 'Other camera frames included in the current robot observation.' },
    { name: 'observationCurrent', label: 'Current-run observation', type: 'boolean', optional: true, description: 'Whether these frames arrived with the observation that triggered this graph run. Omit only in workflows whose input is already current by contract.' },
    { name: 'robotStatus', label: 'Saved robot status', type: 'object', optional: true, description: 'Robot Status containing the current task and an optional saved before-action frame.' },
    { name: 'terminalFeedback', label: 'Finished robot result', type: 'object', optional: true, description: 'The finished robot report selected for the sent action.' },
    { name: 'actionId', label: 'Sent action ID', type: 'string', optional: true, description: 'The verified ID of the sent action whose camera frame is returning.' },
    { name: 'correlationId', label: 'Action cycle ID', type: 'string', optional: true, description: 'The verified cycle ID used to match a returned camera frame.' },
  ],
  outputs: [
    { name: 'images', label: 'Images for the model', type: 'array', description: 'The selected camera frames formatted for an image-capable model.' },
    { name: 'frames', label: 'Selected camera frames', type: 'array', description: 'Metadata for the camera frames this node selected.' },
    { name: 'rejectedCount', label: 'Rejected frames', type: 'number', description: 'Number of frames rejected because they were not valid supported JPEG data.' },
    { name: 'current', label: 'Current evidence available', type: 'boolean', description: 'Whether at least one selected frame belongs to this graph run.' },
  ],
  presentation: {
    badges: [
      { label: 'Checks camera frames', tone: 'info' },
      { label: 'No model', tone: 'neutral' },
      { label: 'Sends nothing', tone: 'neutral' },
    ],
    statusTitle: 'Last frame selection',
    statusFields: [
      { output: 'rejectedCount', label: 'Rejected' },
    ],
  },
  description: 'Checks camera frames received from the robot. For a new observation, it returns the current valid frame. After an action finishes, it can return the saved before-action frame and the current frame tagged with the same action or cycle ID. It sends no command, changes no status, and calls no model.',
  async execute(inputs) {
    const candidates = framesFromInputs(inputs.visual, inputs.visuals);
    const valid = candidates.filter(frame => validEnvironmentJpegDataUrl(frame.dataUrl));
    const observationCurrent = inputs.observationCurrent !== false;
    if (observationCurrent) rememberFrames(valid);
    const status = isRecord(inputs.robotStatus) ? inputs.robotStatus : null;
    const task = isRecord(status?.task)
      ? status.task as unknown as RobotStatusTask
      : null;
    const terminalFeedback = isRecord(inputs.terminalFeedback)
      ? inputs.terminalFeedback as unknown as EnvironmentFeedback
      : null;
    const actionId = cleanText(inputs.actionId);
    const correlationId = cleanText(inputs.correlationId);
    const baseline = terminalFeedback && task?.baselineFrame
      ? frameCache.get(task.baselineFrame.id)
      : undefined;
    const current = observationCurrent && terminalFeedback
      ? [...valid].reverse().find(frame => {
          const frameActionId = cleanText(frame.metadata?.actionId);
          const frameCorrelationId = cleanText(frame.metadata?.correlationId);
          return Boolean(
            (actionId && frameActionId === actionId)
            || (correlationId && frameCorrelationId === correlationId)
          );
        })
      : observationCurrent ? valid[0] : undefined;
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
      current: Boolean(current),
    };
  },
});
