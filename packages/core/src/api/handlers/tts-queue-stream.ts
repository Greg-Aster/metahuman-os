import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler, UnifiedRequest } from '../types.js';
import {
  badRequestResponse,
  errorResponse,
  streamResponse,
  successResponse,
} from '../types.js';
import {
  claimNextTTS,
  getTTSNotificationPath,
  getTTSQueueState,
  interruptTTSQueue,
  TTS_DELIVERY_LEASE_MS,
  updateTTSDelivery,
  type TTSDeliveryAction,
  type TTSInterruptionReason,
} from '../../tts/delivery-queue.js';

const HEARTBEAT_MS = 15_000;
const VALID_CONSUMER_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const VALID_ITEM_ID = /^tts-[a-zA-Z0-9-]{1,160}$/;
const VALID_LEASE_TOKEN = /^[a-zA-Z0-9-]{16,128}$/;
const DELIVERY_ACTIONS = new Set<TTSDeliveryAction>([
  'complete',
  'renew',
  'retry',
  'suppress',
  'interrupt',
]);
const INTERRUPTION_REASONS = new Set<TTSInterruptionReason>([
  'user-input',
  'barge-in',
  'manual-stop',
  'speech-disabled',
]);

interface QueueStreamConnection {
  key: symbol;
  activate: () => void;
}

// A profile has one local playback owner. The newest application shell owns
// playback while older tabs remain connected as standbys instead of entering an
// EventSource reconnect race. Item leases protect any delivery already in flight.
const queueStreamConnections = new Map<string, QueueStreamConnection[]>();

