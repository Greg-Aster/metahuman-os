import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProfilePaths, getUserOrAnonymous, audit } from '@metahuman/core';
import type { AstroCookies } from 'astro';

/**
 * Conversation Buffer API
 *
 * Manages server-side chat history with rolling window and mode isolation.
 *
 * GET    /api/conversation-buffer?mode={conversation|inner} - Fetch messages
 * POST   /api/conversation-buffer                           - Append message
 * DELETE /api/conversation-buffer?mode={conversation|inner} - Clear buffer
 */

type Mode = 'conversation' | 'inner';
type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'dream' | 'reasoning';

interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  meta?: Record<string, any>;
}

interface ConversationBuffer {
  mode: Mode;
  messages: Message[];
  lastUpdated: string;
  messageLimit: number;
}

const DEFAULT_MESSAGE_LIMIT = 50;

interface GuestContext {
  isGuest: true;
  sessionId: string;
}

interface AuthenticatedContext {
  isGuest: false;
  username: string;
}

type UserContext = GuestContext | AuthenticatedContext;

function getGuestTempDir(sessionId: string): string {
  return path.join(os.tmpdir(), 'metahuman-guest', sessionId);
}

function getBufferPathForContext(ctx: UserContext, mode: Mode): string {
  if (ctx.isGuest) {
    const guestTempDir = getGuestTempDir(ctx.sessionId);
    return path.join(guestTempDir, `conversation-buffer-${mode}.json`);
  } else {
    const profilePaths = getProfilePaths(ctx.username);
    return path.join(profilePaths.state, `conversation-buffer-${mode}.json`);
  }
}

function getUserContext(cookies: AstroCookies): UserContext | null {
  const user = getUserOrAnonymous(cookies);
  const isGuestWithProfile = user.role === 'anonymous' && user.id === 'guest';

  if (user.role === 'anonymous' && !isGuestWithProfile) {
    // Pure anonymous - no access
    return null;
  }

  if (isGuestWithProfile) {
    const sessionCookie = cookies.get('mh_session');
    const sessionId = sessionCookie?.value?.substring(0, 16) || 'default';
    return { isGuest: true, sessionId };
  }

  return { isGuest: false, username: user.username };
}

function getUserLabel(ctx: UserContext): string {
  if (ctx.isGuest) {
    return `guest:${ctx.sessionId}`;
  } else {
    return ctx.username;
  }
}

// Context-aware buffer operations
function loadBufferForContext(ctx: UserContext, mode: Mode): ConversationBuffer | null {
  const bufferPath = getBufferPathForContext(ctx, mode);
  if (!existsSync(bufferPath)) {
    return null;
  }

  try {
    const raw = readFileSync(bufferPath, 'utf-8');
    const data = JSON.parse(raw);

    // Validate structure
    if (!Array.isArray(data.messages)) {
      console.warn(`[conversation-buffer] Invalid buffer structure for ${mode}, resetting`);
      return null;
    }

    return {
      mode,
      messages: data.messages || [],
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      messageLimit: data.messageLimit || DEFAULT_MESSAGE_LIMIT,
    };
  } catch (error) {
    console.error(`[conversation-buffer] Failed to load ${mode} buffer:`, error);
    return null;
  }
}

