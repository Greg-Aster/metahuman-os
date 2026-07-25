/**
 * Chat History Handler - Get chat history from buffer
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import { loadBufferForUser } from '../../conversation-buffer.js';

export async function handleGetChatHistory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const user = req.user;
    const mode = req.query?.mode === 'inner'
      ? 'inner'
      : req.query?.mode === 'system'
        ? 'system'
        : req.query?.mode === 'robot'
          ? 'robot'
          : 'conversation';
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 80)));

    // BUFFER-ONLY: Load ONLY from buffer file, no slow episodic/audit scanning
    try {
      const buffer = loadBufferForUser(user.username, mode);

      // Filter out system messages and summary markers to get actual conversation
      // Preserve all role types including reflection, dream, reasoning for inner dialogue
      const bufferMessages = buffer.messages
        .filter((msg: any) => !msg.meta?.summaryMarker)
        .map((msg: any) => ({
          role: msg.role as 'user' | 'assistant' | 'reflection' | 'dream' | 'reasoning' | 'system' | 'robot',
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
          meta: msg.meta
        }));

      console.log(`[chat/history] ✅ Loaded ${bufferMessages.length} messages from buffer (${mode})`);

      return {
        status: 200,
        data: { messages: bufferMessages.slice(-limit) },
        headers: { 'X-Source': 'buffer' },
      };
    } catch (error) {
      console.error('[chat/history] Buffer load failed:', error);
      return {
        status: 200,
        data: { messages: [] },
        headers: { 'X-Source': 'buffer-error' },
      };
    }
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}
