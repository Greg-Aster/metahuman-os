/**
 * Conversation Buffer Handlers
 *
 * Unified handlers for conversation buffer management.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse } from '../types.js';
import {
  clearBufferForUser,
  loadBufferForUser,
  type CanonicalBufferMode,
  type ConversationMessage,
} from '../../conversation-buffer.js';
import { submitBufferEntry } from '../../buffer-admission.js';

function isBufferMode(value: unknown): value is CanonicalBufferMode {
  return value === 'conversation' || value === 'inner' || value === 'system' || value === 'robot';
}

/**
 * GET /api/conversation-buffer - Get conversation buffer
 */
export async function handleGetBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = req.query?.mode || 'conversation';
  if (!isBufferMode(mode)) return badRequestResponse('Invalid buffer mode');

  // For unauthenticated users, return empty buffer
  if (!req.user.isAuthenticated) {
    return successResponse({
      success: true,
      messages: [],
      mode,
    });
  }

  const buffer = loadBufferForUser(req.user.username, mode);

  return successResponse({
    success: true,
    messages: buffer.messages.filter(message => !message.meta?.summaryMarker),
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

  if (!isBufferMode(mode)) return badRequestResponse('Invalid buffer mode');
  if (mode === 'robot') {
    return badRequestResponse('Robot Buffer accepts records only from the Environment Bridge graph');
  }
  const bufferMode = mode;
  const msg: ConversationMessage = {
    role: message.role || 'user',
    content: message.content,
    meta: message.meta,
    timestamp: Date.now(),
  };

  const success = await submitBufferEntry(req.user.username, bufferMode, msg);

  return successResponse({
    success,
    mode: bufferMode,
  });
}

/**
 * DELETE /api/conversation-buffer - Clear conversation buffer
 */
export async function handleClearBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = req.query?.mode || 'conversation';
  if (!isBufferMode(mode)) return badRequestResponse('Invalid buffer mode');
  const result = await clearBufferForUser(req.user.username, mode);

  return successResponse({
    success: true,
    mode,
    cleared: result,
  });
}
