import type {
  EnvironmentMotionPlanFrame,
  EnvironmentMotionPlanJoint,
} from './types.js';

export const ENVIRONMENT_MOTION_PLAN_JOINTS = [
  'R1', 'R2', 'L1', 'L2', 'R4', 'R3', 'L3', 'L4',
] as const satisfies readonly EnvironmentMotionPlanJoint[];

export const ENVIRONMENT_MOTION_PLAN_LIMITS = Object.freeze({
  minFrames: 1,
  maxFrames: 32,
  minFrameDurationMs: 100,
  maxFrameDurationMs: 5_000,
  maxTotalDurationMs: 10_000,
  minDegrees: 0,
  maxDegrees: 180,
  maxEncodedBytes: 32 * 1024,
});

export const ENVIRONMENT_MOTION_PLAN_END_POSES = [
  'hold', 'stand', 'neutral',
] as const;

const jointNames = new Set<string>(ENVIRONMENT_MOTION_PLAN_JOINTS);
const endPoses = new Set<string>(ENVIRONMENT_MOTION_PLAN_END_POSES);

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unknown.join(', ')}`);
  }
}

function normalizeTarget(value: unknown, frameIndex: number): {
  joint: EnvironmentMotionPlanJoint;
  degrees: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Motion-plan frame ${frameIndex + 1} contains an invalid target`);
  }
  const target = value as Record<string, unknown>;
  exactKeys(target, ['joint', 'degrees'], `Motion-plan frame ${frameIndex + 1} target`);
  if (typeof target.joint !== 'string' || !jointNames.has(target.joint)) {
    throw new Error(`Motion-plan frame ${frameIndex + 1} contains an unknown joint`);
  }
  if (typeof target.degrees !== 'number' || !Number.isFinite(target.degrees)) {
    throw new Error(`Motion-plan frame ${frameIndex + 1} joint ${target.joint} requires finite degrees`);
  }
  const centidegrees = target.degrees * 100;
  if (!Number.isInteger(centidegrees)) {
    throw new Error(`Motion-plan frame ${frameIndex + 1} joint ${target.joint} supports at most two decimal places`);
  }
  if (
    target.degrees < ENVIRONMENT_MOTION_PLAN_LIMITS.minDegrees
    || target.degrees > ENVIRONMENT_MOTION_PLAN_LIMITS.maxDegrees
  ) {
    throw new Error(`Motion-plan frame ${frameIndex + 1} joint ${target.joint} is outside 0..180 degrees`);
  }
  return {
    joint: target.joint as EnvironmentMotionPlanJoint,
    degrees: target.degrees,
  };
}

export function normalizeEnvironmentMotionPlanFields(value: unknown): {
  frames: EnvironmentMotionPlanFrame[];
  endPose: 'hold' | 'stand' | 'neutral';
  totalDurationMs: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Motion plan must be an object');
  }
  const plan = value as Record<string, unknown>;
  if (
    !Array.isArray(plan.frames)
    || plan.frames.length < ENVIRONMENT_MOTION_PLAN_LIMITS.minFrames
    || plan.frames.length > ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrames
  ) {
    throw new Error('Motion plan requires 1..32 frames');
  }

  let totalDurationMs = 0;
  const frames = plan.frames.map((value, frameIndex): EnvironmentMotionPlanFrame => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Motion-plan frame ${frameIndex + 1} must be an object`);
    }
    const frame = value as Record<string, unknown>;
    exactKeys(frame, ['durationMs', 'targets'], `Motion-plan frame ${frameIndex + 1}`);
    if (
      !Number.isInteger(frame.durationMs)
      || (frame.durationMs as number) < ENVIRONMENT_MOTION_PLAN_LIMITS.minFrameDurationMs
      || (frame.durationMs as number) > ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrameDurationMs
    ) {
      throw new Error(`Motion-plan frame ${frameIndex + 1} duration must be an integer from 100..5000 ms`);
    }
    if (!Array.isArray(frame.targets) || frame.targets.length !== ENVIRONMENT_MOTION_PLAN_JOINTS.length) {
      throw new Error(`Motion-plan frame ${frameIndex + 1} requires exactly eight targets`);
    }
    const targets = frame.targets.map(target => normalizeTarget(target, frameIndex));
    const found = new Set(targets.map(target => target.joint));
    if (
      found.size !== ENVIRONMENT_MOTION_PLAN_JOINTS.length
      || ENVIRONMENT_MOTION_PLAN_JOINTS.some(joint => !found.has(joint))
    ) {
      throw new Error(`Motion-plan frame ${frameIndex + 1} requires every logical joint exactly once`);
    }
    totalDurationMs += frame.durationMs as number;
    if (totalDurationMs > ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs) {
      throw new Error('Motion-plan total duration exceeds 10000 ms');
    }
    return { durationMs: frame.durationMs as number, targets };
  });

  const endPose = plan.endPose === undefined ? 'hold' : plan.endPose;
  if (typeof endPose !== 'string' || !endPoses.has(endPose)) {
    throw new Error('Motion-plan endPose must be hold, stand, or neutral');
  }
  return {
    frames,
    endPose: endPose as 'hold' | 'stand' | 'neutral',
    totalDurationMs,
  };
}

export function assertBoundedMotionPlanEncoding(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > ENVIRONMENT_MOTION_PLAN_LIMITS.maxEncodedBytes) {
    throw new Error('Motion plan exceeds the MetaHuman action size limit');
  }
}
