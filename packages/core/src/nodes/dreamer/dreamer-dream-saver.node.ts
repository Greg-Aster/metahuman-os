/**
 * Dreamer Dream Saver Node
 * Saves generated dream to episodic memory as type 'dream'
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { captureEventWithDetails } from '../../memory.js';
// Inner Dialogue Buffer admission is handled by the designated downstream node.

interface Memory {
  id: string;
}

export function resolveDreamSourceIds(inputs: Record<string, any>): string[] {
  const explicitIds = Array.isArray(inputs.sourceIds) ? inputs.sourceIds : [];
  const memoriesInput = inputs.memoriesData?.memories ?? inputs.memoriesData;
  const memoryIds = Array.isArray(memoriesInput)
    ? memoriesInput.map((memory: Memory) => memory?.id)
    : [];
  return Array.from(new Set([...explicitIds, ...memoryIds]
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    .map(id => id.trim())));
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // inputs is an object keyed by handle name, not an array
  const dreamInput = inputs.dreamData;
  const dream = dreamInput?.dream || dreamInput;
  const sourceIds = resolveDreamSourceIds({
    ...inputs,
    sourceIds: [...(Array.isArray(dreamInput?.sourceIds) ? dreamInput.sourceIds : []),
      ...(Array.isArray(inputs.sourceIds) ? inputs.sourceIds : [])],
  });
  const username = context.userId || context.username;
  const type = properties?.type || 'dream';

  if (!dream || typeof dream !== 'string') {
    return {
      saved: false,
      error: 'No dream content provided',
    };
  }

  try {
    const captureResult = captureEventWithDetails(dream, {
      type,
      metadata: {
        sources: sourceIds,
        confidence: 0.7,
      },
    });

    const deduplicated = captureResult.deduplicated === true;
    audit({
      level: 'info',
      category: 'decision',
      event: deduplicated ? `${type}_deduplicated` : `${type}_generated`,
      message: deduplicated
        ? `${type === 'daydream' ? 'Daydreamer' : 'Dreamer'} reused a recent matching ${type}`
        : `${type === 'daydream' ? 'Daydreamer' : 'Dreamer'} persisted new ${type}`,
      details: {
        sourceCount: sourceIds.length,
        contentLength: dream.length,
        eventId: captureResult.eventId,
        deduplicated,
        username,
      },
      actor: type === 'daydream' ? 'daydreamer' : 'dreamer',
    });

    // The downstream Inner Dialogue Buffer node persists the dream once.

    return {
      saved: true,
      eventId: captureResult.eventId,
      dream,
      sourceCount: sourceIds.length,
      deduplicated,
      username,
    };
  } catch (error) {
    console.error('[DreamerDreamSaver] Error:', error);
    throw error;
  }
};

export const DreamerDreamSaverNode: NodeDefinition = defineNode({
  id: 'dreamer_dream_saver',
  name: 'Dreamer Dream Saver',
  category: 'dreamer',
  inputs: [
    { name: 'dreamData', type: 'object', description: 'Dream text from generator' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Source memories' },
    { name: 'sourceIds', type: 'array', optional: true, description: 'Source memory event IDs' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' },
    { name: 'eventId', type: 'string' },
    { name: 'dream', type: 'string' },
    { name: 'sourceCount', type: 'number' },
    { name: 'deduplicated', type: 'boolean' },
  ],
  properties: {
    type: 'dream',
  },
  propertySchemas: {
    type: {
      type: 'string',
      default: 'dream',
      label: 'Memory Type',
    },
  },
  description: 'Saves generated dream to episodic memory',
  execute,
});
