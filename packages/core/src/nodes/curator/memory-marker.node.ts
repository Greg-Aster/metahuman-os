/**
 * Memory Marker Node
 * Marks original episodic memories as curated
 */

import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { readCapturedEpisodicEvent, episodicSourceHash, updateEpisodicMemoryMetadata } from '../../memory.js';
import { resolvePath } from '../../storage-client.js';
import { CURATOR_POLICY_VERSION, parseStoredCuratedMemory, isSuccessfulCuration, sourcePathsForResult, type CuratorItemResult } from './contracts.js';
import { curatedRecordFilename, readCuratedMemory } from './curated-store.js';

export interface MarkCuratedResult {
  markedCount: number;
  alreadyMarkedCount: number;
  sourceMarkedCount: number;
  sourceAlreadyMarkedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  markedPaths: string[];
}

export function markCuratedResults(curatedResults: CuratorItemResult[], username: string): MarkCuratedResult {
  const resolved = resolvePath({ username, category: 'memory', subcategory: 'episodic' });
  if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Cannot resolve episodic storage');
  let markedCount = 0;
  let alreadyMarkedCount = 0;
  let sourceMarkedCount = 0;
  let sourceAlreadyMarkedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  const markedPaths: string[] = [];
  const errors: string[] = [];

  for (const result of curatedResults) {
    if (!isSuccessfulCuration(result)) {
      errors.push(`${result.memoryId}: ${result.error || 'curation failed'}`);
      continue;
    }

    const originalMemoryPaths = sourcePathsForResult(result);
    if (originalMemoryPaths.length === 0) {
      errors.push(`${result.memoryId}: missing original memory path`);
      continue;
    }

    const curatorRecordFile = curatedRecordFilename(result.curated);
    try {
      const saved = readCuratedMemory(username, curatorRecordFile);
      if (saved.provenance?.policyVersion !== CURATOR_POLICY_VERSION
          || JSON.stringify(saved) !== JSON.stringify(parseStoredCuratedMemory(result.curated))) {
        throw new Error('The reviewed decision has not been durably saved');
      }
    } catch (error) {
      errors.push(`${result.memoryId}: ${(error as Error).message}`);
      continue;
    }

    let unitChanged = false;
    let unitFailed = false;
    for (const originalMemoryPath of originalMemoryPaths) {
      try {
        const memory = readCapturedEpisodicEvent(username, originalMemoryPath);
        const metadata = memory.metadata && typeof memory.metadata === 'object' && !Array.isArray(memory.metadata)
          ? memory.metadata
          : {};
        const curationStatus = result.disposition;
        const curatorSourceHash = result.curated.provenance!.sourceHashes[memory.id];
        if (!curatorSourceHash || episodicSourceHash(memory) !== curatorSourceHash) {
          throw new Error('Source changed after Curator review');
        }
        const unchanged = metadata.curated === true
          && metadata.curatorRecordId === result.curated.id
          && metadata.curatorRecordFile === curatorRecordFile
          && metadata.curatorPolicyVersion === CURATOR_POLICY_VERSION
          && metadata.curatorSourceHash === curatorSourceHash
          && metadata.curationStatus === curationStatus;

        if (unchanged) {
          sourceAlreadyMarkedCount++;
        } else {
          updateEpisodicMemoryMetadata({
            username,
            relativePath: path.relative(resolved.path!, originalMemoryPath),
            expectedId: memory.id,
            metadata: {
              curated: true, curatedAt: result.curated.curatedAt,
              curatorRecordId: result.curated.id, curatorRecordFile,
              curatorSourceHash, curatorPolicyVersion: CURATOR_POLICY_VERSION, curationStatus,
            },
          });
          sourceMarkedCount++;
          unitChanged = true;
        }
        markedPaths.push(originalMemoryPath);
      } catch (error) {
        unitFailed = true;
        errors.push(`${result.memoryId} (${originalMemoryPath}): ${(error as Error).message}`);
      }
    }

    if (unitFailed) continue;
    if (unitChanged) markedCount++;
    else alreadyMarkedCount++;
    if (result.disposition === 'accepted') acceptedCount++;
    else rejectedCount++;
  }

  if (errors.length > 0) {
    throw new Error(`Curator left ${errors.length} memory record(s) retryable: ${errors.join('; ')}`);
  }

  return {
    markedCount,
    alreadyMarkedCount,
    sourceMarkedCount,
    sourceAlreadyMarkedCount,
    acceptedCount,
    rejectedCount,
    markedPaths,
  };
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  if (!context.userId) throw new Error('Curator requires a userId to mark source memories');
  // Inputs are keyed by targetHandle name from graph edges, not array index
  const curatedResults = inputs.curatedMemories?.curatedMemories || inputs.curatedMemories || inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    return {
      success: true,
      markedCount: 0,
      alreadyMarkedCount: 0,
      sourceMarkedCount: 0,
      sourceAlreadyMarkedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      markedPaths: [],
    };
  }

  return {
    success: true,
    ...markCuratedResults(curatedResults as CuratorItemResult[], context.userId!),
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
    { name: 'sourceMarkedCount', type: 'number' },
    { name: 'sourceAlreadyMarkedCount', type: 'number' },
    { name: 'acceptedCount', type: 'number' },
    { name: 'rejectedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Marks original episodic memories as curated',
  execute,
});
