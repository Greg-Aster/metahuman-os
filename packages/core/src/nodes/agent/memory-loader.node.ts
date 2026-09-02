/** Supplies one Core-owned memory record to the Organizer graph. */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, context) => {
  const memory = context.organizerMemory;
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new Error('Organizer graph requires a memory supplied by the Organizer agent');
  }
  if (typeof memory.id !== 'string' || !memory.id.trim()) {
    throw new Error('Organizer memory requires a stable id');
  }
  if (typeof memory.relativePath !== 'string' || !memory.relativePath.trim()) {
    throw new Error('Organizer memory requires a Core-owned relative path');
  }

  return { memory };
};

export const MemoryLoaderNode: NodeDefinition = defineNode({
  id: 'memory_loader',
  name: 'Organizer Memory Input',
  category: 'agent',
  inputs: [],
  outputs: [
    { name: 'memory', type: 'memory', description: 'One Core-owned episodic memory record' },
  ],
  properties: {},
  description: 'Accepts one validated memory selected by the canonical Organizer agent',
  execute,
});
