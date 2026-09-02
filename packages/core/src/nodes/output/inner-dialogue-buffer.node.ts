/**
 * Inner Dialogue Buffer Node
 *
 * The only graph node allowed to persist typed thoughts and generated
 * inner dialogue to the rolling short-term buffer. Long-term capture is a
 * separate downstream responsibility of the Inner Dialogue Saver node.
 */

import {
  getBufferPathForUser,
  loadBufferForUser,
  writeBufferEntry,
  type ConversationMessage,
} from '../../conversation-buffer.js';
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
  for (const key of ['content', 'response', 'reflection', 'dream', 'reasoning', 'consolidatedChain', 'insight']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return '';
}

function resolveTimestamp(explicitRecord: Record<string, any> | null, context: Record<string, any>): number {
  const candidate = explicitRecord?.timestamp ?? context.memoryTimestamp;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

const admitSingle: NodeExecutor = async (inputs, context, properties) => {
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
    return { saved: false, persisted: false, entries: [], text: '', reason: 'No authenticated username', passthrough };
  }
  if (!text) {
    return {
      saved: false,
      persisted: false,
      entries: [],
      text: '',
      reason: 'No inner-dialogue text to admit',
      passthrough,
      bufferPath: getBufferPathForUser(username, 'inner'),
    };
  }

  const displayColor = inputs.displayColor || properties?.displayColor || metadataInput.displayColor || '';
  const dialogueSource = properties?.dialogueSource || metadataInput.dialogueSource || explicitRecord?.meta?.dialogueSource || '';
  const configuredTags = metadataInput.tags
    ?? explicitRecord?.meta?.tags
    ?? properties?.tags
    ?? ['idle-thought', 'self-reflection', 'inner'];
  const tags = Array.from(new Set(
    (Array.isArray(configuredTags) ? configuredTags : [configuredTags])
      .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
      .map(tag => tag.trim()),
  ));
  const explicitIdempotencyKey = typeof explicitRecord?.meta?.idempotencyKey === 'string'
    ? explicitRecord.meta.idempotencyKey.trim()
    : typeof metadataInput.idempotencyKey === 'string'
      ? metadataInput.idempotencyKey.trim()
      : '';
  const executionIdempotencyKey = typeof context.idempotencyKey === 'string'
    ? context.idempotencyKey.trim()
    : '';
  const idempotencyKey = explicitIdempotencyKey
    || (executionIdempotencyKey ? `${executionIdempotencyKey}:${role}` : '');
  const meta = {
    type: role,
    source: role === 'thought' ? 'user' : 'agent',
    ...(explicitRecord?.meta && typeof explicitRecord.meta === 'object' ? explicitRecord.meta : {}),
    ...metadataInput,
    tags,
    ...(dialogueSource ? { dialogueSource } : {}),
    ...(displayColor ? { displayColor } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  try {
    const timestamp = resolveTimestamp(explicitRecord, context);
    const persisted = await writeBufferEntry(username, 'inner', { role, content: text, meta, timestamp });
    if (!persisted) {
      return {
        saved: false,
        persisted: false,
        entries: [],
        text: '',
        reason: 'Inner-dialogue buffer rejected the entry',
        passthrough,
        bufferPath: getBufferPathForUser(username, 'inner'),
      };
    }
    const durableEntry = idempotencyKey
      ? loadBufferForUser(username, 'inner').messages.find(
        message => message.meta?.idempotencyKey === idempotencyKey,
      )
      : undefined;
    if (idempotencyKey && !durableEntry) {
      throw new Error('Inner-dialogue buffer did not retain the admitted idempotent entry');
    }
    const admittedEntry: ConversationMessage = durableEntry || {
      role,
      content: text,
      meta,
      timestamp,
    };
    const durableText = admittedEntry.content;

    return {
      saved: persisted,
      persisted,
      text: durableText,
      role,
      entry: admittedEntry,
      entries: [admittedEntry],
      bufferPath: getBufferPathForUser(username, 'inner'),
      passthrough,
    };
  } catch (error) {
    console.error('[InnerDialogueBuffer] Error:', error);
    throw error;
  }
};

const execute: NodeExecutor = async (inputs, context, properties) => {
  if (!Array.isArray(inputs.entries)) {
    return admitSingle(inputs, context, properties);
  }

  if (inputs.entries.length === 0) {
    return {
      saved: false,
      persisted: false,
      savedCount: 0,
      roleCounts: {},
      results: [],
      entries: [],
      text: '',
      reason: 'No inner-dialogue entries to admit',
      passthrough: inputs.passthrough,
    };
  }

  const results: Record<string, any>[] = [];
  for (const rawEntry of inputs.entries) {
    const entry = typeof rawEntry === 'string' ? { content: rawEntry } : rawEntry;
    const result = await admitSingle({
      ...inputs,
      entries: undefined,
      entry,
      text: undefined,
      thinking: undefined,
    }, context, properties);
    results.push(result);
    if (!result.saved) break;
  }

  const savedResults = results.filter(result => result.saved);
  const roleCounts = savedResults.reduce<Record<string, number>>((counts, result) => {
    const role = typeof result.role === 'string' ? result.role : 'unknown';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const saved = results.length === inputs.entries.length && savedResults.length === inputs.entries.length;
  const firstFailure = results.find(result => !result.saved);
  const admittedEntries = savedResults.flatMap(result => Array.isArray(result.entries) ? result.entries : []);

  return {
    saved,
    persisted: saved,
    savedCount: savedResults.length,
    roleCounts,
    results,
    entry: admittedEntries[0],
    entries: admittedEntries,
    text: savedResults[0]?.text || '',
    passthrough: inputs.passthrough,
    ...(firstFailure?.error ? { error: firstFailure.error } : {}),
    ...(firstFailure?.reason ? { reason: firstFailure.reason } : {}),
    bufferPath: results[0]?.bufferPath,
  };
};

export const InnerDialogueBufferNode = defineNode({
  id: 'inner_dialogue_buffer',
  name: 'Inner Dialogue Buffer',
  category: 'output',
  inputs: [
    { name: 'entry', type: 'message', optional: true, description: 'One typed inner-dialogue entry' },
    { name: 'entries', type: 'array', optional: true, description: 'Ordered typed inner-dialogue entries' },
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
    { name: 'entry', type: 'message', optional: true, description: 'First exact entry retained by the buffer' },
    { name: 'entries', type: 'array', description: 'Exact entries retained by the buffer for downstream long-term saving' },
    { name: 'results', type: 'array', description: 'Per-entry short-term admission results' },
    { name: 'savedCount', type: 'number' },
    { name: 'roleCounts', type: 'object' },
    { name: 'passthrough', type: 'any' },
    { name: 'bufferPath', type: 'string' },
  ],
  properties: {
    tags: ['idle-thought', 'self-reflection', 'inner'],
    displayColor: '',
    dialogueSource: '',
    role: 'reflection',
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
  },
  description: 'Persists typed inner-dialogue entries to the rolling short-term buffer and emits the exact admitted entries for downstream saving.',
  execute,
});
