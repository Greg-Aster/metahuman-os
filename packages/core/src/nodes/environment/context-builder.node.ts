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
  description: 'Converts text, state, and visual bridge data into a prompt-ready context message.',
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
    const instruction = typeof inputs.instruction === 'string' && inputs.instruction.trim()
      ? `\n\nTask instruction:\n${inputs.instruction.trim()}`
      : '';
    const message = `${stringifyEnvironmentObservation(effectiveObservation, systemPrompt)}${instruction}`;

    return {
      message,
      messages: [{
        role: 'user',
        content: images.length
          ? [{ type: 'text', text: message }, ...images]
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
      },
      location,
      map,
      images,
      availableActions: effectiveObservation.capabilities.actions,
    };
  },
});
