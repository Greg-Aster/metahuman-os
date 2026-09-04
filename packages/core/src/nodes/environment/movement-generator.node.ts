import { callLLM } from '../../model-router.js';
import {
  ENVIRONMENT_MOTION_PLAN_JOINTS,
  ENVIRONMENT_MOTION_PLAN_LIMITS,
  ENVIRONMENT_MOTION_PLAN_END_POSES,
  assertBoundedMotionPlanEncoding,
  normalizeEnvironmentCommandedPose,
  normalizeEnvironmentMotionPlanFields,
  type EnvironmentAction,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import type { EnvironmentMovementRequest } from './helpers.js';

const COMPACT_RESULT_KEYS = ['summary', 'frames', 'endPose'] as const;
const MOTION_FRAME_KEYS = ['durationMs', ...ENVIRONMENT_MOTION_PLAN_JOINTS] as const;
const MOTION_DURATION_PATTERN = '^(?:[1-9][0-9]{2}|[1-4][0-9]{3}|5000)$';
const MOTION_DEGREES_PATTERN = '^(?:(?:[0-9]|[1-9][0-9]|1[0-7][0-9])(?:\\.[0-9]{1,2})?|180(?:\\.0{1,2})?)$';

export const AINEKIO_FREESTYLE_BODY_MODEL = Object.freeze({
  version: 1,
  body: 'physical eight-servo quadruped',
  angleUnit: 'logical degrees',
  jointMapVersion: 1,
  jointOrder: [...ENVIRONMENT_MOTION_PLAN_JOINTS],
  logicalRange: { minimum: 0, maximum: 180 },
  limbs: [
    { position: 'front-right', joints: ['R1', 'R3'], roles: ['proximal shoulder', 'distal arm'] },
    { position: 'rear-right', joints: ['R2', 'R4'], roles: ['proximal hip', 'distal lower leg'] },
    { position: 'front-left', joints: ['L1', 'L3'], roles: ['proximal shoulder', 'distal arm'] },
    { position: 'rear-left', joints: ['L2', 'L4'], roles: ['proximal hip', 'distal lower leg'] },
  ],
  mirrorPairs: [
    ['R1', 'L1'],
    ['R2', 'L2'],
    ['R3', 'L3'],
    ['R4', 'L4'],
  ],
  referencePoses: {
    standing: { R1: 135, R2: 45, L1: 45, L2: 135, R4: 0, R3: 180, L3: 0, L4: 180 },
    neutral: { R1: 90, R2: 90, L1: 90, L2: 90, R4: 90, R3: 90, L3: 90, L4: 90 },
  },
  geometry: {
    targetsAre: 'absolute logical joint angles, never deltas',
    mirroredTargetRule: 'the corresponding left/right angle is normally 180 minus its mirror',
    towardNeutral: 'moving a standing limb toward 90 folds it toward the all-neutral resting geometry',
    cameraMount: 'fixed to the body; there is no independent head or neck axis',
  },
  playback: {
    frameDurationMs: {
      minimum: ENVIRONMENT_MOTION_PLAN_LIMITS.minFrameDurationMs,
      maximum: ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrameDurationMs,
    },
    maximumFrames: ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrames,
    maximumTotalDurationMs: ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs,
    targetInterpolation: 'smoothstep',
    maximumTransitionMsWithinFrame: 300,
    remainingFrameTime: 'hold target',
  },
});

const MOTION_FRAME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...MOTION_FRAME_KEYS],
  properties: {
    durationMs: {
      type: 'string',
      pattern: MOTION_DURATION_PATTERN,
    },
    ...Object.fromEntries(ENVIRONMENT_MOTION_PLAN_JOINTS.map(joint => [joint, {
      type: 'string',
      pattern: MOTION_DEGREES_PATTERN,
    }])),
  },
} as const;

export const MOVEMENT_GENERATOR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'frames', 'endPose'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 160 },
    frames: {
      type: 'array',
      minItems: ENVIRONMENT_MOTION_PLAN_LIMITS.minFrames,
      maxItems: ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrames,
      items: MOTION_FRAME_JSON_SCHEMA,
    },
    endPose: { type: 'string', enum: [...ENVIRONMENT_MOTION_PLAN_END_POSES] },
  },
} as const;

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

function strictJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value.trim()) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Movement Generator must return one JSON object');
  }
  return parsed as Record<string, unknown>;
}

function generatedNumber(value: unknown, label: string): number {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a bounded decimal string`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite decimal string`);
  }
  return parsed;
}

