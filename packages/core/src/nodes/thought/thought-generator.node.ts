/**
 * Thought Generator Node
 * Generates a single reasoning step from memory context
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { loadPersonaCore } from '../../identity.js';
import { audit } from '../../audit.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are {{personaName}}, extending a private train of thought.

Generate one new connection, implication, or question from the supplied seed and any related historical memory excerpts. Do not merely restate the seed. Treat the seed as a thought to explore, not as proof that an event happened; only the related memory excerpts are historical evidence. State uncertainty instead of inventing details.
{{thoughtHistory}}
After your thought, provide:
1. A confidence score (0.0-1.0) for how insightful this thought is
2. 2-4 keywords or concepts that could lead to related thoughts

Respond in this format:
THOUGHT: [Your reflection - 1-3 sentences of genuine insight]
CONFIDENCE: [0.0-1.0]
KEYWORDS: [comma-separated keywords]`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Continue from this thought or memory context:

{{memoryContext}}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const input0 = inputs.context || {};
  const username = context.userId || context.username;

  const relatedMemories = Array.isArray(input0?.relatedMemories)
    ? input0.relatedMemories
      .filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value: string) => value.trim())
    : [];
  const directSeed = typeof inputs.seedMemory === 'string' ? inputs.seedMemory.trim() : '';
  const loopSeed = typeof input0?.seedMemory === 'string' ? input0.seedMemory.trim() : '';
  const contextSeed = typeof context.seedMemory === 'string' ? context.seedMemory.trim() : '';
  const seedMemory = loopSeed || directSeed || contextSeed;
  const memoryContext = relatedMemories.length > 0
    ? `${seedMemory}\n\nRelated historical memory excerpts:\n${relatedMemories.map((text: string, index: number) => `${index + 1}. ${text}`).join('\n')}`
    : seedMemory;

  const previousThoughts = Array.isArray(input0?.thoughts)
    ? input0.thoughts.filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
    : [];
  const temperature = properties?.temperature ?? 0.75;
  const maxTokens = properties?.maxTokens ?? 512;
  const repeatPenalty = properties?.repeatPenalty ?? 1.2;
  const role = properties?.role ?? 'persona';
  const extractKeywords = properties?.extractKeywords !== false;
  const systemPromptTemplate = properties?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;

  if (!memoryContext) {
    throw new Error('Thought Generator requires a seed or related memory context');
  }

  const persona = loadPersonaCore();
  const thoughtHistory = previousThoughts.length > 0
    ? `\nPrevious thoughts in this chain:\n${previousThoughts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  const systemPrompt = renderPromptTemplate(systemPromptTemplate, {
    personaName: persona.identity.name,
    thoughtHistory,
  });
  const userPrompt = renderPromptTemplate(userPromptTemplate, { memoryContext });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const response = await callLLM({
    role,
    messages,
    userId: username,
    cognitiveMode: context.cognitiveMode,
    options: {
      maxTokens,
      temperature,
      repeatPenalty,
    },
    onProgress: context.emitProgress,
  });

  const content = response.content?.trim() || '';
  if (!content) throw new Error('Thought Generator model returned empty content');
  const thoughtMatch = content.match(/THOUGHT:\s*(.+?)(?=\nCONFIDENCE:|$)/s);
  const confidenceMatch = content.match(/CONFIDENCE:\s*([\d.]+)/);
  const keywordsMatch = content.match(/KEYWORDS:\s*(.+?)$/s);

  const thought = thoughtMatch?.[1]?.trim() || content.split('\n')[0]?.trim() || '';
  if (thought.length < 10) throw new Error('Thought Generator model returned an unusably short thought');
  const parsedConfidence = Number.parseFloat(confidenceMatch?.[1] || '0.5');
  const confidence = Number.isFinite(parsedConfidence)
    ? Math.min(1, Math.max(0, parsedConfidence))
    : 0.5;
  const keywordsRaw = keywordsMatch?.[1]?.trim() || '';
  const keywords = extractKeywords && keywordsRaw
    ? [...new Set(keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 2))].slice(0, 4)
    : [];

  audit({
    level: 'info',
    category: 'decision',
    event: 'thought_generated',
    actor: 'train-of-thought',
    details: {
      confidence,
      keywordCount: keywords.length,
      iterationIndex: previousThoughts.length,
      sourceAgent: context.sourceAgent,
    },
  });

  const thoughtData = {
    thought,
    thoughts: [...previousThoughts, thought],
    keywords,
    confidence,
    seedMemory,
    seenMemoryIds: Array.isArray(input0?.seenMemoryIds) ? input0.seenMemoryIds : [],
  };

  return { thoughtData, ...thoughtData };
};

export const ThoughtGeneratorNode: NodeDefinition = defineNode({
  id: 'thought_generator',
  name: 'Thought Generator',
  category: 'thought',
  inputs: [
    { name: 'context', type: 'any', optional: true, description: 'Related memories and accumulated thought state' },
    { name: 'seedMemory', type: 'string', optional: true, description: 'Initial thought or memory seed' },
  ],
  outputs: [
    { name: 'thoughtData', type: 'object', description: 'Generated thought and accumulated chain state' },
    { name: 'thought', type: 'string', description: 'Generated thought' },
    { name: 'thoughts', type: 'array', description: 'Accumulated thoughts' },
    { name: 'keywords', type: 'array', description: 'Extracted keywords' },
    { name: 'confidence', type: 'number', description: 'Confidence score' },
  ],
  properties: {
    temperature: 0.75,
    extractKeywords: true,
    maxTokens: 512,
    repeatPenalty: 1.2,
    role: 'persona',
    timeout: 300000,
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.75,
      label: 'Temperature',
      description: 'LLM temperature',
    },
    extractKeywords: {
      type: 'boolean',
      default: true,
      label: 'Extract Keywords',
    },
    maxTokens: {
      type: 'number',
      default: 512,
      label: 'Max Tokens',
    },
    repeatPenalty: {
      type: 'number',
      default: 1.2,
      label: 'Repeat Penalty',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    timeout: {
      type: 'number',
      default: 300000,
      label: 'Execution Timeout (ms)',
      description: 'Maximum time allowed for this model node.',
      min: 1000,
      max: 900000,
      step: 1000,
      advanced: true,
    },
    systemPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt Template',
      description: 'Template variables: {{personaName}}, {{thoughtHistory}}.',
      rows: 13,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables: {{memoryContext}}.',
      rows: 5,
    },
  },
  description: 'Generates a single reasoning step from memory context',
  execute,
});
