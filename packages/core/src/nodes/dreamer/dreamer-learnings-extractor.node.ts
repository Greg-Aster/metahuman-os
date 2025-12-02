/**
 * Dreamer Learnings Extractor Node
 * Extracts preferences, heuristics, style notes, and avoidances from memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { recordSystemActivity } from '../../system-activity.js';
import { scheduler } from '../../agent-scheduler.js';

interface Memory {
  timestamp: string;
  content: string;
}

function markBackgroundActivity() {
  try { recordSystemActivity(); } catch {}
  try { scheduler.recordActivity(); } catch {}
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs[0]?.memories || inputs[0] || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const temperature = properties?.temperature || 0.3;
  const role = properties?.role || 'persona';
  const username = context.userId || context.username;

  if (memories.length === 0) {
    return {
      preferences: [],
      heuristics: [],
      styleNotes: [],
      avoidances: [],
      error: 'No memories provided',
    };
  }

  const memoriesText = memories
    .map((m: Memory) => `[${m.timestamp}] ${m.content}`)
    .join('\n\n');

  const systemPrompt = `You are analyzing recent episodic memories to extract implicit and explicit preferences, decision heuristics, writing style patterns, and things to avoid.

Be specific and cite examples where possible. Extract:
1. **Preferences**: What does the person value, prefer, or prioritize?
2. **Heuristics**: What decision rules or patterns emerge?
3. **Style Notes**: What communication or writing style is evident?
4. **Avoidances**: What does the person dislike or avoid?

Respond with JSON only.`;

  const userPrompt = `Analyze these memories and extract learnings:

${memoriesText}

Respond with JSON:
{
  "preferences": ["preference 1 (with example if possible)", "preference 2", ...],
  "heuristics": ["heuristic 1", "heuristic 2", ...],
  "styleNotes": ["style note 1", "style note 2", ...],
  "avoidances": ["avoidance 1", "avoidance 2", ...]
}`;

  try {
    markBackgroundActivity();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      options: { temperature },
    });

    const parsed = JSON.parse(response.content) as {
      preferences: string[];
      heuristics: string[];
      styleNotes: string[];
      avoidances: string[];
    };

    return {
      preferences: parsed.preferences || [],
      heuristics: parsed.heuristics || [],
      styleNotes: parsed.styleNotes || [],
      avoidances: parsed.avoidances || [],
      memoryCount: memories.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerLearningsExtractor] Error:', error);
    return {
      preferences: [],
      heuristics: [],
      styleNotes: [],
      avoidances: [],
      error: (error as Error).message,
      username,
    };
  }
};

export const DreamerLearningsExtractorNode: NodeDefinition = defineNode({
  id: 'dreamer_learnings_extractor',
  name: 'Dreamer Learnings Extractor',
  category: 'dreamer',
  inputs: [
    { name: 'memoriesData', type: 'object', description: 'Curated memories' },
  ],
  outputs: [
    { name: 'preferences', type: 'array' },
    { name: 'heuristics', type: 'array' },
    { name: 'styleNotes', type: 'array' },
    { name: 'avoidances', type: 'array' },
  ],
  properties: {
    temperature: 0.3,
    role: 'persona',
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
  },
  description: 'Extracts preferences, heuristics, style notes, and avoidances',
  execute,
});
