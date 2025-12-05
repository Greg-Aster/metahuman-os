/**
 * Desire Memory Analyzer Node
 *
 * Loads recent memories that haven't been analyzed for desires yet.
 * Uses the generator scratchpad to track which memories have been processed.
 *
 * Inputs:
 *   - (none - loads from storage)
 *
 * Outputs:
 *   - memories: Array of unanalyzed memory objects
 *   - count: Number of memories to analyze
 *   - hasMore: Whether more unanalyzed memories exist
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { searchMemory } from '../../memory.js';
import {
  loadGeneratorScratchpad,
  markMemoriesAsAnalyzed,
} from '../../agency/storage.js';

interface MemoryObject {
  path: string;
  id: string;
  content: string;
  timestamp?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const limit = (properties?.limit as number) || 20;
  const daysBack = (properties?.daysBack as number) || 7;
  const markAsAnalyzed = properties?.markAsAnalyzed !== false;

  const username = context.username as string | undefined;

  try {
    // Load generator scratchpad to see what's been analyzed
    const scratchpad = await loadGeneratorScratchpad(username);
    const analyzedSet = new Set(scratchpad.analyzedMemoryIds);

    // Get all memories
    const fs = await import('fs');
    const path = await import('path');
    const memoryPaths = searchMemory('');

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const memories: MemoryObject[] = [];
    const analyzedIds: string[] = [];

    for (const memoryPath of memoryPaths) {
      try {
        // Extract ID from path
        const memoryId = path.basename(memoryPath, '.json');

        // Skip if already analyzed
        if (analyzedSet.has(memoryId)) {
          continue;
        }

        // Load memory content
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const memory = JSON.parse(content);

        // Skip memories older than cutoff
        if (memory.timestamp) {
          const memoryDate = new Date(memory.timestamp);
          if (memoryDate < cutoffDate) {
            continue;
          }
        }

        // Skip inner_dialogue type (these are internal reflections, not user desires)
        if (memory.type === 'inner_dialogue') {
          // Mark as analyzed so we don't keep checking it
          analyzedIds.push(memoryId);
          continue;
        }

        memories.push({
          path: memoryPath,
          id: memoryId,
          content: memory.content || memory.text || JSON.stringify(memory),
          timestamp: memory.timestamp,
          type: memory.type,
          metadata: memory.metadata,
        });

        analyzedIds.push(memoryId);

        if (memories.length >= limit) {
          break;
        }
      } catch (error) {
        console.warn(`[desire-memory-analyzer] Failed to load ${memoryPath}:`, error);
      }
    }

    // Mark memories as analyzed to prevent reprocessing
    if (markAsAnalyzed && analyzedIds.length > 0) {
      await markMemoriesAsAnalyzed(analyzedIds, username);
    }

    console.log(`[desire-memory-analyzer] Found ${memories.length} unanalyzed memories`);

    return {
      memories,
      count: memories.length,
      hasMore: memoryPaths.length > memories.length + analyzedSet.size,
      analyzedCount: analyzedSet.size,
      totalMemories: memoryPaths.length,
    };
  } catch (error) {
    console.error('[desire-memory-analyzer] Error:', error);
    return {
      memories: [],
      count: 0,
      hasMore: false,
      error: (error as Error).message,
    };
  }
};

export const DesireMemoryAnalyzerNode: NodeDefinition = defineNode({
  id: 'desire_memory_analyzer',
  name: 'Analyze Memories for Desires',
  category: 'agency',
  description: 'Loads recent unanalyzed memories for desire detection',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of unanalyzed memory objects' },
    { name: 'count', type: 'number', description: 'Number of memories to analyze' },
    { name: 'hasMore', type: 'boolean', description: 'Whether more unanalyzed memories exist' },
    { name: 'analyzedCount', type: 'number', optional: true, description: 'Total already analyzed' },
    { name: 'totalMemories', type: 'number', optional: true, description: 'Total memories in system' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    limit: 20,
    daysBack: 7,
    markAsAnalyzed: true,
  },
  propertySchemas: {
    limit: {
      type: 'number',
      default: 20,
      label: 'Limit',
      description: 'Maximum memories to load per run',
    },
    daysBack: {
      type: 'number',
      default: 7,
      label: 'Days Back',
      description: 'Only analyze memories from the last N days',
    },
    markAsAnalyzed: {
      type: 'boolean',
      default: true,
      label: 'Mark as Analyzed',
      description: 'Update generator scratchpad with analyzed memory IDs',
    },
  },
  execute,
});

export default DesireMemoryAnalyzerNode;
