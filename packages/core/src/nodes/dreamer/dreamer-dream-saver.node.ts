/**
 * Dreamer Dream Saver Node
 * Saves generated dream to episodic memory as type 'dream'
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import { recordSystemActivity } from '../../system-activity.js';
import { scheduler } from '../../agent-scheduler.js';
import { appendDreamToBuffer } from '../../conversation-buffer.js';

interface Memory {
  id: string;
}

function markBackgroundActivity() {
  try { recordSystemActivity(); } catch {}
  try { scheduler.recordActivity(); } catch {}
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const dreamInput = inputs[0];
  const dream = dreamInput?.dream || dreamInput;
  const sourceIds = dreamInput?.sourceIds || inputs[1]?.memories?.map((m: Memory) => m.id) || [];
  const username = context.userId || context.username;
  const type = properties?.type || 'dream';

  if (!dream || typeof dream !== 'string') {
    return {
      saved: false,
      error: 'No dream content provided',
    };
  }

  try {
    markBackgroundActivity();

    const eventId = await captureEvent(dream, {
      type,
      sources: sourceIds,
      confidence: 0.7,
    });

    audit({
      level: 'info',
      category: 'decision',
      event: 'dream_generated',
      message: 'Dreamer generated new dream',
      details: {
        dream,
        sourceCount: sourceIds.length,
        username,
      },
      metadata: { dream },
      actor: 'dreamer',
    });

    if (username) {
      appendDreamToBuffer(username, dream);
    }

    return {
      saved: true,
      eventId,
      dream,
      sourceCount: sourceIds.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerDreamSaver] Error:', error);
    return {
      saved: false,
      error: (error as Error).message,
    };
  }
};

export const DreamerDreamSaverNode: NodeDefinition = defineNode({
  id: 'dreamer_dream_saver',
  name: 'Dreamer Dream Saver',
  category: 'dreamer',
  inputs: [
    { name: 'dreamData', type: 'object', description: 'Dream text from generator' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Source memories' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' },
    { name: 'eventId', type: 'string' },
  ],
  properties: {
    type: 'dream',
  },
  propertySchemas: {
    type: {
      type: 'string',
      default: 'dream',
      label: 'Memory Type',
    },
  },
  description: 'Saves generated dream to episodic memory',
  execute,
});
