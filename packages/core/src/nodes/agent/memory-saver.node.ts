/** Persists Organizer enrichment through Core's memory owner. */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { updateEpisodicMemoryMetadata } from '../../memory.js';

const execute: NodeExecutor = async (inputs, context) => {
  const memory = inputs.memory;
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new Error('Enriched Organizer memory is required');
  }
  const username = typeof context.username === 'string' ? context.username.trim() : '';
  if (!username) throw new Error('Organizer memory save requires a resolved username');
  if (typeof memory.id !== 'string' || typeof memory.relativePath !== 'string') {
    throw new Error('Organizer memory save requires id and relativePath');
  }
  if (!memory.metadata || memory.metadata.processed !== true
      || typeof memory.metadata.processedAt !== 'string') {
    throw new Error('Organizer memory save requires completed enrichment metadata');
  }
  const outcome = inputs.outcome === 'skipped' ? 'skipped' : 'updated';
  const organizerStatus = memory.metadata.organizerStatus;
  if (organizerStatus !== 'updated'
      && organizerStatus !== 'skipped'
      && organizerStatus !== 'no-content') {
    throw new Error('Organizer memory save received an invalid enrichment status');
  }
  const updated = updateEpisodicMemoryMetadata({
    username,
    relativePath: memory.relativePath,
    expectedId: memory.id,
    tags: memory.tags,
    entities: memory.entities,
    metadata: {
      processed: true,
      processedAt: memory.metadata.processedAt,
      model: typeof memory.metadata.model === 'string' ? memory.metadata.model : undefined,
      organizerStatus,
    },
  });

  return {
    success: true,
    relativePath: updated.relativePath,
    encrypted: updated.encrypted,
    outcome,
  };
};

export const MemorySaverNode: NodeDefinition = defineNode({
  id: 'memory_saver',
  name: 'Memory Saver',
  category: 'agent',
  inputs: [
    { name: 'memory', type: 'memory', description: 'Enriched memory with a Core-owned relative path' },
    { name: 'outcome', type: 'string', description: 'Whether enrichment updated or skipped this memory' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'relativePath', type: 'string' },
    { name: 'encrypted', type: 'boolean' },
    { name: 'outcome', type: 'string' },
  ],
  properties: {},
  description: 'Atomically updates enrichment metadata through Core memory persistence',
  execute,
});
