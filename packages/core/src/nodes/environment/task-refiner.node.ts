import { callLLM, type ModelRole, type RouterMessage } from '../../model-router.js';
import type { ProviderImageContentPart } from '../../providers/types.js';
import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import type { EnvironmentTaskRefinementRequest } from './task-validator.node.js';
import type { EnvironmentWorkflowCommand } from './workflow-command.node.js';

interface EnvironmentTaskRefinement {
  instruction: string;
  message: string;
  reason: string;
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

function validRequest(value: unknown): value is EnvironmentTaskRefinementRequest {
  if (!isRecord(value) || value.kind !== 'environment_task_refinement_request') return false;
  return Boolean(
    cleanText(value.objective, 1_000)
    && cleanText(value.currentInstruction, 500)
    && cleanText(value.reason, 500)
    && (value.source === 'user' || value.source === 'autonomy')
    && (value.mode === 'reactive' || value.mode === 'semi' || value.mode === 'full')
    && cleanText(value.graph, 80)
    && Number.isInteger(value.step)
    && Number.isInteger(value.maxSteps)
    && Number(value.step) >= 1
    && Number(value.maxSteps) >= 1
    && Number(value.step) < Number(value.maxSteps)
    && value.continuationPolicy === 'bounded',
  );
}

function boundedHistory(value: unknown, limit: number): Array<Record<string, string>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  return messages
    .filter(isRecord)
    .map(message => ({
      role: cleanText(message.role, 40),
      content: cleanText(message.content, 2_000),
    }))
    .filter(message => ['user', 'assistant'].includes(message.role) && message.content)
    .slice(-limit);
}

function correlatedImage(
  request: EnvironmentTaskRefinementRequest,
  frames: unknown,
  images: unknown,
): ProviderImageContentPart | null {
  if (!request.cycleId || !Array.isArray(frames) || !Array.isArray(images)) return null;
  const frameIndex = frames.findIndex(candidate => (
    isRecord(candidate)
    && isRecord(candidate.metadata)
    && candidate.metadata.correlationId === request.cycleId
  ));
  if (frameIndex < 0) return null;
  const image = images[frameIndex];
  return isRecord(image)
    && image.type === 'image_url'
    && isRecord(image.image_url)
    && typeof image.image_url.url === 'string'
    ? image as unknown as ProviderImageContentPart
    : null;
}

function visualFrames(observation: EnvironmentObservation): Array<Record<string, unknown>> {
  return [observation.visual, ...(observation.visuals ?? [])]
    .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
    .map(frame => ({
      id: frame.id,
      timestamp: frame.timestamp,
      mimeType: frame.mimeType,
      width: frame.width,
      height: frame.height,
      correlationId: frame.metadata?.correlationId ?? null,
    }));
}

function parseRefinement(value: unknown): EnvironmentTaskRefinement | null {
  const parsed = isRecord(value)
    ? value
    : extractJsonObject(typeof value === 'string' ? value : '');
  if (!isRecord(parsed)) return null;
  const instruction = cleanText(parsed.instruction, 500);
  const message = cleanText(parsed.message, 1_000);
  const reason = cleanText(parsed.reason, 500);
  return instruction && message && reason ? { instruction, message, reason } : null;
}

