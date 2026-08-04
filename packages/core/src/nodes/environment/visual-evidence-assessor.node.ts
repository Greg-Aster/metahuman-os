import { callLLM, type ModelRole, type RouterMessage } from '../../model-router.js';
import type { ProviderImageContentPart } from '../../providers/types.js';
import {
  hasFreshCorrelatedVisual,
  type EnvironmentObservation,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { readRobotObserverCycle } from '../../robot-operator.js';
import { defineNode } from '../types.js';
import {
  environmentTaskContractFromRouting,
  parseEnvironmentTaskInstruction,
  type EnvironmentTaskDecision,
} from './helpers.js';

export type EnvironmentVisualEvidenceVerdict = 'supported' | 'unsupported' | 'uncertain' | 'not_required';

export interface EnvironmentVisualEvidenceAssessment {
  assessed: boolean;
  valid: boolean;
  verdict: EnvironmentVisualEvidenceVerdict;
  frameId: string;
  frameTimestamp: string;
  reason: string;
  response: string;
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function taskContext(
  observation: EnvironmentObservation,
  routingAnalysis: unknown,
  instruction: unknown,
): { objective: string; currentInstruction: string } {
  const command = isRecord(observation.metadata?.taskValidatorCommand)
    ? observation.metadata.taskValidatorCommand
    : null;
  const commandObjective = cleanText(command?.objective, 1_000);
  const commandInstruction = cleanText(command?.instruction, 500);
  if (commandObjective) {
    return {
      objective: commandObjective,
      currentInstruction: commandInstruction || commandObjective,
    };
  }
  const persisted = parseEnvironmentTaskInstruction(observation.metadata?.originatingInstruction);
  if (persisted?.objective) {
    return {
      objective: persisted.objective,
      currentInstruction: persisted.currentInstruction || persisted.objective,
    };
  }
  const fallbackInstruction = cleanText(instruction, 1_000);
  const routed = environmentTaskContractFromRouting(routingAnalysis, fallbackInstruction);
  const objective = routed?.objective || fallbackInstruction;
  return { objective, currentInstruction: fallbackInstruction || objective };
}

function correlatedFrame(
  observation: EnvironmentObservation,
  frames: unknown,
): { frame: EnvironmentVisualFrame; image: Record<string, unknown> | null } | null {
  const cycle = readRobotObserverCycle(observation);
  if (!cycle || !hasFreshCorrelatedVisual(observation, cycle.cycleId)) return null;
  const candidates = Array.isArray(frames)
    ? frames.filter(isRecord) as unknown as EnvironmentVisualFrame[]
    : [];
  const index = candidates.findIndex(frame => frame.metadata?.correlationId === cycle.cycleId);
  if (index < 0) return null;
  return { frame: candidates[index]!, image: null };
}

function assessment(
  overrides: Partial<EnvironmentVisualEvidenceAssessment>,
): EnvironmentVisualEvidenceAssessment {
  return {
    assessed: false,
    valid: true,
    verdict: 'not_required',
    frameId: '',
    frameTimestamp: '',
    reason: '',
    response: '',
    error: '',
    ...overrides,
  };
}

function parseAssessment(
  value: unknown,
  frame: EnvironmentVisualFrame,
): EnvironmentVisualEvidenceAssessment {
  const parsed = isRecord(value)
    ? value
    : extractJsonObject(typeof value === 'string' ? value : '');
  if (!isRecord(parsed)) {
    return assessment({
      assessed: true,
      valid: false,
      verdict: 'uncertain',
      frameId: frame.id,
      frameTimestamp: frame.timestamp,
      reason: 'The visual evidence assessment was not valid structured output.',
      error: 'invalid_visual_evidence_assessment',
    });
  }
  const verdict = cleanText(parsed.verdict, 40).toLowerCase();
  if (verdict !== 'supported' && verdict !== 'unsupported' && verdict !== 'uncertain') {
    return assessment({
      assessed: true,
      valid: false,
      verdict: 'uncertain',
      frameId: frame.id,
      frameTimestamp: frame.timestamp,
      reason: 'The visual evidence assessment did not declare a supported verdict.',
      error: 'invalid_visual_evidence_verdict',
    });
  }
  const reason = cleanText(parsed.reason, 500);
  if (!reason) {
    return assessment({
      assessed: true,
      valid: false,
      verdict: 'uncertain',
      frameId: frame.id,
      frameTimestamp: frame.timestamp,
      reason: 'The visual evidence assessment omitted its reason.',
      error: 'missing_visual_evidence_reason',
    });
  }
  return assessment({
    assessed: true,
    valid: true,
    verdict,
    frameId: frame.id,
    frameTimestamp: frame.timestamp,
    reason,
    response: verdict === 'supported' ? '' : reason,
  });
}

export const environmentVisualEvidenceAssessorNode = defineNode({
  id: 'environment_visual_evidence_assessor',
  name: 'Environment Visual Evidence Assessor',
  category: 'environment',
  inputs: [
    { name: 'taskDecision', type: 'object', optional: true, description: 'Environment LLM completion claim to audit' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current objective or objective-bound instruction' },
    { name: 'observation', type: 'object', optional: true, description: 'Current correlated robot observation' },
    { name: 'images', type: 'array', optional: true, description: 'Validated current image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated current frame metadata' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Current whole-objective completion contract' },
  ],
  outputs: [
    { name: 'assessment', type: 'object', description: 'Frame-bound independent visual completion assessment' },
    { name: 'assessed', type: 'boolean', description: 'Whether a visual completion claim required assessment' },
    { name: 'verdict', type: 'string', description: 'supported, unsupported, uncertain, or not_required' },
    { name: 'valid', type: 'boolean', description: 'Whether the assessment satisfied its structured contract' },
    { name: 'error', type: 'string', description: 'Assessment failure reason' },
  ],
  properties: {
    role: 'orchestrator',
    systemPrompt: '',
    maxTokens: 512,
    temperature: 0,
  },
  propertySchemas: {
    role: {
      type: 'select',
      default: 'orchestrator',
      label: 'Evidence Model Role',
      options: ['orchestrator', 'persona'],
    },
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'Evidence Assessment Prompt',
      rows: 14,
      required: true,
    },
    maxTokens: {
      type: 'slider',
      default: 512,
      label: 'Maximum Tokens',
      min: 256,
      max: 1024,
      step: 256,
    },
    temperature: {
      type: 'slider',
      default: 0,
      label: 'Temperature',
      min: 0,
      max: 0.3,
      step: 0.1,
    },
  },
  description: 'Independently audits a claimed visual completion condition against the exact correlated frame before deterministic task validation.',
  async execute(inputs, context, properties) {
    const taskDecision = isRecord(inputs.taskDecision)
      ? inputs.taskDecision as unknown as EnvironmentTaskDecision
      : null;
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const claimedComplete = taskDecision?.objectiveComplete === true || taskDecision?.outcome === 'complete';
    if (
      !taskDecision
      || !observation
      || !claimedComplete
      || taskDecision.completionBasis !== 'visual_observation'
    ) {
      const result = assessment({});
      return { assessment: result, assessed: false, verdict: result.verdict, valid: true, error: '' };
    }
    const selected = correlatedFrame(observation, inputs.frames);
    const images = Array.isArray(inputs.images) ? inputs.images.filter(isRecord) : [];
    const frameIndex = selected
      ? (inputs.frames as unknown[]).findIndex(candidate => isRecord(candidate) && candidate.id === selected.frame.id)
      : -1;
    const image = frameIndex >= 0 && isRecord(images[frameIndex]) ? images[frameIndex] : null;
    const imagePart = image
      && image.type === 'image_url'
      && isRecord(image.image_url)
      && typeof image.image_url.url === 'string'
      ? image as unknown as ProviderImageContentPart
      : null;
    if (!selected || !imagePart) {
      const result = assessment({
        assessed: true,
        valid: false,
        verdict: 'uncertain',
        frameId: selected?.frame.id ?? '',
        frameTimestamp: selected?.frame.timestamp ?? '',
        reason: 'No exact correlated image was available for independent visual assessment.',
        error: 'missing_correlated_visual_evidence',
      });
      return { assessment: result, assessed: true, verdict: result.verdict, valid: false, error: result.error };
    }
    const { objective, currentInstruction } = taskContext(
      observation,
      inputs.routingAnalysis,
      inputs.instruction,
    );
    const systemPrompt = cleanText(properties?.systemPrompt, 8_000);
    if (!objective || !systemPrompt) {
      const result = assessment({
        assessed: true,
        valid: false,
        verdict: 'uncertain',
        frameId: selected.frame.id,
        frameTimestamp: selected.frame.timestamp,
        reason: 'The visual evidence assessment was missing its objective or graph-owned prompt.',
        error: 'visual_evidence_assessor_not_configured',
      });
      return { assessment: result, assessed: true, verdict: result.verdict, valid: false, error: result.error };
    }
    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              objective,
              currentInstruction,
              claimedCompletion: {
                reason: cleanText(taskDecision.reason, 500),
                evidence: cleanText(taskDecision.completionEvidence, 500),
              },
              frame: {
                id: selected.frame.id,
                timestamp: selected.frame.timestamp,
                correlationId: selected.frame.metadata?.correlationId ?? null,
              },
            }),
          },
          imagePart,
        ],
      },
    ];
    try {
      const injected = context.evaluateEnvironmentVisualEvidence;
      const raw = typeof injected === 'function'
        ? await injected({ objective, taskDecision, observation, frame: selected.frame, messages })
        : (await callLLM({
            role: (properties?.role === 'persona' ? 'persona' : 'orchestrator') as ModelRole,
            messages,
            userId: context.userId || context.username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: Number(properties?.maxTokens) || 512,
              temperature: typeof properties?.temperature === 'number' ? properties.temperature : 0,
              format: 'json',
            },
            onProgress: context.emitProgress,
          })).content;
      const result = parseAssessment(raw, selected.frame);
      return {
        assessment: result,
        assessed: true,
        verdict: result.verdict,
        valid: result.valid,
        error: result.error,
      };
    } catch (error) {
      const result = assessment({
        assessed: true,
        valid: false,
        verdict: 'uncertain',
        frameId: selected.frame.id,
        frameTimestamp: selected.frame.timestamp,
        reason: 'The independent visual evidence assessment did not complete.',
        error: cleanText((error as Error).message, 500) || 'visual_evidence_assessment_failed',
      });
      return { assessment: result, assessed: true, verdict: result.verdict, valid: false, error: result.error };
    }
  },
});
