import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths, systemPaths } from '../path-builder.js';

export const TTS_DELIVERY_LEASE_MS = 20_000;
export const TTS_DELIVERY_RETRY_DELAY_MS = 5_000;
export const TTS_DELIVERY_MAX_ATTEMPTS = 3;
export const TTS_DELIVERY_MAX_AGE_MS = 10 * 60_000;

export interface TTSQueueItem {
  id: string;
  text: string;
  mode: 'conversation' | 'inner';
  source?: string;
  timestamp: number;
  generation?: number;
  deliveryAttempts?: number;
  availableAt?: number;
  lease?: {
    token: string;
    consumerId: string;
    expiresAt: number;
  };
}

export interface FailedTTSQueueItem extends TTSQueueItem {
  failedAt: number;
  failureReason: 'expired' | 'retry-limit';
}

export interface TTSQueue {
  version?: 3;
  items: TTSQueueItem[];
  failed?: FailedTTSQueueItem[];
  generation?: number;
  interruptionRevision?: number;
  lastInterruption?: TTSQueueInterruption;
  lastUpdated: string;
}

export type TTSInterruptionReason =
  | 'user-input'
  | 'barge-in'
  | 'manual-stop'
  | 'speech-disabled';

export interface TTSQueueInterruption {
  revision: number;
  generation: number;
  reason: TTSInterruptionReason;
  interruptedAt: number;
  interruptedCount: number;
  activeCount: number;
}

export interface TTSQueueInterruptionResult extends TTSQueueInterruption {
  accepted: true;
}

export interface TTSQueueState {
  generation: number;
  interruptionRevision: number;
  lastInterruption?: TTSQueueInterruption;
}

export interface ClaimedTTSQueueItem extends Omit<TTSQueueItem, 'lease'> {
  leaseToken: string;
  leaseExpiresAt: number;
}

export interface TTSQueueClaimResult {
  item: ClaimedTTSQueueItem | null;
  nextCheckAt: number | null;
}

export type TTSDeliveryAction = 'complete' | 'renew' | 'retry' | 'suppress' | 'interrupt';

export interface TTSDeliveryUpdateResult {
  accepted: boolean;
  state: 'completed' | 'renewed' | 'retrying' | 'failed' | 'suppressed' | 'interrupted' | 'missing' | 'lease-mismatch';
  leaseExpiresAt?: number;
  nextCheckAt?: number;
}

interface TTSDeliveryQueueStoreOptions {
  queuePath: string;
  fallbackPath?: string;
  notificationPath: string;
  now?: () => number;
  createToken?: () => string;
}

function isNoSpaceError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOSPC';
}

function isQueueItem(value: unknown): value is TTSQueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TTSQueueItem>;
  return typeof item.id === 'string'
    && typeof item.text === 'string'
    && (item.mode === 'conversation' || item.mode === 'inner')
    && typeof item.timestamp === 'number';
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // The original write error is authoritative.
    }
    throw error;
  }
}

export class TTSDeliveryQueueStore {
  private readonly queuePath: string;
  private readonly fallbackPath?: string;
  private readonly notificationPath: string;
  private readonly now: () => number;
  private readonly createToken: () => string;

  constructor(options: TTSDeliveryQueueStoreOptions) {
    this.queuePath = options.queuePath;
    this.fallbackPath = options.fallbackPath;
    this.notificationPath = options.notificationPath;
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? randomUUID;
  }

  enqueue(
    text: string,
    mode: 'conversation' | 'inner',
    source?: string,
    expectedGeneration?: number,
  ): TTSQueueItem | null {
    if (!text?.trim()) return null;

    try {
      const { queue, activePath } = this.loadActiveQueue();
      const now = this.now();
      const generation = queue.generation ?? 0;
      if (expectedGeneration !== undefined && expectedGeneration !== generation) {
        console.log(
          `[TTS Queue] Rejected stale speech from generation ${expectedGeneration}; `
          + `current generation is ${generation}`,
        );
        return null;
      }
      if (queue.items.length >= 10) {
        console.warn('[TTS Queue] Queue is full; rejecting new speech without dropping an existing delivery');
        return null;
      }
      const item: TTSQueueItem = {
        id: `tts-${now}-${Math.random().toString(36).slice(2, 8)}`,
        text: text.trim(),
        mode,
        source,
        timestamp: now,
        generation,
        deliveryAttempts: 0,
      };

      queue.items.push(item);
      this.saveQueue(activePath, queue, 'queue write');
      this.notify();
      console.log(`[TTS Queue] Queued item ${item.id} (${mode})`);
      return item;
    } catch (error) {
      console.error('[TTS Queue] Failed to queue item:', error);
      return null;
    }
  }