export const environmentTaskRefinerNode = defineNode({
  id: 'environment_task_refiner',
  name: 'Environment Task Refiner',
  category: 'environment',
  inputs: [
    { name: 'request', type: 'object', optional: true, description: 'Incomplete result emitted by the existing Environment Task Validator' },
    { name: 'observation', type: 'object', optional: true, description: 'Current correlated environment observation' },
    { name: 'images', type: 'array', optional: true, description: 'Validated current image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated current visual frame metadata' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Bounded canonical conversation context' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona context' },
  ],
  outputs: [
    { name: 'instruction', type: 'string', description: 'LLM-authored refined instruction for the next Environment attempt' },
    { name: 'message', type: 'string', description: 'User-visible explanation of the refined attempt' },
    { name: 'conversationEntry', type: 'message', description: 'Canonical assistant entry for the Conversation Buffer' },
    { name: 'workflowCommand', type: 'object', description: 'Refined instruction packaged for the existing Environment Workflow Command node' },
    { name: 'valid', type: 'boolean', description: 'Whether a refinement was requested and validly authored' },
    { name: 'skipped', type: 'boolean', description: 'Whether the existing validator did not request refinement' },
    { name: 'error', type: 'string', description: 'Structured refinement failure reason' },
  ],
  properties: {
    role: 'orchestrator',
    systemPrompt: '',
    historyLimit: 8,
    maxTokens: 768,
    temperature: 0.2,
  },
  propertySchemas: {
    role: {
      type: 'select',
      default: 'orchestrator',
      label: 'Refinement Model Role',
      options: ['orchestrator', 'persona'],
    },
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'Task Refinement Prompt',
      rows: 16,
      required: true,
    },
    historyLimit: {
      type: 'slider',
      default: 8,
      label: 'Conversation History Limit',
      min: 0,
      max: 20,
      step: 1,
    },
    maxTokens: {
      type: 'slider',
      default: 768,
      label: 'Maximum Tokens',
      min: 256,
      max: 1536,
      step: 256,
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      min: 0,
      max: 0.7,
      step: 0.1,
    },
  },
  description: 'Uses the configured LLM to refine one validator-confirmed incomplete task, then packages it for the existing Environment workflow.',
  async execute(inputs, context, properties) {
    const empty = (overrides: Record<string, unknown> = {}) => ({
      instruction: '',
      message: '',
      conversationEntry: null,
      workflowCommand: null,
      valid: false,
      skipped: false,
      error: '',
      ...overrides,
    });
    if (!inputs.request) return empty({ skipped: true });
    if (!validRequest(inputs.request)) return empty({ error: 'invalid_refinement_request' });
    const request = inputs.request;
    if (request.result?.visualEvidence?.verdict === 'supported') {
      return empty({
        skipped: true,
        error: 'supported_visual_completion_cannot_refine',
      });
    }
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    if (!observation?.sessionId) return empty({ error: 'missing_observation_session' });
    const systemPrompt = cleanText(properties?.systemPrompt, 12_000);
    if (!systemPrompt) return empty({ error: 'refinement_prompt_not_configured' });

    const configuredHistoryLimit = properties?.historyLimit;
    const historyLimit = Number.isInteger(configuredHistoryLimit)
      ? Math.max(0, Math.min(20, Number(configuredHistoryLimit)))
      : 8;
    const history = boundedHistory(inputs.conversationHistory, historyLimit);
    const personaText = cleanText(inputs.personaText, 12_000);
    const immutableTaskBoundary = [
      'Immutable task contract for this refinement:',
      `- Original objective: ${request.objective}`,
      `- Required whole-objective evidence basis: ${request.requiredCompletionBasis}.`,
      '- Preserve who performs each action, who senses each condition, and who owns every referenced object or body part.',
      '- Preserve the original stopping condition exactly; do not substitute a new signal, actor, sensor, or completion criterion.',
      ...(request.requiredCompletionBasis === 'visual_observation'
        ? ['- The stopping condition remains something the robot must detect in a fresh correlated frame. Never rewrite it as an explicit user instruction or user_input requirement.']
        : []),
      '- Refine only the next approach. The original objective and evidence basis remain authoritative even if recent conversation or the prior instruction paraphrases them differently.',
    ].join('\n');
    const image = correlatedImage(request, inputs.frames, inputs.images);
    const refinementContext = {
      request,
      currentObservation: {
        environmentId: observation.environmentId,
        adapter: observation.adapter,
        sessionId: observation.sessionId,
        timestamp: observation.timestamp,
        capabilities: observation.capabilities,
        state: observation.state ?? {},
        location: observation.location ?? null,
        feedback: observation.feedback ?? [],
        visualFrames: visualFrames(observation),
      },
      recentConversation: history,
    };
    const userContent = image
      ? [
          { type: 'text' as const, text: JSON.stringify(refinementContext) },
          image,
        ]
      : JSON.stringify(refinementContext);
    const messages: RouterMessage[] = [
      {
        role: 'system',
        content: [systemPrompt, personaText, immutableTaskBoundary].filter(Boolean).join('\n\n'),
      },
      { role: 'user', content: userContent },
    ];

    try {
      const injected = context.refineEnvironmentTask;
      const raw = typeof injected === 'function'
        ? await injected({ request, observation, messages })
        : (await callLLM({
            role: (properties?.role === 'persona' ? 'persona' : 'orchestrator') as ModelRole,
            messages,
            userId: context.userId || context.username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: Number(properties?.maxTokens) || 768,
              temperature: typeof properties?.temperature === 'number' ? properties.temperature : 0.2,
              format: 'json',
            },
            onProgress: context.emitProgress,
          })).content;
      const refinement = parseRefinement(raw);
      if (!refinement) return empty({ error: 'invalid_refinement_response' });
      const workflowCommand: EnvironmentWorkflowCommand = {
        kind: 'environment_workflow_command',
        objective: request.objective,
        instruction: refinement.instruction,
        reason: refinement.reason,
        source: request.source,
        mode: request.mode,
        graph: request.graph,
        cycleId: request.cycleId,
        step: request.step,
        maxSteps: request.maxSteps,
        advanceCycle: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: request.requiredCompletionBasis,
        requireExternalCompletionEvidence: request.requireExternalCompletionEvidence,
      };
      return {
        instruction: refinement.instruction,
        message: refinement.message,
        conversationEntry: {
          role: 'assistant',
          content: refinement.message,
          meta: {
            cognitiveMode: 'environment',
            refinement: true,
            objective: request.objective,
            cycleId: request.cycleId ?? null,
            step: request.step,
            maxSteps: request.maxSteps,
          },
        },
        workflowCommand,
        valid: true,
        skipped: false,
        error: '',
      };
    } catch (error) {
      return empty({ error: cleanText((error as Error).message, 500) || 'task_refinement_failed' });
    }
  },
});
