import { defineNode } from '../types.js';
import type {
  EnvironmentLocationData,
  EnvironmentMapData,
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { stringifyEnvironmentObservation } from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceVisualFrames(visual: unknown, visuals: unknown): EnvironmentVisualFrame[] {
  const frames: EnvironmentVisualFrame[] = [];
  if (isRecord(visual)) {
    frames.push(visual as unknown as EnvironmentVisualFrame);
  }
  if (Array.isArray(visuals)) {
    frames.push(...visuals.filter(isRecord).map(frame => frame as unknown as EnvironmentVisualFrame));
  }

  const seen = new Set<string>();
  return frames.filter(frame => {
    const key = frame.id ?? frame.url ?? frame.dataUrl;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shouldUseEnvironmentImages(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return false;

  if (/\b(?:image|photo|picture|camera|snapshot|visual|frame)\b/.test(normalized)) return true;
  if (/\b(?:what|which)\s+(?:can\s+)?(?:do\s+)?you\s+see\b/.test(normalized)) return true;
  if (/\b(?:what(?:'s|\s+is)\s+happening|what\s+is\s+going\s+on)\s+(?:here|nearby|around\s+(?:you|the\s+robot)|in\s+front\s+of\s+(?:you|the\s+robot))\b/.test(normalized)) return true;
  if (/\b(?:find|locate|spot|look\s+for|search\s+for)\b/.test(normalized)) {
    return !/\b(?:find\s+out|information|news|facts?|answer|online|internet|web|about)\b/.test(normalized);
  }
  if (/\b(?:identify|recognize|describe|inspect|examine)\b.*\b(?:this|that|these|those|object|thing|scene|room|environment|surroundings|in\s+front)\b/.test(normalized)) return true;
  if (/\b(?:read|count)\b.*\b(?:the|a|an|this|that|these|those|my|your)\b/.test(normalized)) return true;
  if (/\bwhere\s+(?:is|are)\s+(?:the|a|an|this|that|these|those|my|your)\b/.test(normalized)) return true;
  if (/\bwhat\s+colou?r\s+(?:is|are)\s+(?:the|a|an|this|that|these|those|my|your)\b/.test(normalized)) return true;
  return false;
}

export const environmentContextBuilderNode = defineNode({
  id: 'environment_context_builder',
  name: 'Environment Context Builder',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', description: 'Environment observation' },
    { name: 'instruction', type: 'string', optional: true, description: 'Additional task instruction' },
    { name: 'location', type: 'object', optional: true, description: 'Optional graph-supplied location data' },
    { name: 'map', type: 'object', optional: true, description: 'Optional graph-supplied map data' },
    { name: 'visual', type: 'object', optional: true, description: 'Optional graph-supplied visual frame' },
    { name: 'visuals', type: 'array', optional: true, description: 'Optional graph-supplied visual frames' },
    { name: 'images', type: 'array', optional: true, description: 'Validated model image content parts' },
  ],
  outputs: [
    { name: 'message', type: 'string', description: 'Prompt-ready environment message' },
    { name: 'messages', type: 'array', description: 'Model-router message array' },
    { name: 'context', type: 'object', description: 'Structured environment context package' },
    { name: 'location', type: 'object', description: 'Resolved location data' },
    { name: 'map', type: 'object', description: 'Resolved map data' },
    { name: 'images', type: 'array', description: 'Visual frames suitable for image-capable models' },
    { name: 'availableActions', type: 'array', description: 'Available action types' },
  ],
  properties: {
    systemPrompt: '',
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      rows: 5,
    },
  },
  description: 'Builds environment context and attaches optional vision only when the instruction is visually grounded.',
  async execute(inputs, _context, properties) {
    const observation = inputs.observation as EnvironmentObservation | undefined;
    if (!observation) {
      return {
        message: '',
        messages: [],
        context: null,
        location: null,
        map: null,
        images: [],
        availableActions: [],
      };
    }

    const location = isRecord(inputs.location)
      ? inputs.location as EnvironmentLocationData
      : observation.location ?? null;
    const map = isRecord(inputs.map)
      ? inputs.map as EnvironmentMapData
      : observation.map ?? null;
    const visualFrames = coerceVisualFrames(inputs.visual ?? observation.visual, inputs.visuals ?? observation.visuals);
    const images = Array.isArray(inputs.images)
      ? inputs.images.filter(part => isRecord(part) && part.type === 'image_url')
      : [];
    const effectiveObservation: EnvironmentObservation = {
      ...observation,
      ...(location ? { location } : {}),
      ...(map ? { map } : {}),
      ...(visualFrames[0] ? { visual: visualFrames[0] } : {}),
      ...(visualFrames.length ? { visuals: visualFrames } : {}),
    };

    const systemPrompt = String(properties?.systemPrompt ?? '');
    const rawInstruction = typeof inputs.instruction === 'string'
      ? inputs.instruction.trim()
      : '';
    const useImages = shouldUseEnvironmentImages(rawInstruction);
    const selectedImages = useImages ? images : [];
    const promptObservation = useImages
      ? effectiveObservation
      : { ...effectiveObservation, visual: undefined, visuals: undefined };
    const instruction = rawInstruction
      ? `\n\nTask instruction:\n${rawInstruction}`
      : '';
    const message = `${stringifyEnvironmentObservation(promptObservation, systemPrompt)}${instruction}`;

    return {
      message,
      messages: [{
        role: 'user',
        content: selectedImages.length
          ? [{ type: 'text', text: message }, ...selectedImages]
          : message,
      }],
      context: {
        kind: 'environment',
        observation: effectiveObservation,
        state: effectiveObservation.state ?? {},
        text: effectiveObservation.text ?? [],
        location,
        map,
        visual: effectiveObservation.visual ?? null,
        visuals: effectiveObservation.visuals ?? [],
        feedback: effectiveObservation.feedback ?? [],
        imageSelection: {
          requested: useImages,
          available: images.length,
          used: selectedImages.length,
        },
      },
      location,
      map,
      images: selectedImages,
      availableActions: effectiveObservation.capabilities.actions,
    };
  },
});