  interrupt(
    reason: TTSInterruptionReason,
    options: { advanceGeneration?: boolean } = {},
  ): TTSQueueInterruptionResult {
    const { queue, activePath } = this.loadActiveQueue();
    const now = this.now();
    const interruptedCount = queue.items.length;
    const activeCount = queue.items.filter(item => Boolean(item.lease)).length;
    const generation = (queue.generation ?? 0) + (options.advanceGeneration ? 1 : 0);
    const interruptionRevision = (queue.interruptionRevision ?? 0) + 1;
    const interruption: TTSQueueInterruption = {
      revision: interruptionRevision,
      generation,
      reason,
      interruptedAt: now,
      interruptedCount,
      activeCount,
    };

    queue.items = [];
    queue.generation = generation;
    queue.interruptionRevision = interruptionRevision;
    queue.lastInterruption = interruption;
    this.saveQueue(activePath, queue, 'queue interruption');
    this.notify();
    console.log(
      `[TTS Queue] Interrupted ${interruptedCount} item(s) for ${reason} `
      + `(generation ${generation}, revision ${interruptionRevision})`,
    );
    return { accepted: true, ...interruption };
  }

  claimNext(consumerId: string): TTSQueueClaimResult {
    const { queue, activePath } = this.loadActiveQueue();
    const now = this.now();
    let changed = this.expireUndeliverableItems(queue, now);

    const activeLease = queue.items.find((item) => item.lease && item.lease.expiresAt > now);
    if (activeLease?.lease) {
      if (changed) this.saveQueue(activePath, queue, 'queue maintenance');
      return { item: null, nextCheckAt: activeLease.lease.expiresAt };
    }

    const candidate = queue.items[0];
    const nextCheckAt = candidate?.availableAt && candidate.availableAt > now
      ? candidate.availableAt
      : null;

    if (!candidate || nextCheckAt !== null) {
      if (changed) this.saveQueue(activePath, queue, 'queue maintenance');
      return { item: null, nextCheckAt };
    }

    const leaseToken = this.createToken();
    const leaseExpiresAt = now + TTS_DELIVERY_LEASE_MS;
    candidate.deliveryAttempts = (candidate.deliveryAttempts ?? 0) + 1;
    delete candidate.availableAt;
    candidate.lease = {
      token: leaseToken,
      consumerId,
      expiresAt: leaseExpiresAt,
    };
    changed = true;

    if (changed) this.saveQueue(activePath, queue, 'delivery claim');
    const { lease: _lease, ...claimedItem } = candidate;
    console.log(
      `[TTS Queue] Claimed ${candidate.id} for ${consumerId} `
      + `(attempt ${candidate.deliveryAttempts}/${TTS_DELIVERY_MAX_ATTEMPTS})`,
    );
    return {
      item: {
        ...claimedItem,
        leaseToken,
        leaseExpiresAt,
      },
      nextCheckAt: leaseExpiresAt,
    };
  }

  updateDelivery(
    itemId: string,
    leaseToken: string,
    action: TTSDeliveryAction,
  ): TTSDeliveryUpdateResult {
    const { queue, activePath } = this.loadActiveQueue();
    const itemIndex = queue.items.findIndex((item) => item.id === itemId);
    if (itemIndex < 0) return { accepted: false, state: 'missing' };

    const item = queue.items[itemIndex]!;
    if (!item.lease || item.lease.token !== leaseToken) {
      return { accepted: false, state: 'lease-mismatch' };
    }

    const now = this.now();
    if (action === 'renew') {
      item.lease.expiresAt = now + TTS_DELIVERY_LEASE_MS;
      this.saveQueue(activePath, queue, 'delivery lease renewal');
      return {
        accepted: true,
        state: 'renewed',
        leaseExpiresAt: item.lease.expiresAt,
      };
    }

    if (action === 'complete' || action === 'suppress' || action === 'interrupt') {
      queue.items.splice(itemIndex, 1);
      const context = action === 'complete'
        ? 'delivery completion'
        : action === 'suppress'
          ? 'delivery suppression'
          : 'delivery interruption';
      this.saveQueue(activePath, queue, context);
      this.notify();
      const state = action === 'complete'
        ? 'completed'
        : action === 'suppress'
          ? 'suppressed'
          : 'interrupted';
      console.log(`[TTS Queue] ${state} ${itemId}`);
      return {
        accepted: true,
        state,
      };
    }

    delete item.lease;
    if ((item.deliveryAttempts ?? 0) >= TTS_DELIVERY_MAX_ATTEMPTS) {
      this.failItem(queue, itemIndex, now, 'retry-limit');
      this.saveQueue(activePath, queue, 'delivery retry limit');
      this.notify();
      return { accepted: true, state: 'failed', nextCheckAt: now };
    }

    item.availableAt = now + TTS_DELIVERY_RETRY_DELAY_MS;
    this.saveQueue(activePath, queue, 'delivery retry');
    this.notify();
    return {
      accepted: true,
      state: 'retrying',
      nextCheckAt: item.availableAt,
    };
  }

