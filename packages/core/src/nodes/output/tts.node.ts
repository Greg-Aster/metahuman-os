/**
 * TTS Node
 *
 * Queues text for Text-to-Speech playback on the client.
 * Has two input handles: conversation and innerDialogue
 * The client watches the TTS queue and plays audio when items appear.
 *
 * The toggles in ChatInterface control whether TTS is enabled for each mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition } from '../types.js';
import { getProfilePaths, systemPaths } from '../../path-builder.js';
import { audit } from '../../audit.js';

// ============================================================================
// TTS Queue Types and Functions
// ============================================================================

export interface TTSQueueItem {
  id: string;
  text: string;
  mode: 'conversation' | 'inner';
  source?: string;
  timestamp: number;
}

export interface TTSQueue {
  items: TTSQueueItem[];
  lastUpdated: string;
}

/**
 * Get TTS queue path for a user
 */
export function getTTSQueuePath(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'tts-queue.json');
}

/**
 * Get TTS notification path (for fs.watch on local disk)
 */
export function getTTSNotificationPath(username: string): string {
  const notifyDir = path.join(systemPaths.run, 'tts-notifications');
  return path.join(notifyDir, `${username}.notify`);
}

/**
 * Touch TTS notification file to signal client
 */
function touchTTSNotification(username: string): void {
  try {
    const notifyPath = getTTSNotificationPath(username);
    const notifyDir = path.dirname(notifyPath);
    fs.mkdirSync(notifyDir, { recursive: true });
    fs.writeFileSync(notifyPath, new Date().toISOString());
  } catch {
    // Non-critical
  }
}

/**
 * Add item to TTS queue
 */
export function queueTTS(
  username: string,
  text: string,
  mode: 'conversation' | 'inner',
  source?: string
): TTSQueueItem | null {
  if (!username || username === 'anonymous' || !text?.trim()) {
    return null;
  }

  const queuePath = getTTSQueuePath(username);
  const queueDir = path.dirname(queuePath);

  try {
    fs.mkdirSync(queueDir, { recursive: true });

    // Load existing queue
    let queue: TTSQueue;
    if (fs.existsSync(queuePath)) {
      const raw = fs.readFileSync(queuePath, 'utf-8');
      queue = JSON.parse(raw);
      if (!Array.isArray(queue.items)) {
        queue.items = [];
      }
    } else {
      queue = { items: [], lastUpdated: new Date().toISOString() };
    }

    // Create new item
    const item: TTSQueueItem = {
      id: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      mode,
      source,
      timestamp: Date.now(),
    };

    // Add to queue (keep last 10 items max to prevent unbounded growth)
    queue.items.push(item);
    if (queue.items.length > 10) {
      queue.items = queue.items.slice(-10);
    }
    queue.lastUpdated = new Date().toISOString();

    // Save queue
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

    // Touch notification file for SSE
    touchTTSNotification(username);

    return item;
  } catch (error) {
    console.error('[TTS Queue] Error:', error);
    return null;
  }
}

/**
 * Pop items from TTS queue (returns and removes items)
 */
export function popTTSQueue(username: string): TTSQueueItem[] {
  const queuePath = getTTSQueuePath(username);

  try {
    if (!fs.existsSync(queuePath)) {
      return [];
    }

    const raw = fs.readFileSync(queuePath, 'utf-8');
    const queue: TTSQueue = JSON.parse(raw);
    const items = queue.items || [];

    // Clear the queue
    queue.items = [];
    queue.lastUpdated = new Date().toISOString();
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

    return items;
  } catch {
    return [];
  }
}

/**
 * Peek at TTS queue without removing items
 */
export function peekTTSQueue(username: string): TTSQueueItem[] {
  const queuePath = getTTSQueuePath(username);

  try {
    if (!fs.existsSync(queuePath)) {
      return [];
    }

    const raw = fs.readFileSync(queuePath, 'utf-8');
    const queue: TTSQueue = JSON.parse(raw);
    return queue.items || [];
  } catch {
    return [];
  }
}

// ============================================================================
// TTS Node Definition
// ============================================================================

