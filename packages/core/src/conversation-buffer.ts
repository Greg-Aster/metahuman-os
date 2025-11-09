import fs from 'node:fs';
import path from 'node:path';
import { getUserContext } from './context.js';

export type ConversationBufferMode = 'inner' | 'conversation';

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
