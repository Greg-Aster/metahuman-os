import { callLLM } from '../../model-router.js';
import {
  ENVIRONMENT_MOTION_PLAN_JOINTS,
  ENVIRONMENT_MOTION_PLAN_LIMITS,
  assertBoundedMotionPlanEncoding,
  normalizeEnvironmentMotionPlanFields,
  type EnvironmentAction,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import type { EnvironmentMovementRequest } from './helpers.js';

const ACTION_KEYS = ['type', 'frames', 'endPose'] as const;
const RESULT_KEYS = ['action', 'summary'] as const;
const COMPACT_RESULT_KEYS = ['summary', 'frames', 'endPose'] as const;

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

export function normalizeGeneratedMotionPlan(
  value: unknown,
  sessionId: string,
  fallbackSummary = '',
): { action: Partial<EnvironmentAction>; summary: string; totalDurationMs: number } {
  if (typeof value === 'string' && Buffer.byteLength(value) > ENVIRONMENT_MOTION_PLAN_LIMITS.maxEncodedBytes) {
    throw new Error('Movement Generator output exceeds its size limit');
  }
  const result = strictJsonObject(value);
  let action: Record<string, unknown>;
  if (result.action !== undefined) {
    exactKeys(result, RESULT_KEYS, 'Movement Generator result');
    if (!result.action || typeof result.action !== 'object' || Array.isArray(result.action)) {
      throw new Error('Movement Generator result requires an action object');
    }
    action = result.action as Record<string, unknown>;
  } else {
    exactKeys(result, COMPACT_RESULT_KEYS, 'Movement Generator result');
    if (!Array.isArray(result.frames)) {
      throw new Error('Movement Generator compact result requires frames');
    }
    action = {
      type: 'robotMotionPlan',
      endPose: result.endPose,
      frames: result.frames.map((frame, frameIndex) => {
        if (!Array.isArray(frame) || frame.length !== ENVIRONMENT_MOTION_PLAN_JOINTS.length + 1) {
          throw new Error(`Compact frame ${frameIndex} must contain duration plus eight joint values`);
        }
        return {
          durationMs: frame[0],
          targets: ENVIRONMENT_MOTION_PLAN_JOINTS.map((joint, jointIndex) => ({
            joint,
            degrees: frame[jointIndex + 1],
          })),
        };
      }),
    };
  }
  exactKeys(action, ACTION_KEYS, 'Generated motion action');
  if (action.type !== 'robotMotionPlan') {
    throw new Error('Movement Generator may only return robotMotionPlan');
  }
  if (!Object.prototype.hasOwnProperty.call(action, 'endPose')) {
    throw new Error('Generated motion action requires endPose');
  }
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
  if (!description || description.length > 500) return null;
  return {
    description,
    sessionId: typeof request.sessionId === 'string' ? request.sessionId : undefined,
  };
}

function commandedPose(observation: EnvironmentObservation | undefined): Record<string, number> | undefined {
  const candidate = observation?.state?.commandedPose;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const pose = candidate as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const joint of ENVIRONMENT_MOTION_PLAN_JOINTS) {
    const degrees = pose[joint];
    if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return undefined;
    normalized[joint] = degrees;
  }
  return normalized;
}

