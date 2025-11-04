/**
 * search_index Skill
 * Perform semantic search over the memory index
 */

import { SkillManifest, SkillResult } from '../../packages/core/src/skills.js';
import { queryIndex } from '../../packages/core/src/vector-index.js';

export const manifest: SkillManifest = {
  id: 'search_index',
  name: 'Search Memory Index',
  description: 'Semantic search across episodic memory using vector embeddings',
  category: 'memory',

  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'Search query text',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Max number of results (default: 10)',
    },
    minSimilarity: {
      type: 'number',
      required: false,
      description: 'Minimum similarity threshold 0-1 (default: 0.5)',
    },
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of matching memories with similarity scores',
    },
    count: { type: 'number', description: 'Number of results returned' },
  },

  risk: 'low',
  cost: 'expensive',
  minTrustLevel: 'observe',
  requiresApproval: false,
};

export async function execute(inputs: {
  query: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<SkillResult> {
  try {
    const limit = inputs.limit ?? 10;
    const minSimilarity = inputs.minSimilarity ?? 0.5;

    // Query the vector index
    const results = await queryIndex(inputs.query, limit);

    // Filter by minimum similarity
    const filtered = results.filter(r => r.similarity >= minSimilarity);

    return {
      success: true,
      outputs: {
        results: filtered.map(r => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity,
          timestamp: r.timestamp,
        })),
        count: filtered.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Search failed: ${(error as Error).message}`,
    };
  }
}
