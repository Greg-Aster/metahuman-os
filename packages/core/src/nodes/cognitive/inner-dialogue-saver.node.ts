/**
 * Inner Dialogue Saver Node
 * Saves content to episodic memory as inner_dialogue type
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { captureEventWithDetails } from '../../memory.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const data = inputs.data ?? inputs[0];
  const tags = properties?.tags ?? ['inner'];

  if (!data) {
    return {
      success: false,
      error: 'No data provided',
    };
  }

  try {
    // Format content based on type
    let content: string;
    if (typeof data === 'string') {
      content = data;
    } else if (typeof data === 'object') {
      // Extract meaningful content from object
      if (data.content) {
        content = data.content;
      } else if (data.summary) {
        content = data.summary;
      } else if (data.verdict) {
        content = `Verdict: ${data.verdict}`;
        if (data.reason) content += `\nReason: ${data.reason}`;
      } else {
        content = JSON.stringify(data, null, 2);
      }
    } else {
      content = String(data);
    }

    const result = captureEventWithDetails(content, {
      type: 'inner_dialogue',
      tags: Array.isArray(tags) ? tags : [tags],
      metadata: {
        source: 'cognitive-graph',
        nodeType: 'inner_dialogue_saver',
      },
    });

    return {
      success: true,
      eventId: result.eventId,
      content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
    };
  } catch (error) {
    console.error('[InnerDialogueSaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const InnerDialogueSaverNode: NodeDefinition = defineNode({
  id: 'inner_dialogue_saver',
  name: 'Inner Dialogue Saver',
  category: 'cognitive',
  inputs: [
    { name: 'data', type: 'any', description: 'Content to save' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether save succeeded' },
    { name: 'eventId', type: 'string', optional: true, description: 'Created event ID' },
  ],
  properties: {
    tags: ['inner'],
  },
  propertySchemas: {
    tags: {
      type: 'tags',
      default: ['inner'],
      label: 'Tags',
      description: 'Tags to apply to the inner dialogue',
    },
  },
  description: 'Saves content to episodic memory as inner_dialogue',
  execute,
});
