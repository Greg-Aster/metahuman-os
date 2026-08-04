/**
 * Inner Dialogue Buffer Node
 *
 * The only graph node allowed to persist typed thoughts and generated
 * inner dialogue. Optional long-term-memory capture happens from the same
 * admitted entry so storage and memory cannot drift into separate meanings.
 */

import path from 'node:path';
import { audit } from '../../audit.js';
import { getBufferPathForUser, writeBufferEntry, type ConversationMessage } from '../../conversation-buffer.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';
import { ROOT } from '../../path-builder.js';
import { defineNode, type NodeExecutor } from '../types.js';

const INNER_ROLES = new Set<ConversationMessage['role']>([
  'thought',
  'reflection',
  'dream',
  'daydream',
  'reasoning',
]);

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['content', 'response', 'reflection', 'dream', 'consolidatedChain', 'insight']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return '';
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  const explicitEntry = inputs.entry ?? context.bufferEntry;
  const explicitRecord = explicitEntry && typeof explicitEntry === 'object'
    ? explicitEntry as Record<string, any>
    : null;
  const text = resolveText(explicitRecord ?? inputs.text ?? inputs.thinking ?? context.innerDialogue);
  const metadataInput = inputs.metadata && typeof inputs.metadata === 'object'
    ? inputs.metadata as Record<string, any>
    : {};
  const configuredRole = explicitRecord?.role
    ?? (typeof inputs.thinking === 'string' && inputs.thinking.trim() ? 'reasoning' : undefined)
    ?? properties?.role
    ?? metadataInput.role
    ?? 'reflection';
  const role = INNER_ROLES.has(configuredRole) ? configuredRole : 'reflection';
  const passthrough = inputs.passthrough;

  if (!username || username === 'anonymous') {
    return { saved: false, persisted: false, text: '', reason: 'No authenticated username', passthrough };
  }
  if (!text) {
    return {
      saved: false,
      persisted: false,
      text: '',
      reason: 'No inner-dialogue text to admit',
      passthrough,
      bufferPath: getBufferPathForUser(username, 'inner'),
    };
  }

  const displayColor = inputs.displayColor || properties?.displayColor || metadataInput.displayColor || '';
  const dialogueSource = properties?.dialogueSource || metadataInput.dialogueSource || explicitRecord?.meta?.dialogueSource || '';
  const configuredTags = metadataInput.tags ?? properties?.tags ?? ['idle-thought', 'self-reflection', 'inner'];
  const tags = Array.from(new Set(
    (Array.isArray(configuredTags) ? configuredTags : [configuredTags])
      .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
      .map(tag => tag.trim()),
  ));
  const meta = {
    type: role,
    source: role === 'thought' ? 'user' : 'agent',
    ...(explicitRecord?.meta && typeof explicitRecord.meta === 'object' ? explicitRecord.meta : {}),
    ...metadataInput,
    tags,
    ...(dialogueSource ? { dialogueSource } : {}),
    ...(displayColor ? { displayColor } : {}),
  };

  try {
    const persisted = await writeBufferEntry(username, 'inner', { role, content: text, meta });
    let result: CaptureResult | null = null;
    const captureMemory = context.captureMemory ?? properties?.captureMemory ?? true;

    if (persisted && captureMemory && context.allowMemoryWrites !== false) {
      const memoryContent = typeof context.memoryContent === 'string' && context.memoryContent.trim()
        ? context.memoryContent.trim()
        : text;
      result = captureEventWithDetails(memoryContent, {
        type: role === 'dream' ? 'dream' : role === 'daydream' ? 'daydream' : 'inner_dialogue',
        tags,
        links: metadataInput.links || undefined,
        metadata: {
          ...meta,
          role,
          sessionId: context.sessionId,
        },
      });

      audit({
        category: 'data',
        level: 'info',
        event: 'inner_dialogue_captured',
        actor: username,
        details: {
          type: role,
          path: path.relative(ROOT, result.filePath),
          textLength: memoryContent.length,
          encrypted: result.encrypted,
          encryptionType: result.encryptionType,
        },
      });
    }

    return {
      saved: persisted,
      persisted,
      text: persisted ? text : '',
      role,
      eventId: result?.eventId,
      eventPath: result ? path.relative(ROOT, result.filePath) : undefined,
      bufferPath: getBufferPathForUser(username, 'inner'),
      passthrough,
      result: result ? {
        eventId: result.eventId,
        path: path.relative(ROOT, result.filePath),
        encrypted: result.encrypted,
      } : undefined,
    };
  } catch (error) {
    console.error('[InnerDialogueBuffer] Error:', error);
    return {
      saved: false,
      persisted: false,
      text: '',
      error: (error as Error).message,
      passthrough,
      bufferPath: getBufferPathForUser(username, 'inner'),
    };
  }
};

export const InnerDialogueBufferNode = defineNode({
  id: 'inner_dialogue_buffer',
  name: 'Inner Dialogue Buffer',
  category: 'output',
  inputs: [
    { name: 'entry', type: 'message', optional: true, description: 'One typed inner-dialogue entry' },
    { name: 'text', type: 'string', optional: true, description: 'Thought or generated inner dialogue' },
    { name: 'thinking', type: 'string', optional: true, description: 'Reasoning text (stored with reasoning role)' },
    { name: 'metadata', type: 'object', optional: true },
    { name: 'displayColor', type: 'string', optional: true },
    { name: 'passthrough', type: 'any', optional: true },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' },
    { name: 'persisted', type: 'boolean' },
    { name: 'text', type: 'string', description: 'Exact admitted text for standard downstream output nodes' },
    { name: 'role', type: 'string' },
    { name: 'result', type: 'object' },
    { name: 'passthrough', type: 'any' },
    { name: 'bufferPath', type: 'string' },
  ],
  properties: {
    tags: ['idle-thought', 'self-reflection', 'inner'],
    displayColor: '',
    dialogueSource: '',
    role: 'reflection',
    captureMemory: true,
  },
  propertySchemas: {
    tags: { type: 'json', default: ['idle-thought', 'self-reflection', 'inner'], label: 'Tags' },
    displayColor: { type: 'color', default: '', label: 'Display Color' },
    dialogueSource: { type: 'text', default: '', label: 'Source' },
    role: {
      type: 'select',
      default: 'reflection',
      label: 'Message Role',
      options: ['thought', 'reflection', 'dream', 'daydream', 'reasoning'],
    },
    captureMemory: {
      type: 'toggle',
      default: true,
      label: 'Capture Long-term Memory',
      description: 'Create a long-term memory from the same admitted entry.',
    },
  },
  description: 'Persists typed inner-dialogue entries, exposes admitted text to standard output nodes, and optionally captures matching long-term memory.',
  execute,
});
