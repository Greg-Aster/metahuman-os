/**
 * Data Node Executors
 * Handles weighted sampling, associative chains, memory filtering, JSON parsing, templates, transforms, and caching
 */

import { searchMemory } from '../memory.js';
import type { NodeExecutor } from './types.js';

/**
 * Weighted Sampler Node
 * Samples memories using exponential decay weighting (used by reflector, dreamer, curiosity)
 */
export const weightedSamplerExecutor: NodeExecutor = async (_inputs, _context, properties) => {
  const decayFactor = properties?.decayFactor || 14; // Days for 50% weight reduction
  const sampleSize = properties?.sampleSize || 5;
  // TODO: const memoryType = properties?.memoryType; // Optional filter (not yet implemented)

  try {
    // Get all memories - searchMemory returns file paths
    const memoryPaths = searchMemory('');

    // For now, return paths with mock weighting
    // In production, this would load each memory file and apply real weighting
    const sampled = memoryPaths.slice(0, sampleSize);

    return {
      memoryPaths: sampled,
      count: sampled.length,
      decayFactor,
      // TODO: Implement actual memory loading and exponential decay weighting
      note: 'Mock implementation - needs memory file loading',
    };
  } catch (error) {
    console.error('[WeightedSampler] Error:', error);
    return {
      memoryPaths: [],
      count: 0,
      error: (error as Error).message,
    };
  }
};

/**
 * Associative Chain Node
 * Follows keyword connections between memories to build associative chains
 */
export const associativeChainExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const chainLength = properties?.chainLength || 5;
  const startMemory = inputs[0]?.memory || inputs[0];

  if (!startMemory) {
    return { chain: [], keywords: [] };
  }

  try {
    const chain = [startMemory];
    const usedKeywords: string[] = [];

    for (let i = 1; i < chainLength; i++) {
      const lastMemory = chain[chain.length - 1];

      // Extract keywords from last memory (tags, entities, or content keywords)
      const keywords = [
        ...(lastMemory.tags || []),
        ...(lastMemory.entities || []).map((e: any) => e.name || e),
      ];

      if (keywords.length === 0) break;

      // Pick a random keyword
      const keyword = keywords[Math.floor(Math.random() * keywords.length)];
      usedKeywords.push(keyword);

      // Search for memories containing this keyword (returns file paths)
      const resultPaths = searchMemory(keyword);

      // For now, just return paths (in production, would load and filter)
      const results = resultPaths.slice(0, 10);

      // Filter out already used memory paths
      const unused = results.filter(
        (path: string) => !chain.some((c: any) => c === path || c.path === path)
      );

      if (unused.length === 0) break;

      // Pick a random memory path from results
      const nextPath = unused[Math.floor(Math.random() * unused.length)];
      chain.push(nextPath);
    }

    return {
      chain,
      chainLength: chain.length,
      keywords: usedKeywords,
    };
  } catch (error) {
    console.error('[AssociativeChain] Error:', error);
    return {
      chain: [startMemory],
      chainLength: 1,
      keywords: [],
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Filter Node
 * Filters memories by type, tags, date range, or other criteria
 */
export const memoryFilterExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const memories = inputs[0]?.memories || inputs[0] || [];
  const filterType = properties?.filterType; // e.g., 'conversation', 'inner_dialogue'
  const filterTags = properties?.filterTags || []; // Array of required tags
  const startDate = properties?.startDate; // ISO date string
  const endDate = properties?.endDate; // ISO date string
  const limit = properties?.limit || 100;

  try {
    let filtered = Array.isArray(memories) ? memories : [];

    // Filter by type
    if (filterType) {
      filtered = filtered.filter((m: any) => m.type === filterType);
    }

    // Filter by tags (memory must have ALL specified tags)
    if (filterTags.length > 0) {
      filtered = filtered.filter((m: any) => {
        const memoryTags = m.tags || [];
        return filterTags.every((tag: string) => memoryTags.includes(tag));
      });
    }

    // Filter by date range
    if (startDate || endDate) {
      filtered = filtered.filter((m: any) => {
        const memoryDate = new Date(m.timestamp).getTime();
        const start = startDate ? new Date(startDate).getTime() : 0;
        const end = endDate ? new Date(endDate).getTime() : Date.now();
        return memoryDate >= start && memoryDate <= end;
      });
    }

    // Apply limit
    filtered = filtered.slice(0, limit);

    return {
      memories: filtered,
      count: filtered.length,
      filtered: true,
    };
  } catch (error) {
    console.error('[MemoryFilter] Error:', error);
    return {
      memories: [],
      count: 0,
      error: (error as Error).message,
    };
  }
};

/**
 * JSON Parser Node
 * Extracts JSON from text (useful for parsing LLM responses)
 */
export const jsonParserExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const text = inputs[0]?.text || inputs[0]?.response || inputs[0] || '';
  const fallback = properties?.fallback || null; // Value to return if parsing fails

  try {
    // Try to extract JSON from text
    // Look for JSON between code fences first
    let jsonText = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1];
    } else {
      // Try to find JSON object/array
      const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
    }

    const parsed = JSON.parse(jsonText);

    return {
      data: parsed,
      success: true,
      raw: text,
    };
  } catch (error) {
    console.warn('[JSONParser] Failed to parse JSON:', (error as Error).message);
    return {
      data: fallback,
      success: false,
      raw: text,
      error: (error as Error).message,
    };
  }
};

