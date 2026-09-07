import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { systemPaths } from './path-builder.js';
import { withBufferLock } from './buffer-locks.js';
import { eventBus } from './infrastructure/event-bus/client.js';
import { loadChatSettingsForUser } from './chat-settings.js';
import type { GraphNodeExecution } from './durable-execution/graph-contract.js';

export type CanonicalBufferMode = 'inner' | 'conversation' | 'system' | 'robot';

/**
 * Touch a notification file on LOCAL disk to signal buffer updates.
 * This allows fs.watch() to work reliably even when buffer is on LUKS/NFS/FUSE.
 * The notification file is tiny and just triggers re-reads of the actual buffer.
 */
export function touchBufferNotification(username: string, mode: CanonicalBufferMode): void {
  try {
    const notifyDir = path.join(systemPaths.run, 'buffer-notifications');
    fs.mkdirSync(notifyDir, { recursive: true });
    const notifyFile = path.join(notifyDir, `${username}-${mode}.notify`);
    const now = new Date().toISOString();
    fs.writeFileSync(notifyFile, now);
  } catch {
    // Non-critical - buffer still works, just won't get instant SSE updates
  }
}

/**
 * Get the path to the notification file for a user's buffer
 */
export function getBufferNotificationPath(username: string, mode: CanonicalBufferMode): string {
  return path.join(systemPaths.run, 'buffer-notifications', `${username}-${mode}.notify`);
}

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant' | 'robot' | 'thought' | 'reflection' | 'dream' | 'daydream' | 'reasoning';
  content: string;
  meta?: any;
  timestamp?: number;
};

export type ConversationBuffer = {
  messages: ConversationMessage[];
  lastUpdated: string;
  userMessageCount?: number;
  /** Admission receipts outlive the visible window until every referencing execution retires. */
  executionAdmissions?: Record<string, { executionIds: string[]; contentHash: string }>;
};

function normalizeExecutionAdmissions(admissions: ConversationBuffer['executionAdmissions']): ConversationBuffer['executionAdmissions'] {
  if (!admissions) return admissions;
  return Object.fromEntries(Object.entries(admissions).map(([key, receipt]) => {
    if (Array.isArray(receipt.executionIds)) return [key, receipt];
    // Migrate existing persisted single-execution receipts at their storage owner.
    const executionId = (receipt as unknown as { executionId?: unknown }).executionId;
    if (typeof executionId !== 'string') throw new Error('Invalid buffer execution admission receipt');
    return [key, { executionIds: [executionId], contentHash: receipt.contentHash }];
  }));
}

/**
 * Create an empty valid buffer structure
 */
function createEmptyBuffer(): ConversationBuffer {
  return {
    messages: [],
    lastUpdated: new Date().toISOString(),
    userMessageCount: 0,
  };
}

/** One admission path for node outputs: commit intent before publishing the entry. */
export async function admitBufferEntry(username: string, mode: CanonicalBufferMode, message: ConversationMessage,
  execution?: GraphNodeExecution, index = 0): Promise<ConversationMessage> {
  if (execution) {
    const entry = { ...message, timestamp: message.timestamp ?? Date.now(), meta: { ...message.meta,
      executionId: execution.executionId,
      idempotencyKey: message.meta?.idempotencyKey || `${execution.occurrenceId}:${mode}:${message.role}:${index}` } };
    execution.dispatch({ kind: 'buffer_entry', payload: { mode, message: entry } });
    return entry;
  }
  if (!await writeBufferEntry(username, mode, message)) throw new Error('Buffer rejected the entry');
  const key = message.meta?.idempotencyKey;
  return key ? loadBufferForUser(username, mode).messages.find(entry => entry.meta?.idempotencyKey === key) ?? message : message;
}

