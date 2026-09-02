/**
 * Inner Dialogue Memory Saver Node
 *
 * Saves exact entries emitted by the Inner Dialogue Buffer to long-term
 * Persona Memory. Buffer retention and long-term memory remain independent.
 */

import type { ConversationMessage } from '../../conversation-buffer.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const INNER_ROLES = new Set<ConversationMessage['role']>([
  'thought',
  'reflection',
  'dream',
  'daydream',
  'reasoning',
]);

function stringList(value: unknown, fallback: string[] = []): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : fallback;
  return Array.from(new Set(values
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map(item => item.trim())));
}

function timestampForEntry(entry: ConversationMessage): string {
  const raw = entry.timestamp ?? entry.meta?.timestamp;
  const parsed = typeof raw === 'number'
    ? raw
    : typeof raw === 'string'
      ? Date.parse(raw)
      : Date.now();
  if (!Number.isFinite(parsed)) throw new Error('Inner-dialogue memory entry has an invalid timestamp');
  return new Date(parsed).toISOString();
}

function normalizeEntries(inputs: Record<string, any>): ConversationMessage[] {
  const rawEntries = Array.isArray(inputs.entries)
    ? inputs.entries
    : inputs.entry && typeof inputs.entry === 'object'
      ? [inputs.entry]
      : [];

  return rawEntries.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error(`Inner-dialogue memory entry ${index + 1} must be an object`);
    }
    const role = rawEntry.role as ConversationMessage['role'];
    const content = typeof rawEntry.content === 'string' ? rawEntry.content.trim() : '';
    if (!INNER_ROLES.has(role) || !content) {
      throw new Error(`Inner-dialogue memory entry ${index + 1} must contain a typed inner-dialogue message`);
    }
    return {
      role,
      content,
      timestamp: rawEntry.timestamp,
      meta: rawEntry.meta && typeof rawEntry.meta === 'object' ? { ...rawEntry.meta } : {},
    };
  });
}

const execute: NodeExecutor = async (inputs, context, properties = {}) => {
  const entries = normalizeEntries(inputs);
  if (entries.length === 0) {
    return { success: false, saved: false, savedCount: 0, entries: [], text: '', eventIds: [], eventPaths: [], results: [], reason: 'No admitted inner-dialogue entries' };
  }

  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  if (!username || username === 'anonymous') {
    throw new Error('Inner-dialogue memory saving requires an authenticated username');
  }

  const memoryWritesAllowed = context.recordPersonaMemory ?? context.allowMemoryWrites ?? false;
  if (memoryWritesAllowed !== true) {
    return { success: false, saved: false, savedCount: 0, entries: [], text: '', eventIds: [], eventPaths: [], results: [], reason: 'Persona Memory writes disabled' };
  }

  const configuredRoles = stringList(properties.roles);
  const selectedEntries = configuredRoles.length > 0
    ? entries.filter(entry => configuredRoles.includes(entry.role))
    : entries;
  if (selectedEntries.length === 0) {
    return { success: true, saved: true, savedCount: 0, entries: [], text: '', eventIds: [], eventPaths: [], results: [], filteredCount: entries.length };
  }

  const propertyTags = stringList(properties.tags, ['inner']);
  const results: CaptureResult[] = selectedEntries.map(entry => {
    const tags = stringList(entry.meta?.tags, propertyTags);
    const idempotencyKey = typeof entry.meta?.idempotencyKey === 'string'
      ? entry.meta.idempotencyKey.trim()
      : '';
    const type = entry.role === 'dream'
      ? 'dream'
      : entry.role === 'daydream'
        ? 'daydream'
        : 'inner_dialogue';
    return captureEventWithDetails(entry.content, {
      type,
      tags,
      importance: typeof entry.meta?.importance === 'number' ? entry.meta.importance : undefined,
      links: Array.isArray(entry.meta?.links) ? entry.meta.links : undefined,
      idempotencyKey: idempotencyKey || undefined,
      timestamp: timestampForEntry(entry),
      metadata: {
        ...entry.meta,
        role: entry.role,
        source: entry.meta?.source || (entry.role === 'thought' ? 'user' : 'agent'),
        sessionId: entry.meta?.sessionId || context.sessionId,
        nodeType: 'inner_dialogue_saver',
        skipDedup: true,
      },
    });
  });

  return {
    success: results.length === selectedEntries.length,
    saved: results.length === selectedEntries.length,
    savedCount: results.length,
    filteredCount: entries.length - selectedEntries.length,
    entries: selectedEntries,
    text: selectedEntries[0]?.content || '',
    eventId: results[0]?.eventId,
    eventIds: results.map(result => result.eventId),
    eventPath: results[0]?.filePath,
    eventPaths: results.map(result => result.filePath),
    results,
  };
};

export const InnerDialogueSaverNode: NodeDefinition = defineNode({
  id: 'inner_dialogue_saver',
  name: 'Inner Dialogue Memory Saver',
  category: 'cognitive',
  inputs: [
    { name: 'entry', type: 'message', optional: true, description: 'One Inner Dialogue Buffer-admitted entry' },
    { name: 'entries', type: 'array', optional: true, description: 'Ordered Inner Dialogue Buffer-admitted entries' },
    { name: 'gate', type: 'boolean', optional: true, description: 'Optional upstream persistence gate used only for graph sequencing' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether every selected entry was saved' },
    { name: 'saved', type: 'boolean', description: 'Whether every selected entry was saved' },
    { name: 'savedCount', type: 'number' },
    { name: 'filteredCount', type: 'number' },
    { name: 'entries', type: 'array', description: 'Entries confirmed in long-term Persona Memory' },
    { name: 'text', type: 'string', description: 'First confirmed long-term memory text' },
    { name: 'eventId', type: 'string', optional: true },
    { name: 'eventIds', type: 'array' },
    { name: 'eventPath', type: 'string', optional: true },
    { name: 'eventPaths', type: 'array' },
    { name: 'results', type: 'array' },
  ],
  properties: {
    tags: ['inner'],
    roles: [],
  },
  propertySchemas: {
    tags: {
      type: 'tags',
      default: ['inner'],
      label: 'Tags',
      description: 'Fallback tags when the admitted entry has none.',
    },
    roles: {
      type: 'multiselect',
      default: [],
      label: 'Roles to Save',
      description: 'Leave empty to save every admitted inner-dialogue role.',
      options: ['thought', 'reflection', 'dream', 'daydream', 'reasoning'],
    },
  },
  description: 'Saves each admitted inner-dialogue entry as its matching long-term Persona Memory type.',
  execute,
});
