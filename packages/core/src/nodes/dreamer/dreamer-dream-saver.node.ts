/**
 * Dreamer Dream Saver Node
 * Canonical persistence owner for an initial dream and its continuations.
 */

import { createHash } from 'node:crypto';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';

interface Memory {
  id: string;
}

interface ContinuationInput {
  dream: string;
  thinking?: string;
  index: number;
}

interface BufferEntry {
  role: 'dream' | 'daydream' | 'reasoning';
  content: string;
  meta: Record<string, unknown>;
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

export function normalizeDreamContinuations(value: unknown): ContinuationInput[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).dreams)
      ? (value as Record<string, unknown>).dreams as unknown[]
      : [];

  return candidates.flatMap((candidate, position) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      return [{ dream: candidate.trim(), index: position + 1 }];
    }
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const dream = typeof record.dream === 'string' ? record.dream.trim() : '';
    if (!dream) return [];
    const thinking = typeof record.thinking === 'string' ? record.thinking.trim() : '';
    const index = typeof record.index === 'number' && Number.isInteger(record.index) && record.index > 0
      ? record.index
      : position + 1;
    return [{ dream, ...(thinking ? { thinking } : {}), index }];
  });
}

function idempotencyKey(role: BufferEntry['role'], content: string): string {
  return `dreamer:${createHash('sha256').update(`${role}\0${content}`).digest('hex')}`;
}

function reasoningEntry(content: string, dialogueSource: string): BufferEntry {
  return {
    role: 'reasoning',
    content,
    meta: {
      type: 'reasoning',
      source: 'agent',
      dialogueSource,
      displayColor: '#8b5cf6',
      idempotencyKey: idempotencyKey('reasoning', content),
    },
  };
}

function dreamEntry(
  role: 'dream' | 'daydream',
  content: string,
  eventId?: string,
  continuationIndex?: number,
): BufferEntry {
  return {
    role,
    content,
    meta: {
      type: role,
      source: 'agent',
      dialogueSource: continuationIndex ? 'dreamer-continuation' : role === 'daydream' ? 'daydreamer' : 'dreamer',
      ...(eventId && eventId !== 'duplicate' ? { memoryEventId: eventId } : {}),
      ...(continuationIndex ? { continuation: true, continuationIndex } : {}),
      idempotencyKey: idempotencyKey(role, content),
    },
  };
}

function auditCapture(
  type: 'dream' | 'daydream',
  content: string,
  result: CaptureResult,
  sourceCount: number,
  username: string,
  continuationIndex?: number,
): void {
  const deduplicated = result.deduplicated === true;
  audit({
    level: 'info',
    category: 'decision',
    event: deduplicated ? `${type}_deduplicated` : `${type}_generated`,
    message: deduplicated
      ? `${type === 'daydream' ? 'Daydreamer' : 'Dreamer'} reused a recent matching ${type}`
      : `${type === 'daydream' ? 'Daydreamer' : 'Dreamer'} persisted new ${type}`,
    details: {
      sourceCount,
      contentLength: content.length,
      eventId: result.eventId,
      deduplicated,
      ...(continuationIndex ? { continuationIndex } : {}),
      username,
    },
    actor: type === 'daydream' ? 'daydreamer' : 'dreamer',
  });
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
  const type = properties?.type === 'daydream' ? 'daydream' : 'dream';
  const initialThinking = typeof inputs.thinkingData === 'string' ? inputs.thinkingData.trim() : '';
  const continuations = normalizeDreamContinuations(inputs.continuationsData);

  if (!dream || typeof dream !== 'string') {
    return {
      saved: false,
      error: 'No dream content provided',
    };
  }

  if (!username || typeof username !== 'string') {
    throw new Error('Dream persistence requires an authenticated username');
  }

  try {
    const captureResult = captureEventWithDetails(dream, {
      type,
      metadata: {
        sources: sourceIds,
        confidence: 0.7,
      },
    });
    auditCapture(type, dream, captureResult, sourceIds.length, username);

    const eventIds = [captureResult.eventId];
    const dreams = [dream];
    const bufferEntries: BufferEntry[] = [];
    if (initialThinking) bufferEntries.push(reasoningEntry(initialThinking, 'dreamer'));
    bufferEntries.push(dreamEntry(type, dream, captureResult.eventId));

    let parentEventId = captureResult.eventId === 'duplicate' ? undefined : captureResult.eventId;
    let deduplicatedCount = captureResult.deduplicated === true ? 1 : 0;
    for (const continuation of continuations) {
      const continuationResult = captureEventWithDetails(continuation.dream, {
        type: 'dream',
        metadata: {
          continuation: true,
          continuationIndex: continuation.index,
          ...(parentEventId ? { parentEventId } : {}),
          confidence: 0.6,
          sources: sourceIds,
        },
      });
      auditCapture(
        'dream',
        continuation.dream,
        continuationResult,
        sourceIds.length,
        username,
        continuation.index,
      );
      if (continuation.thinking) {
        bufferEntries.push(reasoningEntry(continuation.thinking, 'dreamer-continuation'));
      }
      bufferEntries.push(dreamEntry('dream', continuation.dream, continuationResult.eventId, continuation.index));
      dreams.push(continuation.dream);
      eventIds.push(continuationResult.eventId);
      if (continuationResult.deduplicated === true) deduplicatedCount++;
      if (continuationResult.eventId !== 'duplicate') parentEventId = continuationResult.eventId;
    }

    return {
      saved: true,
      eventId: captureResult.eventId,
      eventIds,
      dream,
      dreams,
      savedCount: dreams.length,
      bufferEntries,
      sourceCount: sourceIds.length,
      deduplicated: captureResult.deduplicated === true,
      deduplicatedCount,
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
    { name: 'thinkingData', type: 'string', optional: true, description: 'Reasoning associated with the initial dream' },
    { name: 'continuationsData', type: 'array', optional: true, description: 'Ordered continuation dreams' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Source memories' },
    { name: 'sourceIds', type: 'array', optional: true, description: 'Source memory event IDs' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' },
    { name: 'eventId', type: 'string' },
    { name: 'eventIds', type: 'array' },
    { name: 'dream', type: 'string' },
    { name: 'dreams', type: 'array' },
    { name: 'savedCount', type: 'number' },
    { name: 'bufferEntries', type: 'array' },
    { name: 'sourceCount', type: 'number' },
    { name: 'deduplicated', type: 'boolean' },
    { name: 'deduplicatedCount', type: 'number' },
    { name: 'username', type: 'string' },
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
  description: 'Persists one bounded dream sequence and prepares its canonical inner-dialogue admissions',
  execute,
});
