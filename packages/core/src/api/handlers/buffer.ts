/**
 * Buffer Handler - Simple GET endpoint for conversation buffer
 *
 * Returns the current buffer contents directly (no SSE).
 * Use this for initial page load and tab switching.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import { loadBufferForUser } from '../../conversation-buffer.js';

export async function handleGetSimpleBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = req.query?.mode;

  if (mode !== 'conversation' && mode !== 'inner' && mode !== 'system' && mode !== 'robot') {
    return badRequestResponse('mode query param required (conversation|inner|system|robot)');
  }

  try {
    const buffer = loadBufferForUser(req.user.username, mode);
    const messages = (buffer.messages || [])
      .filter((msg: any) => !msg.meta?.summaryMarker)
      .map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
        meta: msg.meta,
      }));

    return successResponse({ messages, mode, lastUpdated: buffer.lastUpdated });
  } catch (error) {
    console.error(`[buffer] Error reading ${mode} buffer:`, error);
    return errorResponse('Failed to read buffer', 500);
  }
}