  peek(): TTSQueueItem[] {
    return this.loadActiveQueue().queue.items;
  }

  readQueue(): TTSQueue {
    return this.loadActiveQueue().queue;
  }

  readState(): TTSQueueState {
    const queue = this.loadActiveQueue().queue;
    return {
      generation: queue.generation ?? 0,
      interruptionRevision: queue.interruptionRevision ?? 0,
      lastInterruption: queue.lastInterruption,
    };
  }

  private defaultQueue(): TTSQueue {
    return {
      version: 3,
      items: [],
      failed: [],
      generation: 0,
      interruptionRevision: 0,
      lastUpdated: new Date(this.now()).toISOString(),
    };
  }

  private loadActiveQueue(): { queue: TTSQueue; activePath: string } {
    try {
      return { queue: this.loadQueue(this.queuePath), activePath: this.queuePath };
    } catch (error) {
      if (!this.fallbackPath || !isNoSpaceError(error)) throw error;
      console.warn(`[TTS Queue] Primary queue path is full; using ${this.fallbackPath}`);
      return { queue: this.loadQueue(this.fallbackPath), activePath: this.fallbackPath };
    }
  }

  private loadQueue(queuePath: string): TTSQueue {
    if (!fs.existsSync(queuePath)) return this.defaultQueue();

    try {
      const raw = fs.readFileSync(queuePath, 'utf8').trim();
      if (!raw) return this.defaultQueue();
      const parsed = JSON.parse(raw) as Partial<TTSQueue>;
      const queue = this.defaultQueue();
      queue.items = Array.isArray(parsed.items) ? parsed.items.filter(isQueueItem) : [];
      queue.failed = Array.isArray(parsed.failed)
        ? parsed.failed.filter(isQueueItem) as FailedTTSQueueItem[]
        : [];
      queue.generation = typeof parsed.generation === 'number' && Number.isFinite(parsed.generation)
        ? Math.max(0, Math.floor(parsed.generation))
        : 0;
      queue.interruptionRevision = typeof parsed.interruptionRevision === 'number'
        && Number.isFinite(parsed.interruptionRevision)
        ? Math.max(0, Math.floor(parsed.interruptionRevision))
        : 0;
      if (
        parsed.lastInterruption
        && typeof parsed.lastInterruption === 'object'
        && typeof parsed.lastInterruption.revision === 'number'
        && typeof parsed.lastInterruption.generation === 'number'
        && typeof parsed.lastInterruption.reason === 'string'
        && typeof parsed.lastInterruption.interruptedAt === 'number'
      ) {
        queue.lastInterruption = parsed.lastInterruption as TTSQueueInterruption;
      }
      queue.lastUpdated = typeof parsed.lastUpdated === 'string'
        ? parsed.lastUpdated
        : queue.lastUpdated;
      return queue;
    } catch (error) {
      console.error(`[TTS Queue] Failed to read ${queuePath}; preserving a backup`, error);
      const backupPath = `${queuePath}.corrupted-${this.now()}`;
      try {
        fs.copyFileSync(queuePath, backupPath);
      } catch (backupError) {
        console.error('[TTS Queue] Failed to preserve corrupt queue:', backupError);
      }
      return this.defaultQueue();
    }
  }