export function normalizeGeneratedMotionPlan(
  value: unknown,
  sessionId: string,
  fallbackSummary = '',
): { action: Partial<EnvironmentAction>; summary: string; totalDurationMs: number } {
  if (typeof value === 'string' && Buffer.byteLength(value) > ENVIRONMENT_MOTION_PLAN_LIMITS.maxEncodedBytes) {
    throw new Error('Movement Generator output exceeds its size limit');
  }
  const result = strictJsonObject(value);
  exactKeys(result, COMPACT_RESULT_KEYS, 'Movement Generator result');
  if (!Array.isArray(result.frames)) {
    throw new Error('Movement Generator result requires frames');
  }
  const action = {
    type: 'robotMotionPlan',
    endPose: result.endPose,
    frames: result.frames.map((frame, frameIndex) => {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        throw new Error(`Movement Generator frame ${frameIndex + 1} must be one object`);
      }
      const record = frame as Record<string, unknown>;
      exactKeys(record, MOTION_FRAME_KEYS, `Movement Generator frame ${frameIndex + 1}`);
      return {
        durationMs: generatedNumber(
          record.durationMs,
          `Movement Generator frame ${frameIndex + 1} durationMs`,
        ),
        targets: ENVIRONMENT_MOTION_PLAN_JOINTS.map(joint => ({
          joint,
          degrees: generatedNumber(
            record[joint],
            `Movement Generator frame ${frameIndex + 1} joint ${joint}`,
          ),
        })),
      };
    }),
  };
  const normalized = normalizeEnvironmentMotionPlanFields(action);
  const generatedAction: Partial<EnvironmentAction> = {
    type: 'robotMotionPlan',
    sessionId,
    frames: normalized.frames,
    endPose: normalized.endPose,
  };
  assertBoundedMotionPlanEncoding(generatedAction);
  const generatedSummary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const summary = generatedSummary && generatedSummary.length <= 160
    ? generatedSummary
    : fallbackSummary.trim().slice(0, 160);
  if (!summary || summary.length > 160) {
    throw new Error('Movement Generator summary must contain 1..160 characters');
  }
  return { action: generatedAction, summary, totalDurationMs: normalized.totalDurationMs };
}

function movementRequest(value: unknown): EnvironmentMovementRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Partial<EnvironmentMovementRequest>;
  const description = typeof request.description === 'string' ? request.description.trim() : '';
  if (!description || description.length > 500 || request.motionClass !== 'body_local') return null;
  return {
    description,
    sessionId: typeof request.sessionId === 'string' ? request.sessionId : undefined,
    motionClass: 'body_local',
  };
}

function commandedPose(observation: EnvironmentObservation | undefined): {
  pose: Record<string, number>;
  basis: Record<string, unknown>;
} | undefined {
  const state = normalizeEnvironmentCommandedPose(observation?.state?.commandedPose);
  if (!state) return undefined;
  const reference = state.kind === 'reference' && (state.reference === 'stand' || state.reference === 'neutral')
    ? state.reference
    : null;
  const pose = reference
    ? AINEKIO_FREESTYLE_BODY_MODEL.referencePoses[reference === 'stand' ? 'standing' : 'neutral']
    : state.kind === 'joints' && state.joints && typeof state.joints === 'object' && !Array.isArray(state.joints)
      ? state.joints as Record<string, unknown>
      : null;
  if (!pose) return undefined;
  const normalized: Record<string, number> = {};
  for (const joint of ENVIRONMENT_MOTION_PLAN_JOINTS) {
    const degrees = pose[joint];
    if (typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees < 0 || degrees > 180) return undefined;
    normalized[joint] = degrees;
  }
  return {
    pose: normalized,
    basis: {
      kind: state.kind,
      ...(reference ? { reference } : {}),
      ...(typeof state.sourceActionId === 'string' ? { sourceActionId: state.sourceActionId } : {}),
      ...(typeof state.updatedAt === 'string' ? { updatedAt: state.updatedAt } : {}),
    },
  };
}

