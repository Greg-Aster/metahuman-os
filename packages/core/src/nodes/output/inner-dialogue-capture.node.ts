/**
 * Inner Dialogue Capture Node
 *
 * Saves inner dialogue (reflections, thoughts) to episodic memory
 * Type: 'inner_dialogue' - never shows in main chat, only in Inner Dialogue tab
 */

import path from 'path';
import { defineNode, type NodeDefinition } from '../types.js';
import { ROOT } from '../../path-builder.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';
import { audit } from '../../audit.js';
import { appendReflectionToBuffer, appendDreamToBuffer } from '../../conversation-buffer.js';

export const InnerDialogueCaptureNode: NodeDefinition = defineNode({
  id: 'inner_dialogue_capture',
  name: 'Inner Dialogue Capture',
  category: 'output',
  inputs: [
    { name: 'text', type: 'string', description: 'Reflection or thought text' },
    { name: 'metadata', type: 'object', optional: true },
    { name: 'displayColor', type: 'string', optional: true, description: 'Color for UI display (e.g., #22c55e)' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean', description: 'Whether dialogue was saved' },
    { name: 'result', type: 'object', description: 'Save result with path' },
  ],
  properties: {
    tags: ['idle-thought', 'self-reflection', 'inner'],
    displayColor: '',
    dialogueSource: '',
  },
  propertySchemas: {
    tags: {
      type: 'json',
      default: ['idle-thought', 'self-reflection', 'inner'],
      label: 'Tags',
      description: 'Tags to apply to the inner dialogue',
    },
    displayColor: {
      type: 'color',
      default: '',
      label: 'Display Color',
      description: 'Color for text display in Inner Dialogue tab (e.g., #22c55e for green)',
    },
    dialogueSource: {
      type: 'text',
      default: '',
      label: 'Source',
      description: 'Source identifier (e.g., lizard-brain, dreamer, reflector)',
    },
  },
  description: 'Saves inner dialogue to episodic memory (never shown in main chat)',

  execute: async (inputs, context, properties) => {
    // Extract reflection text from 'text' input handle
    // The graph executor maps inputs by handle name, not index
    const textInput = inputs['text'] || inputs.text;
    const reflectionText = typeof textInput === 'string'
      ? textInput
      : textInput?.response || textInput?.reflection || textInput?.consolidatedChain || textInput?.insight || '';

    if (!reflectionText || reflectionText.trim().length === 0) {
      return {
        saved: false,
        reason: 'No reflection text to capture',
      };
    }

    if (!context.allowMemoryWrites || !context.userId || context.userId === 'anonymous') {
      return {
        saved: false,
        reason: context.allowMemoryWrites ? 'Anonymous user' : 'Memory writes disabled',
      };
    }

    try {
      // Access metadata by handle name, not index
      const metadataInput = inputs['metadata'] || inputs.metadata;
      const displayColorInput = inputs['displayColor'] || inputs.displayColor;

      // Get displayColor from input, properties, or metadata (in order of priority)
      const displayColor = displayColorInput || properties?.displayColor || metadataInput?.displayColor || '';
      const dialogueSource = properties?.dialogueSource || metadataInput?.dialogueSource || '';

      const options = {
        type: 'inner_dialogue' as const,
        tags: metadataInput?.tags || properties?.tags || ['idle-thought', 'self-reflection', 'inner'],
        links: metadataInput?.links || undefined,
        metadata: {
          ...(metadataInput || {}),
          ...(displayColor ? { displayColor } : {}),
          ...(dialogueSource ? { dialogueSource } : {}),
        },
      };

      const result: CaptureResult = captureEventWithDetails(reflectionText, options);
      const relativePath = path.relative(ROOT, result.filePath);

      audit({
        category: 'data',
        level: 'info',
        event: 'inner_dialogue_captured',
        actor: context.userId,
        details: {
          type: 'inner_dialogue',
          path: relativePath,
          textLength: reflectionText.length,
          encrypted: result.encrypted,
          encryptionType: result.encryptionType,
        },
      });

      // Write to conversation buffer for immediate UI access
      // Pass dialogueSource and displayColor for proper UI labeling
      if (context.userId) {
        const extraMeta = {
          ...(dialogueSource ? { dialogueSource } : {}),
          ...(displayColor ? { displayColor } : {}),
        };
        const isDream = options.tags?.includes('dream') || options.tags?.includes('lucid');
        if (isDream) {
          appendDreamToBuffer(context.userId, reflectionText, extraMeta);
        } else {
          appendReflectionToBuffer(context.userId, reflectionText, extraMeta);
        }
      }

      return {
        saved: true,
        type: 'inner_dialogue',
        eventId: result.eventId,
        eventPath: relativePath,
        filePath: result.filePath,
        encrypted: result.encrypted,
        encryptionType: result.encryptionType,
        encryptionWarning: result.encryptionWarning,
        encryptionFallback: result.encryptionFallback,
        timestamp: result.timestamp,
        textLength: reflectionText.length,
        bytesWritten: result.bytesWritten,
        result: {
          eventId: result.eventId,
          path: relativePath,
          encrypted: result.encrypted,
        },
      };
    } catch (error) {
      console.error('[InnerDialogueCapture] Error:', error);
      return {
        saved: false,
        error: (error as Error).message,
      };
    }
  },
});
