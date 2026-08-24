/**
 * Memory Marker Node
 * Marks original episodic memories as curated
 */

import fs from 'node:fs';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { writeJsonAtomically } from './atomic-json.js';
import { isSuccessfulCuration, type CuratorItemResult } from './contracts.js';

export interface MarkCuratedResult {
  markedCount: number;
  alreadyMarkedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  markedPaths: string[];
}

export function markCuratedResults(curatedResults: CuratorItemResult[]): MarkCuratedResult {
  let markedCount = 0;
  let alreadyMarkedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  const markedPaths: string[] = [];
  const errors: string[] = [];

  for (const result of curatedResults) {
    if (!isSuccessfulCuration(result)) {
      errors.push(`${result.memoryId}: ${result.error || 'curation failed'}`);
      continue;
    }

    const originalMemoryPath = result.originalMemoryPath;
    if (!originalMemoryPath) {
      errors.push(`${result.memoryId}: missing original memory path`);
      continue;
    }

    try {
      const memory = JSON.parse(fs.readFileSync(originalMemoryPath, 'utf-8'));
      const metadata = memory.metadata && typeof memory.metadata === 'object' && !Array.isArray(memory.metadata)
        ? memory.metadata
        : {};
      const curationStatus = result.disposition;
      const unchanged = metadata.curated === true
        && metadata.curatorRecordId === result.curated.id
        && metadata.curationStatus === curationStatus;

      if (unchanged) {
        alreadyMarkedCount++;
      } else {
        memory.metadata = {
          ...metadata,
          curated: true,
          curatedAt: typeof metadata.curatedAt === 'string' ? metadata.curatedAt : result.curated.curatedAt,
          curatorRecordId: result.curated.id,
          curationStatus,
        };
        writeJsonAtomically(originalMemoryPath, memory);
        markedCount++;
      }

      if (result.disposition === 'accepted') acceptedCount++;
      else rejectedCount++;
      markedPaths.push(originalMemoryPath);
    } catch (error) {
      errors.push(`${result.memoryId}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Curator left ${errors.length} memory record(s) retryable: ${errors.join('; ')}`);
  }

  return { markedCount, alreadyMarkedCount, acceptedCount, rejectedCount, markedPaths };
}

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  // Inputs are keyed by targetHandle name from graph edges, not array index
  const curatedResults = inputs.curatedMemories?.curatedMemories || inputs.curatedMemories || inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    return {
      success: true,
      markedCount: 0,
      alreadyMarkedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      markedPaths: [],
    };
  }

  return {
    success: true,
    ...markCuratedResults(curatedResults as CuratorItemResult[]),
  };
};

export const MemoryMarkerNode: NodeDefinition = defineNode({
  id: 'memory_marker',
  name: 'Memory Marker',
  category: 'curator',
  inputs: [
    { name: 'curatedMemories', type: 'object', description: 'Curated memories' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'markedCount', type: 'number' },
    { name: 'alreadyMarkedCount', type: 'number' },
    { name: 'acceptedCount', type: 'number' },
    { name: 'rejectedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Marks original episodic memories as curated',
  execute,
});