export function movementGeneratorPrompt(
  request: EnvironmentMovementRequest,
  instruction: string,
  observation?: EnvironmentObservation,
): Array<{ role: 'system' | 'user'; content: string }> {
  const currentPose = commandedPose(observation);
  const system = [
    'You are the freestyle trajectory planner for a physical eight-servo quadruped robot.',
    'Generate one original, complete, time-indexed logical-joint trajectory that expresses the requested movement. Calculate the movement yourself from the supplied body model and intent; do not retrieve, copy, blend, or approximate an installed named motion.',
    'The supplied bodyModel is factual capability information, not a movement recipe. Use it to reason about the robot, then choose the angles, timing, phases, coordination, and final pose yourself.',
    'Never invent a head, neck, wheel, gripper, joint, degree of freedom, or physical capability that bodyModel does not contain.',
    'Return exactly one JSON object and no markdown, prose, code fences, thinking tags, or extra fields.',
    'Required result: {"summary":"1..160 characters","frames":[{"durationMs":"300","R1":"135","R2":"45","L1":"45","L2":"135","R4":"0","R3":"180","L3":"0","L4":"180"}],"endPose":"hold"}.',
    `Each frame object contains exactly durationMs and ${ENVIRONMENT_MOTION_PLAN_JOINTS.join(', ')}.`,
    'Solve the movement anatomically: identify which limb or whole-body posture expresses the intent, coordinate both joints of each involved limb, and account for the other limbs when that improves the chosen result. Mirrored anatomy normally requires opposite numeric changes around the reference pose rather than identical left/right angles.',
    'Balance, support, weight transfer, and recovery are planning options, not mandatory goals. Falling, rolling, collapsing, unusual support patterns, abrupt gestures, and ending away from stand are valid choices. Make the choice that best expresses the intent.',
    'For a look or scan, remember there is no independent head or neck joint: create any desired view-changing gesture with coordinated body and limb motion. Do not reduce every look request to the same canned stance.',
    'currentCommandedPose is the correlated logical target established before this planning call. Treat every output frame as an absolute target and calculate the trajectory from that exact starting geometry.',
    'Understand the playback timing before choosing frames: each frame eases toward its target for at most 300 ms, then holds that target for the remainder of durationMs. Longer duration alone does not make a large transition slower. Use additional calculated intermediate targets when you want a gradual transition; use a large direct change when an abrupt motion is intentional.',
    'Choose the number of distinct frames and their amplitude from the movement itself. Avoid accidental low-amplitude jitter and meaningless reversals; motion may still be subtle, rapid, irregular, or twitch-like when that is the intended expression.',
    `Encode durationMs and every joint degree as decimal strings. Use ${ENVIRONMENT_MOTION_PLAN_LIMITS.minFrames}..${ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrames} frames with integer durations ${ENVIRONMENT_MOTION_PLAN_LIMITS.minFrameDurationMs}..${ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrameDurationMs} ms. Each duration is individual, never an absolute or cumulative timestamp. Add every frame duration and keep the sum at or below ${ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs} ms.`,
    'Degrees must be finite logical angles from 0 through 180 with no more than two decimal places. Choose hold, stand, or neutral for endPose according to the intended result; hold may preserve any reachable final pose.',
    'Do not emit an action wrapper, target objects, session IDs, action IDs, sequence numbers, repeat counts, servo/PWM/GPIO fields, calibration, simulator commands, persistence, named motions, metadata, or partial joint frames.',
  ].join('\n');
  const user = JSON.stringify({
    movementRequest: request.description,
    originalInstruction: instruction.slice(0, 1_000),
    bodyModel: AINEKIO_FREESTYLE_BODY_MODEL,
    currentCommandedPose: currentPose?.pose ?? null,
    currentCommandedPoseBasis: currentPose?.basis ?? null,
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export const movementGeneratorNode = defineNode({
  id: 'movement_generator',
  name: 'Movement Generator',
  category: 'environment',
  inputs: [
    { name: 'movementRequest', type: 'object', optional: true, description: 'Eligible structured off-script movement request' },
    { name: 'instruction', type: 'string', optional: true, description: 'Original interpreted user instruction' },
    { name: 'observation', type: 'object', optional: true, description: 'Robot capability and current-state observation' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Target environment session' },
  ],
  outputs: [
    { name: 'action', type: 'object', description: 'One standing preparation or validated robotMotionPlan action, or null' },
    { name: 'actions', type: 'array', description: 'Validated action list for Environment Bridge Out' },
    { name: 'valid', type: 'boolean', description: 'Whether standing preparation or a validated plan was produced' },
    { name: 'rejected', type: 'boolean', description: 'Whether a requested plan was rejected' },
    { name: 'error', type: 'string', description: 'Validation or generation error' },
    { name: 'response', type: 'string', description: 'Short visible generation result or rejection' },
    { name: 'planSummary', type: 'object', description: 'Bounded frame and duration summary' },
  ],
  properties: {
    role: 'orchestrator',
    maxTokens: 4096,
    temperature: 0.2,
  },
  propertySchemas: {
    role: {
      type: 'select',
      default: 'orchestrator',
      label: 'Model Role',
      options: ['orchestrator', 'persona', 'fallback'],
    },
    maxTokens: {
      type: 'number',
      default: 4096,
      label: 'Max Tokens',
      min: 1024,
      max: 8192,
      step: 256,
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      min: 0,
      max: 0.5,
      step: 0.05,
    },
  },
  description: 'Generates and strictly validates one bounded off-script logical-joint trajectory. It cannot authorize calibration or direct servo control.',
  async execute(inputs, context, properties) {
    const requestedValue = inputs.movementRequest;
    const hasRequestedValue = requestedValue !== undefined && requestedValue !== null;
    const request = movementRequest(requestedValue);
    if (!request) {
      const error = hasRequestedValue
        ? 'Movement Generator accepts only an admitted body_local movement request.'
        : '';
      return {
        action: null,
        actions: [],
        valid: false,
        rejected: hasRequestedValue,
        error,
        response: error,
        planSummary: null,
      };
    }
    const observation = inputs.observation && typeof inputs.observation === 'object'
      ? inputs.observation as EnvironmentObservation
      : undefined;
    const sessionId = typeof inputs.sessionId === 'string' && inputs.sessionId.trim()
      ? inputs.sessionId.trim()
      : request.sessionId || observation?.sessionId;
    if (!sessionId) {
      const error = 'Off-script movement requires a connected target session.';
      return { action: null, actions: [], valid: false, rejected: true, error, response: error, planSummary: null };
    }
    if (!observation?.capabilities?.actions?.includes('robotMotionPlan')) {
      const error = 'Off-script movement is unavailable because robotMotionPlan is not advertised.';
      return {
        action: null,
        actions: [],
        valid: false,
        rejected: true,
        error,
        response: error,
        planSummary: null,
      };
    }
    const currentPose = commandedPose(observation);
    if (!currentPose) {
      const canStand = observation.capabilities.actions.includes('robotCommand')
        && observation.capabilities.robotCommands?.includes('stand') === true;
      if (!canStand) {
        const error = 'Off-script movement requires a known commanded pose or an advertised stand command.';
        return {
          action: null,
          actions: [],
          valid: false,
          rejected: true,
          error,
          response: error,
          planSummary: null,
        };
      }
      const action: Partial<EnvironmentAction> = {
        type: 'robotCommand',
        command: 'stand',
        sessionId,
        metadata: {
          motionPreparation: {
            version: 1,
            kind: 'stand_before_freestyle',
            movementRequest: request,
          },
        },
      };
      return {
        action,
        actions: [action],
        valid: true,
        rejected: false,
        error: '',
        response: '',
        planSummary: { preparing: true, requiredPose: 'stand' },
      };
    }
    try {
      const instruction = typeof inputs.instruction === 'string' ? inputs.instruction.trim() : '';
      const messages = movementGeneratorPrompt(request, instruction, observation);
      const callGenerator = (generatorMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => callLLM({
        role: properties?.role || 'orchestrator',
        messages: generatorMessages,
        userId: context.userId || context.username,
        cognitiveMode: 'environment',
        options: {
          maxTokens: properties?.maxTokens || 4096,
          temperature: properties?.temperature ?? 0.2,
          repeatPenalty: 1,
          format: 'json',
          jsonSchema: MOVEMENT_GENERATOR_JSON_SCHEMA,
        },
        onProgress: context.emitProgress,
      });
      const injected = context.generateEnvironmentMotionPlan;
      const result = typeof injected === 'function'
        ? { content: await injected({ request, instruction, observation, messages }) }
        : await callGenerator(messages);
      const normalized = normalizeGeneratedMotionPlan(result.content, sessionId, request.description);
      const action = {
        ...normalized.action,
        metadata: {
          ...(normalized.action.metadata ?? {}),
          motionSummary: normalized.summary,
        },
      };
      return {
        action,
        actions: [action],
        valid: true,
        rejected: false,
        error: '',
        response: '',
        planSummary: {
          frameCount: normalized.action.frames?.length ?? 0,
          durationMs: normalized.totalDurationMs,
          endPose: normalized.action.endPose,
        },
      };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const error = `Generated movement was rejected: ${detail}`;
      return {
        action: null,
        actions: [],
        valid: false,
        rejected: true,
        error,
        response: error,
        planSummary: null,
      };
    }
  },
});
