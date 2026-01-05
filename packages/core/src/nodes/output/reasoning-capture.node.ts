/**
 * Reasoning Capture Node
 *
 * Saves LLM reasoning/thinking to the inner dialogue buffer
 * Displays in a collapsible section in the Inner Dialogue tab
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { appendReasoningToBuffer } from '../../conversation-buffer.js';

export const ReasoningCaptureNode: NodeDefinition = defineNode({
  id: 'reasoning_capture',
  name: 'Reasoning Capture',
  category: 'output',
  inputs: [
    { name: 'thinking', type: 'string', description: 'Extracted thinking content from <think> blocks' },
    { name: 'passthrough', type: 'any', optional: true, description: 'Content to pass through after reasoning is saved (for sequential execution)' },
    { name: 'dialogueSource', type: 'string', optional: true, description: 'Source identifier (e.g., dreamer, reflector)' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean', description: 'Whether reasoning was saved to buffer' },
    { name: 'passthrough', type: 'any', description: 'Forwarded content (available after reasoning saved)' },
  ],
  properties: {
    dialogueSource: '',
    displayColor: '#8b5cf6',
  },
  propertySchemas: {
    dialogueSource: {
      type: 'text',
      default: '',
      label: 'Source',
      description: 'Source identifier (e.g., dreamer, reflector)',
    },
    displayColor: {
      type: 'color',
      default: '#8b5cf6',
      label: 'Display Color',
      description: 'Color for reasoning display in Inner Dialogue tab',
    },
  },
  description: 'Saves LLM reasoning to inner dialogue buffer (shown in collapsible section)',

  execute: async (inputs, context, properties) => {
    const thinking = inputs['thinking'] || inputs.thinking;
    const passthroughContent = inputs['passthrough'] || inputs.passthrough;

    // Always forward passthrough content, even if no thinking to save
    if (!thinking || typeof thinking !== 'string' || thinking.trim().length === 0) {
      return {
        saved: false,
        reason: 'No thinking content to capture',
        passthrough: passthroughContent,
      };
    }

    if (!context.userId || context.userId === 'anonymous') {
      return {
        saved: false,
        reason: 'Anonymous user',
        passthrough: passthroughContent,
      };
    }

    try {
      const dialogueSource = inputs['dialogueSource'] || properties?.dialogueSource || '';
      const displayColor = properties?.displayColor || '#8b5cf6';

      const saved = await appendReasoningToBuffer(context.userId, thinking, {
        dialogueSource,
        displayColor,
      });

      return {
        saved,
        thinkingLength: thinking.length,
        passthrough: passthroughContent,
      };
    } catch (error) {
      console.error('[ReasoningCapture] Error:', error);
      return {
        saved: false,
        error: (error as Error).message,
        passthrough: passthroughContent,
      };
    }
  },
});
