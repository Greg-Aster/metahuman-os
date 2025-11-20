/**
 * Agent Node Executors
 * Handles memory loading/saving, LLM enrichment, and agent timing for autonomous agent workflows
 */

import { searchMemory } from '../memory.js';
import { callLLM } from '../model-router.js';
import type { NodeExecutor } from './types.js';

/**
 * Memory Loader Node
 * Loads unprocessed episodic memories for agent processing
 */
export const memoryLoaderExecutor: NodeExecutor = async (_inputs, _context, properties) => {
  const limit = properties?.limit || 10;
  const onlyUnprocessed = properties?.onlyUnprocessed !== false; // Default true

  try {
    const memories = searchMemory(''); // Get all memory file paths
    const fs = await import('fs');
    const path = await import('path');

    const loadedMemories: any[] = [];

    for (const memoryPath of memories.slice(0, limit * 2)) { // Load extra to account for filtering
      try {
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const memory = JSON.parse(content);

        // Filter based on processed status
        if (onlyUnprocessed && memory.metadata?.processed) {
          continue;
        }

        loadedMemories.push({
          path: memoryPath,
          id: path.basename(memoryPath, '.json'),
          ...memory,
        });

        if (loadedMemories.length >= limit) {
          break;
        }
      } catch (error) {
        console.warn(`[MemoryLoader] Failed to load ${memoryPath}:`, error);
      }
    }

    return {
      memories: loadedMemories,
      count: loadedMemories.length,
      hasMore: memories.length > loadedMemories.length,
    };
  } catch (error) {
    console.error('[MemoryLoader] Error:', error);
    return {
      memories: [],
      count: 0,
      hasMore: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Saver Node
 * Saves enriched memory data back to file
 */
export const memorySaverExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const memory = inputs[0];
  const updateOnly = properties?.updateOnly !== false; // Default true (don't create new files)

  if (!memory || !memory.path) {
    return {
      success: false,
      error: 'Memory path required',
    };
  }

  try {
    const fs = await import('fs');

    // Read existing file if updateOnly
    let existingData = {};
    if (updateOnly) {
      try {
        const content = fs.readFileSync(memory.path, 'utf-8');
        existingData = JSON.parse(content);
      } catch (error) {
        console.warn('[MemorySaver] Could not read existing file:', error);
      }
    }

    // Merge with new data (preserve path info but don't write it)
    const { path: _path, ...dataToSave } = memory;
    const mergedData = { ...existingData, ...dataToSave };

    // Write back to file
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

/**
 * LLM Enricher Node
 * Calls LLM to extract tags and entities from memory content
 */
export const llmEnricherExecutor: NodeExecutor = async (inputs, context, properties) => {
  const memory = inputs[0];
  const promptTemplate = properties?.promptTemplate || `Analyze this memory and extract relevant tags and entities.

Memory: {content}

Return a JSON object with:
- tags: array of relevant keyword tags (3-7 tags)
- entities: array of entities mentioned (people, places, things)

Format: {"tags": [...], "entities": [...]}`;

  if (!memory || !memory.content) {
    return {
      success: false,
      error: 'Memory content required',
    };
  }

  try {
    // Build prompt
    const prompt = promptTemplate.replace('{content}', memory.content);

    const response = await callLLM({
      role: 'curator',
      messages: [
        {
          role: 'system',
          content: 'You are a memory curator. Extract structured metadata from memory content.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      cognitiveMode: context.cognitiveMode || 'dual',
      options: {
        maxTokens: 512,
        repeatPenalty: 1.15,
        temperature: 0.3,
      },
    });

    // Parse JSON response
    let enrichment = { tags: [], entities: [] };
    try {
      // Try to extract JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        enrichment = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn('[LLMEnricher] Failed to parse JSON:', parseError);
    }

    // Return enriched memory
    return {
      success: true,
      memory: {
        ...memory,
        tags: enrichment.tags || [],
        entities: enrichment.entities || [],
        metadata: {
          ...memory.metadata,
          processed: true,
          processedAt: new Date().toISOString(),
        },
      },
    };
  } catch (error) {
    console.error('[LLMEnricher] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
      memory, // Return original memory
    };
  }
};

/**
 * Agent Timer Node
 * Provides timing information for scheduled agents
 */
export const agentTimerExecutor: NodeExecutor = async (_inputs, _context, properties) => {
  const intervalMs = properties?.intervalMs || 60000; // Default 1 minute

  return {
    currentTime: Date.now(),
    interval: intervalMs,
    nextRun: Date.now() + intervalMs,
  };
};