function data(type: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

async function* ttsQueueEvents(
  req: UnifiedRequest,
  consumerId: string,
): AsyncIterable<string> {
  const username = req.user.username;
  const notifyPath = getTTSNotificationPath(username);
  const notifyDir = path.dirname(notifyPath);
  const notifyFilename = path.basename(notifyPath);
  const chunks: string[] = [];
  const streamKey = Symbol(`tts-queue:${username}:${consumerId}`);
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let leaseTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  let closed = false;
  let registered = false;
  let unregister = (): void => {};
  let observedInterruptionRevision = getTTSQueueState(username).interruptionRevision;

  const push = (chunk: string): void => {
    if (closed) return;
    chunks.push(chunk);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const clearTimers = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (leaseTimer) clearTimeout(leaseTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    debounceTimer = null;
    leaseTimer = null;
    heartbeatTimer = null;
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearTimers();
    watcher?.close();
    watcher = null;
    unregister();
    if (wake) {
      wake();
      wake = null;
    }
  };

  const isActiveOwner = (): boolean => (
    queueStreamConnections.get(username)?.at(-1)?.key === streamKey
  );

  let checkQueue = (): void => {};
  const scheduleQueueCheck = (at: number | null): void => {
    if (leaseTimer) clearTimeout(leaseTimer);
    leaseTimer = null;
    if (at === null || closed || !isActiveOwner()) return;
    const delay = Math.max(50, Math.min(at - Date.now(), 2_147_483_647));
    leaseTimer = setTimeout(checkQueue, delay);
  };

  checkQueue = (): void => {
    if (closed || !isActiveOwner()) return;
    try {
      const state = getTTSQueueState(username);
      if (state.interruptionRevision > observedInterruptionRevision) {
        observedInterruptionRevision = state.interruptionRevision;
        push(data('interrupt', {
          generation: state.generation,
          interruption: state.lastInterruption,
        }));
      }
      const claim = claimNextTTS(username, consumerId);
      if (claim.item) {
        push(data('tts', { item: claim.item }));
        console.log(`[tts-queue-stream] Leased ${claim.item.id} to ${username}/${consumerId}`);
      }
      scheduleQueueCheck(claim.nextCheckAt);
    } catch (error) {
      console.error('[tts-queue-stream] Failed to claim queued speech:', error);
      push(data('error', { error: 'Failed to claim queued speech' }));
      scheduleQueueCheck(Date.now() + 1_000);
    }
  };

  const scheduleHeartbeat = (): void => {
    if (closed) return;
    heartbeatTimer = setTimeout(() => {
      push(data('heartbeat', { timestamp: Date.now() }));
      scheduleHeartbeat();
    }, HEARTBEAT_MS);
  };

  const connection: QueueStreamConnection = {
    key: streamKey,
    activate: () => {
      if (closed) return;
      push(data('owner', { consumerId }));
      checkQueue();
    },
  };

  unregister = (): void => {
    if (!registered) return;
    registered = false;
    const connections = queueStreamConnections.get(username) ?? [];
    const wasActiveOwner = connections.at(-1)?.key === streamKey;
    const remaining = connections.filter((candidate) => candidate.key !== streamKey);
    if (remaining.length === 0) {
      queueStreamConnections.delete(username);
      return;
    }
    queueStreamConnections.set(username, remaining);
    if (wasActiveOwner) remaining.at(-1)?.activate();
  };

  req.signal?.addEventListener('abort', close, { once: true });
  const connections = queueStreamConnections.get(username) ?? [];
  connections.push(connection);
  queueStreamConnections.set(username, connections);
  registered = true;

  try {
    fs.mkdirSync(notifyDir, { recursive: true });
    watcher = fs.watch(notifyDir, (_eventType, filename) => {
      if (filename !== notifyFilename || !isActiveOwner()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkQueue, 100);
    });
    watcher.on('error', (error) => {
      console.error('[tts-queue-stream] Watcher error:', error);
      push(data('error', { error: 'TTS queue watcher failed' }));
    });

    push(data('connected', {
      username,
      consumerId,
      leaseDurationMs: TTS_DELIVERY_LEASE_MS,
      active: isActiveOwner(),
      generation: getTTSQueueState(username).generation,
    }));
    scheduleHeartbeat();
    checkQueue();

    while (!closed) {
      while (chunks.length > 0) yield chunks.shift()!;
      if (closed) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    req.signal?.removeEventListener('abort', close);
    close();
  }
}

export const handleTtsQueueStream: UnifiedHandler = async (req) => {
  if (!req.user.isAuthenticated) return errorResponse('Authentication required', 401);
  const consumerId = req.query?.consumerId?.trim() ?? '';
  if (!VALID_CONSUMER_ID.test(consumerId)) {
    return badRequestResponse('A valid TTS queue consumerId is required');
  }
  return streamResponse(ttsQueueEvents(req, consumerId));
};

export const handleTtsQueueDelivery: UnifiedHandler = async (req) => {
  if (!req.user.isAuthenticated) return errorResponse('Authentication required', 401);
  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId.trim() : '';
  const leaseToken = typeof req.body?.leaseToken === 'string' ? req.body.leaseToken.trim() : '';
  const action = req.body?.action as TTSDeliveryAction | undefined;

  if (!VALID_ITEM_ID.test(itemId)) return badRequestResponse('A valid TTS itemId is required');
  if (!VALID_LEASE_TOKEN.test(leaseToken)) return badRequestResponse('A valid TTS leaseToken is required');
  if (!action || !DELIVERY_ACTIONS.has(action)) {
    return badRequestResponse('A valid TTS delivery action is required');
  }

  const result = updateTTSDelivery(
    req.user.username,
    itemId,
    leaseToken,
    action,
  );
  if (result.state === 'missing') return errorResponse('TTS queue item no longer exists', 404);
  if (result.state === 'lease-mismatch') return errorResponse('TTS delivery lease is no longer owned', 409);
  return successResponse(result);
};

export const handleTtsQueueInterrupt: UnifiedHandler = async (req) => {
  if (!req.user.isAuthenticated) return errorResponse('Authentication required', 401);
  const reason = req.body?.reason as TTSInterruptionReason | undefined;
  if (!reason || !INTERRUPTION_REASONS.has(reason)) {
    return badRequestResponse('A valid TTS interruption reason is required');
  }

  const result = interruptTTSQueue(req.user.username, reason);
  if (!result) return errorResponse('TTS interruption requires an authenticated profile', 400);
  return successResponse(result);
};
