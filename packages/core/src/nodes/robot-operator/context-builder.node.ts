import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { readBoredomMovementCycle } from '../../robot-operator.js';
import { defineNode } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function correlationId(observation: EnvironmentObservation): string {
  const direct = cleanText(observation.metadata?.correlationId, 200);
  if (direct) return direct;
  const cycle = isRecord(observation.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  return cleanText(cycle?.cycleId, 200);
}

function frameSummary(frame: EnvironmentVisualFrame): Record<string, unknown> {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    mimeType: frame.mimeType,
    width: frame.width,
    height: frame.height,
    correlationId: cleanText(frame.metadata?.correlationId, 200) || undefined,
  };
}

const IDLE_THOUGHT_ROLES = new Set(['thought', 'reflection', 'dream', 'daydream']);

function normalizedTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        .map(tag => tag.trim().toLowerCase())
    : [];
}

function admittedIdleThoughts(value: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  return messages
    .filter(isRecord)
    .filter(message => {
      const meta = isRecord(message.meta) ? message.meta : null;
      const role = cleanText(message.role, 40).toLowerCase();
      return IDLE_THOUGHT_ROLES.has(role) && normalizedTags(meta?.tags).includes('idle-thought');
    })
    .map(message => {
      const meta = isRecord(message.meta) ? message.meta : null;
      return {
        role: cleanText(message.role, 40),
        content: cleanText(message.content, 2_000),
        ...(typeof message.timestamp === 'number' || typeof message.timestamp === 'string'
          ? { timestamp: message.timestamp }
          : {}),
        ...(meta
          ? {
              context: {
                dialogueSource: cleanText(meta.dialogueSource, 100) || null,
                tags: normalizedTags(meta.tags),
              },
            }
          : {}),
      };
    })
    .filter(message => message.role && message.content);
}

function boundedObject(value: unknown, maxLength = 8_000): unknown {
  if (!isRecord(value) && !Array.isArray(value)) return value ?? null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length <= maxLength) return value;
    return { truncatedJson: encoded.slice(0, maxLength) };
  } catch {
    return null;
  }
}

function selectedImageParts(
  observation: EnvironmentObservation,
  images: unknown,
  frames: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(images) || !Array.isArray(frames)) return [];
  const expectedCorrelationId = correlationId(observation);
  if (!expectedCorrelationId) return [];
  const frameList = frames.filter(isRecord) as unknown as EnvironmentVisualFrame[];
  const index = frameList.findIndex(frame => (
    cleanText(frame.metadata?.correlationId, 200) === expectedCorrelationId
  ));
  if (index < 0 || !isRecord(images[index]) || images[index].type !== 'image_url') return [];
  return [images[index]];
}

export const robotOperatorContextBuilderNode = defineNode({
  id: 'robot_operator_context_builder',
  name: 'Robot Operator Context',
  category: 'operator',
  inputs: [
    { name: 'observation', type: 'object', description: 'Current correlated robot observation or agent-produced stimulus' },
    { name: 'images', type: 'array', optional: true, description: 'Validated image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated visual frame metadata' },
    { name: 'innerDialogueHistory', type: 'array', optional: true, description: 'Bounded canonical Inner Buffer context' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Multimodal messages for the configured Robot Operator LLM' },
    { name: 'context', type: 'object', description: 'Structured high-level deliberation context' },
    { name: 'valid', type: 'boolean', description: 'Whether the configured context is ready for deliberation' },
    { name: 'error', type: 'string', description: 'Visible configuration or input error' },
  ],
  properties: {
    systemPrompt: '',
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'Robot Operator Prompt',
      description: 'Graph-owned high-level deliberation and structured-output instructions.',
      rows: 18,
      required: true,
    },
  },
  description: 'Builds persona-aware multimodal context for high-level robot intention selection without deciding execution details.',
  async execute(inputs, _context, properties) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const systemPrompt = typeof properties?.systemPrompt === 'string'
      ? properties.systemPrompt.trim()
      : '';
    const invalid = (error: string) => ({
      messages: [],
      context: null,
      valid: false,
      error,
    });
    if (!observation?.sessionId) return invalid('Robot Operator context requires a robot observation with a session ID.');
    if (!systemPrompt) return invalid('Robot Operator graph requires a configured system prompt.');

    const recentIdleThoughts = admittedIdleThoughts(inputs.innerDialogueHistory);
    const canonicalInnerEntryCount = Array.isArray(inputs.innerDialogueHistory)
      ? inputs.innerDialogueHistory.length
      : isRecord(inputs.innerDialogueHistory) && Array.isArray(inputs.innerDialogueHistory.messages)
        ? inputs.innerDialogueHistory.messages.length
        : 0;
    console.log(
      `[RobotOperatorContext] Canonical inner entries: ${canonicalInnerEntryCount}; tagged Idle Thoughts admitted: ${recentIdleThoughts.length}`,
    );
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 12_000)
      : '';
    const images = selectedImageParts(observation, inputs.images, inputs.frames);
    const frames = [observation.visual, ...(observation.visuals ?? [])]
      .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
      .map(frameSummary);
    const boredomMovement = readBoredomMovementCycle(observation);
    const stimulus = {
      observedAt: observation.timestamp,
      freshVisualTiming: boredomMovement ? 'after_intention' : 'before_intention',
      state: boundedObject(observation.state, 8_000),
      location: boundedObject(observation.location, 4_000),
      map: boundedObject(observation.map, 4_000),
      text: (observation.text ?? []).slice(-8).map(event => ({
        source: event.source,
        sender: event.senderName ?? event.senderId ?? null,
        text: cleanText(event.text, 2_000),
        timestamp: event.timestamp,
      })),
      visualFrames: frames,
      recentIdleThoughts,
    };
    const systemContent = [systemPrompt, personaText].filter(Boolean).join('\n\n');
    const stimulusText = JSON.stringify({ robotStimulus: stimulus });
    const userContent = images.length > 0
      ? [{ type: 'text', text: stimulusText }, ...images]
      : stimulusText;

    return {
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      context: {
        stimulus,
        personaIncluded: Boolean(personaText),
        canonicalInnerEntryCount,
        idleThoughtCount: recentIdleThoughts.length,
        imageCount: images.length,
      },
      valid: true,
      error: '',
    };
  },
});
