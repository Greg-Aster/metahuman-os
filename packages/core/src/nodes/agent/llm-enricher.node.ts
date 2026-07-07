/**
 * LLM Enricher Node
 *
 * Calls LLM to extract tags and entities from memory content
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT = 'You are a memory curator. Extract structured metadata from memory content.';

const DEFAULT_PROMPT_TEMPLATE = `Analyze this memory and extract relevant tags and entities.

Memory: {{content}}

Return a JSON object with:
- tags: array of relevant keyword tags (3-7 tags)
- entities: array of entities mentioned (people, places, things)

Format: {"tags": [...], "entities": [...]}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const memory = inputs.memory || inputs[0];
  const username = context.userId || context.username;
  const systemPrompt = properties?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const promptTemplate = properties?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const maxTokens = properties?.maxTokens ?? 512;
  const temperature = properties?.temperature ?? 0.3;
  const repeatPenalty = properties?.repeatPenalty ?? 1.15;
  const role = properties?.role ?? 'curator';

  if (!memory || !memory.content) {
    return {
      success: false,
      error: 'Memory content required',
    };
  }

  try {
    const prompt = renderPromptTemplate(promptTemplate, { content: memory.content, memory });

    const response = await callLLM({
      role,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      userId: username,
      cognitiveMode: context.cognitiveMode || 'dual',
      options: {
        maxTokens,
        repeatPenalty,
        temperature,
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
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    role: 'curator',
    temperature: 0.3,
    maxTokens: 512,
    repeatPenalty: 1.15,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT,
      label: 'System Prompt',
      rows: 4,
    },
    promptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_PROMPT_TEMPLATE,
      label: 'Prompt Template',
      description: 'Template variables: {{content}}, {{memory}}.',
      rows: 10,
    },
    role: {
      type: 'string',
      default: 'curator',
      label: 'LLM Role',
    },
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
    },
    maxTokens: {
      type: 'number',
      default: 512,
      label: 'Max Tokens',
    },
    repeatPenalty: {
      type: 'number',
      default: 1.15,
      label: 'Repeat Penalty',
    },
  },
  description: 'Uses LLM to extract tags and entities from memory content',
  execute,
});