/** Called only after the canonical execution has been retired. */
export async function retireBufferAdmissions(username: string, executionId: string): Promise<void> {
  for (const mode of ['conversation', 'inner', 'robot', 'system'] as const) {
    await withBufferLock(username, mode, 'retire_execution', async () => {
      const file = getBufferPathForUser(username, mode);
      if (!fs.existsSync(file)) return;
      const buffer = JSON.parse(fs.readFileSync(file, 'utf8')) as ConversationBuffer;
      const admissions = normalizeExecutionAdmissions(buffer.executionAdmissions) ?? {};
      if (!Object.values(admissions).some(receipt => receipt.executionIds.includes(executionId))) return;
      buffer.executionAdmissions = Object.fromEntries(Object.entries(admissions).flatMap(([key, receipt]) => {
        const executionIds = receipt.executionIds.filter(id => id !== executionId);
        return executionIds.length ? [[key, { ...receipt, executionIds }]] : [];
      }));
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(buffer, null, 2));
      fs.renameSync(temporary, file);
    });
  }
}

function resolveUserMessageCount(value: unknown, messages: ConversationMessage[]): number {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : messages.filter(message => message.role === 'user').length;
}

// ============================================================================
// Agent-friendly functions (don't require AsyncLocalStorage context)
// ============================================================================

import { getProfilePaths } from './paths.js';
import { getUser, getUserByUsername } from './users.js';

function getConversationBufferLimit(username: string, mode: CanonicalBufferMode): number {
  const settings = loadChatSettingsForUser(username);
  const limits: Record<CanonicalBufferMode, { value: number; fallback: number; minimum: number }> = {
    conversation: { value: settings.conversationBufferLimit, fallback: 30, minimum: 5 },
    inner: { value: settings.innerBufferLimit, fallback: 80, minimum: 20 },
    system: { value: settings.systemBufferLimit, fallback: 100, minimum: 20 },
    robot: { value: settings.robotBufferLimit, fallback: 100, minimum: 20 },
  };
  const limit = limits[mode];
  const configured = Number(limit.value);
  if (!Number.isFinite(configured)) return limit.fallback;
  return Math.max(limit.minimum, Math.min(500, Math.floor(configured)));
}

/**
 * Get buffer path for a specific user (by username)
 * Used by agents that run outside web request context
 */
export function getBufferPathForUser(username: string, mode: CanonicalBufferMode): string {
  const profilePaths = getProfilePaths(username);
  const bufferDir = profilePaths.state;
  try {
    fs.mkdirSync(bufferDir, { recursive: true });
  } catch {
    // Ignore mkdir race conditions
  }
  return path.join(bufferDir, `conversation-buffer-${mode}.json`);
}

/** Read one canonical per-profile buffer without requiring request context. */
export function loadBufferForUser(username: string, mode: CanonicalBufferMode): ConversationBuffer {
  const bufferPath = getBufferPathForUser(username, mode);
  if (!fs.existsSync(bufferPath)) return createEmptyBuffer();

  try {
    const raw = fs.readFileSync(bufferPath, 'utf8');
    if (!raw.trim()) {
      recoverCorruptedBufferForUser(bufferPath, username, mode, new Error('Empty file'));
      return createEmptyBuffer();
    }
    const parsed = JSON.parse(raw) as Partial<ConversationBuffer>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {
      messages,
      lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date().toISOString(),
      userMessageCount: resolveUserMessageCount(parsed.userMessageCount, messages),
      executionAdmissions: normalizeExecutionAdmissions(parsed.executionAdmissions),
    };
  } catch (error) {
    recoverCorruptedBufferForUser(bufferPath, username, mode, error as Error);
    return createEmptyBuffer();
  }
}

/** Clear one canonical buffer through the storage owner and notify subscribers. */
export async function clearBufferForUser(username: string, mode: CanonicalBufferMode): Promise<boolean> {
  const result = await withBufferLock(username, mode, 'clear_buffer', async () => {
    const bufferPath = getBufferPathForUser(username, mode);
    const emptyBuffer = createEmptyBuffer();
    const current = loadBufferForUser(username, mode);
    emptyBuffer.executionAdmissions = current.executionAdmissions;
    if (mode === 'conversation') {
      emptyBuffer.userMessageCount = resolveUserMessageCount(current.userMessageCount, current.messages);
    }
    fs.writeFileSync(bufferPath, JSON.stringify(emptyBuffer, null, 2));
    touchBufferNotification(username, mode);
    return true;
  });
  return result === true;
}

