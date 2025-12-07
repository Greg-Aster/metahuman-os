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
 */
function parseThinkingBlocks(content: string): { thinking: string | null; stripped: string } {
  if (!content) return { thinking: null, stripped: '' };

  const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
  const matches = content.match(thinkPattern);

  if (!matches || matches.length === 0) {
    return { thinking: null, stripped: content.trim() };
  }

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

const execute: NodeExecutor = async (inputs) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response) {
    if (typeof inputs[0].response === 'string') {
      response = inputs[0].response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.response) {
      response = inputs[0].response.response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.content) {
      response = inputs[0].response.content;
    }
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
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
