/**
 * Admission boundary for producers outside an existing cognitive graph.
 *
 * Conversation persistence belongs to the conversational graph that produced
 * or received the text. Inner Dialogue reuses its canonical buffer and memory
 * saver nodes directly; System and Robot records retain their distinct graph
 * workflows.
 */

import type { CanonicalBufferMode, ConversationMessage } from './conversation-buffer.js';
import { getUserContext, withUserContext } from './context.js';
import { getUserByUsername } from './users.js';

export type BufferEntry = Pick<ConversationMessage, 'role' | 'content' | 'meta'>;

export interface BufferAdmissionOptions {
  idempotencyKey?: string;
  memoryTimestamp?: string;
  sessionId?: string;
}

export interface BufferAdmissionReceipt {
  mode: AdmissionBufferMode;
  entries: ConversationMessage[];
  memoryResults: Array<{
    eventId: string;
    filePath: string;
    deduplicated?: boolean;
  }>;
}

type AdmissionBufferMode = Exclude<CanonicalBufferMode, 'conversation'>;

type GraphAdmissionBufferMode = Exclude<AdmissionBufferMode, 'inner'>;

const WORKFLOW_FILES: Record<GraphAdmissionBufferMode, string> = {
  system: 'system-event.json',
  robot: 'robot-buffer-admission.json',
};

async function runBufferAdmission(
  username: string,
  mode: AdmissionBufferMode,
  entry: BufferEntry,
  options: BufferAdmissionOptions = {},
): Promise<BufferAdmissionReceipt> {
  if (!username || username === 'anonymous') throw new Error(`${mode} admission requires an authenticated username`);
  if (!entry?.content?.trim()) throw new Error(`${mode} admission requires non-empty content`);

  const activeContext = getUserContext();
  const activeContextMatches = Boolean(
    activeContext
    && (activeContext.username === username || activeContext.activeProfile === username),
  );
  const account = activeContextMatches ? null : getUserByUsername(username);
  const userId = activeContextMatches ? activeContext!.userId : account?.id || username;
  const context: Record<string, unknown> = {
    username,
    userId,
    sessionId: options.sessionId,
    recordPersonaMemory: mode === 'inner',
    allowMemoryWrites: false,
    idempotencyKey: options.idempotencyKey,
    memoryTimestamp: options.memoryTimestamp,
  };
  if (mode === 'system') context.systemEvent = entry;
  else if (mode === 'robot') context.bridgeRecord = entry.meta?.bridgeRecord ?? entry.meta ?? entry;

  const executeAdmission = async (): Promise<BufferAdmissionReceipt> => {
    if (mode === 'inner') {
      const [{ InnerDialogueBufferNode }, { InnerDialogueSaverNode }] = await Promise.all([
        import('./nodes/output/inner-dialogue-buffer.node.js'),
        import('./nodes/cognitive/inner-dialogue-saver.node.js'),
      ]);
      const bufferOutput = await InnerDialogueBufferNode.execute({ entry }, context, {});
      if (bufferOutput.persisted !== true) {
        throw new Error(`inner buffer node did not persist the entry: ${bufferOutput.reason || 'unknown reason'}`);
      }
      const saverOutput = await InnerDialogueSaverNode.execute({ entries: bufferOutput.entries }, context, {});
      const admittedCount = Array.isArray(bufferOutput.entries) ? bufferOutput.entries.length : 0;
      if (saverOutput.saved !== true || saverOutput.savedCount !== admittedCount) {
        throw new Error(`inner Persona Memory saver did not persist every admitted entry: ${saverOutput.reason || 'unknown reason'}`);
      }
      return {
        mode,
        entries: bufferOutput.entries,
        memoryResults: Array.isArray(saverOutput.results) ? saverOutput.results : [],
      };
    }

    const {
      cognitiveGraphPath,
      listFailedNodes,
      loadGraphFile,
      requireGraphNodeOutput,
      runGraph,
    } = await import('./graph-runtime.js');
    const loaded = await loadGraphFile(cognitiveGraphPath(WORKFLOW_FILES[mode]), {
      logPrefix: `[buffer-admission:${mode}]`,
    });
    if (!loaded) throw new Error(`Could not load ${mode} buffer admission workflow`);

    const state = await runGraph({ graph: loaded.graph, context });
    const failures = listFailedNodes(state);
    if (failures.length > 0) {
      throw new Error(`${mode} buffer admission failed: ${failures[0].error}`);
    }

    const bufferNodeType = mode === 'system' ? 'system_buffer' : 'robot_buffer';
    const bufferOutput = requireGraphNodeOutput(state, bufferNodeType);
    if (bufferOutput.persisted !== true) {
      throw new Error(`${mode} buffer node completed without durable persistence`);
    }

    return {
      mode,
      entries: Array.isArray(bufferOutput.entries) ? bufferOutput.entries : [],
      memoryResults: [],
    };
  };

  return activeContextMatches
    ? executeAdmission()
    : withUserContext({
        userId,
        username,
        role: account?.role || 'standard',
      }, executeAdmission);
}

async function submitBufferEntry(
  username: string,
  mode: AdmissionBufferMode,
  entry: BufferEntry,
  options: BufferAdmissionOptions = {},
): Promise<boolean> {
  await runBufferAdmission(username, mode, entry, options);
  return true;
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

export function submitInnerReflection(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
  options?: BufferAdmissionOptions,
): Promise<boolean> {
  return submitInnerDialogue(username, {
    role: 'reflection',
    content,
    meta: { type: 'reflection', source: 'agent', ...meta },
  }, options);
}

/** Same canonical admission path, with the long-term saver receipt for provenance-aware producers. */
export function submitInnerReflectionWithResult(
  username: string,
  content: string,
  meta: Record<string, unknown> = {},
  options?: BufferAdmissionOptions,
): Promise<BufferAdmissionReceipt> {
  return runBufferAdmission(username, 'inner', {
    role: 'reflection',
    content,
    meta: { type: 'reflection', source: 'agent', ...meta },
  }, options);
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