/**
 * Attempt to recover a corrupted buffer file for agent context (no user context required)
 * @returns true if recovery was performed, false if no recovery needed
 */
function recoverCorruptedBufferForUser(bufferPath: string, username: string, mode: CanonicalBufferMode, error: Error): boolean {
  try {
    // Create backup of corrupted file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${bufferPath}.corrupted-${timestamp}`;

    // Only backup if file exists and has content
    if (fs.existsSync(bufferPath)) {
      const stats = fs.statSync(bufferPath);
      if (stats.size > 0) {
        fs.copyFileSync(bufferPath, backupPath);
        console.warn(`[conversation-buffer] ⚠️ Backed up corrupted ${mode} buffer for ${username} to: ${backupPath}`);
      } else {
        console.warn(`[conversation-buffer] ⚠️ ${mode} buffer for ${username} was empty (0 bytes) - likely disk write failure`);
      }
    }

    // Write valid empty buffer
    const emptyBuffer = createEmptyBuffer();
    fs.writeFileSync(bufferPath, JSON.stringify(emptyBuffer, null, 2));
    console.warn(`[conversation-buffer] ✅ Auto-recovered ${mode} buffer for ${username} - reset to empty state`);
    console.warn(`[conversation-buffer] Original error was: ${error.message}`);

    // Touch notification
    touchBufferNotification(username, mode);

    return true;
  } catch (recoveryError) {
    console.error(`[conversation-buffer] ❌ Failed to recover corrupted ${mode} buffer for ${username}:`, recoveryError);
    return false;
  }
}

/**
 * Append a message to a user's conversation buffer with locking
 * Can be called from agents without web request context
 *
 * @param userIdOrUsername - User UUID or username (both supported for agent compatibility)
 * @param mode - Canonical buffer mode
 * @param message - Message to append
 * @param windowId - Optional window ID that is performing the append
 * @returns Promise<true> if successful
 */