export function movementGeneratorPrompt(
  request: EnvironmentMovementRequest,
  instruction: string,
  observation?: EnvironmentObservation,
): Array<{ role: 'system' | 'user'; content: string }> {
  const currentPose = commandedPose(observation);
  const system = [
    'You are Movement Generator for the Ainekio eight-servo robot emulator.',
    'Generate one complete, expressive, time-indexed logical-joint trajectory that clearly performs the requested movement. You propose motion; downstream safety validators decide whether it executes.',
    'Return exactly one JSON object and no markdown, prose, code fences, thinking tags, or extra fields.',
    'Required compact result: {"summary":"1..160 characters","frames":[[300,135,45,45,135,0,180,0,180]],"endPose":"hold"}.',
    `Each frame array is exactly [durationMs, ${ENVIRONMENT_MOTION_PLAN_JOINTS.join(', ')}] in that fixed order.`,
    'Body layout: front-right limb uses R1/R3, front-left limb uses L1/L3, right-rear leg uses R2/R4, and left-rear leg uses L2/L4. On each front limb, the first joint is the shoulder and the second is the arm. On each rear leg, the first joint is the hip and the second is the lower leg.',
    'Interpret right or left arm/hand requests as the corresponding front limb unless the instruction explicitly identifies a rear leg.',
    'Reason about the paired joints of every limb involved. A visible lift, reach, or gesture usually needs coordinated changes across the limb rather than treating one joint as the entire limb. Choose all angles, timing, support-limb compensation, and movement phases yourself from the user request.',
    `Before returning the trajectory, check that the requested side and limb perform the visible action described by the user and that all frame durations sum to no more than ${ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs} ms.`,
    'Logical standing pose: R1=135, R2=45, L1=45, L2=135, R4=0, R3=180, L3=0, L4=180.',
    `Use ${ENVIRONMENT_MOTION_PLAN_LIMITS.minFrames}..${ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrames} frames with integer durations ${ENVIRONMENT_MOTION_PLAN_LIMITS.minFrameDurationMs}..${ENVIRONMENT_MOTION_PLAN_LIMITS.maxFrameDurationMs} ms. The first number in each frame is that frame's individual duration, never an absolute or cumulative timestamp. Add every frame duration and keep the sum at or below ${ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs} ms.`,
    'Choose the number of distinct frames needed for the requested movement within the motion-plan contract. Do not repeat identical frames unless one repeated frame represents a deliberate pause.',
    'Degrees must be finite 0..180 with no more than two decimal places. endPose must be hold, stand, or neutral.',
    'Use clearly visible joint changes. This is an emulator: unstable movement or falling is acceptable when it better matches the request.',
    'Do not emit an action wrapper, joint names, target objects, session IDs, action IDs, sequence numbers, repeat counts, servo/PWM/GPIO fields, calibration, simulator commands, persistence, named motions, metadata, or partial joint frames.',
  ].join('\n');
  const user = JSON.stringify({
    movementRequest: request.description,
    originalInstruction: instruction.slice(0, 1_000),
    currentCommandedPose: currentPose ?? null,
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
    { name: 'action', type: 'object', description: 'One validated robotMotionPlan action, or null' },
    { name: 'actions', type: 'array', description: 'Validated action list for Environment Bridge Out' },
    { name: 'valid', type: 'boolean', description: 'Whether a bounded plan was generated' },
    { name: 'rejected', type: 'boolean', description: 'Whether a requested plan was rejected' },
    { name: 'error', type: 'string', description: 'Validation or generation error' },
    { name: 'response', type: 'string', description: 'Short visible generation result or rejection' },
    { name: 'planSummary', type: 'object', description: 'Bounded frame and duration summary' },
  ],
  properties: {
    role: 'orchestrator',
    maxTokens: 1536,
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
      default: 1536,
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
    const request = movementRequest(inputs.movementRequest);
    if (!request) {
      return {
        action: null,
        actions: [],
        valid: false,
        rejected: false,
        error: '',
        response: '',
        planSummary: null,
      };
    }
    const observation = inputs.observation && typeof inputs.observation === 'object'
      ? inputs.observation as EnvironmentObservation
      : undefined;
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
    const sessionId = typeof inputs.sessionId === 'string' && inputs.sessionId.trim()
      ? inputs.sessionId.trim()
      : request.sessionId || observation.sessionId;
    if (!sessionId) {
      const error = 'Off-script movement requires a connected target session.';
      return { action: null, actions: [], valid: false, rejected: true, error, response: error, planSummary: null };
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
          maxTokens: properties?.maxTokens || 1536,
          temperature: properties?.temperature ?? 0.2,
          repeatPenalty: 1.1,
          format: 'json',
        },
        onProgress: context.emitProgress,
      });
      let result = await callGenerator(messages);
      let normalized;
      try {
        normalized = normalizeGeneratedMotionPlan(result.content, sessionId, request.description);
      } catch (firstCause) {
        const reason = firstCause instanceof Error ? firstCause.message : String(firstCause);
        result = await callGenerator([
          ...messages,
          { role: 'assistant', content: String(result.content).slice(0, ENVIRONMENT_MOTION_PLAN_LIMITS.maxEncodedBytes) },
          {
            role: 'user',
            content: `Your previous response was invalid: ${reason}. Correct that specific error instead of repeating the same values. Each frame's first number is its individual duration, not a timestamp; add them and keep the total at or below ${ENVIRONMENT_MOTION_PLAN_LIMITS.maxTotalDurationMs} ms. Return one complete corrected compact JSON object only.`,
          },
        ]);
        normalized = normalizeGeneratedMotionPlan(result.content, sessionId, request.description);
      }
      return {
        action: normalized.action,
        actions: [normalized.action],
        valid: true,
        rejected: false,
        error: '',
        response: normalized.summary,
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