/**
 * Text Template Node
 * String interpolation with variable substitution
 */
export const textTemplateExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const template = properties?.template || '';
  const variables = inputs[0] || {};

  try {
    // Simple variable substitution: {{variableName}}
    let result = template;

    // Replace {{key}} with values from inputs
    const matches = template.match(/\{\{([^}]+)\}\}/g) || [];
    for (const match of matches) {
      const key = match.replace(/\{\{|\}\}/g, '').trim();
      const value = variables[key] ?? '';
      result = result.replace(match, String(value));
    }

    return {
      text: result,
      template,
      variables,
    };
  } catch (error) {
    console.error('[TextTemplate] Error:', error);
    return {
      text: template,
      error: (error as Error).message,
    };
  }
};

/**
 * Data Transform Node
 * Map/filter/reduce operations on arrays
 */
export const dataTransformExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const data = inputs[0] || [];
  const operation = properties?.operation || 'map'; // map, filter, reduce
  const field = properties?.field; // Field to extract/filter
  const condition = properties?.condition; // For filter
  const initialValue = properties?.initialValue; // For reduce

  try {
    if (!Array.isArray(data)) {
      throw new Error('Input must be an array');
    }

    let result: any;

    switch (operation) {
      case 'map':
        // Extract a specific field from each item
        result = field
          ? data.map((item: any) => item[field])
          : data;
        break;

      case 'filter':
        // Filter items based on a condition
        if (condition) {
          result = data.filter((item: any) => {
            // Simple equality check: {field: value}
            const [key, value] = Object.entries(condition)[0] || [];
            return item[key] === value;
          });
        } else {
          // Filter out null/undefined/empty
          result = data.filter((item: any) => item != null && item !== '');
        }
        break;

      case 'reduce':
        // Simple reduce: sum, count, concat
        const reduceOp = properties?.reduceOperation || 'count';
        if (reduceOp === 'count') {
          result = data.length;
        } else if (reduceOp === 'sum' && field) {
          result = data.reduce((sum: number, item: any) => sum + (Number(item[field]) || 0), 0);
        } else if (reduceOp === 'concat' && field) {
          result = data.map((item: any) => item[field]).join(', ');
        } else {
          result = initialValue || 0;
        }
        break;

      case 'unique':
        // Remove duplicates
        result = [...new Set(data)];
        break;

      case 'sort':
        // Sort by field
        result = field
          ? [...data].sort((a: any, b: any) => {
              const aVal = a[field];
              const bVal = b[field];
              if (aVal < bVal) return -1;
              if (aVal > bVal) return 1;
              return 0;
            })
          : [...data].sort();
        break;

      default:
        result = data;
    }

    return {
      result,
      operation,
      count: Array.isArray(result) ? result.length : 1,
    };
  } catch (error) {
    console.error('[DataTransform] Error:', error);
    return {
      result: data,
      error: (error as Error).message,
    };
  }
};

/**
 * Cache Node
 * Stores intermediate results with TTL
 */
const cacheStore = new Map<string, { value: any; expiry: number }>();

export const cacheExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const key = properties?.key || 'default';
  const ttl = properties?.ttl || 60000; // Default 1 minute
  const operation = properties?.operation || 'get'; // get, set, clear

  try {
    switch (operation) {
      case 'set':
        const value = inputs[0];
        cacheStore.set(key, {
          value,
          expiry: Date.now() + ttl,
        });
        return {
          cached: true,
          key,
          ttl,
        };

      case 'get':
        const cached = cacheStore.get(key);
        if (cached && cached.expiry > Date.now()) {
          return {
            value: cached.value,
            hit: true,
            key,
          };
        } else {
          cacheStore.delete(key);
          return {
            value: null,
            hit: false,
            key,
          };
        }

      case 'clear':
        cacheStore.delete(key);
        return {
          cleared: true,
          key,
        };

      case 'clear_all':
        cacheStore.clear();
        return {
          cleared: true,
          count: 0,
        };

      default:
        return {
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[Cache] Error:', error);
    return {
      error: (error as Error).message,
    };
  }
};
