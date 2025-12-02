/**
 * Semantic Search Node
 *
 * Searches episodic memory for relevant context using vector embeddings
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { queryIndex } from '../../vector-index.js';

export const SemanticSearchNode: NodeDefinition = defineNode({
  id: 'semantic_search',
  name: 'Semantic Search',
  category: 'context',
  inputs: [
    { name: 'query', type: 'string', description: 'Search query' },
  ],
  outputs: [
    { name: 'memories', type: 'array', description: 'Relevant memory results' },
    { name: 'query', type: 'string', description: 'Passthrough query' },
  ],
  properties: {
    topK: 8,
    threshold: 0.6,
  },
  propertySchemas: {
    topK: {
      type: 'slider',
      default: 8,
      label: 'Top K Results',
      description: 'Maximum number of results to return',
      min: 1,
      max: 20,
      step: 1,
    },
    threshold: {
      type: 'slider',
      default: 0.6,
      label: 'Similarity Threshold',
      description: 'Minimum similarity score (0-1)',
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  description: 'Searches episodic memory for relevant context',

  execute: async (inputs, context, properties) => {
    const query = inputs[0] || context.userMessage || '';
    const topK = properties?.topK || properties?.limit || 8;
    const threshold = properties?.threshold || 0.6;

    // Use cached context if available
    if (context.contextPackage?.memories) {
      return {
        memories: context.contextPackage.memories,
        query,
        fromCache: true,
      };
    }

    try {
      const results = await queryIndex(query, { topK });

      return {
        memories: results
          .filter(r => r.score >= threshold)
          .map(r => ({
            content: r.item.text || '',
            timestamp: r.item.timestamp,
            type: r.item.type || 'observation',
            score: r.score,
          })),
        query,
      };
    } catch (error) {
      console.error('[SemanticSearch] Error:', error);
      return {
        memories: [],
        query,
        error: (error as Error).message,
      };
    }
  },
});
