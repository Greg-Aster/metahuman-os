/**
 * Memory Saver Node
 *
 * Saves enriched memory data back to file
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const memory = inputs[0];
  const updateOnly = properties?.updateOnly !== false;

  if (!memory || !memory.path) {
    return {
      success: false,
      error: 'Memory path required',
    };
  }

  try {
    const fs = await import('fs');

    let existingData = {};
    if (updateOnly) {
      try {
        const content = fs.readFileSync(memory.path, 'utf-8');
        existingData = JSON.parse(content);
      } catch (error) {
        console.warn('[MemorySaver] Could not read existing file:', error);
      }
    }

    const { path: _path, ...dataToSave } = memory;
    const mergedData = { ...existingData, ...dataToSave };

    fs.writeFileSync(memory.path, JSON.stringify(mergedData, null, 2), 'utf-8');

    return {
      success: true,
      path: memory.path,
      updated: true,
    };
  } catch (error) {
    console.error('[MemorySaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const MemorySaverNode: NodeDefinition = defineNode({
  id: 'memory_saver',
  name: 'Memory Saver',
  category: 'agent',
  inputs: [
    { name: 'memory', type: 'memory', description: 'Memory object to save (must include path)' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'path', type: 'string' },
  ],
  properties: {
    updateOnly: true,
  },
  propertySchemas: {
    updateOnly: {
      type: 'boolean',
      default: true,
      label: 'Update Only',
      description: 'Only update existing files, do not create new ones',
    },
  },
  description: 'Saves memory back to disk after enrichment',
  execute,
});
