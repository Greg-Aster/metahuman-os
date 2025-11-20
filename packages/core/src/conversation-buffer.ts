import fs from 'node:fs';
import path from 'node:path';
import { getUserContext } from './context.js';

export type ConversationBufferMode = 'inner' | 'conversation';

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  meta?: any;
  timestamp?: number;
};

export type ConversationBuffer = {
  summaryMarkers: ConversationMessage[];
  messages: ConversationMessage[];
  lastSummarizedIndex: number | null;
  lastUpdated: string;
};

/**
 * Resolve the on-disk buffer path for a mode within the current user context.
 * Ensures the state directory exists before returning the path.
 */
export function getConversationBufferPath(mode: ConversationBufferMode): string | null {
  const ctx = getUserContext();
  if (!ctx?.profilePaths?.state) return null;

  const bufferDir = ctx.profilePaths.state;
  try {
    fs.mkdirSync(bufferDir, { recursive: true });
  } catch {
    // Ignore mkdir race conditions - subsequent write will fail if unrecoverable
  }

  return path.join(bufferDir, `conversation-buffer-${mode}.json`);
}

/**
 * Calculate metadata richness score for deduplication priority
 */
function metadataScore(message: ConversationMessage): number {
  const metaKeys = message.meta && typeof message.meta === 'object'
    ? Object.keys(message.meta).length
    : 0;
  const hasTimestamp = typeof message.timestamp === 'number' ? 1 : 0;
  return metaKeys * 2 + hasTimestamp;
}

/**
 * Remove duplicate consecutive messages, preserving the one with richer metadata
 */
export function dedupeConversationMessages(
  messages: ConversationMessage[]
): { deduped: ConversationMessage[]; removed: number } {
  const deduped: ConversationMessage[] = [];
  let removed = 0;

  for (const msg of messages) {
    const last = deduped[deduped.length - 1];
    if (
      last &&
      last.role === msg.role &&
      last.content === msg.content
    ) {
      removed++;
      // Keep the message with better metadata
      if (metadataScore(msg) > metadataScore(last)) {
        deduped[deduped.length - 1] = msg;
      }
      continue;
    }

    deduped.push(msg);
  }

  return { deduped, removed };
}

/**
 * Load persisted conversation buffer from disk
 * Handles deduplication and summary marker preservation
 */
export function loadPersistedBuffer(mode: ConversationBufferMode): {
  messages: ConversationMessage[];
  summaryMarkers: ConversationMessage[];
  lastSummarizedIndex: number | null;
} {
  const bufferPath = getConversationBufferPath(mode);
  if (!bufferPath || !fs.existsSync(bufferPath)) {
    return { messages: [], summaryMarkers: [], lastSummarizedIndex: null };
  }

  try {
    const raw = fs.readFileSync(bufferPath, 'utf-8');
    const parsed: Partial<ConversationBuffer> = JSON.parse(raw);

    const persistedMessages: ConversationMessage[] = Array.isArray(parsed.messages)
      ? parsed.messages
      : [];
    const persistedSummaryMarkers: ConversationMessage[] = Array.isArray(parsed.summaryMarkers)
      ? parsed.summaryMarkers
      : persistedMessages.filter(msg => msg.meta?.summaryMarker);

    // Remove any summary markers from the main messages array to avoid duplication
    const conversationMessages = persistedMessages.filter(msg => !msg.meta?.summaryMarker);
    const { deduped, removed } = dedupeConversationMessages(conversationMessages);

    if (removed > 0) {
      console.log(`[conversation-buffer] Removed ${removed} duplicate ${mode} messages from persisted buffer`);
    }

    // Combine deduped messages with summary markers
    const combined = [...deduped];
    if (persistedSummaryMarkers.length > 0) {
      // Insert summary markers after system prompt if it exists
      if (
        combined.length > 0 &&
        combined[0].role === 'system' &&
        !combined[0].meta?.summaryMarker
      ) {
        combined.splice(1, 0, ...persistedSummaryMarkers);
      } else {
        combined.unshift(...persistedSummaryMarkers);
      }
    }

    const derivedLastSummarized =
      typeof parsed.lastSummarizedIndex === 'number'
        ? parsed.lastSummarizedIndex
        : (persistedSummaryMarkers.length > 0
            ? persistedSummaryMarkers.reduce((max, marker) => {
                const count = marker.meta?.summaryCount;
                return typeof count === 'number' && count > max ? count : max;
              }, 0)
            : null);

    // Re-persist if we removed duplicates
    if (removed > 0) {
      try {
        const payload: ConversationBuffer = {
          summaryMarkers: persistedSummaryMarkers,
          messages: deduped,
          lastSummarizedIndex: derivedLastSummarized ?? null,
          lastUpdated: new Date().toISOString(),
        };
        fs.writeFileSync(bufferPath, JSON.stringify(payload, null, 2));
      } catch (error) {
        console.warn('[conversation-buffer] Failed to persist deduplicated buffer:', error);
      }
    }

    return {
      messages: combined,
      summaryMarkers: persistedSummaryMarkers,
      lastSummarizedIndex: derivedLastSummarized ?? null,
    };
  } catch (error) {
    console.warn('[conversation-buffer] Failed to load conversation buffer:', error);
    return { messages: [], summaryMarkers: [], lastSummarizedIndex: null };
  }
}

/**
 * Persist conversation buffer to disk
 */
export function persistBuffer(
  mode: ConversationBufferMode,
  messages: ConversationMessage[]
): void {
  const bufferPath = getConversationBufferPath(mode);
  if (!bufferPath) return;

  try {
    const summaryMarkers = messages.filter(msg => msg.meta?.summaryMarker);
    const conversationMessages = messages.filter(msg => !msg.meta?.summaryMarker);

    // Derive lastSummarizedIndex from markers
    const lastSummarizedIndex = summaryMarkers.length > 0
      ? summaryMarkers.reduce((max, marker) => {
          const count = marker.meta?.summaryCount;
          return typeof count === 'number' && count > max ? count : max;
        }, 0)
      : null;

    const payload: ConversationBuffer = {
      summaryMarkers,
      messages: conversationMessages,
      lastSummarizedIndex,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(bufferPath, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('[conversation-buffer] Failed to persist buffer:', error);
  }
}
