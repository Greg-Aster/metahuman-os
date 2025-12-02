/**
 * Thought Generator Node
 * Generates a single reasoning step from memory context
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { loadPersonaCore } from '../../identity.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const input0 = inputs[0] || {};

  // Get memory context - could be from scratchpad (loop) or direct seed
  const memoryContext = input0?.seedMemory || input0?.text || inputs[1]?.text ||
                        (typeof input0 === 'string' ? input0 : '') ||
                        context.seedMemory || '';

  // Get accumulated thoughts from scratchpad
  const previousThoughts = input0?.thoughts || context.scratchpad?.thoughts || [];
  const temperature = properties?.temperature || 0.75;
  const extractKeywords = properties?.extractKeywords !== false;

  if (!memoryContext) {
    return {
      thought: '',
      thoughts: previousThoughts,
      keywords: [],
      confidence: 0,
      error: 'No memory context provided',
    };
  }

  try {
    const persona = loadPersonaCore();
    const thoughtHistory = previousThoughts.length > 0
      ? `\nPrevious thoughts in this chain:\n${previousThoughts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n`
      : '';

    const systemPrompt = properties?.systemPrompt || `You are ${persona.identity.name}, engaging in deep introspection and reasoning.

Your task is to generate a thoughtful reflection based on a memory or observation. Think deeply about connections, implications, and what this might mean.
${thoughtHistory}
After your thought, provide:
1. A confidence score (0.0-1.0) for how insightful this thought is
2. 2-4 keywords or concepts that could lead to related thoughts

Respond in this format:
THOUGHT: [Your reflection - 1-3 sentences of genuine insight]
CONFIDENCE: [0.0-1.0]
KEYWORDS: [comma-separated keywords]`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Reflect on this memory/context:\n\n${memoryContext}` },
    ];

    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 512,
        temperature,
        repeatPenalty: 1.2,
      },
      onProgress: context.emitProgress,
    });

    // Parse the response
    const content = response.content || '';
    const thoughtMatch = content.match(/THOUGHT:\s*(.+?)(?=\nCONFIDENCE:|$)/s);
    const confidenceMatch = content.match(/CONFIDENCE:\s*([\d.]+)/);
    const keywordsMatch = content.match(/KEYWORDS:\s*(.+?)$/s);

    const thought = thoughtMatch?.[1]?.trim() || content.split('\n')[0] || '';
    const confidence = parseFloat(confidenceMatch?.[1] || '0.5');
    const keywordsRaw = keywordsMatch?.[1]?.trim() || '';
    const keywords = extractKeywords && keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(k => k.length > 0)
      : [];

    audit({
      level: 'info',
      category: 'decision',
      event: 'thought_generated',
      actor: 'train-of-thought',
      details: {
        thoughtPreview: thought.substring(0, 100),
        confidence,
        keywordCount: keywords.length,
        iterationIndex: previousThoughts.length,
      },
    });

    // Accumulate thoughts
    const thoughts = thought ? [...previousThoughts, thought] : previousThoughts;

    return {
      thought,
      thoughts,
      keywords,
      confidence,
      seedMemory: memoryContext,
      raw: content,
    };
  } catch (error) {
    console.error('[ThoughtGenerator] Error:', error);
    return {
      thought: '',
      thoughts: previousThoughts,
      keywords: [],
      confidence: 0,
      seedMemory: memoryContext,
      error: (error as Error).message,
    };
  }
};

export const ThoughtGeneratorNode: NodeDefinition = defineNode({
  id: 'thought_generator',
  name: 'Thought Generator',
  category: 'thought',
  inputs: [
    { name: 'context', type: 'any', description: 'Memory context or scratchpad' },
    { name: 'seed', type: 'string', optional: true, description: 'Seed text' },
  ],
  outputs: [
    { name: 'thought', type: 'string', description: 'Generated thought' },
    { name: 'thoughts', type: 'array', description: 'Accumulated thoughts' },
    { name: 'keywords', type: 'array', description: 'Extracted keywords' },
    { name: 'confidence', type: 'number', description: 'Confidence score' },
  ],
  properties: {
    temperature: 0.75,
    extractKeywords: true,
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
  },
  description: 'Generates a single reasoning step from memory context',
  execute,
});