export async function writeBufferEntry(
  userIdOrUsername: string,
  mode: CanonicalBufferMode,
  message: { role: string; content: string; meta?: Record<string, unknown>; timestamp?: number },
  windowId?: string
): Promise<boolean> {
  // Resolve user - try UUID first, then username (agents often pass username)
  let user = getUser(userIdOrUsername);
  if (!user) {
    user = getUserByUsername(userIdOrUsername);
  }

  // Determine the username to use for buffer path
  // Fall back to the input if no user found (allows agents to write even if user not in users.json)
  const usernameForBuffer = user?.username || userIdOrUsername;
  if (!usernameForBuffer || usernameForBuffer === 'anonymous') {
    console.warn(`[conversation-buffer] Cannot append: no valid username (got: ${userIdOrUsername})`);
    return false;
  }

  let appendedUserMessageCount: number | undefined;
  const result = await withBufferLock(usernameForBuffer, mode, 'append_message', async () => {
    const bufferPath = getBufferPathForUser(usernameForBuffer, mode);

    try {
      // Load existing buffer with auto-recovery for corruption
      let buffer: ConversationBuffer;
      if (fs.existsSync(bufferPath)) {
        const raw = fs.readFileSync(bufferPath, 'utf-8');

        // Check for empty file (common disk write failure symptom)
        if (!raw || raw.trim().length === 0) {
          console.warn(`[conversation-buffer] ⚠️ ${mode} buffer for ${usernameForBuffer} is empty - auto-recovering`);
          recoverCorruptedBufferForUser(bufferPath, usernameForBuffer, mode, new Error('Empty file'));
          buffer = createEmptyBuffer();
        } else {
          try {
            buffer = JSON.parse(raw);
            if (!Array.isArray(buffer.messages)) {
              buffer.messages = [];
            }
          } catch (parseError) {
            // JSON parse error - corrupted file, auto-recover
            console.warn(`[conversation-buffer] ⚠️ ${mode} buffer for ${usernameForBuffer} is corrupted - auto-recovering`);
            recoverCorruptedBufferForUser(bufferPath, usernameForBuffer, mode, parseError as Error);
            buffer = createEmptyBuffer();
          }
        }
      } else {
        buffer = createEmptyBuffer();
      }

      const idempotencyKey = typeof message.meta?.idempotencyKey === 'string'
        ? message.meta.idempotencyKey.trim()
        : '';
      const executionId = typeof message.meta?.executionId === 'string' ? message.meta.executionId : '';
      buffer.executionAdmissions = normalizeExecutionAdmissions(buffer.executionAdmissions);
      const receipt = idempotencyKey ? buffer.executionAdmissions?.[idempotencyKey] : undefined;
      const contentHash = createHash('sha256').update(JSON.stringify([message.role, message.content])).digest('hex');
      const existing = idempotencyKey ? buffer.messages.find(entry => entry.meta?.idempotencyKey === idempotencyKey) : undefined;
      if (receipt || existing) {
        const committedHash = receipt ? receipt.contentHash
          : createHash('sha256').update(JSON.stringify([existing!.role, existing!.content])).digest('hex');
        if (committedHash !== contentHash) throw new Error('Buffer admission ID conflicts with its committed entry');
        if (executionId && (!receipt || !receipt.executionIds.includes(executionId))) {
          buffer.executionAdmissions = { ...buffer.executionAdmissions,
            [idempotencyKey]: { contentHash, executionIds: [...(receipt ? receipt.executionIds : []), executionId] } };
          const temporary = `${bufferPath}.${process.pid}.tmp`;
          fs.writeFileSync(temporary, JSON.stringify(buffer, null, 2));
          fs.renameSync(temporary, bufferPath);
        }
        console.log(`[conversation-buffer] Skipped duplicate ${mode} entry for ${usernameForBuffer}: ${idempotencyKey}`);
        return true;
      }

      // Add message with timestamp
      const newMessage: ConversationMessage = {
        role: message.role as ConversationMessage['role'],
        content: message.content,
        meta: message.meta,
        timestamp: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
          ? message.timestamp
          : Date.now(),
      };

      buffer.messages.push(newMessage);
      if (idempotencyKey && executionId) {
        buffer.executionAdmissions = { ...buffer.executionAdmissions,
          [idempotencyKey]: { executionIds: [executionId], contentHash } };
      }
      const existingUserCount = resolveUserMessageCount(buffer.userMessageCount, buffer.messages.slice(0, -1));
      if (mode === 'conversation' && message.role === 'user') {
        buffer.userMessageCount = existingUserCount + 1;
        appendedUserMessageCount = buffer.userMessageCount;
      } else if (buffer.userMessageCount === undefined) {
        buffer.userMessageCount = existingUserCount;
      }

      // Keep pruning policy in the canonical buffer owner so graph nodes and
      // API handlers cannot drift into competing limits or settings paths.
      const maxMessages = getConversationBufferLimit(usernameForBuffer, mode);
      if (buffer.messages.length > maxMessages) {
        buffer.messages = buffer.messages.slice(-maxMessages);
      }

      // Save
      buffer.lastUpdated = new Date().toISOString();
      const temporary = `${bufferPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(buffer, null, 2));
      fs.renameSync(temporary, bufferPath);

      // Touch notification file on local disk to trigger SSE updates
      touchBufferNotification(usernameForBuffer, mode);

      console.log(`[conversation-buffer] ✅ Appended ${message.role} to ${mode} buffer for ${usernameForBuffer}`);
      return true;
    } catch (error) {
      console.error(`[conversation-buffer] Failed to append to ${mode} buffer:`, error);
      throw error;
    }
  }, windowId);

  if (result !== null && appendedUserMessageCount !== undefined) {
    eventBus.emit('core', 'conversation.user-message.appended', {
      username: usernameForBuffer,
      mode,
      userMessageCount: appendedUserMessageCount,
    }, { userId: usernameForBuffer });
  }
  return result !== null;
}
