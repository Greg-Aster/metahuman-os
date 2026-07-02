/**
 * Thinking Stripper Node
 *
 * Extracts and separates <think>...</think> blocks from LLM responses.
 * - Preserves thinking content for UI display (collapsible sections)
 * - Provides stripped content for memory/TTS/buffer
 *
 * Place this node inline between LLM response and memory capture.
 *
 * Example flow:
 *   PersonaLLM → ThinkingStripper → MemoryCapture
 *                     ↓
 *               thinking → UI (collapsible)
 *               content → memory, TTS, buffer
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

/**
 * Extract <think>...</think> blocks and return both parts
 * Exported for reuse in operator-react.ts and other modules
 */
export function parseThinkingBlocks(content: string): { thinking: string | null; stripped: string } {
  if (!content) return { thinking: null, stripped: '' };

  // First try to match complete <think>...</think> blocks
  const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
  const matches = content.match(thinkPattern);

  if (matches && matches.length > 0) {
    // Extract all thinking content (may have multiple blocks)
    let thinking = '';
    for (const match of matches) {
      const inner = match.replace(/<\/?think>/gi, '').trim();
      if (inner) {
        thinking += (thinking ? '\n\n' : '') + inner;
      }
    }

    // Strip thinking blocks from content
    const stripped = content
      .replace(thinkPattern, '')
      .replace(/^\s*\n+/, '') // Remove leading newlines after stripping
      .trim();

    return {
      thinking: thinking || null,
      stripped,
    };
  }

  // Handle incomplete thinking blocks (model ran out of tokens mid-thinking)
  // Match <think> at start without closing tag
  const incompletePattern = /^<think>([\s\S]*)$/i;
  const incompleteMatch = content.match(incompletePattern);

  if (incompleteMatch) {
    const thinking = incompleteMatch[1].trim();
    // Response was cut off during thinking - no final answer available
    return {
      thinking: thinking ? `${thinking}\n\n[Thinking was cut off - response limit reached]` : null,
      stripped: '[Response incomplete - thinking exceeded token limit]',
    };
  }

  // No thinking blocks found
  return { thinking: null, stripped: content.trim() };
}

const execute: NodeExecutor = async (inputs) => {
  // Named inputs with array fallback
  const inputData = inputs.response ?? inputs[0];

  // Early exit if input is null (e.g., from closed gateway)
  if (inputData === null || inputData === undefined) {
    console.log('[ThinkingStripper] Received null input - gate may be closed, returning empty');
    return {
      response: '',
      content: '',
      thinking: null,
      stripped: '',
      hadThinking: false,
      thinkingLength: 0,
      skipped: true,
    };
  }

  // Extract response string from various input formats
  let response = '';
  if (typeof inputData === 'string') {
    response = inputData;
  } else if (inputData?.response) {
    if (typeof inputData.response === 'string') {
      response = inputData.response;
    } else if (typeof inputData.response === 'object' && inputData.response?.response) {
      response = inputData.response.response;
    } else if (typeof inputData.response === 'object' && inputData.response?.content) {
      response = inputData.response.content;
    }
  } else if (inputData?.content && typeof inputData.content === 'string') {
    response = inputData.content;
  }

  const { thinking, stripped } = parseThinkingBlocks(response);

  return {
    // For backward compatibility with existing pipelines
    response: stripped,
    content: stripped,

    // Separated outputs for flexible routing
    thinking,
    stripped,

    // Metadata
    hadThinking: thinking !== null,
    thinkingLength: thinking?.length || 0,
  };
};

export const ThinkingStripperNode: NodeDefinition = defineNode({
  id: 'thinking_stripper',
  aliases: ['cot_stripper'],
  name: 'Thinking Stripper',
  category: 'output',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response that may contain <think> blocks' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Response with thinking stripped (alias for stripped)' },
    { name: 'content', type: 'string', description: 'Response with thinking stripped (alias for stripped)' },
    { name: 'thinking', type: 'string', description: 'Extracted thinking content (null if none)' },
    { name: 'stripped', type: 'string', description: 'Response with <think> blocks removed' },
    { name: 'hadThinking', type: 'boolean', description: 'Whether response contained thinking' },
    { name: 'thinkingLength', type: 'number', description: 'Character count of extracted thinking' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Extracts <think> blocks for UI display, provides stripped content for memory/TTS',
  execute,
});