export const TTSNode: NodeDefinition = defineNode({
  id: 'tts',
  name: 'TTS Output',
  category: 'output',
  inputs: [
    { name: 'conversation', type: 'string', optional: true, description: 'Text to speak in conversation mode' },
    { name: 'innerDialogue', type: 'string', optional: true, description: 'Text to speak in inner dialogue mode' },
    { name: 'text', type: 'string', optional: true, description: 'Text to speak (defaults to conversation mode)' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether text was queued for TTS' },
    { name: 'itemId', type: 'string', description: 'ID of queued TTS item' },
    { name: 'text', type: 'string', description: 'Text that was queued' },
  ],
  properties: {
    source: '',
    defaultMode: 'conversation',
  },
  propertySchemas: {
    source: {
      type: 'text',
      default: '',
      label: 'Source',
      description: 'Source identifier (e.g., curiosity, dreamer, reflector)',
    },
    defaultMode: {
      type: 'select',
      default: 'conversation',
      label: 'Default Mode',
      description: 'Mode to use when text input is connected instead of specific handles',
      options: [
        { value: 'conversation', label: 'Conversation' },
        { value: 'inner', label: 'Inner Dialogue' },
      ],
    },
  },
  description: 'Queues text for Text-to-Speech playback. Client toggles control playback.',

  execute: async (inputs, context, properties) => {
    // Use username (human-readable) for profile path resolution, not userId (UUID)
    const username = context.username || context.userId;

    console.log('[TTS Node] Execute called:', {
      username,
      contextUsername: context.username,
      contextUserId: context.userId,
      inputKeys: Object.keys(inputs || {}),
      hasInnerDialogue: !!inputs?.innerDialogue,
      hasConversation: !!inputs?.conversation,
      hasText: !!inputs?.text,
      innerDialogueType: typeof inputs?.innerDialogue,
      innerDialoguePreview: typeof inputs?.innerDialogue === 'string'
        ? inputs.innerDialogue.substring(0, 50)
        : JSON.stringify(inputs?.innerDialogue)?.substring(0, 100),
    });

    if (!username || username === 'anonymous') {
      console.log('[TTS Node] Skipping - no authenticated user');
      return {
        queued: false,
        reason: 'No authenticated user',
      };
    }

    // Check for conversation input
    const conversationText = inputs['conversation'] || inputs.conversation;
    const conversationStr = typeof conversationText === 'string'
      ? conversationText
      : conversationText?.response || conversationText?.question || conversationText?.content || '';

    // Check for inner dialogue input
    const innerText = inputs['innerDialogue'] || inputs.innerDialogue;
    const innerStr = typeof innerText === 'string'
      ? innerText
      : innerText?.reflection || innerText?.dream || innerText?.response || innerText?.content || '';

    // Check for generic text input (backward compatibility)
    const genericText = inputs['text'] || inputs.text || inputs[0];
    const genericStr = typeof genericText === 'string'
      ? genericText
      : genericText?.response || genericText?.content || '';

    const source = properties?.source || context.cognitiveMode || 'graph';
    const defaultMode = properties?.defaultMode || 'conversation';
    let queued = false;
    let itemId = '';
    let spokenText = '';

    console.log('[TTS Node] Parsed inputs:', {
      conversationStr: conversationStr?.substring(0, 50) || '(empty)',
      innerStr: innerStr?.substring(0, 50) || '(empty)',
      genericStr: genericStr?.substring(0, 50) || '(empty)',
      source,
      defaultMode,
    });

    // Queue conversation text
    if (conversationStr?.trim()) {
      const item = queueTTS(username, conversationStr, 'conversation', source);
      if (item) {
        queued = true;
        itemId = item.id;
        spokenText = conversationStr;
        audit({
          category: 'action',
          level: 'info',
          event: 'tts_queued',
          actor: 'tts-node',
          details: {
            mode: 'conversation',
            textLength: conversationStr.length,
            source,
            itemId: item.id,
          },
          metadata: { username },
        });
      }
    }

    // Queue inner dialogue text
    if (innerStr?.trim()) {
      const item = queueTTS(username, innerStr, 'inner', source);
      if (item) {
        queued = true;
        itemId = item.id;
        spokenText = innerStr;
        audit({
          category: 'action',
          level: 'info',
          event: 'tts_queued',
          actor: 'tts-node',
          details: {
            mode: 'inner',
            textLength: innerStr.length,
            source,
            itemId: item.id,
          },
          metadata: { username },
        });
      }
    }

    // Queue generic text if no specific inputs were used
    if (!queued && genericStr?.trim()) {
      const item = queueTTS(username, genericStr, defaultMode as 'conversation' | 'inner', source);
      if (item) {
        queued = true;
        itemId = item.id;
        spokenText = genericStr;
        audit({
          category: 'action',
          level: 'info',
          event: 'tts_queued',
          actor: 'tts-node',
          details: {
            mode: defaultMode,
            textLength: genericStr.length,
            source,
            itemId: item.id,
          },
          metadata: { username },
        });
      }
    }

    return {
      queued,
      itemId,
      text: spokenText,
      conversationQueued: !!conversationStr?.trim(),
      innerQueued: !!innerStr?.trim(),
    };
  },
});
