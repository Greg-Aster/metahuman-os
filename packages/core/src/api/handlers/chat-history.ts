/**
 * Chat History Handler - Get chat history from buffer
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProfilePaths } from '../../index.js';

export async function handleGetChatHistory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const user = req.user;
    const mode = (req.query?.mode === 'inner') ? 'inner' : 'conversation';
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 80)));

    const isGuestWithProfile = user.role === 'guest';

    // Pure anonymous (no selected profile) get empty
    if (user.role === 'anonymous') {
      return successResponse({ messages: [] });
    }

    // Determine buffer path based on user type
    let bufferPath: string;
    if (isGuestWithProfile) {
      // Guest users get session-specific temp directory
      // Use userId as session identifier for guests
      const sessionId = user.userId?.substring(0, 16) || 'default';
      const guestTempDir = path.join(os.tmpdir(), 'metahuman-guest', sessionId);
      bufferPath = path.join(guestTempDir, `conversation-buffer-${mode}.json`);
    } else {
      // Authenticated users use their profile storage
      const profilePaths = getProfilePaths(user.username);
      bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);
    }

    // BUFFER-ONLY: Load ONLY from buffer file, no slow episodic/audit scanning
    try {
      if (!fs.existsSync(bufferPath)) {
        console.log(`[chat/history] No buffer file found, returning empty`);
        return {
          status: 200,
          data: { messages: [] },
          headers: { 'X-Source': 'buffer-empty' },
        };
      }

      const bufferRaw = fs.readFileSync(bufferPath, 'utf-8');
      const buffer = JSON.parse(bufferRaw);

      if (!buffer || !buffer.messages || !Array.isArray(buffer.messages)) {
        console.log(`[chat/history] Invalid buffer structure, returning empty`);
        return {
          status: 200,
          data: { messages: [] },
          headers: { 'X-Source': 'buffer-invalid' },
        };
      }

      // Filter out system messages and summary markers to get actual conversation
      // Preserve all role types including reflection, dream, reasoning for inner dialogue
      const bufferMessages = buffer.messages
        .filter((msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker)
        .map((msg: any) => ({
          role: msg.role as 'user' | 'assistant' | 'reflection' | 'dream' | 'reasoning',
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
