/**
 * Buffer Handler - Simple GET endpoint for conversation buffer
 *
 * Returns the current buffer contents directly (no SSE).
 * Use this for initial page load and tab switching.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProfilePaths } from '../../index.js';

export async function handleGetSimpleBuffer(req: UnifiedRequest): Promise<UnifiedResponse> {
  const mode = req.query?.mode;

  if (mode !== 'conversation' && mode !== 'inner') {
    return badRequestResponse('mode query param required (conversation|inner)');
  }

  const user = req.user;
  const isGuestWithProfile = user.role === 'guest';

  // Pure anonymous (no selected profile) get empty buffer
  if (user.role === 'anonymous') {
    return successResponse({ messages: [], mode, lastUpdated: null });
  }

  // Determine buffer path based on user type
  let bufferPath: string;
  if (isGuestWithProfile) {
    // Guest users get session-specific temp directory
    const sessionId = user.userId?.substring(0, 16) || 'default';
    const guestTempDir = path.join(os.tmpdir(), 'metahuman-guest', sessionId);
    bufferPath = path.join(guestTempDir, `conversation-buffer-${mode}.json`);
  } else {
    // Authenticated users use their profile storage
    const profilePaths = getProfilePaths(user.username);
    bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);
  }

  try {
    if (!fs.existsSync(bufferPath)) {
      return successResponse({ messages: [], mode, lastUpdated: null });
    }

    const raw = fs.readFileSync(bufferPath, 'utf-8');
    const buffer = JSON.parse(raw);
    const messages = (buffer.messages || [])
      .filter((msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker)
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
