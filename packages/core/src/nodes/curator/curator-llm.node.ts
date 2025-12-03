/**
 * Curator LLM Node
 * Generates conversational exchanges from raw memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  response?: string;
  path?: string;
  metadata?: {
    cognitiveMode?: string;
  };
}

interface CuratedMemory {
  id: string;
  originalTimestamp: string;
  conversationalEssence: string;
  context?: string;
  userMessage?: string;
  assistantResponse?: string;
  curatedAt: string;
  flags: string[];
  suitableForTraining: boolean;
  cognitiveMode?: string;
  memoryType?: string;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs[0];
  const memories: (EpisodicMemory & { path: string })[] = memoriesInput?.memories || [];
  const personaSummary = inputs[1] as string;
  const temperature = properties?.temperature || 0.3;

  if (!memories || memories.length === 0) {
    return {
      success: true,
      curatedMemories: [],
      count: 0,
    };
  }

  const curatedResults: any[] = [];

  for (const memory of memories) {
    if (!memory || !memory.content) continue;

    const cognitiveMode = memory.metadata?.cognitiveMode || 'emulation';
    const memoryType = memory.type || 'conversation';

    const systemPrompt = `You are a memory curator preparing training data for a personal AI assistant.

PERSONA CONTEXT:
${personaSummary}

COGNITIVE MODE: ${cognitiveMode}
MEMORY TYPE: ${memoryType}

Convert this memory into a conversational exchange suitable for training.

Respond with JSON:
{
  "conversationalEssence": "Natural language summary",
  "userMessage": "Generated or extracted user message",
  "assistantResponse": "Generated or extracted assistant response",
  "context": "Additional context if needed",
  "flags": ["sensitive-data", "tool-syntax", "etc"],
  "suitableForTraining": true/false
}`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Memory content:\n${memory.content}\n\n${memory.response ? `Response: ${memory.response}` : ''}` },
    ];

    try {
      const response = await callLLM({
        role: 'curator',
        messages,
        cognitiveMode: context.cognitiveMode || 'dual',
        options: { temperature },
        keepAlive: 0, // Unload model immediately - background agent shouldn't hog VRAM
      });

      const result = JSON.parse(response.content);

      const curated: CuratedMemory = {
        id: memory.id,
        originalTimestamp: memory.timestamp,
        conversationalEssence: result.conversationalEssence || memory.content,
        context: result.context,
        userMessage: result.userMessage,
        assistantResponse: result.assistantResponse,
        curatedAt: new Date().toISOString(),
        flags: result.flags || [],
        suitableForTraining: result.suitableForTraining !== false,
        cognitiveMode,
        memoryType,
      };

      curatedResults.push({
        success: true,
        curated,
        originalMemoryPath: memory.path,
      });
    } catch (error) {
      curatedResults.push({
        success: false,
        curated: {
          id: memory.id,
          originalTimestamp: memory.timestamp,
          conversationalEssence: memory.content,
          curatedAt: new Date().toISOString(),
          flags: ['curator-error'],
          suitableForTraining: false,
          cognitiveMode,
          memoryType,
        },
        originalMemoryPath: memory.path,
        error: (error as Error).message,
      });
    }
  }

  return {
    success: true,
    curatedMemories: curatedResults,
    count: curatedResults.length,
  };
};

export const CuratorLLMNode: NodeDefinition = defineNode({
  id: 'curator_llm',
  name: 'Curator LLM',
  category: 'curator',
  inputs: [
    { name: 'memories', type: 'object', description: 'Uncurated memories' },
    { name: 'personaSummary', type: 'string', description: 'Persona context' },
  ],
  outputs: [
    { name: 'curatedMemories', type: 'array' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    temperature: 0.3,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
    },
  },
  description: 'Generates conversational exchanges from raw memories',
  execute,
});
