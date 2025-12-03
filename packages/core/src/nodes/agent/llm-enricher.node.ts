/**
 * LLM Enricher Node
 *
 * Calls LLM to extract tags and entities from memory content
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
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
      keepAlive: 0, // Unload model immediately - background agent shouldn't hog VRAM
    });

    let enrichment = { tags: [], entities: [] };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        enrichment = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn('[LLMEnricher] Failed to parse JSON:', parseError);
    }

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
      memory,
    };
  }
};

export const LLMEnricherNode: NodeDefinition = defineNode({
  id: 'llm_enricher',
  name: 'LLM Enricher',
  category: 'agent',
  inputs: [
    { name: 'memory', type: 'memory', description: 'Memory to enrich' },
  ],
  outputs: [
    { name: 'memory', type: 'memory', description: 'Enriched memory with tags/entities' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    promptTemplate: 'Analyze this memory and extract relevant tags and entities...',
  },
  description: 'Uses LLM to extract tags and entities from memory content',
  execute,
});
