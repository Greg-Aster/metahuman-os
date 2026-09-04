/**
 * LLM Enricher Node
 *
 * Calls LLM to extract tags and entities from memory content
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { extractMemoryContent } from '../../memory-content-filter.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT = 'You are a memory curator. Extract structured metadata from memory content.';

const DEFAULT_PROMPT_TEMPLATE = `Analyze this memory and extract relevant tags and entities.

Memory: {{content}}

Return a JSON object with:
- tags: array of relevant keyword tags (3-7 tags)
- entities: array of entities mentioned (people, places, things)

Format: {"tags": [...], "entities": [...]}`;

export interface OrganizerAnalysis {
  tags: string[];
  entities: string[];
  summary?: string;
}

const GENERIC_TAGS = new Set(['ingested', 'inbox', 'ai', 'curated', 'audio', 'transcript']);
const MAX_VALUES = 50;
const MAX_VALUE_LENGTH = 100;

function normalizedValues(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`Organizer LLM ${label} must be an array of strings`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = item.trim().slice(0, MAX_VALUE_LENGTH);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_VALUES) break;
  }
  return result;
}

export function parseOrganizerAnalysis(
  content: string,
  options: { includeSummary?: boolean } = {},
): OrganizerAnalysis {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('Organizer LLM response did not contain a JSON object');
  }
  const parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Organizer LLM response must be a JSON object');
  }
  const result: OrganizerAnalysis = {
    tags: normalizedValues(parsed.tags, 'tags'),
    entities: normalizedValues(parsed.entities, 'entities'),
  };
  if (options.includeSummary) {
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
      throw new Error('Organizer LLM summary must be a non-empty string');
    }
    result.summary = parsed.summary.trim().slice(0, 4_000);
  }
  return result;
}

function mergeValues(existing: unknown, additions: string[]): string[] {
  const base = Array.isArray(existing) ? existing.filter(value => typeof value === 'string') : [];
  return normalizedValues([...base, ...additions], 'values');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Organizer enrichment cancelled', 'AbortError');
}

export async function enrichOrganizerMemory(
  memory: Record<string, any>,
  context: Record<string, any>,
  properties: Record<string, any> = {},
  call: typeof callLLM = callLLM,
): Promise<Record<string, any>> {
  const username = context.userId || context.username;
  const systemPrompt = properties?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const promptTemplate = properties?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const maxTokens = properties?.maxTokens ?? 512;
  const temperature = properties?.temperature ?? 0.3;
  const repeatPenalty = properties?.repeatPenalty ?? 1.15;
  const role = properties?.role ?? 'curator';

  if (!memory || typeof memory !== 'object' || typeof memory.content !== 'string') {
    throw new Error('Organizer memory content is required');
  }
  if (typeof username !== 'string' || !username.trim()) {
    throw new Error('Organizer enrichment requires a resolved user');
  }

  const timestamp = typeof context.organizerTimestamp === 'string'
    ? context.organizerTimestamp
    : new Date().toISOString();
  const extractedContent = extractMemoryContent(memory, 'all');
  const storedResponse = typeof memory.response === 'string' ? memory.response.trim() : '';
  const memoryContent = extractedContent && storedResponse && !extractedContent.includes(storedResponse)
    ? `${extractedContent}\n\nAssistant: ${storedResponse}`
    : extractedContent;
  if (!memoryContent) {
    return {
      memory: {
        ...memory,
        tags: mergeValues(memory.tags, []),
        entities: mergeValues(memory.entities, []),
        metadata: {
          ...memory.metadata,
          processed: true,
          processedAt: timestamp,
          organizerStatus: 'no-content',
        },
      },
      success: true,
      outcome: 'skipped',
    };
  }

  const includeSummary = context.organizerIncludeSummary === true;
  const extractEntities = context.organizerExtractEntities !== false;
  if (context.organizerSkipEnrichment === true) {
    return {
      memory: {
        ...memory,
        tags: mergeValues(memory.tags, []),
        entities: mergeValues(memory.entities, []),
        metadata: {
          ...memory.metadata,
          processed: true,
          processedAt: timestamp,
          organizerStatus: 'skipped',
        },
      },
      success: true,
      outcome: 'skipped',
      analysis: { tags: [], entities: [], ...(includeSummary ? { summary: '' } : {}) },
    };
  }

  throwIfAborted(context.abortSignal);
  const prompt = renderPromptTemplate(promptTemplate, { content: memoryContent, memory });
  const response = await call({
    role,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    userId: username,
    cognitiveMode: context.cognitiveMode || 'dual',
    options: { maxTokens, repeatPenalty, temperature, format: 'json' },
    keepAlive: 0,
  });
  throwIfAborted(context.abortSignal);

  const analysis = parseOrganizerAnalysis(response.content, { includeSummary });
  const reprocess = context.organizerReprocess === true;
  const baseTags = reprocess
    ? (Array.isArray(memory.tags) ? memory.tags.filter((tag: unknown) =>
      typeof tag === 'string' && GENERIC_TAGS.has(tag.toLowerCase())) : [])
    : memory.tags;
  const tags = mergeValues(baseTags, analysis.tags);
  const entities = mergeValues(
    reprocess ? [] : memory.entities,
    extractEntities ? analysis.entities : [],
  );
  const outcome = analysis.tags.length > 0 || analysis.entities.length > 0 ? 'updated' : 'skipped';

  return {
    memory: {
      ...memory,
      tags,
      entities,
      metadata: {
        ...memory.metadata,
        processed: true,
        processedAt: timestamp,
        model: response.modelId,
        organizerStatus: outcome,
      },
    },
    success: true,
    outcome,
    analysis,
  };
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  return enrichOrganizerMemory(inputs.memory, context, properties);
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
    { name: 'outcome', type: 'string', description: 'Updated or skipped' },
    { name: 'analysis', type: 'object', description: 'Validated tags and entities', optional: true },
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
