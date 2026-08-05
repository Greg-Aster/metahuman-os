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

function selectedImage(
  cycleId: string,
  images: unknown,
  frames: unknown,
): { image: Record<string, unknown>; frame: EnvironmentVisualFrame } | null {
  if (!Array.isArray(images) || !Array.isArray(frames)) return null;
  const frameList = frames.filter(isRecord) as unknown as EnvironmentVisualFrame[];
  const index = frameList.findIndex(frame => (
    cleanText(frame.metadata?.correlationId, 200) === cycleId
  ));
  if (index < 0 || !isRecord(images[index]) || images[index].type !== 'image_url') return null;
  return { image: images[index], frame: frameList[index]! };
}

export const boredomMovementContextBuilderNode = defineNode({
  id: 'boredom_movement_context_builder',
  name: 'Boredom Movement Context',
  category: 'operator',
  inputs: [
    { name: 'observation', type: 'object', description: 'Correlated post-movement robot observation' },
    { name: 'images', type: 'array', optional: true, description: 'Validated image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated visual frame metadata' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Minimal multimodal reflection request' },
    { name: 'context', type: 'object', description: 'Inspectable post-movement context' },
    { name: 'valid', type: 'boolean', description: 'Whether a correlated post-movement image is ready' },
    { name: 'error', type: 'string', description: 'Visible input error' },
  ],
  properties: { systemPrompt: '' },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'Boredom Reflection Prompt',
      description: 'Graph-owned instructions for grounded post-movement reflection.',
      rows: 10,
      required: true,
    },
  },
  description: 'Builds a small, image-only reflection context after the Boredom Movement command completes.',
  async execute(inputs, _context, properties) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const systemPrompt = cleanText(properties?.systemPrompt, 4_000);
    const invalid = (error: string) => ({ messages: [], context: null, valid: false, error });
    if (!observation?.sessionId) return invalid('Boredom Movement context requires a robot observation.');
    if (!systemPrompt) return invalid('Boredom Movement graph requires a configured system prompt.');
    const cycle = readBoredomMovementCycle(observation);
    if (!cycle) return invalid('Boredom Movement metadata is missing or invalid.');
    const visual = selectedImage(cycle.cycleId, inputs.images, inputs.frames);
    if (!visual) return invalid('Boredom Movement requires its correlated post-movement image.');

    const personaText = cleanText(inputs.personaText, 12_000);
    const stimulus = {
      performedCommand: cycle.selectedCommand,
      capturedAt: visual.frame.timestamp || observation.timestamp,
      frame: {
        id: visual.frame.id,
        mimeType: visual.frame.mimeType,
        width: visual.frame.width,
        height: visual.frame.height,
        correlationId: cycle.cycleId,
      },
    };
    return {
      messages: [
        { role: 'system', content: [systemPrompt, personaText].filter(Boolean).join('\n\n') },
        {
          role: 'user',
          content: [
            { type: 'text', text: JSON.stringify({ boredomMovementResult: stimulus }) },
            visual.image,
          ],
        },
      ],
      context: { stimulus, personaIncluded: Boolean(personaText), imageCount: 1 },
      valid: true,
      error: '',
    };
  },
});
