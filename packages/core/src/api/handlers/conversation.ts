/**
 * Conversation Buffer Handlers
 *
 * Unified handlers for conversation buffer management.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import {
  loadPersistedBuffer,
  appendToUserBuffer,
  getBufferPathForUser,
  type ConversationBufferMode,
  type ConversationMessage,
} from '../../conversation-buffer.js';
import fs from 'node:fs';

/**
 * GET /api/conversation-buffer - Get conversation buffer
 */
export async function handleGetBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = (req.query?.mode || 'conversation') as ConversationBufferMode;

  // For unauthenticated users, return empty buffer
  if (!req.user.isAuthenticated) {
    return successResponse({
      success: true,
      messages: [],
      mode,
    });
  }

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      try {
        const buffer = loadPersistedBuffer(mode);
        return { success: true, buffer };
      } catch {
        return { success: false, buffer: null };
      }
    }
  );

  return successResponse({
    success: true,
    messages: result.buffer?.messages || [],
    mode,
  });
}

/**
 * POST /api/conversation-buffer - Append to conversation buffer
 */
export async function handleAppendBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { message, mode = 'conversation' } = req.body || {};

  if (!message) {
    return badRequestResponse('Message is required');
  }

  const bufferMode = mode as ConversationBufferMode;
  const msg: ConversationMessage = {
    role: message.role || 'user',
    content: message.content,
    meta: message.meta,
    timestamp: Date.now(),
  };

  const success = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => appendToUserBuffer(req.user.username, bufferMode, msg)
  );

  return successResponse({
    success,
    mode: bufferMode,
  });
}

/**
 * DELETE /api/conversation-buffer - Clear conversation buffer
 */
export async function handleClearBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = (req.query?.mode || 'conversation') as ConversationBufferMode;

  // Clear by writing empty buffer to the buffer path
  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      try {
        const bufferPath = getBufferPathForUser(req.user.username, mode);
        if (bufferPath && fs.existsSync(bufferPath)) {
          const emptyBuffer = {
            summaryMarkers: [],
            messages: [],
            lastSummarizedIndex: null,
            lastUpdated: new Date().toISOString(),
          };
          fs.writeFileSync(bufferPath, JSON.stringify(emptyBuffer, null, 2));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
  );

  return successResponse({
    success: true,
    mode,
    cleared: result,
  });
}