  private saveQueue(activePath: string, queue: TTSQueue, context: string): string {
    queue.version = 3;
    queue.lastUpdated = new Date(this.now()).toISOString();
    try {
      atomicWriteJson(activePath, queue);
      return activePath;
    } catch (error) {
      if (activePath === this.queuePath && this.fallbackPath && isNoSpaceError(error)) {
        console.warn(`[TTS Queue] ${context} failed with ENOSPC; using ${this.fallbackPath}`);
        atomicWriteJson(this.fallbackPath, queue);
        return this.fallbackPath;
      }
      throw error;
    }
  }

  private expireUndeliverableItems(queue: TTSQueue, now: number): boolean {
    let changed = false;
    for (let index = queue.items.length - 1; index >= 0; index--) {
      const item = queue.items[index]!;
      if (now - item.timestamp > TTS_DELIVERY_MAX_AGE_MS) {
        this.failItem(queue, index, now, 'expired');
        changed = true;
        continue;
      }
      if (
        item.lease
        && item.lease.expiresAt <= now
        && (item.deliveryAttempts ?? 0) >= TTS_DELIVERY_MAX_ATTEMPTS
      ) {
        this.failItem(queue, index, now, 'retry-limit');
        changed = true;
      }
    }
    return changed;
  }

  private failItem(
    queue: TTSQueue,
    itemIndex: number,
    failedAt: number,
    failureReason: FailedTTSQueueItem['failureReason'],
  ): void {
    const [item] = queue.items.splice(itemIndex, 1);
    if (!item) return;
    const { lease: _lease, availableAt: _availableAt, ...failedItem } = item;
    queue.failed = [
      ...(queue.failed ?? []),
      { ...failedItem, failedAt, failureReason },
    ].slice(-10);
    console.warn(`[TTS Queue] ${item.id} moved to failed delivery state (${failureReason})`);
  }

  private notify(): void {
    try {
      fs.mkdirSync(path.dirname(this.notificationPath), { recursive: true });
      fs.writeFileSync(this.notificationPath, new Date(this.now()).toISOString());
    } catch (error) {
      console.warn('[TTS Queue] Failed to notify delivery consumer:', error);
    }
  }
}

export function getTTSQueuePath(username: string): string {
  return path.join(getProfilePaths(username).state, 'tts-queue.json');
}

export function getFallbackTTSQueuePath(username: string): string {
  return path.join(systemPaths.run, 'tts-queue', `${username}.json`);
}

export function getTTSNotificationPath(username: string): string {
  return path.join(systemPaths.run, 'tts-notifications', `${username}.notify`);
}

export function createTTSDeliveryQueueStore(username: string): TTSDeliveryQueueStore {
  return new TTSDeliveryQueueStore({
    queuePath: getTTSQueuePath(username),
    fallbackPath: getFallbackTTSQueuePath(username),
    notificationPath: getTTSNotificationPath(username),
  });
}

export function queueTTS(
  username: string,
  text: string,
  mode: 'conversation' | 'inner',
  source?: string,
  expectedGeneration?: number,
): TTSQueueItem | null {
  if (!username || username === 'anonymous') return null;
  return createTTSDeliveryQueueStore(username).enqueue(text, mode, source, expectedGeneration);
}

export function interruptTTSQueue(
  username: string,
  reason: TTSInterruptionReason,
  options: { advanceGeneration?: boolean } = {},
): TTSQueueInterruptionResult | null {
  if (!username || username === 'anonymous') return null;
  return createTTSDeliveryQueueStore(username).interrupt(reason, options);
}

export function beginTTSUserTurn(
  username: string,
  reason: Extract<TTSInterruptionReason, 'user-input' | 'barge-in'> = 'user-input',
): TTSQueueInterruptionResult | null {
  return interruptTTSQueue(username, reason, { advanceGeneration: true });
}

export function getTTSQueueState(username: string): TTSQueueState {
  return createTTSDeliveryQueueStore(username).readState();
}

export function claimNextTTS(username: string, consumerId: string): TTSQueueClaimResult {
  return createTTSDeliveryQueueStore(username).claimNext(consumerId);
}

export function updateTTSDelivery(
  username: string,
  itemId: string,
  leaseToken: string,
  action: TTSDeliveryAction,
): TTSDeliveryUpdateResult {
  return createTTSDeliveryQueueStore(username).updateDelivery(itemId, leaseToken, action);
}

export function peekTTSQueue(username: string): TTSQueueItem[] {
  return createTTSDeliveryQueueStore(username).peek();
}
