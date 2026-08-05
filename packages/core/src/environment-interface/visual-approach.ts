import type {
  EnvironmentNormalizedBox,
  EnvironmentActiveViewProgress,
  EnvironmentActiveViewSkill,
  EnvironmentActiveViewStatus,
  EnvironmentVisualInspectionTarget,
  EnvironmentVisualTargetSpecification,
} from './types.js';

export const ENVIRONMENT_ACTIVE_VIEW_SKILLS = [
  'inspect',
  'visualApproach',
] as const satisfies readonly EnvironmentActiveViewSkill[];

export const ENVIRONMENT_ACTIVE_VIEW_ACTIVE_STATUSES = [
  'acquiring',
  'tracking',
  'improving_view',
  'reacquiring',
  'verifying',
  'progress',
] as const satisfies readonly EnvironmentActiveViewStatus[];

export const ENVIRONMENT_ACTIVE_VIEW_TERMINAL_STATUSES = [
  'reached',
  'lost',
  'blocked',
  'stuck',
  'stopped',
  'failed',
] as const satisfies readonly EnvironmentActiveViewStatus[];

const ACTIVE_VIEW_SKILLS = new Set<EnvironmentActiveViewSkill>(ENVIRONMENT_ACTIVE_VIEW_SKILLS);
const PROGRESS_STATUSES = new Set<EnvironmentActiveViewStatus>([
  ...ENVIRONMENT_ACTIVE_VIEW_ACTIVE_STATUSES,
  ...ENVIRONMENT_ACTIVE_VIEW_TERMINAL_STATUSES,
]);

const TERMINAL_PROGRESS_STATUSES = new Set<EnvironmentActiveViewStatus>(
  ENVIRONMENT_ACTIVE_VIEW_TERMINAL_STATUSES,
);

/**
 * Active perception owns acquisition and recovery. The graph may reduce a
 * final adapter result, but it must not mistake an in-skill controller phase
 * for a reason to terminate or launch a new LLM attempt.
 */
export function isEnvironmentActiveViewTerminalStatus(
  status: EnvironmentActiveViewStatus,
): boolean {
  return TERMINAL_PROGRESS_STATUSES.has(status);
}

function record(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

function normalizedNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite normalized number from 0 to 1`);
  }
  return value;
}

export function normalizeEnvironmentTargetBox(value: unknown): EnvironmentNormalizedBox {
  const box = record(value);
  if (!box) throw new Error('visual target requires a normalized box');
  const x = normalizedNumber(box.x, 'visual target box x');
  const y = normalizedNumber(box.y, 'visual target box y');
  const width = normalizedNumber(box.width, 'visual target box width');
  const height = normalizedNumber(box.height, 'visual target box height');
  if (width < 0.01 || height < 0.01 || x + width > 1.000001 || y + height > 1.000001) {
    throw new Error('visual target box must have visible area within the frame');
  }
  return { x, y, width, height };
}

export function normalizeEnvironmentVisualTarget(
  value: unknown,
): EnvironmentVisualTargetSpecification {
  const target = record(value);
  if (!target) throw new Error('visualApproach requires visualTarget');
  const targetId = boundedText(target.targetId, 120);
  const frameId = boundedText(target.frameId, 160);
  const frameTimestamp = boundedText(target.frameTimestamp, 64);
  if (!targetId || !frameId || !Number.isFinite(Date.parse(frameTimestamp))) {
    throw new Error('visual target requires targetId, frameId, and frameTimestamp');
  }
  const confidence = normalizedNumber(target.confidence, 'visual target confidence');
  const description = boundedText(target.description, 240);
  const stopBoxHeight = target.stopBoxHeight === undefined
    ? undefined
    : normalizedNumber(target.stopBoxHeight, 'visual target stopBoxHeight');
  if (stopBoxHeight !== undefined && stopBoxHeight < 0.05) {
    throw new Error('visual target stopBoxHeight must be at least 0.05');
  }
  return {
    version: 1,
    targetId,
    frameId,
    frameTimestamp: new Date(frameTimestamp).toISOString(),
    box: normalizeEnvironmentTargetBox(target.box),
    confidence,
    ...(description ? { description } : {}),
    ...(stopBoxHeight !== undefined ? { stopBoxHeight } : {}),
  };
}

export function normalizeEnvironmentVisualInspectionTarget(
  value: unknown,
): EnvironmentVisualInspectionTarget {
  const target = record(value);
  if (!target) throw new Error('inspect requires inspectionTarget');
  const targetId = boundedText(target.targetId, 120);
  const frameId = boundedText(target.frameId, 160);
  const frameTimestamp = boundedText(target.frameTimestamp, 64);
  const query = boundedText(target.query, 240);
  if (!targetId || !frameId || !Number.isFinite(Date.parse(frameTimestamp)) || !query) {
    throw new Error('inspection target requires targetId, frameId, frameTimestamp, and query');
  }
  const hasSeedBox = target.seedBox !== undefined;
  const hasSeedConfidence = target.seedConfidence !== undefined;
  if (hasSeedBox !== hasSeedConfidence) {
    throw new Error('inspection target seedBox and seedConfidence must be provided together');
  }
  return {
    version: 1,
    targetId,
    frameId,
    frameTimestamp: new Date(frameTimestamp).toISOString(),
    query,
    ...(hasSeedBox ? { seedBox: normalizeEnvironmentTargetBox(target.seedBox) } : {}),
    ...(hasSeedConfidence
      ? { seedConfidence: normalizedNumber(target.seedConfidence, 'inspection target seedConfidence') }
      : {}),
  };
}

export function normalizeEnvironmentActiveViewProgress(
  value: unknown,
): EnvironmentActiveViewProgress | null {
  const result = record(value);
  if (
    !result
    || !ACTIVE_VIEW_SKILLS.has(result.skill as EnvironmentActiveViewSkill)
    || !PROGRESS_STATUSES.has(result.status as EnvironmentActiveViewStatus)
  ) return null;
  const targetId = boundedText(result.targetId, 120);
  const frameId = boundedText(result.frameId, 160);
  const timestamp = boundedText(result.timestamp, 64);
  const reason = boundedText(result.reason, 240);
  if (
    !targetId
    || !frameId
    || !Number.isFinite(Date.parse(timestamp))
    || !Number.isInteger(result.step)
    || Number(result.step) < 0
    || Number(result.step) > 100
  ) return null;
  try {
    return {
      version: 1,
      skill: result.skill as EnvironmentActiveViewSkill,
      targetId,
      frameId,
      timestamp: new Date(timestamp).toISOString(),
      status: result.status as EnvironmentActiveViewStatus,
      step: Number(result.step),
      confidence: normalizedNumber(result.confidence, 'visual approach confidence'),
      progress: normalizedNumber(result.progress, 'visual approach progress'),
      ...(result.box ? { box: normalizeEnvironmentTargetBox(result.box) } : {}),
      ...(result.pathConfidence === undefined
        ? {}
        : { pathConfidence: normalizedNumber(result.pathConfidence, 'visual approach path confidence') }),
      ...(result.obstruction === undefined
        ? {}
        : { obstruction: normalizedNumber(result.obstruction, 'visual approach obstruction') }),
      reason,
    };
  } catch {
    return null;
  }
}