function saveBufferForContext(ctx: UserContext, buffer: ConversationBuffer): boolean {
  const bufferPath = getBufferPathForContext(ctx, buffer.mode);

  try {
    // Ensure directory exists
    const dir = path.dirname(bufferPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = {
      mode: buffer.mode,
      messages: buffer.messages,
      lastUpdated: new Date().toISOString(),
      messageLimit: buffer.messageLimit,
    };

    writeFileSync(bufferPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`[conversation-buffer] Failed to save ${buffer.mode} buffer:`, error);
    return false;
  }
}

function deleteBufferForContext(ctx: UserContext, mode: Mode): boolean {
  const bufferPath = getBufferPathForContext(ctx, mode);

  try {
    if (existsSync(bufferPath)) {
      unlinkSync(bufferPath);
    }
    return true;
  } catch (error) {
    console.error(`[conversation-buffer] Failed to delete ${mode} buffer:`, error);
    return false;
  }
}

function pruneBuffer(buffer: ConversationBuffer): void {
  if (buffer.messages.length <= buffer.messageLimit) return;

  // Keep only the most recent messages
  const excess = buffer.messages.length - buffer.messageLimit;
  buffer.messages = buffer.messages.slice(excess);

  audit({
    level: 'info',
    category: 'system',
    event: 'conversation_buffer_pruned',
    details: { mode: buffer.mode, removedCount: excess, remaining: buffer.messages.length },
    actor: 'system',
  });
}

// GET: Fetch conversation buffer
const getHandler: APIRoute = async ({ cookies, request }) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'conversation') as Mode;

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(
      JSON.stringify({ error: 'Invalid mode. Must be "conversation" or "inner"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ctx = getUserContext(cookies);

  // Pure anonymous users (no guest profile) get empty buffer
  if (!ctx) {
    return new Response(
      JSON.stringify({
        mode,
        messages: [],
        lastUpdated: new Date().toISOString(),
        messageLimit: DEFAULT_MESSAGE_LIMIT,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const buffer = loadBufferForContext(ctx, mode);

  if (!buffer) {
    // Return empty buffer structure
    return new Response(
      JSON.stringify({
        mode,
        messages: [],
        lastUpdated: new Date().toISOString(),
        messageLimit: DEFAULT_MESSAGE_LIMIT,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify(buffer), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST: Append message to buffer
const postHandler: APIRoute = async ({ cookies, request }) => {
  const ctx = getUserContext(cookies);

  // Pure anonymous users can't write to buffer
  if (!ctx) {
    console.warn('[conversation-buffer] Anonymous user cannot write to buffer');
    return new Response(
      JSON.stringify({ error: 'Authentication required to save messages' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await request.json();
  const { mode, message } = body;

  if (!mode || (mode !== 'conversation' && mode !== 'inner')) {
    return new Response(
      JSON.stringify({ error: 'Invalid or missing mode' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!message || !message.role || !message.content) {
    return new Response(
      JSON.stringify({ error: 'Invalid message structure. Required: role, content' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Load or create buffer
  let buffer = loadBufferForContext(ctx, mode);
  if (!buffer) {
    buffer = {
      mode,
      messages: [],
      lastUpdated: new Date().toISOString(),
      messageLimit: DEFAULT_MESSAGE_LIMIT,
    };
  }

  // Add timestamp if not present
  const newMessage: Message = {
    ...message,
    timestamp: message.timestamp || Date.now(),
  };

  buffer.messages.push(newMessage);

  // Auto-prune if over limit
  pruneBuffer(buffer);

  // Save buffer
  const saved = saveBufferForContext(ctx, buffer);

  if (!saved) {
    return new Response(
      JSON.stringify({ error: 'Failed to save buffer' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userLabel = getUserLabel(ctx);
  console.log(`[conversation-buffer] ✅ Saved ${message.role} message to ${mode} buffer for ${userLabel} (${buffer.messages.length} total)`);

  return new Response(
    JSON.stringify({ success: true, messageCount: buffer.messages.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// DELETE: Clear conversation buffer
const deleteHandler: APIRoute = async ({ cookies, request }) => {
  const ctx = getUserContext(cookies);

  // Pure anonymous users can't delete buffer
  if (!ctx) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'conversation') as Mode;

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(
      JSON.stringify({ error: 'Invalid mode. Must be "conversation" or "inner"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const deleted = deleteBufferForContext(ctx, mode);

  const userLabel = getUserLabel(ctx);
  audit({
    level: 'info',
    category: 'action',
    event: 'conversation_buffer_cleared',
    details: { mode, isGuest: ctx.isGuest },
    actor: userLabel,
  });

  return new Response(
    JSON.stringify({ success: deleted, mode }),
    { status: deleted ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  );
};

// MIGRATED: 2025-11-26 - Fixed explicit authentication pattern
export const GET = getHandler;
export const POST = postHandler;
export const DELETE = deleteHandler;
