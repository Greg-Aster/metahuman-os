/**
 * Graph admission boundary for the four canonical buffers.
 *
 * Producers outside an existing cognitive graph submit typed work here. The
 * checked-in one-node workflows ensure persistence still occurs through the
 * same designated nodes used by larger workflows.
 */

import type { CanonicalBufferMode, ConversationMessage } from './conversation-buffer.js';

export type BufferEntry = Pick<ConversationMessage, 'role' | 'content' | 'meta'>;

export interface BufferAdmissionOptions {
  allowMemoryWrites?: boolean;
  captureMemory?: boolean;
  memoryContent?: string;
  sessionId?: string;
}

const WORKFLOW_FILES: Record<CanonicalBufferMode, string> = {
  conversation: 'conversation-buffer-admission.json',
  inner: 'inner-buffer-admission.json',
  system: 'system-event.json',
  robot: 'robot-buffer-admission.json',
};

export async function submitBufferEntry(
  username: string,
  mode: CanonicalBufferMode,
  entry: BufferEntry,
  options: BufferAdmissionOptions = {},
): Promise<boolean> {
  if (!username || username === 'anonymous') return false;
  if (!entry?.content?.trim()) return false;

  const {
    cognitiveGraphPath,
    collectNodeOutputs,
    listFailedNodes,
    loadGraphFile,
    runGraph,
  } = await import('./graph-runtime.js');
  const loaded = await loadGraphFile(cognitiveGraphPath(WORKFLOW_FILES[mode]), {
    logPrefix: `[buffer-admission:${mode}]`,
  });
  if (!loaded) {
    throw new Error(`Could not load ${mode} buffer admission workflow`);
  }

  const context: Record<string, unknown> = {
    username,
    userId: username,
    sessionId: options.sessionId,
    allowMemoryWrites: options.allowMemoryWrites ?? false,
    captureMemory: options.captureMemory ?? false,
    memoryContent: options.memoryContent,
  };
  if (mode === 'system') context.systemEvent = entry;
  else if (mode === 'robot') context.bridgeRecord = entry.meta?.bridgeRecord ?? entry.meta ?? entry;
  else context.bufferEntry = entry;

  const state = await runGraph({ graph: loaded.graph, context });
  const failures = listFailedNodes(state);
  if (failures.length > 0) {
    throw new Error(`${mode} buffer admission failed: ${failures[0].error}`);
  }

  return Object.values(collectNodeOutputs(state)).some(output => output?.persisted === true || output?.saved === true);
}

export function submitConversationEntry(
  username: string,
  entry: BufferEntry,
  options?: BufferAdmissionOptions,
): Promise<boolean> {
  return submitBufferEntry(username, 'conversation', entry, options);
}

export async function submitConversationSummary(
  username: string,
  summary: { sessionId: string; content: string; messageCount: number },
): Promise<boolean> {
  const {
    cognitiveGraphPath,
    collectNodeOutputs,
    listFailedNodes,
    loadGraphFile,
    runGraph,
  } = await import('./graph-runtime.js');
  const loaded = await loadGraphFile(cognitiveGraphPath(WORKFLOW_FILES.conversation), {
    logPrefix: '[buffer-admission:conversation-summary]',
  });
  if (!loaded) throw new Error('Could not load Conversation Buffer admission workflow');
  const state = await runGraph({
    graph: loaded.graph,
    context: { username, userId: username, bufferSummary: summary },
  });
  const failures = listFailedNodes(state);
  if (failures.length > 0) throw new Error(`Conversation summary admission failed: ${failures[0].error}`);
  return Object.values(collectNodeOutputs(state)).some(output => output?.persisted === true);
}

export function submitInnerDialogue(
  username: string,
  entry: BufferEntry,
  options?: BufferAdmissionOptions,
): Promise<boolean> {
  return submitBufferEntry(username, 'inner', entry, options);
}

export function submitSystemEvent(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitBufferEntry(username, 'system', {
    role: 'system',
    content,
    meta,
  });
}

/** Admit an Environment Bridge record through the designated Robot Buffer node. */
export function submitRobotBridgeRecord(
  username: string,
  bridgeRecord: Record<string, unknown>,
  options?: BufferAdmissionOptions,
): Promise<boolean> {
  const status = typeof bridgeRecord.status === 'string' ? bridgeRecord.status : 'unknown';
  const message = typeof bridgeRecord.message === 'string'
    ? bridgeRecord.message
    : 'Robot bridge record';
  return submitBufferEntry(username, 'robot', {
    role: 'robot',
    content: `Robot bridge ${status}: ${message}`,
    meta: { bridgeRecord },
  }, options);
}

export function submitAgencyConversationEntry(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitConversationEntry(username, {
    role: 'assistant',
    content,
    meta: {
      type: 'agency_message',
      source: 'agency',
      dialogueSource: 'agency-system',
      isAgencyMessage: true,
      ...meta,
    },
  });
}

export function submitInnerReflection(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitInnerDialogue(username, {
    role: 'reflection',
    content,
    meta: { type: 'reflection', source: 'agent', ...meta },
  });
}

export function submitInnerDream(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitInnerDialogue(username, {
    role: 'dream',
    content,
    meta: { type: 'dream', source: 'agent', ...meta },
  });
}

export function submitInnerDaydream(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitInnerDialogue(username, {
    role: 'daydream',
    content,
    meta: { type: 'daydream', source: 'agent', dialogueSource: 'inner', ...meta },
  });
}

export function submitInnerReasoning(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitInnerDialogue(username, {
    role: 'reasoning',
    content,
    meta: { type: 'reasoning', source: 'agent', displayColor: '#8b5cf6', ...meta },
  });
}

export function submitExecutionProgress(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return submitSystemEvent(username, content, {
    type: 'execution_progress',
    source: 'big-brother',
    dialogueSource: 'big-brother',
    displayColor: '#f59e0b',
    ...meta,
  });
}
