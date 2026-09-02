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
} from '../../conversation-buffer.js';

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
