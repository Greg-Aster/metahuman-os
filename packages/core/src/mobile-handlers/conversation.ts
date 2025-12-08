/**
 * Mobile Conversation Buffer Handlers
 *
 * Conversation history management for mobile
 */

import {
  loadPersistedBuffer,
  persistBuffer,
  getBufferPathForUser,
  type ConversationBufferMode,
  type ConversationMessage,
} from '../conversation-buffer.js';
import { getProfilePaths } from '../paths.js';
import fs from 'node:fs';
import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';

/**
 * GET /api/conversation-buffer - Get conversation history
 */
export async function handleGetBuffer(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  // Parse mode from path
  const url = new URL(request.path, 'http://localhost');
  const mode = (url.searchParams.get('mode') || 'conversation') as ConversationBufferMode;

  if (!user.isAuthenticated) {
    // Return empty buffer for anonymous users
    return successResponse(request.id, {
      messages: [],
      summaryMarkers: [],
      mode,
    });
  }

  try {
    const bufferPath = getBufferPathForUser(user.username, mode);

    if (!fs.existsSync(bufferPath)) {
      return successResponse(request.id, {
        messages: [],
        summaryMarkers: [],
        mode,
      });
    }

    const raw = fs.readFileSync(bufferPath, 'utf-8');
    const buffer = JSON.parse(raw);

    return successResponse(request.id, {
      messages: buffer.messages || [],
      summaryMarkers: buffer.summaryMarkers || [],
      lastUpdated: buffer.lastUpdated,
      mode,
    });
  } catch (error) {
    console.error('[mobile-handlers] Get buffer failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * POST /api/conversation-buffer - Append message to buffer
 */
export async function handleAppendBuffer(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const { mode = 'conversation', message } = request.body || {};

  if (!message || !message.role || !message.content) {
    return errorResponse(request.id, 400, 'Message with role and content is required');
  }

  try {
    const bufferPath = getBufferPathForUser(user.username, mode as ConversationBufferMode);

    // Load existing buffer
    let buffer = {
      summaryMarkers: [] as ConversationMessage[],
      messages: [] as ConversationMessage[],
      lastSummarizedIndex: null as number | null,
      lastUpdated: new Date().toISOString(),
    };

    if (fs.existsSync(bufferPath)) {
      const raw = fs.readFileSync(bufferPath, 'utf-8');
      buffer = JSON.parse(raw);
      if (!Array.isArray(buffer.messages)) {
        buffer.messages = [];
      }
    }

    // Add message with timestamp
    const newMessage: ConversationMessage = {
      role: message.role,
      content: message.content,
      meta: message.meta,
      timestamp: Date.now(),
    };

    buffer.messages.push(newMessage);

    // Auto-prune to last 50 messages
    const MAX_MESSAGES = 50;
    if (buffer.messages.length > MAX_MESSAGES) {
      buffer.messages = buffer.messages.slice(-MAX_MESSAGES);
    }

    // Save
    buffer.lastUpdated = new Date().toISOString();
    fs.writeFileSync(bufferPath, JSON.stringify(buffer, null, 2));

    return successResponse(request.id, {
      success: true,
      messageCount: buffer.messages.length,
    });
  } catch (error) {
    console.error('[mobile-handlers] Append buffer failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * DELETE /api/conversation-buffer - Clear conversation buffer
 */
export async function handleClearBuffer(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const url = new URL(request.path, 'http://localhost');
  const mode = (url.searchParams.get('mode') || 'conversation') as ConversationBufferMode;

  try {
    const bufferPath = getBufferPathForUser(user.username, mode);

    if (fs.existsSync(bufferPath)) {
      fs.unlinkSync(bufferPath);
    }

    return successResponse(request.id, {
      success: true,
      message: `${mode} buffer cleared`,
    });
  } catch (error) {
    console.error('[mobile-handlers] Clear buffer failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}
